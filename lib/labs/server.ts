import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveDashboardAuth, createDashboardServiceClient } from "@/lib/dashboard-auth";
import { rateLimit } from "@/lib/rate-limit";
import type { Lab, LabCatalogProduct, LabGallery, LabPriceSheet, LabWorkspace, LabWorkspaceAction } from "./types";
import { LabError, assertLabFulfillmentIntegrated, assertPublicationReady, labSheetDocument, roundedRetailCents, validateSheetCatalog } from "./validation";
import { isLabCurrency } from "./money";
import { LAB_STARTER_COLLECTIONS, resolveStarterCollection, starterCollection } from "./starters";

type Row = Record<string, unknown>;
export type LabAccess = { service: SupabaseClient; userId: string; photographerId: string };
const LAB_PAGE_SIZE = 1000;
export const LAB_DIRECTORY_MAX_ROWS = 5000;
export const LAB_CATALOG_MAX_ROWS = 50_000;

/** Supabase caps an unpaged select at 1,000 rows. Never mistake a partial catalog for a complete one. */
export async function readLabRowsInPages<T>(
  readPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>,
  maximum: number,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from <= maximum; from += LAB_PAGE_SIZE) {
    // One extra row distinguishes a full, valid limit from silent truncation.
    const to = Math.min(from + LAB_PAGE_SIZE - 1, maximum);
    const result = await readPage(from, to);
    if (result.error || !Array.isArray(result.data)) databaseError(result.error);
    rows.push(...result.data);
    if (rows.length > maximum) throw new LabError("This directory needs a filtered catalog view before it can be loaded safely. No changes were saved.", 503, "LAB_WORKSPACE_CAPACITY");
    if (result.data.length < to - from + 1) return rows;
  }
  throw new LabError("The lab catalog could not be loaded completely. Try again shortly.", 503, "LAB_WORKSPACE_CAPACITY");
}

export async function labDashboardAccess(request: NextRequest): Promise<LabAccess> {
  const auth = await resolveDashboardAuth(request);
  if (!auth.user) throw new LabError("Sign in and complete your account's two-step verification to manage lab price sheets.", 401, "LAB_AUTH_REQUIRED");
  if (!auth.mfaSatisfied) throw new LabError("Complete two-step verification to manage lab price sheets.", 403, "LAB_MFA_REQUIRED");
  const limit = await rateLimit(auth.user.id, { namespace: "lab-workspace", limit: request.method === "GET" ? 120 : 60, windowSeconds: 60, failClosed: true });
  if (!limit.allowed) throw new LabError(limit.unavailable ? "Account protection is temporarily unavailable. Try again shortly." : "Too many lab requests. Try again shortly.", limit.unavailable ? 503 : 429, "LAB_RATE_LIMIT");
  const service = createDashboardServiceClient();
  const result = await service.from("photographers").select("id").eq("user_id", auth.user.id).maybeSingle();
  if (result.error) throw new LabError("The studio account is temporarily unavailable.", 503, "LAB_ACCOUNT_UNAVAILABLE");
  if (!result.data?.id) throw new LabError("Create a photographer account before managing price sheets.", 403, "LAB_STUDIO_REQUIRED");
  return { service, userId: auth.user.id, photographerId: String(result.data.id) };
}

function databaseError(error: { code?: string; message?: string } | null | undefined): never {
  const message = error?.message || "";
  if (/LAB_VERSION_CONFLICT/.test(message)) throw new LabError("This price sheet changed in another window. Refresh before saving.", 409, "LAB_VERSION_CONFLICT");
  if (/LAB_NOT_READY/.test(message)) throw new LabError("This lab is in setup. Confirm its catalog and production intake before publishing.", 409, "LAB_NOT_READY");
  if (/LAB_SKU_NOT_VERIFIED/.test(message)) throw new LabError("Published products need lab-confirmed SKUs, costs and production specifications.", 409, "LAB_SKU_NOT_VERIFIED");
  if (/LAB_RETAIL_PRICE_REQUIRED/.test(message)) throw new LabError("Set a positive retail price for every published product and package.", 409, "LAB_RETAIL_PRICE_REQUIRED");
  if (/LAB_(NOT_FOUND|OWNER|GALLERY_SCOPE)/.test(message)) throw new LabError("This price sheet or gallery does not belong to your studio.", 404, "LAB_NOT_FOUND");
  if (/LAB_(INVALID|CATALOG_SCOPE|EMPTY)/.test(message)) throw new LabError("Check the selected lab products, prices and assignments.");
  throw new LabError("The lab workspace is unavailable. Its database migration may still be pending. Your existing galleries and orders have not changed.", 503, "LAB_SCHEMA_UNAVAILABLE");
}

export function labFromRow(row: Row): Lab {
  return { id: String(row.id), slug: String(row.slug), name: String(row.name), location: String(row.location), countryCode: String(row.country_code || ""), city: String(row.city || ""), region: String(row.region || ""), currency: String(row.currency), status: row.status as Lab["status"], intakeEnabled: row.intake_enabled === true, catalogVerified: row.catalog_verified === true, description: String(row.description || "") };
}
export function catalogFromRow(row: Row): LabCatalogProduct {
  return { id: String(row.id), labId: String(row.lab_id), category: row.category as LabCatalogProduct["category"], name: String(row.name), size: String(row.size), finish: String(row.finish), costCents: row.cost_cents == null ? null : Number(row.cost_cents), currency: String(row.currency), sku: row.sku == null ? null : String(row.sku), verified: row.verified === true, active: row.active === true, popular: row.popular === true, widthInches: Number(row.width_inches), heightInches: Number(row.height_inches), costSource: row.cost_source as LabCatalogProduct["costSource"], printsPerUnit: row.prints_per_unit == null ? null : Number(row.prints_per_unit) };
}
export function sheetFromRow(row: Row): LabPriceSheet {
  const document = row.document as Omit<LabPriceSheet, "id" | "version" | "status" | "updatedAt" | "publishedProfileId">;
  return { ...document, id: String(row.id), version: Number(row.version), name: String(row.name), labId: String(row.lab_id), currency: String(row.currency), status: row.status as LabPriceSheet["status"], updatedAt: String(row.updated_at), publishedProfileId: row.published_profile_id == null ? null : String(row.published_profile_id) };
}

export async function loadLabWorkspace(access: LabAccess): Promise<LabWorkspace> {
  const { service, photographerId } = access;
  const [labs, catalog, ...results] = await Promise.all([
    readLabRowsInPages((from, to) => service.from("studio_labs").select("*").order("name").order("id").range(from, to), LAB_DIRECTORY_MAX_ROWS),
    readLabRowsInPages((from, to) => service.from("studio_lab_catalog").select("*").order("lab_id").order("category").order("width_inches").order("height_inches").order("id").range(from, to), LAB_CATALOG_MAX_ROWS),
    service.from("lab_price_sheets").select("*").eq("photographer_id", photographerId).order("updated_at", { ascending: false }).limit(200),
    service.from("schools").select("id,school_name,package_profile_id").eq("photographer_id", photographerId).order("school_name").limit(1000),
    service.from("projects").select("id,title,package_profile_id").eq("photographer_id", photographerId).eq("workflow_type", "event").order("title").limit(1000),
  ]);
  for (const result of results) if (result.error) databaseError(result.error);
  const [sheets, schools, projects] = results;
  const galleries: LabGallery[] = [
    ...(schools.data ?? []).map(row => ({ kind: "school" as const, id: String(row.id), name: String(row.school_name || "School"), currentProfileId: row.package_profile_id == null ? null : String(row.package_profile_id) })),
    ...(projects.data ?? []).map(row => ({ kind: "project" as const, id: String(row.id), name: String(row.title || "Project"), currentProfileId: row.package_profile_id == null ? null : String(row.package_profile_id) })),
  ];
  return { labs: labs.map(labFromRow), catalog: catalog.map(catalogFromRow), priceSheets: (sheets.data ?? []).map(sheetFromRow), galleries, starterCollections: LAB_STARTER_COLLECTIONS };
}

export async function performLabAction(access: LabAccess, action: LabWorkspaceAction) {
  const workspace = await loadLabWorkspace(access);
  const current = "id" in action ? workspace.priceSheets.find(s => s.id === action.id) : action.action === "save" ? workspace.priceSheets.find(s => s.id === action.sheet.id) : undefined;
  if (action.action !== "create" && !current) throw new LabError("This price sheet does not belong to your studio.", 404, "LAB_NOT_FOUND");
  let next: LabPriceSheet | undefined;
  let id = current?.id ?? randomUUID();
  if (action.action === "create") {
    const lab = workspace.labs.find(l => l.id === action.labId);
    if (!lab || !isLabCurrency(lab.currency)) throw new LabError("Choose an available lab with a supported currency.");
    if (workspace.priceSheets.length >= 200) throw new LabError("This studio has reached the 200 price sheet limit.");
    const markupPercent = action.markupPercent ?? 100, rounding = action.rounding ?? "0.99";
    let starter: ReturnType<typeof resolveStarterCollection> | undefined;
    if (action.templateId) {
      const template = starterCollection(action.templateId);
      if (!template || template.version !== action.templateVersion) throw new LabError("This starter collection changed. Refresh its preview before creating a draft.", 409, "LAB_STARTER_VERSION");
      if (lab.status === "paused") throw new LabError("This lab is paused. Choose another lab to start a new collection.", 409, "LAB_NOT_READY");
      try { starter = resolveStarterCollection(template, workspace.catalog, lab.id, lab.currency, action.finish ?? "", markupPercent, rounding); }
      catch (error) { throw new LabError(error instanceof Error ? error.message : "Check the starter pricing settings."); }
      if (!starter.items.length) throw new LabError("No exact, approved print products match this collection and finish yet. Browse the starter now, then create its draft after the lab confirms matching products.", 409, "LAB_STARTER_UNAVAILABLE");
    }
    next = { id, version: 1, name: action.name, labId: lab.id, currency: lab.currency, status: "draft", updatedAt: "", publishedProfileId: null,
      pricing: { markupPercent, rounding },
      items: starter ? starter.items : action.starter === "popular" ? workspace.catalog.filter(p => p.labId === lab.id && p.popular && p.active).map(p => ({ catalogProductId: p.id, retailCents: p.costCents == null ? 0 : roundedRetailCents(p.costCents, markupPercent, rounding, lab.currency), enabled: true })) : [],
      packages: starter ? starter.packages.filter(pack => pack.available).map(pack => ({ id: randomUUID(), name: pack.name, description: pack.description, retailCents: pack.retailCents!, items: pack.items })) : [], shipping: { mode: "lab", feeCents: 0, title: "Lab shipping" }, terms: "", assignments: [] };
  } else if (action.action === "duplicate") {
    if (workspace.priceSheets.length >= 200) throw new LabError("This studio has reached the 200 price sheet limit.");
    id = randomUUID(); next = { ...current!, id, version: 1, name: action.name, status: "draft", updatedAt: "", assignments: [], publishedProfileId: null };
  } else if (action.action === "save") {
    if (action.sheet.labId !== current!.labId || action.sheet.currency !== current!.currency) throw new LabError("Duplicate the sheet to change its lab or currency.");
    const validGalleries = new Set(workspace.galleries.map(g => `${g.kind}:${g.id}`));
    if (action.sheet.assignments.some(g => !validGalleries.has(`${g.kind}:${g.id}`))) throw new LabError("A selected gallery does not belong to your studio.", 403, "LAB_GALLERY_SCOPE");
    validateSheetCatalog(action.sheet, workspace.labs.find(l => l.id === action.sheet.labId), workspace.catalog);
    next = action.sheet;
  } else if (action.action === "publish") {
    assertPublicationReady(current!, workspace.labs.find(l => l.id === current!.labId)!, workspace.catalog);
    // No browser action or environment flag can activate unsupported lab
    // shipping/terms or fall through to ordinary studio production. The SQL
    // mapper remains an internal future-integration contract only.
    assertLabFulfillmentIntegrated();
  }
  const mutation = await access.service.rpc("save_lab_price_sheet", {
    p_user_id: access.userId, p_id: id,
    p_expected_version: action.action === "save" || action.action === "delete" ? action.expectedVersion : 0,
    p_document: next ? labSheetDocument(next) : {}, p_action: action.action === "delete" ? "delete" : action.action === "save" ? "save" : "create",
  });
  if (mutation.error) databaseError(mutation.error);
  const updated = await loadLabWorkspace(access);
  return { workspace: updated, sheet: updated.priceSheets.find(s => s.id === id) };
}

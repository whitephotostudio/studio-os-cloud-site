import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveDashboardAuth, createDashboardServiceClient } from "@/lib/dashboard-auth";
import { rateLimit } from "@/lib/rate-limit";
import { guardAgreement } from "@/lib/require-agreement";
import { LAB_DIRECTORY_MAX_ROWS, labFromRow, readLabRowsInPages } from "@/lib/labs/server";
import { LabError } from "@/lib/labs/validation";
import { isSupportedCurrency } from "@/lib/labs/money";
import { isLabCountryCode } from "@/lib/lab-directory";
import { CATALOG_FIELDS, CatalogImportError, previewCatalogImport } from "@/lib/lab-catalog-import";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
class AccessError extends Error { constructor(message: string, public status = 400) { super(message); } }
const uuid = z.string().uuid();
const mapping = z.partialRecord(z.enum(CATALOG_FIELDS), z.number().int().min(0).max(50)).optional();
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createLab"), name: z.string().trim().min(1).max(100), countryCode: z.string().refine(isLabCountryCode), city: z.string().trim().min(1).max(100), region: z.string().trim().max(100), currency: z.string().refine(isSupportedCurrency) }).strict(),
  z.object({ action: z.literal("preview"), labId: uuid, csv: z.string().max(2_000_000), mapping }).strict(),
  z.object({ action: z.literal("import"), labId: uuid, csv: z.string().max(2_000_000), mapping, expectedVersion: z.number().int().min(0), requestId: uuid, sourceName: z.string().trim().min(1).max(200) }).strict(),
]);

async function access(request: NextRequest) {
  const auth = await resolveDashboardAuth(request, { requireMfaEnrollment: true });
  if (!auth.user || !auth.mfaSatisfied) throw new AccessError("Sign in with two-step verification to manage a lab catalog.", 401);
  const userId = auth.user.id;
  const limit = await rateLimit(userId, { namespace: "lab-catalog", limit: 45, windowSeconds: 60, failClosed: true });
  if (!limit.allowed) throw new AccessError("Catalog account protection is unavailable or its request limit was reached. Try again shortly.", limit.unavailable ? 503 : 429);
  const service = createDashboardServiceClient();
  const [profile, memberships] = await Promise.all([
    service.from("photographers").select("is_platform_admin").eq("user_id", userId).maybeSingle(),
    readLabRowsInPages((from, to) => service.from("lab_memberships").select("lab_id").eq("user_id", userId).eq("active", true).eq("role", "owner").order("lab_id").range(from, to), LAB_DIRECTORY_MAX_ROWS),
  ]);
  if (profile.error) throw new AccessError("Lab permissions are temporarily unavailable.", 503);
  return { userId, service, admin: profile.data?.is_platform_admin === true, labIds: memberships.map(row => String(row.lab_id)) };
}
type Access = Awaited<ReturnType<typeof access>>;
async function labsFor(actor: Access) {
  if (!actor.admin && !actor.labIds.length) return [];
  const read = (ids?: string[]) => readLabRowsInPages((from, to) => {
    let query = actor.service.from("studio_labs").select("*").order("name").order("id");
    if (ids) query = query.in("id", ids);
    return query.range(from, to);
  }, LAB_DIRECTORY_MAX_ROWS);
  if (actor.admin) return (await read()).map(row => ({ ...labFromRow(row), catalogVersion: Number(row.catalog_version) }));
  const rows = [];
  // A worldwide owner can manage many labs. Keep PostgREST URLs bounded rather
  // than putting thousands of UUIDs into one GET's IN filter.
  for (let offset = 0; offset < actor.labIds.length; offset += 100) rows.push(...await read(actor.labIds.slice(offset, offset + 100)));
  return rows.map(row => ({ ...labFromRow(row), catalogVersion: Number(row.catalog_version) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
function failure(error: unknown) {
  const status = error instanceof AccessError || error instanceof LabError ? error.status : error instanceof CatalogImportError ? 400 : 503;
  const message = error instanceof AccessError || error instanceof LabError || error instanceof CatalogImportError ? error.message : "The catalog could not be saved. Try again shortly.";
  return NextResponse.json({ ok: false, message }, { status, headers });
}
export async function GET(request: NextRequest) {
  try {
    const actor = await access(request);
    return NextResponse.json({ ok: true, mayCreateLab: actor.admin, labs: await labsFor(actor) }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const actor = await access(request);
    const agreement = await guardAgreement({ service: actor.service, userId: actor.userId });
    if (!agreement.ok) throw new AccessError(agreement.body.error, agreement.status);
    const reader = request.body?.getReader();
    if (!reader) throw new AccessError("Choose a catalog file.");
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (true) { const result = await reader.read(); if (result.done) break; bytes += result.value.length; if (bytes > 3_000_000) { await reader.cancel(); throw new AccessError("Use a CSV smaller than 2 MB.", 413); } chunks.push(result.value); }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new AccessError("Use a valid catalog upload request."); }
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) throw new AccessError("Check the lab, location, currency and catalog fields.");
    const action = parsed.data;
    if (action.action === "createLab") {
      if (!actor.admin) throw new AccessError("Only the Studio OS administrator can add labs to the directory.", 403);
      const labId = randomUUID();
      const slug = `${action.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "lab"}-${labId.slice(0, 8)}`;
      const result = await actor.service.from("studio_labs").insert({ id: labId, slug, name: action.name, country_code: action.countryCode, city: action.city, region: action.region,
        location: [action.city, action.region].filter(Boolean).join(", "), currency: action.currency, status: "setup", intake_enabled: false, catalog_verified: false, description: "Catalog and production setup pending." }).select("id").single();
      if (result.error) throw new AccessError("The lab could not be added. Try again shortly.", 503);
      return NextResponse.json({ ok: true, labId, labs: await labsFor(actor), message: "Lab added in setup. Upload its catalog next." }, { headers });
    }
    const labs = await labsFor(actor), lab = labs.find(row => row.id === action.labId);
    if (!lab) throw new AccessError("You do not manage this lab.", 403);
    const preview = previewCatalogImport(action.csv, action.mapping, lab.currency);
    if (action.action === "preview") return NextResponse.json({ ok: true, preview }, { headers });
    if (preview.issues.length || !preview.rows.length) throw new AccessError("Resolve every catalog issue before importing.");
    const fileHash = createHash("sha256").update(JSON.stringify({ csv: action.csv, mapping: preview.mapping })).digest("hex");
    const result = await actor.service.rpc("apply_lab_catalog_import", { p_actor_user_id: actor.userId, p_lab_id: lab.id, p_expected_version: action.expectedVersion,
      p_rows: preview.rows, p_source_name: action.sourceName, p_file_hash: fileHash, p_request_id: action.requestId });
    if (result.error) {
      const message = result.error.message || "";
      if (/VERSION_CONFLICT|REQUEST_CONFLICT/.test(message)) throw new AccessError("This catalog changed in another window. Reload it and review the file again.", 409);
      if (/ACTIVE_CATALOG_HELD/.test(message)) throw new AccessError("This lab has an active catalog. Its replacement needs a reviewed production rollout.", 409);
      if (/FORBIDDEN/.test(message)) throw new AccessError("You do not manage this lab.", 403);
      throw new AccessError("The catalog import could not be committed. No partial rows were saved.", 503);
    }
    return NextResponse.json({ ok: true, receipt: result.data, labs: await labsFor(actor), message: `${preview.rows.length} products imported for review. Existing photographer prices were preserved.` }, { headers });
  } catch (error) { return failure(error); }
}

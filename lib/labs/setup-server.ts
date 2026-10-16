import { createHash } from "node:crypto";
import { z } from "zod";
import { CatalogImportError, previewCatalogImport, type CatalogPreview } from "../lab-catalog-import";
import type { LabOrderAccess } from "./orders-server";
import { labFromRow } from "./server";
import { LabError } from "./validation";
import { defaultLabSetupDocument, labSetupReadinessIssues, parseLabSetupAction, parseLabSetupDocument } from "./setup-validation";
import type { LabSetupAction, LabSetupCatalog, LabSetupDraft, LabSetupMutationResult, LabSetupWorkspace } from "./setup-types";

type Row = Record<string, unknown>;
export type LabSetupAccess = LabOrderAccess;
const uuid = z.string().uuid();
const date = (value: unknown) => value == null ? null : new Date(String(value)).toISOString();
const missingSchema = (error: { code?: string; message?: string } | null) => error?.code === "42P01" || error?.code === "PGRST205" || /Could not find the table.*lab_setup_/i.test(error?.message ?? "");
export function labSetupDatabaseError(error: { code?: string; message?: string } | null): never {
  const message = error?.message ?? "";
  if (/VERSION_CONFLICT/.test(message)) throw new LabError("This setup changed in another window. Reload before saving.", 409, "LAB_SETUP_VERSION_CONFLICT");
  if (/REQUEST_CONFLICT/.test(message) || error?.code === "23505") throw new LabError("This request was already used with different details. Retry the original request.", 409, "LAB_SETUP_REQUEST_CONFLICT");
  if (/FORBIDDEN/.test(message)) throw new LabError("Only an existing owner of this lab can change its setup.", 403, "LAB_SETUP_FORBIDDEN");
  if (/NOT_READY/.test(message)) throw new LabError("Complete the catalog, paper, services and delivery choices before submitting for review.", 400, "LAB_SETUP_NOT_READY");
  if (/LIMIT/.test(message)) throw new LabError("This pilot lab has reached its setup history limit. Ask Studio OS to review its staged setup.", 409, "LAB_SETUP_LIMIT");
  if (/INVALID/.test(message)) throw new LabError("Check the setup document and staged catalog. Nothing was changed.", 400, "LAB_SETUP_INVALID");
  throw new LabError("Lab setup is temporarily unavailable. Existing prices, catalogs and orders are unchanged.", 503, "LAB_SETUP_UNAVAILABLE");
}
function member(access: LabSetupAccess, labId: string) {
  if (access.audience !== "lab" || !uuid.safeParse(labId).success) throw new LabError("Choose an available lab from your lab portal.", 403, "LAB_SETUP_FORBIDDEN");
  const membership = access.memberships.find(m => m.labId === labId);
  if (!membership) throw new LabError("This lab setup is not available to your account.", 404, "LAB_SETUP_NOT_FOUND");
  return membership;
}
async function loadCatalog(access: LabSetupAccess, labId: string, id: unknown): Promise<{ summary: LabSetupCatalog; full: CatalogPreview & { currency: string } } | null> {
  if (id == null) return null;
  const result = await access.service.from("lab_setup_catalogs").select("id,lab_id,source_name,content_hash,currency,mapping,preview,created_at").eq("id", String(id)).eq("lab_id", labId).maybeSingle();
  if (result.error) labSetupDatabaseError(result.error);
  if (!result.data) throw new LabError("The staged catalog is unavailable. Reload the lab setup.", 503, "LAB_SETUP_UNAVAILABLE");
  const r = result.data, full = { ...(r.preview as CatalogPreview), currency: String(r.currency) };
  return { full, summary: { id: String(r.id), sourceName: String(r.source_name), contentHash: String(r.content_hash), currency: full.currency, headers: full.headers, mapping: full.mapping, rows: full.rows.slice(0, 50), issues: full.issues.slice(0, 100), sourceRowCount: full.sourceRowCount, validRowCount: full.rows.length, issueCount: full.issues.length, createdAt: date(r.created_at)! } };
}
async function projectDraft(access: LabSetupAccess, labId: string, r: Row | null, lab: { countryCode: string; currency: string }): Promise<LabSetupDraft> {
  const ownership = member(access, labId), document = r ? parseLabSetupDocument(r.document) : defaultLabSetupDocument(lab.countryCode, lab.currency);
  const catalog = await loadCatalog(access, labId, r?.catalog_id);
  return { labId, version: r ? Number(r.version) : 0, status: r?.status === "submitted" ? "submitted" : "draft", document, catalog: catalog?.summary ?? null, readinessIssues: labSetupReadinessIssues(document, catalog?.full ?? null), updatedAt: date(r?.updated_at), submittedAt: date(r?.submitted_at), canEdit: ownership.role === "owner", testOnly: true, printAllowed: false };
}
export async function loadLabSetupWorkspace(access: LabSetupAccess, labId?: string | null): Promise<LabSetupWorkspace> {
  if (access.audience !== "lab") throw new LabError("Open setup from the lab portal.", 403, "LAB_SETUP_FORBIDDEN");
  if (labId) member(access, labId);
  if (access.memberships.length > 500) throw new LabError("This account's lab list needs a scoped setup view.", 503, "LAB_SETUP_UNAVAILABLE");
  const rows: Row[] = [];
  for (let i = 0; i < access.memberships.length; i += 100) {
    const result = await access.service.from("studio_labs").select("*").in("id", access.memberships.slice(i, i + 100).map(m => m.labId));
    if (result.error) labSetupDatabaseError(result.error);
    rows.push(...result.data ?? []);
  }
  const labs = rows.map(r => { const m = member(access, String(r.id)); return { ...labFromRow(r), role: m.role, canEdit: m.role === "owner" }; }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const selected = labId ? labs.find(l => l.id === labId) : labs.find(l => l.canEdit) ?? labs[0];
  if (labId && !selected) throw new LabError("This lab setup is unavailable.", 404, "LAB_SETUP_NOT_FOUND");
  if (!selected) return { labs, selectedLabId: null, draft: null, available: true };
  const current = await access.service.from("lab_setup_drafts").select("*").eq("lab_id", selected.id).maybeSingle();
  if (current.error) { if (missingSchema(current.error)) return { labs, selectedLabId: selected.id, draft: null, available: false }; labSetupDatabaseError(current.error); }
  return { labs, selectedLabId: selected.id, draft: await projectDraft(access, selected.id, current.data, selected), available: true };
}
function catalogId(userId: string, labId: string, requestId: string) {
  const h = createHash("sha256").update(`lab-setup-catalog-v1:${userId}:${labId}:${requestId}`).digest("hex").slice(0, 32).split("");
  h[12] = "4"; h[16] = "8"; const value = h.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
/** Owner proposal writes never call active catalog import, profile approval or intake functions. */
export async function performLabSetupAction(access: LabSetupAccess, value: LabSetupAction): Promise<LabSetupMutationResult> {
  const action = parseLabSetupAction(value), membership = member(access, action.labId);
  if (membership.role !== "owner") throw new LabError("Only this lab's owner can save or submit its setup.", 403, "LAB_SETUP_FORBIDDEN");
  let catalog: Row | null = null;
  if (action.action === "stage_catalog") {
    if (!action.document.currency) throw new LabError("Choose the catalog currency before staging a CSV.", 400, "LAB_SETUP_INVALID");
    try {
      const preview = previewCatalogImport(action.csv, action.mapping, action.document.currency);
      if (Buffer.byteLength(JSON.stringify(preview)) > 4_000_000) throw new LabError("This staged catalog preview is too large. Split the CSV into a smaller file.", 413, "LAB_SETUP_INVALID");
      catalog = { id: catalogId(access.userId, action.labId, action.requestId), sourceName: action.sourceName, contentHash: createHash("sha256").update(action.csv, "utf8").digest("hex"), currency: action.document.currency, csv: action.csv, mapping: preview.mapping, preview };
    } catch (error) { if (error instanceof CatalogImportError) throw new LabError(error.message, 400, "LAB_SETUP_INVALID_CATALOG"); throw error; }
  }
  const result = await access.service.rpc("save_lab_setup_draft", { p_user_id: access.userId, p_lab_id: action.labId, p_expected_version: action.expectedVersion, p_request_id: action.requestId, p_action: action.action, p_document: action.action === "submit" ? null : action.document, p_catalog_document: catalog });
  if (result.error) labSetupDatabaseError(result.error);
  const row = result.data as Row;
  // The DB returns its current head on replay, including edits made since the original request.
  return { draft: await projectDraft(access, action.labId, row, { countryCode: "", currency: "" }), replayed: row.replayed === true };
}

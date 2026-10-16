import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import sharp from "sharp";
import { z } from "zod";
import type { NextRequest } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { productionAccess, type ProductionAccess } from "./production-server";
import { productionV2AssetFromRow, type ProductionV2InternalAsset } from "./production-v2-server";
import { productionV2Bytes, productionV2Preview } from "./production-v2-image-server";
import { productionHash, productionJpegDensity, renderProductionPreview, PRODUCTION_MAX_PIXELS } from "./production-renderer";
import { publicProductionAsset, productionPrivateHeaders } from "./production-image-server";
import { LabError } from "./validation";
import { SHEET_BUCKET, SHEET_MAX_BYTES, SHEET_DPI, parseSheetAction, sheetGeometry, validateSheetCrop, type SheetAction, type SheetDocument, type SheetDraft, type SheetRender, type SheetSource, type SheetWorkspace } from "./sheet-layouts";

type Row = Record<string, unknown>;
type Scope = { ownerId: string; jobId: string | null; reference: string | null; sourceIds: string[] | null };
const uuid = z.string().uuid();
const iso = (value: unknown) => new Date(String(value)).toISOString();
const image = (bytes: Buffer) => sharp(bytes, { limitInputPixels: PRODUCTION_MAX_PIXELS, failOn: "warning" });
export function sheetDatabaseError(error: { message?: string; code?: string } | null): never {
  const message = error?.message || "";
  if (/VERSION_CONFLICT/.test(message)) throw new LabError("This sheet changed. Reload it before reviewing or exporting again.", 409, "SHEET_VERSION_CONFLICT");
  if (/REQUEST_CONFLICT/.test(message)) throw new LabError("This saved request belongs to different sheet details. Reload before trying again.", 409, "SHEET_REQUEST_CONFLICT");
  if (/FORBIDDEN|NOT_FOUND/.test(message)) throw new LabError("This private sheet or photograph is unavailable to this account.", 404, "SHEET_NOT_FOUND");
  if (/INVALID|DOES_NOT_FIT|ASPECT|RESOLUTION/.test(message)) throw new LabError("Choose paper that fits the finished prints, and crop each photo inside its original with at least 200 pixels per printed inch.", 400, "SHEET_INVALID");
  throw new LabError("The private sheet service is unavailable. Retry the retained request.", 503, "SHEET_UNAVAILABLE");
}
export function parsePrivateSheetAction(value: unknown): SheetAction {
  try { return parseSheetAction(value); } catch (error) {
    if (error instanceof z.ZodError) throw new LabError("Check the sheet name, paper, layout, photos and crop coordinates.", 400, "SHEET_INVALID");
    return sheetDatabaseError({ message: error instanceof Error ? error.message : "SHEET_INVALID" });
  }
}
export async function sheetAccess(request: NextRequest, audience: "studio" | "lab") {
  const access = await productionAccess(request, audience);
  if (request.method === "POST") {
    const quota = await rateLimit(access.userId, { namespace: "lab-sheet-layout-write", limit: 20, windowSeconds: 60, failClosed: true });
    if (!quota.allowed) throw new LabError("Please wait before preparing more private sheets.", quota.unavailable ? 503 : 429, "SHEET_RATE_LIMIT");
  }
  return access;
}
async function scope(access: ProductionAccess, jobId: string | null): Promise<Scope> {
  if (jobId === null) {
    if (access.audience !== "studio" || !access.photographerId) throw new LabError("Open sheets from the exact receiving job.", 404, "SHEET_NOT_FOUND");
    return { ownerId: access.photographerId, jobId: null, reference: null, sourceIds: null };
  }
  if (!uuid.safeParse(jobId).success) throw new LabError("Choose a valid production job.", 400, "SHEET_INVALID");
  const result = await access.service.from("lab_production_v2_jobs").select("id,photographer_id,lab_id,reference,work").eq("id", jobId).maybeSingle();
  if (result.error) sheetDatabaseError(result.error);
  const row = result.data;
  const allowed = row && (access.audience === "studio" ? access.photographerId === row.photographer_id : row.lab_id != null && access.memberships.some(m => m.labId === row.lab_id && m.role !== "viewer"));
  if (!allowed) throw new LabError("This receiving job is unavailable to this account.", 404, "SHEET_NOT_FOUND");
  const work = row.work as { slots: Record<string, { sourceAssetId: string }> };
  return { ownerId: String(row.photographer_id), jobId, reference: String(row.reference), sourceIds: [...new Set(Object.values(work.slots).map(s => s.sourceAssetId))] };
}
function selectedIds(document: SheetDocument) { return [...new Set(document.cells.flatMap(c => c.assetId ? [c.assetId] : []))]; }
async function source(access: ProductionAccess, selectedScope: Scope, assetId: string): Promise<ProductionV2InternalAsset> {
  if (!uuid.safeParse(assetId).success || selectedScope.sourceIds && !selectedScope.sourceIds.includes(assetId)) throw new LabError("This photograph is not assigned to the selected job.", 404, "SHEET_NOT_FOUND");
  const result = await access.service.from("lab_production_assets").select("*").eq("id", assetId).eq("photographer_id", selectedScope.ownerId).eq("kind", "original").maybeSingle();
  if (result.error) sheetDatabaseError(result.error);
  if (!result.data) throw new LabError("The selected immutable original is unavailable.", 404, "SHEET_NOT_FOUND");
  return productionV2AssetFromRow(result.data);
}
async function rawDraft(access: ProductionAccess, id: string): Promise<{ row: Row; scope: Scope }> {
  if (!uuid.safeParse(id).success) throw new LabError("Choose a valid saved sheet.", 400, "SHEET_INVALID");
  const result = await access.service.from("lab_sheet_layout_drafts").select("*").eq("id", id).eq("created_by", access.userId).eq("audience", access.audience).maybeSingle();
  if (result.error) sheetDatabaseError(result.error);
  if (!result.data) throw new LabError("This private sheet is unavailable.", 404, "SHEET_NOT_FOUND");
  const selectedScope = await scope(access, result.data.job_id == null ? null : String(result.data.job_id));
  if (selectedScope.ownerId !== result.data.photographer_id) throw new LabError("The saved sheet scope changed.", 404, "SHEET_NOT_FOUND");
  return { row: result.data, scope: selectedScope };
}
function renderFromRow(row: Row): SheetRender { return { id: String(row.id), draftVersion: Number(row.draft_version), filename: String(row.filename), sha256: String(row.sha256), byteSize: Number(row.byte_size), widthPixels: Number(row.width_pixels), heightPixels: Number(row.height_pixels), reviewedAt: row.reviewed_at == null ? null : iso(row.reviewed_at), createdAt: iso(row.created_at) }; }
async function draftFromRow(access: ProductionAccess, row: Row): Promise<SheetDraft> {
  let render: SheetRender | null = null;
  if (row.current_export_id) {
    const result = await access.service.from("lab_sheet_layout_exports").select("*").eq("id", row.current_export_id).eq("draft_id", row.id).eq("draft_version", row.version).maybeSingle();
    if (result.error) sheetDatabaseError(result.error);
    if (!result.data) throw new LabError("The saved sheet proof is unavailable.", 503, "SHEET_UNAVAILABLE");
    render = renderFromRow(result.data);
  }
  return { id: String(row.id), name: String(row.name), jobId: row.job_id == null ? null : String(row.job_id), version: Number(row.version), document: row.document as SheetDocument, render, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}
export async function loadSheetDraft(access: ProductionAccess, id: string) { return draftFromRow(access, (await rawDraft(access, id)).row); }
export async function loadSheetWorkspace(access: ProductionAccess, jobId: string | null = null, draftId: string | null = null): Promise<SheetWorkspace> {
  let selectedScope: Scope | null = null, selected: Row | null = null;
  if (draftId) { const loaded = await rawDraft(access, draftId); selected = loaded.row; selectedScope = loaded.scope; if (jobId && jobId !== selectedScope.jobId) throw new LabError("Open the sheet from its saved job.", 404, "SHEET_NOT_FOUND"); jobId = selectedScope.jobId; }
  else if (jobId || access.audience === "studio") selectedScope = await scope(access, jobId);
  if (access.audience === "lab" && !jobId) return { drafts: [], sources: [], jobId: null, jobReference: null, canCreate: false };
  let query = access.service.from("lab_sheet_layout_drafts").select("*").eq("created_by", access.userId).eq("audience", access.audience).order("updated_at", { ascending: false }).limit(60);
  query = jobId ? query.eq("job_id", jobId) : query.is("job_id", null);
  const result = await query; if (result.error) sheetDatabaseError(result.error);
  const drafts: SheetDraft[] = [];
  for (const row of result.data || []) {
    try { await scope(access, row.job_id == null ? null : String(row.job_id)); drafts.push(await draftFromRow(access, row)); }
    catch (error) { if (!(error instanceof LabError && error.status === 404)) throw error; }
  }
  const sources: SheetSource[] = [];
  if (selectedScope) {
    let originals = access.service.from("lab_production_assets").select("*").eq("photographer_id", selectedScope.ownerId).eq("kind", "original").order("created_at", { ascending: false }).limit(20);
    if (selectedScope.sourceIds) originals = originals.in("id", selectedScope.sourceIds);
    const listed = await originals; if (listed.error) sheetDatabaseError(listed.error);
    sources.push(...(listed.data || []).map(a => publicProductionAsset(productionV2AssetFromRow(a))));
    if (selected) for (const id of selectedIds(selected.document as SheetDocument)) if (!sources.some(a => a.id === id)) {
      try { sources.push(publicProductionAsset(await source(access, selectedScope, id))); } catch (error) { if (!(error instanceof LabError && error.status === 404)) throw error; }
    }
  }
  return { drafts, sources, jobId, jobReference: selectedScope?.reference || null, canCreate: selectedScope !== null };
}
export async function sheetSourcePreview(access: ProductionAccess, assetId: string, jobId: string | null) {
  return productionV2Preview(access.service, await source(access, await scope(access, jobId), assetId));
}
export async function renderSheetBytes(document: SheetDocument, sources: Map<string, { asset: SheetSource; bytes: Buffer }>) {
  let geometry;
  try { geometry = sheetGeometry(document); } catch (error) { return sheetDatabaseError({ message: String(error) }); }
  const composites: { input: Buffer; left: number; top: number }[] = [];
  const manifestCells: Row[] = [];
  // Join by stable cell ID: browser array order can never swap photographs.
  for (const cell of geometry.cells) {
    const chosen = document.cells.find(c => c.id === cell.id), loaded = chosen?.assetId ? sources.get(chosen.assetId) : null;
    if (!chosen?.crop || !loaded) throw new LabError("Choose and crop a photograph for every print before preparing a proof.", 400, "SHEET_INVALID_INCOMPLETE");
    let detail;
    try { detail = validateSheetCrop(loaded.asset, chosen.crop, cell); } catch (error) { return sheetDatabaseError({ message: String(error) }); }
    if (loaded.bytes.length !== loaded.asset.byteSize || productionHash(loaded.bytes) !== loaded.asset.sha256) throw new LabError("The immutable original failed its checksum.", 409, "SHEET_INTEGRITY");
    const upright = await image(loaded.bytes).autoOrient().png().toBuffer();
    const uprightMetadata = await image(upright).metadata();
    if (uprightMetadata.width !== loaded.asset.widthPixels || uprightMetadata.height !== loaded.asset.heightPixels) throw new LabError("The original dimensions do not match its immutable record.", 409, "SHEET_INTEGRITY");
    const r = chosen.crop;
    const cropped = await image(upright).extract({ left: r.x, top: r.y, width: r.width, height: r.height }).png().toBuffer();
    const input = await image(cropped).rotate(r.rotation).resize(detail.widthPixels, detail.heightPixels, { fit: "fill" }).flatten({ background: "white" }).withIccProfile("srgb").png().toBuffer();
    composites.push({ input, left: Math.round(cell.xInches * SHEET_DPI), top: Math.round(cell.yInches * SHEET_DPI) });
    const { label: _label, ...position } = cell; void _label;
    manifestCells.push({ ...position, assetId: loaded.asset.id, sourceSha256: loaded.asset.sha256, crop: r });
  }
  for (const quality of [95, 90, 85, 80, 75]) {
    const bytes = productionJpegDensity(await sharp({ create: { width: geometry.widthPixels, height: geometry.heightPixels, channels: 3, background: "white" } }).composite(composites).withIccProfile("srgb").jpeg({ quality, chromaSubsampling: "4:4:4" }).toBuffer());
    if (bytes.length <= SHEET_MAX_BYTES) return { bytes, geometry, manifestCells };
  }
  throw new LabError("This sheet exceeds the private export limit. Choose a smaller sheet.", 413, "SHEET_FILE_SIZE");
}
export async function performSheetAction(access: ProductionAccess, action: SheetAction) {
  if (action.action === "save") {
    const selectedScope = await scope(access, action.jobId);
    for (const id of selectedIds(action.document)) await source(access, selectedScope, id);
    const result = await access.service.rpc("save_lab_sheet_layout_draft", { p_user_id: access.userId, p_audience: access.audience, p_draft_id: action.draftId, p_request_id: action.requestId, p_expected_version: action.expectedVersion, p_job_id: action.jobId, p_name: action.name, p_document: action.document });
    if (result.error) sheetDatabaseError(result.error);
    return { draft: await loadSheetDraft(access, action.draftId), replayed: result.data?.replayed === true };
  }
  const loaded = await rawDraft(access, action.draftId), row = loaded.row;
  if (Number(row.version) !== action.expectedVersion) throw new LabError("The sheet changed. Reload before preparing or reviewing this proof.", 409, "SHEET_VERSION_CONFLICT");
  if (action.action === "review") {
    const result = await access.service.rpc("review_lab_sheet_layout_export", { p_user_id: access.userId, p_audience: access.audience, p_draft_id: action.draftId, p_render_id: action.renderId, p_expected_version: action.expectedVersion, p_sha256: action.sha256 });
    if (result.error) sheetDatabaseError(result.error);
    return { draft: await loadSheetDraft(access, action.draftId), replayed: result.data?.replayed === true };
  }
  const previous = await access.service.from("lab_sheet_layout_exports").select("*").eq("draft_id", row.id).eq("request_id", action.requestId).maybeSingle();
  if (previous.error) sheetDatabaseError(previous.error);
  if (previous.data) {
    if (Number(previous.data.draft_version) !== action.expectedVersion || row.current_export_id !== previous.data.id) throw new LabError("This proof request belongs to an older sheet.", 409, "SHEET_VERSION_CONFLICT");
    for (const id of selectedIds(row.document as SheetDocument)) await source(access, loaded.scope, id);
    return { draft: await draftFromRow(access, row), replayed: true };
  }
  const inputs = new Map<string, { asset: SheetSource; bytes: Buffer }>();
  for (const id of selectedIds(row.document as SheetDocument)) { const asset = await source(access, loaded.scope, id); inputs.set(id, { asset: publicProductionAsset(asset), bytes: await productionV2Bytes(access.service, asset) }); }
  const rendered = await renderSheetBytes(row.document as SheetDocument, inputs);
  const hash = createHash("sha256").update(`lab-sheet:${access.userId}:${action.draftId}:${action.requestId}`).digest("hex").slice(0, 32);
  const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20)}`;
  const filename = `TEST-sheet-${row.id}-v${row.version}.jpg`, storageKey = `${access.userId}/${id}.jpg`, sha256 = productionHash(rendered.bytes), document = row.document as SheetDocument;
  const manifest = { version: 1, testOnly: true, printAllowed: false, draftId: String(row.id), draftVersion: Number(row.version), paper: { id: document.paperId, orientation: document.orientation, ...(({ cells: _cells, ...paper }) => { void _cells; return paper; })(rendered.geometry) }, templateId: document.templateId, copies: document.copies, dpi: SHEET_DPI, cells: rendered.manifestCells, file: { filename, sha256, byteSize: rendered.bytes.length, contentType: "image/jpeg" }, notice: "TEST sheet only. No order, payment, printer or dispatch was changed." };
  const exported = { id, filename, storageKey, sha256, byteSize: rendered.bytes.length, widthPixels: rendered.geometry.widthPixels, heightPixels: rendered.geometry.heightPixels, document, manifest };
  const bucket = await access.service.storage.getBucket(SHEET_BUCKET);
  if (bucket.error || bucket.data?.public !== false) throw new LabError("Private sheet storage is unavailable.", 503, "SHEET_STORAGE");
  const upload = await access.service.storage.from(SHEET_BUCKET).upload(storageKey, rendered.bytes, { contentType: "image/jpeg", cacheControl: "0", upsert: false });
  if (upload.error) {
    const existing = await access.service.storage.from(SHEET_BUCKET).download(storageKey);
    if (existing.error || !existing.data) throw new LabError("The saved proof could not be confirmed. Retry the same request.", 503, "SHEET_STORAGE");
    if (existing.data.size !== rendered.bytes.length || productionHash(Buffer.from(await existing.data.arrayBuffer())) !== sha256) throw new LabError("The proof request names different file bytes.", 409, "SHEET_REQUEST_CONFLICT");
  }
  const registered = await access.service.rpc("register_lab_sheet_layout_export", { p_user_id: access.userId, p_audience: access.audience, p_draft_id: action.draftId, p_request_id: action.requestId, p_expected_version: action.expectedVersion, p_export: exported });
  if (registered.error || !registered.data) {
    const reconciled = await access.service.from("lab_sheet_layout_exports").select("*").eq("id", id).eq("draft_id", row.id).maybeSingle();
    if (!reconciled.error && reconciled.data) {
      const r = reconciled.data;
      if (r.sha256 !== sha256 || r.storage_key !== storageKey || Number(r.draft_version) !== action.expectedVersion || r.request_id !== action.requestId || r.filename !== filename || Number(r.byte_size) !== rendered.bytes.length || Number(r.width_pixels) !== rendered.geometry.widthPixels || Number(r.height_pixels) !== rendered.geometry.heightPixels || !isDeepStrictEqual(r.document, document) || !isDeepStrictEqual(r.manifest, manifest)) throw new LabError("The proof request already belongs to different details.", 409, "SHEET_REQUEST_CONFLICT");
    } else {
      // A transport timeout cannot prove the transaction will never commit.
      if (!reconciled.error && !reconciled.data && registered.error?.code && ["22023", "42501", "23505", "23514", "23502", "22P02", "22003", "40001"].includes(registered.error.code)) await access.service.storage.from(SHEET_BUCKET).remove([storageKey]).catch(() => undefined);
      sheetDatabaseError(registered.error || reconciled.error);
    }
  }
  const confirmed = await loadSheetDraft(access, action.draftId);
  if (confirmed.version !== action.expectedVersion || confirmed.render?.id !== id) throw new LabError("Another update replaced this sheet proof. Reload before reviewing or downloading.", 409, "SHEET_VERSION_CONFLICT");
  return { draft: confirmed, replayed: registered.data?.replayed === true };
}
export async function sheetExportFile(access: ProductionAccess, draftId: string, renderId: string, kind: "proof" | "jpeg" | "manifest") {
  const loaded = await rawDraft(access, draftId);
  if (!uuid.safeParse(renderId).success || loaded.row.current_export_id !== renderId) throw new LabError("Prepare and review the current sheet proof.", 409, "SHEET_VERSION_CONFLICT");
  const result = await access.service.from("lab_sheet_layout_exports").select("*").eq("id", renderId).eq("draft_id", draftId).eq("draft_version", loaded.row.version).maybeSingle();
  if (result.error) sheetDatabaseError(result.error);
  const row = result.data;
  if (!row || kind !== "proof" && !row.reviewed_at) throw new LabError("Review this exact saved proof before downloading the test sheet.", 409, "SHEET_REVIEW_REQUIRED");
  for (const id of selectedIds(loaded.row.document as SheetDocument)) await source(access, loaded.scope, id);
  if (row.storage_key !== `${access.userId}/${renderId}.jpg` || Number(row.byte_size) > SHEET_MAX_BYTES) throw new LabError("The sheet file identity is invalid.", 409, "SHEET_INTEGRITY");
  const stored = await access.service.storage.from(SHEET_BUCKET).download(row.storage_key);
  if (stored.error || !stored.data || stored.data.size !== Number(row.byte_size) || stored.data.size > SHEET_MAX_BYTES) throw new LabError("The private sheet proof is unavailable.", 503, "SHEET_STORAGE");
  const bytes = Buffer.from(await stored.data.arrayBuffer());
  if (productionHash(bytes) !== row.sha256) throw new LabError("The saved sheet failed its checksum.", 409, "SHEET_INTEGRITY");
  const meta = await image(bytes).metadata(), geometry = sheetGeometry(loaded.row.document as SheetDocument);
  if (meta.width !== geometry.widthPixels || meta.height !== geometry.heightPixels || meta.format !== "jpeg" || meta.density !== 300) throw new LabError("The saved sheet no longer matches its paper dimensions.", 409, "SHEET_INTEGRITY");
  if (kind === "manifest") return new Response(JSON.stringify({ ...row.manifest, reviewedAt: iso(row.reviewed_at) }, null, 2), { headers: { ...productionPrivateHeaders, "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${row.filename.replace(/\.jpg$/, ".json")}"`, "X-Content-Type-Options": "nosniff" } });
  const output = kind === "proof" ? await renderProductionPreview(bytes) : bytes;
  return new Response(new Uint8Array(output), { headers: { ...productionPrivateHeaders, "Content-Type": "image/jpeg", ...(kind === "jpeg" ? { "Content-Disposition": `attachment; filename="${row.filename}"` } : {}), "X-Content-Type-Options": "nosniff" } });
}

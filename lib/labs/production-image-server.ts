import { createHash, randomUUID } from "node:crypto";
import type { LabOrderAccess } from "./orders-server";
import { loadProductionAsset, loadProductionJob, productionAssetFromRow, productionDatabaseError, type ProductionInternalAsset } from "./production-server";
import { PRODUCTION_BUCKET } from "./production-validation";
import { inspectProductionImage, normalizeProductionCorrection, productionHash, renderProductionCrop, renderProductionPreview } from "./production-renderer";
import type { ProductionAsset, ProductionAssetRegistration, ProductionOwnerAction, ProductionSize } from "./production-types";
import { LabError } from "./validation";
import { ZodError } from "zod";

type Service = LabOrderAccess["service"];
export const productionPrivateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow, noarchive" };
export function productionImageFailure(error: unknown) {
  const known = error instanceof LabError;
  const invalid = error instanceof ZodError;
  return Response.json({ ok: false, message: known ? error.message : invalid ? "Check the exact production file and print size." : "The private production file could not be prepared.", code: known ? error.code : invalid ? "PRODUCTION_INVALID" : "PRODUCTION_UNAVAILABLE" },
    { status: known ? error.status : invalid ? 400 : 503, headers: productionPrivateHeaders });
}
export function publicProductionAsset(a: ProductionAsset): ProductionAsset {
  return { id: a.id, kind: a.kind, filename: a.filename, sha256: a.sha256, byteSize: a.byteSize, widthPixels: a.widthPixels, heightPixels: a.heightPixels, contentType: a.contentType };
}
export async function productionBytes(service: Service, asset: ProductionInternalAsset): Promise<Buffer> {
  if (asset.storageKey !== `${asset.photographerId}/${asset.id}.${asset.contentType === "image/png" ? "png" : "jpg"}`) throw new LabError("The production file identity is invalid.", 409, "PRODUCTION_INTEGRITY");
  const result = await service.storage.from(PRODUCTION_BUCKET).download(asset.storageKey);
  if (result.error || !result.data || result.data.size !== asset.byteSize || result.data.size > 4_000_000) throw new LabError("The private production file is unavailable.", 503, "PRODUCTION_STORAGE");
  const bytes = Buffer.from(await result.data.arrayBuffer());
  if (productionHash(bytes) !== asset.sha256) throw new LabError("The production file failed its integrity check.", 409, "PRODUCTION_INTEGRITY");
  return bytes;
}
export async function productionPreview(service: Service, asset: ProductionInternalAsset | Record<string, unknown>): Promise<Buffer> {
  const internal = "storageKey" in asset ? asset as ProductionInternalAsset : productionAssetFromRow(asset);
  return renderProductionPreview(await productionBytes(service, internal));
}

async function uploadPrivate(service: Service, ownerId: string, document: ProductionAssetRegistration, bytes: Buffer) {
  const bucket = await service.storage.getBucket(PRODUCTION_BUCKET);
  if (bucket.error || bucket.data?.public !== false) throw new LabError("Private production storage is not ready.", 503, "PRODUCTION_STORAGE");
  const result = await service.storage.from(PRODUCTION_BUCKET).upload(document.storageKey, bytes, { contentType: document.contentType, cacheControl: "0", upsert: false });
  if (result.error) {
    // A deterministic crop retry may find its already uploaded object. Compare
    // all bytes; never overwrite an immutable render or accept a path collision.
    const existing = await service.storage.from(PRODUCTION_BUCKET).download(document.storageKey);
    if (existing.error || !existing.data) throw new LabError("The file upload did not complete. Retry the same request.", 503, "PRODUCTION_STORAGE");
    if (existing.data.size !== bytes.length || productionHash(Buffer.from(await existing.data.arrayBuffer())) !== document.sha256) {
      throw new LabError("This request already belongs to a different crop. Refresh and save again.", 409, "PRODUCTION_REQUEST_CONFLICT");
    }
  }
  return { ...document, photographerId: ownerId };
}

/** Remove only after an authoritative read proves the registration did not commit. */
async function reconcileRegistration(service: Service, document: ProductionAssetRegistration, error: {message?: string; code?: string} | null) {
  const stored = await service.from("lab_production_assets").select("*").eq("id", document.id).maybeSingle();
  if (!stored.error && stored.data) {
    const a = productionAssetFromRow(stored.data);
    if (Object.entries(document).every(([key, value]) => a[key as keyof ProductionInternalAsset] === value)) return a;
    throw new LabError("This production file identity already exists with different details.", 409, "PRODUCTION_REQUEST_CONFLICT");
  }
  if (!stored.error && !stored.data) await service.storage.from(PRODUCTION_BUCKET).remove([document.storageKey]).catch(() => undefined);
  productionDatabaseError(error || stored.error);
}

export async function uploadProductionAsset(access: LabOrderAccess, file: File, kind: "original" | "corrected", jobId?: string, size?: ProductionSize, reviewedCropId?: string) {
  let bytes: Buffer = Buffer.from(await file.arrayBuffer()), inspected = await inspectProductionImage(bytes);
  let ownerId = access.photographerId, sourceAssetId: string | null = null;
  if (kind === "original") {
    if (access.audience !== "studio" || !ownerId) throw new LabError("Upload originals from your photographer workspace.", 403, "PRODUCTION_FORBIDDEN");
  } else {
    if (!jobId || !size) throw new LabError("Choose the exact job and print size.", 400, "PRODUCTION_INVALID");
    const job = await loadProductionJob(access, jobId), line = job.lines.find(l => l.size === size);
    if (!job.canReceive || job.status !== "accepted" || !job.policy.labColourCorrection || !line?.cropAsset || !line.cropApproved) throw new LabError("Accept the job and approve its crop before uploading requested colour work.", 409, "PRODUCTION_HELD");
    if (reviewedCropId !== line.cropAsset.id) throw new LabError("The crop changed while colour work was being prepared. Download and review the current cropped file.", 409, "PRODUCTION_STALE_RENDER");
    if (inspected.widthPixels !== line.cropAsset.widthPixels || inspected.heightPixels !== line.cropAsset.heightPixels) throw new LabError("Colour work must keep the approved crop's exact pixel dimensions. Do not crop or resize it again.", 400, "PRODUCTION_GEOMETRY");
    const source = await loadProductionAsset(access, line.cropAsset.id);
    ownerId = source.photographerId; sourceAssetId = source.id;
    bytes = await normalizeProductionCorrection(bytes); inspected = await inspectProductionImage(bytes);
  }
  const id = randomUUID(), ext = inspected.contentType === "image/png" ? "png" : "jpg";
  const name = file.name.split(/[\\/]/).at(-1)?.replace(/[\x00-\x1f\x7f]/g, "").replace(/\.[^.]*$/, "").trim().slice(0, 160) || "photograph";
  const document: ProductionAssetRegistration = { ...inspected, id, kind, filename: `${name}.${ext}`, storageKey: `${ownerId}/${id}.${ext}`, jobId: kind === "corrected" ? jobId! : null, size: kind === "corrected" ? size! : null, sourceAssetId };
  await uploadPrivate(access.service, ownerId!, document, bytes);
  const registered = await access.service.rpc("register_lab_production_asset", { p_user_id: access.userId, p_document: document });
  const result = registered.error || !registered.data ? await reconcileRegistration(access.service, document, registered.error) : productionAssetFromRow(registered.data);
  return publicProductionAsset(result);
}

export async function saveProductionCrop(access: LabOrderAccess, action: Extract<ProductionOwnerAction, {action: "save_crop"}>) {
  const job = await loadProductionJob(access, action.jobId);
  if (!job.canCrop) throw new LabError("This job assigns cropping to the other workspace.", 403, "PRODUCTION_FORBIDDEN");
  const source = await loadProductionAsset(access, job.source.id);
  const bytes = await renderProductionCrop(await productionBytes(access.service, source), source, action.productSize, action.rect);
  // Stable object identity makes an unchanged retry safe after a lost response.
  const hex = createHash("sha256").update(`${access.userId}:${action.jobId}:${action.requestId}`).digest("hex").slice(0, 32);
  const id = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20)}`;
  const document: ProductionAssetRegistration = { ...await inspectProductionImage(bytes), id, kind: "crop", filename: `${action.productSize}-crop.jpg`, storageKey: `${source.photographerId}/${id}.jpg`, jobId: job.id, size: action.productSize, sourceAssetId: source.id };
  await uploadPrivate(access.service, source.photographerId, document, bytes);
  const saved = await access.service.rpc("save_lab_production_crop", { p_user_id: access.userId, p_job_id: job.id, p_expected_version: action.expectedVersion,
    p_request_id: action.requestId, p_size: action.productSize, p_crop: action.rect, p_asset_document: document });
  if (saved.error || !saved.data) {
    // A committed asset alone is insufficient proof that this job mutation
    // succeeded. Preserve it on uncertainty, report the RPC error, let retry reconcile.
    await reconcileRegistration(access.service, document, saved.error);
    productionDatabaseError(saved.error);
  }
  return { job: await loadProductionJob(access, job.id), replayed: saved.data.replayed === true };
}

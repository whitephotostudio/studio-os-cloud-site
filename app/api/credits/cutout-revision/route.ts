import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";
import { cleanOwnedCutoutStaging, CreditCutoutStagingError, readOwnedCutoutStaging } from "@/lib/credit-cutout-staging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_PIXELS = 64 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const response = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });

async function decodedCutout(bytes: Buffer) {
  const image = sharp(bytes, { limitInputPixels: MAX_PIXELS });
  const metadata = await image.metadata();
  if (metadata.format !== "png" || !metadata.hasAlpha || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) throw new Error("Invalid PNG");
  const alpha = (await image.stats()).channels.at(-1);
  if (!alpha || !Number.isFinite(alpha.min) || alpha.min >= 255 || !Number.isFinite(alpha.max) || alpha.max <= 0 || alpha.max > 255) throw new Error("Invalid subject");
  // Discard alpha only. Flattening would hide changed RGB under transparency
  // and allow another photo to be substituted behind an all-clear mask.
  const rgb = await image.toColourspace("srgb").removeAlpha().raw().toBuffer();
  return { width: metadata.width, height: metadata.height, rgb };
}

async function decodedSource(bytes: Buffer) {
  // Native Restore uses the authenticated original's pixels. EXIF rotation is
  // allowed, while resizing/reencoding aliases are deliberately unsupported.
  const result = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).rotate().toColourspace("srgb").removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: result.info.width, height: result.info.height, rgb: result.data };
}
function sourceRgbMatches(expected: Buffer, actual: Buffer) {
  if (expected.length !== actual.length) return false;
  for (let i = 0; i < expected.length; i++) if (Math.abs(expected[i] - actual[i]) > 4) return false;
  return true;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveDashboardAuth(request);
    if (!auth.user) return response("Please sign in to Studio OS.", 401);
    if (auth.mfaSatisfied === false) return response("Complete two-step verification before saving a cutout.", 403);
    if (Number(request.headers.get("content-length") || 0) > MAX_TOTAL_BYTES + 16 * 1024) {
      return response("Mask edits currently require PNGs smaller than 3 MB each and 4 MB together. Keep your original files for a larger-file workflow.", 413);
    }
    const staged = request.headers.get("content-type")?.includes("application/json") === true;
    let previousBytes: Buffer, editedBytes: Buffer, sourceBytes: Buffer | null = null;
    let originalValue: unknown, stagingKeys: unknown[] = [];
    if (staged) {
      const body = await request.json();
      if (!body || typeof body !== "object") return response("Invalid mask edit request.", 400);
      originalValue = body.original_sha256;
      stagingKeys = [body.previous_staging_key, body.staging_key, body.original_staging_key];
      previousBytes = await readOwnedCutoutStaging(auth.user.id, body.previous_staging_key);
      editedBytes = await readOwnedCutoutStaging(auth.user.id, body.staging_key);
      if (body.original_staging_key !== undefined && body.original_staging_key !== null) sourceBytes = await readOwnedCutoutStaging(auth.user.id, body.original_staging_key);
    } else {
      const form = await request.formData();
      const previous = form.get("previous_cutout"), edited = form.get("image_file"), original = form.get("original_file");
      originalValue = form.get("original_sha256");
      if (!(previous instanceof File) || !(edited instanceof File) || !previous.size || !edited.size || (original !== null && !(original instanceof File))) return response("The paid previous cutout and edited PNG are required.", 400);
      const files = original instanceof File ? [previous, edited, original] : [previous, edited];
      if (files.some(file => file.size > MAX_FILE_BYTES || !file.size) || files.reduce((size, file) => size + file.size, 0) > MAX_TOTAL_BYTES) return response("Use private upload staging for images larger than 3 MB each or 4 MB together.", 413);
      previousBytes = Buffer.from(await previous.arrayBuffer());
      editedBytes = Buffer.from(await edited.arrayBuffer());
      if (original instanceof File) sourceBytes = Buffer.from(await original.arrayBuffer());
    }
    const originalHash = originalValue === null || originalValue === undefined || originalValue === "" ? null : typeof originalValue === "string" ? originalValue.trim().toLowerCase() : "invalid";
    if (originalHash !== null && !SHA256.test(originalHash)) return response("The original photo reference is invalid.", 400);
    if (sourceBytes && (!originalHash || createHash("sha256").update(sourceBytes).digest("hex") !== originalHash)) return response("The original photo does not match the paid source reference. Keep your files for review.", 403);
    const previousHash = createHash("sha256").update(previousBytes).digest("hex");
    const cutoutHash = createHash("sha256").update(editedBytes).digest("hex");
    const service = createDashboardServiceClient();
    const proof = await service.rpc("has_studio_cutout_entitlement", { p_studio_id: auth.user.id,
      p_original_sha256: originalHash, p_cutout_sha256: previousHash });
    if (proof.error || proof.data !== true) return response("The previous cutout has no active paid access. Keep your files for review.", 403);
    let before, after, sourcePixels;
    try { before = await decodedCutout(previousBytes); after = await decodedCutout(editedBytes); if (sourceBytes) sourcePixels = await decodedSource(sourceBytes); }
    catch { return response("Use genuine transparent PNGs with a visible subject.", 400); }
    if (before.width !== after.width || before.height !== after.height || (sourcePixels
      ? sourcePixels.width !== after.width || sourcePixels.height !== after.height ||
        !sourceRgbMatches(sourcePixels.rgb, before.rgb) || !sourceRgbMatches(sourcePixels.rgb, after.rgb)
      : !before.rgb.equals(after.rgb))) {
      return response("Free cutout refinement can change only the transparency mask. Keep the paid photo's dimensions and color pixels unchanged.", 400);
    }
    // The service-only function rechecks active access under its wallet lock;
    // a cash refund between validation and registration must revoke access.
    const registered = await service.rpc("register_verified_cutout_revision", { p_studio_id: auth.user.id,
      p_original_sha256: originalHash, p_previous_cutout_sha256: previousHash, p_cutout_sha256: cutoutHash });
    if (registered.error || registered.data !== true) return response("Paid access changed before this mask edit could be saved. Keep your files for review.", 403);
    await cleanOwnedCutoutStaging(auth.user.id, stagingKeys);
    return NextResponse.json({ ok: true, previousCutoutSha256: previousHash, cutoutSha256: cutoutHash }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CreditCutoutStagingError) return response(error.message, 403);
    return response("The mask edit could not be verified. Keep your files and try again.", 503);
  }
}

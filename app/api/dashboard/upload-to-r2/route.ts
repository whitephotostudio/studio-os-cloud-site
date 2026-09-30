import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { r2Upload } from "@/lib/r2";
import { guardAgreement } from "@/lib/require-agreement";
import sharp from "sharp";
import { assertKeyOwnedByPhotographer } from "@/lib/upload-ownership";
import { createHash } from "node:crypto";
import { assertPaidCutoutUpload, CreditCutoutAccessError, isManagedCutoutKey, linkPaidCutoutObject, MAX_MANAGED_CUTOUT_BYTES } from "@/lib/credit-cutout-access";
import { cleanOwnedCutoutStaging, CreditCutoutStagingError, readOwnedCutoutStaging } from "@/lib/credit-cutout-staging";

export const runtime = "nodejs";
export const maxDuration = 120;

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function extensionOf(value: string | null | undefined) {
  const match = clean(value).toLowerCase().match(/\.([a-z0-9]+)$/i);
  return match?.[1] ?? "";
}

function withExtension(value: string, nextExtension: string) {
  const trimmed = clean(value);
  if (!trimmed) return trimmed;
  if (/\.[^.\/]+$/.test(trimmed)) {
    return trimmed.replace(/\.[^.\/]+$/, nextExtension);
  }
  return `${trimmed}${nextExtension}`;
}

function isProjectAlbumOriginalKey(key: string) {
  return /^projects\/[^/]+\/albums\/[^/]+\//i.test(clean(key));
}

function shouldNormalizeProjectUploadToJpeg(file: File, key: string) {
  if (!isProjectAlbumOriginalKey(key)) return false;
  const fileNameExtension = extensionOf(file.name);
  const mimeType = clean(file.type).toLowerCase();
  const keyExtension = extensionOf(key);

  return (
    fileNameExtension === "jpg" ||
    fileNameExtension === "jpeg" ||
    mimeType === "image/jpeg" ||
    mimeType === "image/jpg" ||
    keyExtension === "jpg" ||
    keyExtension === "jpeg"
  );
}

/**
 * Accepts a file upload via multipart form data and stores it in R2.
 * Returns the public URL and storage key.
 *
 * Form fields:
 *   file    — the file blob
 *   key     — the desired storage key (e.g. "projects/abc/albums/xyz/photo.jpg")
 */
export async function POST(request: NextRequest) {
  const auth = await resolveDashboardAuth(request);
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (auth.mfaSatisfied === false) return NextResponse.json({ error: "Complete two-step verification before uploading photos." }, { status: 403 });

  // Refuse uploads if the photographer hasn't accepted the current legal
  // agreement.  Stops a savvy user from bypassing the client-side modal
  // by calling the API directly with their session token.
  {
    const service = createDashboardServiceClient();
    const guard = await guardAgreement({ service, userId: auth.user.id });
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });
  }

  let file: File | null = null;
  let key: string, stagingKey: unknown, originalHashValue: unknown;
  try {
    if (request.headers.get("content-type")?.includes("application/json")) {
      if (Number(request.headers.get("content-length") || 0) > 4096) return NextResponse.json({ error: "Invalid upload request." }, { status: 400 });
      const body = await request.json();
      if (!body || typeof body.key !== "string" || !isManagedCutoutKey(body.key)) return NextResponse.json({ error: "Private staging is for cutout uploads only." }, { status: 400 });
      key = body.key; stagingKey = body.staging_key; originalHashValue = body.original_sha256;
    } else {
      const formData = await request.formData();
      const candidate = formData.get("file"), requestedKey = formData.get("key");
      if (!(candidate instanceof File) || typeof requestedKey !== "string" || !requestedKey) return NextResponse.json({ error: "file and key are required" }, { status: 400 });
      file = candidate; key = requestedKey; originalHashValue = formData.get("original_sha256");
      if (isManagedCutoutKey(clean(key)) && file.size > 3 * 1024 * 1024) return NextResponse.json({ error: "Use private upload staging for cutouts larger than 3 MB (up to 25 MB)." }, { status: 413 });
    }
  } catch { return NextResponse.json({ error: "Invalid upload request." }, { status: 400 }); }
  let uploadKey = clean(key);

  // Confirm the uploaded key lives inside a namespace this photographer owns.
  // Without this, any signed-in photographer could overwrite files belonging
  // to another studio by forging the `key` form field.
  try {
    const service = createDashboardServiceClient();
    const { data: photographerRow, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (photographerError || !photographerRow?.id) {
      return NextResponse.json(
        { error: "Photographer profile not found." },
        { status: 403 },
      );
    }

    const ownership = await assertKeyOwnedByPhotographer(
      service,
      photographerRow.id,
      uploadKey,
    );
    if (!ownership.ok) {
      console.warn(
        `[upload-to-r2] rejected key for photographer ${photographerRow.id}: ${ownership.reason}`,
      );
      return NextResponse.json(
        { error: "You cannot upload to that path." },
        { status: 403 },
      );
    }
  } catch (err) {
    console.error("R2 upload ownership check failed:", err);
    return NextResponse.json(
      { error: "Could not verify upload permissions." },
      { status: 500 },
    );
  }

  try {
    const originalHash = typeof originalHashValue === "string" ? originalHashValue.trim().toLowerCase() : "";
    if (isManagedCutoutKey(uploadKey) && !/^[a-f0-9]{64}$/.test(originalHash)) throw new CreditCutoutAccessError();
    const sourceBuffer = file ? Buffer.from(await file.arrayBuffer()) : await readOwnedCutoutStaging(auth.user.id, stagingKey);
    if (isManagedCutoutKey(uploadKey) && sourceBuffer.length > MAX_MANAGED_CUTOUT_BYTES) return NextResponse.json({ error: "Use a cutout smaller than 25 MB." }, { status: 413 });
    let uploadBuffer: Buffer | Uint8Array = sourceBuffer;
    let contentType = file?.type || "application/octet-stream";
    let cutoutHash: string | null = null;
    if (isManagedCutoutKey(uploadKey)) {
      try {
        const image = sharp(sourceBuffer, { limitInputPixels: 64 * 1024 * 1024 });
        const metadata = await image.metadata();
        if (metadata.format !== "png" || !metadata.hasAlpha || (metadata.pages ?? 1) !== 1) throw new Error("Invalid cutout");
        const alpha = (await image.stats()).channels.at(-1);
        if (!alpha || !Number.isFinite(alpha.min) || alpha.min >= 255 || !Number.isFinite(alpha.max) || alpha.max <= 0 || alpha.max > 255) throw new Error("Invalid cutout");
      } catch { return NextResponse.json({ error: "Upload a genuine transparent PNG with a visible subject." }, { status: 400 }); }
      cutoutHash = createHash("sha256").update(sourceBuffer).digest("hex");
      await assertPaidCutoutUpload(createDashboardServiceClient(), auth.user.id, originalHash, cutoutHash);
      contentType = "image/png";
    }
    if (file && shouldNormalizeProjectUploadToJpeg(file, uploadKey)) {
      const incomingMimeType = clean(file.type).toLowerCase();
      const incomingKeyExtension = extensionOf(uploadKey);
      uploadKey = withExtension(uploadKey, ".jpg");
      contentType = "image/jpeg";

      if (
        (incomingMimeType !== "image/jpeg" && incomingMimeType !== "image/jpg") ||
        incomingKeyExtension !== "jpg"
      ) {
        uploadBuffer = await sharp(sourceBuffer)
          .rotate()
          .jpeg({ quality: 92, mozjpeg: true })
          .toBuffer();
      }
    }

    const publicUrl = await r2Upload(uploadKey, uploadBuffer, contentType,
      cutoutHash ? "private, no-store" : "public, max-age=31536000", cutoutHash ? { allowVerifiedCutout: true } : undefined);
    if (cutoutHash) await linkPaidCutoutObject(createDashboardServiceClient(), auth.user.id, uploadKey, originalHash, cutoutHash);
    if (cutoutHash && !file) await cleanOwnedCutoutStaging(auth.user.id, [stagingKey]);
    return NextResponse.json({ ok: true, publicUrl, key: uploadKey, contentType });
  } catch (err) {
    if (err instanceof CreditCutoutAccessError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof CreditCutoutStagingError) return NextResponse.json({ error: err.message }, { status: 403 });
    console.error("R2 upload error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 },
    );
  }
}

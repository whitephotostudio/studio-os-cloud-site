import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { r2Upload } from "@/lib/r2";
import { guardAgreement } from "@/lib/require-agreement";
import sharp from "sharp";
import { assertKeyOwnedByPhotographer } from "@/lib/upload-ownership";

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

  // Refuse uploads if the photographer hasn't accepted the current legal
  // agreement.  Stops a savvy user from bypassing the client-side modal
  // by calling the API directly with their session token.
  {
    const service = createDashboardServiceClient();
    const guard = await guardAgreement({ service, userId: auth.user.id });
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const key = formData.get("key") as string | null;

  if (!file || !key) {
    return NextResponse.json(
      { error: "file and key are required" },
      { status: 400 },
    );
  }

  const sourceBuffer = Buffer.from(await file.arrayBuffer());
  let uploadBuffer: Buffer | Uint8Array = sourceBuffer;
  let uploadKey = clean(key);
  let contentType = file.type || "application/octet-stream";

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
    if (shouldNormalizeProjectUploadToJpeg(file, uploadKey)) {
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

    const publicUrl = await r2Upload(uploadKey, uploadBuffer, contentType);
    return NextResponse.json({ publicUrl, key: uploadKey, contentType });
  } catch (err) {
    console.error("R2 upload error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 },
    );
  }
}

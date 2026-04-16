import { NextRequest, NextResponse } from "next/server";
import { resolveDashboardAuth } from "@/lib/dashboard-auth";
import { r2Upload } from "@/lib/r2";
import sharp from "sharp";

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
  } catch (err: any) {
    console.error("R2 upload error:", err);
    return NextResponse.json(
      { error: err.message || "Upload failed" },
      { status: 500 },
    );
  }
}

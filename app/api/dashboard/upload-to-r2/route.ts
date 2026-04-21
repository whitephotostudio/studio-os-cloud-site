import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { r2Upload } from "@/lib/r2";
import sharp from "sharp";

type ServiceClient = ReturnType<typeof createDashboardServiceClient>;

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

/**
 * Verify the upload key is inside a namespace this photographer actually owns.
 *
 * Supported key shapes (all rooted at the photographer's own resources):
 *   - projects/{projectId}/...            → must own projects.id
 *   - backdrops/{backdropId-or-path}/...  → must own a backdrops row whose id
 *                                           or storage_path matches
 *   - {schoolId-or-localSchoolId}/...     → must own a schools row whose id or
 *                                           local_school_id matches the first
 *                                           segment
 *
 * Anything else (or a key that doesn't positively match an owned resource) is
 * rejected — callers cannot write outside their own namespace.
 */
async function assertKeyOwnedByPhotographer(
  service: ServiceClient,
  photographerId: string,
  rawKey: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const key = clean(rawKey);
  if (!key) return { ok: false, reason: "empty key" };
  if (key.includes("..") || key.startsWith("/")) {
    return { ok: false, reason: "invalid path" };
  }

  const segments = key.split("/").filter(Boolean);
  if (segments.length < 2) return { ok: false, reason: "key too short" };

  const first = segments[0];
  const second = segments[1];

  // projects/{projectId}/...
  if (first === "projects") {
    const { data } = await service
      .from("projects")
      .select("id")
      .eq("id", second)
      .eq("photographer_id", photographerId)
      .maybeSingle();
    return data?.id
      ? { ok: true }
      : { ok: false, reason: "project not owned by caller" };
  }

  // backdrops/...  — match by id (second segment is usually the backdrop id or
  // an opaque object name under the photographer's backdrop library).
  if (first === "backdrops") {
    const { data } = await service
      .from("backdrops")
      .select("id,storage_path")
      .eq("photographer_id", photographerId)
      .or(
        `id.eq.${second},storage_path.ilike.backdrops/${second}%,storage_path.ilike.backdrops/${second}/%`,
      )
      .limit(1)
      .maybeSingle();
    return data?.id
      ? { ok: true }
      : { ok: false, reason: "backdrop not owned by caller" };
  }

  // Otherwise treat the first segment as a schoolId or local_school_id this
  // photographer owns.
  const { data: schoolRow } = await service
    .from("schools")
    .select("id")
    .eq("photographer_id", photographerId)
    .or(`id.eq.${first},local_school_id.eq.${first}`)
    .limit(1)
    .maybeSingle();

  return schoolRow?.id
    ? { ok: true }
    : { ok: false, reason: "key does not map to a resource owned by caller" };
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
  } catch (err: any) {
    console.error("R2 upload error:", err);
    return NextResponse.json(
      { error: err.message || "Upload failed" },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";
import { guardAgreement } from "@/lib/require-agreement";
import { r2Download, r2Upload } from "@/lib/r2";
import sharp from "sharp";
import { assertKeyOwnedByPhotographer } from "@/lib/upload-ownership";

const GenerateThumbnailsBodySchema = z.object({
  storagePath: z.string().max(2000).optional(),
  key: z.string().max(2000).optional(),
});

type Size = { width: number; quality: number };

const SIZES: Record<string, Size> = {
  thumbnail: { width: 560, quality: 72 },
  preview: { width: 1600, quality: 84 },
};

export async function POST(request: NextRequest) {
  const auth = await resolveDashboardAuth(request);
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Block thumbnail gen for photographers who haven't accepted the legal
  // agreement — defense in depth behind the UI modal.
  {
    const service = createDashboardServiceClient();
    const guard = await guardAgreement({ service, userId: auth.user.id });
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });
  }

  const parsed = await parseJson(request, GenerateThumbnailsBodySchema);
  if (!parsed.ok) return parsed.response;
  const storageKey: string | undefined = parsed.data.storagePath || parsed.data.key;

  if (!storageKey || typeof storageKey !== "string") {
    return NextResponse.json(
      { error: "storagePath (or key) is required" },
      { status: 400 },
    );
  }

  // Confirm this photographer is allowed to touch that storage key.  Without
  // this check, any signed-in user could ask us to download and re-process
  // any object in R2, including another studio's originals.
  try {
    const service = createDashboardServiceClient();
    const { data: photographerRow, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (photographerError) throw photographerError;
    if (!photographerRow?.id) {
      return NextResponse.json(
        { error: "Photographer profile not found." },
        { status: 403 },
      );
    }

    const ownership = await assertKeyOwnedByPhotographer(
      service,
      photographerRow.id,
      storageKey,
    );
    if (!ownership.ok) {
      console.warn(
        `[generate-thumbnails] rejected key for photographer ${photographerRow.id}: ${storageKey}`,
      );
      return NextResponse.json(
        { error: "You cannot generate thumbnails for that path." },
        { status: 403 },
      );
    }
  } catch (err) {
    console.error("generate-thumbnails ownership check failed:", err);
    return NextResponse.json(
      { error: "Could not verify thumbnail permissions." },
      { status: 500 },
    );
  }

  // Download the original image from R2
  let buffer: Buffer;
  try {
    buffer = await r2Download(storageKey);
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error:
          err instanceof Error && err.message
            ? err.message
            : "Failed to download original from R2",
      },
      { status: 500 },
    );
  }

  const results: Record<string, string> = {};

  for (const [label, size] of Object.entries(SIZES)) {
    try {
      const resized = await sharp(buffer)
        .resize({ width: size.width, withoutEnlargement: true, fit: "inside" })
        .jpeg({ quality: size.quality, mozjpeg: true })
        .toBuffer();

      const basePath = storageKey.replace(/\.[^.]+$/, "");
      const resizedKey = `${basePath}_${label}.jpg`;

      const objectReference = await r2Upload(resizedKey, resized, "image/jpeg");
      results[`${label}Key`] = resizedKey;
      results[`${label}Url`] = objectReference;
    } catch (err) {
      console.error(`Sharp error for ${label}:`, err);
    }
  }

  // If sharp failed for either label, fall back to the original object key so
  // callers never write NULL into media.preview_url / media.thumbnail_url.
  // Storing NULL there breaks gallery rendering (buildStoredMediaUrls only
  // treats empty string as "missing", not NULL).
  const originalReference = storageKey;
  return NextResponse.json({
    thumbnailKey: results.thumbnailKey || storageKey,
    previewKey: results.previewKey || storageKey,
    thumbnailUrl: results.thumbnailUrl || originalReference,
    previewUrl: results.previewUrl || originalReference,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";
import { r2Download, r2Upload, r2PublicUrl } from "@/lib/r2";
import sharp from "sharp";

const GenerateThumbnailsBodySchema = z.object({
  storagePath: z.string().max(2000).optional(),
  key: z.string().max(2000).optional(),
});

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

async function photographerOwnsKey(
  service: ReturnType<typeof createDashboardServiceClient>,
  photographerId: string,
  rawKey: string,
): Promise<boolean> {
  const key = clean(rawKey);
  if (!key || key.includes("..") || key.startsWith("/")) return false;
  const segments = key.split("/").filter(Boolean);
  if (segments.length < 2) return false;

  const [first, second] = segments;

  if (first === "projects") {
    const { data } = await service
      .from("projects")
      .select("id")
      .eq("id", second)
      .eq("photographer_id", photographerId)
      .maybeSingle();
    return !!data?.id;
  }

  // backdrops/{photographerId}/...  — authorize purely on path shape; the
  // frontend always writes uploads under the photographer's own id, and the
  // previous DB lookup targeted a non-existent `backdrops` table.
  if (first === "backdrops") {
    return second === photographerId;
  }

  const { data } = await service
    .from("schools")
    .select("id")
    .eq("photographer_id", photographerId)
    .or(`id.eq.${first},local_school_id.eq.${first}`)
    .limit(1)
    .maybeSingle();
  return !!data?.id;
}

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
    const { data: photographerRow } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (!photographerRow?.id) {
      return NextResponse.json(
        { error: "Photographer profile not found." },
        { status: 403 },
      );
    }

    const allowed = await photographerOwnsKey(
      service,
      photographerRow.id,
      storageKey,
    );
    if (!allowed) {
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
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to download original from R2" },
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

      const publicUrl = await r2Upload(resizedKey, resized, "image/jpeg");
      results[`${label}Url`] = publicUrl;
    } catch (err) {
      console.error(`Sharp error for ${label}:`, err);
    }
  }

  // If sharp failed for either label, fall back to the original object URL so
  // callers never write NULL into media.preview_url / media.thumbnail_url.
  // Storing NULL there breaks gallery rendering (buildStoredMediaUrls only
  // treats empty string as "missing", not NULL).
  const originalUrl = r2PublicUrl(storageKey);
  return NextResponse.json({
    thumbnailUrl: results.thumbnailUrl || originalUrl || null,
    previewUrl: results.previewUrl || originalUrl || null,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { resolveDashboardAuth } from "@/lib/dashboard-auth";
import { r2Download, r2Upload } from "@/lib/r2";
import sharp from "sharp";

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

  const body = await request.json();
  const storageKey: string | undefined = body.storagePath || body.key;

  if (!storageKey || typeof storageKey !== "string") {
    return NextResponse.json(
      { error: "storagePath (or key) is required" },
      { status: 400 },
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

  return NextResponse.json({
    thumbnailUrl: results.thumbnailUrl || null,
    previewUrl: results.previewUrl || null,
  });
}

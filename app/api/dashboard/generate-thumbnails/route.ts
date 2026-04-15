import { NextRequest, NextResponse } from "next/server";
import { resolveDashboardAuth, createDashboardServiceClient } from "@/lib/dashboard-auth";
import sharp from "sharp";

const MEDIA_BUCKET = "thumbs";

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
  const storagePath: string | undefined = body.storagePath;

  if (!storagePath || typeof storagePath !== "string") {
    return NextResponse.json(
      { error: "storagePath is required" },
      { status: 400 },
    );
  }

  const supabase = createDashboardServiceClient();

  // Download the original image from storage
  const { data: fileData, error: downloadError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .download(storagePath);

  if (downloadError || !fileData) {
    return NextResponse.json(
      { error: downloadError?.message || "Failed to download original" },
      { status: 500 },
    );
  }

  const buffer = Buffer.from(await fileData.arrayBuffer());
  const results: Record<string, string> = {};

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(
    /\/$/,
    "",
  );

  for (const [label, size] of Object.entries(SIZES)) {
    try {
      const resized = await sharp(buffer)
        .resize({ width: size.width, withoutEnlargement: true, fit: "inside" })
        .jpeg({ quality: size.quality, mozjpeg: true })
        .toBuffer();

      // Store resized version alongside original with a prefix
      const ext = storagePath.split(".").pop() || "jpg";
      const basePath = storagePath.replace(/\.[^.]+$/, "");
      const resizedPath = `${basePath}_${label}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(resizedPath, resized, {
          cacheControl: "31536000",
          upsert: true,
          contentType: "image/jpeg",
        });

      if (uploadError) {
        console.error(`Failed to upload ${label}:`, uploadError.message);
        continue;
      }

      // Return the direct public URL (no transforms needed!)
      const encodedPath = resizedPath
        .split("/")
        .filter(Boolean)
        .map((s) => encodeURIComponent(s))
        .join("/");
      results[`${label}Url`] =
        `${supabaseUrl}/storage/v1/object/public/${MEDIA_BUCKET}/${encodedPath}`;
    } catch (err) {
      console.error(`Sharp error for ${label}:`, err);
    }
  }

  return NextResponse.json({
    thumbnailUrl: results.thumbnailUrl || null,
    previewUrl: results.previewUrl || null,
  });
}

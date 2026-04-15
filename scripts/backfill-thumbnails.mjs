#!/usr/bin/env node
/**
 * Backfill script: generates pre-sized thumbnails for existing media rows
 * that still point to Supabase Image Transformation URLs (/render/image/).
 *
 * Usage:
 *   node scripts/backfill-thumbnails.mjs
 *
 * Requires env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * You can run this with: npx dotenv -e .env.local -- node scripts/backfill-thumbnails.mjs
 */

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MEDIA_BUCKET = "thumbs";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SIZES = {
  thumbnail: { width: 560, quality: 72 },
  preview: { width: 1600, quality: 84 },
};

function encodeStoragePath(path) {
  return path
    .split("/")
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join("/");
}

function publicUrl(storagePath) {
  return `${SUPABASE_URL}/storage/v1/object/public/${MEDIA_BUCKET}/${encodeStoragePath(storagePath)}`;
}

async function generateAndUpload(storagePath) {
  const { data: fileData, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .download(storagePath);

  if (error || !fileData) {
    console.error(`  ✗ Download failed: ${error?.message || "no data"}`);
    return null;
  }

  const buffer = Buffer.from(await fileData.arrayBuffer());
  const results = {};

  for (const [label, size] of Object.entries(SIZES)) {
    try {
      const resized = await sharp(buffer)
        .resize({ width: size.width, withoutEnlargement: true, fit: "inside" })
        .jpeg({ quality: size.quality, mozjpeg: true })
        .toBuffer();

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
        console.error(`  ✗ Upload ${label} failed: ${uploadError.message}`);
        continue;
      }

      results[`${label}Url`] = publicUrl(resizedPath);
    } catch (err) {
      console.error(`  ✗ Sharp error for ${label}: ${err.message}`);
    }
  }

  return results;
}

async function main() {
  console.log("Fetching media rows with transform URLs...\n");

  // Find all media rows whose thumbnail or preview URLs use /render/image/
  const { data: rows, error } = await supabase
    .from("media")
    .select("id, storage_path, thumbnail_url, preview_url")
    .or(
      `thumbnail_url.like.%/render/image/%,preview_url.like.%/render/image/%`,
    )
    .not("storage_path", "is", null);

  if (error) {
    console.error("Query error:", error.message);
    process.exit(1);
  }

  console.log(`Found ${rows.length} media rows to backfill.\n`);

  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    const path = row.storage_path;
    if (!path) continue;

    process.stdout.write(`[${updated + failed + 1}/${rows.length}] ${path} ... `);

    const results = await generateAndUpload(path);
    if (!results || (!results.thumbnailUrl && !results.previewUrl)) {
      console.log("SKIP");
      failed++;
      continue;
    }

    const updatePayload = {};
    if (results.thumbnailUrl) updatePayload.thumbnail_url = results.thumbnailUrl;
    if (results.previewUrl) updatePayload.preview_url = results.previewUrl;

    const { error: updateError } = await supabase
      .from("media")
      .update(updatePayload)
      .eq("id", row.id);

    if (updateError) {
      console.log(`DB UPDATE FAILED: ${updateError.message}`);
      failed++;
    } else {
      console.log("OK");
      updated++;
    }
  }

  console.log(`\nDone! Updated: ${updated}, Failed: ${failed}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

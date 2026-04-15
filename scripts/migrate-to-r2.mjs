#!/usr/bin/env node
/**
 * Migration script: copies all photos from Supabase Storage to Cloudflare R2,
 * generates thumbnails, and updates the database URLs.
 *
 * Usage:
 *   npx dotenv -e .env.local -- node scripts/migrate-to-r2.mjs
 *
 * Requires env vars:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

// ── Config ──
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET_NAME || "whitephoto-media";
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");
const MEDIA_BUCKET = "thumbs";

for (const [name, val] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_PUBLIC_URL,
})) {
  if (!val) { console.error(`Missing env: ${name}`); process.exit(1); }
}

// ── Clients ──
const supabase = createSupabaseClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const SIZES = {
  thumbnail: { width: 560, quality: 72 },
  preview: { width: 1600, quality: 84 },
};

function encodeKey(key) {
  return key.split("/").filter(Boolean).map(s => encodeURIComponent(s)).join("/");
}

function r2PublicUrl(key) {
  return `${R2_PUBLIC_URL}/${encodeKey(key)}`;
}

async function uploadToR2(key, buffer, contentType) {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: "public, max-age=31536000",
  }));
  return r2PublicUrl(key);
}

async function processRow(row) {
  const path = row.storage_path;
  if (!path) return null;

  // Download original from Supabase
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).download(path);
  if (error || !data) {
    console.error(`  ✗ Download failed: ${error?.message || "no data"}`);
    return null;
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  const contentType = row.mime_type || "image/jpeg";

  // Upload original to R2
  const originalUrl = await uploadToR2(path, buffer, contentType);

  // Generate and upload thumbnails
  const results = { originalUrl };
  for (const [label, size] of Object.entries(SIZES)) {
    try {
      const resized = await sharp(buffer)
        .resize({ width: size.width, withoutEnlargement: true, fit: "inside" })
        .jpeg({ quality: size.quality, mozjpeg: true })
        .toBuffer();

      const basePath = path.replace(/\.[^.]+$/, "");
      const resizedKey = `${basePath}_${label}.jpg`;
      results[`${label}Url`] = await uploadToR2(resizedKey, resized, "image/jpeg");
    } catch (err) {
      console.error(`  ✗ Sharp ${label}: ${err.message}`);
    }
  }

  return results;
}

async function main() {
  console.log("Fetching media rows...\n");

  // Get all media rows that still point to Supabase URLs
  const { data: rows, error } = await supabase
    .from("media")
    .select("id, storage_path, mime_type, thumbnail_url, preview_url")
    .not("storage_path", "is", null)
    .or(`thumbnail_url.like.%supabase%,preview_url.like.%supabase%,thumbnail_url.is.null,preview_url.is.null`);

  if (error) {
    console.error("Query error:", error.message);
    process.exit(1);
  }

  console.log(`Found ${rows.length} media rows to migrate.\n`);

  let migrated = 0;
  let failed = 0;

  for (const row of rows) {
    process.stdout.write(`[${migrated + failed + 1}/${rows.length}] ${row.storage_path} ... `);

    const results = await processRow(row);
    if (!results) {
      console.log("SKIP");
      failed++;
      continue;
    }

    const updatePayload = {};
    if (results.thumbnailUrl) updatePayload.thumbnail_url = results.thumbnailUrl;
    if (results.previewUrl) updatePayload.preview_url = results.previewUrl;

    if (Object.keys(updatePayload).length) {
      const { error: updateError } = await supabase
        .from("media")
        .update(updatePayload)
        .eq("id", row.id);

      if (updateError) {
        console.log(`DB UPDATE FAILED: ${updateError.message}`);
        failed++;
        continue;
      }
    }

    console.log("OK");
    migrated++;
  }

  console.log(`\nDone! Migrated: ${migrated}, Failed: ${failed}`);
  console.log("\nExisting photos are now on R2. New uploads already go to R2 via the code changes.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

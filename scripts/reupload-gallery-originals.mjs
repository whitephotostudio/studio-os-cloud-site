#!/usr/bin/env node
/**
 * Re-upload full-resolution originals for a gallery whose desktop-app upload
 * registered preview-sized files as the "original".
 *
 * For each file in --source:
 *   1. Match to a media row by filename (within --project-id).
 *   2. Upload the original to R2 at a normalized .jpg key.
 *   3. Generate 1600px preview + 560px thumbnail and upload those.
 *   4. Update the media row's storage_path, mime_type, preview_url, thumbnail_url.
 *   5. (optional) Delete the old key from R2.
 *
 * Usage:
 *   npx dotenv -e .env.local -- node scripts/reupload-gallery-originals.mjs \
 *     --project-id <UUID> \
 *     --source "/absolute/path/to/originals/folder" \
 *     [--limit N] [--dry-run] [--delete-old]
 *
 * Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *               R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *               R2_BUCKET_NAME, R2_PUBLIC_URL
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

// ── CLI args ──
const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i >= 0;
}
function arg(name, fallback = null) {
  const i = args.indexOf(name);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  return fallback;
}

const PROJECT_ID = arg("--project-id");
const SOURCE = arg("--source");
const LIMIT = parseInt(arg("--limit", "0"), 10) || 0;
const DRY_RUN = flag("--dry-run");
const DELETE_OLD = flag("--delete-old");

if (!PROJECT_ID || !SOURCE) {
  console.error("Usage: node scripts/reupload-gallery-originals.mjs --project-id <UUID> --source <path> [--limit N] [--dry-run] [--delete-old]");
  process.exit(1);
}

// ── Config ──
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET_NAME || "whitephoto-media";
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");

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
function withExtension(key, ext) {
  return key.replace(/\.[^.\/]+$/, ext);
}

async function uploadToR2(key, buffer, contentType) {
  if (DRY_RUN) return r2PublicUrl(key);
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: "public, max-age=31536000",
  }));
  return r2PublicUrl(key);
}

async function deleteFromR2(key) {
  if (DRY_RUN) return;
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch (err) {
    console.warn(`    (warn) failed to delete old key ${key}: ${err.message}`);
  }
}

// ── Match local filename → DB row ──
function normalizeName(name) {
  return name.toLowerCase().trim();
}

async function main() {
  console.log(`\nProject:     ${PROJECT_ID}`);
  console.log(`Source:      ${SOURCE}`);
  console.log(`Mode:        ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`Delete old:  ${DELETE_OLD ? "yes" : "no"}`);
  if (LIMIT) console.log(`Limit:       ${LIMIT}`);
  console.log("");

  // 1. Read source folder
  let entries;
  try {
    entries = await readdir(SOURCE, { withFileTypes: true });
  } catch (err) {
    console.error(`Cannot read source folder: ${err.message}`);
    process.exit(1);
  }
  const localFiles = entries
    .filter((e) => e.isFile() && /\.(jpe?g|png)$/i.test(e.name))
    .map((e) => ({ name: e.name, path: path.join(SOURCE, e.name) }));

  console.log(`Found ${localFiles.length} image files in source folder.`);

  // 2. Load DB rows for project
  const { data: rows, error: rowsError } = await supabase
    .from("media")
    .select("id, project_id, collection_id, storage_path, filename, mime_type, preview_url, thumbnail_url")
    .eq("project_id", PROJECT_ID);
  if (rowsError) {
    console.error("DB query failed:", rowsError.message);
    process.exit(1);
  }
  console.log(`Loaded ${rows.length} media rows from DB for this project.\n`);

  // 3. Index DB rows by normalized filename
  const rowsByName = new Map();
  for (const row of rows) {
    if (row.filename) {
      rowsByName.set(normalizeName(row.filename), row);
    }
  }

  // 4. For each local file, find DB row + process
  const filesToProcess = LIMIT > 0 ? localFiles.slice(0, LIMIT) : localFiles;
  let ok = 0, skipped = 0, failed = 0;

  for (let i = 0; i < filesToProcess.length; i++) {
    const file = filesToProcess[i];
    const counter = `[${i + 1}/${filesToProcess.length}]`;
    const row = rowsByName.get(normalizeName(file.name));

    if (!row) {
      console.log(`${counter} ${file.name}  →  SKIP (no DB row matched)`);
      skipped++;
      continue;
    }

    try {
      const localBuffer = await readFile(file.path);
      const localStat = await stat(file.path);

      // Build new storage key — keep original folder, but normalize extension to .jpg
      const newKey = withExtension(row.storage_path, ".jpg");

      // Re-encode the original to clean JPEG (preserve EXIF), upload at full res.
      // q90 mozjpeg gives ~25% smaller files than q95 with no visible quality loss
      // at any print size up to 20x30 (native 5472x3648 = 182 DPI at 20x30).
      const originalBuffer = await sharp(localBuffer)
        .rotate() // honor EXIF orientation
        .jpeg({ quality: 90, mozjpeg: true })
        .withMetadata()
        .toBuffer();

      const originalUrl = await uploadToR2(newKey, originalBuffer, "image/jpeg");

      // Generate preview (1600px) and thumbnail (560px)
      const basePath = newKey.replace(/\.[^.]+$/, "");
      const previewKey = `${basePath}_preview.jpg`;
      const thumbKey = `${basePath}_thumbnail.jpg`;

      const previewBuf = await sharp(localBuffer)
        .rotate()
        .resize({ width: SIZES.preview.width, withoutEnlargement: true, fit: "inside" })
        .jpeg({ quality: SIZES.preview.quality, mozjpeg: true })
        .toBuffer();
      const previewUrl = await uploadToR2(previewKey, previewBuf, "image/jpeg");

      const thumbBuf = await sharp(localBuffer)
        .rotate()
        .resize({ width: SIZES.thumbnail.width, withoutEnlargement: true, fit: "inside" })
        .jpeg({ quality: SIZES.thumbnail.quality, mozjpeg: true })
        .toBuffer();
      const thumbnailUrl = await uploadToR2(thumbKey, thumbBuf, "image/jpeg");

      // Update DB row
      const updatePayload = {
        storage_path: newKey,
        mime_type: "image/jpeg",
        preview_url: previewUrl,
        thumbnail_url: thumbnailUrl,
      };

      if (!DRY_RUN) {
        const { error: updateError } = await supabase
          .from("media")
          .update(updatePayload)
          .eq("id", row.id);
        if (updateError) throw new Error(`DB update: ${updateError.message}`);
      }

      // Optionally delete old .png file
      if (DELETE_OLD && row.storage_path && row.storage_path !== newKey) {
        await deleteFromR2(row.storage_path);
      }

      const sizeMB = (localStat.size / 1024 / 1024).toFixed(1);
      console.log(`${counter} ${file.name}  →  OK  (${sizeMB} MB original, key=${path.basename(newKey)})`);
      ok++;
    } catch (err) {
      console.error(`${counter} ${file.name}  →  FAIL: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. OK: ${ok}, skipped: ${skipped}, failed: ${failed}.`);
  if (DRY_RUN) console.log("(Dry run — no writes were made.)");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

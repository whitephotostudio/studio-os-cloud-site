#!/usr/bin/env node
/**
 * Compression script: finds all original photos older than 3 years and
 * re-encodes them at FULL RESOLUTION with optimized JPEG compression (90%
 * mozjpeg quality) to save R2 storage without losing image dimensions.
 *
 * The original pixel dimensions are preserved — only the file encoding is
 * optimized.  Typical savings: 40-50% (e.g. 16 MB → 8-10 MB).
 *
 * Thumbnails and previews are left untouched — only originals are compressed.
 * A "compressed_at" timestamp is written to the media row so photos are never
 * re-processed.
 *
 * Usage:
 *   npx dotenv -e .env.local -- node scripts/compress-old-photos.mjs
 *
 * Options:
 *   --dry-run    Show what would be compressed without actually doing it
 *
 * Requires env vars:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

const DRY_RUN = process.argv.includes("--dry-run");

// ── Config ──
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET_NAME || "whitephoto-media";
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");

// Compression settings — full resolution, just optimized encoding
// 90% mozjpeg is visually identical to the original but ~40-50% smaller file size
const COMPRESS_QUALITY = 90;

// Only compress photos older than this many days (3 years)
const AGE_DAYS = 365 * 3;

for (const [name, val] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_PUBLIC_URL,
})) {
  if (!val) {
    console.error(`Missing env: ${name}`);
    process.exit(1);
  }
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

async function downloadFromR2(key) {
  const res = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  const stream = res.Body;
  if (!stream) throw new Error("Empty body");
  const bytes = await stream.transformToByteArray();
  return Buffer.from(bytes);
}

async function uploadToR2(key, buffer, contentType) {
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000",
    }),
  );
}

async function compressPhoto(row) {
  const path = row.storage_path;
  if (!path) return null;

  try {
    // Download original from R2
    const buffer = await downloadFromR2(path);
    const originalSize = buffer.length;

    // Get image metadata
    const metadata = await sharp(buffer).metadata();
    const originalWidth = metadata.width || 0;

    // Skip if already small (under 1 MB — likely already optimized)
    if (originalSize < 1_000_000) {
      return { skipped: true, reason: "already small" };
    }

    // Re-encode at full resolution with optimized mozjpeg compression
    // No resizing — keeps the exact same pixel dimensions
    const compressed = await sharp(buffer)
      .jpeg({ quality: COMPRESS_QUALITY, mozjpeg: true })
      .toBuffer();

    const newSize = compressed.length;
    const savings = originalSize - newSize;
    const savingsPercent = ((savings / originalSize) * 100).toFixed(1);

    // Only replace if we actually save space (at least 10%)
    if (savings < originalSize * 0.1) {
      return { skipped: true, reason: "minimal savings" };
    }

    if (!DRY_RUN) {
      // Upload compressed version, replacing the original
      await uploadToR2(path, compressed, "image/jpeg");

      // Mark as compressed in the database
      await supabase
        .from("media")
        .update({ compressed_at: new Date().toISOString() })
        .eq("id", row.id);
    }

    return {
      compressed: true,
      originalSize,
      newSize,
      savings,
      savingsPercent,
      originalWidth,
      newWidth: originalWidth, // same — no resizing
    };
  } catch (err) {
    console.error(`  ✗ Error: ${err.message}`);
    return { error: err.message };
  }
}

async function main() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - AGE_DAYS);
  const cutoff = cutoffDate.toISOString();

  console.log(`\n📸 Photo Compression Script`);
  console.log(`   Target: photos older than ${Math.round(AGE_DAYS / 365)} years (before ${cutoff.split("T")[0]})`);
  console.log(`   Settings: FULL resolution, ${COMPRESS_QUALITY}% mozjpeg quality (visually identical)`);
  if (DRY_RUN) console.log(`   🔍 DRY RUN — no changes will be made\n`);
  else console.log();

  // Find all original photos older than 1 year that haven't been compressed yet
  const { data: rows, error } = await supabase
    .from("media")
    .select("id, storage_path, mime_type, created_at, compressed_at")
    .not("storage_path", "is", null)
    .is("compressed_at", null)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Query error:", error.message);
    process.exit(1);
  }

  // Filter out thumbnails and previews — only compress originals
  const originals = rows.filter(
    (r) => r.storage_path && !r.storage_path.includes("_thumbnail") && !r.storage_path.includes("_preview"),
  );

  console.log(`Found ${originals.length} original photos to process.\n`);

  if (originals.length === 0) {
    console.log("Nothing to compress. All photos are either recent or already compressed.");
    return;
  }

  let compressed = 0;
  let skipped = 0;
  let errors = 0;
  let totalSaved = 0;

  for (let i = 0; i < originals.length; i++) {
    const row = originals[i];
    process.stdout.write(
      `[${i + 1}/${originals.length}] ${row.storage_path} ... `,
    );

    const result = await compressPhoto(row);

    if (!result || result.error) {
      console.log("ERROR");
      errors++;
    } else if (result.skipped) {
      console.log(`SKIP (${result.reason})`);
      skipped++;
    } else if (result.compressed) {
      const origMB = (result.originalSize / 1024 / 1024).toFixed(1);
      const newMB = (result.newSize / 1024 / 1024).toFixed(1);
      console.log(
        `${DRY_RUN ? "WOULD COMPRESS" : "OK"} ${origMB}MB → ${newMB}MB (saved ${result.savingsPercent}%)`,
      );
      compressed++;
      totalSaved += result.savings;
    }
  }

  const totalSavedMB = (totalSaved / 1024 / 1024).toFixed(1);
  const totalSavedGB = (totalSaved / 1024 / 1024 / 1024).toFixed(2);

  console.log(`\n✅ Done!`);
  console.log(`   Compressed: ${compressed}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Errors: ${errors}`);
  console.log(`   Total space saved: ${totalSavedMB} MB (${totalSavedGB} GB)`);
  if (DRY_RUN) console.log(`\n   This was a dry run. Run without --dry-run to apply changes.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

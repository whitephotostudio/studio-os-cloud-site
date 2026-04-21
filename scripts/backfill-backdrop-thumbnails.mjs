#!/usr/bin/env node
/**
 * Backfill script: generates pre-sized 560px thumbnails for existing
 * backdrop_catalog rows whose thumbnail_url still points at the full-res
 * Supabase Storage original.
 *
 * The parents page backdrop picker renders `thumbnail_url || image_url`
 * (see app/parents/[pin]/page.tsx), so lowering thumbnail_url to a real
 * 560px JPEG makes the grid load dramatically faster without touching
 * image_url (which the composite renderer relies on for full resolution).
 *
 * Usage:
 *   npx dotenv -e .env.local -- node scripts/backfill-backdrop-thumbnails.mjs
 *   npx dotenv -e .env.local -- node scripts/backfill-backdrop-thumbnails.mjs --dry-run
 *   npx dotenv -e .env.local -- node scripts/backfill-backdrop-thumbnails.mjs --photographer <id>
 *
 * Requires env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const photographerIndex = args.indexOf("--photographer");
const PHOTOGRAPHER_FILTER =
  photographerIndex >= 0 && args[photographerIndex + 1]
    ? args[photographerIndex + 1]
    : null;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const THUMB_WIDTH = 560;
const THUMB_QUALITY = 72;

const PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/`;

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Parse a Supabase public URL into { bucket, path }.
 * Returns null if the URL doesn't match the expected pattern.
 */
function parseSupabasePublicUrl(url) {
  if (typeof url !== "string") return null;
  if (!url.startsWith(PUBLIC_PREFIX)) return null;
  const remainder = url.slice(PUBLIC_PREFIX.length).split("?")[0];
  const firstSlash = remainder.indexOf("/");
  if (firstSlash <= 0) return null;
  const bucket = safeDecode(remainder.slice(0, firstSlash));
  const path = safeDecode(remainder.slice(firstSlash + 1));
  if (!bucket || !path) return null;
  return { bucket, path };
}

function isAlreadyThumbnailed(url) {
  return typeof url === "string" && /_thumbnail\.jpe?g(\?.*)?$/i.test(url);
}

function thumbnailPathFor(originalPath) {
  // Strip the existing extension and append _thumbnail.jpg.
  return originalPath.replace(/\.[^./]+$/, "") + "_thumbnail.jpg";
}

function publicUrlFor(bucket, path) {
  const encodedPath = path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${encodedPath}`;
}

async function generateAndUpload(bucket, storagePath) {
  const { data: fileData, error } = await supabase.storage
    .from(bucket)
    .download(storagePath);
  if (error || !fileData) {
    throw new Error(`download failed: ${error?.message || "no data"}`);
  }
  const sourceBuffer = Buffer.from(await fileData.arrayBuffer());

  const resized = await sharp(sourceBuffer)
    .rotate()
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true, fit: "inside" })
    .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
    .toBuffer();

  const outPath = thumbnailPathFor(storagePath);
  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(outPath, resized, {
      cacheControl: "31536000",
      upsert: true,
      contentType: "image/jpeg",
    });
  if (upErr) throw new Error(`upload failed: ${upErr.message}`);

  return publicUrlFor(bucket, outPath);
}

async function main() {
  console.log("Backfilling backdrop thumbnails (Supabase Storage)...");
  console.log(`Using SUPABASE_URL=${SUPABASE_URL}`);
  if (DRY_RUN) console.log("DRY RUN — no uploads or DB updates will occur.");
  if (PHOTOGRAPHER_FILTER)
    console.log(`Filtering to photographer_id=${PHOTOGRAPHER_FILTER}`);
  console.log();

  let query = supabase
    .from("backdrop_catalog")
    .select("id, name, photographer_id, image_url, thumbnail_url")
    .eq("active", true);
  if (PHOTOGRAPHER_FILTER)
    query = query.eq("photographer_id", PHOTOGRAPHER_FILTER);

  const { data: rows, error } = await query;
  if (error) {
    console.error("Query error:", error.message);
    process.exit(1);
  }

  const candidates = [];
  const skipped = [];

  for (const row of rows ?? []) {
    if (isAlreadyThumbnailed(row.thumbnail_url)) {
      skipped.push({ row, reason: "already has _thumbnail.jpg" });
      continue;
    }
    const parsed = parseSupabasePublicUrl(row.thumbnail_url);
    if (!parsed) {
      skipped.push({
        row,
        reason: `thumbnail_url not parseable as Supabase public URL`,
      });
      continue;
    }
    candidates.push({ row, parsed });
  }

  console.log(
    `Found ${candidates.length} backdrop(s) needing a thumbnail (of ${rows?.length ?? 0} total).`,
  );
  if (skipped.length) {
    console.log(
      `Skipped ${skipped.length} row(s) that already look fine or don't match the Supabase pattern.`,
    );
  }
  console.log();

  if (!candidates.length) {
    console.log("Nothing to do.");
    return;
  }

  let ok = 0;
  let fail = 0;

  for (let i = 0; i < candidates.length; i++) {
    const { row, parsed } = candidates[i];
    const label = `[${i + 1}/${candidates.length}] ${row.name || row.id}`;
    process.stdout.write(`${label} ... `);

    if (DRY_RUN) {
      console.log(
        `would generate ${parsed.bucket}/${thumbnailPathFor(parsed.path)}`,
      );
      ok++;
      continue;
    }

    try {
      const thumbUrl = await generateAndUpload(parsed.bucket, parsed.path);
      const { error: updateErr } = await supabase
        .from("backdrop_catalog")
        .update({ thumbnail_url: thumbUrl })
        .eq("id", row.id);
      if (updateErr) {
        console.log(`DB UPDATE FAILED: ${updateErr.message}`);
        fail++;
        continue;
      }
      console.log("OK");
      ok++;
    } catch (err) {
      console.log(`FAILED: ${err?.message || err}`);
      fail++;
    }
  }

  console.log();
  console.log(
    `Done. Updated: ${ok}, Failed: ${fail}, Skipped: ${skipped.length}`,
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

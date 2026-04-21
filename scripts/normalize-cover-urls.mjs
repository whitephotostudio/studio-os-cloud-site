#!/usr/bin/env node
/**
 * One-off cleanup: rewrite any collections.cover_photo_url or
 * projects.cover_photo_url values that still point at Supabase Image
 * Transformation URLs (/storage/v1/render/image/public/...?width=...).
 *
 * Each unique transform URL counts against the plan's Image Transformation
 * quota, so we want these flipped to raw /storage/v1/object/public/ URLs
 * with no query string.  Safe to re-run; it's idempotent.
 *
 * Usage:
 *   npx dotenv -e .env.local -- node scripts/normalize-cover-urls.mjs
 *
 * Requires env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function normalizeStorageUrl(url) {
  if (!url) return "";
  const candidate = String(url).trim();
  if (!candidate) return "";
  if (!candidate.includes("/render/image/") && !candidate.includes("?")) {
    return candidate;
  }

  try {
    const parsed = new URL(candidate);
    parsed.search = "";
    parsed.hash = "";
    if (parsed.pathname.includes("/storage/v1/render/image/public/")) {
      parsed.pathname = parsed.pathname.replace(
        "/storage/v1/render/image/public/",
        "/storage/v1/object/public/",
      );
    }
    return parsed.toString();
  } catch {
    const withoutQuery = candidate.split("?")[0].split("#")[0];
    return withoutQuery.replace(
      "/storage/v1/render/image/public/",
      "/storage/v1/object/public/",
    );
  }
}

async function normalizeTable(table, column) {
  console.log(`\n=== ${table}.${column} ===`);

  const { data, error } = await supabase
    .from(table)
    .select(`id, ${column}`)
    .or(`${column}.like.%/render/image/%,${column}.like.%?%`);

  if (error) {
    console.error(`Query failed: ${error.message}`);
    return { scanned: 0, updated: 0 };
  }

  const rows = data ?? [];
  console.log(`Candidates: ${rows.length}`);

  let updated = 0;
  for (const row of rows) {
    const current = row[column];
    const next = normalizeStorageUrl(current);
    if (!next || next === current) continue;

    const { error: updateError } = await supabase
      .from(table)
      .update({ [column]: next, updated_at: new Date().toISOString() })
      .eq("id", row.id);

    if (updateError) {
      console.error(`  ✗ ${row.id}: ${updateError.message}`);
      continue;
    }

    console.log(`  ✓ ${row.id}`);
    console.log(`    before: ${current}`);
    console.log(`    after : ${next}`);
    updated++;
  }

  return { scanned: rows.length, updated };
}

async function main() {
  const targets = [
    { table: "collections", column: "cover_photo_url" },
    { table: "projects", column: "cover_photo_url" },
    // Media rows normally already point at /object/; these fields are here in
    // case any still slipped through with transform URLs.
    { table: "media", column: "preview_url" },
    { table: "media", column: "thumbnail_url" },
  ];

  let totalScanned = 0;
  let totalUpdated = 0;

  for (const target of targets) {
    const { scanned, updated } = await normalizeTable(target.table, target.column);
    totalScanned += scanned;
    totalUpdated += updated;
  }

  console.log(`\nDone. Scanned candidates: ${totalScanned}, Updated: ${totalUpdated}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

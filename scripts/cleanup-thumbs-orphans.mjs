#!/usr/bin/env node
/**
 * cleanup-thumbs-orphans.mjs
 *
 * One-shot cleanup for the `thumbs` Supabase Storage bucket: deletes 651
 * orphan objects left behind by earlier import / slug churn.
 *
 * Safety net: only the prefixes enumerated in ORPHAN_PREFIXES below are
 * touched. Each prefix was verified to have ZERO references across every
 * url-ish column in the public schema (media, backdrop_catalog,
 * collections, projects, schools, students, photos, photographers,
 * credit_transactions) as of 2026-04-22. See
 * docs/design/thumbs-path-normalization.md for the full rationale.
 *
 * Run from the repo root, Node ≥20:
 *   node scripts/cleanup-thumbs-orphans.mjs            # dry run (default)
 *   node scripts/cleanup-thumbs-orphans.mjs --commit   # actually delete
 *
 * Required env (use .env.local via `env $(cat .env.local | xargs)` or
 * similar):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * The service-role key is required because the `thumbs` bucket denies
 * authenticated client writes after Round 6g.2.
 */

import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "thumbs";
const BATCH_SIZE = 500; // Supabase Storage remove() accepts up to ~1000; 500 is a safe chunk.

// Verified orphan prefixes — each has zero references in any url-ish column.
// Expected object counts (pulled 2026-04-22 via MCP SQL) in parentheses.
const ORPHAN_PREFIXES = [
  "udz1lw0s1dmc/",                         // 241
  "st3xmgmyummu/",                         // 162
  "eeiikg7fc9pd/",                         //   2
  "ae3204ed-d549-45f8-ba13-b6cdde3a7e73/", // 240
  "schools/",                              //   6 (literal "schools/" prefix — not a real schools folder)
];
// Expected total: 651.

const commitFlag = process.argv.includes("--commit");

function envOrDie(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    console.error(`Missing env: ${name}`);
    process.exit(1);
  }
  return value.trim();
}

async function listAll(sb, prefix) {
  // storage.list is paginated; keep paging until we exhaust the prefix.
  const collected = [];
  const pageSize = 1000;
  let offset = 0;
  // The list() API treats the prefix as a folder path; strip trailing slash.
  const folder = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;

  // Recursive walker: list folder, recurse into any entries whose metadata === null
  // (those are sub-folders in Supabase Storage's flat-object model).
  async function walk(currentFolder) {
    let pageOffset = 0;
    while (true) {
      const { data, error } = await sb.storage.from(BUCKET).list(currentFolder, {
        limit: pageSize,
        offset: pageOffset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw error;
      if (!data || data.length === 0) break;

      for (const entry of data) {
        const full = currentFolder ? `${currentFolder}/${entry.name}` : entry.name;
        if (entry.id === null || entry.metadata === null) {
          // Sub-folder — recurse.
          await walk(full);
        } else {
          collected.push(full);
        }
      }

      if (data.length < pageSize) break;
      pageOffset += pageSize;
    }
  }

  await walk(folder);
  return collected;
}

async function main() {
  const url = envOrDie("NEXT_PUBLIC_SUPABASE_URL");
  const key = envOrDie("SUPABASE_SERVICE_ROLE_KEY");
  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Mode: ${commitFlag ? "COMMIT (will delete)" : "DRY RUN (no deletes)"}`);
  console.log(`Bucket: ${BUCKET}`);
  console.log(`Prefixes: ${ORPHAN_PREFIXES.join(", ")}`);
  console.log("");

  let grandTotal = 0;
  const perPrefix = [];

  for (const prefix of ORPHAN_PREFIXES) {
    process.stdout.write(`Listing ${prefix} ... `);
    const paths = await listAll(sb, prefix);
    console.log(`${paths.length} objects`);
    perPrefix.push({ prefix, count: paths.length, paths });
    grandTotal += paths.length;
  }

  console.log("");
  console.log(`Total orphans to delete: ${grandTotal}`);
  console.log("Expected per doc: 651 (241 + 162 + 2 + 240 + 6)");
  console.log("");

  if (!commitFlag) {
    console.log("Dry run complete. Re-run with --commit to delete.");
    return;
  }

  if (grandTotal === 0) {
    console.log("Nothing to delete.");
    return;
  }

  let deleted = 0;
  let failed = 0;
  for (const { prefix, paths } of perPrefix) {
    for (let i = 0; i < paths.length; i += BATCH_SIZE) {
      const chunk = paths.slice(i, i + BATCH_SIZE);
      process.stdout.write(
        `Deleting ${prefix} chunk ${i / BATCH_SIZE + 1} (${chunk.length} objects) ... `,
      );
      const { data, error } = await sb.storage.from(BUCKET).remove(chunk);
      if (error) {
        console.log(`FAILED: ${error.message}`);
        failed += chunk.length;
        continue;
      }
      const removed = Array.isArray(data) ? data.length : 0;
      deleted += removed;
      const missing = chunk.length - removed;
      console.log(`ok (${removed} removed${missing ? `, ${missing} missing/already-gone` : ""})`);
    }
  }

  console.log("");
  console.log(`Deleted: ${deleted}`);
  if (failed) console.log(`Failed: ${failed}`);
  console.log("");
  console.log("Verify in Supabase:");
  console.log(`  SELECT COUNT(*) FROM storage.objects WHERE bucket_id='${BUCKET}';`);
  console.log("Expected: ~1501 (was 2152).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

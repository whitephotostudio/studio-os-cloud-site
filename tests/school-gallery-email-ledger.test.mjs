import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260827210000_fix_project_email_delivery_dedupe_index.sql",
    import.meta.url,
  ),
  "utf8",
);
const route = readFileSync(
  new URL("../app/api/dashboard/schools/[schoolId]/emails/route.ts", import.meta.url),
  "utf8",
);
const page = readFileSync(
  new URL("../app/dashboard/projects/schools/[schoolId]/page.tsx", import.meta.url),
  "utf8",
);

test("delivery ledger exposes a unique constraint PostgREST can target", () => {
  const executableMigration = migration.replace(/--.*$/gm, "");

  assert.match(executableMigration, /drop index if exists public\.project_email_deliveries_dedupe_idx/i);
  assert.match(
    executableMigration,
    /create unique index project_email_deliveries_dedupe_idx\s+on public\.project_email_deliveries \(dedupe_key\)/i,
  );
  assert.doesNotMatch(executableMigration, /where\s+dedupe_key\s+is\s+not\s+null/i);
});

test("campaign delivery is bounded, retry-safe, and confirms provider results", () => {
  assert.match(route, /const SEND_CONCURRENCY = 5/);
  assert.match(route, /index \+= SEND_CONCURRENCY/);
  assert.match(route, /Promise\.all\(batch\.map/);
  assert.match(route, /sendStudioBookingEmailWithRetry/);
  assert.match(route, /idempotencyKey: deliveryKey/);
  assert.match(page, /shareCampaignAttemptRef/);
  assert.match(page, /existingAttempt\?\.fingerprint === fingerprint/);
  assert.match(page, /accepted by the email provider/);
  assert.match(page, /role="alert"/);
  assert.match(page, /You can safely retry the unchanged campaign/);
});

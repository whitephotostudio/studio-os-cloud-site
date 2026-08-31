import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = new URL(
  "../../supabase/migrations/20260722010000_security_patch_1_close_anonymous_access.sql",
  import.meta.url,
);
const sql = readFileSync(migrationPath, "utf8");
const normalizedSql = sql.toLowerCase().replaceAll('"', "").replace(/\s+/g, " ");

test("removes every known blanket sensitive-data policy", () => {
  const policies = [
    "Anon can read collections",
    "Anon can read package profiles",
    "Anon can read projects",
    "Anon can read schools",
    "Anon can read students",
    "parent_pin_lookup",
    "public_can_read_own",
    "public_can_register",
    "parents_can_check_own",
    "photographer_can_read",
    "parents_can_register",
  ];
  for (const policy of policies) {
    assert.ok(
      normalizedSql.includes(`drop policy if exists ${policy.toLowerCase()}`),
      `missing DROP POLICY for ${policy}`,
    );
  }
});

test("revokes anonymous execution of elevated helper functions", () => {
  assert.match(sql, /revoke execute on function public\._link_device_to_photography_key[\s\S]*from public, anon, authenticated;/i);
  assert.match(sql, /revoke execute on function public\._upsert_device_registration[\s\S]*from public, anon, authenticated;/i);
  assert.match(sql, /has_function_privilege[\s\S]*_link_device_to_photography_key/i);
  assert.match(sql, /has_function_privilege[\s\S]*_upsert_device_registration/i);
});

test("migration is atomic", () => {
  assert.match(sql, /^\s*--[\s\S]*\bbegin;/i);
  assert.match(sql, /\bcommit;\s*$/i);
  assert.match(sql, /raise exception/i);
});

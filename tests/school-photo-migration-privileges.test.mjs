import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync(
  new URL(
    "../supabase/migrations/20260824153000_create_school_photo_deletions.sql",
    import.meta.url,
  ),
  "utf8",
);

test("photo tombstones revoke inherited authenticated privileges before SELECT", () => {
  assert.match(
    migrationSource,
    /revoke all on table public\.school_photo_deletions from authenticated;[\s\S]*?grant select on table public\.school_photo_deletions to authenticated;/i,
  );
  assert.doesNotMatch(
    migrationSource,
    /grant (insert|update|delete|all)[\s\S]*?school_photo_deletions[\s\S]*?authenticated/i,
  );
});

test("school database and local storage roots have one global claim registry", () => {
  assert.match(
    migrationSource,
    /create table if not exists public\.school_storage_root_claims[\s\S]*?root text primary key/i,
  );
  assert.match(
    migrationSource,
    /select lower\(id::text\), id, 'database'[\s\S]*?select lower\(local_school_id\), id, 'local'/i,
  );
  assert.match(
    migrationSource,
    /after insert or update of id, local_school_id on public\.schools/i,
  );
  assert.match(
    migrationSource,
    /security definer[\s\S]*?insert into public\.school_storage_root_claims/i,
  );
});

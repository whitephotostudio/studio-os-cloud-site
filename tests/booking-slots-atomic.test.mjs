import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const before = readFileSync(new URL('./fixtures/booking-slots-before.sql', import.meta.url), 'utf8');
const after = readFileSync(new URL('./fixtures/booking-slots-after.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261005001000_replace_booking_slots_atomically.sql', import.meta.url), 'utf8');

test('actual booking replacement SQL preserves owner, reservation and rollback boundaries', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth;
      create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
    const isolatedFunction = migration.split('revoke all')[0].replaceAll('public.', 'pg_temp.');
    const results = await db.exec(before + isolatedFunction + after);
    const summary = results.flatMap(result => result.rows ?? []).find(row => row.verification)?.verification;
    assert.equal(summary, '6 SQL fixtures passed; all temporary tables and function rolled back');
    assert.equal((await db.query("select to_regclass('pg_temp.booking_days') is null as rolled_back")).rows[0].rolled_back, true);
  } finally { await db.close(); }
});

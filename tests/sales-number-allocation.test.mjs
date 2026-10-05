import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { buildSalesNumberFixture } from './helpers/sales-number-fixture.mjs';

const baseline = readFileSync(new URL('./fixtures/legacy-sales-number-allocator.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261005002000_preserve_sales_number_digits.sql', import.meta.url), 'utf8');

test('exact PostgreSQL allocator reproduces truncation and passes isolated rollover, history, collision and rollback cases', async () => {
  const db = new PGlite();
  try {
    const results = await db.exec(buildSalesNumberFixture(baseline, migration));
    const summary = results.flatMap(result => result.rows ?? []).find(row => row.sales_number_fixture)?.sales_number_fixture;
    assert.equal(summary?.passed, 22);
    assert.equal(summary.cases.length, 22);
    assert.equal((await db.query("select to_regclass('pg_temp.sales_documents') is null as rolled_back")).rows[0].rolled_back, true);
  } finally {
    await db.close();
  }
});

test('replacing the internal allocator retains existing access restrictions', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated;
      create table sales_documents(photographer_id uuid,kind text,sequence_number bigint,document_number text);
      create table sales_number_sequences(photographer_id uuid,kind text,next_sequence bigint,updated_at timestamptz,primary key(photographer_id,kind));`);
    await db.exec(baseline);
    await db.exec('revoke all on function public._sales_allocate_number(uuid,text,text,integer) from public;');
    await db.exec(migration);
    await db.exec('set role authenticated');
    await assert.rejects(() => db.query("select * from public._sales_allocate_number('11111111-1111-1111-1111-111111111111','invoice','',4)"), /permission denied/);
  } finally {
    await db.close();
  }
});

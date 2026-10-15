import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const photographer = '11111111-1111-4111-8111-111111111111';
const owner = '22222222-2222-4222-8222-222222222222';
const stranger = '33333333-3333-4333-8333-333333333333';
const payload = {type: 'standard', country: 'CA', 'metadata[photographer_id]': photographer, email: 'original@example.test'};
async function fixture(t) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.photographers(id uuid primary key, user_id uuid, business_country text, stripe_connect_country text);`);
  await db.query('insert into public.photographers values($1,$2,$3,$3)', [photographer, owner, 'CA']);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261013021000_stripe_standard_creation_intents.sql', import.meta.url), 'utf8'));
  const reserve = (params = payload, identity = {photographer, owner, country: 'CA', livemode: false}) =>
    db.query('select * from public.reserve_photographer_standard_intent($1::uuid,$2::uuid,$3::text,$4::boolean,$5::jsonb)',
      [identity.photographer, identity.owner, identity.country, identity.livemode, JSON.stringify(params)]);
  const record = (intent, status, account = null, actor = owner) =>
    db.query('select * from public.record_photographer_standard_intent($1::uuid,$2::uuid,$3::text,$4::text)', [intent, actor, status, account]);
  return {db, reserve, record};
}

test('actual creation SQL freezes identity, creation payload and first attempt timestamp across retries', async t => {
  const f = await fixture(t); const first = (await f.reserve()).rows[0];
  const changed = (await f.reserve({...payload, email: 'changed@example.test'})).rows[0];
  assert.equal(changed.id, first.id); assert.equal(changed.attempted_at.getTime(), first.attempted_at.getTime());
  assert.deepEqual(changed.creation_params, payload);
  await f.record(first.id, 'uncertain');
  assert.equal((await f.reserve()).rows[0].status, 'uncertain');
  await assert.rejects(f.record(first.id, 'registered'), /requires a Stripe account/);
  await f.record(first.id, 'uncertain', 'acct_known');
  await f.record(first.id, 'registered', 'acct_known');
  await f.record(first.id, 'uncertain');
  const replay = (await f.reserve()).rows[0];
  assert.equal(replay.status, 'registered'); assert.equal(replay.stripe_account_id, 'acct_known');
  assert.equal(replay.attempted_at.getTime(), first.attempted_at.getTime());
  await assert.rejects(f.record(first.id, 'registered', 'acct_replacement'), /cannot change/);
  await assert.rejects(f.record(first.id, 'uncertain', 'acct_known', stranger), /ownership/);
  assert.equal((await f.db.query('select count(*)::integer count from photographer_stripe_standard_intents')).rows[0].count, 1);
});

test('actual creation SQL refuses another owner, mismatched country, live mode and forged creation parameters', async t => {
  const f = await fixture(t);
  await assert.rejects(f.reserve(payload, {photographer, owner: stranger, country: 'CA', livemode: false}), /ownership/);
  await assert.rejects(f.reserve(payload, {photographer, owner, country: 'US', livemode: false}), /country must match/);
  await assert.rejects(f.reserve(payload, {photographer, owner, country: 'CA', livemode: true}), /test-only/);
  for (const invalid of [{...payload, type: 'express'}, {...payload, country: 'US'}, {...payload, 'metadata[photographer_id]': stranger}]) {
    await assert.rejects(f.reserve(invalid), /Invalid Standard creation parameters/);
  }
  assert.equal((await f.db.query('select count(*)::integer count from photographer_stripe_standard_intents')).rows[0].count, 0);
});

test('actual creation-intent table and RPCs deny anon/authenticated access even with valid owner values', async t => {
  const f = await fixture(t); const first = (await f.reserve()).rows[0];
  for (const role of ['anon', 'authenticated']) {
    await f.db.exec(`set role ${role}`);
    await assert.rejects(f.db.query('select * from public.photographer_stripe_standard_intents'), /permission denied/);
    await assert.rejects(f.reserve(), /permission denied/);
    await assert.rejects(f.record(first.id, 'uncertain', 'acct_known'), /permission denied/);
    await f.db.exec('reset role');
  }
  assert.equal((await f.reserve()).rows[0].status, 'creating');
});

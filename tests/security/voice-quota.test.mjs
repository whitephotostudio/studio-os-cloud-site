import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(import.meta.url);
const root = new URL('../../', import.meta.url);
const migration = readFileSync(new URL('supabase/migrations/20261012090000_reserve_voice_usage.sql', root), 'utf8');
const [owner, other, reservationId] = [1, 2, 3].map(value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`);
const now = new Date().toISOString();

async function fixture({ used = 0, limit = 1000, enabled = true, admin = false } = {}) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    -- Match Supabase's permissive creation defaults: the migration must revoke them.
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated;
    create table public.photographers(id uuid primary key,is_platform_admin boolean not null default false,
      voice_premium_enabled boolean not null default false,voice_monthly_char_limit integer not null default 1000,
      voice_chars_used_this_month integer not null default 0,voice_usage_period_start timestamptz default now(),
      studio_app_beta_access boolean not null default false);`);
  await db.query(`insert into public.photographers(id,is_platform_admin,voice_premium_enabled,voice_monthly_char_limit,voice_chars_used_this_month)
    values($1,$2,$3,$4,$5),($6,false,true,1000,0)`, [owner, admin, enabled, limit, used, other]);
  await db.exec(migration);
  await db.exec('set role service_role');
  return db;
}
async function reserve(db, characters = 100, photographerId = owner) {
  return (await db.query('select public.reserve_voice_usage($1,$2) result', [photographerId, characters])).rows[0].result;
}
async function release(db, id, photographerId = owner) {
  return (await db.query('select public.release_voice_usage($1,$2) result', [photographerId, id])).rows[0].result;
}
async function profile(db) { return (await db.query('select * from public.photographers where id=$1', [owner])).rows[0]; }
async function ledger(db) { return (await db.query('select * from public.voice_usage_reservations order by created_at')).rows; }
const serviceFor = db => ({ async rpc(name, args) {
  try {
    if (name === 'reserve_voice_usage') return { data: await reserve(db, args.p_character_count, args.p_photographer_id), error: null };
    assert.equal(name, 'release_voice_usage');
    return { data: await release(db, args.p_reservation_id, args.p_photographer_id), error: null };
  } catch (error) { return { data: null, error }; }
} });

function load(file, overrides = {}, globals = {}) {
  const output = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const keys = Object.keys(globals);
  new Function('require', 'exports', ...keys, output)(name => overrides[name] ?? require(name), exports, ...keys.map(key => globals[key]));
  return exports;
}
const helper = load('lib/voice-quota.ts');
function routeFixture({ service, decision, rpcError, fetcher, signedIn = true, configured = true, staleAdmin = false } = {}) {
  const rpcCalls = [], providerCalls = [], logs = [];
  const rpc = async (name, args) => {
    rpcCalls.push({ name, args });
    if (service) return service.rpc(name, args);
    if (name === 'release_voice_usage') return { data: true, error: null };
    return { data: decision === undefined ? { status: 'reserved', photographer_id: owner,
      character_count: args.p_character_count, reservation_id: reservationId, period_start: now,
      used_this_month: args.p_character_count, monthly_limit: 1000 } : decision, error: rpcError ?? null };
  };
  const route = load('app/api/studio-assistant/tts/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/dashboard-auth': { resolveDashboardAuth: async () => ({ user: signedIn ? { id: owner } : null }), createDashboardServiceClient: () => ({ rpc }) },
    '@/lib/payments': { getOrCreatePhotographerByUser: async () => ({ id: owner, is_platform_admin: staleAdmin }) },
    '@/lib/voice-quota': helper,
  }, {
    process: { env: configured ? { ELEVENLABS_API_KEY: 'synthetic-provider-key' } : {} },
    fetch: async (url, options) => {
      providerCalls.push({ url, options });
      return fetcher ? fetcher(url, options) : new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } });
    },
    console: { error: (...values) => logs.push(values) },
  });
  return { ...route, rpcCalls, providerCalls, logs,
    request: (body = { text: 'x'.repeat(100) }) => new Request('https://example.invalid/api/studio-assistant/tts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }) };
}

test('actual SQL serializes sequential and queued near-limit reservations without overdrawing', async () => {
  const db = await fixture({ used: 900, limit: 1000 });
  try {
    const first = await reserve(db, 75);
    assert.equal(first.status, 'reserved');
    assert.equal((await reserve(db, 26)).status, 'limit');
    const queued = await Promise.all(Array.from({ length: 12 }, () => reserve(db, 25)));
    assert.equal(queued.filter(result => result.status === 'reserved').length, 1);
    assert.equal(queued.filter(result => result.status === 'limit').length, 11);
    assert.equal((await profile(db)).voice_chars_used_this_month, 1000);
    assert.equal((await ledger(db)).length, 2);
    const definitions = (await db.query(`select pg_get_functiondef(oid) definition from pg_proc
      where proname in ('reserve_voice_usage','release_voice_usage')`)).rows;
    assert.ok(definitions.every(row => /public\.photographers[\s\S]*?for update/i.test(row.definition)), 'both actual routines lock the photographer');
  } finally { await db.close(); }
});

test('atomic authorization uses current admin, enabled and limit values; admins reserve no quota', async () => {
  const db = await fixture({ used: 1000, limit: 0, enabled: false, admin: true });
  try {
    const before = await profile(db);
    assert.equal((await reserve(db, 400)).status, 'admin');
    assert.deepEqual(await profile(db), before);
    assert.equal((await ledger(db)).length, 0);
    await db.query('update public.photographers set is_platform_admin=false where id=$1', [owner]);
    assert.equal((await reserve(db)).status, 'disabled');
    await db.query('update public.photographers set voice_premium_enabled=true where id=$1', [owner]);
    assert.equal((await reserve(db)).status, 'limit');
    await db.query('update public.photographers set voice_monthly_char_limit=1100 where id=$1', [owner]);
    assert.equal((await reserve(db)).status, 'reserved');
    assert.equal((await profile(db)).voice_chars_used_this_month, 1100);
  } finally { await db.close(); }
});

test('UTC monthly rollover resets once and subsequent requests share the replacement period', async () => {
  const db = await fixture({ used: 1000, limit: 300 });
  try {
    await db.exec("set timezone='Pacific/Honolulu'");
    await db.query("update public.photographers set voice_usage_period_start=date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC' - interval '1 month' where id=$1", [owner]);
    const before = await profile(db);
    const first = await reserve(db), second = await reserve(db);
    assert.equal(first.status, 'reserved'); assert.equal(second.status, 'reserved');
    assert.equal(first.period_start, second.period_start);
    assert.notEqual(Date.parse(first.period_start), Date.parse(before.voice_usage_period_start));
    assert.equal((await profile(db)).voice_chars_used_this_month, 200);
    assert.equal(first.used_this_month, 100); assert.equal(second.used_this_month, 200);
  } finally { await db.close(); }
});

test('release subtracts only its charge, is idempotent and refuses wrong account or missing tokens', async () => {
  const db = await fixture({ used: 200 });
  try {
    const first = await reserve(db, 100), second = await reserve(db, 150);
    assert.equal(await release(db, first.reservation_id, other), false);
    assert.equal(await release(db, reservationId), false);
    assert.equal((await profile(db)).voice_chars_used_this_month, 450);
    assert.equal(await release(db, first.reservation_id), true);
    assert.equal(await release(db, first.reservation_id), false);
    assert.equal((await profile(db)).voice_chars_used_this_month, 350);
    assert.equal(await release(db, second.reservation_id), true);
    assert.equal((await profile(db)).voice_chars_used_this_month, 200);
    assert.equal((await ledger(db)).filter(row => row.released_at).length, 2);
  } finally { await db.close(); }
});

test('old-month and same-month admin-reset tokens cannot refund a replacement period', async () => {
  const db = await fixture();
  try {
    const first = await reserve(db, 100);
    await db.query("update public.photographers set voice_usage_period_start=voice_usage_period_start+interval '1 second',voice_chars_used_this_month=0 where id=$1", [owner]);
    const current = await reserve(db, 75);
    assert.equal(await release(db, first.reservation_id), true);
    assert.equal((await profile(db)).voice_chars_used_this_month, 75);
    assert.equal(await release(db, first.reservation_id), false);
    await db.query("update public.photographers set voice_usage_period_start=voice_usage_period_start-interval '1 month' where id=$1", [owner]);
    await assert.rejects(() => db.query("update public.voice_usage_reservations set period_start=period_start-interval '1 month' where id=$1", [current.reservation_id]), /permission denied/);
    await db.exec('reset role');
    await db.query("update public.voice_usage_reservations set period_start=period_start-interval '1 month' where id=$1", [current.reservation_id]);
    await db.exec('set role service_role');
    const replacement = await reserve(db, 50);
    assert.equal(replacement.status, 'reserved');
    assert.equal(await release(db, current.reservation_id), true);
    assert.equal((await profile(db)).voice_chars_used_this_month, 50);
    assert.equal(await release(db, replacement.reservation_id), true);
    assert.equal((await profile(db)).voice_chars_used_this_month, 0);
  } finally { await db.close(); }
});

test('invalid accounting/input and failed counter writes cannot leave a partial reservation', async () => {
  const db = await fixture({ used: 100 });
  try {
    for (const count of [0, -1, 401, null]) await assert.rejects(() => reserve(db, count), /Invalid voice reservation/);
    await assert.rejects(() => reserve(db, 100, reservationId), /Voice account unavailable/);
    for (const used of [0, 100]) {
      await db.query('update public.photographers set voice_usage_period_start=null,voice_chars_used_this_month=$1 where id=$2', [used, owner]);
      await assert.rejects(() => reserve(db), /Voice accounting unavailable/);
      assert.equal((await profile(db)).voice_chars_used_this_month, used);
    }
    await db.query('update public.photographers set voice_usage_period_start=clock_timestamp(),voice_chars_used_this_month=100 where id=$1', [owner]);
    await db.exec(`reset role; create function public.reject_voice_write() returns trigger language plpgsql as $$begin
      raise exception 'synthetic failed counter write';end$$;
      create trigger reject_voice_write before update on public.photographers for each row execute function public.reject_voice_write();
      set role service_role;`);
    await assert.rejects(() => reserve(db), /synthetic failed counter write/);
    assert.equal((await profile(db)).voice_chars_used_this_month, 100);
    assert.equal((await ledger(db)).length, 0);
  } finally { await db.close(); }
});

test('actual migration keeps reservation metadata private and RPCs service-only with empty search paths', async () => {
  const db = await fixture();
  try {
    const result = await reserve(db);
    await db.exec('reset role');
    const functions = (await db.query(`select proname,prosecdef,proconfig from pg_proc where
      proname in ('reserve_voice_usage','release_voice_usage') order by proname`)).rows;
    assert.equal(functions.length, 2);
    assert.ok(functions.every(row => row.prosecdef && row.proconfig.includes('search_path=""')));
    assert.equal((await db.query("select relrowsecurity enabled from pg_class where oid='public.voice_usage_reservations'::regclass")).rows[0].enabled, true);
    assert.deepEqual((await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='voice_usage_reservations' order by ordinal_position")).rows.map(row => row.column_name),
      ['id', 'photographer_id', 'period_start', 'character_count', 'created_at', 'released_at']);
    for (const role of ['anon', 'authenticated']) {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES']) {
        assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed', [role, 'public.voice_usage_reservations', privilege])).rows[0].allowed, false);
      }
      await db.exec(`set role ${role}`);
      await assert.rejects(() => reserve(db), /permission denied/);
      await assert.rejects(() => release(db, result.reservation_id), /permission denied/);
      await assert.rejects(() => ledger(db), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    assert.equal(await release(db, result.reservation_id), true);
    await assert.rejects(() => db.query('delete from public.voice_usage_reservations'), /permission denied/);
  } finally { await db.close(); }
});

test('actual billing and voice entitlement guards permit service quota reservations and idempotent refunds', async () => {
  const db = await fixture();
  try {
    await db.exec('reset role');
    await db.exec(readFileSync(new URL('supabase/migrations/20260930012000_protect_photographer_billing.sql', root), 'utf8'));
    await db.exec(readFileSync(new URL('supabase/migrations/20261012100000_guard_voice_beta_entitlements.sql', root), 'utf8'));
    await db.exec('set role authenticated');
    await assert.rejects(() => db.query('update public.photographers set voice_premium_enabled=false where id=$1', [owner]), /only be changed by Studio OS administration/);
    await db.exec('reset role;set role service_role');
    const result = await reserve(db, 125);
    assert.equal(result.status, 'reserved'); assert.equal((await profile(db)).voice_chars_used_this_month, 125);
    assert.equal(await release(db, result.reservation_id), true);
    assert.equal(await release(db, result.reservation_id), false);
    assert.equal((await profile(db)).voice_chars_used_this_month, 0);
  } finally { await db.close(); }
});

test('unexpected inherited client RPC authority aborts new accounting objects atomically', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;grant service_role to authenticated;
      create table public.photographers(id uuid primary key,is_platform_admin boolean,voice_premium_enabled boolean,
        voice_monthly_char_limit integer,voice_chars_used_this_month integer,voice_usage_period_start timestamptz);`);
    await assert.rejects(() => db.exec(migration), /Unexpected voice accounting privilege/);
    await db.exec('rollback');
    assert.equal((await db.query("select to_regclass('public.voice_usage_reservations') value")).rows[0].value, null);
    assert.equal((await db.query("select to_regprocedure('public.reserve_voice_usage(uuid,integer)') value")).rows[0].value, null);
  } finally { await db.close(); }
});

test('route stops before provider invocation for missing/failed/malformed reservation RPC results', async () => {
  const valid = { status: 'reserved', photographer_id: owner, character_count: 100,
    reservation_id: reservationId, period_start: now, used_this_month: 100, monthly_limit: 1000 };
  for (const options of [
    { rpcError: { message: 'private SQL details' } }, { decision: null }, { decision: [] }, { decision: {} },
    { decision: { ...valid, photographer_id: other } }, { decision: { ...valid, character_count: 99 } },
    { decision: { ...valid, reservation_id: 'bad' } }, { decision: { ...valid, period_start: null } },
    { decision: { ...valid, used_this_month: 1001 } }, { decision: { ...valid, monthly_limit: '1000' } },
    { service: { rpc: async () => { throw Error('private network details'); } } },
    { decision: { status: 'limit', photographer_id: owner, character_count: 100, reservation_id: null, used_this_month: 0, monthly_limit: 1000 } },
  ]) {
    const f = routeFixture(options), response = await f.POST(f.request());
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'voice_accounting_unavailable');
    assert.equal(f.providerCalls.length, 0); assert.equal(f.rpcCalls.length, 1);
  }
});

test('route preserves disabled/limit fallbacks and fails before authorization on malformed/unauthenticated requests', async () => {
  for (const [decision, status, code] of [
    [{ status: 'disabled', photographer_id: owner, character_count: 100, reservation_id: null }, 403, 'voice_disabled'],
    [{ status: 'limit', photographer_id: owner, character_count: 100, reservation_id: null, used_this_month: 950, monthly_limit: 1000 }, 429, 'voice_limit_reached'],
  ]) {
    const f = routeFixture({ decision, staleAdmin: true }), response = await f.POST(f.request());
    assert.equal(response.status, status); assert.equal((await response.json()).code, code); assert.equal(f.providerCalls.length, 0);
  }
  for (const body of [null, [], 3, {}, { text: '   ' }]) {
    const f = routeFixture(); assert.equal((await f.POST(f.request(body))).status, 400); assert.equal(f.rpcCalls.length, 0);
  }
  const unauthenticated = routeFixture({ signedIn: false });
  assert.equal((await unauthenticated.POST(unauthenticated.request())).status, 401); assert.equal(unauthenticated.rpcCalls.length, 0);
  const missingKey = routeFixture({ configured: false });
  assert.equal((await missingKey.POST(missingKey.request())).status, 501); assert.equal(missingKey.rpcCalls.length, 0);
});

test('successful TTS retains its charge and the 400-character cap; admin failures have no release token', async () => {
  const f = routeFixture(), response = await f.POST(f.request({ text: ' ' + 'x'.repeat(500) + ' ', voice_id: 'voice/fixture' }));
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal((await response.arrayBuffer()).byteLength, 3);
  assert.equal(f.rpcCalls[0].args.p_character_count, 400); assert.equal(f.rpcCalls.length, 1);
  assert.equal(JSON.parse(f.providerCalls[0].options.body).text.length, 400);
  assert.match(f.providerCalls[0].url, /voice%2Ffixture$/);
  const admin = routeFixture({ decision: { status: 'admin', photographer_id: owner, character_count: 100, reservation_id: null },
    fetcher: async () => { throw Error('synthetic provider failure'); } });
  assert.equal((await admin.POST(admin.request())).status, 504);
  assert.equal(admin.providerCalls.length, 1); assert.equal(admin.rpcCalls.length, 1);
});

test('provider HTTP, network and audio-read failures release exactly their own token once', async () => {
  for (const fetcher of [
    async () => new Response('synthetic upstream error', { status: 401 }),
    async () => { throw new Error('synthetic network failure'); },
    async () => ({ ok: true, arrayBuffer: async () => { throw new Error('synthetic audio read failure'); } }),
  ]) {
    const f = routeFixture({ fetcher }), response = await f.POST(f.request());
    assert.ok([502, 504].includes(response.status));
    assert.deepEqual(f.rpcCalls.map(call => call.name), ['reserve_voice_usage', 'release_voice_usage']);
    assert.deepEqual(f.rpcCalls[1].args, { p_photographer_id: owner, p_reservation_id: reservationId });
  }
});

test('failed release stays conservatively charged and never overwrites usage or leaks RPC details', async () => {
  for (const releaseResult of [{ data: null, error: { message: 'private SQL details' } }, { data: 'true', error: null }]) {
    const f = routeFixture({ service: { rpc: async (name, args) => name === 'release_voice_usage' ? releaseResult : {
      data: { status: 'reserved', photographer_id: owner, character_count: args.p_character_count, reservation_id: reservationId,
        period_start: now, used_this_month: 100, monthly_limit: 1000 }, error: null,
    } }, fetcher: async () => new Response('synthetic upstream error', { status: 500 }) });
    const response = await f.POST(f.request());
    assert.equal(response.status, 500); assert.equal(f.rpcCalls.length, 2);
    assert.equal(JSON.stringify(f.logs).includes('private SQL details'), false); assert.equal(f.logs.length, 1);
  }
});

test('actual route/helper/SQL near-limit queued calls authorize only the affordable provider request', async () => {
  const db = await fixture({ used: 300, limit: 400 });
  try {
    const f = routeFixture({ service: serviceFor(db), staleAdmin: true });
    const responses = await Promise.all(Array.from({ length: 5 }, () => f.POST(f.request())));
    assert.equal(responses.filter(response => response.status === 200).length, 1);
    assert.equal(responses.filter(response => response.status === 429).length, 4);
    assert.equal(f.providerCalls.length, 1); assert.equal((await profile(db)).voice_chars_used_this_month, 400);
  } finally { await db.close(); }
});

test('late failed provider request cannot erase another concurrent successful request charge', async () => {
  const db = await fixture({ limit: 200 });
  try {
    let failFirst;
    const firstPending = new Promise((_, reject) => { failFirst = reject; });
    let firstStarted;
    const started = new Promise(resolve => { firstStarted = resolve; });
    let invocation = 0;
    const f = routeFixture({ service: serviceFor(db), fetcher: async () => {
      invocation += 1;
      if (invocation === 1) { firstStarted(); return firstPending; }
      return new Response(new Uint8Array([7]));
    } });
    const first = f.POST(f.request());
    await started;
    const second = await f.POST(f.request()); assert.equal(second.status, 200);
    assert.equal((await profile(db)).voice_chars_used_this_month, 200);
    failFirst(new Error('synthetic late failure')); assert.equal((await first).status, 504);
    assert.equal((await profile(db)).voice_chars_used_this_month, 100);
    assert.equal((await ledger(db)).filter(row => row.released_at).length, 1);
  } finally { await db.close(); }
});

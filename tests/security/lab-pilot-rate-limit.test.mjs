import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';

const pilotUrl = 'https://lgwmxqjwgkzktikhkebp.supabase.co';
const source = ts.transpileModule(readFileSync(new URL('../../lib/rate-limit.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const sql = readFileSync(new URL('../../scripts/lab-pilot-rate-limit.sql', import.meta.url), 'utf8');
const config = { namespace: 'lab-order-portal', limit: 10, windowSeconds: 31536000, failClosed: true };
const signature = 'public.consume_lab_pilot_rate_limit(text,text,text,integer,integer)';

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    create table public.studio_labs(id integer primary key);
    create table existing_customer_canary (id integer primary key, payload jsonb);
    insert into existing_customer_canary values (1,'{"price":1475,"assignment":"existing","paid":true}');`);
  await db.query("select set_config('studio_os.lab_pilot_project_ref',$1,false)", ['lgwmxqjwgkzktikhkebp']);
  await db.exec(sql);
  return db;
}

async function consume(db, body, role = 'service_role') {
  assert.ok(['service_role', 'authenticated', 'anon'].includes(role));
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    const result = await tx.query('select public.consume_lab_pilot_rate_limit($1,$2,$3,$4,$5) as result',
      [body.p_prefix, body.p_namespace, body.p_key, body.p_limit, body.p_window_seconds]);
    return result.rows[0].result;
  });
}

function limiter({ db, overrides = {}, fetchImpl } = {}) {
  const env = { NODE_ENV: 'production', STUDIO_OS_LAB_PILOT: '1', NEXT_PUBLIC_SUPABASE_URL: pilotUrl,
    SUPABASE_SERVICE_ROLE_KEY: 'isolated-synthetic-service-key', RATE_LIMIT_KEY_PREFIX: 'lab-pilot', ...overrides };
  const observed = { fetch: [], redis: 0, timeouts: [] };
  class Redis { constructor() { observed.redis += 1; assert.fail('Pilot must not initialize Redis'); } }
  class Ratelimit { constructor() { assert.fail('Pilot must not initialize an Upstash limiter'); } }
  const exports = {};
  vm.runInNewContext(source, {
    exports, process: { env }, Date, Map, console: { warn() {} },
    AbortSignal: { timeout: milliseconds => { observed.timeouts.push(milliseconds); return AbortSignal.timeout(milliseconds); } },
    fetch: async (url, options) => {
      observed.fetch.push({ url, options });
      if (fetchImpl) return fetchImpl(url, options);
      const result = await consume(db, JSON.parse(options.body));
      return { ok: true, json: async () => result };
    },
    require: name => {
      if (name === '@upstash/redis') return { Redis };
      if (name === '@upstash/ratelimit') return { Ratelimit };
      assert.fail(`Unexpected dependency ${name}`);
    },
  });
  return { ...exports, env, observed };
}

test('standalone pilot SQL refuses absent/wrong target attestation and missing lab schema before creating objects', async () => {
  const db = new PGlite();
  try {
    for (const projectRef of [null, 'production-ref']) {
      if (projectRef) await db.query("select set_config('studio_os.lab_pilot_project_ref',$1,false)", [projectRef]);
      await assert.rejects(() => db.exec(sql), /LAB_PILOT_EXPLICIT_ISOLATED_PROJECT_REQUIRED/);
      await db.exec('rollback');
      assert.equal((await db.query("select to_regnamespace('lab_pilot') as value")).rows[0].value, null);
      assert.equal((await db.query("select to_regprocedure($1) as value", [signature])).rows[0].value, null);
    }
    await db.query("select set_config('studio_os.lab_pilot_project_ref',$1,false)", ['lgwmxqjwgkzktikhkebp']);
    await assert.rejects(() => db.exec(sql), /LAB_PILOT_LAB_SCHEMA_REQUIRED/);
    await db.exec('rollback');
    assert.equal((await db.query("select to_regnamespace('lab_pilot') as value")).rows[0].value, null);
  } finally { await db.close(); }
});

test('actual pilot SQL allows only the service RPC, hashes keys, is repeatable and preserves existing data', async () => {
  const db = await database();
  try {
    const before = JSON.stringify((await db.query('select * from existing_customer_canary order by id')).rows);
    await db.exec(sql);
    const body = { p_prefix: 'lab-pilot', p_namespace: 'lab-order-portal', p_key: 'private-user-or-ip', p_limit: 2, p_window_seconds: 3600 };
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(() => consume(db, body, role), /permission denied/);
    }
    const permissions = await db.query(`select
      has_function_privilege('service_role',$1,'execute') as service,
      has_function_privilege('anon',$1,'execute') as anon,
      has_function_privilege('authenticated',$1,'execute') as authenticated`, [signature]);
    assert.deepEqual(permissions.rows[0], { service: true, anon: false, authenticated: false });
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await assert.rejects(() => db.transaction(async tx => {
        await tx.exec(`set local role ${role}`);
        return tx.query('select * from lab_pilot.rate_limit_counters');
      }), /permission denied/);
    }
    assert.equal((await consume(db, body)).remaining, 1);
    assert.equal((await consume(db, body)).remaining, 0);
    assert.equal((await consume(db, body)).allowed, false);
    const rows = (await db.query('select encode(key_hash,\'hex\') as key_hash,request_count from lab_pilot.rate_limit_counters')).rows;
    assert.match(rows[0].key_hash, /^[a-f0-9]{64}$/);
    assert.equal(Number(rows[0].request_count), 3);
    assert.equal(JSON.stringify((await db.query('select * from existing_customer_canary order by id')).rows), before);
    const snapshot = JSON.stringify((await db.query('select * from lab_pilot.rate_limit_counters')).rows);
    for (const invalid of [{ p_prefix: '' }, { p_prefix: 'pilot:production' }, { p_prefix: 'x'.repeat(65) },
      { p_key: '' }, { p_key: 'x'.repeat(1025) }, { p_namespace: '' }, { p_limit: 0 }, { p_limit: 1000001 }, { p_window_seconds: 0 }]) {
      await assert.rejects(() => consume(db, { ...body, ...invalid }), /Invalid pilot counter arguments/);
    }
    assert.equal(JSON.stringify((await db.query('select * from lab_pilot.rate_limit_counters')).rows), snapshot, 'Invalid calls never modify a counter');
  } finally { await db.close(); }
});

test('separate production handler instances share the atomic SQL budget under concurrent calls without Redis', async () => {
  const db = await database();
  try {
    const one = limiter({ db }), two = limiter({ db });
    const results = await Promise.all(Array.from({ length: 40 }, (_, index) =>
      (index % 2 ? one : two).rateLimit('same-user', config)));
    assert.equal(results.filter(result => result.allowed).length, config.limit);
    assert.equal(results.filter(result => !result.allowed).length, 30);
    assert.equal(Number((await db.query('select request_count from lab_pilot.rate_limit_counters')).rows[0].request_count), 40);
    assert.equal(new Set(results.map(result => result.resetAt)).size, 1);
    for (const f of [one, two]) {
      assert.equal(f.observed.redis, 0);
      assert.ok(f.observed.timeouts.every(timeout => timeout === 5000));
      for (const { url, options } of f.observed.fetch) {
        assert.equal(url, `${pilotUrl}/rest/v1/rpc/consume_lab_pilot_rate_limit`);
        assert.equal(options.headers.apikey, 'isolated-synthetic-service-key');
        assert.equal(options.headers.Authorization, 'Bearer isolated-synthetic-service-key');
        assert.equal(options.redirect, 'error');
        assert.equal(options.cache, 'no-store');
        assert.equal(JSON.parse(options.body).p_prefix, 'lab-pilot');
      }
    }
    const otherPrefix = limiter({ db, overrides: { RATE_LIMIT_KEY_PREFIX: 'other-pilot' } });
    assert.equal((await otherPrefix.rateLimit('same-user', config)).allowed, true);
    assert.equal((await one.rateLimit('other-user', config)).allowed, true);
    assert.equal((await one.rateLimit('same-user', { ...config, namespace: 'other-lab-route' })).allowed, true);
  } finally { await db.close(); }
});

test('expired SQL windows reset atomically and an older request cannot roll a newer window backwards', async () => {
  const db = await database();
  try {
    const f = limiter({ db });
    await f.rateLimit('same-user', { ...config, limit: 1 });
    assert.equal((await f.rateLimit('same-user', { ...config, limit: 1 })).allowed, false);
    await db.exec("update lab_pilot.rate_limit_counters set window_started_at=window_started_at-interval '1 day',reset_at=reset_at-interval '1 day'");
    assert.equal((await f.rateLimit('same-user', { ...config, limit: 1 })).allowed, true);
    await db.exec("update lab_pilot.rate_limit_counters set window_started_at=window_started_at+interval '1 day',reset_at=reset_at+interval '1 day'");
    const future = (await db.query('select reset_at from lab_pilot.rate_limit_counters')).rows[0].reset_at;
    assert.equal((await f.rateLimit('same-user', { ...config, limit: 1 })).allowed, false);
    assert.equal((await db.query('select reset_at from lab_pilot.rate_limit_counters')).rows[0].reset_at.getTime(), future.getTime());
  } finally { await db.close(); }
});

test('pilot flag on any other backend or with a missing prefix denies before any provider call', async () => {
  for (const overrides of [
    { NEXT_PUBLIC_SUPABASE_URL: 'https://production.supabase.co' },
    { NEXT_PUBLIC_SUPABASE_URL: `${pilotUrl}/` }, { NEXT_PUBLIC_SUPABASE_URL: '' },
    { RATE_LIMIT_KEY_PREFIX: '' }, { RATE_LIMIT_KEY_PREFIX: 'pilot:production' },
  ]) {
    const f = limiter({ overrides });
    for (const failClosed of [true, false]) {
      const result = await f.rateLimit('same-user', { ...config, failClosed });
      assert.equal(result.allowed, false);
      assert.equal(result.unavailable, true);
    }
    assert.equal(f.observed.fetch.length, 0);
    assert.equal(f.observed.redis, 0);
  }
});

test('pilot missing credentials, timeout, RPC error and malformed responses retain the callers outage policy without memory fallback', async () => {
  const cases = [
    { overrides: { SUPABASE_SERVICE_ROLE_KEY: '' } },
    { fetchImpl: async () => { throw new DOMException('Synthetic timeout', 'TimeoutError'); } },
    { fetchImpl: async () => ({ ok: false }) },
    { fetchImpl: async () => ({ ok: true, json: async () => null }) },
    { fetchImpl: async () => ({ ok: true, json: async () => ({ allowed: true, remaining: -1, resetAt: 123 }) }) },
    { fetchImpl: async () => ({ ok: true, json: async () => ({ allowed: 'yes', remaining: 1, resetAt: 123 }) }) },
  ];
  for (const options of cases) {
    const f = limiter(options);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const closed = await f.rateLimit('same-user', config);
      assert.equal(closed.allowed, false);
      assert.equal(closed.remaining, 0);
      assert.equal(closed.unavailable, true);
      const available = await f.rateLimit('same-user', { ...config, failClosed: false });
      assert.equal(available.allowed, true);
      assert.equal(available.remaining, config.limit);
      assert.equal(available.unavailable, undefined);
    }
    assert.equal(f.observed.redis, 0);
  }
});

test('the exact pilot backend alone does not enable the adapter without the explicit pilot flag', async () => {
  const f = limiter({ overrides: { STUDIO_OS_LAB_PILOT: '0' } });
  const result = await f.rateLimit('same-user', config);
  assert.equal(result.allowed, false, 'Normal production authentication still needs its existing shared counter');
  assert.equal(result.unavailable, true);
  assert.equal(f.observed.fetch.length, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { resolveOnlineBackdropsEnabled, readOnlineBackdropPolicy, assertNewOnlineBackdropPurchase, assertPendingOnlineBackdropOrders } from '../lib/online-backdrop-policy.ts';

const owner = '10000000-0000-4000-8000-000000000001';
const school = '20000000-0000-4000-8000-000000000001';
const otherSchool = '20000000-0000-4000-8000-000000000002';
const user = '30000000-0000-4000-8000-000000000001';
const migration = readFileSync(new URL('../supabase/migrations/20261010190000_online_backdrop_controls.sql', import.meta.url), 'utf8');

test('default inheritance and school exceptions preserve legacy On and every explicit On/Off choice', () => {
  for (const studio of [true, false]) {
    assert.equal(resolveOnlineBackdropsEnabled(studio, null), studio);
    assert.equal(resolveOnlineBackdropsEnabled(studio, undefined), studio);
    assert.equal(resolveOnlineBackdropsEnabled(studio, true), true);
    assert.equal(resolveOnlineBackdropsEnabled(studio, false), false);
  }
  assert.equal(resolveOnlineBackdropsEnabled(undefined), true);
  assert.equal(resolveOnlineBackdropsEnabled(null), true);
});

async function database(t) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.photographers(id uuid primary key,user_id uuid,business_name text);
    create table public.schools(id uuid primary key,photographer_id uuid,gallery_settings jsonb);
    create table public.photos(id text primary key, original_key text, cutout_key text);
    create table public.orders(id text primary key, payment_status text, cart_snapshot jsonb);
    insert into photographers values ('${owner}','${user}','Fixture studio');
    insert into schools values ('${school}','${owner}','{"header":{"title":"Existing gallery"}}');
    insert into schools values ('${otherSchool}','${owner}','{}');
    insert into photos values ('photo','originals/pose.jpg','nobg-photos/pose.jpg.png');
    insert into orders values ('paid','paid','[{"backdrop":{"id":"blue"},"selectedImageUrl":"originals/pose.jpg"}]');`);
  const before = await db.query('select * from photos;');
  const paidBefore = await db.query('select * from orders;');
  await db.exec(migration);
  const reads = [], writes = [];
  const service = { from(table) {
    assert.ok(['photographers', 'schools'].includes(table));
    let columns = '*', values; const filters = [];
    const chain = {
      select(fields) { columns = fields; return chain; },
      eq(key, value) { filters.push([key, value]); return chain; },
      update(patch) { values = patch; return chain; },
      maybeSingle: execute,
      then(resolve, reject) { return execute().then(resolve, reject); },
    };
    async function execute() {
      const params = [];
      let sql = `select ${columns} from ${table}`;
      if (values) {
        writes.push(structuredClone(values));
        sql = `update ${table} set ${Object.entries(values).map(([key, value]) => {
          assert.match(key, /^[a-z_]+$/); params.push(value); return `${key}=$${params.length}`;
        }).join(',')}`;
      } else reads.push(table);
      if (filters.length) sql += ` where ${filters.map(([key, value]) => {
        assert.match(key, /^[a-z_]+$/); params.push(value); return `${key}=$${params.length}`;
      }).join(' and ')}`;
      if (values) sql += ` returning ${columns}`;
      try { return { data: (await db.query(sql, params)).rows[0] ?? null, error: null }; }
      catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
    }
    return chain;
  } };
  return { db, service, before: before.rows, paidBefore: paidBefore.rows, reads, writes };
}

test('migration keeps current originals, cutouts, paid snapshots and gallery settings; repeated application is safe', async t => {
  const f = await database(t);
  assert.deepEqual((await f.db.query('select * from photos')).rows, f.before);
  assert.deepEqual((await f.db.query('select * from orders')).rows, f.paidBefore);
  assert.deepEqual((await f.db.query('select online_backdrops_enabled from photographers')).rows, [{ online_backdrops_enabled: true }]);
  assert.equal((await readOnlineBackdropPolicy(f.service, { photographerId: owner, schoolId: school })).enabled, true);
  await f.db.query('update photographers set online_backdrops_enabled=false');
  await f.db.query('update schools set online_backdrops_override=true where id=$1', [school]);
  await f.db.exec(migration);
  assert.equal((await readOnlineBackdropPolicy(f.service, { photographerId: owner, schoolId: school })).enabled, true);
  assert.equal((await readOnlineBackdropPolicy(f.service, { photographerId: owner, schoolId: otherSchool })).enabled, false);
  await f.db.query('update schools set gallery_settings=$1 where id=$2', [{ header: { title: 'Desktop synced' } }, school]);
  assert.equal((await readOnlineBackdropPolicy(f.service, { photographerId: owner, schoolId: school })).schoolOverride, true);
  assert.deepEqual((await f.db.query('select * from photos')).rows, f.before);
  assert.deepEqual((await f.db.query('select * from orders')).rows, f.paidBefore);
});

test('policy schema readiness is service-only and direct anonymous/authenticated policy writes are rejected', async t => {
  const f = await database(t);
  assert.deepEqual((await f.db.query('select public.online_backdrop_policy_schema_status() as status')).rows[0].status,
    { version: 1, columns_ready: true, client_policy_guard_ready: true, service_only: true });
  await f.db.exec('grant select,insert,update on photographers,schools to authenticated; set role authenticated;');
  await assert.rejects(f.db.exec('update photographers set online_backdrops_enabled=false'), /Save online backdrop settings/);
  await assert.rejects(f.db.exec('update schools set online_backdrops_override=false'), /Save gallery backdrop settings/);
  await assert.rejects(f.db.query('select public.online_backdrop_policy_schema_status()'), /permission denied/);
  await f.db.query('update schools set gallery_settings=$1 where id=$2', [{ allowDownload: true }, school]);
  await f.db.exec('reset role');
  assert.equal((await readOnlineBackdropPolicy(f.service, { photographerId: owner, schoolId: school })).enabled, true);
});

test('policy reads fail closed for missing studio, cross-owner gallery and unexpected database errors', async t => {
  const f = await database(t);
  await assert.rejects(readOnlineBackdropPolicy(f.service, { photographerId: user, schoolId: school }), /Studio backdrop policy/);
  await f.db.query('update schools set photographer_id=$1 where id=$2', [user, school]);
  await assert.rejects(readOnlineBackdropPolicy(f.service, { photographerId: owner, schoolId: school }), /Gallery backdrop policy/);
  const unavailable = { from() { return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: null, error: { code: '57014', message: 'timeout' } }) }; } };
  await assert.rejects(readOnlineBackdropPolicy(unavailable, { photographerId: owner }), error => error.code === '57014');
});

test('missing legacy columns keep prior behavior without swallowing unrelated errors or losing known default Off', async t => {
  const f = await database(t);
  await f.db.exec('drop trigger protect_online_backdrop_policy on photographers; drop trigger protect_online_backdrop_policy on schools;');
  await f.db.exec('alter table schools drop column online_backdrops_override;');
  await f.db.exec('update photographers set online_backdrops_enabled=false;');
  assert.equal((await readOnlineBackdropPolicy(f.service, { photographerId: owner, schoolId: school })).enabled, false);
  await f.db.exec('alter table photographers drop column online_backdrops_enabled;');
  assert.equal((await readOnlineBackdropPolicy(f.service, { photographerId: owner, schoolId: school })).enabled, true);
});

test('only chosen-background new purchases read policy; school exceptions are checked per saved scope without mutations', async t => {
  const f = await database(t);
  await f.db.query('update photographers set online_backdrops_enabled=false');
  await assertNewOnlineBackdropPurchase(f.service, { photographerId: owner, schoolId: school }, false);
  assert.equal(f.reads.length, 0);
  await assert.rejects(assertNewOnlineBackdropPurchase(f.service, { photographerId: owner, schoolId: school }, true), /Background changes are no longer available/);
  await f.db.query('update schools set online_backdrops_override=true where id=$1', [school]);
  const saved = [{ photographer_id: owner, school_id: school, cart_snapshot: [{ backdrop: { id: 'blue' } }] },
    { photographer_id: owner, school_id: otherSchool, cart_snapshot: [{ backdrop: { id: 'blue' } }] }];
  const before = structuredClone(saved);
  await assert.rejects(assertPendingOnlineBackdropOrders(f.service, saved), /Background changes are no longer available/);
  assert.deepEqual(saved, before); assert.equal(f.writes.length, 0);
});

function settingsRoute(service, auth, audits = [], auditRecorder = async params => { audits.push(params); }) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../app/api/dashboard/backdrop-settings/route.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', 'console', source)(name => {
    if (name === 'next/server') return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    if (name === '@/lib/dashboard-auth') return { resolveDashboardAuth: async () => auth, createDashboardServiceClient: () => service };
    if (name === '@/lib/audit') return { recordAudit: auditRecorder };
    throw new Error(`Unexpected dependency ${name}`);
  }, exports, { error() {} });
  return exports;
}

test('owner settings API saves only the authenticated studio, persists On/Off and refuses stale or forged patches', async t => {
  const f = await database(t);
  const audits = [];
  const route = settingsRoute(f.service, { user: { id: user }, mfaSatisfied: true }, audits);
  const patch = body => route.PATCH({ json: async () => body });
  assert.deepEqual(await (await route.GET({})).json(), { onlineBackdropsEnabled: true });
  assert.equal((await patch({ onlineBackdropsEnabled: false, expectedOnlineBackdropsEnabled: true })).status, 200);
  assert.deepEqual(await (await route.GET({})).json(), { onlineBackdropsEnabled: false });
  assert.equal((await patch({ onlineBackdropsEnabled: true, expectedOnlineBackdropsEnabled: true })).status, 409);
  assert.equal((await patch({ onlineBackdropsEnabled: 'false' })).status, 400);
  assert.equal((await patch({ onlineBackdropsEnabled: true, photographerId: owner })).status, 400);
  assert.equal((await patch({ onlineBackdropsEnabled: true, expectedOnlineBackdropsEnabled: false })).status, 200);
  assert.deepEqual((await f.db.query('select * from orders')).rows, f.paidBefore);
  assert.equal(audits.length, 2, 'only confirmed successful updates are audited');
  assert.deepEqual(audits.map(audit => ({ before: audit.before, after: audit.after })), [
    { before: { online_backdrops_enabled: true }, after: { online_backdrops_enabled: false } },
    { before: { online_backdrops_enabled: false }, after: { online_backdrops_enabled: true } },
  ]);
  assert.ok(audits.every(audit => audit.actorUserId === user && audit.actorPhotographerId === owner &&
    audit.entityId === owner && audit.targetPhotographerId === owner && audit.result === 'ok'));
});

test('successful studio CAS audits the matched prior value after another tab changes it between read and update', async t => {
  const f = await database(t), audits = [];
  let intervened = false;
  const racingService = { from(table) {
    const chain = f.service.from(table);
    const update = chain.update.bind(chain);
    chain.update = patch => {
      const query = update(patch);
      const execute = query.maybeSingle.bind(query);
      query.maybeSingle = async () => {
        assert.equal(intervened, false);
        // The handler has already read On. A separate tab now saves Off,
        // matching the caller's expected Off just before the real SQL CAS.
        intervened = true;
        await f.db.query('update photographers set online_backdrops_enabled=false where id=$1', [owner]);
        return execute();
      };
      return query;
    };
    return chain;
  } };
  const route = settingsRoute(racingService, { user: { id: user }, mfaSatisfied: true }, audits);
  const response = await route.PATCH({ json: async () => ({
    onlineBackdropsEnabled: true, expectedOnlineBackdropsEnabled: false,
  }) });
  assert.equal(response.status, 200);
  assert.equal(intervened, true);
  assert.equal((await readOnlineBackdropPolicy(f.service, { photographerId: owner })).enabled, true);
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0].before, { online_backdrops_enabled: false });
  assert.deepEqual(audits[0].after, { online_backdrops_enabled: true });
  assert.deepEqual((await f.db.query('select * from orders')).rows, f.paidBefore);
});
test('settings endpoint rejects anonymous, MFA-incomplete and cross-owner users before a preference write', async t => {
  const f = await database(t);
  const audits = [];
  for (const [auth, status] of [
    [{ user: null, mfaSatisfied: false }, 401],
    [{ user: { id: user }, mfaSatisfied: false }, 403],
    [{ user: { id: user } }, 403],
    [{ user: { id: user }, mfaSatisfied: 'true' }, 403],
    [{ user: { id: owner }, mfaSatisfied: true }, 403],
  ]) {
    const route = settingsRoute(f.service, auth, audits);
    assert.equal((await route.GET({})).status, status);
    assert.equal((await route.PATCH({ json: async () => ({ onlineBackdropsEnabled: false }) })).status, status);
  }
  assert.equal(f.writes.length, 0);
  assert.equal(audits.length, 0);
});

test('a failed audit insert never turns a confirmed studio preference save into an error or touches paid selections', async t => {
  const f = await database(t);
  const auditModule = {}, warnings = [], inserts = [];
  const compiled = ts.transpileModule(readFileSync(new URL('../lib/audit.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', 'console', compiled)(name => {
    if (name === '@/lib/dashboard-auth') return { createDashboardServiceClient: () => ({
      from(table) {
        assert.equal(table, 'audit_log');
        return { insert: async row => { inserts.push(row); return { error: { message: 'Audit store unavailable' } }; } };
      },
    }) };
    if (name === '@/lib/rate-limit') return { getClientIp: () => 'fixture' };
    throw new Error(`Unexpected audit dependency ${name}`);
  }, auditModule, { warn: (...args) => warnings.push(args) });
  const route = settingsRoute(f.service, { user: { id: user }, mfaSatisfied: true }, [], auditModule.recordAudit);
  const response = await route.PATCH({ headers: new Headers(), json: async () => ({
    onlineBackdropsEnabled: false, expectedOnlineBackdropsEnabled: true,
  }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).onlineBackdropsEnabled, false);
  assert.equal((await readOnlineBackdropPolicy(f.service, { photographerId: owner })).enabled, false);
  assert.equal(inserts.length, 1);
  assert.equal(warnings.length, 1);
  assert.deepEqual(inserts[0].before, { online_backdrops_enabled: true });
  assert.deepEqual(inserts[0].after, { online_backdrops_enabled: false });
  assert.deepEqual((await f.db.query('select * from orders')).rows, f.paidBefore);
});

test('unavailable settings schema returns a retryable error and never claims the toggle was saved', async t => {
  const f = await database(t);
  await f.db.exec('drop trigger protect_online_backdrop_policy on photographers; alter table photographers drop column online_backdrops_enabled;');
  const route = settingsRoute(f.service, { user: { id: user }, mfaSatisfied: true });
  assert.equal((await route.GET({})).status, 503);
  const response = await route.PATCH({ json: async () => ({ onlineBackdropsEnabled: false }) });
  assert.equal(response.status, 503);
  const result = await response.json();
  assert.match(result.error, /Could not save/);
  assert.equal(result.ok, undefined); assert.equal(result.onlineBackdropsEnabled, undefined);
  assert.equal(f.writes.length, 0);
});

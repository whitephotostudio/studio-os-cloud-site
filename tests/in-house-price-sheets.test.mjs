import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import ts from 'typescript';
import { z } from 'zod';
import { createLabDatabase, LAB_FIXTURE, fixtureToken, seedLegacyLabCanaries, snapshotLegacyLabFixture } from '../scripts/lab-system-fixture.mjs';

function load(file, deps = {}) {
  const code = ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(name => { if (!(name in deps)) throw Error(`Missing dependency ${name}`); return deps[name]; }, exports);
  return exports;
}
const money = load('lib/labs/money.ts');
const validation = load('lib/labs/validation.ts', { zod: { z }, './money': money });
const imports = load('lib/labs/in-house-validation.ts', { 'node:crypto': crypto, zod: { z }, './money': money, './validation': validation });
const starters = load('lib/labs/starters.ts', { './money': money });
const server = load('lib/labs/server.ts', { 'node:crypto': crypto, './validation': validation, './money': money, './starters': starters, './country-profiles': { loadLabCountryProfiles: async () => ({ available: false, options: [] }) }, '@/lib/dashboard-auth': {}, '@/lib/rate-limit': {} });
const inHouseServer = load('lib/labs/in-house-server.ts', { 'node:crypto': crypto, './server': server, './validation': validation });

function sourceSheet() {
  const sourceSnapshot = { profile: { id: 'fixture-school-prices', name: 'Original synthetic school prices', options: { composites: true } },
    individual: { '5x7': 7.67, wallets: 28.67 }, packages: [{ id: 'digital-and-prints', price: 38.67, contents: [{ name: '5x7', qty: 2 }, { name: 'Digital', qty: 1 }] }], specialty: [{ name: 'Retouch', price: 11.67 }], tax: { enabled: true, label: 'HST', percent: 13 } };
  return { name: 'Private synthetic in-house copy', studioName: 'Synthetic private studio', currency: 'CAD',
    source: { profileId: 'fixture-school-prices', profileName: 'Original synthetic school prices', contentHash: imports.inHouseSourceHash(sourceSnapshot) },
    entries: [
      { id: 'individual-5x7', sourceKey: 'individual.5x7', section: 'individual', name: '5×7 Lustre', retailCents: 767, active: true, category: 'print', contents: [], original: { price: 7.67 } },
      { id: 'mixed-package', sourceKey: 'packages.digital-and-prints', section: 'package', name: 'Mixed digital and print package', retailCents: 3867, active: true, category: 'package', contents: [{ name: '5x7', qty: 2, finish: 'Lustre' }, { name: 'Digital', qty: 1, type: 'digital' }], original: { price: 38.67, multiPose: true, composite: false } },
      { id: 'wallets', sourceKey: 'individual.wallets', section: 'individual', name: 'Wallets — layout unspecified', retailCents: 2867, active: false, category: 'print', contents: ['Wallet sheet'], original: { price: 28.67 } },
      { id: 'retouch', sourceKey: 'specialty.0', section: 'specialty', name: 'Retouch', retailCents: 1167, active: true, category: 'specialty', contents: [], original: { price: 11.67 } },
    ], warnings: ['Wallet layout remains unspecified.'], tax: { enabled: true, percent: 13, label: 'HST' }, sourceSnapshot };
}
function action(value = sourceSheet()) { return imports.parseInHousePriceSheetAction({ action: 'import', sheet: value }); }
async function service(db, fn) { return db.transaction(async tx => { await tx.exec('set local role service_role'); return fn(tx); }); }
async function rpc(db, user, kind, id, version, document) {
  return service(db, async tx => (await tx.query('select save_in_house_price_sheet($1,$2,$3,$4,$5::jsonb) as result', [user, kind, id, version, JSON.stringify(document)])).rows[0].result);
}
async function readAs(db, user, role = 'authenticated') {
  return db.transaction(async tx => { await tx.exec(`set local role ${role}`); await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [user]); return (await tx.query('select * from in_house_price_sheets order by id')).rows; });
}
function edits(sheet, overrides = {}) { return { name: 'My edited private copy', entries: sheet.entries.map(entry => ({ id: entry.id, retailCents: entry.retailCents + 100, active: !entry.active })), ...overrides }; }

test('strict private import preserves exact retail/content/tax data and hashes source objects canonically', () => {
  const input = sourceSheet(), parsed = action(input);
  assert.deepEqual(parsed.sheet, input);
  assert.equal(imports.inHouseSourceHash({ z: [1, { b: 2, a: null }], a: 'CAD' }), imports.inHouseSourceHash({ a: 'CAD', z: [1, { a: null, b: 2 }] }));
  assert.notEqual(imports.inHouseSourceHash({ a: [1, 2] }), imports.inHouseSourceHash({ a: [2, 1] }));
  for (const price of [-1, 7.67, NaN, Infinity, 100_000_001]) assert.throws(() => action({ ...input, entries: [{ ...input.entries[0], retailCents: price }] }));
  for (const extra of [{ photographerId: crypto.randomUUID() }, { assignments: [] }, { status: 'published' }, { costCents: 1 }, { fulfillment: 'lab' }]) assert.throws(() => action({ ...input, ...extra }));
  assert.throws(() => action({ ...input, source: { ...input.source, contentHash: 'a'.repeat(64) } }), error => error.code === 'IN_HOUSE_SOURCE_CHANGED');
  assert.throws(() => action({ ...input, entries: [input.entries[0], input.entries[0]] }), /unique/);
  assert.throws(() => action({ ...input, entries: [{ ...input.entries[0], original: JSON.parse('{"__proto__":{"polluted":true}}') }] }), /setting key/);
  assert.throws(() => action({ ...input, tax: { enabled: true, percent: 101, label: 'Invalid' } }));
  assert.throws(() => action({ ...input, currency: 'ZZZ' }));
  const deep = {}; let item = deep; for (let i = 0; i < 30; i++) { item.child = {}; item = item.child; }
  assert.throws(() => action({ ...input, sourceSnapshot: deep }), /nested data/);
});

test('private save accepts only names, exact minor prices and active flags, never source/content/routing mutations', () => {
  const save = { action: 'save', id: crypto.randomUUID(), expectedVersion: 1, ...edits(sourceSheet()) };
  assert.equal(imports.parseInHousePriceSheetAction(save).entries[1].retailCents, 3967);
  for (const extra of [{ sourceSnapshot: {} }, { tax: { enabled: false, percent: 0, label: '' } }, { source: {} }, { studioName: 'Changed' }, { assignments: [] }, { entries: [{ ...save.entries[0], contents: [] }] }]) assert.throws(() => imports.parseInHousePriceSheetAction({ ...save, ...extra }));
  assert.throws(() => imports.parseInHousePriceSheetAction({ ...save, entries: [save.entries[0], save.entries[0]] }), /unique/);
  assert.throws(() => imports.parseInHousePriceSheetAction({ ...save, expectedVersion: 0 }));
});

test('SQL imports owner-private retail copies, freezes source fields, rejects stale/foreign edits and keeps legacy data exact', async () => {
  const db = await createLabDatabase();
  try {
    await seedLegacyLabCanaries(db);
    const before = await snapshotLegacyLabFixture(db), original = sourceSheet(), id = crypto.randomUUID();
    const labBefore = (await db.query('select * from studio_labs order by id')).rows;
    const catalogBefore = (await db.query('select * from studio_lab_catalog order by id')).rows;
    const imported = await rpc(db, LAB_FIXTURE.owner, 'import', id, 0, original);
    assert.equal(imported.version, 1); assert.equal(imported.replayed, false);
    assert.deepEqual(imported.document, original);
    assert.equal((await readAs(db, LAB_FIXTURE.owner)).length, 1);
    for (const user of [LAB_FIXTURE.otherOwner, LAB_FIXTURE.labOwner, LAB_FIXTURE.labOperator, LAB_FIXTURE.admin]) assert.deepEqual(await readAs(db, user), [], 'Neither another studio, provisioned lab staff nor a platform administrator can read this private retail copy');
    await assert.rejects(() => readAs(db, LAB_FIXTURE.owner, 'anon'), error => error.code === '42501');
    await assert.rejects(() => db.transaction(async tx => { await tx.exec('set local role authenticated'); return tx.query('select save_in_house_price_sheet($1,$2,$3,0,$4::jsonb)', [LAB_FIXTURE.owner, 'import', crypto.randomUUID(), JSON.stringify(original)]); }), error => error.code === '42501');
    await assert.rejects(() => service(db, tx => tx.query('update in_house_price_sheets set name=$1 where id=$2', ['Bypass', id])), error => error.code === '42501');
    const edit = edits(original), saved = await rpc(db, LAB_FIXTURE.owner, 'save', id, 1, edit);
    assert.equal(saved.version, 2); assert.equal(saved.document.name, edit.name);
    assert.deepEqual(saved.document.entries.map(entry => ({ id: entry.id, retailCents: entry.retailCents, active: entry.active })), edit.entries);
    assert.deepEqual({ ...saved.document, name: original.name, entries: saved.document.entries.map((entry, index) => ({ ...entry, retailCents: original.entries[index].retailCents, active: original.entries[index].active })) }, original, 'All source, names, opaque contents/options, tax and warnings remain unchanged');
    for (const user of [LAB_FIXTURE.otherOwner, LAB_FIXTURE.labOwner]) await assert.rejects(() => rpc(db, user, 'save', id, 2, edit), error => error.code === '42501');
    await assert.rejects(() => rpc(db, LAB_FIXTURE.owner, 'save', id, 1, edit), error => error.code === 'PT409' && error.message === 'IN_HOUSE_VERSION_CONFLICT');
    for (const invalid of [{ ...edit, sourceSnapshot: {} }, { ...edit, entries: edit.entries.slice(1) }, { ...edit, entries: [...edit.entries.slice(1), edit.entries[1]] }, { ...edit, entries: edit.entries.map((entry, index) => index ? entry : { ...entry, id: 'foreign-item' }) }, { ...edit, entries: edit.entries.map((entry, index) => index ? entry : { ...entry, contents: [] }) }]) await assert.rejects(() => rpc(db, LAB_FIXTURE.owner, 'save', id, 2, invalid));
    const retry = await rpc(db, LAB_FIXTURE.owner, 'import', crypto.randomUUID(), 0, original);
    assert.equal(retry.id, id); assert.equal(retry.version, 2); assert.equal(retry.replayed, true); assert.deepEqual(retry.document, saved.document, 'Source import retry never overwrites local test edits');
    const altered = structuredClone(original); altered.sourceSnapshot.profile.name = 'Different source with reused hash';
    await assert.rejects(() => rpc(db, LAB_FIXTURE.owner, 'import', crypto.randomUUID(), 0, altered), error => error.code === 'PT409' && error.message === 'IN_HOUSE_SOURCE_CHANGED');
    assert.deepEqual((await db.query('select document,version from in_house_price_sheets where id=$1', [id])).rows[0], { document: saved.document, version: 2 });
    assert.equal(await snapshotLegacyLabFixture(db), before);
    assert.deepEqual((await db.query('select * from studio_labs order by id')).rows, labBefore);
    assert.deepEqual((await db.query('select * from studio_lab_catalog order by id')).rows, catalogBefore);
  } finally { await db.close(); }
});

test('additive SQL migration preserves every existing school/profile/package/order and enforces allocation limits', async () => {
  let before;
  const db = await createLabDatabase({ beforeInHouseMigration: async database => { await seedLegacyLabCanaries(database); before = await snapshotLegacyLabFixture(database); } });
  try {
    assert.equal(await snapshotLegacyLabFixture(db), before, 'Applying the new schema writes no existing production records');
    const original = sourceSheet(), id = crypto.randomUUID();
    await rpc(db, LAB_FIXTURE.owner, 'import', id, 0, original);
    const tooMany = { ...original, source: { ...original.source, profileId: 'too-many-items' }, entries: Array.from({ length: 1001 }, (_, index) => ({ ...original.entries[0], id: `entry-${index}`, sourceKey: `row.${index}` })) };
    assert.throws(() => action(tooMany));
    await assert.rejects(() => rpc(db, LAB_FIXTURE.owner, 'import', crypto.randomUUID(), 0, tooMany), error => error.code === '22023');
    await db.query(`insert into in_house_price_sheets(id,photographer_id,source_profile_id,source_hash,name,studio_name,currency,document)
      select gen_random_uuid(),photographer_id,'limit-fixture-'||n,source_hash,name,studio_name,currency,
        jsonb_set(document,'{source,profileId}',to_jsonb('limit-fixture-'||n))
      from in_house_price_sheets cross join generate_series(1,199) n where id=$1`, [id]);
    await assert.rejects(() => rpc(db, LAB_FIXTURE.owner, 'import', crypto.randomUUID(), 0, { ...original, source: { ...original.source, profileId: 'over-limit' } }), error => error.message === 'IN_HOUSE_LIMIT');
    assert.equal((await rpc(db, LAB_FIXTURE.owner, 'import', crypto.randomUUID(), 0, original)).id, id, 'A safe retry still returns the prior receipt at the allocation limit');
    assert.equal((await db.query('select count(*)::int as count from in_house_price_sheets')).rows[0].count, 200);
    assert.equal(await snapshotLegacyLabFixture(db), before);
  } finally { await db.close(); }
});

function serviceFor(db) {
  return { from(table) {
    const filters = [], order = []; let limit = 200;
    const query = { select() { return query; }, eq(key, value) { filters.push([key, value]); return query; }, order(key, options = {}) { order.push([key, options.ascending === false ? 'desc' : 'asc']); return query; }, limit(value) { limit = value; return query; },
      then(resolve, reject) { return db.query(`select * from "${table}"${filters.length ? ' where ' + filters.map(([key], index) => `"${key}"=$${index + 1}`).join(' and ') : ''}${order.length ? ' order by ' + order.map(([key, direction]) => `"${key}" ${direction}`).join(',') : ''} limit ${limit}`, filters.map(([, value]) => value)).then(result => ({ data: result.rows, error: null }), error => ({ data: null, error: { code: error.code, message: error.message } })).then(resolve, reject); } }; return query;
  }, async rpc(name, args) {
    assert.equal(name, 'save_in_house_price_sheet');
    try { return { data: await rpc(db, args.p_user_id, args.p_action, args.p_id, args.p_expected_version, args.p_document), error: null }; }
    catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
  } };
}

test('backend copy import/save/reload returns owner-scoped sheets and handles rolling missing schema only', async () => {
  // Reproduce the original price-copy rollout before the later test-order FK exists.
  const db = await createLabDatabase({ includeInHouseTestOrders: false });
  try {
    const access = { service: serviceFor(db), userId: LAB_FIXTURE.owner, photographerId: LAB_FIXTURE.photographer };
    const first = await inHouseServer.performInHousePriceSheetAction(access, action());
    assert.equal(first.sheets.length, 1); assert.equal(first.sheet.fulfillment, 'in_house'); assert.equal(first.sheet.status, 'draft');
    const saved = await inHouseServer.performInHousePriceSheetAction(access, imports.parseInHousePriceSheetAction({ action: 'save', id: first.sheet.id, expectedVersion: 1, ...edits(first.sheet) }));
    assert.equal(saved.sheet.version, 2); assert.deepEqual(await server.loadInHousePriceSheets(access), saved.sheets);
    assert.deepEqual(await server.loadInHousePriceSheets({ ...access, photographerId: LAB_FIXTURE.otherPhotographer, userId: LAB_FIXTURE.otherOwner }), []);
    const retry = await inHouseServer.performInHousePriceSheetAction(access, action());
    assert.equal(retry.replayed, true); assert.equal(retry.sheet.version, 2); assert.equal(retry.sheet.name, saved.sheet.name);
    await assert.rejects(() => inHouseServer.performInHousePriceSheetAction(access, { action: 'save', id: first.sheet.id, expectedVersion: 1, ...edits(first.sheet) }), error => error.code === 'IN_HOUSE_VERSION_CONFLICT' && error.status === 409);
    await db.exec('drop table in_house_price_sheets');
    assert.deepEqual(await server.loadInHousePriceSheets(access, true), []);
    await assert.rejects(() => server.loadInHousePriceSheets(access), error => error.code === 'IN_HOUSE_UNAVAILABLE');
    for (const error of [{ code: 'PGRST205', message: 'public.in_house_price_sheets missing from schema cache' }, { code: '42P01', message: 'relation missing' }]) {
      const unavailable = { ...access, service: { from() { const query = { select() { return query; }, eq() { return query; }, order() { return query; }, limit() { return Promise.resolve({ data: null, error }); } }; return query; } } };
      assert.deepEqual(await server.loadInHousePriceSheets(unavailable, true), []);
    }
    for (const error of [{ code: '42501', message: 'Permission denied' }, { code: 'PGRST205', message: 'public.different_table missing' }, { code: 'XX000', message: 'Database outage' }]) {
      const unavailable = { ...access, service: { from() { const query = { select() { return query; }, eq() { return query; }, order() { return query; }, limit() { return Promise.resolve({ data: null, error }); } }; return query; } } };
      await assert.rejects(() => server.loadInHousePriceSheets(unavailable, true), error => error.code === 'IN_HOUSE_UNAVAILABLE');
    }
  } finally { await db.close(); }
});

test('private price HTTP endpoint bounds streamed bodies, rejects routing/source edits and keeps no-store responses', async () => {
  let calls = 0;
  const route = load('app/api/dashboard/in-house-price-sheets/route.ts', { 'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/labs/server': { labDashboardAccess: async () => ({}), loadInHousePriceSheets: async () => [] }, '@/lib/labs/in-house-server': { performInHousePriceSheetAction: async () => { calls++; return { sheets: [] }; } },
    '@/lib/labs/in-house-validation': imports, '@/lib/labs/validation': validation });
  const request = body => new Request('https://fixture.invalid/api/dashboard/in-house-price-sheets', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
  assert.equal((await route.GET(new Request('https://fixture.invalid/api/dashboard/in-house-price-sheets'))).headers.get('cache-control'), 'private, no-store');
  assert.equal((await route.POST(request('{'))).status, 400);
  assert.equal((await route.POST(request('x'.repeat(imports.IN_HOUSE_MAX_BODY_BYTES + 1)))).status, 413);
  assert.equal((await route.POST(request({ ...action(), assignments: [] }))).status, 400);
  assert.equal(calls, 0);
  assert.equal((await route.POST(request(action()))).status, 200); assert.equal(calls, 1);
});

const origin = process.env.LAB_SYSTEM_HTTP_ORIGIN;
test('actual Next private price API isolates owner copies, preserves import retries and rejects stale edits', { skip: !origin }, async () => {
  assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
  const call = async (body, user = LAB_FIXTURE.owner, path = '/api/dashboard/in-house-price-sheets') => {
    const response = await fetch(new URL(path, origin), { method: body ? 'POST' : 'GET', headers: { Origin: origin, Authorization: `Bearer ${fixtureToken(user)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  };
  const input = sourceSheet(); input.source.profileId += '-' + crypto.randomUUID(); input.sourceSnapshot.profile.id = input.source.profileId; input.source.contentHash = imports.inHouseSourceHash(input.sourceSnapshot);
  const first = await call({ action: 'import', sheet: input }); assert.equal(first.status, 200); const sheet = first.body.sheet;
  const edit = { action: 'save', id: sheet.id, expectedVersion: 1, ...edits(sheet) };
  const saved = await call(edit); assert.equal(saved.status, 200); assert.equal(saved.body.sheet.version, 2);
  assert.equal((await call(edit)).status, 409);
  assert.equal((await call({ ...edit, expectedVersion: 2 }, LAB_FIXTURE.otherOwner)).status, 404);
  assert.equal((await call(undefined, LAB_FIXTURE.otherOwner)).body.sheets.some(entry => entry.id === sheet.id), false);
  assert.equal((await call(undefined, LAB_FIXTURE.labOwner)).status, 403);
  const retry = await call({ action: 'import', sheet: input }); assert.equal(retry.body.replayed, true); assert.deepEqual(retry.body.sheet, saved.body.sheet);
  const workspace = await call(undefined, LAB_FIXTURE.owner, '/api/dashboard/labs'); assert.equal(workspace.status, 200); assert.deepEqual(workspace.body.workspace.inHousePriceSheets.find(entry => entry.id === sheet.id), saved.body.sheet);
});

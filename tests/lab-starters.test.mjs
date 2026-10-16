import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import ts from 'typescript';
import { z } from 'zod';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import * as icons from 'lucide-react';
import { createLabDatabase, LAB_FIXTURE, fixtureToken, seedLegacyLabCanaries, snapshotLegacyLabFixture } from '../scripts/lab-system-fixture.mjs';

function load(file, deps = {}) {
  const code = ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(name => { if (!(name in deps)) throw Error(`Missing dependency ${name}`); return deps[name]; }, exports);
  return exports;
}
const money = load('lib/labs/money.ts');
const starters = load('lib/labs/starters.ts', { './money': money });
const validation = load('lib/labs/validation.ts', { zod: { z }, './money': money });
const labId = '88888888-8888-4888-8888-888888888888';
const product = (width = 5, height = 7, extra = {}) => ({ id: crypto.randomUUID(), labId, category: 'prints', name: `${width}x${height} Photo Print`, size: `${width}x${height}`, finish: 'Lustre', costCents: 200, currency: 'CAD', sku: `TEST-${width}X${height}`, verified: true, active: true, popular: false, widthInches: width, heightInches: height, costSource: 'lab_confirmed', printsPerUnit: 1, ...extra });
const resolve = (id, products, extra = {}) => starters.resolveStarterCollection(starters.starterCollection(id), products, extra.labId ?? labId, extra.currency ?? 'CAD', extra.finish ?? 'Lustre', extra.markup ?? 100, extra.rounding ?? 'none');

test('six original blueprint collections contain bounded print-only structures without copied retail/wholesale prices', () => {
  assert.equal(starters.LAB_STARTER_COLLECTIONS.length, 6);
  assert.deepEqual(starters.starterCollection('everyday-prints').sizes.map(size => size.id), ['4x6', '5x7', '8x10', '8x12', '11x14', '16x20']);
  assert.equal(starters.starterCollection('school-simple').packages.length, 3);
  for (const entry of starters.LAB_STARTER_COLLECTIONS) {
    assert.equal(entry.version, 1);
    assert.ok(entry.sourceUrls.length);
    for (const pack of entry.packages) {
      assert.ok(pack.items.every(item => entry.sizes.some(size => size.id === item.sizeId)));
      assert.ok(pack.items.reduce((sum, item) => sum + item.quantity, 0) <= 100);
    }
    assert.doesNotMatch(JSON.stringify(entry), /retailCents|costCents|catalogProductId/);
  }
});

test('matcher binds exact dimensions/category/finish and approved IDs, without selecting nearby sizes or special sell units', () => {
  const five = product(7, 5), eight = product(8, 10);
  const result = resolve('portrait-essentials', [five, eight]);
  assert.deepEqual(result.counts, { matched: 2, missing: 0, verification: 0, ambiguous: 0 });
  assert.deepEqual(result.packages[0].items, [{ catalogProductId: eight.id, quantity: 1 }, { catalogProductId: five.id, quantity: 2 }]);
  assert.equal(result.packages[0].costCents, 600);
  assert.equal(result.packages[0].retailCents, 1200);
  for (const extra of [{ category: 'fine_art' }, { finish: 'Deep Matte' }, { labId: crypto.randomUUID() }, { name: '8x10 wallet sheet' }, { name: '8-up Photo Print' }, { name: 'Mounted class photograph' }, { widthInches: 8, heightInches: 10.01 }]) {
    const partial = resolve('portrait-essentials', [five, product(8, 10, extra)]);
    assert.equal(partial.items.length, 1);
    assert.equal(partial.packages[0].available, false);
    assert.deepEqual(partial.packages[0].items, [], 'Missing package components never produce a partial package');
  }
  assert.equal(resolve('portrait-essentials', [product(7, 10)]).items.length, 0, 'UK 10x7 must not become 8x10');
});

test('missing, unverified and ambiguous catalog matches stay visible; one approved SKU can resolve beside unverified references', () => {
  const missing = resolve('portrait-essentials', []);
  assert.equal(missing.sizes.length, 2);
  assert.equal(missing.counts.missing, 2);
  for (const extra of [{ verified: false }, { active: false }, { sku: null }, { sku: ' ' }, { costCents: null }, { costCents: -1 }, { costCents: 2.5 }, { costSource: 'screenshot_reference' }, { currency: 'USD' }, { printsPerUnit: undefined }, { printsPerUnit: null }, { printsPerUnit: 2 }, { printsPerUnit: '1' }]) {
    const held = resolve('portrait-essentials', [product(5, 7, extra)]);
    assert.equal(held.counts.verification, 1);
    assert.equal(held.items.length, 0);
  }
  const ambiguous = resolve('portrait-essentials', [product(5, 7), product(5, 7, { sku: 'ANOTHER-SKU' })]);
  assert.equal(ambiguous.counts.ambiguous, 1);
  assert.equal(ambiguous.items.length, 0);
  assert.equal(resolve('portrait-essentials', [product(5, 7), product(5, 7, { verified: false })]).items.length, 1);
});

test('unit metadata, never a size-like name, controls whether a priced SKU is one physical print', () => {
  for (const name of ['2 - 5x7 Prints', 'Pair of 5x7 Prints', '10 5x7 prints']) {
    for (const printsPerUnit of [undefined, null, 2, 10]) {
      const preview = resolve('gift-prints', [product(5, 7, { name, printsPerUnit })]);
      assert.equal(preview.items.length, 0);
      assert.equal(preview.packages[0].available, false);
    }
  }
  assert.equal(resolve('gift-prints', [product(5, 7, { printsPerUnit: 1, verified: false })]).items.length, 0, 'A claimed single unit still requires lab approval');
  assert.equal(resolve('gift-prints', [product(5, 7, { printsPerUnit: 1 })]).packages[0].items[0].quantity, 10);
});

test('finish choices include approved single prints only and never silently merge Lustre with Deep Matte', () => {
  const catalog = [product(5, 7), product(8, 10, { finish: 'Deep Matte' }), product(4, 6, { finish: 'Unverified', verified: false }), product(8, 10, { finish: 'Mount', name: 'Mounted Print' })];
  assert.deepEqual(starters.starterFinishes(catalog, labId, 'CAD'), ['Deep Matte', 'Lustre']);
  assert.equal(resolve('portrait-essentials', catalog).items.length, 1);
  assert.equal(resolve('portrait-essentials', catalog, { finish: 'deep matte' }).items.length, 1);
  assert.equal(resolve('portrait-essentials', catalog).packages[0].available, false);
});

test('all supported complete collections use exact print-piece quantities and whole-package cost markup', () => {
  const catalog = [[4, 6], [5, 7], [8, 10], [8, 12], [11, 14], [16, 20]].map(([w, h]) => product(w, h));
  for (const collection of starters.LAB_STARTER_COLLECTIONS) {
    const result = resolve(collection.id, catalog, { markup: 200, rounding: '0.99' });
    assert.equal(result.counts.matched, collection.sizes.length);
    assert.equal(result.packages.every(pack => pack.available), true);
    for (let i = 0; i < collection.packages.length; i++) {
      const pieces = collection.packages[i].items.reduce((sum, item) => sum + item.quantity, 0);
      assert.equal(result.packages[i].costCents, 200 * pieces);
      assert.equal(result.packages[i].retailCents, money.roundedLabRetail(200 * pieces, 200, '0.99', 'CAD'));
      assert.equal(result.packages[i].items.reduce((sum, item) => sum + item.quantity, 0), pieces);
    }
  }
});

test('retail formulas preserve zero/three-digit currencies without FX and reject overflow or invalid pricing', () => {
  const yen = resolve('gift-prints', [product(5, 7, { currency: 'JPY', costCents: 120 })], { currency: 'JPY', markup: 100, rounding: '0.99' });
  assert.equal(yen.items[0].retailCents, 240);
  assert.equal(yen.packages[0].retailCents, 2400);
  const fils = resolve('gift-prints', [product(5, 7, { currency: 'BHD', costCents: 1234 })], { currency: 'BHD', markup: 100, rounding: '0.99' });
  assert.equal(fils.items[0].retailCents, 2990);
  assert.equal(fils.packages[0].retailCents, 24990);
  for (const markup of [-1, 10001, NaN]) assert.throws(() => resolve('gift-prints', [], { markup }));
  assert.throws(() => resolve('gift-prints', [product(5, 7, { costCents: 100_000_000 })]), /too large/);
  assert.throws(() => resolve('gift-prints', [], { rounding: 'random' }));
});

test('starter create request is additive and cannot grant approval, invent a cost or omit a finish/version', () => {
  const action = { action: 'create', labId, name: 'My starter', starter: 'blank', templateId: 'portrait-essentials', templateVersion: 1, finish: 'Lustre', markupPercent: 150, rounding: 'none' };
  assert.equal(validation.parseLabAction(action).markupPercent, 150);
  assert.equal(validation.parseLabAction({ action: 'create', labId, name: 'Old native client', starter: 'popular' }).starter, 'popular');
  for (const extra of [{ finish: undefined }, { templateVersion: undefined }, { starter: 'popular' }, { costCents: 1 }, { verified: true }, { assignments: [] }, { templateId: undefined }]) assert.throws(() => validation.parseLabAction({ ...action, ...extra }));
});

test('bundled library renders every starter before catalog loading and makes no fetch or pricing claim', () => {
  const component = load('components/labs/lab-starter-library.tsx', {
    react: React, 'react/jsx-runtime': jsxRuntime, 'lucide-react': icons, '@/lib/labs/money': money, '@/lib/labs/starters': starters,
    './lab-dialog': { LabDialog() { throw Error('No modal opens during initial render'); } }, './labs.module.css': { default: {} },
  });
  const html = renderToStaticMarkup(React.createElement(component.LabStarterLibrary, { workspace: null, loading: true, busy: false, onCreate() { throw Error('Initial rendering cannot create a sheet'); } }));
  for (const entry of starters.LAB_STARTER_COLLECTIONS) assert.ok(html.includes(entry.name.replaceAll('&', '&amp;')));
  assert.match(html, /More collections/);
  assert.match(html, /measured sales rankings/);
  assert.doesNotMatch(html, /\$\d|disabled=/);
});

function serverFor(db) {
  const service = { from(table) {
    const filters = [], orders = []; let from = 0, to = 999, single = false, limit = null;
    const query = { select() { return query; }, eq(key, value) { filters.push([key, value]); return query; }, order(key, config) { orders.push([key, config?.ascending === false ? 'desc' : 'asc']); return query; }, range(first, last) { from = first; to = last; return query; }, limit(value) { limit = value; return query; }, maybeSingle() { single = true; return query; },
      then(resolve, reject) { const args = filters.map(([, value]) => value), where = filters.map(([key], index) => `"${key}"=$${index + 1}`).join(' and '), order = orders.map(([key, dir]) => `"${key}" ${dir}`).join(',');
        return db.query(`select * from "${table}"${where ? ` where ${where}` : ''}${order ? ` order by ${order}` : ''} limit ${limit ?? to - from + 1} offset ${from}`, args).then(result => ({ data: single ? result.rows[0] ?? null : result.rows, error: null })).then(resolve, reject); },
    }; return query;
  }, async rpc(name, args) {
    assert.equal(name, 'save_lab_price_sheet');
    try { const result = await db.transaction(async tx => { await tx.exec('set local role service_role'); return tx.query('select save_lab_price_sheet($1,$2,$3,$4::jsonb,$5) as value', [args.p_user_id, args.p_id, args.p_expected_version, JSON.stringify(args.p_document), args.p_action]); }); return { data: result.rows[0].value, error: null }; }
    catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
  } };
  const server = load('lib/labs/server.ts', { 'node:crypto': crypto, './validation': validation, './money': money, './starters': starters, '@/lib/dashboard-auth': {}, '@/lib/rate-limit': {} });
  return { server, access: { service, userId: LAB_FIXTURE.owner, photographerId: LAB_FIXTURE.photographer } };
}

test('real backend creates editable new collections, saves/reloads, preserves school/current prices, and refuses GTA starter creation', async () => {
  const db = await createLabDatabase();
  try {
    await seedLegacyLabCanaries(db);
    const before = await snapshotLegacyLabFixture(db), { server, access } = serverFor(db);
    const first = await server.performLabAction(access, validation.parseLabAction({ action: 'create', labId, name: 'My Portraits', starter: 'blank', templateId: 'portrait-essentials', templateVersion: 1, finish: 'Lustre', markupPercent: 200, rounding: 'none' }));
    assert.equal(first.sheet.items.length, 2);
    assert.equal(first.sheet.packages.length, 1);
    assert.equal(first.sheet.packages[0].retailCents, 2400);
    assert.equal(first.sheet.status, 'draft');
    assert.deepEqual(first.sheet.assignments, []);
    assert.equal(first.sheet.publishedProfileId, null);
    assert.equal(first.workspace.starterCollections.length, 6, 'Native clients receive the same compact blueprint definitions');
    const original = structuredClone(first.sheet);
    const edited = { ...first.sheet, name: 'My edited collection', items: first.sheet.items.map(item => ({ ...item, retailCents: 1777 })), packages: first.sheet.packages.map(pack => ({ ...pack, retailCents: 2999 })) };
    await server.performLabAction(access, validation.parseLabAction({ action: 'save', sheet: edited, expectedVersion: edited.version }));
    const reloaded = (await server.loadLabWorkspace(access)).priceSheets.find(sheet => sheet.id === edited.id);
    assert.equal(reloaded.items.every(item => item.retailCents === 1777), true);
    assert.equal(reloaded.packages[0].retailCents, 2999);
    assert.equal(reloaded.version, 2);
    await assert.rejects(() => server.performLabAction(access, validation.parseLabAction({ action: 'save', sheet: original, expectedVersion: original.version })), error => error.code === 'LAB_VERSION_CONFLICT');
    const second = await server.performLabAction(access, validation.parseLabAction({ action: 'create', labId, name: 'Second starter', starter: 'blank', templateId: 'school-simple', templateVersion: 1, finish: 'Lustre', markupPercent: 100, rounding: '0.99' }));
    assert.notEqual(second.sheet.id, original.id);
    assert.equal((await server.loadLabWorkspace(access)).priceSheets.find(sheet => sheet.id === edited.id).packages[0].retailCents, 2999, 'Starting a new collection cannot reprice an existing one');
    const beforeDenied = (await db.query('select * from lab_price_sheets order by id')).rows;
    const gta = (await db.query("select id from studio_labs where slug='gta-imaging'")).rows[0];
    await assert.rejects(() => server.performLabAction(access, validation.parseLabAction({ action: 'create', labId: gta.id, name: 'Unavailable GTA starter', starter: 'blank', templateId: 'portrait-essentials', templateVersion: 1, finish: 'Lustre' })), error => error.code === 'LAB_STARTER_UNAVAILABLE');
    await assert.rejects(() => server.performLabAction(access, validation.parseLabAction({ action: 'create', labId, name: 'Stale starter', starter: 'blank', templateId: 'portrait-essentials', templateVersion: 2, finish: 'Lustre' })), error => error.code === 'LAB_STARTER_VERSION');
    assert.deepEqual((await db.query('select * from lab_price_sheets order by id')).rows, beforeDenied, 'Rejected template actions save no empty or partial sheet');
    assert.equal(await snapshotLegacyLabFixture(db), before);
    assert.equal((await db.query('select intake_enabled from studio_labs where id=$1', [gta.id])).rows[0].intake_enabled, false);
    await assert.rejects(() => server.performLabAction(access, { action: 'publish', id: reloaded.id, expectedVersion: reloaded.version, assignments: [{ kind: 'school', id: LAB_FIXTURE.school }] }), error => error.code === 'LAB_FULFILLMENT_NOT_INTEGRATED');
  } finally { await db.close(); }
});

const httpOrigin = process.env.LAB_SYSTEM_HTTP_ORIGIN;
test('actual Next API returns shared starters and preserves earlier drafts when creating another collection', { skip: !httpOrigin }, async () => {
  const origin = new URL(httpOrigin);
  assert.match(origin.origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
  const call = async body => {
    const response = await fetch(new URL('/api/dashboard/labs', origin), { method: body ? 'POST' : 'GET', headers: { Origin: origin.origin, Authorization: `Bearer ${fixtureToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  };
  const initial = await call();
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body.workspace.starterCollections, starters.LAB_STARTER_COLLECTIONS);
  const before = structuredClone(initial.body.workspace.priceSheets);
  const created = await call({ action: 'create', labId, name: 'HTTP starter collection', starter: 'blank', templateId: 'portrait-essentials', templateVersion: 1, finish: 'Lustre', markupPercent: 200, rounding: 'none' });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.sheet.packages.length, 1);
  assert.equal(created.body.sheet.packages[0].retailCents, 2400);
  assert.deepEqual(created.body.sheet.assignments, []);
  const reloaded = (await call()).body.workspace;
  assert.deepEqual(reloaded.priceSheets.find(sheet => sheet.id === created.body.sheet.id), created.body.sheet);
  for (const old of before) assert.deepEqual(reloaded.priceSheets.find(sheet => sheet.id === old.id), old);
  const gta = reloaded.labs.find(lab => lab.slug === 'gta-imaging');
  const rejected = await call({ action: 'create', labId: gta.id, name: 'Unverified starter denied', starter: 'blank', templateId: 'portrait-essentials', templateVersion: 1, finish: 'Lustre' });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.code, 'LAB_STARTER_UNAVAILABLE');
  assert.equal((await call()).body.workspace.priceSheets.length, reloaded.priceSheets.length);
});

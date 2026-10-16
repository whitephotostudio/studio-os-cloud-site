import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import { z } from 'zod';
import crypto from 'node:crypto';

function load(file, deps = {}) {
  const code = ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(name => { if (!(name in deps)) throw Error(`Missing dependency ${name}`); return deps[name]; }, exports);
  return exports;
}
const money = load('lib/labs/money.ts');
const starters = load('lib/labs/starters.ts', { './money': money });
const validation = load('lib/labs/validation.ts', { zod: { z }, './money': money });
const id = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sheet = () => ({ id: id(1), version: 2, name: 'Pilot', labId: id(2), currency: 'CAD', status: 'draft', updatedAt: '', publishedProfileId: null,
  pricing: { markupPercent: 100, rounding: 'none' }, items: [{ catalogProductId: id(3), retailCents: 1200, enabled: true }],
  packages: [{ id: id(4), name: 'Bundle', description: '', retailCents: 2000, items: [{ catalogProductId: id(3), quantity: 2 }] }],
  shipping: { mode: 'custom', feeCents: 500, title: 'Shipping' }, terms: '', assignments: [] });
const lab = overrides => ({ id: id(2), slug: 'fixture', name: 'Fixture', location: '', currency: 'CAD', status: 'active', intakeEnabled: true, catalogVerified: true, description: '', ...overrides });
const product = overrides => ({ id: id(3), labId: id(2), category: 'prints', name: '5x7', size: '5x7', finish: 'Lustre', costCents: 200, currency: 'CAD', sku: 'FIXTURE-5X7', verified: true, active: true, popular: true, widthInches: 5, heightInches: 7, costSource: 'lab_confirmed', ...overrides });

test('strict request contract rejects browser costs, ownership/verification grants and invalid quantity/price inputs', () => {
  const parse = value => validation.parseLabAction({ action: 'save', sheet: value, expectedVersion: 2 });
  assert.equal(parse(sheet()).sheet.name, 'Pilot');
  assert.throws(() => parse({ ...sheet(), photographerId: id(9) }), /request is invalid/);
  assert.throws(() => parse({ ...sheet(), catalogVerified: true }), /request is invalid/);
  assert.throws(() => parse({ ...sheet(), items: [{ ...sheet().items[0], costCents: 1, verified: true }] }), /request is invalid/);
  for (const cents of [-1, .5, Number.NaN, 100_000_001]) assert.throws(() => parse({ ...sheet(), items: [{ ...sheet().items[0], retailCents: cents }] }));
  assert.throws(() => parse({ ...sheet(), packages: [{ ...sheet().packages[0], items: [{ catalogProductId: id(3), quantity: 0 }] }] }));
  assert.throws(() => parse({ ...sheet(), packages: [{ ...sheet().packages[0], items: [{ catalogProductId: id(3), quantity: 1 }, { catalogProductId: id(3), quantity: 2 }] }] }), /repeated product/);
  assert.throws(() => parse({ ...sheet(), packages: [sheet().packages[0], sheet().packages[0]] }), /identifiers must be unique/);
  assert.throws(() => parse({ ...sheet(), packages: [{ ...sheet().packages[0], items: [{ catalogProductId: id(3), quantity: 60 }, { catalogProductId: id(5), quantity: 60 }] }] }), /100 pieces/);
  assert.throws(() => parse({ ...sheet(), items: [sheet().items[0], sheet().items[0]] }), /more than once/);
  assert.throws(() => parse({ ...sheet(), shipping: { mode: 'pickup', feeCents: 100, title: 'Pickup' } }), /Only custom shipping/);
  assert.throws(() => validation.parseLabAction({ action: 'save', sheet: sheet(), expectedVersion: 1 }), error => error.code === 'LAB_VERSION_CONFLICT');
});

test('publication rejects GTA reference costs, stale catalog status, foreign products and missing SKU evidence', () => {
  assert.doesNotThrow(() => validation.assertPublicationReady(sheet(), lab(), [product()]));
  for (const value of [{ status: 'setup' }, { intakeEnabled: false }, { catalogVerified: false }]) {
    assert.throws(() => validation.assertPublicationReady(sheet(), lab(value), [product()]), error => error.code === 'LAB_NOT_READY');
  }
  for (const value of [{ verified: false }, { active: false }, { sku: null }, { sku: ' ' }, { costSource: 'screenshot_reference' }, { costCents: null }, { currency: 'USD' }]) {
    assert.throws(() => validation.assertPublicationReady(sheet(), lab(), [product(value)]), error => error.code === 'LAB_SKU_NOT_VERIFIED');
  }
  assert.throws(() => validation.validateSheetCatalog(sheet(), lab(), [product({ labId: id(9) })]), error => error.code === 'LAB_CATALOG_SCOPE');
  assert.throws(() => validation.assertPublicationReady({ ...sheet(), items: [], packages: [] }, lab(), [product()]), /at least one/);
  const zero = { ...sheet(), items: [{ ...sheet().items[0], retailCents: 0 }] };
  assert.doesNotThrow(() => validation.parseLabAction({ action: 'save', sheet: zero, expectedVersion: 2 }), 'Drafts can retain an incomplete zero price');
  assert.throws(() => validation.assertPublicationReady(zero, lab(), [product()]), error => error.code === 'LAB_RETAIL_PRICE_REQUIRED');
  assert.throws(() => validation.assertPublicationReady({ ...sheet(), packages: [{ ...sheet().packages[0], retailCents: 0 }] }, lab(), [product()]), error => error.code === 'LAB_RETAIL_PRICE_REQUIRED');
});

test('even a verified lab cannot activate unsupported checkout shipping, terms and production via an environment switch', () => {
  const previous = process.env.STUDIO_OS_LAB_PUBLISH_ENABLED;
  process.env.STUDIO_OS_LAB_PUBLISH_ENABLED = '1';
  try { assert.throws(() => validation.assertLabFulfillmentIntegrated(), error => error.status === 409 && error.code === 'LAB_FULFILLMENT_NOT_INTEGRATED'); }
  finally { if (previous === undefined) delete process.env.STUDIO_OS_LAB_PUBLISH_ENABLED; else process.env.STUDIO_OS_LAB_PUBLISH_ENABLED = previous; }
});

test('saved document omits publication authority and keeps complete package, shipping and assignment values', () => {
  const input = { ...sheet(), status: 'published', publishedProfileId: 'spoofed-profile' };
  const document = validation.labSheetDocument(input);
  assert.equal('status' in document, false);
  assert.equal('publishedProfileId' in document, false);
  assert.equal('id' in document, false);
  assert.deepEqual(document.packages, input.packages);
  assert.deepEqual(document.shipping, input.shipping);
  assert.equal(validation.roundedRetailCents(240, 100, 'none'), 480);
  assert.equal(validation.roundedRetailCents(240, 100, '0.99'), 499);
  assert.equal(validation.roundedRetailCents(317, 100, 'nearest-dollar'), 600);
});

function authHarness({ user = { id: id(8) }, mfa = true, allowed = true, studio = { id: id(9) }, schemaError = false } = {}) {
  const calls = [];
  const query = { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: studio, error: null }) };
  const service = { from: name => { calls.push(name); if (schemaError && name === 'studio_labs') return { select() { return this; }, order() { return Promise.resolve({ data: null, error: { code: '42P01' } }); } }; return query; } };
  const server = load('lib/labs/server.ts', {
    'node:crypto': crypto, './validation': validation, './money': money, './starters': starters, './country-profiles': { loadLabCountryProfiles: async () => ({ available: false, options: [] }) },
    '@/lib/dashboard-auth': { resolveDashboardAuth: async () => ({ user, mfaSatisfied: mfa }), createDashboardServiceClient: () => service },
    '@/lib/rate-limit': { rateLimit: async (key, config) => { calls.push({ key, config }); return { allowed, unavailable: !allowed }; } },
  });
  return { server, calls, service };
}

test('backend authenticates and checks MFA/rate budget before service-role data access', async () => {
  for (const settings of [{ user: null }, { mfa: false }, { allowed: false }]) {
    const h = authHarness(settings);
    await assert.rejects(() => h.server.labDashboardAccess({ method: 'POST' }));
    assert.equal(h.calls.includes('photographers'), false, 'denied callers never reach owner data');
  }
  const h = authHarness();
  const access = await h.server.labDashboardAccess({ method: 'POST' });
  assert.equal(access.userId, id(8));
  assert.equal(access.photographerId, id(9));
  assert.equal(h.calls[0].config.failClosed, true);
  assert.equal(h.calls[0].config.limit, 60);
  await assert.rejects(() => authHarness({ studio: null }).server.labDashboardAccess({ method: 'GET' }), error => error.code === 'LAB_STUDIO_REQUIRED');
});

test('bounded workspace pagination loads products after 1,000 and 2,000 without silent truncation', async () => {
  const h = authHarness(), source = Array.from({ length: 2507 }, (_, index) => ({ id: index })), pages = [];
  const loaded = await h.server.readLabRowsInPages(async (from, to) => { pages.push([from, to]); return { data: source.slice(from, to + 1), error: null }; }, 5000);
  assert.equal(loaded.length, 2507);
  assert.equal(loaded[2506].id, 2506);
  assert.deepEqual(pages, [[0, 999], [1000, 1999], [2000, 2999]]);
  const exactlyFull = await h.server.readLabRowsInPages(async (from, to) => ({ data: source.slice(0, 2000).slice(from, to + 1), error: null }), 2000);
  assert.equal(exactlyFull.length, 2000, 'An exact limit is supported after an empty overflow probe');
  await assert.rejects(() => h.server.readLabRowsInPages(async (from, to) => ({ data: source.slice(from, to + 1), error: null }), 2000), error => error.code === 'LAB_WORKSPACE_CAPACITY');
  await assert.rejects(() => h.server.readLabRowsInPages(async from => from === 0 ? { data: source.slice(0, 1000), error: null } : { data: null, error: { code: 'fixture-error' } }, 5000), error => error.status === 503);
});

test('draft request currency validates worldwide ISO codes and rejects invented/malformed identifiers', () => {
  for (const currency of ['CAD', 'USD', 'JPY', 'BHD', 'EUR', 'INR']) {
    assert.equal(validation.parseLabAction({ action: 'save', sheet: { ...sheet(), currency }, expectedVersion: 2 }).sheet.currency, currency);
  }
  for (const currency of ['ZZZ', 'cad', 'US', 'USDD', '123', '', ' CAD']) {
    assert.throws(() => validation.parseLabAction({ action: 'save', sheet: { ...sheet(), currency }, expectedVersion: 2 }));
  }
});

test('HTTP handlers reject malformed/oversized requests before actions and keep private no-store responses', async () => {
  let actions = 0;
  const handlers = load('app/api/dashboard/labs/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/labs/validation': validation,
    '@/lib/labs/server': { labDashboardAccess: async () => ({}), loadLabWorkspace: async () => ({ labs: [], catalog: [], priceSheets: [], galleries: [] }), performLabAction: async () => { actions++; return {}; } },
  });
  const malformed = await handlers.POST(new Request('https://fixture.invalid/api/dashboard/labs', { method: 'POST', body: '{' }));
  assert.equal(malformed.status, 400);
  assert.equal(actions, 0);
  const oversized = await handlers.POST(new Request('https://fixture.invalid/api/dashboard/labs', { method: 'POST', body: 'x'.repeat(256_001) }));
  assert.equal(oversized.status, 413);
  assert.equal(actions, 0);
  const workspace = await handlers.GET(new Request('https://fixture.invalid/api/dashboard/labs'));
  assert.equal(workspace.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await workspace.json()).ok, true);
});

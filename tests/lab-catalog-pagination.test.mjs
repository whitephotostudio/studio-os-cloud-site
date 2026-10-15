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
const validation = load('lib/labs/validation.ts', { zod: { z }, './money': money });
const owner = '40000000-0000-4000-8000-000000000001';
const labId = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function fixture({ admin = true, count = 2507, failTable, failOffset = 1000 } = {}) {
  const calls = [];
  const labs = Array.from({ length: count }, (_, index) => ({ id: labId(index), name: `Lab ${String(index).padStart(5, '0')}`, slug: `lab-${index}`, location: 'Fixture city', country_code: 'CA', city: 'Fixture city', region: 'Fixture region', currency: 'CAD', status: 'setup', intake_enabled: false, catalog_verified: false, description: '', catalog_version: 0 }));
  const tables = { photographers: [{ is_platform_admin: admin, user_id: owner }], studio_labs: labs,
    lab_memberships: admin ? [] : labs.map(row => ({ lab_id: row.id, user_id: owner, role: 'owner', active: true })) };
  const service = { from(table) {
    let single = false, from = 0, to = 999;
    const filters = [], record = { table, range: null, orders: [], inCount: 0 };
    calls.push(record);
    const query = { select() { return query; }, eq(key, value) { filters.push(row => row[key] === value); return query; },
      in(key, values) { record.inCount = values.length; filters.push(row => values.includes(row[key])); return query; },
      order(key) { record.orders.push(key); return query; }, range(first, last) { from = first; to = last; record.range = [first, last]; return query; },
      maybeSingle() { single = true; return query; },
      then(resolve, reject) {
        if (table === failTable && from >= failOffset) return Promise.resolve({ data: null, error: { message: 'Later page failed' } }).then(resolve, reject);
        const rows = tables[table].filter(row => filters.every(filter => filter(row))).slice(from, to + 1);
        return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
      },
    }; return query;
  } };
  const auth = { resolveDashboardAuth: async () => ({ user: { id: owner }, mfaSatisfied: true }), createDashboardServiceClient: () => service };
  const rates = { rateLimit: async () => ({ allowed: true }) };
  const server = load('lib/labs/server.ts', { 'node:crypto': crypto, './validation': validation, './money': money, '@/lib/dashboard-auth': auth, '@/lib/rate-limit': rates });
  const route = load('app/api/dashboard/lab-catalog/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } }, 'node:crypto': crypto, zod: { z },
    '@/lib/dashboard-auth': auth, '@/lib/rate-limit': rates, '@/lib/require-agreement': { guardAgreement: async () => ({ ok: true }) },
    '@/lib/labs/server': server, '@/lib/labs/validation': validation, '@/lib/labs/money': money,
    '@/lib/lab-directory': { isLabCountryCode: value => value === 'CA' },
    '@/lib/lab-catalog-import': { CATALOG_FIELDS: ['sku', 'name', 'category', 'size', 'width', 'height', 'finish', 'cost', 'currency', 'popular'], CatalogImportError: class extends Error {}, previewCatalogImport() { throw Error('GET must not parse a file'); } },
  });
  return { calls, tables, get: () => route.GET(new Request('https://fixture.invalid/api/dashboard/lab-catalog')) };
}

test('catalog administrator sees managed labs beyond pages 1,000 and 2,000', async () => {
  const h = fixture(), response = await h.get(), body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.labs.length, 2507);
  assert.equal(body.labs.at(-1).id, labId(2506));
  assert.deepEqual(h.calls.filter(call => call.table === 'studio_labs').map(call => call.range), [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.ok(h.calls.filter(call => call.table === 'studio_labs').every(call => call.orders.join(',') === 'name,id'));
});

test('worldwide lab owner pages all memberships and uses bounded IDs without granting foreign labs', async () => {
  const h = fixture({ admin: false });
  h.tables.studio_labs.push({ ...h.tables.studio_labs[0], id: labId(9999), name: 'Foreign lab' });
  const response = await h.get(), body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.mayCreateLab, false);
  assert.equal(body.labs.length, 2507);
  assert.equal(body.labs.some(row => row.id === labId(9999)), false);
  assert.deepEqual(h.calls.filter(call => call.table === 'lab_memberships').map(call => call.range), [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.ok(h.calls.filter(call => call.table === 'studio_labs').every(call => call.inCount > 0 && call.inCount <= 100));
});

test('catalog lab pagination fails explicitly on a later-page error or directory capacity instead of returning partial data', async () => {
  for (const options of [{ failTable: 'studio_labs' }, { admin: false, failTable: 'lab_memberships' }, { count: 5001 }]) {
    const response = await fixture(options).get(), body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.ok, false);
    assert.equal('labs' in body, false);
    assert.match(body.message, /unavailable|filtered catalog/);
  }
});

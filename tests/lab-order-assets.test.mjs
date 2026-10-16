import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import { z } from 'zod';
import crypto from 'node:crypto';
import sharp from 'sharp';

function load(file, dependencies = {}) {
  const code = ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(name => { if (!(name in dependencies)) throw Error(`Missing dependency ${name}`); return dependencies[name]; }, exports);
  return exports;
}
const next = { NextResponse: { json: (body, options) => Response.json(body, options) } };
const money = load('lib/labs/money.ts');
const validation = load('lib/labs/validation.ts', { zod: { z }, './money': money });
const ordersValidation = load('lib/labs/orders-validation.ts', { zod: { z }, './validation': validation });
const orderTypes = load('lib/labs/orders-types.ts');
const http = load('lib/labs/orders-http.ts', { 'next/server': next, './validation': validation, './orders-validation': ordersValidation });
const owner = '70000000-0000-4000-8000-000000000001', labId = '70000000-0000-4000-8000-000000000002';
const jpeg = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#486070' } }).jpeg().toBuffer();
const png = await sharp({ create: { width: 600, height: 400, channels: 4, background: '#486070' } }).png().toBuffer();

function fixture(mode = 'success') {
  const files = new Map(), writes = [], removed = [], reads = [];
  let asset;
  const service = {
    storage: {
      getBucket: async () => ({ data: { public: false }, error: null }),
      from: () => ({ upload: async (key, bytes, options) => { files.set(key, { bytes: Buffer.from(bytes), options }); return { error: null }; },
        remove: async keys => { for (const key of keys) { removed.push(key); files.delete(key); } return { error: null }; } }),
    },
    from(table) {
      if (table === 'studio_labs') return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { id: labId, status: 'active', intake_enabled: true, catalog_verified: true }, error: null }) };
      assert.equal(table, 'lab_order_assets');
      const query = { select() { return this; }, eq(field, value) { reads.push([field, value]); return this; },
        insert(row) { asset = { ...row, created_at: '2026-10-15T00:00:00Z' }; writes.push(row); return this; },
        single: async () => mode === 'success' ? { data: asset, error: null } : { data: null, error: { message: 'Acknowledgement lost' } },
        maybeSingle: async () => mode === 'absent' ? { data: null, error: null } : mode === 'uncertain' ? { data: null, error: { message: 'Read unavailable' } } : { data: mode === 'conflicting' ? { ...asset, photographer_id: labId } : asset, error: null },
      };
      return query;
    },
  };
  const route = load('app/api/dashboard/lab-order-assets/route.ts', {
    'next/server': next, 'node:crypto': crypto, sharp, zod: { z },
    '@/lib/labs/orders-server': { LAB_ORDER_BUCKET: 'lab-production-files', labOrderAccess: async () => ({ service, userId: owner, photographerId: owner }), requireLabOrderAgreement: async () => {}, labOrderDatabaseError: () => { throw new validation.LabError('Database unavailable; original retained if its outcome is uncertain.', 503, 'LAB_ORDERS_UNAVAILABLE'); } },
    '@/lib/labs/orders-http': http, '@/lib/labs/orders-validation': ordersValidation, '@/lib/labs/orders-types': orderTypes, '@/lib/labs/validation': validation,
    '@/lib/rate-limit': { rateLimit: async () => ({ allowed: true }) },
  });
  return { files, writes, removed, reads, async upload(bytes = jpeg, filename = 'portrait.jpg', contentType = 'image/jpeg') {
    const form = new FormData(); form.append('labId', labId); form.append('file', new Blob([bytes], { type: contentType }), filename);
    const response = await route.POST(new Request('https://fixture.invalid/api/dashboard/lab-order-assets', { method: 'POST', body: form }));
    return { status: response.status, body: await response.json() };
  } };
}

test('actual upload handler rejects non-upright EXIF orientations before any storage or metadata write', async () => {
  for (const orientation of [2, 6, 8]) {
    const oriented = await sharp(jpeg).withMetadata({ orientation }).jpeg().toBuffer();
    const h = fixture(), result = await h.upload(oriented);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'LAB_ORDER_FILE_ORIENTATION');
    assert.match(result.body.message, /Export this photo upright/);
    assert.equal(h.files.size, 0);
    assert.equal(h.writes.length, 0);
  }
  const upright = await sharp(jpeg).withMetadata({ orientation: 1 }).jpeg().toBuffer();
  assert.equal((await fixture().upload(upright)).status, 200);
});

test('actual magic determines MIME and filename extension while exact original bytes and hash are preserved', async () => {
  const h = fixture(), result = await h.upload(png, 'portrait.jpg', 'image/jpeg');
  assert.equal(result.status, 200);
  assert.equal(result.body.asset.contentType, 'image/png');
  assert.equal(result.body.asset.filename, 'portrait.png');
  assert.equal(result.body.asset.sha256, crypto.createHash('sha256').update(png).digest('hex'));
  const [key, stored] = [...h.files.entries()][0];
  assert.match(key, /\.png$/);
  assert.deepEqual(stored.bytes, png);
  assert.equal(stored.options.upsert, false);
});

test('lost insert acknowledgement reconciles exact metadata instead of deleting a committed private original', async () => {
  const h = fixture('committed'), result = await h.upload();
  assert.equal(result.status, 200);
  assert.equal(result.body.asset.id, h.writes[0].id);
  assert.deepEqual(h.reads, [['id', h.writes[0].id]]);
  assert.equal(h.files.size, 1);
  assert.equal(h.removed.length, 0);
});

test('uncertain or conflicting database results retain private bytes; confirmed absent insert permits cleanup', async () => {
  for (const mode of ['uncertain', 'conflicting']) {
    const h = fixture(mode), result = await h.upload();
    assert.equal(result.status, 503);
    assert.equal(h.files.size, 1);
    assert.equal(h.removed.length, 0);
  }
  const h = fixture('absent'), result = await h.upload();
  assert.equal(result.status, 503);
  assert.equal(h.files.size, 0);
  assert.equal(h.removed.length, 1);
});

test('bounded streaming JSON reader rejects oversized unknown-length bodies and cancels their stream', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(40_000)); controller.enqueue(new Uint8Array(40_000)); }, cancel() { cancelled = true; } });
  const request = new Request('https://fixture.invalid/api/dashboard/lab-orders', { method: 'POST', body: stream, duplex: 'half' });
  await assert.rejects(() => http.readBoundedLabBody(request, 64_000), error => error.status === 413);
  assert.equal(cancelled, true);
});

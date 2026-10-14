import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const uuid = n => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000001`;
const studioId = uuid(1), userId = uuid(2), orderId = uuid(3), versionId = uuid(4);
const ordinaryKey = 'schools/school/student/ordinary.jpg';
const sourceKey = 'schools/school/student/collage-source.jpg';
function recipe(crop = .5) {
  return { version: 1, templateVersionId: versionId, templateId: uuid(5), versionNumber: 1, photographerId: studioId,
    design: { version: 1, name: 'Keepsake', widthInches: 10, heightInches: 8 }, artworkKey: null, contentHash: 'trusted-design-hash',
    caption: { studentName: 'Test Student', schoolName: 'School', year: '2026' },
    placements: [{ slotId: 'left', mediaId: sourceKey, mediaKey: sourceKey, zoom: 1, x: crop, y: .5 }] };
}
function orderFixture({ ordinary = true, lostCart = false } = {}) {
  const originals = [recipe(.25), recipe(.75)];
  const items = [
    ...(ordinary ? [{ id: uuid(10), order_id: orderId, product_name: '5x7 print', quantity: 1, price: 5, unit_price_cents: 500, line_total_cents: 500, sku: ordinaryKey }] : []),
    ...originals.map((snapshot, i) => ({ id: uuid(11 + i), order_id: orderId, product_name: `Collage copy ${i + 1}`, quantity: 1, price: 10, unit_price_cents: 1000, line_total_cents: 1000, sku: null, collage_snapshot: snapshot })),
  ];
  const total = ordinary ? 2500 : 2000;
  return { items, order: { id: orderId, photographer_id: studioId, status: 'paid', payment_status: 'paid', created_at: '2026-10-14T10:00:00Z',
    parent_name: 'Parent', parent_email: 'parent@example.test', package_name: 'Mixed keepsakes', package_price: total / 100,
    subtotal_cents: total, total_cents: total, total_amount: total / 100, currency: 'cad',
    student: { first_name: 'Test', last_name: 'Student', photo_url: 'schools/school/student/fallback.jpg', folder_name: 'Student', class_name: 'Grade 1' },
    school: { school_name: 'School' }, class: { class_name: 'Grade 1' }, project: null,
    items: items.map(item => { const projected = { ...item }; delete projected.collage_snapshot; return projected; }),
    cart_snapshot: lostCart ? null : [{ packageId: uuid(6), packageName: 'Mixed keepsakes', quantity: 1,
      slots: items.map(item => ({ label: item.product_name, assignedImageUrl: item.sku, ...(item.collage_snapshot ? { collage: structuredClone(item.collage_snapshot) } : {}) })) }],
  } };
}
function zipFiles(bytes) {
  const data = Buffer.from(bytes), files = new Map(); let offset = 0;
  while (offset + 30 <= data.length && data.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(data.readUInt16LE(offset + 8), 0, 'Fixture expects a standards-compliant stored ZIP entry');
    const size = data.readUInt32LE(offset + 18), nameLength = data.readUInt16LE(offset + 26), extraLength = data.readUInt16LE(offset + 28);
    const name = data.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    assert.equal(files.has(name), false, `Duplicate ZIP path ${name}`);
    const bodyOffset = offset + 30 + nameLength + extraLength;
    files.set(name, data.subarray(bodyOffset, bodyOffset + size)); offset = bodyOffset + size;
  }
  assert.ok(files.size); assert.equal(data.readUInt32LE(offset), 0x02014b50);
  return files;
}
function fixture({ data = orderFixture(), unpaid = false, financialChange = false, missingSchema = false, renderError = false } = {}) {
  const rendered = [], fetched = [], checks = [], signed = [], queries = [];
  const sb = { from(table) {
    let fields = '', single = false; const filters = [];
    const query = {
      select(value) { fields = value; queries.push({ table, fields }); return query; },
      eq(key, value) { filters.push(row => row[key] === value); return query; },
      in(key, values) { filters.push(row => values.includes(row[key])); return query; },
      not(key, op, value) { assert.equal(op, 'is'); filters.push(row => row[key] !== value && row[key] !== undefined); return query; },
      maybeSingle() { single = true; return query; }, order() { return query; },
      then(resolve, reject) {
        let rows = table === 'photographers' ? [{ id: studioId, user_id: userId, business_name: 'Test Studio' }]
          : table === 'orders' ? [structuredClone(data.order)] : table === 'order_items' ? structuredClone(data.items) : [];
        rows = rows.filter(row => filters.every(filter => filter(row)));
        if (missingSchema && fields.includes('collage_snapshot')) return Promise.resolve({ data: null, error: { code: '42703', message: 'column order_items.collage_snapshot does not exist' } }).then(resolve, reject);
        return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
      },
    }; return query;
  } };
  class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }
  const stubs = {
    'next/server': { NextResponse },
    '@/lib/dashboard-auth': { resolveDashboardAuth: async () => ({ user: { id: userId } }), createDashboardServiceClient: () => sb },
    '@/lib/private-media-references': { privateMediaKeyFromReference: key => key && !key.startsWith('collage:') ? key : null,
      signedPrivateMediaReference: key => { signed.push(key); return key.startsWith('collage:') ? '' : `https://media.example.test/${key}`; } },
    '@/lib/backdrop-composites': { hasBackdropCompositeSelection: () => false },
    '@/lib/collage-production': {
      parseCollageOrderSnapshot: value => {
        assert.ok(value?.placements?.length, 'A complete immutable recipe is required'); return structuredClone(value);
      },
      renderCollageOrderSnapshot: async value => {
        rendered.push(structuredClone(value)); if (renderError) throw Error('Original collage source is unavailable.');
        return { bytes: Buffer.from(`PNG:${value.placements[0].x}`), width: 3000, height: 2400, sha256: `output-${value.placements[0].x}`,
          trim: { width: 3000, height: 2400 }, bleedPixels: 0, warnings: [] };
      },
    },
    '@/lib/order-automation-auth': {
      currentProductionOrders: async (owner, ids) => {
        assert.equal(owner, userId); assert.deepEqual(Array.from(ids), [orderId]); checks.push(ids);
        if (unpaid) throw Error('An order is unpaid, cancelled, refunded or unavailable. Refresh Orders.');
        return { orders: [{ id: orderId, revision: financialChange && checks.length > 1 ? 'changed' : 'initial' }] };
      }, productionFinancialRevision: orders => JSON.stringify(orders),
    },
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const code = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, URL, Request, Response, Uint8Array, TextEncoder, DataView, Buffer, console,
      fetch: async url => { fetched.push(url); return new Response(Buffer.from('ORDINARY-JPEG')); }, require(name) {
        if (name in stubs) return stubs[name];
        if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
        if (name.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name)) + '.ts');
        return require(name);
      } }, { filename: file });
    return exports;
  }
  return { rendered, fetched, checks, signed, queries, async get() {
    const request = new Request(`https://studio.example.test/api/dashboard/orders/download?ids=${orderId}`);
    request.nextUrl = new URL(request.url);
    return load('app/api/dashboard/orders/download/route.ts').GET(request);
  } };
}

test('mixed order ZIP contains one distinct finished image and crop manifest per collage copy', async () => {
  const h = fixture(), response = await h.get();
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /application\/zip/);
  const files = zipFiles(await response.arrayBuffer());
  const collages = [...files].filter(([name]) => name.endsWith('-300ppi.png'));
  assert.equal(collages.length, 2); assert.equal(new Set(collages.map(([name]) => name)).size, 2);
  assert.deepEqual(new Set(collages.map(([, bytes]) => bytes.toString())), new Set(['PNG:0.25', 'PNG:0.75']));
  for (const id of [uuid(11), uuid(12)]) {
    const png = `collage-${id}-3000x2400-300ppi.png`, manifest = `collage-${id}-production.json`;
    assert.ok(files.has(png)); assert.ok(files.has(manifest));
    const saved = JSON.parse(files.get(manifest).toString());
    assert.equal(saved.templateVersionId, versionId); assert.equal(saved.contentHash, 'trusted-design-hash');
    assert.equal(saved.width, 3000); assert.equal(saved.height, 2400); assert.equal(saved.placements[0].mediaId, sourceKey);
    assert.equal(saved.placements[0].mediaKey, undefined, 'Manifest needs authorized identities and crops rather than private source locators');
    assert.ok(saved.sha256.startsWith('output-'));
  }
  assert.equal(h.rendered.length, 2); assert.equal(h.checks.length, 2);
  assert.equal(h.fetched.length, 1); assert.ok(h.fetched[0].endsWith(ordinaryKey));
  assert.ok(files.has('ordinary.jpg')); assert.ok(files.has('order-summary.html'));
  const html = files.get('order-summary.html').toString();
  for (const [name] of collages) assert.ok(html.includes(name), `Summary links completed output ${name}`);
});

test('lost cart JSON still fulfills each collage from authoritative paid order-item recipes', async () => {
  const h = fixture({ data: orderFixture({ lostCart: true }) }), response = await h.get();
  assert.equal(response.status, 200);
  const files = zipFiles(await response.arrayBuffer());
  assert.equal([...files.keys()].filter(name => name.endsWith('-300ppi.png')).length, 2);
  assert.equal(h.rendered.length, 2); assert.equal(h.fetched.length, 1);
});

test('changed displayed and frozen recipes reject the archive rather than substituting a source portrait', async () => {
  const data = orderFixture({ ordinary: false }); data.order.cart_snapshot[0].slots[0].collage.placements[0].x = .99;
  const h = fixture({ data }), response = await h.get();
  assert.equal(response.status, 409); assert.match((await response.json()).message, /recipes|agree|changed/i);
  assert.equal(h.fetched.length, 0); assert.equal(h.rendered.length, 0);
});

test('unpaid collage orders and rendering failures never download raw source or fallback portraits', async () => {
  for (const options of [{ unpaid: true }, { renderError: true }]) {
    const h = fixture({ ...options, data: orderFixture({ ordinary: false }) }), response = await h.get();
    assert.equal(response.status, 409); assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal(h.fetched.length, 0); assert.ok(h.rendered.length <= 1);
    assert.equal(h.signed.some(key => key === sourceKey || key.endsWith('fallback.jpg')), false);
  }
});

test('payment changes during rendering prevent a completed collage ZIP response', async () => {
  const h = fixture({ financialChange: true, data: orderFixture({ ordinary: false }) }), response = await h.get();
  assert.equal(response.status, 409); assert.match((await response.json()).message, /Payment changed/i);
  assert.equal(h.rendered.length, 2); assert.equal(h.fetched.length, 0);
});

test('ordinary orders still download when collage schema has not been applied', async () => {
  const data = orderFixture(); data.items = data.items.filter(item => !item.collage_snapshot);
  data.order.items = structuredClone(data.items); data.order.cart_snapshot[0].slots = data.order.cart_snapshot[0].slots.filter(slot => !slot.collage);
  const h = fixture({ data, missingSchema: true }), response = await h.get();
  assert.equal(response.status, 200);
  const files = zipFiles(await response.arrayBuffer());
  assert.ok(files.has('ordinary.jpg')); assert.equal(h.rendered.length, 0); assert.equal(h.checks.length, 0);
});


test('identical collage recipes still yield independent copy files and reject missing or foreign frozen records', async () => {
  const same = orderFixture({ ordinary: false });
  same.items[1].collage_snapshot = structuredClone(same.items[0].collage_snapshot);
  same.order.cart_snapshot[0].slots[1].collage = structuredClone(same.items[0].collage_snapshot);
  const h = fixture({ data: same }), response = await h.get();
  assert.equal(response.status, 200);
  const files = zipFiles(await response.arrayBuffer());
  assert.equal([...files.keys()].filter(name => name.endsWith('-300ppi.png')).length, 2); assert.equal(h.rendered.length, 2);
  for (const foreign of [false, true]) {
    const data = orderFixture({ ordinary: false });
    if (foreign) {
      data.items[0].collage_snapshot.photographerId = uuid(99);
      data.order.cart_snapshot[0].slots[0].collage.photographerId = uuid(99);
    } else delete data.items[0].collage_snapshot;
    const rejected = fixture({ data }), failed = await rejected.get();
    assert.equal(failed.status, 409); assert.equal(rejected.rendered.length, 0); assert.equal(rejected.fetched.length, 0);
  }
});

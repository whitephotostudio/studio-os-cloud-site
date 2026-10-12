import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const schoolId = '10000000-0000-4000-8000-000000000001';
const studioId = '20000000-0000-4000-8000-000000000001';
const packageId = '30000000-0000-4000-8000-000000000001';
const projectId = '40000000-0000-4000-8000-000000000001';
const uuid = (prefix, index) => `${prefix}0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
const students = Array.from({ length: 200 }, (_, index) => ({
  id: uuid('5', index), pin: String(90000 + index), school_id: schoolId,
  class_id: uuid('6', index % 17), class_name: `Class ${index % 17 + 1}`,
  folder_name: `Student ${index + 1}`,
  photo_url: `${schoolId}/Class ${index % 17 + 1}/Student ${index + 1}/CANON_A_${index + 1}.JPG`,
}));
const collections = Array.from({ length: 17 }, (_, index) => ({
  id: uuid('7', index), project_id: projectId, kind: 'composite',
  title: `Class ${index + 1}`, slug: `Class ${index + 1}`,
}));
const classPhotos = collections.map((collection, index) => ({
  id: uuid('8', index), project_id: projectId, collection_id: collection.id,
  storage_path: `${schoolId}/Class ${index + 1}/CLASS_PHOTO.JPG`, filename: `Class ${index + 1}.JPG`,
  preview_url: null, thumbnail_url: null, created_at: '2026-10-05T12:00:00Z', sort_order: index,
}));

function loader(stubs) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const compiled = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(compiled, {
      exports, URL, URLSearchParams, Request, Response, Buffer, console, crypto: globalThis.crypto,
      process: { env: {} },
      fetch() { assert.fail('Volume fixtures must never contact a real provider'); },
      require(name) {
        if (name in stubs) return stubs[name];
        if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
        if (name.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name)) + '.ts');
        return require(name);
      },
    }, { filename: file });
    return exports;
  }
  return load;
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table orders (id uuid primary key, photographer_id uuid, parent_name text, parent_email text, parent_phone text,
      customer_name text, customer_email text, package_id uuid, package_name text, package_price numeric, special_notes text,
      notes text, status text, payment_status text, seen_by_photographer boolean, subtotal_cents integer, tax_cents integer,
      total_cents integer, total_amount numeric, currency text, cart_snapshot jsonb, school_id uuid, class_id uuid,
      student_id uuid, project_id uuid, order_group_id uuid, refund_status text, refund_amount_cents integer,
      updated_at timestamptz default now());
    create table order_items (id uuid default gen_random_uuid(), order_id uuid references orders(id), product_name text,
      quantity integer check (quantity > 0), price numeric, unit_price_cents integer, line_total_cents integer, sku text);`);
  await db.exec(readFileSync(new URL('supabase/migrations/20260924160000_order_payment_safety.sql', root), 'utf8'));
  const tables = {
    students, collections, media: classPhotos,
    schools: [{ id: schoolId, photographer_id: studioId, local_school_id: null, gallery_settings: null }],
    projects: [{ id: projectId, photographer_id: studioId, workflow_type: 'school', linked_school_id: schoolId,
      linked_local_school_id: null, created_at: '2026-10-05T12:00:00Z' }],
    photographers: [{ id: studioId, subscription_status: 'active', tax_enabled: true, tax_percent: 13, tax_label: 'HST' }],
    packages: [{ id: packageId, photographer_id: studioId, name: '2 - 5x7', category: 'print', price_cents: 1367, active: true }],
    school_photo_deletions: [],
  };
  let commits = 0;
  const sb = {
    async rpc(name, args) {
      assert.equal(name, 'create_checkout_order_once');
      commits++;
      const result = await db.query('select create_checkout_order_once($1,$2,$3,$4,$5) as result',
        [args.p_key, args.p_hash, JSON.stringify(args.p_orders), JSON.stringify(args.p_items), JSON.stringify(args.p_response)]);
      return { data: result.rows[0].result, error: null };
    },
    from(table) {
      assert.ok(table in tables, `Unexpected table: ${table}`);
      const filters = []; let single = false, range, limit;
      const query = {
        select() { return query; },
        eq(key, value) { filters.push(row => row[key] === value); return query; },
        in(key, values) { filters.push(row => values.includes(row[key])); return query; },
        is(key, value) { filters.push(row => row[key] === value); return query; },
        not(key, op, value) { assert.equal(op, 'is'); filters.push(row => row[key] !== value); return query; },
        order() { return query; },
        range(from, to) { range = [from, to]; return query; },
        limit(value) { limit = value; return query; },
        maybeSingle() { single = true; return query; },
        then(resolve, reject) {
          let rows = tables[table].filter(row => filters.every(filter => filter(row)));
          const count = rows.length;
          if (range) rows = rows.slice(range[0], range[1] + 1);
          if (limit) rows = rows.slice(0, limit);
          return Promise.resolve({ data: single ? rows[0] ?? null : rows, count, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const load = loader({
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => sb },
    '@/lib/subscription-gate': { hasActiveSubscription: row => row?.subscription_status === 'active' },
    // Transport fixtures isolate all quotas/provider state from production. The
    // actual request validation, gallery/photo scope, pricing and order SQL run.
    '@/lib/rate-limit': { getClientIp: request => request.headers.get('x-forwarded-for'), rateLimit: async () => ({ allowed: true }) },
    '@/lib/r2': { listR2FolderImages: async prefix => students.flatMap(student => {
      const portraitB = student.photo_url.replace('CANON_A_', 'CANON_B_');
      return [student.photo_url, portraitB].filter(key => key.startsWith(prefix + '/')).map(key => ({ key, name: key.split('/').at(-1), url: key }));
    }) },
  });
  const route = load('app/api/portal/orders/create/route.ts');
  const makeBody = (index, override = {}) => {
    const student = students[index % students.length];
    const portrait = index % 2 ? student.photo_url.replace('CANON_A_', 'CANON_B_') : student.photo_url;
    const selected = index % 5 === 0 ? classPhotos[index % students.length % 17].storage_path : portrait;
    return {
      mode: 'school', pin: student.pin, schoolId,
      parent: { name: `Fixture Parent ${index}`, email: `parent-${index}@example.test`, phone: '' },
      delivery: { method: 'pickup' },
      entries: [{ packageId, quantity: 1, selectedImageUrl: selected,
        slots: [{ label: '5x7 (1)', assignedImageUrl: selected }, { label: '5x7 (2)', assignedImageUrl: selected }],
        isComposite: index % 5 === 0, compositeTitle: index % 5 === 0 ? student.class_name : null }],
      ...override,
    };
  };
  const post = async (index, body, attempt = crypto.randomUUID()) => {
    const response = await route.POST(new Request('https://fixture.invalid/api/portal/orders/create', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': attempt,
        'x-checkout-purchase': `fixture-purchase-${index}`, 'x-forwarded-for': `198.18.${Math.floor(index / 250)}.${index % 250 + 1}` },
      body: JSON.stringify(body ?? makeBody(index)),
    }));
    return { status: response.status, body: await response.json() };
  };
  return { db, makeBody, post, commits: () => commits };
}

test('1000 school orders preserve 200 student and 17 class-photo choices through burst submissions and response-loss retries', { timeout: 120000 }, async t => {
  const h = await fixture();
  try {
    const latencies = [], orderIds = new Map();
    const started = performance.now();
    const submit = async index => {
      const body = h.makeBody(index), attempt = crypto.randomUUID(), start = performance.now();
      const result = await h.post(index, body, attempt);
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.equal(result.body.ok, true);
      orderIds.set(index, result.body.orderId);
      latencies.push(performance.now() - start);
      if (index % 5 === 0) {
        // Same tab after a lost HTTP response and a separate tab with a new
        // key must replay the same durable result, including selected photos.
        const replay = await h.post(index, structuredClone(body), attempt);
        const secondTab = await h.post(index, structuredClone(body));
        assert.equal(replay.body.orderId, result.body.orderId);
        assert.equal(secondTab.body.orderId, result.body.orderId);
      }
    };
    for (let offset = 0; offset < 1000; offset += 50) {
      await Promise.all(Array.from({ length: 50 }, (_, index) => submit(offset + index)));
    }
    assert.equal(new Set(orderIds.values()).size, 1000);
    const rows = (await h.db.query('select * from orders')).rows;
    assert.equal(rows.length, 1000);
    assert.equal(new Set(rows.map(row => row.student_id)).size, 200);
    assert.equal(new Set(rows.map(row => row.class_id)).size, 17);
    const items = (await h.db.query('select * from order_items')).rows;
    assert.equal(items.length, 2000);
    for (let index = 0; index < 1000; index++) {
      const expected = h.makeBody(index), saved = rows.find(row => row.id === orderIds.get(index));
      assert.equal(saved.student_id, students[index % 200].id);
      assert.equal(saved.subtotal_cents, 1367);
      assert.equal(saved.tax_cents, 178);
      assert.equal(saved.total_cents, 1545);
      assert.equal(saved.payment_status, 'pending', 'Creating a draft cannot mark an unpaid order paid');
      assert.equal(saved.cart_snapshot[0].selectedImageUrl, expected.entries[0].selectedImageUrl);
      const lines = items.filter(row => row.order_id === saved.id);
      assert.equal(lines.reduce((sum, line) => sum + line.line_total_cents, 0), saved.subtotal_cents);
      assert.ok(lines.every(line => line.sku === expected.entries[0].selectedImageUrl));
    }
    latencies.sort((a, b) => a - b);
    t.diagnostic(JSON.stringify({ scope: 'isolated actual create route + PostgreSQL; provider transports simulated',
      orders: rows.length, items: items.length, requests: h.commits(), batchConcurrency: 50,
      elapsedMs: Math.round(performance.now() - started), p95Ms: Math.round(latencies[Math.floor(latencies.length * .95)]) }));
  } finally { await h.db.close(); }
});

test('another student portrait and another class photo remain denied under the volume fixture before any order commit', async () => {
  const h = await fixture();
  try {
    for (const forged of [students[1].photo_url, classPhotos[1].storage_path]) {
      const body = h.makeBody(0);
      body.entries[0].selectedImageUrl = forged;
      body.entries[0].slots.forEach(slot => { slot.assignedImageUrl = forged; });
      const result = await h.post(0, body);
      assert.equal(result.status, 403, JSON.stringify(result));
    }
    assert.equal(h.commits(), 0);
    assert.equal((await h.db.query('select count(*)::int as n from orders')).rows[0].n, 0);
  } finally { await h.db.close(); }
});

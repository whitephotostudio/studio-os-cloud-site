import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import sharp from 'sharp';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const photographerId = 'studio';
const schoolId = 'school';
const projectId = 'project';
const folder = student => `${schoolId}/Class/${student}`;
const original = (student = 'child-a', name = 'pose.JPG') => `${folder(student)}/${name}`;
const fullCutout = key => `nobg-photos/${key}.png`;
const png = await sharp(Buffer.from([100, 70, 30, 255, 100, 70, 30, 0]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
const opaque = await sharp({ create: { width: 2, height: 1, channels: 4, background: '#abcdef' } }).png().toBuffer();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const print = { id: 'print', photographer_id: photographerId, name: '5x7 Print', category: 'print', price_cents: 1000 };
const digital = { ...print, id: 'digital', name: 'Digital image', category: 'digital' };
const allDigital = { ...digital, id: 'all-digital', name: 'All Digital Package' };
const retouch = { ...print, id: 'retouch', name: 'Skin polish', is_retouch_addon: true, category: 'specialty' };
const mixed = { ...print, id: 'mixed', name: 'Complete Gallery', items: ['Print', 'Digital file'] };
const selection = (ref = original(), pkg = print, extra = {}) => ({ packageId: pkg.id, packageName: pkg.name, quantity: 1,
  backdrop: { id: 'blue', name: 'Blue' }, slots: [{ assignedImageUrl: ref }], ...extra });
const order = (id = 'a', student = 'child-a', snapshot = [selection(original(student))], extra = {}) => ({
  id, order_group_id: null, school_id: schoolId, project_id: null, student_id: student,
  photographer_id: photographerId, package_id: snapshot?.[0]?.packageId || print.id, package_name: 'Photo order',
  cart_snapshot: snapshot, special_notes: null, subtotal_cents: 1000, tax_cents: 0, total_cents: 1000,
  currency: 'cad', status: 'payment_pending', payment_status: 'pending', stripe_checkout_session_id: null, ...extra,
});

function loader(stubs) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const js = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
    } }).outputText;
    vm.runInNewContext(js, { exports, URL, Response, Request, Buffer, crypto: globalThis.crypto, console, process: { env: {} },
      fetch() { throw new Error('Network forbidden in saved checkout tests'); },
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

function setup({ orders = [order()], lockedOrders = orders, originals = [original()], paidKeys = originals.map(fullCutout),
  bytes = png, storedBytes = bytes, packages = [print, digital, allDigital, retouch, mixed], lines, media = [],
  pin = 'current-pin', orderPageCap = Infinity, existingSession = { id: 'existing', status: 'open', url: 'https://checkout.example/existing' },
} = {}) {
  const events = [], writes = [], providerCalls = [], paymentRequests = [], paidReads = [], proofQueries = [], assetReads = [], packageReads = [];
  let locked = false;
  const items = lines ?? lockedOrders.map(saved => ({ order_id: saved.id, product_name: 'Photo', quantity: 1,
    unit_price_cents: saved.subtotal_cents, line_total_cents: saved.subtotal_cents }));
  const sb = {
    async rpc(name, args) {
      if (name !== 'authorized_credit_cutout_keys') throw new Error(`Unexpected RPC ${name}`);
      proofQueries.push(args); events.push('proof');
      return { data: args.p_photographer_id === photographerId ? paidKeys.filter(key => args.p_keys.includes(key))
        .map(object_key => ({ object_key, original_sha256: 'a'.repeat(64), cutout_sha256: digest(bytes) })) : [], error: null };
    },
    from(table) {
      const filters = []; let single = false, range, limit, mutation = false;
      const q = {
        select(fields) { if (table === 'packages') packageReads.push(fields); return q; }, eq(key, value) { filters.push(row => row[key] === value); return q; },
        in(key, values) { filters.push(row => values.includes(row[key])); return q; },
        gte(key, value) { filters.push(row => row[key] >= value); return q; }, order() { return q; },
        range(from, to) { range = [from, to]; return q; }, limit(value) { limit = value; return q; },
        maybeSingle() { single = true; return q; },
        update(value) { mutation = true; writes.push({ table, value }); events.push('write'); return q; },
        then(resolve, reject) {
          let rows = table === 'orders' ? locked ? lockedOrders : orders
            : table === 'order_items' ? items : table === 'packages' ? packages
            : table === 'schools' ? [{ id: schoolId, photographer_id: photographerId, local_school_id: null }]
            : table === 'students' ? ['child-a', 'child-b'].map(id => ({ id, school_id: schoolId, class_name: 'Class', folder_name: id, photo_url: original(id) }))
            : table === 'photographers' ? [{ id: photographerId, subscription_status: 'active', stripe_account_id: 'acct_studio' }]
            : table === 'projects' ? [{ id: projectId, photographer_id: photographerId, workflow_type: 'event', status: 'active', access_mode: 'pin', access_pin: pin }]
            : table === 'collections' ? [{ id: 'collection-a', project_id: projectId, kind: 'album', slug: pin }, { id: 'collection-b', project_id: projectId, kind: 'album', slug: 'other-pin' }]
            : table === 'media' ? media : [];
          rows = mutation ? [] : rows.filter(row => filters.every(filter => filter(row)));
          const count = rows.length;
          if (table === 'orders' && !single) rows = rows.slice(0, orderPageCap);
          if (range) rows = rows.slice(range[0], range[1] + 1);
          if (limit) rows = rows.slice(0, limit);
          return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null, count }).then(resolve, reject);
        },
      }; return q;
    },
  };
  const provider = name => { providerCalls.push(name); events.push(name); };
  const load = loader({
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => sb },
    '@/lib/order-payment-lock': { lockOrderPayment: async () => { locked = true; events.push('lock'); return async () => events.push('unlock'); } },
    '@/lib/r2': {
      listR2FolderImages: async prefix => { assetReads.push(prefix); return originals.filter(key => key.startsWith(prefix + '/')).map(key => ({ key, name: key.split('/').at(-1), url: key })); },
      r2Download: async key => { paidReads.push(key); if (!paidKeys.includes(key)) throw new Error('Absent output'); return storedBytes; },
    },
    '@/lib/payments': {
      isStripeBillingActive: () => true, getConnectedAccountId: () => 'acct_studio',
      retrieveStripeAccount: async () => { provider('account'); return { details_submitted: true, charges_enabled: true, payouts_enabled: true }; },
      syncConnectState: async () => provider('connect-sync'), describeConnectStatus: () => ({ readyForPayments: true }),
      retrieveCheckoutSession: async () => { provider('session-read'); return existingSession; },
      createDirectOrderCheckoutSession: async args => { provider('session-create'); paymentRequests.push(args); return { id: 'new-session', url: 'https://checkout.example/new' }; },
    },
  });
  return { writes, providerCalls, paymentRequests, paidReads, proofQueries, assetReads, packageReads, events, async post(body = { orderId: 'a', pin }) {
    const response = await load('app/api/stripe/checkout/route.ts').POST(new Request('https://gallery.example/api/stripe/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })); return { status: response.status, body: await response.json() };
  } };
}

function deniedWithoutPayment(h, result, copy = /background is not ready/) {
  assert.equal(result.status, 409, JSON.stringify(result));
  assert.match(result.body.message, copy);
  assert.equal(h.providerCalls.length, 0); assert.equal(h.writes.length, 0);
  assert.equal(h.events.at(-1), 'unlock');
}

test('a saved chosen background with no paid cutout never contacts Stripe or changes checkout state', async () => {
  const h = setup({ paidKeys: [] }); deniedWithoutPayment(h, await h.post());
});

test('paid byte hash and genuine visible transparency are required before checkout', async () => {
  for (const options of [{ storedBytes: opaque }, { bytes: opaque }, { bytes: Buffer.from('invalid PNG') }]) {
    const h = setup(options); deniedWithoutPayment(h, await h.post());
  }
});

test('a valid saved background passes actual proof/decode before provider calls and the first write', async () => {
  const h = setup(); assert.equal((await h.post()).status, 200);
  assert.deepEqual(h.paidReads, [fullCutout(original())]);
  assert.ok(h.events.indexOf('proof') < h.events.indexOf('account'));
  assert.ok(h.events.indexOf('proof') < h.events.indexOf('write'));
  assert.equal(h.writes[0].value.status, 'checkout_starting');
});

test('existing open Checkout Sessions cannot bypass fresh cutout validation', async () => {
  const saved = order('a', 'child-a', [selection()], { stripe_checkout_session_id: 'existing' });
  const denied = setup({ orders: [saved], paidKeys: [] }); deniedWithoutPayment(denied, await denied.post());
  const accepted = setup({ orders: [saved] });
  const result = await accepted.post(); assert.equal(result.status, 200); assert.equal(result.body.sessionId, 'existing');
  assert.equal(accepted.writes.length, 0); assert.ok(accepted.events.indexOf('proof') < accepted.events.indexOf('session-read'));
});

test('every saved combined member is checked before any provider call or order mutation', async () => {
  const orders = ['child-a', 'child-b'].map((student, i) => order(i ? 'b' : 'a', student, [selection(original(student))], { order_group_id: 'group' }));
  const h = setup({ orders, originals: [original(), original('child-b')], paidKeys: [fullCutout(original())] });
  deniedWithoutPayment(h, await h.post()); assert.equal(h.proofQueries.length, 2);
});

test('scope and selected refs are refreshed under the lock instead of trusting the initial draft', async () => {
  const initial = order('a', 'child-a', [selection(original(), print, { backdrop: null })]);
  const changed = order('a', 'child-b', [selection(original('child-b'))]);
  const h = setup({ orders: [initial], lockedOrders: [changed], originals: [original(), original('child-b')], paidKeys: [fullCutout(original())] });
  deniedWithoutPayment(h, await h.post()); assert.ok(h.assetReads.some(prefix => prefix === folder('child-b')));
});

test('a sibling added before the locked group refresh is included and checked', async () => {
  const a = order('a', 'child-a', [selection()], { order_group_id: 'group' });
  const b = order('b', 'child-b', [selection(original('child-b'))], { order_group_id: 'group' });
  const h = setup({ orders: [a], lockedOrders: [a, b], originals: [original(), original('child-b')], paidKeys: [fullCutout(original())] });
  deniedWithoutPayment(h, await h.post()); assert.equal(h.proofQueries.length, 2);
});

test('a truncated combined group is refused instead of charging only its first page', async () => {
  const orders = ['child-a', 'child-b'].map((student, i) => order(i ? 'b' : 'a', student, [selection(original(student))], { order_group_id: 'group' }));
  const h = setup({ orders, orderPageCap: 1 });
  assert.equal((await h.post()).status, 400); assert.equal(h.providerCalls.length, 0); assert.equal(h.writes.length, 0);
});

test('missing rows or changed group identity under lock cannot use stale selections', async () => {
  for (const lockedOrders of [[], [order('a', 'child-a', [selection()], { order_group_id: 'new-group' })]]) {
    const h = setup({ lockedOrders }); const result = await h.post();
    assert.equal(result.status, 409); assert.equal(h.providerCalls.length, 0); assert.equal(h.writes.length, 0);
  }
});

test('body school/project/mode overrides cannot authorize another saved photo source', async () => {
  const h = setup({ orders: [order('a', 'child-a', [selection(original('child-b'))])], originals: [original(), original('child-b')] });
  deniedWithoutPayment(h, await h.post({ orderId: 'a', schoolId: 'different', projectId, mode: 'event', pin: 'current-pin' }));
});

test('legacy selected backgrounds missing a source or scope are preserved for review', async () => {
  for (const saved of [order('a', 'child-a', null, { special_notes: 'ORDER ITEM 1: Print\nBACKDROP: Blue (Included)' }),
    order('a', 'child-a', null, { notes: 'ORDER ITEM 1: Print\nBACKDROP: Blue (Included)' }),
    order('a', 'child-a', { backdrop: { id: 'blue' } }),
    order('a', 'child-a', [selection(null)]), order('a', null), order('a', 'child-a', [selection()], { photographer_id: null }),
    order('a', 'child-a', [selection()], { school_id: null, project_id: null })]) {
    const h = setup({ orders: [saved] }); deniedWithoutPayment(h, await h.post());
  }
  const saved = order('a', 'child-a', null, { subtotal_cents: 1250, total_cents: 1250 });
  const h = setup({ orders: [saved], lines: [{ order_id: 'a', product_name: '★ Premium Backdrop: Blue', line_total_cents: 1250, quantity: 1, unit_price_cents: 1250 }] });
  deniedWithoutPayment(h, await h.post());
});

test('stored client package names cannot fabricate the retouch exemption', async () => {
  for (const pkg of [{ ...print, id: 'absent' }, { ...print, photographer_id: 'other-studio' }]) {
    const saved = order('a', 'child-a', [selection(original(), pkg, { packageName: 'Retouching' })]);
    const h = setup({ orders: [saved], packages: pkg.id === 'absent' ? [] : [pkg] });
    deniedWithoutPayment(h, await h.post());
  }
  const h = setup({ orders: [order('a', 'child-a', [selection(original(), print, { packageName: 'Retouching' })])], paidKeys: [] });
  deniedWithoutPayment(h, await h.post());
});

test('original-only orders use no asset reads and remain eligible, including harmless customer prose', async () => {
  for (const snapshot of [null, [selection(original(), print, { backdrop: null })]]) {
    const h = setup({ orders: [order('a', 'child-a', snapshot, { special_notes: 'CUSTOMER NOTES:\n> BACKDROP: a note only' })], paidKeys: [] });
    assert.equal((await h.post()).status, 200); assert.equal(h.proofQueries.length, 0); assert.equal(h.assetReads.length, 0);
  }
});

test('body event mode cannot reroute a saved school background after successful preflight', async () => {
  const h = setup();
  assert.equal((await h.post({ orderId: 'a', mode: 'event', schoolId: 'unrelated-school', projectId: 'unrelated', pin: 'current-pin' })).status, 200);
  assert.equal(h.paymentRequests[0].schoolId, schoolId); assert.equal(h.paymentRequests[0].projectId, null);
});

test('only authoritative retouch services remain exempt, while a retained premium fee is reviewed', async () => {
  const snapshot = [selection(original(), print, { backdrop: null }), selection(original(), retouch)];
  const saved = order('a', 'child-a', snapshot, { subtotal_cents: 2000, total_cents: 2000 });
  const allowed = setup({ orders: [saved], paidKeys: [] });
  assert.equal((await allowed.post()).status, 200); assert.equal(allowed.proofQueries.length, 0);
  const denied = setup({ orders: [saved], lines: [{ order_id: 'a', product_name: '★ Premium Backdrop: Blue', quantity: 1, line_total_cents: 2000, unit_price_cents: 2000 }] });
  deniedWithoutPayment(denied, await denied.post());
});

test('normal digital backgrounds require paid sources, and all-digitals checks omitted photos', async () => {
  for (const [pkg, slots] of [[digital, [original()]], [allDigital, []]]) {
    const saved = order('a', 'child-a', [selection(original(), pkg, { slots: slots.map(assignedImageUrl => ({ assignedImageUrl })) })]);
    const h = setup({ orders: [saved], originals: [original(), original('child-a', 'hidden.JPG')],
      paidKeys: pkg === digital ? [] : [fullCutout(original())],
      lines: [{ order_id: 'a', product_name: pkg.name, quantity: 1, unit_price_cents: 1000, line_total_cents: 1000 }] });
    deniedWithoutPayment(h, await h.post());
  }
});

test('saved digital thumbnail fallback cannot smuggle another student source into fulfillment', async () => {
  for (const refs of [{ thumbnailUrl: original('child-b') }, { url: original(), thumbnailUrl: original('child-b') }]) {
    const saved = order('a', 'child-a', [selection(null, digital, { slots: [], digitalSelections: [{ mediaId: original(), ...refs }] })]);
    const h = setup({ orders: [saved], originals: [original(), original('child-b')] });
    deniedWithoutPayment(h, await h.post());
  }
  const saved = order('a', 'child-a', [selection(null, digital, { slots: [], digitalSelections: [{ mediaId: original(), thumbnailUrl: original() }] })]);
  const h = setup({ orders: [saved] }); assert.equal((await h.post()).status, 200);
  const incomplete = setup({ orders: [order('a', 'child-a', [selection(null, digital, { slots: [], digitalSelections: [{ mediaId: original() }] })])] });
  deniedWithoutPayment(incomplete, await incomplete.post());
});

test('a physical mixed package does not suddenly require the entire digital gallery', async () => {
  const h = setup({ orders: [order('a', 'child-a', [selection(original(), mixed)])], originals: [original(), original('child-a', 'hidden.JPG')], paidKeys: [fullCutout(original())] });
  assert.equal((await h.post()).status, 200); assert.equal(h.paidReads.length, 1);
});

const eventPhoto = (id, collection_id = 'collection-a') => ({ id, project_id: projectId, collection_id, storage_path: `projects/${projectId}/${collection_id}/${id}.JPG` });
test('saved event selections revalidate current PIN and reject sources outside that collection', async () => {
  const a = eventPhoto('a'), b = eventPhoto('b', 'collection-b');
  const saved = order('a', null, [selection(a.storage_path)], { school_id: null, project_id: projectId });
  for (const [snapshot, credential] of [[[selection(a.storage_path)], 'stale-pin'], [[selection(b.storage_path)], 'current-pin'], [[selection(a.storage_path)], '']]) {
    const h = setup({ orders: [{ ...saved, cart_snapshot: snapshot }], media: [a, b], paidKeys: [fullCutout(a.storage_path), fullCutout(b.storage_path)] });
    deniedWithoutPayment(h, await h.post({ orderId: 'a', pin: credential }));
  }
  const allowed = setup({ orders: [saved], media: [a, b], paidKeys: [fullCutout(a.storage_path)] });
  assert.equal((await allowed.post()).status, 200);
});

test('same-stem source collisions cannot reuse a sibling format paid binding', async () => {
  const jpg = original('child-a', 'same.JPG'), imagePng = original('child-a', 'same.PNG');
  const h = setup({ orders: [order('a', 'child-a', [selection(imagePng)])], originals: [jpg, imagePng], paidKeys: [fullCutout(jpg)] });
  deniedWithoutPayment(h, await h.post()); assert.equal(h.paidReads.length, 0);
});

test('legacy event all-gallery background orders cannot replace missing purchased scope with a caller PIN', async () => {
  const photo = eventPhoto('a');
  const saved = order('a', null, [selection(null, allDigital, { slots: [] })], { school_id: null, project_id: projectId, package_name: allDigital.name });
  const h = setup({ orders: [saved], media: [photo], paidKeys: [fullCutout(photo.storage_path)],
    lines: [{ order_id: 'a', product_name: allDigital.name, quantity: 1, unit_price_cents: 1000, line_total_cents: 1000 }] });
  deniedWithoutPayment(h, await h.post()); assert.equal(h.proofQueries.length, 0);
});

test('stale all-gallery names on a one-image package are review hints, never package authority', async () => {
  for (const [snapshot, extra] of [
    [[selection(original(), digital)], { package_name: 'All Digital Package' }],
    [[selection(original(), digital, { packageName: 'All Digital Package', slots: [{ label: 'All Digital Package', assignedImageUrl: original() }] })], {}],
    [[selection(original(), print, { slots: [{ label: 'All Digital Package', assignedImageUrl: original() }] })], {}],
  ]) {
    const h = setup({ orders: [order('a', 'child-a', snapshot, extra)] }); deniedWithoutPayment(h, await h.post());
  }
});

test('print background plus a paid original all-digital package checks only its selected print pose', async () => {
  const snapshot = [selection(original(), print), selection(null, allDigital, { backdrop: null, slots: [] })];
  const saved = order('a', 'child-a', snapshot, { package_name: 'All Digital Package + 1 more', subtotal_cents: 2000, total_cents: 2000 });
  const lines = [print, allDigital].map(pkg => ({ order_id: 'a', product_name: pkg.name, quantity: 1, unit_price_cents: 1000, line_total_cents: 1000 }));
  const h = setup({ orders: [saved], lines, originals: [original(), original('child-a', 'hidden.JPG')], paidKeys: [fullCutout(original())] });
  assert.equal((await h.post()).status, 200); assert.deepEqual(h.paidReads, [fullCutout(original())]);
});

test('a paid all-digital background package covers the whole gallery before Stripe', async () => {
  const saved = order('a', 'child-a', [selection(null, allDigital, { slots: [] })], { package_name: allDigital.name });
  const lines = [{ order_id: 'a', product_name: allDigital.name, quantity: 1, unit_price_cents: 1000, line_total_cents: 1000 }];
  const originals = [original(), original('child-a', 'hidden.JPG')];
  const denied = setup({ orders: [saved], lines, originals, paidKeys: [fullCutout(original())] });
  deniedWithoutPayment(denied, await denied.post());
  const accepted = setup({ orders: [saved], lines, originals });
  assert.equal((await accepted.post()).status, 200); assert.equal(accepted.paidReads.length, 2);
});

test('original one-image purchases cannot turn a client filename or slot label into an all-gallery download', async () => {
  for (const [snapshot, extra] of [
    [[selection(null, digital, { backdrop: null, slots: [], digitalSelections: [{ mediaId: original(), url: original(), filename: 'All photos' }] })], {}],
    [[selection(original(), digital, { backdrop: null, slots: [{ label: 'All Digital Package', assignedImageUrl: original() }] })], {}],
    [[selection(original(), digital, { backdrop: null })], { package_name: 'All Digital Package' }],
  ]) {
    const saved = order('a', 'child-a', snapshot, extra);
    const h = setup({ orders: [saved], paidKeys: [], lines: [{ order_id: 'a', product_name: digital.name, quantity: 1, unit_price_cents: 1000, line_total_cents: 1000 }] });
    deniedWithoutPayment(h, await h.post(), /saved order needs review/);
    assert.equal(h.proofQueries.length, 0); assert.equal(h.assetReads.length, 0);
  }
});

test('current and legacy original all-digital purchases verify owned paid package authority without cutouts', async () => {
  for (const snapshot of [null, [selection(null, allDigital, { backdrop: null, slots: [] })]]) {
    const saved = order('a', 'child-a', snapshot, { package_id: allDigital.id, package_name: allDigital.name });
    const h = setup({ orders: [saved], paidKeys: [], lines: [{ order_id: 'a', product_name: allDigital.name, quantity: 1, unit_price_cents: 1000, line_total_cents: 1000 }] });
    assert.equal((await h.post()).status, 200);
    assert.equal(h.proofQueries.length, 0); assert.equal(h.assetReads.length, 0); assert.equal(h.paidReads.length, 0);
    assert.equal(h.packageReads.filter(fields => fields.includes('is_retouch_addon') && fields.includes('photographer_id')).length, 1);
  }
});

test('legacy original all-gallery claims with missing, foreign or unpaid package authority stay in review', async () => {
  for (const options of [
    { packages: [] }, { packages: [{ ...allDigital, photographer_id: 'other-studio' }] },
    { lines: [{ order_id: 'a', product_name: allDigital.name, quantity: 1, unit_price_cents: 0, line_total_cents: 0 }] },
    { extra: { package_id: null } },
  ]) {
    const { extra, ...fixture } = options;
    const saved = order('a', 'child-a', null, { package_id: allDigital.id, package_name: allDigital.name, ...extra });
    const h = setup({ orders: [saved], paidKeys: [], lines: [{ order_id: 'a', product_name: allDigital.name, quantity: 1, unit_price_cents: 1000, line_total_cents: 1000 }], ...fixture });
    deniedWithoutPayment(h, await h.post(), /saved order needs review/);
    assert.equal(h.proofQueries.length, 0); assert.equal(h.assetReads.length, 0);
  }
});

test('ordinary original-photo drafts perform no additional all-gallery package or asset reads', async () => {
  for (const pkg of [print, digital]) {
    const saved = order('a', 'child-a', [selection(original(), pkg, { backdrop: null })], { package_name: pkg.name });
    const h = setup({ orders: [saved], paidKeys: [] }); assert.equal((await h.post()).status, 200);
    assert.equal(h.packageReads.filter(fields => fields.includes('is_retouch_addon') && fields.includes('photographer_id')).length, 0);
    assert.equal(h.proofQueries.length, 0); assert.equal(h.assetReads.length, 0);
  }
});

test('a real all-digital catalog ID cannot relabel a positive one-image line through a client package name', async () => {
  const snapshot = [selection(original(), allDigital, { backdrop: null, packageName: digital.name,
    slots: [{ label: allDigital.name, assignedImageUrl: original() }] })];
  const saved = order('a', 'child-a', snapshot, { package_name: digital.name });
  const h = setup({ orders: [saved], paidKeys: [], lines: [{ order_id: 'a', product_name: digital.name,
    quantity: 1, unit_price_cents: 1000, line_total_cents: 1000 }] });
  deniedWithoutPayment(h, await h.post(), /saved order needs review/);
  assert.equal(h.proofQueries.length, 0); assert.equal(h.assetReads.length, 0);
});

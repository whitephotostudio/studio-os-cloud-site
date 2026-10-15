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
const owner = uuid(1), schoolId = uuid(2), packageId = uuid(3), versionId = uuid(4), projectId = uuid(5);
const students = ['12345', '67890'].map((pin, index) => ({ id: uuid(10 + index), pin, school_id: schoolId, class_id: null }));
const schoolKey = index => `schools/school/student-${index}/original.jpg`;
const eventIds = [uuid(20), uuid(21)];
const design = { version: 1, name: 'Three moments', widthInches: 10, heightInches: 8, background: '#ffffff', ink: '#172033', overlay: null,
  slots: ['left', 'centre', 'right'].map((id, i) => ({ id, label: id, x: i * .3, y: .1, width: .25, height: .6 })), caption: { x: .5, y: .8, size: .028 } };
const storedVersion = { id: versionId, templateId: uuid(6), photographerId: owner, versionNumber: 2, design, artworkKey: `${owner}/collages/border.png`, contentHash: 'trusted-hash', published: true };
const pkg = { id: packageId, name: 'School keepsakes', category: 'print', price_cents: 1367, photographer_id: owner, active: true,
  items: [{ qty: 1, name: 'Ordinary portrait', size: '5x7' }, { qty: 2, name: 'Keepsake', size: '10x8', collage: { templateVersionId: versionId } }] };
const selection = (id, crop = .5) => ({ version: 1, templateVersionId: versionId, placements: design.slots.map(slot => ({ slotId: slot.id, mediaId: id, zoom: 1, x: crop, y: .5 })),
  caption: { studentName: 'Sample Student', schoolName: 'Sample School', year: '2026' }, design: { malicious: true }, artworkKey: 'other-owner/key.png', contentHash: 'fake-hash', price: 1 });
const entry = (id, quantity = 1) => ({ packageId, quantity, price: 1, packageSubtotalCents: 1, lineTotalCents: 1,
  slots: [...Array.from({ length: quantity }, () => ({ label: 'Ordinary', assignedImageUrl: id })),
    ...Array.from({ length: quantity * 2 }, (_, i) => ({ label: 'Collage', assignedImageUrl: null, collage: selection(id, (i + 1) / (quantity * 2 + 1)) }))] });
const common = { parent: { name: 'Test Parent', email: 'parent@example.test' }, delivery: { method: 'pickup' } };

function loader(stubs, enabled = '1') {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const code = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(code, { exports, Buffer, URL, URLSearchParams, Request, Response, console, crypto: globalThis.crypto,
      process: { env: { STUDIO_OS_COLLAGE_CHECKOUT_ENABLED: enabled } }, require(name) {
        if (name in stubs) return stubs[name];
        if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
        if (name.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name)) + '.ts');
        return require(name);
      } }, { filename: file });
    return exports;
  }
  return load;
}

function fixture({ enabled = '1', packageOverride = {}, rejectVersions = false, versions = [storedVersion] } = {}) {
  const orders = [], items = [], mediaCalls = [];
  const packages = [{ ...structuredClone(pkg), ...packageOverride }];
  const sb = {
    async rpc(name, args) {
      assert.equal(name, 'create_checkout_order_once');
      orders.push(...args.p_orders); items.push(...args.p_items);
      return { data: args.p_response, error: null };
    },
    from(table) {
      const filters = []; let single = false;
      const query = { select() { return query; }, eq(k, v) { filters.push(row => row[k] === v); return query; },
        order() { return query; }, range() { return query; },
        in(k, values) { filters.push(row => values.includes(row[k])); return query; }, maybeSingle() { single = true; return query; },
        then(resolve, reject) {
          const rows = (table === 'students' ? students : table === 'schools' ? [{ id: schoolId, photographer_id: owner }] : table === 'projects' ? [{ id: projectId, photographer_id: owner }]
            : table === 'photographers' ? [{ id: owner, subscription_status: 'active' }] : table === 'packages' ? packages : []).filter(row => filters.every(f => f(row)));
          return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
        } };
      return query;
    },
  };
  const authorize = (entries, allowed, context) => {
    mediaCalls.push(context);
    for (const item of entries) {
      const resolve = id => {
        if (!id) return null;
        if (!allowed.has(id)) throw Error('A selected photo is outside this gallery.');
        return id.startsWith('schools/') ? id : `events/project/${id}/original.jpg`;
      };
      item.selectedImageUrl = resolve(item.selectedImageUrl);
      for (const slot of item.slots) slot.assignedImageUrl = resolve(slot.assignedImageUrl);
      for (const selected of item.digitalSelections ?? []) selected.url = resolve(selected.mediaId);
    }
  };
  const stubs = {
    'server-only': {},
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => sb },
    '@/lib/parent-gallery-session-request': { parentGalleryRateKey: () => null },
    '@/lib/rate-limit': { rateLimit: async () => ({ allowed: true }), getClientIp: () => 'fixture' },
    '@/lib/subscription-gate': { hasActiveSubscription: () => true },
    '@/lib/event-gallery-settings': { normalizeEventGallerySettings: () => ({ extras: { shippingEnabled: false, pickupEnabled: true } }) },
    '@/lib/private-media-references': { durablePrivateMediaReference: id => id ?? '' },
    '@/lib/event-gallery-access': { validateEventGalleryAccess: async () => ({ ok: true, projectId, collectionIds: [uuid(7)], service: sb, project: { photographer_id: owner } }) },
    '@/lib/school-order-media': { resolveSchoolOrderMediaReferences: async (_sb, sid, studentId, photographerId, entries) => {
      assert.equal(sid, schoolId); assert.equal(photographerId, owner);
      const index = students.findIndex(student => student.id === studentId);
      authorize(entries, new Set([schoolKey(index)]), { studentId });
    } },
    '@/lib/event-order-media': { resolveEventOrderMediaReferences: async (_sb, pid, collections, entries) => {
      assert.equal(pid, projectId); assert.deepEqual(Array.from(collections), [uuid(7)]);
      authorize(entries, new Set([...eventIds, ...eventIds.map(id => `events/project/${id}/original.jpg`)]), { projectId: pid });
    } },
    '@/lib/collage-server': { resolveCollageVersions: async (_sb, photographerId, scope, ids) => {
      assert.equal(photographerId, owner); assert.ok(scope.schoolId === schoolId || scope.projectId === projectId);
      if (rejectVersions) throw Error('This collage is not available in this gallery.');
      return new Map(versions.filter(version => ids.includes(version.id) && version.published).map(version => [version.id, version]));
    } },
    '@/lib/parent-cutout-preflight': { assertParentBackdropCutouts: async () => {}, ParentCutoutPreflightError: class extends Error {}, isAllDigitalBackdropPackage: () => false },
    '@/lib/online-backdrop-policy': { assertNewOnlineBackdropPurchase: async () => {}, OnlineBackdropsDisabledError: class extends Error {} },
  };
  const load = loader(stubs, enabled);
  return { orders, items, mediaCalls, load, async post(body, combined = false) {
    const response = await load(`app/api/portal/orders/create${combined ? '-combined' : ''}/route.ts`).POST(new Request('https://fixture.invalid/api/orders', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() };
  } };
}
const schoolBody = (item = entry(schoolKey(0), 2)) => ({ ...common, mode: 'school', pin: students[0].pin, schoolId, entries: [item] });
const combinedBody = () => ({ ...common, groups: students.map((student, i) => ({ pin: student.pin, schoolId, email: common.parent.email, entries: [entry(schoolKey(i))] })) });

test('single checkout keeps mixed prints and four independently cropped collage copies at authoritative package pricing', async () => {
  const h = fixture();
  const result = await h.post(schoolBody());
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(h.orders.length, 1); assert.equal(h.orders[0].subtotal_cents, 2734);
  assert.equal(h.items.length, 6); assert.equal(h.items.reduce((sum, item) => sum + item.line_total_cents, 0), 2734);
  assert.equal(h.items.filter(item => item.sku === schoolKey(0)).length, 2);
  const collages = h.items.filter(item => item.collage_snapshot);
  assert.equal(collages.length, 4);
  assert.equal(new Set(collages.map(item => item.collage_snapshot.placements[0].x)).size, 4);
  for (const item of collages) {
    assert.equal(item.quantity, 1); assert.equal(item.sku, null);
    const saved = item.collage_snapshot;
    assert.equal(saved.design.name, design.name); assert.equal(saved.artworkKey, storedVersion.artworkKey); assert.equal(saved.contentHash, storedVersion.contentHash);
    assert.equal(saved.versionNumber, 2); assert.equal(saved.placements[0].mediaKey, schoolKey(0));
    assert.equal(saved.price, undefined); assert.equal(saved.design.malicious, undefined);
  }
  assert.equal(h.orders[0].cart_snapshot[0].slots.filter(slot => slot.collage).length, 4);
});

test('event collage purchases resolve authorized media IDs to original keys and keep one row per finished print', async () => {
  const h = fixture();
  const result = await h.post({ ...common, mode: 'event', pin: '12345', projectId, email: common.parent.email, entries: [entry(eventIds[0])] });
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(h.items.length, 3);
  assert.ok(h.items.filter(item => item.collage_snapshot).every(item => item.collage_snapshot.placements.every(p => p.mediaId === eventIds[0] && p.mediaKey.endsWith('/original.jpg'))));
});

test('combined checkout scopes every nested collage photo to its sibling and validates all groups before writes', async () => {
  const h = fixture(), body = combinedBody();
  const ok = await h.post(body, true);
  assert.equal(ok.status, 200, JSON.stringify(ok));
  assert.equal(h.orders.length, 2); assert.equal(h.items.length, 6);
  const collages = h.items.filter(item => item.collage_snapshot);
  assert.equal(collages.length, 4);
  assert.deepEqual(new Set(collages.map(item => item.collage_snapshot.placements[0].mediaKey)), new Set([schoolKey(0), schoolKey(1)]));
  const attack = fixture(), malicious = combinedBody();
  malicious.groups[1].entries[0].slots[1].collage.placements[0].mediaId = schoolKey(0);
  const rejected = await attack.post(malicious, true);
  assert.equal(rejected.status, 409, JSON.stringify(rejected)); assert.equal(attack.orders.length, 0); assert.equal(attack.items.length, 0);
});

test('single and combined routes reject unauthorized nested photos, incomplete selections and invalid crops', async () => {
  for (const combined of [false, true]) {
    for (const tamper of [item => { item.slots[1].collage.placements[0].mediaId = schoolKey(1); },
      item => { item.slots[1].collage.placements.pop(); }, item => { item.slots[1].collage.placements[0].x = 1.01; },
      item => { item.slots[1].collage.placements[0].mediaId = 'https://attacker.test/image.jpg'; }]) {
      const h = fixture(), body = combined ? combinedBody() : schoolBody(entry(schoolKey(0)));
      tamper(combined ? body.groups[0].entries[0] : body.entries[0]);
      const result = await h.post(body, combined);
      assert.ok([400, 409].includes(result.status), JSON.stringify(result)); assert.equal(h.orders.length, 0);
    }
  }
});

test('stale template, copy counts, product size and conflicting digital/composite configuration fail closed', async () => {
  const cases = [
    { mutate: item => { item.slots[1].collage.templateVersionId = uuid(99); } },
    { mutate: item => { item.slots.pop(); } },
    { mutate: item => { item.quantity = 2; } },
    { packageOverride: { items: [{ qty: 1, name: 'Print' }, { qty: 2, size: '8x10', collage: { templateVersionId: versionId } }] } },
    { packageOverride: { category: 'digital' } },
    { mutate: item => { item.isComposite = true; } },
    { rejectVersions: true },
    { packageOverride: { items: [{ collage: { templateVersionId: 'invalid' } }] }, mutate: item => { item.slots = []; } },
    { packageOverride: { items: [{ collage: false }] }, mutate: item => { item.slots = []; } },
  ];
  for (const c of cases) {
    const h = fixture(c), item = entry(schoolKey(0)); c.mutate?.(item);
    const result = await h.post(schoolBody(item));
    assert.equal(result.status, 409, JSON.stringify({ c, result })); assert.equal(h.orders.length, 0);
  }
});

test('collage purchase remains gated by default while existing ordinary orders still work', async () => {
  const disabled = fixture({ enabled: '' });
  const result = await disabled.post(schoolBody(entry(schoolKey(0))));
  assert.equal(result.status, 409); assert.match(result.body.message, /preview/); assert.equal(disabled.orders.length, 0);
  const ordinary = fixture({ enabled: '', packageOverride: { items: ['5x7'] } });
  const ok = await ordinary.post(schoolBody({ packageId, quantity: 1, slots: [{ label: '5x7', assignedImageUrl: schoolKey(0) }] }));
  assert.equal(ok.status, 200, JSON.stringify(ok)); assert.equal(ordinary.items[0].collage_snapshot, undefined);
});

test('restored order snapshots are reparsed and cannot replace immutable design or authorized media keys', async () => {
  const first = fixture(); await first.post(schoolBody(entry(schoolKey(0))));
  const snapshot = JSON.parse(JSON.stringify(first.orders[0].cart_snapshot[0]));
  snapshot.slots[1].collage.design.name = 'forged'; snapshot.slots[1].collage.placements[0].mediaKey = schoolKey(1);
  const reordered = fixture(); const result = await reordered.post(schoolBody(snapshot));
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(reordered.items[1].collage_snapshot.design.name, design.name);
  assert.equal(reordered.items[1].collage_snapshot.placements[0].mediaKey, schoolKey(0));
});


test('reorders retain an authorized older version of the same template and size using current product pricing', async () => {
  const oldId = uuid(40);
  const old = { ...storedVersion, id: oldId, versionNumber: 1, design: { ...design, name: 'Original layout' }, contentHash: 'original-hash' };
  const item = entry(schoolKey(0));
  for (const slot of item.slots.filter(slot => slot.collage)) slot.collage.templateVersionId = oldId;
  const h = fixture({ versions: [storedVersion, old] });
  const result = await h.post(schoolBody(item));
  assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(h.orders[0].subtotal_cents, 1367);
  const saved = h.items[1].collage_snapshot;
  assert.equal(saved.templateVersionId, oldId); assert.equal(saved.design.name, 'Original layout'); assert.equal(saved.contentHash, 'original-hash');
  assert.equal(saved.placements[0].mediaKey, schoolKey(0));
});

test('reorders reject older versions from a different template, different print size, revoked access or unauthorized media', async () => {
  const oldId = uuid(40);
  for (const patch of [{ templateId: uuid(41) }, { design: { ...design, widthInches: 12 } }, { published: false }, { unauthorized: true }]) {
    const item = entry(schoolKey(0));
    for (const slot of item.slots.filter(slot => slot.collage)) slot.collage.templateVersionId = oldId;
    if (patch.unauthorized) item.slots[1].collage.placements[0].mediaId = schoolKey(1);
    const h = fixture({ versions: [storedVersion, { ...storedVersion, id: oldId, versionNumber: 1, ...patch }] });
    const result = await h.post(schoolBody(item));
    assert.equal(result.status, 409, JSON.stringify({ patch, result })); assert.equal(h.orders.length, 0);
  }
});

test('disabling collage purchasing also blocks saved single and sibling payment drafts before provider work', async () => {
  for (const grouped of [false, true]) {
    for (const enabled of ['', '1']) {
      let preflights = 0, released = 0, authorized = 0;
      const groupId = grouped ? uuid(60) : null;
      const rows = [0, ...(grouped ? [1] : [])].map(index => ({ id: uuid(61 + index), order_group_id: groupId,
        status: 'payment_pending', payment_status: null, cart_snapshot: index === (grouped ? 1 : 0) ? [{ slots: [{ collage: selection(schoolKey(index)) }] }] : [{ slots: [] }] }));
      class ExpectedPreflightStop extends Error { status = 418; }
      const sb = { from(table) {
        assert.equal(table, 'orders'); let single = false; const filters = [];
        const query = { select() { return query; }, eq(k, v) { filters.push(row => row[k] === v); return query; },
          in(k, values) { filters.push(row => values.includes(row[k])); return query; }, order() { return query; },
          maybeSingle() { single = true; return query; }, then(resolve, reject) {
            const matching = rows.filter(row => filters.every(f => f(row)));
            return Promise.resolve({ data: single ? matching[0] ?? null : matching, count: matching.length, error: null }).then(resolve, reject);
          } };
        return query;
      } };
      const load = loader({
        'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
        '@/lib/dashboard-auth': { createDashboardServiceClient: () => sb },
        '@/lib/order-payment-lock': { lockOrderPayment: async () => async () => { released++; } },
        '@/lib/parent-gallery-session-request': { getParentGalleryRequestScope: () => null },
        '@/lib/parent-gallery-session': { ParentGallerySessionError: class extends Error {} },
        '@/lib/parent-checkout-return': { parentCheckoutPrivateHeaders: {}, ParentCheckoutReturnError: ExpectedPreflightStop,
          authorizeParentCheckout: async () => { authorized++; if (enabled) throw new ExpectedPreflightStop('Reached authorized enabled draft');
            return { applyCookie: async response => response }; } },
        '@/lib/parent-cutout-preflight': { ParentCutoutPreflightError: class extends Error {} },
        '@/lib/stored-order-backdrop-preflight': { assertStoredOrderBackdropCutouts: async () => { preflights++; throw new ExpectedPreflightStop(); } },
        '@/lib/online-backdrop-policy': { OnlineBackdropsDisabledError: class extends Error {} },
        '@/lib/payments': { OrderFeeClassificationError: class extends Error {} },
      }, enabled);
      const response = await load('app/api/stripe/checkout/route.ts').POST(new Request('https://fixture.invalid/api/stripe/checkout', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId: rows[0].id }),
      }));
      const body = await response.json();
      assert.equal(response.status, enabled ? 418 : 409, JSON.stringify(body));
      if (!enabled) assert.match(body.message, /preview/);
      assert.equal(authorized, 1); assert.equal(preflights, 0); assert.equal(released, 1);
    }
  }
});


test('explicit collage print configuration overrides arbitrary digital, retouch, size and material words in names', async () => {
  const names = ['Digital canvas wallet 5x7', 'Download PNG artwork', 'USB JPEG file keepsake', 'Retouched memories', 'All digital bundle'];
  for (const combined of [false, true]) for (const category of ['print', 'package']) for (const name of names) {
    const h = fixture({ packageOverride: { name, category, items: [{ qty: 1, name: 'Digital style ordinary print', type: 'print', size: '5x7' },
      { qty: 2, name: `${name} design`, type: 'print', size: '10x8', collage: { templateVersionId: versionId } }] } });
    const body = combined ? { ...common, groups: [{ pin: students[0].pin, schoolId, email: common.parent.email, entries: [entry(schoolKey(0))] }] } : schoolBody(entry(schoolKey(0)));
    const result = await h.post(body, combined);
    assert.equal(result.status, 200, JSON.stringify({ combined, category, name, result }));
    assert.equal(h.orders[0].subtotal_cents, 1367); assert.equal(h.items.length, 3); assert.equal(h.items.filter(item => item.collage_snapshot).length, 2);
    assert.ok(h.items.every(item => item.quantity === 1)); assert.ok(h.items.filter(item => item.collage_snapshot).every(item => item.sku === null));
  }
});

test('explicit digital/add-on/composite role conflicts still reject collage products while ordinary name heuristics are preserved', async () => {
  for (const combined of [false, true]) for (const packageOverride of [{ is_retouch_addon: true, name: 'Keepsake' }, { category: 'digital' }, { category: 'class-composite' },
    { items: [{ qty: 1, name: 'Print' }, { qty: 2, type: 'digital', size: '10x8', collage: { templateVersionId: versionId } }] },
    { items: [{ qty: 1, name: 'Print' }, { qty: 2, type: 'class-composite', size: '10x8', collage: { templateVersionId: versionId } }] }]) {
    const h = fixture({ packageOverride });
    const body = combined ? { ...common, groups: [{ pin: students[0].pin, schoolId, email: common.parent.email, entries: [entry(schoolKey(0))] }] } : schoolBody(entry(schoolKey(0)));
    const result = await h.post(body, combined);
    assert.equal(result.status, combined && packageOverride.is_retouch_addon ? 400 : 409, JSON.stringify({ combined, packageOverride, result })); assert.equal(h.orders.length, 0);
  }
  for (const combined of [false, true]) {
    const h = fixture({ packageOverride: { name: 'Digital download', category: 'package', items: [] } });
    const ordinary = { packageId, quantity: 2, slots: [{ label: 'Legacy digital', assignedImageUrl: schoolKey(0) }], selectedImageUrl: schoolKey(0) };
    const body = combined ? { ...common, groups: [{ pin: students[0].pin, schoolId, email: common.parent.email, entries: [ordinary] }] } : schoolBody(ordinary);
    const result = await h.post(body, combined);
    assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(h.items.length, 1); assert.equal(h.items[0].quantity, 2);
    assert.equal(h.items[0].collage_snapshot, undefined); assert.equal(h.items[0].line_total_cents, 2734);
  }
});

test('collage category helpers honor configured product roles and sizes without interpreting free-form names', () => {
  const { getPackageCategory, getGalleryPackageCategory } = loader({})('lib/package-categories.ts');
  const { isRetouchPackage, isRetouchPrintPurchase } = loader({})('lib/retouching.ts');
  for (const name of ['Digital download canvas wallet 5x7', 'Retouched memories', 'PNG file design']) {
    const collage = { name, description: 'USB download 4x6', category: 'package', items: [{ name, type: 'print', size: '10x8', collage: { templateVersionId: versionId } }] };
    assert.equal(getPackageCategory(collage), 'package'); assert.equal(getGalleryPackageCategory(collage), 'package');
    assert.equal(getPackageCategory({ ...collage, category: 'print' }), 'print'); assert.equal(getGalleryPackageCategory({ ...collage, category: 'print' }), 'print');
    assert.equal(isRetouchPackage(collage), false); assert.equal(isRetouchPrintPurchase(collage), true);
    assert.equal(isRetouchPackage({ ...collage, is_retouch_addon: true }), true);
  }
  assert.equal(getPackageCategory({ name: 'Digital download', category: 'package', items: [] }), 'digital');
  assert.equal(isRetouchPackage({ name: 'Retouched portrait service' }), true);
});

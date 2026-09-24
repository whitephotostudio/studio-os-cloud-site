import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as policy from '../lib/retouching.ts';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');
const schoolId = '10000000-0000-4000-8000-000000000001';
const photographerId = '20000000-0000-4000-8000-000000000001';
const retouch = { id: '30000000-0000-4000-8000-000000000001', name: 'Retouching - 1 Image', category: 'specialty', price_cents: 1000, photographer_id: photographerId, active: true };
const print = { ...retouch, id: '30000000-0000-4000-8000-000000000002', name: '5x7 Print', category: 'print' };
const digital = { ...print, id: '30000000-0000-4000-8000-000000000003', name: 'Digital image', category: 'digital' };
const customRetouch = { ...retouch, id: '30000000-0000-4000-8000-000000000004', name: 'Skin polish', is_retouch_addon: true };
const packages = [retouch, print, digital, customRetouch];
const selection = { imageUrl: 'school/student/pose.jpg', notes: 'Keep freckles.' };
const entry = (pkg) => ({ packageId: pkg.id, quantity: 1, slots: [{ label: pkg.name, assignedImageUrl: selection.imageUrl }], retouchSelections: policy.isRetouchPackage(pkg) ? [selection] : [] });
const group = (entries, pin = '12345') => ({ schoolId, pin, email: 'parent@example.test', entries });
const common = { parent: { name: 'Test parent', email: 'parent@example.test' }, delivery: { method: 'pickup' } };

function loader(stubs) {
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const exports = {};
    cache.set(path, exports);
    const js = ts.transpileModule(source(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(js, {
      exports, URL, Response, Request, console, crypto: globalThis.crypto, Buffer, process,
      require(name) {
        if (name in stubs) return stubs[name];
        if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
        return require(name);
      },
    }, { filename: path });
    return exports;
  }
  return load;
}

function setup({ storedOrders = [], storedItems = [] } = {}) {
  const writes = [], payments = [];
  const sb = {
    rpc: async (name, args) => {
      if (name === 'acquire_order_payment_lock') return { data: true, error: null };
      if (name === 'create_checkout_order_once') {
        for (const order of args.p_orders) writes.push({ table: 'orders', value: order });
        writes.push({ table: 'order_items', value: args.p_items });
        return { data: args.p_response, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
    from(table) {
      let filters = [], inserted, updated, single = false;
      const query = {
        select() { return query; },
        eq(key, value) { filters.push((row) => row[key] === value); return query; },
        in(key, value) { filters.push((row) => value.includes(row[key])); return query; },
        order() { return query; },
        maybeSingle() { single = true; return query; },
        single() { single = true; return query; },
        insert(value) { inserted = value; writes.push({ table, value }); return query; },
        update(value) { updated = value; writes.push({ table, value }); return query; },
        delete() {
          if (table !== 'order_payment_locks') throw new Error('Unexpected rollback');
          return query;
        },
        then(resolve, reject) {
          try {
            let rows = table === 'packages' ? packages : table === 'students' ? ['12345','67890'].map(pin => ({ id: 'student-' + pin, pin, school_id: schoolId, class_id: null }))
              : table === 'schools' ? [{ id: schoolId, photographer_id: photographerId }]
              : table === 'photographers' ? [{ id: photographerId, subscription_status: 'active' }]
              : table === 'orders' ? storedOrders : table === 'order_items' ? storedItems : [];
            if (inserted) rows = [{ id: 'new-order-' + writes.length }];
            else if (updated) rows = [];
            else rows = rows.filter(row => filters.every(filter => filter(row)));
            return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
          } catch (error) { return Promise.reject(error).then(resolve,reject); }
        },
      };
      return query;
    },
  };
  const stubs = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => sb },
    '@/lib/event-gallery-access': { validateEventGalleryAccess: async ({ projectId }) => ({ ok: true, projectId, service: sb, project: { photographer_id: photographerId } }) },
    '@/lib/event-gallery-settings': { normalizeEventGallerySettings: () => ({ extras: { shippingEnabled: false, pickupEnabled: true } }) },
    '@/lib/rate-limit': { rateLimit: async () => ({ allowed: true }), getClientIp: () => 'test' },
    '@/lib/subscription-gate': { hasActiveSubscription: () => true },
    '@/lib/private-media-references': { durablePrivateMediaReference: value => value ?? '' },
    '@/lib/payments': {
      isStripeBillingActive: () => true, getConnectedAccountId: () => 'acct_test',
      retrieveStripeAccount: async () => ({ details_submitted: true, charges_enabled: true, payouts_enabled: true }),
      syncConnectState: async () => {}, describeConnectStatus: () => ({ readyForPayments: true }),
      createDirectOrderCheckoutSession: async (args) => { payments.push(args); return { id: 'test-session', url: 'https://checkout.example.test' }; },
    },
  };
  const load = loader(stubs);
  return { writes, payments, async post(path, body) {
    const response = await load(path).POST(new Request('https://gallery.example.test/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json() };
  } };
}

const createPath = 'app/api/portal/orders/create/route.ts';
const combinedPath = 'app/api/portal/orders/create-combined/route.ts';
const stripePath = 'app/api/stripe/checkout/route.ts';

test('print requirement recognizes actual prints, bundles and service flags', () => {
  for (const pkg of [print, { name: '2 - 5×7' }, { name: 'Package A', category: 'package' }, { name: 'Print + digital', items: ['8x10', 'Digital'] }, { name: 'Wall art', category: 'canvas' }]) {
    assert.equal(policy.isRetouchPrintPurchase(pkg), true, JSON.stringify(pkg));
    assert.equal(policy.retouchPrintPurchaseIssue([{ pkg: retouch }, { pkg }]), '');
  }
  for (const pkg of [retouch, customRetouch, digital, { name: 'Shipping' }, { name: 'Late handling (10%)' }, { name: 'Mug', category: 'specialty' }, { name: 'All Digital Package', category: 'package' }]) {
    assert.equal(policy.isRetouchPrintPurchase(pkg), false, JSON.stringify(pkg));
  }
  assert.equal(policy.retouchPrintPurchaseIssue([{ pkg: retouch }, { pkg: print, quantity: 0 }]), policy.RETOUCH_PRINT_REQUIRED);
  assert.equal(policy.retouchPrintPurchaseIssue([{ pkg: retouch, galleryKey: 'child-a' }, { pkg: print, galleryKey: 'child-b' }]), policy.RETOUCH_PRINT_REQUIRED);
});

for (const mode of ['school', 'event']) {
  test(`${mode} create rejects retouching-only and digital-plus-retouching before writing an order`, async () => {
    for (const chosen of [[retouch], [customRetouch], [digital,retouch]]) {
      const h = setup();
      const result = await h.post(createPath, { ...common, mode, pin: '12345', schoolId, projectId: schoolId, email: 'parent@example.test', entries: chosen.map(entry) });
      assert.equal(result.status, 400, JSON.stringify(result));
      assert.equal(result.body.message, policy.RETOUCH_PRINT_REQUIRED);
      assert.equal(h.writes.length, 0);
    }
  });
}

test('valid print plus retouching creates both paid lines', async () => {
  const h = setup();
  const result = await h.post(createPath, { ...common, mode: 'school', pin: '12345', schoolId, entries: [entry(print), entry(retouch)] });
  assert.equal(result.status, 200, JSON.stringify(result));
  const order = h.writes.find(write => write.table === 'orders').value;
  assert.equal(order.cart_snapshot.length, 2);
  assert.equal(order.subtotal_cents, 2000);
  assert.equal(h.writes.find(write => write.table === 'order_items').value.length, 2);
});

test('combined checkout rejects standalone retouching even when a sibling buys prints', async () => {
  const h = setup();
  const result = await h.post(combinedPath, { ...common, groups: [group([entry(print)]), group([entry(retouch)], '67890')] });
  assert.equal(result.status, 400, JSON.stringify(result));
  assert.equal(result.body.message, policy.RETOUCH_PRINT_REQUIRED);
  assert.equal(h.writes.length, 0);
});

test('combined checkout accepts a print and retouching in the same student order', async () => {
  const h = setup();
  const result = await h.post(combinedPath, { ...common, groups: [group([entry(print), entry(retouch)]), group([entry(print)], '67890')] });
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(h.writes.filter(write => write.table === 'orders').length, 2);
});

function savedOrder(chosen, id = 'saved-order', groupId = null, legacy = false) {
  return { id, order_group_id: groupId, school_id: schoolId, student_id: 'test-student', photographer_id: photographerId, package_id: chosen[0].id, package_name: chosen[0].name, cart_snapshot: legacy ? null : chosen.map(pkg => ({ packageId: pkg.id, packageName: pkg.name, quantity: 1 })), subtotal_cents: chosen.length * 1000, total_cents: chosen.length * 1000, tax_cents: 0, currency: 'cad', status: 'payment_pending' };
}
const savedLines = (chosen, orderId = 'saved-order') => chosen.map(pkg => ({ order_id: orderId, product_name: pkg.name, quantity: 1, unit_price_cents: 1000, line_total_cents: 1000 }));

test('Stripe rejects previously saved retouching-only drafts, including legacy flagged services', async () => {
  for (const legacy of [false, true]) {
    for (const chosen of [[retouch], [customRetouch], [digital,retouch]]) {
      const h = setup({ storedOrders: [savedOrder(chosen, 'saved-order', null, legacy)], storedItems: savedLines(chosen) });
      const result = await h.post(stripePath, { orderId: 'saved-order', pin: '12345', schoolId });
      assert.equal(result.status, 400, JSON.stringify(result));
      assert.equal(result.body.message, policy.RETOUCH_PRINT_REQUIRED);
      assert.equal(h.payments.length, 0);
    }
  }
});

test('Stripe accepts a valid print with retouching and charges both products', async () => {
  const chosen = [print,retouch];
  const h = setup({ storedOrders: [savedOrder(chosen)], storedItems: savedLines(chosen) });
  const result = await h.post(stripePath, { orderId: 'saved-order', pin: '12345', schoolId });
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(h.payments.length, 1);
  assert.equal(h.payments[0].totalCents, 2000);
});

test('Stripe checks each persisted sibling order independently', async () => {
  const h = setup({ storedOrders: [savedOrder([print], 'a','group'), savedOrder([retouch], 'b','group')], storedItems: [...savedLines([print],'a'), ...savedLines([retouch],'b')] });
  const result = await h.post(stripePath, { orderId: 'a', pin: '12345', schoolId });
  assert.equal(result.status, 400, JSON.stringify(result));
  assert.equal(result.body.message, policy.RETOUCH_PRINT_REQUIRED);
  assert.equal(h.payments.length, 0);
});

const gallerySource = source('app/parents/[pin]/page.tsx');
const galleryAst = ts.createSourceFile('gallery.tsx', gallerySource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlerNames = ['retouchPolicyEntry', 'addRetouchAddonToCart', 'removeCartItem'];
const handlerSources = [];
function findHandlers(node) {
  if (ts.isFunctionDeclaration(node) && handlerNames.includes(node.name?.text)) handlerSources.push(node.getText(galleryAst));
  ts.forEachChild(node,findHandlers);
}
findHandlers(galleryAst);

function cartHarness({ cart = [], draft = null } = {}) {
  const state = {
    ...policy, packages, cartItems: cart, currentDraftCartItem: draft,
    checkoutItems: draft ? [...cart,draft] : cart,
    currentLane: { laneKey: 'child-a', schoolId, studentId: 'child-a', pin: '12345' },
    retouchPhotoOptions: [{ imageUrl: selection.imageUrl }],
    getCategory: pkg => pkg.category, crypto: globalThis.crypto,
    setOrderError: message => { state.error = message; },
    showGalleryActionNotice: message => { state.notice = message; },
    setCartItems: value => { state.cartItems = typeof value === 'function' ? value(state.cartItems) : value; },
    resetCurrentSelection: () => { state.currentDraftCartItem = null; },
    setRetouchUpsellShown: () => {}, setRetouchUpsellOpen: () => {},
  };
  vm.createContext(state);
  vm.runInContext(ts.transpileModule(handlerSources.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, state);
  return state;
}
const cartLine = (pkg, id, laneKey = 'child-a') => ({ id, packageId: pkg.id, packageName: pkg.name, category: pkg.category, quantity: 1, slots: [{ label: pkg.name, assignedImageUrl: selection.imageUrl }], laneKey });

test('actual add-on handler blocks an empty basket, downloads-only and another sibling print', () => {
  for (const cart of [[], [cartLine(digital,'digital')], [cartLine(print,'sibling','child-b')]]) {
    const ui = cartHarness({ cart });
    ui.addRetouchAddonToCart(retouch, [selection]);
    assert.equal(ui.error, policy.RETOUCH_PRINT_REQUIRED);
    assert.equal(ui.cartItems.length, cart.length);
  }
});

test('actual add-on handler saves the draft print together with retouching before browsing away', () => {
  const ui = cartHarness({ draft: cartLine(print, '__draft__', undefined) });
  ui.addRetouchAddonToCart(retouch, [selection]);
  assert.equal(ui.error, '');
  assert.equal(ui.currentDraftCartItem, null);
  assert.equal(ui.cartItems.length, 2);
  assert.equal(ui.cartItems[0].packageId, print.id);
  assert.notEqual(ui.cartItems[0].id, '__draft__');
  assert.equal(ui.cartItems[0].laneKey, 'child-a');
  assert.equal(ui.cartItems[1].packageId, retouch.id);
});

test('actual remove handler keeps the last print until its add-on is removed', () => {
  const ui = cartHarness({ cart: [cartLine(print,'print'), cartLine(retouch,'retouch')] });
  ui.removeCartItem('print');
  assert.equal(ui.cartItems.length, 2);
  assert.match(ui.error, /Remove the retouching add-on/);
  assert.equal(ui.notice, ui.error);
  ui.removeCartItem('retouch');
  ui.removeCartItem('print');
  assert.equal(ui.cartItems.length, 0);
});

test('removing one print is allowed when another print remains for that student', () => {
  const ui = cartHarness({ cart: [cartLine(print,'one'), cartLine(print,'two'), cartLine(retouch,'retouch')] });
  ui.removeCartItem('one');
  assert.equal(ui.cartItems.length, 2);
  assert.equal(ui.error, '');
});

test('retouching UI states that a print is required and checkout rejects stale standalone carts', () => {
  assert.match(gallerySource, /Print purchase required\./);
  assert.match(gallerySource, /It does not include a printed photo or a digital download\./);
  assert.match(gallerySource, /if \(retouchCheckoutIssue\)\s*\{\s*setOrderError\(retouchCheckoutIssue\);\s*return;/);
  assert.match(gallerySource, /disabled=\{[\s\S]*?\(!!digitalFavoritesPackIssue \|\| !!retouchCheckoutIssue\)/);
});

test('ordinary print-only and digital-only checkout remain available', async () => {
  for (const chosen of [[print],[digital]]) {
    const h = setup({ storedOrders: [savedOrder(chosen)], storedItems: savedLines(chosen) });
    const result = await h.post(stripePath, { orderId: 'saved-order', pin: '12345', schoolId });
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(h.payments.length, 1);
    assert.equal(h.payments[0].totalCents, 1000);
  }
});

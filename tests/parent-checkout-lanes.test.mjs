import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { createElement } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const load = (path) => { const exports = {}; new Function('exports', compile(read(path)))(exports); return exports; };
const cart = load('lib/combine-cart-storage.ts');
const media = load('lib/event-gallery-media-client.ts');
const source = read('components/parents/parent-gallery-client.tsx');
const ast = ts.createSourceFile('parents.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  let result;
  const visit = (node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node; ts.forEachChild(node, visit); };
  visit(ast); assert.ok(result, `Missing production function ${name}`); return result.getText(ast);
}
const lane = (name) => ({ laneKey: `school-${name}:student-${name}`, schoolId: `school-${name}`, studentId: `student-${name}`,
  pin: `PIN-${name}`, email: `viewer-${name}@example.test`, studentName: `Child ${name}`, schoolName: `School ${name}` });
const item = (name, { draft = false, premium = false } = {}) => ({ id: draft ? '__draft__' : `item-${name}`,
  packageId: `pkg-${name}`, packageName: `Print ${name}`, category: 'print', quantity: 1, packageSubtotalCents: 1200,
  backdropAddOnCents: premium ? 400 : 0, lineTotalCents: premium ? 1600 : 1200,
  selectedImageUrl: `school-${name}/Class/Child/photo.jpg`, slots: [{ label: '8x10', assignedImageUrl: `school-${name}/Class/Child/photo.jpg` }],
  backdrop: premium ? { id: 'premium', blurred: true, blurAmount: 8 } : null,
  isCompositeOrder: false, compositeTitle: null, orientation: 'portrait', ...(draft ? {} : { laneKey: lane(name).laneKey }) });

function harness({ saved, draft, current, billing = 'buyer@example.test' }) {
  const requests = [], errors = [], state = { placing: false };
  const checkoutItems = [...saved, ...(draft ? [draft] : [])];
  const currentLane = lane(current);
  const context = {
    ...cart, ...media, orderingDisabled: false, isSchoolMode: true, student: { id: currentLane.studentId, school_id: currentLane.schoolId },
    checkoutItems, cartItems: saved, currentDraftCartItem: draft, currentLane,
    photographerId: 'studio', combineLanes: ['A', 'B', 'C'].map(lane), persistedItems: saved,
    checkoutBackdropIssue: '', retouchCheckoutIssue: '', digitalFavoritesPackIssue: '', parentEmail: billing,
    packages: [], retouchSelectionIssue: () => '', retouchAddonPackages: [], retouchPhotoOptions: [], retouchUpsellShown: true,
    shippingEnabledForGallery: false, anyPhysicalCheckoutItem: true, activeDeliveryMethod: 'pickup',
    setPlacing: (value) => { state.placing = value; }, setOrderError: (value) => { if (value) errors.push(value); },
    verifyBackdropCheckout: async () => '', project: null, projectId: '',
    checkoutTaxableCents: checkoutItems.reduce((sum, entry) => sum + entry.lineTotalCents, 0), minimumOrderAmountCents: 0,
    images: [], parentName: 'Buyer', parentPhone: '', notes: '', currentGalleryExtras: { allowClientComments: false },
    pin: currentLane.pin, mode: 'school', schoolViewerEmail: currentLane.email, eventEmail: '',
    DEFAULT_BACKDROP_BLUR_PX: 4, sessionStorage: { getItem: () => 'purchase' },
    checkoutAttemptForPayload: async () => 'attempt-id', window: { location: { href: '' } },
    fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => url === '/api/stripe/checkout' ? { ok: true, url: 'https://checkout.example.test' } :
        { ok: true, primaryOrderId: 'order-id', orderId: 'order-id' } }; },
  };
  const helpers = ['persistParentCartItems', 'requiresCombinedParentCheckout'].filter((name) => source.includes(`function ${name}(`)).map(declaration).join('\n');
  const submit = new Function('context', `with (context) { ${compile(helpers + '\n' + declaration('placeOrderAttempt'))}\nreturn placeOrderAttempt; }`)(context);
  return { requests, errors, state, context, submit: () => submit({ preventDefault() {} }) };
}

test('saved sibling basket plus an unadded current package submits both lanes and every reviewed item', async () => {
  const h = harness({ saved: [item('A')], draft: item('B', { draft: true, premium: true }), current: 'B' });
  await h.submit();
  assert.deepEqual(h.errors, []);
  const create = h.requests.find((request) => request.url.startsWith('/api/portal/orders/create'));
  assert.equal(create.url, '/api/portal/orders/create-combined');
  assert.deepEqual(create.body.groups.map((group) => ({ schoolId: group.schoolId, email: group.email, packages: group.entries.map((entry) => entry.packageId) })), [
    { schoolId: 'school-A', email: 'viewer-A@example.test', packages: ['pkg-A'] },
    { schoolId: 'school-B', email: 'viewer-B@example.test', packages: ['pkg-B'] },
  ]);
  assert.deepEqual(create.body.groups[1].entries[0].backdrop, { id: 'premium', blurred: true, blurAmount: 8 });
  assert.equal(create.body.groups.reduce((sum, group) => sum + group.entries.length, 0), h.context.checkoutItems.length);
  assert.equal(h.context.window.location.href, 'https://checkout.example.test');
});

test('two saved sibling lanes plus a new current draft cannot omit the draft from the submitted purchase', async () => {
  const h = harness({ saved: [item('A'), item('B')], draft: item('C', { draft: true }), current: 'C' });
  await h.submit();
  assert.deepEqual(h.errors, []);
  const create = h.requests.find((request) => request.url === '/api/portal/orders/create-combined');
  assert.ok(create);
  assert.deepEqual(create.body.groups.flatMap((group) => group.entries.map((entry) => entry.packageId)), ['pkg-A', 'pkg-B', 'pkg-C']);
  assert.equal(create.body.groups.reduce((sum, group) => sum + group.entries.length, 0), h.context.checkoutItems.length);
});

test('a saved sibling-only basket uses that sibling access and return context when browsing a different gallery', async () => {
  const h = harness({ saved: [item('A')], draft: null, current: 'B', billing: 'edited-buyer@example.test' });
  const before = structuredClone(h.context.cartItems);
  await h.submit();
  assert.deepEqual(h.errors, []);
  const create = h.requests.find((request) => request.url === '/api/portal/orders/create-combined');
  assert.ok(create);
  assert.equal(create.body.groups.length, 1);
  assert.equal(create.body.groups[0].pin, 'PIN-A');
  assert.equal(create.body.groups[0].email, 'viewer-A@example.test');
  assert.equal(create.body.parent.email, 'edited-buyer@example.test');
  assert.deepEqual(h.requests.find((request) => request.url === '/api/stripe/checkout').body, {
    orderId: 'order-id', pin: 'PIN-A', schoolId: 'school-A', projectId: null, mode: 'school',
    email: 'viewer-A@example.test', customerEmail: 'edited-buyer@example.test',
  });
  assert.deepEqual(h.context.cartItems, before, 'checkout never reassigns or rewrites the saved sibling basket');
});

test('ordinary current-gallery selection keeps the single checkout path and edited receipt email', async () => {
  const h = harness({ saved: [], draft: item('B', { draft: true }), current: 'B', billing: 'edited-buyer@example.test' });
  await h.submit();
  assert.deepEqual(h.errors, []);
  const create = h.requests.find((request) => request.url === '/api/portal/orders/create');
  assert.ok(create);
  assert.equal(create.body.entries[0].packageId, 'pkg-B');
  assert.equal(create.body.parent.email, 'edited-buyer@example.test');
  const stripe = h.requests.find((request) => request.url === '/api/stripe/checkout');
  assert.equal(stripe.body.email, 'viewer-B@example.test');
  assert.equal(stripe.body.customerEmail, 'edited-buyer@example.test');
});

test('a saved item without its gallery lane stops checkout before any order or payment request', async () => {
  const h = harness({ saved: [{ ...item('A'), laneKey: 'missing-lane' }], draft: null, current: 'B' });
  const before = structuredClone(h.context.cartItems);
  await h.submit();
  assert.equal(h.requests.length, 0);
  assert.match(h.errors[0], /gallery in your basket needs to be reopened/);
  assert.equal(h.state.placing, false);
  assert.deepEqual(h.context.cartItems, before);
});

function hookCallback(fragment, hook) {
  let callback;
  const visit = (node) => { if (ts.isCallExpression(node) && node.expression.getText(ast) === hook &&
    node.arguments[0]?.getText(ast).includes(fragment)) callback = node.arguments[0]; ts.forEachChild(node, visit); };
  visit(ast); assert.ok(callback); return callback.getText(ast);
}

test('current gallery authorization uses its viewer identity while the buyer edits the receipt email', () => {
  const callback = hookCallback('studentName', 'useMemo');
  const values = { photographerId: 'studio', student: { id: 'student-B', school_id: 'school-B', first_name: 'Child' },
    pin: 'PIN-B', parentEmail: 'billing@example.test', schoolViewerEmail: 'viewer-B@example.test', schoolName: 'School B',
    clean: (value) => (value ?? '').trim(), laneKeyFor: cart.laneKeyFor };
  const get = new Function('context', `with (context) { return ${compile('(' + callback + ')').replace(/;\s*$/, '')}; }`)(values);
  assert.equal(get().email, values.schoolViewerEmail);
  values.parentEmail = 'other-billing@example.test';
  assert.equal(get().email, values.schoolViewerEmail);
});

test('refreshed gallery PIN or viewer email is persisted even if saved item IDs are unchanged', () => {
  const saves = [], values = { isSchoolMode: true, combineHydratedRef: { current: true }, photographerId: 'studio',
    combineLanes: [lane('B')], persistedItems: [item('B')], lastPersistedSignatureRef: { current: '' },
    saveCombineCart: (value) => saves.push(structuredClone(value)) };
  const callback = hookCallback('lastPersistedSignatureRef.current = sig', 'useEffect');
  const persist = new Function('context', `with (context) { return ${compile('(' + callback + ')').replace(/;\s*$/, '')}; }`)(values);
  persist();
  values.combineLanes = [{ ...lane('B'), pin: 'NEW-PIN-B', email: 'new-viewer@example.test' }];
  persist();
  assert.equal(saves.length, 2);
  assert.equal(saves[1].lanes[0].pin, 'NEW-PIN-B');
  assert.equal(saves[1].lanes[0].email, 'new-viewer@example.test');
});

test('the same production predicate labels combined amounts as estimates and preserves ordinary single totals', () => {
  const predicate = new Function(compile(declaration('requiresCombinedParentCheckout')) + '\nreturn requiresCombinedParentCheckout;')();
  let summary;
  const visit = (node) => {
    if (ts.isJsxExpression(node) && node.expression?.getText(ast) === 'money(checkoutTotalCents)') {
      summary = node.parent.parent.parent;
    }
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(summary && ts.isJsxElement(summary));
  const compiled = ts.transpileModule('function Summary() { return (' + summary.getText(ast) + '); }\nreturn Summary;', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  for (const [items, schoolMode, current, combined] of [
    [[item('A'), item('B', { draft: true })], true, 'B', true],
    [[item('A'), item('B'), item('C', { draft: true })], true, 'C', true],
    [[item('A')], true, 'B', true],
    [[item('B', { draft: true })], true, 'B', false],
    [[item('B')], true, 'B', false],
    [[item('A'), item('B')], false, 'B', false],
  ]) {
    const combinedCheckoutEstimate = predicate(schoolMode, 'studio', items, lane(current).laneKey);
    assert.equal(combinedCheckoutEstimate, combined);
    const values = { combinedCheckoutEstimate, checkoutTotalCents: 12345, checkoutSubtotalCents: 12000,
      checkoutBackdropTotalCents: 0, anyPhysicalCheckoutItem: true, activeDeliveryMethod: 'pickup', checkoutShippingFeeCents: 0,
      checkoutTaxCents: 345, checkoutTaxPercent: 2.875, currentGalleryExtras: { taxLabel: 'Tax' }, money: (value) => '$' + (value / 100).toFixed(2) };
    const component = new Function('require', 'context', 'exports', `with (context) { ${compiled} }`)(
      (name) => { assert.equal(name, 'react/jsx-runtime'); return { jsx, jsxs }; }, values, {});
    const html = renderToStaticMarkup(createElement(component));
    assert.ok(html.includes(combined ? '>Estimated total<' : '>Total<'));
    assert.ok(html.includes('$123.45'));
    assert.equal(html.includes('Final sibling discounts'), combined);
    if (combined) assert.ok(html.includes('before you pay'));
  }
});

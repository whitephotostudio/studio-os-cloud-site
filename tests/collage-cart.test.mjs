import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url), root = new URL('../', import.meta.url);
const source = readFileSync(new URL('components/parents/parent-gallery-client.tsx', root), 'utf8');
const ast = ts.createSourceFile('gallery.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
function nodeWhere(predicate) {
  let found;
  function visit(node) { if (predicate(node)) found = node; ts.forEachChild(node, visit); }
  visit(ast); assert.ok(found, 'Expected current gallery source node'); return found;
}
const functionSource = name => nodeWhere(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast);
const effectSource = text => nodeWhere(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes(text)).arguments[0].getText(ast);
function storageFixture() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
function loader(window = undefined) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    vm.runInNewContext(compile(readFileSync(new URL(file, root), 'utf8')), { exports, window, require(name) {
      if (name.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name)) + '.ts');
      return require(name);
    } });
    return exports;
  }
  return load;
}
const policies = loader()('lib/collage-selection.ts');
const eventCart = loader()('lib/collage-cart.ts');
const version = '10000000-0000-4000-8000-000000000001';
const oldVersion = '20000000-0000-4000-8000-000000000001';
const key = 'schools/school/student/pose.jpg', preview = '/api/portal/school-preview/opaque.jpg?token=fresh';
const selection = (mediaId = key, crop = .3, templateVersionId = version) => ({ version: 1, templateVersionId,
  placements: ['left', 'centre', 'right'].map(slotId => ({ slotId, mediaId, zoom: 1.7, x: crop, y: .6 })),
  caption: { studentName: 'Example', schoolName: 'School', year: '2026' } });
function item(id = 'item-a', lane = 'school:student-a') {
  return { id, laneKey: lane, packageId: 'pkg', packageName: 'Mixed keepsakes', category: 'print', quantity: 1,
    packageSubtotalCents: 1000, backdropAddOnCents: 0, lineTotalCents: 1000, selectedImageUrl: key,
    slots: [{ label: '5x7', assignedImageUrl: preview }, { label: '10x8 collage', assignedImageUrl: null, collage: selection() }],
    backdrop: null, isCompositeOrder: false, compositeTitle: null };
}

function galleryFunctions() {
  const scope = { ...policies, DEFAULT_BACKDROP_BLUR_PX: 16 };
  vm.runInNewContext(compile(['formatPackageItem', 'makeIndexedLabel', 'buildSlots', 'persistParentCartItems'].map(functionSource).join('\n')), scope);
  return scope;
}

test('real buildSlots creates ordinary prints, independent collage copies and class composites without billing photo openings', () => {
  const { buildSlots } = galleryFunctions();
  const pkg = { name: 'Mixed keepsakes', items: [{ qty: 1, name: '5x7' }, { qty: 2, name: '10x8 collage', collage: { templateVersionId: version } }, { qty: 1, name: 'Class print', composite: true }] };
  const slots = buildSlots(pkg, 2, '/authorized-class-preview');
  assert.equal(slots.length, 8); assert.equal(slots.filter(slot => slot.collage).length, 4);
  assert.equal(slots.filter(slot => !slot.collage && !slot.composite).length, 2);
  assert.ok(slots.filter(slot => slot.composite).every(slot => slot.assignedImageUrl === '/authorized-class-preview'));
  const collages = slots.filter(slot => slot.collage);
  assert.equal(new Set(collages.map(slot => slot.collage)).size, 4); assert.equal(new Set(collages.map(slot => slot.collage.caption)).size, 4);
  collages[0].collage.placements.push(selection().placements[0]); collages[0].collage.caption.year = 'Changed';
  assert.equal(collages[1].collage.placements.length, 0); assert.equal(collages[1].collage.caption.year, '');
  assert.ok(collages.every(slot => slot.assignedImageUrl === null));
  assert.deepEqual(Array.from(buildSlots({ name: 'Legacy print' }, 2), slot => slot.label), ['Legacy print (1 of 2)', 'Legacy print (2 of 2)']);
});

test('real sibling-cart serialization preserves crop/media identities and strips submitted photos, snapshots and URLs from recipes', () => {
  const { persistParentCartItems } = galleryFunctions();
  const a = item(), b = item('item-b', 'school:student-b');
  b.slots[1].collage = selection('schools/school/student-b/pose.jpg', .8, oldVersion);
  a.slots[1].assignedImageUrl = 'https://untrusted.invalid/source.jpg';
  a.slots[1].collage = { ...a.slots[1].collage, design: { overlay: 'private-artwork' }, artworkKey: 'private-key', price: 1,
    placements: a.slots[1].collage.placements.map(p => ({ ...p, url: 'https://untrusted.invalid/photo.jpg', photo: { url: 'blob:private-test' } })) };
  const before = JSON.stringify([a, b]);
  const saved = persistParentCartItems([a, b, { ...item('untagged'), laneKey: undefined }]);
  assert.equal(saved.length, 2); assert.equal(JSON.stringify([a, b]), before);
  assert.equal(saved[0].slots[1].assignedImageUrl, null); assert.equal(saved[0].slots[0].assignedImageUrl, preview);
  assert.equal(saved[1].slots[1].collage.templateVersionId, oldVersion); assert.equal(saved[1].slots[1].collage.placements[0].x, .8);
  assert.doesNotMatch(JSON.stringify(saved.map(i => i.slots[1].collage)), /https:|blob:|artworkKey|private-artwork|"price"/);
  assert.equal(saved[0].slots.length, 2); assert.equal(saved[0].slots[1].collage.placements.length, 3);
});

test('sibling storage JSON keeps each selection and old version while protecting studio and opaque gallery scope', () => {
  const storage = storageFixture(), combine = loader({ sessionStorage: storage })('lib/combine-cart-storage.ts');
  const { persistParentCartItems } = galleryFunctions();
  const a = item(), b = item('item-b', 'school:student-b'); b.slots[1].collage = selection('schools/school/student-b/pose.jpg', .8, oldVersion);
  const lanes = [a, b].map((value, i) => ({ laneKey: value.laneKey, schoolId: 'school', studentId: `student-${i}`, pin: i ? 'SECRET-RAW-PIN' : 'session:30000000-0000-4000-8000-000000000001', email: 'private@example.test', schoolName: 'School', studentName: 'Student' }));
  combine.saveCombineCart({ version: 1, photographerId: 'studio-a', lanes, items: persistParentCartItems([a, b]) });
  const json = [...storage.values.values()][0]; assert.doesNotMatch(json, /SECRET-RAW-PIN|private@example/);
  const restored = combine.loadCombineCart('studio-a');
  assert.equal(restored.items.length, 2); assert.equal(restored.items[0].slots[1].collage.placements[0].x, .3);
  assert.equal(restored.items[1].slots[1].collage.placements[0].x, .8); assert.equal(restored.items[1].slots[1].collage.templateVersionId, oldVersion);
  assert.equal(combine.loadCombineCart('studio-b').items.length, 0);
});

test('event carts isolate owner and cookie lane and remove only their own empty basket', () => {
  const storage = storageFixture(), a = item(); delete a.laneKey;
  a.slots[1].collage = { ...selection('event-photo-id', .7, oldVersion), imageUrl: 'https://untrusted.invalid/image.jpg', design: { injected: true } };
  eventCart.saveCollageCart(storage, 'studio-a', 'lane-a', [a]);
  eventCart.saveCollageCart(storage, 'studio-b', 'lane-a', [{ ...a, id: 'studio-b-item' }]);
  eventCart.saveCollageCart(storage, 'studio-a', 'lane-b', [{ ...a, id: 'lane-b-item' }]);
  const restored = eventCart.loadCollageCart(storage, 'studio-a', 'lane-a');
  assert.equal(restored.length, 1); assert.equal(restored[0].id, a.id); assert.equal(restored[0].slots[1].collage.placements[0].x, .7);
  assert.equal(restored[0].slots[1].collage.templateVersionId, oldVersion); assert.equal(restored[0].slots[1].collage.design, undefined);
  assert.doesNotMatch(JSON.stringify(restored[0].slots[1].collage), /https:|injected/);
  assert.equal(eventCart.loadCollageCart(storage, 'studio-b', 'lane-a')[0].id, 'studio-b-item');
  assert.equal(eventCart.loadCollageCart(storage, 'studio-a', 'lane-b')[0].id, 'lane-b-item');
  assert.equal(eventCart.loadCollageCart(storage, 'studio-c', 'lane-a').length, 0);
  eventCart.saveCollageCart(storage, 'studio-a', 'lane-a', []);
  assert.equal(eventCart.loadCollageCart(storage, 'studio-a', 'lane-a').length, 0);
  assert.equal(eventCart.loadCollageCart(storage, 'studio-a', 'lane-b').length, 1);
});

test('malformed or mismatched event storage never restores partial selections or overwrites saved evidence', () => {
  const storage = storageFixture(), good = item(); delete good.laneKey;
  eventCart.saveCollageCart(storage, 'studio', 'lane', [good]);
  const storageKey = [...storage.values.keys()][0], clean = storage.getItem(storageKey), envelope = JSON.parse(clean);
  const malformed = ['not-json', JSON.stringify({ ...envelope, owner: 'other-studio' }), JSON.stringify({ ...envelope, lane: 'other-lane' }),
    JSON.stringify({ ...envelope, version: 999 }), JSON.stringify({ ...envelope, items: [null] }), JSON.stringify({ ...envelope, items: [{ slots: null }] }),
    JSON.stringify({ ...envelope, items: Array(101).fill(good) }), JSON.stringify({ ...envelope, items: [{ slots: [{ collage: { ...selection(), placements: [{ ...selection().placements[0], x: 4 }] } }] }] })];
  for (const raw of malformed) {
    storage.setItem(storageKey, raw); assert.throws(() => eventCart.loadCollageCart(storage, 'studio', 'lane'));
    assert.equal(storage.getItem(storageKey), raw);
  }
  storage.setItem(storageKey, clean);
  assert.equal(eventCart.loadCollageCart(storage, 'studio', 'lane').length, 1);
});

test('real reorder hydration retains the old immutable version, restores ordinary previews and reprices each package', () => {
  const snapshot = item(); snapshot.slots[0].assignedImageUrl = key; snapshot.slots[1].collage = { ...selection(key, .4, oldVersion), design: { injected: true }, placements: selection(key, .4, oldVersion).placements.map(p => ({ ...p, mediaKey: 'forged-original-key' })) };
  const original = JSON.stringify(snapshot), storage = storageFixture();
  storage.setItem('studio-os-reorder-pending', 'paid-order'); storage.setItem('studio-os-reorder:paid-order', JSON.stringify([snapshot]));
  let cart = [], counter = 0;
  const scope = { ...policies, loading: false, photographerId: 'owner', packages: [{ id: 'pkg', name: 'Updated package', price_cents: 1800 }],
    backdrops: [], onlineBackdropsEnabled: true, isSchoolMode: true, currentLane: { laneKey: 'school:student', pin: 'session:lane' },
    images: [{ id: key, storagePath: key, previewUrl: preview, url: preview }], reorderHydratedRef: { current: null },
    window: { sessionStorage: storage }, crypto: { randomUUID: () => `reorder-${++counter}` }, DEFAULT_BACKDROP_BLUR_PX: 16,
    getCategory: () => 'print', setCartItems: change => { cart = change(cart); }, setReorderBackdropReview: () => assert.fail('No background changed'),
    setBackdropPickerOpen() {}, setDrawerOpen() {}, setDrawerView() {}, setActiveSlotIndex() {} };
  vm.runInNewContext(compile(`(${effectSource('studio-os-reorder-pending')})();`), scope);
  assert.equal(cart.length, 1); assert.equal(cart[0].packageSubtotalCents, 1800); assert.equal(cart[0].slots[0].assignedImageUrl, preview);
  assert.equal(cart[0].slots[1].collage.templateVersionId, oldVersion); assert.equal(cart[0].slots[1].collage.placements[0].x, .4);
  assert.equal(cart[0].slots[1].collage.design, undefined); assert.equal(cart[0].slots[1].collage.placements[0].mediaKey, undefined);
  assert.equal(JSON.stringify(snapshot), original); assert.equal(storage.getItem('studio-os-reorder-pending'), null);
});

test('real event hydration/save effects preserve storage through deferred batched updates and isolate a gallery switch', async () => {
  const storage = storageFixture(), a = item('event-a'), b = item('event-b'); delete a.laneKey; delete b.laneKey;
  a.slots[0].assignedImageUrl = key; b.slots[0].assignedImageUrl = key;
  b.slots[1].collage = selection('event-b-photo', .8, oldVersion);
  eventCart.saveCollageCart(storage, 'studio', 'lane-a', [a]); eventCart.saveCollageCart(storage, 'studio', 'lane-b', [b]);
  const originalA = storage.getItem('studio-os-collage-cart:v1:studio:lane-a'), originalB = storage.getItem('studio-os-collage-cart:v1:studio:lane-b');
  const queued = [], errors = [];
  const scope = { ...eventCart, isSchoolMode: false, loading: false, photographerId: 'studio', sessionAccess: { laneId: 'lane-a' },
    parentLaneFromPin: () => null, pin: '', window: { sessionStorage: storage }, images: [{ storagePath: key, url: preview }],
    packages: [{ id: 'pkg', price_cents: 1800 }], cartItems: [{ ...item('wrong-school-cart'), laneKey: 'school:child' }],
    eventCollageCartScope: { current: '' }, eventCollageCartLoadedScope: '',
    setCartItems: value => queued.push(['cartItems', value]), setEventCollageCartLoadedScope: value => queued.push(['eventCollageCartLoadedScope', value]),
    setOrderError: error => errors.push(error) };
  function runEffect(marker) { return vm.runInNewContext(compile(`(${effectSource(marker)})();`), scope); }
  function flushRender() {
    for (const [name, value] of queued.splice(0)) scope[name] = typeof value === 'function' ? value(scope[name]) : value;
  }
  runEffect('loadCollageCart<CartLineItem>'); runEffect('saveCollageCart(window.sessionStorage');
  assert.equal(storage.getItem('studio-os-collage-cart:v1:studio:lane-a'), originalA, 'A same-frame empty/stale cart cannot overwrite saved selections');
  assert.equal(queued.length, 0, 'External storage hydration is deferred beyond the first effect pass');
  await Promise.resolve();
  runEffect('saveCollageCart(window.sessionStorage');
  assert.equal(storage.getItem('studio-os-collage-cart:v1:studio:lane-a'), originalA, 'Queued state must not permit persistence before the next rendered scope');
  flushRender();
  assert.deepEqual(Array.from(scope.cartItems, value => value.id), ['event-a']); assert.equal(scope.cartItems[0].slots[0].assignedImageUrl, preview);
  assert.equal(scope.cartItems[0].packageSubtotalCents, 1800); assert.equal(scope.cartItems[0].slots[1].collage.placements[0].x, .3);
  runEffect('saveCollageCart(window.sessionStorage');
  const savedA = storage.getItem('studio-os-collage-cart:v1:studio:lane-a');
  assert.equal(JSON.parse(savedA).items[0].slots[0].assignedImageUrl, key, 'Fresh preview URLs become durable keys for restoration');
  scope.sessionAccess = { laneId: 'lane-b' };
  runEffect('loadCollageCart<CartLineItem>'); runEffect('saveCollageCart(window.sessionStorage');
  assert.equal(storage.getItem('studio-os-collage-cart:v1:studio:lane-b'), originalB, 'Prior gallery state cannot overwrite the next gallery before hydration');
  await Promise.resolve();
  runEffect('saveCollageCart(window.sessionStorage');
  assert.equal(storage.getItem('studio-os-collage-cart:v1:studio:lane-b'), originalB, 'Deferred state remains isolated until the next render');
  flushRender();
  assert.deepEqual(Array.from(scope.cartItems, value => value.id), ['event-b']);
  assert.equal(scope.cartItems[0].slots[1].collage.templateVersionId, oldVersion); assert.equal(scope.cartItems[0].slots[1].collage.placements[0].x, .8);
  assert.equal(storage.getItem('studio-os-collage-cart:v1:studio:lane-a'), savedA);
  scope.sessionAccess = { laneId: 'lane-c' };
  const beforeCancellation = JSON.stringify(scope.cartItems);
  const cancelHydration = runEffect('loadCollageCart<CartLineItem>');
  assert.equal(typeof cancelHydration, 'function'); cancelHydration();
  await Promise.resolve();
  runEffect('saveCollageCart(window.sessionStorage');
  assert.equal(queued.length, 0, 'A cancelled gallery cannot enqueue stale cart or scope updates');
  assert.equal(JSON.stringify(scope.cartItems), beforeCancellation);
  assert.equal(scope.eventCollageCartScope.current, 'studio:lane-b');
  assert.equal(storage.getItem('studio-os-collage-cart:v1:studio:lane-c'), null);
  assert.equal(errors.length, 0);
});

test('the actual all-digitals helper preserves physical collage copies when names resemble download products', () => {
  const scope = { clean: value => (value ?? '').trim() };
  vm.runInNewContext(compile(`${functionSource('isDigitalPackageText')}\n${functionSource('isAllDigitalsPackage')}`), scope);
  const allDigital = { name: 'All digital bundle', description: 'Full gallery downloads', category: 'digital', items: [] };
  assert.equal(scope.isAllDigitalsPackage(allDigital), true);
  assert.equal(scope.isAllDigitalsPackage({ ...allDigital, category: 'package', items: [{ qty: 2, name: 'Two memories', collage: { templateVersionId: version } }] }), false);
  assert.equal(scope.isAllDigitalsPackage({ ...allDigital, category: 'print', items: [{ qty: 1, name: 'Collage', collage: { templateVersionId: version } }] }), false);
  assert.equal(scope.isAllDigitalsPackage({ name: 'Ordinary 5x7 print', category: 'print' }), false);
});

function restoreReorder(snapshot, packages) {
  const storage = storageFixture(), errors = [], existing = item('existing-basket-item');
  storage.setItem('studio-os-reorder-pending', 'saved-order'); storage.setItem('studio-os-reorder:saved-order', JSON.stringify(snapshot));
  let cart = [existing], review = null, counter = 0;
  const scope = { ...policies, loading: false, photographerId: 'owner', packages, backdrops: [], onlineBackdropsEnabled: true,
    isSchoolMode: true, currentLane: null, images: [{ id: key, storagePath: key, previewUrl: preview, url: preview }],
    reorderHydratedRef: { current: null }, window: { sessionStorage: storage }, crypto: { randomUUID: () => `restored-${++counter}` },
    DEFAULT_BACKDROP_BLUR_PX: 16, getCategory: () => 'print', setCartItems: value => { cart = value(cart); },
    setReorderBackdropReview: value => { review = value; }, setOrderError: value => errors.push(value),
    setBackdropPickerOpen() {}, setDrawerOpen() {}, setDrawerView() {}, setActiveSlotIndex() {} };
  vm.runInNewContext(compile(`(${effectSource('studio-os-reorder-pending')})();`), scope);
  return { cart, existing, errors, review, storage };
}

test('a missing collage product holds the complete reorder visibly without dropping copies or changing the existing basket', () => {
  const ordinary = { packageId: 'available', quantity: 1, slots: [{ label: 'Ordinary print', assignedImageUrl: key }] };
  const removed = { packageId: 'removed', quantity: 2, slots: [{ label: 'First collage', assignedImageUrl: null, collage: selection() }, { label: 'Second collage', assignedImageUrl: null, collage: selection(key, .8) }] };
  const snapshot = [ordinary, removed], before = JSON.stringify(snapshot);
  const result = restoreReorder(snapshot, [{ id: 'available', name: 'Print', price_cents: 1200 }]);
  assert.deepEqual(result.cart, [result.existing]); assert.equal(result.review, null);
  assert.match(result.errors[0], /collage product.*no longer available/i); assert.match(result.errors[0], /None.*added/i);
  assert.equal(result.storage.getItem('studio-os-reorder-pending'), 'saved-order'); assert.equal(JSON.stringify(snapshot), before);
  const legacy = restoreReorder([ordinary, { packageId: 'removed', quantity: 1, slots: [{ label: 'Old ordinary print', assignedImageUrl: key }] }], [{ id: 'available', name: 'Print', price_cents: 1200 }]);
  assert.equal(legacy.errors.length, 0); assert.equal(legacy.cart.length, 2); assert.equal(legacy.cart[1].packageId, 'available');
});

test('malformed nested collage recipes report a reviewable error and never partially restore a mixed reorder', () => {
  const ordinary = { packageId: 'available', quantity: 1, slots: [{ label: 'Ordinary print', assignedImageUrl: key }] };
  const badRecipes = [{ ...selection(), placements: [{ ...selection().placements[0], x: 4 }] }, { ...selection(), templateVersionId: 'invalid' }, { ...selection(), placements: [{ ...selection().placements[0], mediaId: 'https://untrusted.invalid/photo.jpg' }] }];
  for (const collage of badRecipes) {
    const snapshot = [ordinary, { packageId: 'available', quantity: 1, slots: [{ label: 'Collage', assignedImageUrl: null, collage }] }];
    const before = JSON.stringify(snapshot), result = restoreReorder(snapshot, [{ id: 'available', name: 'Print', price_cents: 1200 }]);
    assert.deepEqual(result.cart, [result.existing]); assert.equal(result.review, null);
    assert.match(result.errors[0], /invalid saved collage or photo selections/i); assert.match(result.errors[0], /None.*added/i);
    assert.equal(result.storage.getItem('studio-os-reorder-pending'), 'saved-order'); assert.equal(JSON.stringify(snapshot), before);
  }
});

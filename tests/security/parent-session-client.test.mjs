import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
const lane = '11111111-1111-4111-8111-111111111111';
const sibling = '22222222-2222-4222-8222-222222222222';
const school = '33333333-3333-4333-8333-333333333333';
function load(file, fetch = () => { throw Error('unexpected network'); }, window) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('exports', 'fetch', 'window', source)(exports, fetch, window);
  return exports;
}
const client = load('lib/parent-gallery-session-client.ts');
function json(body) { return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }; }
function storage(entries = []) {
  const values = new Map(entries);
  return { values, get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test('new gallery requests send only opaque lane selectors while retaining edited receipt contact', () => {
  const request = client.parentPortalRequest('/api/portal/orders/create', json({
    pin: client.parentSessionPin(lane), email: 'viewer@example.test', schoolId: school,
    projectId: 'derived-project', parent: { name: 'Parent', email: 'edited-receipt@example.test' }, entries: [{ packageId: 'print' }],
  }));
  const body = JSON.parse(request.init.body);
  assert.equal(body.parentLaneId, lane);
  assert.equal(body.schoolId, school);
  assert.equal(body.parent.email, 'edited-receipt@example.test');
  for (const key of ['pin', 'email', 'projectId']) assert.equal(Object.hasOwn(body, key), false);
  assert.equal(new Headers(request.init.headers).get('x-studio-parent-session'), '1');
  assert.equal(request.init.credentials, 'same-origin');
});

test('combined sibling request preserves each lane and every item without PIN/email fields', () => {
  const request = client.parentPortalRequest('/api/portal/orders/create-combined', json({ groups: [lane, sibling].map((id, index) => ({
    pin: client.parentSessionPin(id), email: 'viewer@example.test', schoolId: school, entries: [{ packageId: `print-${index}` }],
  })), parent: { email: 'receipt@example.test' } }), lane);
  const body = JSON.parse(request.init.body);
  assert.equal(Object.hasOwn(body, 'parentLaneId'), false);
  assert.deepEqual(body.groups.map(group => group.parentLaneId), [lane, sibling]);
  assert.deepEqual(body.groups.flatMap(group => group.entries), [{ packageId: 'print-0' }, { packageId: 'print-1' }]);
  assert.ok(body.groups.every(group => !Object.hasOwn(group, 'pin') && !Object.hasOwn(group, 'email')));
});

test('mixed legacy/session sibling access fails before any request and keeps the supplied basket', () => {
  const body = { groups: [{ pin: client.parentSessionPin(lane), email: 'viewer@example.test' }, { pin: 'raw-pin', email: 'other@example.test' }] };
  const before = structuredClone(body);
  assert.throws(() => client.parentPortalRequest('/api/portal/orders/create-combined', json(body), lane), /basket was kept/i);
  assert.deepEqual(body, before);
});

test('an explicit session cannot silently replace a raw PIN with the current child', () => {
  assert.throws(() => client.parentPortalRequest('/api/portal/gallery-context', json({ pin: 'other-child', schoolId: school }), lane), /basket was kept/i);
});

test('session confirmation carries a lane and preserves only its opaque return/session selectors', () => {
  const request = client.parentPortalRequest('/api/stripe/checkout/confirm', json({ sessionId: 'cs_fixture', returnId: sibling }), lane);
  assert.deepEqual(JSON.parse(request.init.body), { sessionId: 'cs_fixture', returnId: sibling, parentLaneId: lane });
});

test('new GET URLs remove credentials and never forward a private selector to another origin', () => {
  const request = client.parentPortalRequest(`/api/portal/event-favorites?projectId=${school}&pin=${encodeURIComponent(client.parentSessionPin(lane))}&email=viewer%40example.test`);
  const url = new URL(request.input, 'https://gallery.test');
  assert.equal(url.searchParams.get('parentLaneId'), lane);
  assert.equal(url.searchParams.has('pin'), false);
  assert.equal(url.searchParams.has('email'), false);
  const external = `https://other.test/api/portal/event-favorites?pin=${encodeURIComponent(client.parentSessionPin(lane))}`;
  assert.deepEqual(client.parentPortalRequest(external), { input: external, init: undefined });
});

test('ordinary legacy validators and registration requests retain their exact body', () => {
  const legacy = json({ schoolId: school, pin: 'legacy-pin', email: 'viewer@example.test' });
  assert.equal(client.parentPortalRequest('/api/portal/gallery-context', legacy).init.body, legacy.body);
  const registration = json({ schoolId: school, email: 'registration@example.test' });
  assert.deepEqual(client.parentPortalRequest('/api/portal/pre-release-register', registration, lane), { input: '/api/portal/pre-release-register', init: registration });
});

test('choice migration keeps the union of favorites and ratio choices and removes old credential keys', () => {
  const input = { kind: 'event', galleryId: school, pin: 'PIN42', email: 'viewer@example.test', laneId: lane };
  const favoritesOld = `event-favorites:${school}:viewer@example.test:PIN42`;
  const ratiosOld = `event-wall-ratios:${school}:viewer@example.test:PIN42`;
  const favoritesNew = `event-favorites:v2:${school}:${lane}`;
  const ratiosNew = `event-wall-ratios:v2:${school}:${lane}`;
  const saved = storage([[favoritesOld, '["first","same"]'], [favoritesNew, '["second","same"]'],
    [ratiosOld, '{"first":1,"same":2}'], [ratiosNew, '{"second":3,"same":4}']]);
  client.migrateParentChoiceStorage(input, saved);
  assert.deepEqual(JSON.parse(saved.getItem(favoritesNew)).sort(), ['first', 'same', 'second']);
  assert.deepEqual(JSON.parse(saved.getItem(ratiosNew)), { first: 1, same: 4, second: 3 });
  assert.equal(saved.getItem(favoritesOld), null); assert.equal(saved.getItem(ratiosOld), null);
});

test('a fresh form entry moves saved choices and clears unused credential-bearing gallery contexts', async () => {
  const input = { kind: 'event', galleryId: school, pin: 'PIN42', email: 'viewer@example.test' };
  const localStorage = storage([[`event-favorites:${school}:viewer@example.test:PIN42`, '["kept-photo"]']]);
  const sessionStorage = storage([['gallery_ctx:old-pin:old-email', '{"pin":"old-pin"}'],
    ['gallery_ctx:other-pin:other-email', '{"pin":"other-pin"}'], ['saved-basket', 'products-remain']]);
  const actual = load('lib/parent-gallery-session-client.ts', async () => Response.json({
    ok: true, laneId: lane, kind: input.kind, galleryId: school, viewerEmail: input.email,
    expiresAt: new Date(Date.now() + 60000).toISOString(), galleryUrl: `/parents/view/${lane}`,
  }), { localStorage, sessionStorage });
  const result = await actual.beginParentGallerySession(input);
  assert.equal(result.laneId, lane);
  assert.equal(localStorage.getItem(`event-favorites:${school}:viewer@example.test:PIN42`), null);
  assert.equal(localStorage.getItem(`event-favorites:v2:${school}:${lane}`), '["kept-photo"]');
  assert.deepEqual([...sessionStorage.values], [['saved-basket', 'products-remain']]);
});

test('storage unavailability does not block an authorized gallery or remove its basket', async () => {
  const unavailable = new Proxy({}, { get() { throw new Error('Storage disabled'); } });
  const actual = load('lib/parent-gallery-session-client.ts', async () => Response.json({
    ok: true, laneId: lane, kind: 'school', galleryId: school, viewerEmail: 'viewer@example.test',
    expiresAt: new Date(Date.now() + 60000).toISOString(), galleryUrl: `/parents/view/${lane}`,
  }), unavailable);
  assert.equal((await actual.beginParentGallerySession({ kind: 'school', galleryId: school,
    pin: 'legacy-pin', email: 'viewer@example.test' })).laneId, lane);
});

test('legacy sibling credentials upgrade sequentially into opaque references without dropping lane identity', async () => {
  const calls = [];
  const actual = load('lib/parent-gallery-session-client.ts', async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return Response.json({ ok: true, laneId: lane, kind: 'school', galleryId: school,
      viewerEmail: 'viewer@example.test', photographerId: sibling, expiresAt: new Date(Date.now() + 60000).toISOString(), galleryUrl: `/parents/view/${lane}` });
  });
  const input = [{ laneKey: 'saved-child', schoolId: school, studentId: sibling, pin: 'legacy-pin', email: 'viewer@example.test', schoolName: 'School' }];
  const before = structuredClone(input);
  const result = await actual.migrateParentCombineLanes(input);
  assert.equal(result[0].pin, `session:${lane}`); assert.equal(result[0].email, '');
  assert.equal(result[0].laneKey, before[0].laneKey); assert.equal(result[0].studentId, sibling);
  assert.deepEqual(input, before);
  assert.equal(calls[0].url, '/api/portal/session'); assert.equal(calls[0].body.pin, 'legacy-pin');
});

test('unavailable legacy reauthentication preserves lane metadata and leaves products for re-entry', async () => {
  const actual = load('lib/parent-gallery-session-client.ts', async () => Response.json({ ok: false }, { status: 503 }));
  const input = [{ laneKey: 'saved-child', schoolId: school, studentId: sibling, pin: 'legacy-pin', email: 'viewer@example.test', schoolName: 'School' }];
  const result = await actual.migrateParentCombineLanes(input);
  assert.deepEqual(result, [{ ...input[0], pin: '', email: '' }]);
});

test('actual cart persistence retains all product selections and strips only authentication copies', () => {
  const saved = storage();
  const cart = load('lib/combine-cart-storage.ts', undefined, { sessionStorage: saved });
  const input = { version: 1, photographerId: 'studio', lanes: [
    { laneKey: 'old', pin: 'legacy-pin', email: 'viewer@example.test', schoolId: school, studentId: sibling },
    { laneKey: 'new', pin: `session:${lane}`, email: 'viewer@example.test', schoolId: school, studentId: lane },
  ], items: [{ id: 'product', laneKey: 'old', packageId: 'print', quantity: 2, selectedImageUrl: 'school/photo.jpg',
    slots: [{ label: '8x10', assignedImageUrl: 'school/photo.jpg' }], backdrop: { id: 'backdrop', blurred: true }, lanePin: 'legacy-pin', laneEmail: 'viewer@example.test' }] };
  const before = structuredClone(input);
  cart.saveCombineCart(input);
  const restored = cart.loadCombineCart('studio');
  assert.equal(restored.lanes.length, 2); assert.equal(restored.items.length, 1);
  assert.equal(restored.lanes[0].pin, ''); assert.equal(restored.lanes[1].pin, `session:${lane}`);
  assert.ok(restored.lanes.every(value => value.email === ''));
  assert.deepEqual(restored.items[0].slots, before.items[0].slots);
  assert.deepEqual(restored.items[0].backdrop, before.items[0].backdrop);
  assert.equal(restored.items[0].quantity, 2);
  assert.equal(Object.hasOwn(restored.items[0], 'lanePin'), false);
  assert.equal(Object.hasOwn(restored.items[0], 'laneEmail'), false);
  assert.deepEqual(input, before);
  assert.ok(![...saved.values.values()].some(value => value.includes('legacy-pin') || value.includes('viewer@example.test')));
});

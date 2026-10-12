import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const root = new URL('../../', import.meta.url), require = createRequire(import.meta.url);
const id = number => `20000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const studio = id(1), otherStudio = id(2), school = id(3), siblingSchool = id(4), event = id(5);
const lane = id(10), sibling = id(11), eventLane = id(12), foreignLane = id(13);
const child = id(20), siblingChild = id(21), photo = id(30), foreignPhoto = id(31);
const order = id(40), siblingOrder = id(41);
const pin = 'synthetic-first-pin', siblingPin = 'synthetic-sibling-pin', eventPin = 'synthetic-event-pin';
const email = 'viewer@example.test', token = Buffer.alloc(32, 17).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
const cookie = `__Host-studio_os_parent_session=${token}`;
const expires = () => new Date(Date.now() + 3600_000).toISOString();

class NextRequest extends Request { get nextUrl() { return new URL(this.url); } }
class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }

function fixture() {
  const queries = [], rpcs = [], folders = [], completedSessions = [];
  let unavailableTable, rpcError, beforeSessionResult;
  const tables = {
    parent_gallery_sessions: [
      { id: lane, gallery_kind: 'school', gallery_id: school, photographer_id: studio, pin, viewer_email: email },
      { id: sibling, gallery_kind: 'school', gallery_id: siblingSchool, photographer_id: studio, pin: siblingPin, viewer_email: email },
      { id: eventLane, gallery_kind: 'event', gallery_id: event, photographer_id: studio, pin: eventPin, viewer_email: email },
      { id: foreignLane, gallery_kind: 'school', gallery_id: id(6), photographer_id: otherStudio, pin: 'foreign-pin', viewer_email: email },
    ].map(row => ({ ...row, token_hash: hash(token), revoked_at: null, expires_at: expires() })),
    schools: [
      { id: school, photographer_id: studio, status: 'active', portal_status: 'active', expiration_date: null },
      { id: siblingSchool, photographer_id: studio, status: 'active', portal_status: 'active', expiration_date: null },
      { id: id(6), photographer_id: otherStudio, status: 'active', portal_status: 'active', expiration_date: null },
    ],
    students: [{ id: child, school_id: school, pin, folder_name: 'first' },
      { id: siblingChild, school_id: siblingSchool, pin: siblingPin, folder_name: 'sibling' },
      { id: id(22), school_id: id(6), pin: 'foreign-pin' }],
    projects: [{ id: event, photographer_id: studio, title: 'Synthetic event', workflow_type: 'event',
      status: 'active', portal_status: 'active', access_mode: 'pin', access_pin: eventPin,
      expiration_date: null, email_required: true }],
    pre_release_emails: [{ id: id(50), project_id: event, email }], subjects: [],
    collections: [{ id: id(51), project_id: event, kind: 'album', access_mode: 'inherit_project', slug: 'synthetic-album' }],
    school_gallery_favorites: [{ school_id: school, viewer_key: hash(`${school}::${email}::${pin}`), media_id: photo },
      { school_id: school, viewer_key: hash(`${school}::${email}::${pin}`), media_id: foreignPhoto }],
  };
  const service = {
    from(table) {
      const filters = [], record = { table, filters: [] }; queries.push(record);
      let single = false, limit = Infinity, range;
      const query = {
        select() { return query; },
        eq(key, value) { filters.push(row => row[key] === value); record.filters.push([key, value]); return query; },
        is(key, value) { filters.push(row => row[key] === value); record.filters.push([key, value]); return query; },
        in(key, values) { filters.push(row => values.includes(row[key])); record.filters.push([key, values]); return query; },
        maybeSingle() { single = true; return query; }, single() { single = true; return query; },
        order() { return query; }, limit(value) { limit = value; return query; },
        range(from, to) { range = [from, to]; return query; },
        async then(resolve, reject) {
          try {
            if (table === unavailableTable) return resolve({ data: null, error: { code: 'SYNTHETIC_OUTAGE' } });
            if (table === 'parent_gallery_sessions' && beforeSessionResult) await beforeSessionResult(record);
            let rows = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
            if (range) rows = rows.slice(range[0], range[1] + 1);
            rows = rows.slice(0, limit);
            if (table === 'parent_gallery_sessions') completedSessions.push(record.filters.find(([key]) => key === 'id')?.[1]);
            return resolve({ data: structuredClone(single ? rows[0] ?? null : rows), error: null });
          } catch (error) { return reject(error); }
        },
      };
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, 'record_parent_order_session_access', 'only the creation provenance RPC is permitted');
      rpcs.push({ name, args: structuredClone(args) });
      return { data: null, error: rpcError ?? null };
    },
  };
  const cache = new Map();
  const stubs = {
    'server-only': {}, 'next/server': { NextRequest, NextResponse },
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => service },
    // Existing rate-budget/transport boundaries are not exercised by this adapter.
    '@/lib/portal-pin-rate-limit': {},
    '@/lib/rate-limit': { getClientIp: () => 'synthetic-ip', rateLimit: async () => { throw Error('Read unexpectedly used the toggle limiter'); } },
    '@/lib/payments': { getConnectedAccountId: () => { throw Error('Unexpected provider access'); },
      retrieveCheckoutSession: () => { throw Error('Unexpected provider access'); } },
    '@/lib/storage-folder': {
      buildSchoolCandidateFolders(input) { folders.push(structuredClone(input)); return ['synthetic-owned-folder']; },
      async loadFolderMediaRows(_paths, input) { assert.equal(input.schoolId, school); return [{ id: photo }]; },
    },
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const output = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    new Function('require', 'exports', 'process', 'fetch', output)(
      name => name in stubs ? stubs[name] : name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name),
      exports, { env: { NODE_ENV: 'production' } }, () => { throw Error('Unexpected network request'); });
    return exports;
  }
  const adapter = load('lib/parent-gallery-session-request.ts');
  const session = load('lib/parent-gallery-session.ts');
  const request = ({ path = '/api/portal/school-favorites', method = 'POST', body = { operation: 'read', parentLaneId: lane },
    query = '', headers = {}, sessionCookie = cookie } = {}) => new NextRequest('https://fixture.test' + path + query, {
    method, headers: { 'content-type': 'application/json', origin: 'https://fixture.test', 'sec-fetch-site': 'same-origin',
      cookie: sessionCookie, 'x-studio-parent-session': '1', ...headers },
    ...(['GET', 'HEAD'].includes(method) ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  return { adapter, session, request, load, tables, queries, rpcs, folders, completedSessions,
    setUnavailable: table => { unavailableTable = table; }, setRpcError: error => { rpcError = error; },
    beforeSession: callback => { beforeSessionResult = callback; } };
}

async function deniedWithoutHandler(f, request, status) {
  let calls = 0;
  const response = await f.adapter.runParentGallerySessionRoute(request, async () => { calls++; return Response.json({ ok: true }); });
  assert.equal(response.status, status); assert.equal(calls, 0); assert.equal(f.rpcs.length, 0);
  assert.match((await response.json()).message, /basket was kept|reopen/i);
}

test('actual resolver and original favorites handler both validate the complete private credentials and owned media', async () => {
  const f = fixture(), request = f.request();
  const response = await f.load('app/api/portal/school-favorites/route.ts').POST(request);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, mediaIds: [photo] });
  const checks = f.queries.filter(query => query.table === 'students');
  assert.equal(checks.length, 2, 'session validation does not replace original route validation');
  for (const check of checks) { assert.ok(check.filters.some(([key, value]) => key === 'school_id' && value === school));
    assert.ok(check.filters.some(([key, value]) => key === 'pin' && value === pin)); }
  const favorites = f.queries.find(query => query.table === 'school_gallery_favorites');
  assert.ok(favorites.filters.some(([key, value]) => key === 'viewer_key' && value === hash(`${school}::${email}::${pin}`)));
  assert.deepEqual(f.folders[0].studentCandidates.map(student => student.id), [child]);
  assert.equal(f.adapter.getParentGalleryRequestScope(request), null, 'unadapted request cannot claim private scope');
  assert.equal(f.adapter.parentGalleryRateKey(request), null); assert.equal(f.rpcs.length, 0);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
});

test('an actual original handler still rejects a PIN changed after session resolution', async () => {
  const f = fixture(); let calls = 0;
  const response = await f.adapter.runParentGallerySessionRoute(f.request(), async adapted => {
    calls++; f.tables.students[0].pin = 'changed-current-pin';
    return f.load('app/api/portal/school-favorites/route.ts').POST(adapted);
  });
  assert.equal(calls, 1); assert.equal(response.status, 404);
  assert.equal((await response.json()).ok, false);
  assert.equal(f.queries.some(query => query.table === 'school_gallery_favorites'), false);
});

test('legacy-compatible GET enters the same original favorites authorization after private adaptation', async () => {
  const f = fixture();
  const response = await f.load('app/api/portal/school-favorites/route.ts').GET(f.request({
    method: 'GET', query: `?parentLaneId=${lane}&schoolId=${school}`,
  }));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, mediaIds: [photo] });
  assert.equal(f.queries.filter(query => query.table === 'students').length, 2);
  assert.equal(f.rpcs.length, 0);
});

test('GET adaptation removes only selectors, injects the current scope, and prevents recursive session dispatch', async () => {
  const f = fixture(); let adapted;
  const response = await f.adapter.runParentGallerySessionRoute(f.request({ method: 'GET',
    query: `?parentLaneId=${lane}&schoolId=${school}&album=kept` }), async request => {
    adapted = request;
    assert.equal(request.headers.get('x-studio-parent-session'), null);
    assert.equal(request.nextUrl.searchParams.has('parentLaneId'), false);
    assert.equal(request.nextUrl.searchParams.get('pin'), pin); assert.equal(request.nextUrl.searchParams.get('email'), email);
    assert.equal(request.nextUrl.searchParams.get('schoolId'), school); assert.equal(request.nextUrl.searchParams.get('album'), 'kept');
    assert.equal(f.adapter.getParentGalleryRequestScope(request).laneId, lane);
    assert.match(f.adapter.parentGalleryRateKey(request), /^parent:[a-f0-9]{64}$/);
    return Response.json({ ok: true });
  });
  assert.equal(response.status, 200); assert.equal(f.adapter.getParentGalleryRequestScope(adapted).pin, pin);
});

for (const [name, mutate, options, status] of [
  ['invalid lane', () => {}, { body: { parentLaneId: 'invalid' } }, 400],
  ['missing cookie', () => {}, { sessionCookie: '' }, 401],
  ['different browser cookie', () => {}, { sessionCookie: `__Host-studio_os_parent_session=${Buffer.alloc(32, 18).toString('base64url')}` }, 401],
  ['duplicate cookies', () => {}, { sessionCookie: cookie + '; ' + cookie }, 401],
  ['revoked lane', f => { f.tables.parent_gallery_sessions[0].revoked_at = new Date().toISOString(); }, {}, 401],
  ['expired lane', f => { f.tables.parent_gallery_sessions[0].expires_at = new Date(Date.now() - 1000).toISOString(); }, {}, 401],
  ['changed PIN', f => { f.tables.students[0].pin = 'changed'; }, {}, 404],
  ['moved student', f => { f.tables.students[0].school_id = siblingSchool; }, {}, 404],
  ['changed gallery owner', f => { f.tables.schools[0].photographer_id = otherStudio; }, {}, 403],
  ['unavailable session store', f => { f.setUnavailable('parent_gallery_sessions'); }, {}, 503],
  ['unavailable authoritative student lookup', f => { f.setUnavailable('students'); }, {}, 503],
]) test(`${name} cannot invoke any original handler`, async () => {
  const f = fixture(); mutate(f); await deniedWithoutHandler(f, f.request(options), status);
});

for (const [name, headers] of [
  ['foreign origin', { origin: 'https://foreign.test' }],
  ['cross-site fetch metadata', { 'sec-fetch-site': 'cross-site' }],
  ['missing browser origin and fetch metadata', { origin: '', 'sec-fetch-site': '' }],
  ['same-site subdomain fetch metadata', { 'sec-fetch-site': 'same-site' }],
]) test(`cookie-bearing POST with ${name} cannot reach a handler`, async () => {
  const f = fixture(); await deniedWithoutHandler(f, f.request({ headers }), 403);
  assert.equal(f.queries.length, 0, 'CSRF rejection precedes service access');
});

for (const [name, body, query] of [
  ['raw PIN', { parentLaneId: lane, pin }, ''],
  ['raw email', { parentLaneId: lane, email }, ''],
  ['different gallery', { parentLaneId: lane, schoolId: siblingSchool }, ''],
  ['different kind', { parentLaneId: lane, kind: 'event' }, ''],
  ['project on school scope', { parentLaneId: lane, projectId: event }, ''],
  ['body/query lane conflict', { parentLaneId: lane }, `?parentLaneId=${sibling}`],
  ['query raw credentials', { parentLaneId: lane }, `?email=${email}`],
  ['duplicate query selector', { parentLaneId: lane }, `?parentLaneId=${lane}&parentLaneId=${lane}`],
  ['combined body with top-level selector', { parentLaneId: lane, groups: [{ parentLaneId: lane }] }, ''],
]) test(`ambiguous ${name} fails before credential injection or the handler`, async () => {
  const f = fixture();
  const response = await f.adapter.runParentGallerySessionRoute(f.request({ body, query }), async () => assert.fail('handler reached'));
  assert.equal(response.status, 400); assert.equal(f.rpcs.length, 0);
});

test('event scope requires the current event PIN and approved viewer before its handler runs', async () => {
  const f = fixture();
  const request = f.request({ body: { parentLaneId: eventLane, projectId: event, eventId: event, collectionId: id(51) } });
  const response = await f.adapter.runParentGallerySessionRoute(request, async adapted => {
    assert.deepEqual(await adapted.json(), { projectId: event, eventId: event, collectionId: id(51), pin: eventPin, email });
    return Response.json({ ok: true });
  });
  assert.equal(response.status, 200);
  f.tables.pre_release_emails[0].email = 'different-approved-viewer@example.test';
  await deniedWithoutHandler(f, f.request({ body: { parentLaneId: eventLane } }), 403);
});

test('action budgets exist only on resolved requests and remain separate for sibling lanes', async () => {
  const f = fixture(), keys = [];
  for (const selected of [lane, sibling, lane]) {
    const input = f.request({ body: { parentLaneId: selected } });
    assert.equal(f.adapter.parentGalleryRateKey(input), null);
    await f.adapter.runParentGallerySessionRoute(input, async adapted => {
      keys.push(f.adapter.parentGalleryRateKey(adapted)); return Response.json({ ok: true });
    });
  }
  assert.equal(keys[0], keys[2]); assert.notEqual(keys[0], keys[1]);
  assert.ok(keys.every(key => /^parent:[a-f0-9]{64}$/.test(key)));
});

test('malformed or over-cap combined scopes cannot invoke a handler', async () => {
  for (const body of [null, [], 'invalid-json', { groups: [] },
    { groups: Array.from({ length: 33 }, () => ({ parentLaneId: lane })) },
    { groups: [{ parentLaneId: lane }, null] },
    { groups: [{ parentLaneId: lane }, { parentLaneId: sibling, pin: siblingPin }] }]) {
    const f = fixture(); let calls = 0;
    const response = await f.adapter.runParentGallerySessionRoute(f.request({ body }), async () => {
      calls++; return Response.json({ ok: true });
    });
    assert.ok(response.status >= 400); assert.equal(calls, 0); assert.equal(f.rpcs.length, 0);
  }
});

test('combined groups preserve caller order despite out-of-order authorization and bind one studio', async () => {
  const f = fixture(); let releaseFirst;
  const held = new Promise(resolve => { releaseFirst = resolve; });
  f.beforeSession(async query => {
    const selected = query.filters.find(([key]) => key === 'id')?.[1];
    if (selected === lane) await held;
    if (selected === sibling) releaseFirst();
  });
  const body = { groups: [{ parentLaneId: lane, schoolId: school, entries: [{ packageId: 'first', quantity: 2 }] },
    { parentLaneId: sibling, schoolId: siblingSchool, entries: [{ packageId: 'second', quantity: 3 }] }],
    parent: { email: 'edited-receipt@example.test' } };
  const before = structuredClone(body);
  const response = await f.adapter.runParentGallerySessionRoute(f.request({ path: '/api/portal/orders/create-combined', body }), async adapted => {
    const actual = await adapted.json();
    assert.deepEqual(actual.groups, [
      { schoolId: school, pin, email, entries: body.groups[0].entries },
      { schoolId: siblingSchool, pin: siblingPin, email, entries: body.groups[1].entries },
    ]);
    assert.equal(actual.parent.email, 'edited-receipt@example.test');
    assert.equal(f.adapter.getParentGalleryRequestScope(adapted).laneId, lane);
    return Response.json({ ok: true, orderIds: [order, siblingOrder], primaryOrderId: order });
  });
  assert.equal(response.status, 200); assert.deepEqual(body, before);
  assert.deepEqual(f.completedSessions, [sibling, lane]);
  assert.deepEqual(f.rpcs, [{ name: 'record_parent_order_session_access', args: {
    p_token_hash: hash(token), p_lane_ids: [lane, sibling], p_order_ids: [order, siblingOrder],
  } }]);
});

test('mixed studios and one revoked sibling cannot invoke combined order creation', async () => {
  for (const second of [foreignLane, sibling]) {
    const f = fixture();
    if (second === sibling) f.tables.parent_gallery_sessions[1].revoked_at = new Date().toISOString();
    await deniedWithoutHandler(f, f.request({ path: '/api/portal/orders/create-combined',
      body: { groups: [{ parentLaneId: lane }, { parentLaneId: second }] } }), second === sibling ? 401 : 403);
  }
});

test('creation provenance failure cannot publish successful order/checkout metadata and preserves basket messaging', async () => {
  const f = fixture(); let handlerCalls = 0;
  f.setRpcError({ code: 'SYNTHETIC_OUTAGE' });
  const response = await f.adapter.runParentGallerySessionRoute(f.request({ path: '/api/portal/orders/create',
    body: { parentLaneId: lane, entries: [{ packageId: 'kept-product' }] } }), async () => {
    handlerCalls++; return Response.json({ ok: true, orderId: order, checkoutUrl: '/must-not-publish' });
  });
  assert.equal(handlerCalls, 1); assert.equal(f.rpcs.length, 1); assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.ok, false); assert.match(payload.message, /basket was kept/i);
  assert.equal(Object.hasOwn(payload, 'orderId'), false); assert.equal(Object.hasOwn(payload, 'checkoutUrl'), false);
});

test('malformed successful creation metadata cannot acquire browser checkout provenance', async () => {
  for (const payload of [{ ok: true }, { ok: true, orderIds: [order, order] },
    { ok: true, orderIds: [order], primaryOrderId: siblingOrder },
    { ok: true, orderId: 'invalid-order' }]) {
    const f = fixture();
    const response = await f.adapter.runParentGallerySessionRoute(f.request({ path: '/api/portal/orders/create' }),
      async () => Response.json(payload));
    assert.equal(response.status, 503); assert.equal((await response.json()).ok, false); assert.equal(f.rpcs.length, 0);
  }
});

test('unsuccessful creation and ordinary read results never issue creation provenance', async () => {
  for (const [path, status, payload] of [
    ['/api/portal/orders/create', 400, { ok: false, orderId: order }],
    ['/api/portal/orders/create', 200, { ok: false }],
    ['/api/portal/orders/history', 200, { ok: true, orderId: order }],
  ]) {
    const f = fixture();
    const response = await f.adapter.runParentGallerySessionRoute(f.request({ path }), async () => Response.json(payload, { status }));
    assert.equal(response.status, status); assert.equal(f.rpcs.length, 0);
  }
});

test('private DTO scrubbing removes nested PINs and rewrites exact owned credential URLs while preserving receipt contact', async () => {
  const f = fixture();
  const legacy = `/parents/${encodeURIComponent(pin)}?mode=school&school=${school}&email=${encodeURIComponent(email)}&tab=orders`;
  const api = `/api/portal/yearbook?schoolId=${school}&pin=${pin}&email=${encodeURIComponent(email)}&selection=kept`;
  const response = await f.adapter.runParentGallerySessionRoute(f.request(), async () => Response.json({
    ok: true, primaryStudent: { id: child, pin }, schools: [{ access_pin: 'synthetic-school-pin' }],
    urls: [legacy, api], parent: { email: 'edited-receipt@example.test' },
  }, { headers: { 'cache-control': 'public, max-age=3600' } }));
  const payload = await response.json();
  assert.deepEqual(payload.primaryStudent, { id: child }); assert.deepEqual(payload.schools, [{}]);
  assert.equal(payload.urls[0], `/parents/view/${lane}?tab=orders`);
  const rewritten = new URL(payload.urls[1], 'https://fixture.test');
  assert.equal(rewritten.searchParams.get('parentLaneId'), lane); assert.equal(rewritten.searchParams.get('selection'), 'kept');
  assert.equal(rewritten.searchParams.has('pin'), false); assert.equal(rewritten.searchParams.has('email'), false);
  assert.equal(payload.parent.email, 'edited-receipt@example.test');
  assert.ok(!JSON.stringify(payload).includes(pin));
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
});

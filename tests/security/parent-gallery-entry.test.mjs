import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test, { before, after } from 'node:test';
import ts from 'typescript';
import { localPinBudgetRedis } from '../helpers/pin-budget-redis.mjs';

const require = createRequire(import.meta.url), root = new URL('../../', import.meta.url);
const id = number => `70000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const owner = id(1), school = id(2), student = id(3), project = id(4), lane = id(5);
const secret = 'synthetic-entry-secret', pin = 'synthetic-entry-pin', email = 'parent@example.test';
const credentials = kind => ({ kind, galleryId: kind === 'school' ? school : project, photographerId: owner, pin, email });
let redis, fixtureNumber = 0;
before(async () => { redis = await localPinBudgetRedis(); });
after(async () => { await redis?.close(); });

function fixture({ unavailable = false } = {}) {
  const queries = [], registrations = [], counters = [], ip = `synthetic-entry-${++fixtureNumber}`;
  const tables = {
    schools: [{ id: school, photographer_id: owner, status: 'active', portal_status: 'active', expiration_date: null }],
    students: [{ id: student, school_id: school, pin }],
    projects: [{ id: project, photographer_id: owner, title: 'Synthetic event', workflow_type: 'event', status: 'active',
      portal_status: 'active', email_required: false, access_mode: 'pin', access_pin: pin, gallery_settings: {}, expiration_date: null }],
    subjects: [], collections: [], pre_release_emails: [], parent_gallery_sessions: [],
  };
  const service = {
    from(table) {
      assert.ok(table in tables, `Unexpected service read ${table}`);
      queries.push(table); const predicates = []; let single = false, limit = Infinity;
      const q = {
        select() { return q; },
        eq(key, value) { predicates.push(row => row[key] === value); return q; },
        is(key, value) { return q.eq(key, value); },
        in(key, values) { predicates.push(row => values.includes(row[key])); return q; },
        order() { return q; },
        range(from, to) { assert.equal(from, 0); limit = to + 1; return q; },
        limit(value) { limit = value; return q; },
        maybeSingle() { single = true; return q; },
        then(resolve, reject) {
          const rows = tables[table].filter(row => predicates.every(predicate => predicate(row))).slice(0, limit);
          return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
        },
      }; return q;
    },
    async rpc(name, args) {
      assert.equal(name, 'register_parent_gallery_session'); registrations.push(args);
      if (unavailable) return { data: null, error: { message: 'Synthetic store unavailable' } };
      tables.parent_gallery_sessions.push({ id: lane, token_hash: args.p_token_hash, revoked_at: null });
      return { error: null, data: { laneId: lane, kind: args.p_kind, galleryId: args.p_gallery_id,
        photographerId: args.p_photographer_id, viewerEmail: args.p_email,
        expiresAt: new Date(Date.now() + 86400000).toISOString() } };
    },
  };
  const cache = new Map();
  class SharedRedis {
    constructor(options) { assert.equal(options.retry.retries, 0); }
    async eval(script, keys, args) { counters.push({ keys, args }); return redis.eval(script, keys, args); }
  }
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const compiled = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const dependencies = {
      'server-only': {}, '@upstash/redis': { Redis: SharedRedis },
      '@/lib/dashboard-auth': { createDashboardServiceClient: () => service },
      '@/lib/rate-limit': { getClientIp: () => ip },
      'next/server': { NextResponse: { redirect: target => new Response(null, { status: 307, headers: { location: String(target) } }) } },
    };
    new Function('require', 'exports', 'process', compiled)(name => {
      if (name in dependencies) return dependencies[name];
      if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
      if (name.startsWith('node:') || name === 'zod') return require(name);
      throw Error(`Unexpected test dependency ${name}`);
    }, exports, { env: { NODE_ENV: 'production', EVENT_DOWNLOAD_TOKEN_SECRET: secret,
      NEXT_PUBLIC_SITE_URL: 'https://canonical.example.test',
      UPSTASH_REDIS_REST_URL: 'https://synthetic.invalid', UPSTASH_REDIS_REST_TOKEN: 'synthetic' } });
    return exports;
  }
  const entry = load('lib/parent-gallery-entry.ts'), crypto = load('lib/encrypted-capability.ts');
  const route = load('app/api/portal/session/entry/route.ts');
  const request = (path, origin = 'https://canonical.example.test', cookie = '') => {
    const req = new Request(new URL(path, origin), { headers: { cookie, 'x-real-ip': ip } });
    req.nextUrl = new URL(req.url); return req;
  };
  const tokenPath = payload => '/api/portal/session/entry?token=' + crypto.encryptCapability(payload,
    { secret, purpose: 'parent-gallery-entry', maximumPayloadBytes: 2048 });
  return { entry, crypto, route, request, tokenPath, tables, queries, registrations, counters };
}

test('entry encryption is randomized, seven-day bounded, purpose-separated and hides every private credential', () => {
  const f = fixture(), start = Date.now(), input = { ...credentials('school'), tab: 'orders' };
  const first = f.entry.createParentGalleryEntryPath(input), second = f.entry.createParentGalleryEntryPath(input);
  assert.notEqual(first, second); const url = new URL(first, 'https://fixture.test');
  assert.equal(url.pathname, '/api/portal/session/entry'); assert.deepEqual(Array.from(url.searchParams.keys()), ['token']);
  for (const value of [pin, email, school, owner]) assert.equal(first.includes(value), false);
  const token = url.searchParams.get('token'); assert.match(token, /^ec1\./);
  const value = f.entry.readParentGalleryEntryToken(token);
  assert.equal(value.pin, pin); assert.equal(value.email, email); assert.equal(value.photographerId, owner); assert.equal(value.tab, 'orders');
  assert.ok(value.expiresAt >= start + 7 * 86400000 && value.expiresAt <= Date.now() + 7 * 86400000);
  for (const purpose of ['school-gallery-preview', 'school-photo-download', 'event-gallery-preview',
    'event-gallery-download-batch', 'digital-order-delivery', 'favorites-delivery']) {
    assert.throws(() => f.crypto.decryptCapability(token, { secret, purpose }));
    const foreign = f.crypto.encryptCapability(value, { secret, purpose });
    assert.throws(() => f.entry.readParentGalleryEntryToken(foreign));
  }
});

test('fresh cross-region issuance tolerates bounded clock skew without extending an expired entry', () => {
  const f = fixture(), payload = { v: 1, ...credentials('school'), expiresAt: Date.now() + f.entry.PARENT_GALLERY_ENTRY_TTL_MS + 240000 };
  const token = new URL(f.tokenPath(payload), 'https://fixture.test').searchParams.get('token');
  assert.equal(f.entry.readParentGalleryEntryToken(token).expiresAt, payload.expiresAt);
  for (const expiresAt of [Date.now() - 1, Date.now() + f.entry.PARENT_GALLERY_ENTRY_TTL_MS + 310000]) {
    const invalid = new URL(f.tokenPath({ ...payload, expiresAt }), 'https://fixture.test').searchParams.get('token');
    assert.throws(() => f.entry.readParentGalleryEntryToken(invalid));
  }
});

test('entry rejects expired, malformed, excessive, noncanonical and altered scope before any database or PIN counter', async () => {
  const f = fixture(), valid = { v: 1, ...credentials('school'), expiresAt: Date.now() + 60000 };
  const paths = ['?token=legacy.signature', '?token=ec1.bad.bad.bad', '?token=first&token=second',
    '?token=' + 'x'.repeat(f.entry.MAX_PARENT_GALLERY_ENTRY_TOKEN_LENGTH + 1)];
  for (const change of [{ expiresAt: Date.now() - 1 }, { expiresAt: Date.now() + 8 * 86400000 }, { expiresAt: 'invalid' },
    { v: 2 }, { kind: 'unknown' }, { galleryId: 'not-uuid' }, { photographerId: 'not-uuid' }, { pin: '' },
    { email: 'invalid' }, { email: 'PARENT@example.test' }, { pin: ' padded ' }, { tab: 'photos' }, { unexpected: true }]) {
    paths.push(f.tokenPath({ ...valid, ...change }));
  }
  const issued = f.entry.createParentGalleryEntryPath(credentials('school'));
  const url = new URL(issued, 'https://fixture.test'), parts = url.searchParams.get('token').split('.');
  parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  paths.push('/api/portal/session/entry?token=' + parts.join('.'));
  paths.push(issued + '&email=untrusted%40example.test');
  for (const path of paths) {
    const response = await f.route.GET(f.request(path.startsWith('?') ? '/api/portal/session/entry' + path : path));
    assert.equal(response.headers.get('location'), 'https://canonical.example.test/parents?entry=unavailable');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  }
  assert.deepEqual(f.queries, []); assert.deepEqual(f.registrations, []); assert.deepEqual(f.counters, []);
});

test('foreign-host entry first canonicalizes the opaque token with zero cookie, database or budget work', async () => {
  const f = fixture(), path = f.entry.createParentGalleryEntryPath(credentials('school'));
  const response = await f.route.GET(f.request(path, 'https://alternate.example.test'));
  const next = new URL(response.headers.get('location'));
  assert.equal(next.origin, 'https://canonical.example.test'); assert.equal(next.pathname + next.search, path);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(f.queries, []); assert.deepEqual(f.registrations, []); assert.deepEqual(f.counters, []);
});

for (const kind of ['school', 'event']) test(`${kind} entry opens in a fresh browser after real current PIN/owner authorization and refunds its own shared attempt`, async () => {
  const f = fixture(), path = f.entry.createParentGalleryEntryPath({ ...credentials(kind), tab: 'orders' });
  const response = await f.route.GET(f.request(path));
  assert.equal(response.headers.get('location'), `https://canonical.example.test/parents/view/${lane}?tab=orders`);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /__Host-studio_os_parent_session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=86400; HttpOnly; SameSite=Lax; Secure/);
  assert.equal(cookie.includes(pin), false); assert.equal(cookie.includes(email), false);
  const token = cookie.match(/__Host-studio_os_parent_session=([^;]+)/)[1];
  assert.equal(f.registrations[0].p_token_hash, createHash('sha256').update(token).digest('hex'));
  assert.equal(f.registrations[0].p_photographer_id, owner);
  assert.equal(f.registrations[0].p_gallery_id, credentials(kind).galleryId);
  assert.equal(await redis.command('GET', f.counters[0].keys[0]), '0');
  assert.equal(await redis.command('GET', f.counters[0].keys[1]), '0');
});

test('changed PIN, owner, gallery availability and event approved-email policy cannot be bypassed by an authentic entry', async () => {
  for (const scenario of ['pin', 'owner', 'prerelease', 'expired', 'event-email']) {
    const f = fixture(), kind = scenario === 'event-email' ? 'event' : 'school';
    const path = f.entry.createParentGalleryEntryPath(credentials(kind));
    if (scenario === 'pin') f.tables.students[0].pin = 'changed-current-pin';
    if (scenario === 'owner') f.tables.schools[0].photographer_id = id(99);
    if (scenario === 'prerelease') f.tables.schools[0].portal_status = 'pre_release';
    if (scenario === 'expired') f.tables.schools[0].expiration_date = '2000-01-01';
    if (scenario === 'event-email') {
      f.tables.projects[0].email_required = true;
      f.tables.pre_release_emails.push({ project_id: project, email: 'different@example.test' });
    }
    const response = await f.route.GET(f.request(path));
    assert.equal(response.headers.get('location'), 'https://canonical.example.test/parents?entry=unavailable', scenario);
    assert.equal(response.headers.get('set-cookie'), null, scenario);
    assert.deepEqual(f.registrations, [], 'no session row is issued before exact current tenant authorization');
    assert.equal(await redis.command('GET', f.counters[0].keys[0]), '1', 'failed authorization keeps its own guessing charge');
  }
});

test('valid entry with unavailable session store fails safely and refunds the successful validator without clearing browser state', async () => {
  const f = fixture({ unavailable: true });
  const response = await f.route.GET(f.request(f.entry.createParentGalleryEntryPath(credentials('school')), undefined,
    '__Host-studio_os_parent_session=' + Buffer.alloc(32, 1).toString('base64url')));
  assert.equal(response.headers.get('location'), 'https://canonical.example.test/parents?entry=unavailable');
  assert.equal(response.headers.get('set-cookie'), null); assert.equal(f.registrations.length, 1);
  assert.equal(await redis.command('GET', f.counters[0].keys[0]), '0');
});

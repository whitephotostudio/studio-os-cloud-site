import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test, { before, after } from 'node:test';
import ts from 'typescript';
import { localPinBudgetRedis } from '../helpers/pin-budget-redis.mjs';

const require = createRequire(import.meta.url);
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
const { NextRequest, NextResponse } = require('next/server');
const nextTesting = require('next/experimental/testing/server');
// The installed Next version retains the old export name for this utility.
const doesProxyMatch = nextTesting.unstable_doesProxyMatch ?? nextTesting.unstable_doesMiddlewareMatch;
const env = { NODE_ENV: 'production', UPSTASH_REDIS_REST_URL: 'https://fixture.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'synthetic-provider-token', DOWNLOAD_TOKEN_SECRET: 'synthetic-private-media-secret',
  NEXT_PUBLIC_SUPABASE_URL: 'https://storage-fixture.supabase.invalid', NEXT_PUBLIC_SITE_URL: 'https://gallery-fixture.invalid' };
let pinRedis;
before(async () => { pinRedis = await localPinBudgetRedis(); });
after(async () => { await pinRedis?.close(); });

function load(path, modules = {}, clock = Date) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', 'process', 'Date', 'console', code)(name => modules[name] ??
    (name.startsWith('@/') ? assert.fail(`Missing fixture dependency ${name}`) : require(name)),
  exports, { env }, clock, { warn() {}, error() {} });
  return exports;
}

function fixture() {
  let now = Date.now();
  const counters = new Map();
  class Clock extends Date { static now() { return now; } }
  class Redis {}
  class Ratelimit {
    static fixedWindow(limit, duration) { return { limit, duration }; }
    constructor(options) { this.options = options; }
    async limit(key) {
      const { prefix, limiter } = this.options;
      const identity = `${prefix}:${key}`;
      let entry = counters.get(identity);
      if (!entry || now > entry.reset) {
        entry = { count: 0, reset: now + Number.parseInt(limiter.duration, 10) * 1000 };
        counters.set(identity, entry);
      }
      entry.count += 1;
      return { success: entry.count <= limiter.limit, remaining: Math.max(0, limiter.limit - entry.count), reset: entry.reset };
    }
  }
  // Exercise the real rateLimit implementation with an isolated durable-counter
  // adapter; no production configuration or network is used by this test.
  const limiter = load('lib/rate-limit.ts', { '@upstash/redis': { Redis }, '@upstash/ratelimit': { Ratelimit } }, Clock);
  class PinRedis { eval(script, keys, args) { return pinRedis.eval(script, keys, args); } }
  const pinBudget = load('lib/portal-pin-rate-limit.ts', { '@/lib/rate-limit': limiter,
    '@upstash/redis': { Redis: PinRedis } }, Clock);
  const csp = load('lib/content-security-policy.ts');
  const proxy = load('proxy.ts', { 'next/server': { NextResponse }, '@/lib/rate-limit': limiter,
    '@/lib/labs/pilot': load('lib/labs/pilot.ts', { 'server-only': {} }),
    '@/lib/portal-pin-rate-limit': pinBudget, '@/lib/content-security-policy': csp,
    '@/lib/parent-gallery-session': { parentSessionRateBudgetKey: async () => null } });
  const request = (path, { method = 'GET', ip = '192.0.2.10', body } = {}) => new NextRequest(`${env.NEXT_PUBLIC_SITE_URL}${path}`, {
    method, headers: { 'x-forwarded-for': ip, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { ...proxy, limiter, counters, request, advance: ms => { now += ms; } };
}

test('Next matches every private media extension while public assets remain excluded', () => {
  const f = fixture();
  for (const path of ['/api/r2/img/projects/fixture/photo.jpg', '/api/r2/img/projects/fixture/photo.JPG',
    '/api/r2/img/projects/fixture/photo.tiff', '/api/r2/img/projects/fixture/extensionless',
    '/api/storage/legacy-media/thumbs/fixture/photo.jpg', '/api/storage/legacy-media/nobg/fixture/photo.PNG']) {
    assert.equal(doesProxyMatch({ config: f.config, nextConfig: {}, url: path }), true, path);
  }
  for (const path of ['/logo.jpg', '/artwork/photo.png', '/_next/static/chunk.js', '/_next/image?url=fixture']) {
    assert.equal(doesProxyMatch({ config: f.config, nextConfig: {}, url: path }), false, path);
  }
});

test('a large mixed gallery cannot exhaust checkout or other ordinary API requests', async () => {
  const f = fixture();
  for (let i = 0; i < 450; i += 1) {
    const path = i % 2 ? `/api/r2/img/projects/fixture/photo-${i}.JPG?w=400`
      : `/api/storage/legacy-media/thumbs/fixture/photo-${i}.jpg`;
    const response = await f.proxy(f.request(path));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-middleware-next'), '1');
  }
  assert.equal(f.counters.get('rl:private-media-read:192.0.2.10').count, 450);
  assert.equal(f.counters.has('rl:api:192.0.2.10'), false);
  for (let i = 0; i < 100; i += 1) {
    assert.equal((await f.proxy(f.request('/api/stripe/checkout', { method: 'POST' }))).status, 200);
  }
  assert.equal((await f.proxy(f.request('/api/stripe/checkout', { method: 'POST' }))).status, 429);
  assert.equal((await f.proxy(f.request('/api/r2/img/projects/fixture/next.JPG'))).status, 200);
});

test('media reads retain a shared finite per-IP budget, Retry-After and window reset', async () => {
  const f = fixture();
  for (let i = 0; i < 3000; i += 1) {
    const path = i % 2 ? `/api/r2/img/projects/fixture/${i}.jpg`
      : `/api/storage/legacy-media/photos/fixture/${i}.jpg`;
    assert.equal((await f.proxy(f.request(path, { method: i % 3 ? 'GET' : 'HEAD' }))).status, 200);
  }
  const denied = await f.proxy(f.request('/api/r2/img/projects/fixture/excess.jpg'));
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers.get('retry-after')) > 0);
  assert.equal(denied.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await f.proxy(f.request('/api/stripe/checkout', { method: 'POST' }))).status, 200);
  assert.equal((await f.proxy(f.request('/api/r2/img/projects/fixture/excess.jpg', { ip: '192.0.2.11' }))).status, 200);
  f.advance(60_001);
  assert.equal((await f.proxy(f.request('/api/r2/img/projects/fixture/refreshed.jpg'))).status, 200);
});

test('neighbor paths, empty media roots and mutations retain the ordinary API budget', async () => {
  for (const [path, method] of [['/api/r2/img-evil/photo.JPG', 'GET'], ['/api/storage/legacy-media-evil/photo.JPG', 'GET'],
    ['/api/r2/img/', 'GET'], ['/api/storage/legacy-media/', 'GET'], ['/api/r2/img/projects/fixture/photo.JPG', 'POST'],
    ['/api/storage/legacy-media/thumbs/fixture/photo.jpg', 'PUT']]) {
    const f = fixture();
    assert.equal((await f.proxy(f.request(path, { method }))).status, 200);
    assert.equal(f.counters.get('rl:api:192.0.2.10').count, 1, `${method} ${path}`);
    assert.equal(f.counters.has('rl:private-media-read:192.0.2.10'), false);
  }
});

test('large media loads do not alter the stricter shared PIN guessing budget', async () => {
  const f = fixture();
  for (let i = 0; i < 150; i += 1) await f.proxy(f.request(`/api/r2/img/projects/fixture/${i}.JPG`));
  const body = { schoolId: '11111111-1111-4111-8111-111111111111', pin: 'synthetic-guess', email: 'viewer@example.test' };
  for (let i = 0; i < 10; i += 1) assert.equal((await f.proxy(f.request('/api/portal/gallery-context', { method: 'POST', body }))).status, 200);
  assert.equal((await f.proxy(f.request('/api/portal/school-favorites', { method: 'POST', body }))).status, 429);
  const shortKeys = (await pinRedis.command('KEYS', 'rl:pin-auth-reservation:v1:*')).filter(key => /:short:/.test(key));
  assert.equal(shortKeys.length, 1);
  assert.equal(await pinRedis.command('GET', shortKeys[0]), '10', 'denied guesses cannot grow or evade the atomic window');
});

test('legacy post-auth media budget permits full galleries and never bypasses capability or ownership checks', async () => {
  const f = fixture();
  const owner = '11111111-1111-4111-8111-111111111111';
  const browser = load('lib/photo-url.ts');
  const tokens = load('lib/legacy-storage-token.ts', { '@/lib/photo-url': browser });
  const ownership = load('lib/legacy-storage-access.ts');
  let resolved = 0, signed = 0;
  const service = {
    async rpc(name, args) {
      assert.equal(name, 'legacy_student_storage_owner');
      resolved += 1;
      return { data: args.p_key.startsWith('own/') ? owner : '22222222-2222-4222-8222-222222222222', error: null };
    },
    storage: { from: bucket => ({ createSignedUrl: async key => {
      signed += 1;
      return { data: { signedUrl: `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/sign/${bucket}/${key}?token=synthetic-native-token` }, error: null };
    } }) },
  };
  const route = load('app/api/storage/legacy-media/[bucket]/[...path]/route.ts', {
    'next/server': { NextResponse }, '@/lib/dashboard-auth': { createDashboardServiceClient: () => service,
      resolveDashboardAuth: async () => assert.fail('Capabilities must not require a dashboard session') },
    '@/lib/photo-url': browser, '@/lib/legacy-storage-access': ownership, '@/lib/legacy-storage-token': tokens,
    '@/lib/rate-limit': f.limiter,
  });
  const get = (key, token) => route.GET(f.request(`/api/storage/legacy-media/thumbs/${key}?token=${encodeURIComponent(token)}`),
    { params: Promise.resolve({ bucket: 'thumbs', path: key.split('/') }) });
  assert.equal((await get('own/photo.jpg', 'invalid')).status, 403);
  assert.equal(resolved, 0);
  assert.equal(signed, 0);
  for (let i = 0; i < 450; i += 1) {
    const key = `own/photo-${i}.jpg`;
    const token = new URL(tokens.signedLegacyStorageUrl({ bucket: 'thumbs', key }, 60, owner)).searchParams.get('token');
    assert.equal((await get(key, token)).status, 302);
  }
  assert.equal(signed, 450);
  const foreignToken = new URL(tokens.signedLegacyStorageUrl({ bucket: 'thumbs', key: 'foreign/photo.jpg' }, 60, owner)).searchParams.get('token');
  assert.equal((await get('foreign/photo.jpg', foreignToken)).status, 403);
  assert.equal(signed, 450);
  const bucket = f.counters.get('rl:legacy-storage-read:192.0.2.10');
  bucket.count = 3000;
  const ownToken = new URL(tokens.signedLegacyStorageUrl({ bucket: 'thumbs', key: 'own/last.jpg' }, 60, owner)).searchParams.get('token');
  assert.equal((await get('own/last.jpg', ownToken)).status, 429);
  assert.equal(signed, 450);
});

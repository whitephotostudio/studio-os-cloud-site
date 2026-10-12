import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { harness, projectId, lockedAlbum } from '../helpers/event-gallery-harness.mjs';

const require = createRequire(import.meta.url);
const secret = 'synthetic-test-secret';
const scope = { kind: 'event', galleryId: projectId, pin: 'project-pin', email: 'viewer@example.test' };
function fixture({ unavailable = false, now = Date.now() } = {}) {
  const calls = [], counters = new Map();
  class Clock extends Date { static now() { return now; } }
  const source = readFileSync(new URL('../../lib/portal-pin-rate-limit.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const rateLimit = async (key, config) => {
    calls.push({ key, config });
    const bucket = `${config.namespace}:${key}`, count = (counters.get(bucket) || 0) + 1;
    counters.set(bucket, count);
    return { allowed: !unavailable && count <= config.limit, resetAt: now + config.windowSeconds * 1000, unavailable };
  };
  new Function('require', 'exports', 'process', 'Date', output)(name => {
    if (name === '@/lib/rate-limit') return { rateLimit, getClientIp: request => request.headers.get('x-real-ip') || '192.0.2.1' };
    return require(name);
  }, exports, { env: { EVENT_DOWNLOAD_TOKEN_SECRET: secret, NODE_ENV: 'production' } }, Clock);
  const request = (path, body = { projectId, pin: scope.pin, email: scope.email }, cookie = '', method = 'POST') => {
    const url = new URL(`https://www.studiooscloud.com/api/portal/${path}`);
    if (method === 'GET') for (const [key, value] of Object.entries(body)) url.searchParams.set(key, value);
    return new Request(url, { method, headers: { cookie, 'content-type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
  };
  const cookieFor = (credential = scope) => exports.grantPortalPinBudget(new Response(), request('event-access'), credential).headers.get('set-cookie')?.split(';')[0] || '';
  return { ...exports, calls, request, cookieFor };
}

test('switching between every PIN validator shares the same attempt counter', async () => {
  const f = fixture();
  const paths = ['event-access', 'event-gallery-context', 'event-download-ready', 'event-downloads', 'event-favorites',
    'orders/create', 'orders/history', 'orders/dismiss', 'school-access', 'gallery-context', 'school-downloads', 'school-favorites', 'yearbook'];
  for (let i = 0; i < paths.length; i += 1) {
    const body = paths[i].startsWith('school') || paths[i] === 'gallery-context' || paths[i] === 'yearbook'
      ? { schoolId: projectId, email: scope.email, pin: scope.pin } : undefined;
    const result = await f.portalPinAttemptLimit(f.request(paths[i], body));
    assert.equal(result?.status ?? null, i < 10 ? null : 429, paths[i]);
  }
  assert.equal(new Set(f.calls.map(call => call.key)).size, 1);
  assert.equal(f.calls.every(call => call.config.failClosed === true), true);
});

test('valid proof permits rapid authorized interactions but cannot authorize a different PIN, gallery, email, or scope', async () => {
  const f = fixture(), cookie = f.cookieFor();
  for (let i = 0; i < 150; i += 1) {
    assert.equal(await f.portalPinAttemptLimit(f.request('event-favorites', undefined, cookie)), null);
  }
  assert.equal(f.calls.length, 0);
  for (const changed of [{ pin: 'different' }, { projectId: lockedAlbum }, { email: 'other@example.test' }, { schoolId: projectId, projectId: '' }]) {
    await f.portalPinAttemptLimit(f.request('event-gallery-context', { projectId, pin: scope.pin, email: scope.email, ...changed }, cookie));
  }
  assert.equal(f.calls.length, 8);
});

test('proof cookies are private, signed and contain no PIN or email', async () => {
  const f = fixture(), response = f.grantPortalPinBudget(new Response(), f.request('event-access'), scope);
  const raw = response.headers.get('set-cookie');
  assert.match(raw, /HttpOnly/); assert.match(raw, /Secure/); assert.match(raw, /SameSite=Lax/); assert.match(raw, /Path=\/api\/portal/);
  const [encoded, mac] = raw.split(';')[0].split('=')[1].split('.');
  const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
  assert.equal(decoded.includes(scope.pin), false); assert.equal(decoded.includes(scope.email), false);
  const tampered = `studio_os_parent_pin_budget=${encoded}.${mac.slice(0, -1)}${mac.endsWith('0') ? '1' : '0'}`;
  await f.portalPinAttemptLimit(f.request('event-favorites', undefined, tampered));
  assert.equal(f.calls.length, 2);
});

test('expired proof, missing proof, malformed scope, and limiter outage fail safely', async () => {
  const old = fixture({ now: Date.now() - 7 * 60 * 60 * 1000 }), f = fixture();
  await f.portalPinAttemptLimit(f.request('event-favorites', undefined, old.cookieFor()));
  await f.portalPinAttemptLimit(f.request('event-favorites', undefined, 'studio_os_parent_pin_budget=invalid'));
  assert.equal(f.calls.length, 4);
  assert.equal(f.cookieFor({ ...scope, galleryId: 'malformed' }), '');
  assert.equal(f.cookieFor({ ...scope, email: 'malformed' }), '');
  const outage = fixture({ unavailable: true });
  assert.equal((await outage.portalPinAttemptLimit(outage.request('event-gallery-context'))).status, 503);
  assert.equal(await outage.portalPinAttemptLimit(outage.request('event-favorites', undefined, outage.cookieFor())), null);
});

test('GET favorites and combined sibling orders cannot bypass the shared PIN budget', async () => {
  const f = fixture(), cookie = f.cookieFor();
  assert.equal(await f.portalPinAttemptLimit(f.request('event-favorites', undefined, cookie, 'GET')), null);
  const groups = [{ projectId, pin: scope.pin, email: scope.email }, { schoolId: lockedAlbum, pin: 'sibling-pin', email: scope.email }];
  for (let i = 0; i < 11; i += 1) {
    const result = await f.portalPinAttemptLimit(f.request('orders/create-combined', { groups }, cookie));
    assert.equal(result?.status ?? null, i < 10 ? null : 429);
  }
  const topLevel = fixture();
  for (let i = 0; i < 11; i += 1) {
    const result = await topLevel.portalPinAttemptLimit(topLevel.request('event-gallery-context', { projectId, pin: 'guess', email: scope.email, groups: [] }));
    assert.equal(result?.status ?? null, i < 10 ? null : 429, 'extra groups cannot suppress top-level PIN');
  }
});

test('duplicate GET credentials and extra gallery aliases cannot redirect a valid budget proof', async () => {
  const f = fixture(), cookie = f.cookieFor();
  for (const field of ['pin', 'email', 'projectId', 'schoolId', 'eventId']) {
    const request = f.request('event-favorites', undefined, cookie, 'GET');
    const url = new URL(request.url);
    if (!url.searchParams.has(field)) url.searchParams.append(field, projectId);
    url.searchParams.append(field, field === 'pin' ? 'guessed-pin' : 'different');
    const result = await f.portalPinAttemptLimit(new Request(url, { headers: { cookie } }));
    assert.equal(result.status, 400, field);
  }
  const otherProject = '99999999-9999-4999-8999-999999999999';
  for (const fields of [
    { projectId: otherProject, eventId: projectId },
    { projectId, schoolId: projectId },
    { projectId, eventId: otherProject },
  ]) {
    await f.portalPinAttemptLimit(f.request('event-favorites', { ...fields, pin: scope.pin, email: scope.email }, cookie));
  }
  assert.equal(f.calls.length, 6, 'every actual and extra scope must be covered before exemption');
});

test('validated context issues proof and locked album slugs cannot load or mutate favorites', async () => {
  const h = harness();
  const invalid = await h.post('app/api/portal/event-gallery-context/route.ts', h.body({ pin: 'incorrect' }));
  assert.equal(invalid.status, 404); assert.equal(invalid.headers.get('set-cookie'), null);
  const valid = await h.post('app/api/portal/event-gallery-context/route.ts');
  assert.equal(valid.status, 200); assert.match(valid.headers.get('set-cookie'), /HttpOnly/);
  for (const method of ['GET', 'POST']) {
    const request = new Request(`https://www.studiooscloud.com/api/portal/event-favorites?projectId=${projectId}&pin=guessable-slug&email=viewer@example.test`, {
      method, ...(method === 'POST' ? { body: JSON.stringify(h.body({ pin: 'guessable-slug' })), headers: { 'content-type': 'application/json' } } : {}),
    });
    request.nextUrl = new URL(request.url);
    const response = await h.load('app/api/portal/event-favorites/route.ts')[method](request);
    assert.equal(response.status, 404, method);
  }
});

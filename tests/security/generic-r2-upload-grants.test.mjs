import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const credentials = { R2_ACCOUNT_ID: 'fixture-account', R2_ACCESS_KEY_ID: 'fixture-access', R2_SECRET_ACCESS_KEY: 'fixture-secret', R2_BUCKET_NAME: 'fixture-bucket' };
function load(path, modules = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', 'process', code)(name => modules[name] ?? require(name), exports, { env: credentials });
  return exports;
}
const storageHosts = load('lib/storage-hosts.ts');
const storageRegions = load('lib/storage-regions.ts', { '@/lib/storage-hosts': storageHosts });
const signer = load('lib/r2-signed-urls.ts', { '@/lib/storage-hosts': storageHosts, '@/lib/storage-regions': storageRegions });
// The gateway signs every grant for the photographer's storage region.
const fixtureRegion = storageRegions.defaultStorageRegion();
const ownership = load('lib/r2-access-security.ts');
const key = 'projects/11111111-1111-4111-8111-111111111111/albums/main/photo 1.jpg';
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const encode = value => encodeURIComponent(value).replace(/[!*'()]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);

// Independent SigV4 verification proves that editing either transmitted header
// changes the signature storage checks, rather than merely inspecting its URL.
function validUploadSignature(ticket, length, type) {
  const url = new URL(ticket);
  const scope = url.searchParams.get('X-Amz-Credential').split('/').slice(1).join('/');
  const query = [...url.searchParams].filter(([name]) => name !== 'X-Amz-Signature').sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${encode(name)}=${encode(value)}`).join('&');
  const canonical = ['PUT', url.pathname, query, `content-length:${length}\ncontent-type:${type}\nhost:${url.host}\n`,
    'content-length;content-type;host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', url.searchParams.get('X-Amz-Date'), scope, createHash('sha256').update(canonical).digest('hex')].join('\n');
  const [date, region, service] = scope.split('/');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${credentials.R2_SECRET_ACCESS_KEY}`, date), region), service), 'aws4_request');
  return createHmac('sha256', signingKey).update(toSign).digest('hex') === url.searchParams.get('X-Amz-Signature');
}

test('ordinary upload grants bind validated body length and content type', () => {
  const ticket = signer.r2PresignedPutUrl(key, 900, { contentLength: 123, contentType: 'image/jpeg' });
  assert.equal(new URL(ticket).searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host');
  assert.equal(validUploadSignature(ticket, 123, 'image/jpeg'), true);
  assert.equal(validUploadSignature(ticket, 124, 'image/jpeg'), false);
  assert.equal(validUploadSignature(ticket, 123, 'text/plain'), false);
});

test('ordinary upload signer refuses absent and invalid validated headers', () => {
  for (const options of [{}, { contentLength: 1 }, { contentLength: 0, contentType: 'image/jpeg' },
    { contentLength: 250 * 1024 * 1024 + 1, contentType: 'image/jpeg' },
    { contentLength: 1.5, contentType: 'image/jpeg' }, { contentLength: 1, contentType: 'image/jpeg\r\nmalicious: true' }]) {
    assert.equal(signer.r2PresignedPutUrl(key, 900, options), '');
  }
  assert.ok(signer.r2PresignedPutUrl(key, 900, { contentLength: 250 * 1024 * 1024, contentType: 'image/jpeg' }));
});

test('gateway keeps tenant authorization and passes exact validated headers to signing', async () => {
  const calls = [];
  const studio = '33333333-3333-4333-8333-333333333333';
  const service = { from(table) {
    const filters = new Map();
    const query = { select: () => query, eq: (field, value) => { filters.set(field, value); return query; }, maybeSingle: async () => ({
      data: table === 'photographers' ? { id: studio } : filters.get('photographer_id') === studio && filters.get('id') === key.split('/')[1] ? { id: filters.get('id') } : null,
      error: null,
    }) };
    return query;
  }, async rpc(name, args) {
    assert.equal(name, 'r2_media_namespace_owner');
    return { data: args.p_kind === 'project' && args.p_root === key.split('/')[1]
      ? [{ photographer_id: studio, school_id: null }] : [], error: null };
  } };
  const route = load('app/api/dashboard/r2-access/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/dashboard-auth': { resolveDashboardAuth: async () => ({ user: { id: 'user' }, mfaSatisfied: true }), createDashboardServiceClient: () => service },
    '@/lib/require-agreement': { guardAgreement: async () => ({ ok: true }) },
    '@/lib/r2': {}, '@/lib/r2-access-security': ownership,
    '@/lib/photographer-storage': { selectPhotographerStorage: async (client, field, value) => client.from('photographers').select('id').eq(field, value).maybeSingle(), enterPhotographerStorage: () => fixtureRegion },
    '@/lib/r2-media-ownership': load('lib/r2-media-ownership.ts', { '@/lib/r2-access-security': ownership }),
    '@/lib/r2-signed-urls': { ...signer, r2PresignedPutUrl: (...args) => { calls.push(args); return signer.r2PresignedPutUrl(...args); } },
    '@/lib/rate-limit': { rateLimit: async () => ({ allowed: true }) },
    '@/lib/credit-cutout-access': { isManagedCutoutKey: () => false },
  });
  const request = body => ({ json: async () => ({ action: 'sign-upload', ...body }) });
  const result = await route.POST(request({ key, contentLength: 123, contentType: 'image/jpeg' }));
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.deepEqual(calls, [[key, 900, { contentLength: 123, contentType: 'image/jpeg', region: fixtureRegion }]]);
  assert.equal(validUploadSignature(body.url, 123, body.headers['content-type']), true);
  assert.equal((await route.POST(request({ key: key.replace(key.split('/')[1], '22222222-2222-4222-8222-222222222222'), contentLength: 123, contentType: 'image/jpeg' }))).status, 403);
  assert.equal((await route.POST(request({ key, contentLength: 0, contentType: 'image/jpeg' }))).status, 400);
  assert.equal(calls.length, 1);
});

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import sharp from 'sharp';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function load(path, modules = {}, fixtureProcess = process) {
  const exports = {};
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', 'process', code)(name => name in modules ? modules[name] : name.startsWith('@/') ? assert.fail(`Missing mock: ${name}`) : require(name), exports, fixtureProcess);
  return exports;
}
const security = load('lib/r2-access-security.ts');
const ownership = load('lib/upload-ownership.ts', { './r2-access-security': security });
class FixtureResponse extends Response {
  static json(body, init) { return Response.json(body, init); }
  static redirect(url, init) { return new Response(null, { status: typeof init === 'number' ? init : init?.status ?? 307, headers: { location: url } }); }
}
const next = { NextResponse: FixtureResponse };
async function transparentPng(alpha = [0, 255, 160, 255]) {
  const bytes = Buffer.alloc(16);
  for (let i = 0; i < 4; i++) bytes.set([80, 140, 200, alpha[i % alpha.length]], i * 4);
  return sharp(bytes, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
}
async function fixture(options = {}) {
  const studio = randomUUID(), photographer = randomUUID(), project = randomUUID(), foreignProject = randomUUID();
  const key = `nobg-photos/projects/${project}/albums/main/portrait.png`, legacy = `nobg-photos/projects/${project}/albums/main/legacy.png`;
  const bytes = await transparentPng(), original = sha(Buffer.from('original fixture'));
  const objects = new Map([[key, bytes], [legacy, bytes]]), bindings = new Map([[key, { object_key: key, original_sha256: original, cutout_sha256: sha(bytes) }]]);
  const calls = [], signed = [];
  const service = {
    from(table) {
      const filters = new Map();
      const result = () => {
        if (table === 'photographers') return filters.get('user_id') === studio ? { id: photographer } : null;
        if (table === 'projects') return filters.get('id') === project && (!filters.has('photographer_id') || filters.get('photographer_id') === photographer) ? { id: project, photographer_id: photographer } : null;
        if (table === 'schools') return [];
        assert.fail(`Unexpected table: ${table}`);
      };
      const chain = { select() { return chain; }, eq(field, value) { filters.set(field, value); return chain; }, limit() { return chain; },
        maybeSingle: async () => ({ data: result(), error: null }), then: resolve => resolve({ data: result(), error: null }) };
      return chain;
    },
    async rpc(name, args) {
      calls.push({ rpc: name, args });
      if (name === 'authorized_credit_cutout_keys') return { data: args.p_photographer_id === photographer
        ? args.p_keys.flatMap(key => bindings.has(key) && options.paid !== false ? [bindings.get(key)] : []) : [], error: null };
      if (name === 'has_studio_cutout_entitlement') return { data: options.paid !== false && args.p_studio_id === studio && args.p_original_sha256 === original && args.p_cutout_sha256 === sha(bytes), error: null };
      if (name === 'link_credit_cutout_object') {
        if (options.linked === false) return { data: false, error: null };
        bindings.set(args.p_object_key, { object_key: args.p_object_key, original_sha256: args.p_original_sha256, cutout_sha256: args.p_cutout_sha256 });
        return { data: true, error: null };
      }
      assert.fail(`Unexpected RPC: ${name}`);
    },
  };
  const auth = { user: { id: studio }, mfaSatisfied: true, ...options.auth };
  const authModule = { resolveDashboardAuth: async () => auth, createDashboardServiceClient: () => service };
  const r2 = {
    R2_BUCKET: 'fixture', r2Download: async (key, opts) => { calls.push({ download: key, opts }); assert.ok(objects.has(key)); return objects.get(key); },
    r2Upload: async (key, body, type, cache, opts) => { calls.push({ upload: key, type, cache, opts, body: Buffer.from(body) }); objects.set(key, Buffer.from(body)); return key; },
    r2Delete: async (key, opts) => { calls.push({ deleted: key, opts }); objects.delete(key); },
    listR2FolderImages: async prefix => [...objects.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key, url: '', name: key.split('/').at(-1) })),
    getR2Client: () => ({ send: async command => { calls.push({ sdk: command.input }); return { Contents: [{ Key: key }, { Key: legacy }], IsTruncated: true, NextContinuationToken: 'next-fixture-page' }; } }),
  };
  const signer = {
    r2PresignedGetUrl: (key, ttl, opts) => { signed.push({ key, ttl, opts, method: 'GET' }); return `https://fixture.invalid/${key}?expires=${ttl}`; },
    r2PresignedPutUrl: (key, ttl, opts) => { signed.push({ key, ttl, opts, method: 'PUT' }); return `https://fixture.invalid/${key}?expires=${ttl}`; },
  };
  const access = load('lib/credit-cutout-access.ts', { '@/lib/dashboard-auth': authModule, '@/lib/r2': r2, '@/lib/r2-signed-urls': signer, '@/lib/r2-access-security': security });
  const staging = load('lib/credit-cutout-staging.ts', { '@/lib/r2': r2, '@/lib/credit-cutout-access': access });
  const modules = { 'next/server': next, sharp: { default: sharp }, '@/lib/dashboard-auth': authModule, '@/lib/r2': r2,
    '@/lib/r2-signed-urls': signer, '@/lib/credit-cutout-access': access, '@/lib/credit-cutout-staging': staging,
    '@/lib/upload-ownership': ownership, '@/lib/r2-access-security': security,
    '@/lib/require-agreement': { guardAgreement: async () => ({ ok: true }) }, '@/lib/rate-limit': { rateLimit: async () => ({ allowed: true }) } };
  const upload = load('app/api/dashboard/upload-to-r2/route.ts', modules);
  const gateway = load('app/api/dashboard/r2-access/route.ts', modules);
  const stageRoute = load('app/api/credits/cutout-staging/route.ts', modules);
  const jsonRequest = body => ({ headers: new Headers({ 'content-type': 'application/json' }), json: async () => body });
  const uploadRequest = ({ target = key, body = bytes, source = original, type = 'application/octet-stream' } = {}) => ({ headers: new Headers(), formData: async () => {
    const form = new FormData(); form.set('file', new File([body], 'portrait.png', { type })); form.set('key', target);
    if (source !== null) form.set('original_sha256', source);
    return form;
  } });
  return { studio, photographer, project, foreignProject, key, legacy, bytes, original, objects, bindings, calls, signed,
    service, access, staging, upload, gateway, stageRoute, jsonRequest, uploadRequest, modules };
}

test('generic signing and object transforms cannot grant managed or staging cutouts', async () => {
  const signed = load('lib/r2-signed-urls.ts', {}, { env: { R2_ACCOUNT_ID: 'fixture', R2_ACCESS_KEY_ID: 'fixture', R2_SECRET_ACCESS_KEY: 'fixture' } });
  for (const key of ['nobg-photos/school/photo.png', 'credit-staging/studio/photo.png']) {
    assert.equal(signed.r2PresignedGetUrl(key), ''); assert.equal(signed.r2PresignedPutUrl(key), '');
  }
  assert.equal(signed.r2PresignedGetUrl('credit-staging/studio/photo.png', 120, { allowVerifiedCutout: true }), '');
  const stageKey = `credit-staging/${randomUUID()}/${randomUUID()}.png`;
  assert.equal(signed.r2PresignedPutUrl(stageKey, 120, { allowCutoutStaging: true }), '');
  const stageUrl = signed.r2PresignedPutUrl(stageKey, 600, { allowCutoutStaging: true, contentLength: 50, contentType: 'image/png' });
  assert.equal(new URL(stageUrl).searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host');
  assert.equal(new URL(stageUrl).searchParams.get('X-Amz-Expires'), '120');
  const storage = load('lib/r2.ts', { '@/lib/r2-signed-urls': signed, '@/lib/school-photo-deletions': { schoolPhotoFamilyForKey: () => null } }, { env: {} });
  for (const key of ['nobg-photos/school/photo.png', 'credit-staging/studio/photo.png']) {
    await assert.rejects(storage.r2Upload(key, Buffer.from('x'), 'image/png'));
    await assert.rejects(storage.r2Download(key));
    await assert.rejects(storage.r2Copy(key, 'schools/owned/photo.png'));
    await assert.rejects(storage.r2Copy('schools/owned/photo.png', key));
  }
  assert.equal(security.scopeForR2Key(`credit-staging/${randomUUID()}/${randomUUID()}.png`), null);
});
test('exact paid binding and body hash precede signing; legacy or overwritten output stays private', async () => {
  const f = await fixture();
  const regular = { key: `projects/${f.project}/albums/main/photo.jpg`, url: 'ordinary-url' };
  const files = await f.access.filterPaidCutoutFiles([regular, { key: f.key, url: '' }, { key: f.legacy, url: 'old-url' }], { service: f.service, photographerId: f.photographer, ttlSeconds: 21600 });
  assert.equal(files.length, 2); assert.deepEqual(files[0], regular);
  assert.equal(f.signed[0].ttl, 300); assert.equal(f.signed[0].opts.allowVerifiedCutout, true);
  assert.equal(f.objects.has(f.legacy), true, 'legacy data must be preserved for review');
  f.objects.set(f.key, Buffer.from('stale signed PUT replacement'));
  await assert.rejects(f.access.readPaidCutout(f.service, f.photographer, f.key), f.access.CreditCutoutAccessError);
  assert.equal((await f.access.filterPaidCutoutFiles([{ key: f.key, url: '' }], { service: f.service, photographerId: f.photographer })).length, 0);
  assert.equal(f.signed.length, 1, 'changed body must never get another URL');
});
test('revoked proof and another photographer cannot read the paid body', async () => {
  const f = await fixture({ paid: false });
  await assert.rejects(f.access.readPaidCutout(f.service, f.photographer, f.key));
  await assert.rejects(f.access.readPaidCutout(f.service, randomUUID(), f.key));
  assert.equal(f.calls.some(call => call.download), false);
  assert.equal(f.signed.length, 0);
});
test('direct upload validates actual PNG and SHA after target ownership, before PUT and binding', async () => {
  const f = await fixture();
  const response = await f.upload.POST(f.uploadRequest());
  assert.equal(response.status, 200); assert.equal((await response.json()).ok, true);
  assert.deepEqual(f.calls.map(call => call.rpc || (call.upload ? 'PUT' : 'unexpected')), ['has_studio_cutout_entitlement', 'PUT', 'link_credit_cutout_object']);
  assert.equal(f.calls[0].args.p_cutout_sha256, sha(f.bytes));
  assert.deepEqual(f.calls[1].body, f.bytes); assert.equal(f.calls[1].type, 'image/png');
  assert.equal(f.calls[1].opts.allowVerifiedCutout, true); assert.equal(f.calls[1].cache, 'private, no-store');
  assert.equal(f.calls[2].args.p_original_sha256, f.original);
});
test('unpaid, missing original and foreign target uploads cannot write or authorize anything', async () => {
  const unpaid = await fixture({ paid: false });
  assert.equal((await unpaid.upload.POST(unpaid.uploadRequest())).status, 403);
  assert.equal(unpaid.calls.some(call => call.upload), false);
  const f = await fixture();
  assert.equal((await f.upload.POST(f.uploadRequest({ source: null }))).status, 403);
  assert.equal((await f.upload.POST(f.uploadRequest({ target: f.key.replace(f.project, f.foreignProject) }))).status, 403);
  assert.equal(f.calls.length, 0, 'foreign target must fail before paid proof or writes');
});
test('fake PNG, opaque/empty alpha and oversized multipart cutouts never reach accounting or PUT', async () => {
  const f = await fixture();
  for (const body of [Buffer.from('fake PNG'), await transparentPng([255]), await transparentPng([0]), await sharp(f.bytes).jpeg().toBuffer()]) {
    assert.equal((await f.upload.POST(f.uploadRequest({ body }))).status, 400);
  }
  assert.equal((await f.upload.POST(f.uploadRequest({ body: Buffer.alloc(3 * 1024 * 1024 + 1) }))).status, 413);
  assert.equal(f.calls.length, 0);
});
test('generic gateway denies canonical PUT even when paid, filters list and verifies signed GET', async () => {
  const f = await fixture();
  assert.equal((await f.gateway.POST(f.jsonRequest({ action: 'sign-upload', key: f.key, contentType: 'image/png', contentLength: f.bytes.length }))).status, 403);
  assert.equal(f.signed.length, 0);
  const listing = await f.gateway.POST(f.jsonRequest({ action: 'list', prefix: `nobg-photos/projects/${f.project}/albums/main/` }));
  assert.deepEqual((await listing.json()).keys, [f.key]);
  const download = await f.gateway.POST(f.jsonRequest({ action: 'sign-download', key: f.key }));
  assert.equal(download.status, 200); assert.equal((await download.json()).expiresIn, 300);
  assert.equal(f.signed.at(-1).opts.allowVerifiedCutout, true);
  assert.equal((await f.gateway.POST(f.jsonRequest({ action: 'sign-download', key: f.legacy }))).status, 403);
  f.objects.set(f.key, Buffer.from('overwritten'));
  assert.equal((await f.gateway.POST(f.jsonRequest({ action: 'sign-download', key: f.key }))).status, 403);
});
test('fresh private staging grants no entitlement; owned exact bytes finalize then cleanup', async () => {
  const f = await fixture();
  const grant = await f.stageRoute.POST(f.jsonRequest({ contentLength: f.bytes.length, key: f.key }));
  assert.equal(grant.status, 200);
  const body = await grant.json();
  assert.equal(body.ok, true); assert.equal(body.expiresIn, 120); assert.equal(body.maxBytes, 25 * 1024 * 1024);
  assert.equal(body.headers['content-length'], String(f.bytes.length));
  assert.equal(f.signed[0].opts.contentLength, f.bytes.length); assert.equal(f.signed[0].opts.contentType, 'image/png');
  assert.equal(f.staging.ownsCutoutStagingKey(f.studio, body.key), true); assert.notEqual(body.key, f.key);
  assert.equal(f.signed[0].opts.allowCutoutStaging, true); assert.equal(f.signed[0].method, 'PUT'); assert.equal(f.calls.length, 0);
  f.objects.set(body.key, f.bytes);
  const response = await f.upload.POST(f.jsonRequest({ key: f.key, staging_key: body.key, original_sha256: f.original }));
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls.map(call => call.rpc || (call.download ? 'GET-stage' : call.upload ? 'PUT-canonical' : 'DELETE-stage')),
    ['GET-stage', 'has_studio_cutout_entitlement', 'PUT-canonical', 'link_credit_cutout_object', 'DELETE-stage']);
  assert.equal(f.objects.has(body.key), false);
  assert.deepEqual(f.objects.get(f.key), f.bytes);
});
test('foreign/malformed staging and failed paid proof cannot consume stage as a photo', async () => {
  const f = await fixture();
  const foreignKey = `credit-staging/${randomUUID()}/${randomUUID()}.png`;
  f.objects.set(foreignKey, f.bytes);
  assert.equal((await f.upload.POST(f.jsonRequest({ key: f.key, staging_key: foreignKey, original_sha256: f.original }))).status, 403);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.upload.POST(f.jsonRequest({ key: `projects/${f.project}/albums/main/photo.jpg`, staging_key: foreignKey, original_sha256: f.original }))).status, 400);
  const unpaid = await fixture({ paid: false });
  const stage = `credit-staging/${unpaid.studio}/${randomUUID()}.png`; unpaid.objects.set(stage, unpaid.bytes);
  assert.equal((await unpaid.upload.POST(unpaid.jsonRequest({ key: unpaid.key, staging_key: stage, original_sha256: unpaid.original }))).status, 403);
  assert.equal(unpaid.calls.some(call => call.upload || call.deleted), false);
  assert.equal(unpaid.objects.has(stage), true);
  const badStage = `credit-staging/${f.studio}/${randomUUID()}.png`;
  f.objects.set(badStage, Buffer.from('bad PNG bytes'));
  assert.equal((await f.upload.POST(f.jsonRequest({ key: f.key, staging_key: badStage, original_sha256: f.original }))).status, 400);
  f.calls.length = 0;
  f.objects.set(badStage, Buffer.alloc(25 * 1024 * 1024 + 1));
  assert.equal((await f.upload.POST(f.jsonRequest({ key: f.key, staging_key: badStage, original_sha256: f.original }))).status, 403);
  assert.equal(f.calls.some(call => call.rpc || call.upload || call.deleted), false);
});
test('staging size/type bounds and incomplete MFA fail before issuing a URL', async () => {
  const f = await fixture();
  for (const body of [{ contentLength: 0 }, { contentLength: 25 * 1024 * 1024 + 1 }, { contentLength: 5, contentType: 'text/html' }]) {
    assert.equal((await f.stageRoute.POST(f.jsonRequest(body))).status, 400);
  }
  assert.equal(f.signed.length, 0);
  for (const [auth, status] of [[{ user: null }, 401], [{ mfaSatisfied: false }, 403]]) {
    const unauth = await fixture({ auth });
    assert.equal((await unauth.stageRoute.POST(unauth.jsonRequest({ contentLength: 5 }))).status, status);
    assert.equal((await unauth.upload.POST(unauth.uploadRequest())).status, status);
    assert.equal(unauth.signed.length, 0); assert.equal(unauth.calls.length, 0);
  }
});

test('image proxy denies unknown/changed cutouts and makes verified redirect/thumbnail private', async () => {
  const f = await fixture();
  const image = load('app/api/r2/img/[...path]/route.ts', { ...f.modules, '@/lib/school-photo-deletions': {
    safeLocalSchoolStorageId: value => value, schoolPhotoFamilyForKey: () => null, loadSchoolPhotoTombstones: async () => [], tombstoneFamilySet: () => new Set(),
  } });
  const request = width => ({ nextUrl: new URL(`https://example.invalid/api/r2/img/example${width ? `?w=${width}` : ''}`) });
  const context = key => ({ params: Promise.resolve({ path: key.split('/') }) });
  assert.equal((await image.GET(request(), context(f.legacy))).status, 403);
  const redirect = await image.GET(request(), context(f.key));
  assert.equal(redirect.status, 302); assert.equal(redirect.headers.get('cache-control'), 'private, no-store');
  assert.equal(f.signed.at(-1).ttl, 300);
  const thumbnail = await image.GET(request(160), context(f.key));
  assert.equal(thumbnail.status, 200); assert.equal(thumbnail.headers.get('cache-control'), 'private, no-store');
  assert.equal((await sharp(Buffer.from(await thumbnail.arrayBuffer())).metadata()).format, 'jpeg');
  f.objects.set(f.key, Buffer.from('changed'));
  assert.equal((await image.GET(request(160), context(f.key))).status, 403);
});
test('portal no-background mapping and backdrop compositions consume only exact bound paid output', async () => {
  const f = await fixture();
  const sourceKey = `projects/${f.project}/albums/main/portrait.jpg`;
  const media = { id: 'photo', storage_path: sourceKey, preview_url: '', thumbnail_url: '', download_url: '', filename: 'portrait.jpg' };
  const folder = load('lib/storage-folder.ts', { ...f.modules, '@/lib/school-photo-deletions': {} });
  const map = await folder.loadNoBgUrlMapForMediaRows([media], { service: f.service, photographerId: f.photographer });
  assert.equal(map[media.id]?.includes(f.key), true);
  const backdropKey = `backdrops/${f.photographer}/background.jpg`;
  f.objects.set(backdropKey, await sharp({ create: { width: 4, height: 4, channels: 3, background: '#f08020' } }).jpeg().toBuffer());
  const composites = load('lib/backdrop-composites.ts', f.modules);
  const opts = { originalUrlOrKey: sourceKey, backdrop: { image_url: backdropKey }, service: f.service, photographerId: f.photographer };
  const composite = await composites.composeBackdropImage(opts);
  assert.equal(composite.contentType, 'image/jpeg');
  assert.equal((await sharp(composite.buffer).metadata()).format, 'jpeg');
  f.bindings.clear(); f.calls.length = 0;
  assert.deepEqual(await folder.loadNoBgUrlMapForMediaRows([media], { service: f.service, photographerId: f.photographer }), {});
  assert.equal(await composites.composeBackdropImage(opts), null);
  assert.equal(f.calls.some(call => call.download === f.key), false, 'unpaid foreground must never reach compositor');
  assert.equal(f.objects.has(f.key), true);
});

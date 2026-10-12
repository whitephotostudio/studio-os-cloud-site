import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as crypto from 'node:crypto';

const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://storage-fixture.supabase.invalid', NEXT_PUBLIC_SITE_URL: 'https://gallery-fixture.invalid',
  DOWNLOAD_TOKEN_SECRET: 'synthetic-private-storage-secret' };
function load(path, modules = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', 'process', code)(name => modules[name] ?? assert.fail(`Missing dependency ${name}`), exports, { env });
  return exports;
}
const browser = load('lib/photo-url.ts');
const tokens = load('lib/legacy-storage-token.ts', { 'node:crypto': crypto, '@/lib/photo-url': browser });
const access = load('lib/legacy-storage-access.ts');
const r2Security = load('lib/r2-access-security.ts');
const r2Tokens = load('lib/r2-media-token.ts', { 'node:crypto': crypto, '@/lib/r2-access-security': r2Security });
const owner = '11111111-1111-4111-8111-111111111111', otherOwner = '22222222-2222-4222-8222-222222222222', project = '33333333-3333-4333-8333-333333333333';
const key = `projects/${project}/albums/main/photo 1.jpg`;
const reference = { bucket: 'thumbs', key };
const publicUrl = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/thumbs/${key.split('/').map(encodeURIComponent).join('/')}`;

function fixture(options = {}) {
  const signed = [], queries = [];
  const tables = { projects: [{ id: project, photographer_id: owner }], photographers: [{ id: owner, user_id: 'user' }, { id: otherOwner, user_id: 'other-user' }],
    schools: [], students: [], media: [], ...options.tables };
  const ownership = { [`thumbs/${key}`]: owner, ...options.ownership };
  const service = { async rpc(name, args) {
    assert.equal(name, 'legacy_student_storage_owner');
    queries.push(name);
    return { data: options.readError ? null : ownership[`${args.p_bucket}/${args.p_key}`] ?? null, error: options.readError ? new Error('provider unavailable') : null };
  }, from(table) {
    const filters = [];
    const result = () => { queries.push(table); return { data: options.readError ? null : tables[table].filter(row => filters.every(([field, value]) => row[field] === value)), error: options.readError ? new Error('provider unavailable') : null }; };
    const query = { select: () => query, eq: (field, value) => { filters.push([field, value]); return query; }, limit: () => query,
      maybeSingle: async () => { const response = result(); return { ...response, data: response.data?.[0] ?? null }; },
      then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject) };
    return query;
  }, storage: { from: bucket => ({ createSignedUrl: async (objectKey, ttl) => {
    signed.push({ bucket, key: objectKey, ttl });
    return { data: { signedUrl: options.redirect || `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/sign/${bucket}/${objectKey.split('/').map(encodeURIComponent).join('/')}?token=synthetic-native-signature` }, error: null };
  } }) } };
  const route = load('app/api/storage/legacy-media/[bucket]/[...path]/route.ts', {
    'next/server': { NextResponse: class extends Response { static json = (value, options) => Response.json(value, options); } },
    '@/lib/dashboard-auth': { resolveDashboardAuth: async () => ({ user: options.signedOut ? null : { id: options.userId ?? 'user' }, mfaSatisfied: options.mfaSatisfied ?? true }), createDashboardServiceClient: () => service },
    '@/lib/photo-url': browser, '@/lib/legacy-storage-access': access, '@/lib/legacy-storage-token': tokens,
    '@/lib/rate-limit': { getClientIp: () => '192.0.2.1', rateLimit: async () => ({ allowed: options.allowed !== false }) },
  });
  return { service, signed, queries, get: (extra = {}) => route.GET({ nextUrl: new URL(`https://gallery-fixture.invalid/${extra.token ? `?token=${encodeURIComponent(extra.token)}` : ''}`) },
    { params: Promise.resolve({ bucket: extra.bucket || reference.bucket, path: (extra.key || reference.key).split('/') }) }) };
}

test('only configured private Supabase buckets normalize into authenticated browser reads', () => {
  const expected = '/api/storage/legacy-media/thumbs/projects/' + project + '/albums/main/photo%201.jpg';
  assert.deepEqual(browser.privateSupabaseStorageReference(publicUrl), reference);
  assert.equal(browser.proxiedPhotoUrl(publicUrl), expected);
  assert.equal(browser.proxiedPhotoUrl(expected), expected);
  for (const value of [publicUrl.replace('storage-fixture.supabase.invalid', 'attacker.invalid'), publicUrl.replace('/thumbs/', '/backdrops/'), publicUrl.replace('/thumbs/', '/studio-logos/')]) {
    assert.equal(browser.privateSupabaseStorageReference(value), null);
  }
  for (const objectKey of ['../secret.jpg', '/absolute.jpg', 'folder/../secret.jpg', 'folder//photo.jpg', 'folder\\photo.jpg', 'folder/\u0000photo.jpg']) {
    assert.equal(browser.legacyStorageReference('thumbs', objectKey), null);
  }
  assert.equal(browser.legacyStorageReference('unknown', key), null);
});

test('tenant-bound capabilities reject absent owner, modified photo, bucket, signature and expiration', () => {
  assert.equal(tokens.signedLegacyStorageUrl(reference, 60), '');
  const url = new URL(tokens.signedLegacyStorageUrl(reference, 60, owner)), token = url.searchParams.get('token');
  assert.equal(tokens.verifyLegacyStorageToken(token, reference), owner);
  assert.equal(tokens.verifyLegacyStorageToken(token, { ...reference, key: `${key}.other` }), null);
  assert.equal(tokens.verifyLegacyStorageToken(token, { ...reference, bucket: 'nobg-photos' }), null);
  assert.equal(tokens.verifyLegacyStorageToken(`${token}x`, reference), false);
  assert.equal(tokens.verifyLegacyStorageToken(`${token}.extra`, reference), false);
  const payload = Buffer.from(JSON.stringify({ v: 1, ...reference, photographerId: owner, exp: Date.now() - 1 })).toString('base64url');
  const signature = crypto.createHmac('sha256', env.DOWNLOAD_TOKEN_SECRET).update(`studio-os-legacy-storage-v1:${payload}`).digest('base64url');
  assert.equal(tokens.verifyLegacyStorageToken(`${payload}.${signature}`, reference), null);
});

test('authenticated owner receives a short private storage redirect; another tenant cannot sign it', async () => {
  const f = fixture(), result = await f.get();
  assert.equal(result.status, 302);
  assert.match(result.headers.get('location'), /\/storage\/v1\/object\/sign\/thumbs\//);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
  assert.deepEqual(f.signed, [{ ...reference, ttl: 300 }]);
  const foreign = fixture({ userId: 'other-user' });
  assert.equal((await foreign.get()).status, 403);
  assert.deepEqual(foreign.signed, []);
});

test('signed server capability works without a session only for the exact resolved tenant', async () => {
  const ownToken = new URL(tokens.signedLegacyStorageUrl(reference, 60, owner)).searchParams.get('token');
  const wrongOwnerToken = new URL(tokens.signedLegacyStorageUrl(reference, 60, otherOwner)).searchParams.get('token');
  const f = fixture({ signedOut: true });
  assert.equal((await f.get({ token: ownToken })).status, 302);
  const foreign = fixture({ signedOut: true });
  assert.equal((await foreign.get({ token: wrongOwnerToken })).status, 403);
  assert.equal(foreign.signed.length, 0);
});

test('anonymous, MFA-incomplete, malformed and throttled reads never issue storage signatures', async () => {
  for (const [options, extra, status] of [[{ signedOut: true }, {}, 401], [{ mfaSatisfied: false }, {}, 403], [{ allowed: false }, {}, 429],
    [{}, { bucket: 'backdrops' }, 400], [{}, { key: '../secret.jpg' }, 400], [{}, { token: 'invalid' }, 403]]) {
    const f = fixture(options);
    assert.equal((await f.get(extra)).status, status);
    assert.equal(f.signed.length, 0);
  }
});

test('immutable ownership, unknown objects and provider failures fail closed', async () => {
  const modifiedPointer = fixture({ tables: { media: [{ project_id: project, thumbnail_url: 'unknown/photo.jpg' }] } });
  assert.equal((await modifiedPointer.get({ key: 'unknown/photo.jpg' })).status, 403);
  assert.equal(modifiedPointer.signed.length, 0);
  const foreign = fixture({ ownership: { [`thumbs/${key}`]: otherOwner } });
  assert.equal((await foreign.get()).status, 403);
  assert.equal((await fixture().get({ key: 'unknown/photo.jpg' })).status, 403);
  assert.equal((await fixture({ readError: true }).get()).status, 503);
  assert.equal((await fixture({ redirect: 'https://attacker.invalid/photo.jpg' }).get()).status, 503);
});

test('stored URL consumers preserve exact legacy references while using authorized reads', () => {
  const r2 = { r2PresignedGetUrl: value => `https://r2-fixture.invalid/${value}`, r2KeyFromAnyUrl: () => '' };
  const storage = load('lib/storage-images.ts', { './r2-signed-urls': r2, '@/lib/photo-url': browser, '@/lib/legacy-storage-token': tokens, '@/lib/r2-media-token': r2Tokens });
  const privateMedia = load('lib/private-media-references.ts', { '@/lib/r2-signed-urls': r2, '@/lib/photo-url': browser, '@/lib/legacy-storage-token': tokens, '@/lib/r2-media-token': r2Tokens });
  const presented = storage.buildStoredMediaUrls({ storagePath: key, previewUrl: publicUrl, thumbnailUrl: publicUrl });
  assert.match(presented.previewUrl, /^\/api\/storage\/legacy-media\/thumbs\//);
  const legacySigned = storage.buildSignedMediaUrls({ storagePath: publicUrl, previewUrl: publicUrl }, { photographerId: owner });
  assert.equal(tokens.verifyLegacyStorageToken(new URL(legacySigned.previewUrl).searchParams.get('token'), reference), owner);
  assert.match(storage.buildSignedMediaUrls({ storagePath: publicUrl }).previewUrl, /^\/api\/storage\/legacy-media\/thumbs\//);
  assert.equal(privateMedia.durablePrivateMediaReference(publicUrl), publicUrl);
  assert.equal(privateMedia.signedPrivateMediaReference(publicUrl, 60), '');
  const signed = new URL(privateMedia.signedPrivateMediaReference(publicUrl, 60, owner));
  assert.equal(tokens.verifyLegacyStorageToken(signed.searchParams.get('token'), reference), owner);
  const deep = privateMedia.signPrivateMediaReferencesDeep({ cart: [{ preview: publicUrl }] }, 60, owner);
  assert.equal(tokens.verifyLegacyStorageToken(new URL(deep.cart[0].preview).searchParams.get('token'), reference), owner);
  const rows = privateMedia.signPhotoUrlRows([{ photo_url: publicUrl }], 60, owner);
  assert.equal(tokens.verifyLegacyStorageToken(new URL(rows[0].photo_url).searchParams.get('token'), reference), owner);
});

test('actual order receipts, studio notifications and gallery emails bind legacy photo links to the workflow owner', () => {
  const r2 = { r2PresignedGetUrl: value => `https://r2-fixture.invalid/${value}`, r2KeyFromAnyUrl: () => '' };
  const privateMedia = load('lib/private-media-references.ts', { '@/lib/r2-signed-urls': r2, '@/lib/photo-url': browser, '@/lib/legacy-storage-token': tokens, '@/lib/r2-media-token': r2Tokens });
  const orderDisplay = load('lib/order-display.ts');
  const receipt = load('lib/order-receipt-email.ts', { './private-media-references': privateMedia, './order-display': orderDisplay });
  const notification = load('lib/order-notification-email.ts', { './private-media-references': privateMedia, './order-display': orderDisplay });
  const galleryEmail = load('lib/event-gallery-email.ts', { '@/lib/private-media-references': privateMedia, '@/lib/event-gallery-settings': load('lib/event-gallery-settings.ts') });
  const input = { order: { id: project, total_cents: 1000 }, items: [{ sku: publicUrl, product_name: 'Portrait', quantity: 1, unit_price_cents: 1000 }],
    photographer: { id: owner, business_name: 'Fixture Studio', logo_url: publicUrl }, context: {}, dashboardUrl: 'https://gallery-fixture.invalid/dashboard' };
  for (const result of [receipt.buildOrderReceiptEmail(input), notification.buildOrderNotificationEmail(input),
    galleryEmail.buildGalleryShareEmail({ project: {id: project, cover_photo_url:publicUrl}, photographer:input.photographer, origin:env.NEXT_PUBLIC_SITE_URL })]) {
    const links = [...result.html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(match => match[1].replaceAll('&amp;','&')).filter(value=>value.includes('/api/storage/legacy-media/'));
    assert.ok(links.length, 'An actual email includes the legacy photo');
    for (const link of links) assert.equal(tokens.verifyLegacyStorageToken(new URL(link).searchParams.get('token'), reference), owner);
    assert.ok(!result.html.includes('/storage/v1/object/public/thumbs/'), 'The email no longer embeds an unauthenticated legacy photo URL');
  }
});

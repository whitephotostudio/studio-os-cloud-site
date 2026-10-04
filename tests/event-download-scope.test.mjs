import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = id(1), otherProjectId = id(2), albumA = id(3), albumB = id(4), lockedAlbum = id(5);
const a = id(10), b = id(11), locked = id(12), foreign = id(13);
const readyRoute = 'app/api/portal/event-download-ready/route.ts';
const legacyRoute = 'app/api/portal/event-downloads/route.ts';

function harness({ extras = {}, media, logs = [], collections, repeatPage = false, failMediaPage = null } = {}) {
  const writes = [], queries = [], fetched = [];
  const tables = {
    projects: [{ id: projectId, title: 'Fixture Event', workflow_type: 'event', status: 'active', email_required: false, access_mode: 'pin', access_pin: 'project-pin', photographer_id: null, gallery_settings: { extras: { freeDigitalRuleEnabled: true, showDownloadAllButton: true, freeDigitalAudience: 'gallery', freeDigitalDownloadLimit: 'unlimited', freeDigitalResolution: 'original', watermarkDownloads: false, includePrintRelease: false, allowClientFavoriteDownloads: true, favoriteDownloadsRequireAllDigitalsPurchase: false, ...extras } } }],
    collections: collections ?? [
      { id: albumA, project_id: projectId, title: 'Album A', kind: 'album', slug: 'album-a', access_mode: 'inherit_project', access_pin: null },
      { id: albumB, project_id: projectId, title: 'Album B', kind: 'album', slug: 'album-b', access_mode: 'public', access_pin: null },
      { id: lockedAlbum, project_id: projectId, title: 'Locked', kind: 'album', slug: 'guessable-slug', access_mode: 'private', access_pin: 'secret-pin' },
    ],
    media: media ?? [
      { id: a, project_id: projectId, collection_id: albumA, filename: 'a.jpg', storage_path: 'fixture/a.jpg' },
      { id: b, project_id: projectId, collection_id: albumB, filename: 'b.jpg', storage_path: 'fixture/b.jpg' },
      { id: locked, project_id: projectId, collection_id: lockedAlbum, filename: 'locked.jpg', storage_path: 'fixture/locked.jpg' },
      { id: foreign, project_id: otherProjectId, collection_id: albumA, filename: 'foreign.jpg', storage_path: 'fixture/foreign.jpg' },
    ],
    event_gallery_downloads: logs.map((row, index) => ({ id: id(20000 + index), project_id: projectId, viewer_email: 'viewer@example.test', download_type: 'gallery', ...row })),
    pre_release_emails: [], subjects: [], orders: [], packages: [],
  };
  const service = { from(table) {
    const filters = []; let range, cap, single = false, mutation = false;
    const record = { table, filters: [], range: null }; queries.push(record);
    const q = {
      select() { return q; },
      eq(key, value) { filters.push(row => row[key] === value); record.filters.push([key, value]); return q; },
      in(key, values) { filters.push(row => values.includes(row[key])); record.filters.push([key, values]); return q; },
      order() { return q; },
      range(from, to) { range = [from, to]; record.range = range; return q; },
      limit(value) { cap = value; return q; },
      maybeSingle() { single = true; return q; },
      insert(value) { mutation = true; writes.push({ table, value }); return q; },
      upsert(value) { mutation = true; writes.push({ table, value }); return q; },
      then(resolve, reject) {
        if (table === 'media' && range?.[0] === failMediaPage) return Promise.resolve({ data: null, error: { message: 'fixture read failed' } }).then(resolve, reject);
        let rows = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
        const count = rows.length;
        if (range) rows = rows.slice(repeatPage && table === 'media' ? 0 : range[0], repeatPage && table === 'media' ? range[1] - range[0] + 1 : range[1] + 1);
        rows = rows.slice(0, Math.min(cap ?? 1000, 1000));
        return Promise.resolve({ data: mutation ? null : single ? rows[0] ?? null : rows, error: null, count }).then(resolve, reject);
      },
    }; return q;
  } };
  class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }
  const cache = new Map();
  const stubs = {
    'next/server': { NextResponse },
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => service },
    '@/lib/rate-limit': { rateLimit: async () => ({ allowed: true }), getClientIp: () => 'fixture' },
    '@/lib/storage-images': { SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS: 21600, buildSignedMediaUrls: ({ storagePath }) => ({ originalUrl: `https://fixture.test/${storagePath}`, previewUrl: null, thumbnailUrl: null }), extractStoragePathFromSupabaseUrl: () => null },
    '@/lib/private-media-references': { signedPrivateMediaReference: value => value },
    '@/lib/package-profile-selection': { filterPackagesForProfile: value => value },
    '@/lib/subscription-gate': { hasActiveSubscription: () => false },
    '@/lib/checkout-tax': { applyCheckoutTaxFallbackToSettings: value => value },
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const js = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    vm.runInNewContext(js, { exports, Response, Request, URL, Buffer, TextEncoder, ReadableStream, AbortController, setTimeout, clearTimeout, console, process: { env: { EVENT_DOWNLOAD_TOKEN_SECRET: 'synthetic-test-secret' } },
      fetch: async url => { fetched.push(url); return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }); },
      require(name) { if (name in stubs) return stubs[name]; if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`); if (name.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name)) + '.ts'); return require(name); },
    }, { filename: file }); return exports;
  }
  const body = overrides => ({ projectId, email: 'viewer@example.test', pin: 'project-pin', collectionId: albumA, mediaIds: [a, b, locked, foreign], ...overrides });
  return { tables, queries, writes, fetched, load, body, async post(route, payload = body()) {
    const response = await load(route).POST(new Request('https://fixture.test/api', { method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' } }));
    return { status: response.status, body: await response.json() };
  }, async batch(token, json = false) {
    const response = await load('app/api/portal/event-download-batch/route.ts').GET({ nextUrl: new URL(`https://fixture.test/api?token=${encodeURIComponent(token)}${json ? '&format=json' : ''}`) });
    return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? await response.json() : new Uint8Array(await response.arrayBuffer()) };
  } };
}

test('selected album is enforced for gallery-wide free rules before creating ZIP tokens', async () => {
  const h = harness(); const result = await h.post(readyRoute);
  assert.equal(result.status, 200);
  const ids = result.body.manifest.batches.flatMap(batch => h.load('lib/event-gallery-download-tokens.ts').verifyEventGalleryBatchToken(batch.token).mediaIds);
  assert.deepEqual(ids, [a]);
  assert.equal(result.body.manifest.collectionName, 'Album A');
  assert.equal(h.writes.length, 0);
});

for (const downloadType of ['gallery', 'favorites']) test(`${downloadType} legacy downloads cannot authorize cross-album, locked, duplicate, or foreign-project IDs`, async () => {
  const h = harness(); const result = await h.post(legacyRoute, h.body({ mediaIds: [a, a, b, locked, foreign], downloadType }));
  assert.equal(result.status, 200); assert.deepEqual(result.body.allowedMediaIds, [a]);
  assert.equal(h.writes.at(-1).value.download_count, 1);
  assert.deepEqual([...h.writes.at(-1).value.media_ids], [a]);
});

test('All Photos is limited to accessible albums and a collection PIN stays within that collection', async () => {
  const h = harness();
  const all = await h.post(legacyRoute, h.body({ collectionId: null }));
  assert.deepEqual(all.body.allowedMediaIds, [a, b]);
  const scoped = await h.post(legacyRoute, h.body({ collectionId: null, pin: 'album-a' }));
  assert.deepEqual(scoped.body.allowedMediaIds, [a]);
  assert.equal((await h.post(legacyRoute, h.body({ pin: 'guessable-slug', collectionId: lockedAlbum, mediaIds: [locked] }))).status, 404);
  assert.deepEqual((await h.post(legacyRoute, h.body({ pin: 'secret-pin', collectionId: lockedAlbum, mediaIds: [locked] }))).body.allowedMediaIds, [locked]);
});

test('invalid or foreign album and entirely unauthorized media fail without download logs', async () => {
  for (const route of [readyRoute, legacyRoute]) {
    const h = harness();
    assert.equal((await h.post(route, h.body({ collectionId: 'invalid' }))).status, 400);
    assert.equal((await h.post(route, h.body({ collectionId: id(999) }))).status, 403);
    assert.equal((await h.post(route, h.body({ mediaIds: [b, locked, foreign] }))).status, 403);
    assert.equal(h.writes.length, 0);
  }
});

test('download PIN, person audience, album audience, and paid favorites gates remain required', async () => {
  for (const route of [readyRoute, legacyRoute]) {
    assert.equal((await harness({ extras: { downloadPinEnabled: true, downloadPin: 'download-secret' } }).post(route)).status, 403);
    assert.equal((await harness({ extras: { freeDigitalAudience: 'person', freeDigitalTargetEmail: 'someone-else@example.test' } }).post(route)).status, 403);
    const album = harness({ extras: { freeDigitalAudience: 'album' } });
    assert.equal((await album.post(route, album.body({ collectionId: null }))).status, 400);
  }
  const paid = harness({ extras: { favoriteDownloadsRequireAllDigitalsPurchase: true } });
  assert.equal((await paid.post(legacyRoute, paid.body({ downloadType: 'favorites' }))).status, 403);
  assert.equal(paid.writes.length, 0);
});

test('authorized album filtering precedes quota slicing, and every logged page contributes to quota', async () => {
  for (const route of [readyRoute, legacyRoute]) {
    const h = harness({ extras: { freeDigitalDownloadLimit: '1' } });
    const result = await h.post(route, h.body({ mediaIds: [b, locked, foreign, a] }));
    assert.equal(result.status, 200);
    const allowed = result.body.allowedMediaIds ?? result.body.manifest.batches.flatMap(batch => h.load('lib/event-gallery-download-tokens.ts').verifyEventGalleryBatchToken(batch.token).mediaIds);
    assert.deepEqual(allowed, [a]);
    const used = harness({ extras: { freeDigitalDownloadLimit: '1' }, logs: [...Array.from({ length: 1000 }, () => ({ download_count: 0 })), { download_count: 1 }] });
    const blocked = await used.post(route);
    assert.equal(blocked.status, 403); assert.equal(blocked.body.downloadsUsed, 1);
    assert.equal(used.writes.length, 0);
  }
});

test('1205 photos are loaded, scoped, and prepared without Supabase default1000 truncation', async () => {
  const media = Array.from({ length: 1205 }, (_, n) => ({ id: id(1000 + n), project_id: projectId, collection_id: albumA, filename: `a${n}.jpg`, storage_path: `fixture/a${n}.jpg` }));
  const h = harness({ media });
  const context = await h.post('app/api/portal/event-gallery-context/route.ts', h.body());
  assert.equal(context.status, 200); assert.equal(context.body.media.length, 1205);
  assert.deepEqual(context.body.collections.map(row => row.id), [albumA, albumB]);
  assert.equal('access_pin' in context.body.project, false);
  assert.equal(context.body.collections.some(row => 'access_pin' in row), false);
  const result = await h.post(readyRoute, h.body({ mediaIds: media.map(row => row.id) }));
  assert.equal(result.status, 200); assert.equal(result.body.manifest.photoCount, 1205);
  assert.equal(result.body.manifest.batches.flatMap(batch => h.load('lib/event-gallery-download-tokens.ts').verifyEventGalleryBatchToken(batch.token).mediaIds).length, 1205);
  assert.ok(h.queries.filter(q => q.table === 'media' && q.range).length >= 3);
});

test('context signs no separately locked album media and collection entry hides the project PIN', async () => {
  const h = harness();
  const context = await h.post('app/api/portal/event-gallery-context/route.ts', h.body());
  assert.equal(context.status, 200); assert.deepEqual(context.body.media.map(row => row.id), [a, b]);
  const privateContext = await h.post('app/api/portal/event-gallery-context/route.ts', h.body({ pin: 'secret-pin' }));
  assert.equal(privateContext.status, 200); assert.deepEqual(privateContext.body.media.map(row => row.id), [locked]);
  assert.equal('access_pin' in privateContext.body.project, false);
  assert.equal('access_pin' in privateContext.body.activeCollection, false);
});

test('gallery paging fails closed on repeated pages, partial read failures, or above5000 instead of exposing a partial All Photos', async () => {
  const media = Array.from({ length: 1100 }, (_, n) => ({ id: id(1000 + n), project_id: projectId, collection_id: albumA }));
  for (const params of [{ repeatPage: true }, { failMediaPage: 500 }]) {
    const h = harness({ media, ...params });
    const result = await h.post('app/api/portal/event-gallery-context/route.ts', h.body());
    assert.equal(result.status, 500); assert.equal(result.body.media, undefined);
  }
  const h = harness({ media: Array.from({ length: 5001 }, (_, n) => ({ id: id(1000 + n), project_id: projectId, collection_id: albumA })) });
  const result = await h.post('app/api/portal/event-gallery-context/route.ts', h.body());
  assert.equal(result.status, 413); assert.match(result.body.message, /5000/); assert.equal(result.body.media, undefined);
});

test('actual streamed album ZIP contains and logs only album photos', async () => {
  const h = harness(); const ready = await h.post(readyRoute);
  const batch = await h.batch(ready.body.manifest.batches[0].token);
  assert.equal(batch.status, 200);
  assert.deepEqual(h.fetched, ['https://fixture.test/fixture/a.jpg']);
  const zip = Buffer.from(batch.body).toString('latin1');
  assert.ok(zip.includes('a.jpg')); assert.equal(zip.includes('b.jpg'), false); assert.equal(zip.includes('locked.jpg'), false);
  assert.deepEqual([...h.writes.at(-1).value.media_ids], [a]);
});

test('prepared tokens stop media moved outside the selected album and revoke changed private album grants', async () => {
  const moved = harness(); const ready = await moved.post(readyRoute);
  moved.tables.media.find(row => row.id === a).collection_id = albumB;
  assert.equal((await moved.batch(ready.body.manifest.batches[0].token)).status, 403);
  assert.equal(moved.fetched.length, 0); assert.equal(moved.writes.length, 0);
  const privateAlbum = harness(); const privateReady = await privateAlbum.post(readyRoute, privateAlbum.body({ collectionId: lockedAlbum, pin: 'secret-pin', mediaIds: [locked] }));
  privateAlbum.tables.collections.find(row => row.id === lockedAlbum).access_pin = 'new-secret';
  assert.equal((await privateAlbum.batch(privateReady.body.manifest.batches[0].token)).status, 403);
  assert.equal(privateAlbum.fetched.length, 0);
});

test('legacy unscoped tokens ask to refresh and a signed token cannot cross project owner changes', async () => {
  const h = harness(); const ready = await h.post(readyRoute);
  const tokenApi = h.load('lib/event-gallery-download-tokens.ts');
  const payload = tokenApi.verifyEventGalleryBatchToken(ready.body.manifest.batches[0].token);
  delete payload.collectionIds; delete payload.collectionGrants;
  assert.equal((await h.batch(tokenApi.createEventGalleryBatchToken(payload), true)).status, 409);
  h.tables.projects[0].photographer_id = id(998);
  assert.equal((await h.batch(ready.body.manifest.batches[0].token)).status, 403);
  assert.equal(h.fetched.length, 0);
});

test('a project PIN change revokes prepared downloads without exposing PINs in tokens', async () => {
  const h = harness(); const ready = await h.post(readyRoute);
  const token = ready.body.manifest.batches[0].token;
  const payloadJson = Buffer.from(token.split('.')[0], 'base64url').toString('utf8');
  assert.equal(payloadJson.includes('project-pin'), false); assert.equal(payloadJson.includes('secret-pin'), false);
  h.tables.projects[0].access_pin = 'replacement-project-pin';
  assert.equal((await h.batch(token)).status, 403);
  assert.equal(h.fetched.length, 0); assert.equal(h.writes.length, 0);
});

test('valid paid favorite access and configured resolution/watermark/print release keep the selected scope', async () => {
  const paid = harness({ extras: { favoriteDownloadsRequireAllDigitalsPurchase: true } });
  paid.tables.orders.push({ project_id: projectId, package_id: null, package_name: 'All Digitals', status: 'paid', parent_email: 'viewer@example.test', customer_email: null });
  const favorite = await paid.post(legacyRoute, paid.body({ downloadType: 'favorites' }));
  assert.equal(favorite.status, 200); assert.deepEqual(favorite.body.allowedMediaIds, [a]);
  const h = harness({ extras: { freeDigitalAudience: 'person', freeDigitalTargetEmail: 'viewer@example.test', downloadPinEnabled: true, downloadPin: 'download-pin', freeDigitalResolution: 'web', watermarkDownloads: true, includePrintRelease: true } });
  const ready = await h.post(readyRoute, h.body({ downloadPin: 'download-pin' }));
  assert.equal(ready.status, 200);
  const token = h.load('lib/event-gallery-download-tokens.ts').verifyEventGalleryBatchToken(ready.body.manifest.batches[0].token);
  assert.deepEqual([...token.mediaIds], [a]); assert.equal(token.resolution, 'web'); assert.equal(token.applyWatermark, true); assert.equal(token.includePrintRelease, true);
  const disabled = harness({ extras: { freeDigitalRuleEnabled: false, allowClientFavoriteDownloads: false } });
  assert.equal((await disabled.post(readyRoute)).status, 403);
  assert.equal((await disabled.post(legacyRoute, disabled.body({ downloadType: 'favorites' }))).status, 403);
  assert.equal(disabled.writes.length, 0);
});

test('rotating a public album entry slug denies fresh preparation and its previously prepared ZIP', async () => {
  const h = harness();
  const body = h.body({ pin: 'album-b', collectionId: albumB, mediaIds: [b] });
  const ready = await h.post(readyRoute, body);
  assert.equal(ready.status, 200);
  h.tables.collections.find(row => row.id === albumB).slug = 'rotated-album-b';
  assert.equal((await h.post(readyRoute, body)).status, 404);
  assert.equal((await h.batch(ready.body.manifest.batches[0].token)).status, 403);
  assert.equal(h.fetched.length, 0); assert.equal(h.writes.length, 0);
});

test('removing an invitation denies fresh preparation and its previously prepared ZIP before any file fetch', async () => {
  const h = harness();
  h.tables.projects[0].email_required = true;
  h.tables.pre_release_emails.push(
    { id: id(100), project_id: projectId, email: 'viewer@example.test' },
    { id: id(101), project_id: projectId, email: 'other@example.test' },
  );
  const ready = await h.post(readyRoute);
  assert.equal(ready.status, 200);
  h.tables.pre_release_emails.shift();
  assert.equal((await h.post(readyRoute)).status, 403);
  assert.equal((await h.batch(ready.body.manifest.batches[0].token)).status, 403);
  assert.equal(h.fetched.length, 0); assert.equal(h.writes.length, 0);
});

test('current invited, empty-list, and email-not-required policies keep valid prepared ZIPs usable', async () => {
  for (const policy of ['invited', 'empty-list', 'email-not-required']) {
    const h = harness();
    h.tables.projects[0].email_required = policy !== 'email-not-required';
    if (policy !== 'empty-list') h.tables.pre_release_emails.push({
      id: id(100), project_id: projectId, email: policy === 'invited' ? 'viewer@example.test' : 'other@example.test',
    });
    const ready = await h.post(readyRoute);
    assert.equal(ready.status, 200, policy);
    assert.equal((await h.batch(ready.body.manifest.batches[0].token)).status, 200, policy);
    assert.equal(h.fetched.length, 1, policy);
  }
});

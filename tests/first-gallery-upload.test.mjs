import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import sharp from 'sharp';
import { createRequire } from 'node:module';
import { hasSeenStudioWelcome, markStudioWelcomeSeen } from '../lib/studio-welcome-state.ts';

const albumPage = 'app/dashboard/projects/[id]/albums/[albumId]/page.tsx';
const source = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const transpile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const quiet = { error() {}, warn() {} };
const require = createRequire(import.meta.url);

function uploadClient(fetch) {
  const context = { fetch, AbortSignal, exports: {}, console: quiet, setTimeout, clearTimeout };
  vm.runInNewContext(transpile(source('lib/project-photo-upload-client.ts')), context);
  return context.exports;
}

test('a full-resolution 12MB album photo uses owned JSON authorization then direct R2 PUT', async () => {
  const calls = [], key = 'projects/p/albums/a/photo.jpg';
  const client = uploadClient(async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? Response.json({ ok: true, key, url: 'https://storage.example.test/upload', headers: { 'content-type': 'image/jpeg' } })
      : new Response(null, { status: 200 });
  });
  const file = new File([new Uint8Array(12 * 1024 * 1024)], 'photo.JPG', { type: 'image/jpeg' });
  const result = await client.uploadProjectPhotoToR2(file, key, 'session-token');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, '/api/dashboard/r2-access');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer session-token');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.contentLength, file.size);
  assert.equal(body.key, key);
  assert.equal(body.action, 'sign-upload');
  assert.equal(calls[1].options.method, 'PUT');
  assert.equal(calls[1].options.body, file);
  assert.equal(calls[1].options.credentials, 'omit');
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.equal(result.key, key);
});

test('session, MFA, agreement and storage failures remain actionable and never show success', async () => {
  const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });
  for (const [status, body, message] of [
    [401, {}, /session has expired/],
    [403, { error: 'Complete two-step verification before accessing photos.' }, /two-step/],
    [403, { error: 'Accept the current agreement.' }, /agreement/],
    [503, { error: 'Photo storage is unavailable.' }, /unavailable/],
  ]) {
    let requests = 0;
    const client = uploadClient(async () => { ++requests; return Response.json(body, { status }); });
    await assert.rejects(client.uploadProjectPhotoToR2(file, 'key', 'token'), message);
    assert.equal(requests, 1);
  }
  const missingSession = uploadClient(() => assert.fail('No request without session'));
  await assert.rejects(missingSession.uploadProjectPhotoToR2(file, 'key', ''), /session has expired/);
  const wrongTicket = uploadClient(async () => Response.json({ ok: true, key: 'another/key', url: 'https://example.test' }));
  await assert.rejects(wrongTicket.uploadProjectPhotoToR2(file, 'key', 'token'), /valid upload link/);
  let requests = 0;
  const network = uploadClient(async () => {
    if (++requests === 1) return Response.json({ ok: true, key: 'key', url: 'https://storage.example.test' });
    throw new Error('CORS or connection error');
  });
  await assert.rejects(network.uploadProjectPhotoToR2(file, 'key', 'token'), /storage could not be reached/);
});

test('folder MIME fallback accepts real photo extensions and rejects empty, RAW and oversized files before upload', () => {
  const client = uploadClient(() => assert.fail('Validation needs no requests'));
  assert.throws(() => client.projectPhotoContentType({ name: 'shot.HEIC', type: '', size: 8_000_000 }), /HEIC files as JPEG/);
  assert.equal(client.projectPhotoContentType({ name: 'shot.jpg', type: 'application/octet-stream', size: 8 }), 'image/jpeg');
  assert.throws(() => client.projectPhotoContentType({ name: 'shot.CR3', type: '', size: 8 }), /Export RAW/);
  assert.throws(() => client.projectPhotoContentType({ name: 'shot.jpg', type: 'image/jpeg', size: 0 }), /empty/);
  assert.throws(() => client.projectPhotoContentType({ name: 'shot.jpg', type: 'image/jpeg', size: client.PROJECT_PHOTO_MAX_BYTES + 1 }), /250 MB/);
});

function functionSource(name) {
  const file = ts.createSourceFile(albumPage, source(albumPage), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(found, name);
  return found;
}

function albumHarness({ failedStorageFile, lostSaveResponse, unconfirmedSave = false, failPreviewOnce = false } = {}) {
  const state = { media: [], failures: [], session: null, error: '' }, uploads = [], records = new Map();
  let storageFailed = false, saveResponseLost = false, generatedId = 0, previewFailed = false;
  const context = {
    exports: {}, console: quiet, Date, Math, Map, Set, Error, AbortSignal,
    crypto: { randomUUID: () => `fixture-media-${++generatedId}` },
    projectId: 'project', albumId: 'album', album: { id: 'album' }, media: [], uploading: false,
    uploadResetTimeoutRef: { current: null }, pendingPhotoRecords: { current: new Map() },
    uploadedPhotoObjects: { current: new Map() },
    withPhotoUploadTimeout: promise => promise,
    setUploading() {}, setUploadPreview() {}, scheduleUploadReset() {},
    setError(value) { state.error = value; },
    setUploadFailures(value) { state.failures = value; },
    setUploadSession(value) { state.session = typeof value === 'function' ? value(state.session) : value; },
    setMedia(value) { state.media = typeof value === 'function' ? value(state.media) : value; context.media = state.media; },
    buildStoredMediaUrls: ({ storagePath }) => ({ originalUrl: '/api/r2/img/' + storagePath }),
    generateThumbnails: async key => {
      if (failPreviewOnce && !previewFailed) { previewFailed = true; throw new Error('Preview generation timed out'); }
      return { previewKey: key + '_preview.jpg', thumbnailKey: key + '_thumbnail.jpg' };
    },
    uploadProjectPhotoToR2: async (file, key) => {
      uploads.push(file.name);
      if (file.name === failedStorageFile && !storageFailed) { storageFailed = true; throw new Error('Storage connection lost. Retry.'); }
      return { key, contentType: 'image/jpeg' };
    },
    supabase: {
      auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
      from(table) {
        assert.equal(table, 'media');
        let insert, filters = [];
        const q = {
          select() { return q; }, eq(key, value) { filters.push([key, value]); return q; },
          order() { return q; }, limit() { return q; }, abortSignal() { return q; },
          maybeSingle: async () => ({ data: null, error: null }),
          insert(value) { insert = value; return q; },
          async single() {
            if (!insert) return { data: [...records.values()].find(row => filters.every(([key, value]) => row[key] === value)) ?? null, error: null };
            if (unconfirmedSave) return { data: null, error: null };
            if (records.has(insert.id)) return { data: null, error: { code: '23505', message: 'duplicate primary key' } };
            records.set(insert.id, { ...insert });
            if (insert.filename === lostSaveResponse && !saveResponseLost) { saveResponseLost = true; return { data: null, error: { message: 'Database response lost' } }; }
            return { data: { ...insert }, error: null };
          },
        };
        return q;
      },
    },
  };
  vm.runInNewContext(transpile(['clean', 'shortFileName', 'uploadFiles'].map(functionSource).join('\n') + '\nexports.uploadFiles = uploadFiles;'), context);
  return { ...context.exports, state, uploads, records };
}

test('a partial batch preserves successes and retry uploads only the failed file', async () => {
  const app = albumHarness({ failedStorageFile: 'bad.jpg' });
  const files = [new File(['a'], 'good.jpg'), new File(['b'], 'bad.jpg')];
  await app.uploadFiles(files);
  assert.equal(app.state.media.length, 1);
  assert.equal(app.state.failures.length, 1);
  assert.match(app.state.failures[0].message, /Storage connection lost/);
  assert.equal(app.state.session.completed, 1);
  await app.uploadFiles(app.state.failures.map(({ file }) => file));
  assert.deepEqual(app.uploads, ['good.jpg', 'bad.jpg', 'bad.jpg']);
  assert.equal(app.state.media.length, 2);
  assert.equal(app.state.failures.length, 0);
});

test('lost database save responses retry the same record without duplicate PUT or media', async () => {
  const app = albumHarness({ lostSaveResponse: 'photo.jpg' });
  await app.uploadFiles([new File(['a'], 'photo.jpg')]);
  assert.equal(app.state.media.length, 0);
  assert.equal(app.records.size, 1);
  await app.uploadFiles(app.state.failures.map(({ file }) => file));
  assert.deepEqual(app.uploads, ['photo.jpg']);
  assert.equal(app.records.size, 1);
  assert.equal(app.state.media.length, 1);
  assert.equal(app.state.failures.length, 0);
});

test('an unconfirmed save never invents a successful client-only photo', async () => {
  const app = albumHarness({ unconfirmedSave: true });
  await app.uploadFiles([new File(['a'], 'photo.jpg')]);
  assert.equal(app.state.media.length, 0);
  assert.equal(app.state.session.completed, 0);
  assert.match(app.state.failures[0].message, /gallery record was not confirmed/);
});

test('preview failure preserves the original and retries processing without duplicate PUT', async () => {
  const app = albumHarness({ failPreviewOnce: true });
  await app.uploadFiles([new File(['a'], 'photo.jpg')]);
  assert.equal(app.state.media.length, 0);
  assert.equal(app.records.size, 0);
  assert.match(app.state.failures[0].message, /Preview generation timed out/);
  await app.uploadFiles(app.state.failures.map(({ file }) => file));
  assert.deepEqual(app.uploads, ['photo.jpg']);
  assert.equal(app.records.size, 1);
  assert.equal(app.state.media.length, 1);
});

test('a hung sign-in check settles with retry guidance instead of leaving Upload busy forever', async () => {
  const client = uploadClient(() => assert.fail('No upload request'));
  await assert.rejects(client.withPhotoUploadTimeout(new Promise(() => {}), 5), /sign-in took too long/);
});

test('strict album preview generation reports invalid images and provider failure instead of recording an invisible photo', async () => {
  const key = 'projects/project/albums/album/photo.jpg';
  for (const response of [
    Response.json({ previewKey: key, thumbnailKey: key }),
    Response.json({ error: 'Complete two-step verification.' }, { status: 403 }),
  ]) {
    const context = { fetch: async () => response, AbortSignal, Error, exports: {}, console: quiet };
    vm.runInNewContext(transpile(source('lib/generate-thumbnails-client.ts')), context);
    await assert.rejects(context.exports.generateThumbnails(key, 'token', true), /preview could not be created|two-step/);
  }
});

test('camera EXIF rotation is applied before both thumbnail sizes are generated', async () => {
  const image = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#e80000' } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const uploaded = [];
  const q = { select() { return q; }, eq() { return q; }, maybeSingle: async () => ({ data: { id: 'photographer' }, error: null }) };
  const stubs = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/dashboard-auth': { resolveDashboardAuth: async () => ({ user: { id: 'user' } }), createDashboardServiceClient: () => ({ from: () => q }) },
    '@/lib/require-agreement': { guardAgreement: async () => ({ ok: true }) },
    '@/lib/api-validation': { parseJson: async request => ({ ok: true, data: await request.json() }) },
    '@/lib/upload-ownership': { assertKeyOwnedByPhotographer: async () => ({ ok: true }) },
    '@/lib/r2': { r2Download: async () => image, r2Upload: async (key, bytes) => { uploaded.push(bytes); return key; } },
    sharp: { default: sharp },
  };
  const context = { exports: {}, Buffer, Response, console: quiet, require: name => stubs[name] ?? require(name) };
  vm.runInNewContext(transpile(source('app/api/dashboard/generate-thumbnails/route.ts')), context);
  const response = await context.exports.POST(new Request('https://fixture.test/api', { method: 'POST', body: JSON.stringify({ storagePath: 'projects/p/albums/a/portrait.jpg' }) }));
  assert.equal(response.status, 200);
  assert.equal(uploaded.length, 2);
  for (const bytes of uploaded) {
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.width, 20);
    assert.equal(metadata.height, 40);
    assert.equal(metadata.orientation, undefined);
  }
});

test('welcome dismissal is isolated between photographer accounts and private storage failures do not block onboarding', () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  markStudioWelcomeSeen('studio-a', '2.0', storage);
  assert.equal(hasSeenStudioWelcome('studio-a', '2.0', storage), true);
  assert.equal(hasSeenStudioWelcome('studio-b', '2.0', storage), false);
  assert.equal(hasSeenStudioWelcome('studio-a', '2.1', storage), false);
  const blocked = { getItem() { throw new Error('Storage denied'); }, setItem() { throw new Error('Storage denied'); } };
  assert.equal(hasSeenStudioWelcome('studio-a', '2.0', blocked), false);
  assert.doesNotThrow(() => markStudioWelcomeSeen('studio-a', '2.0', blocked));
});

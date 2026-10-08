import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import sharp from 'sharp';
import ts from 'typescript';
import { R2StagingPreviewVerificationError, verifyR2StagingPreview } from '../scripts/verify-r2-staging-preview.mjs';

const env = { STUDIO_R2_STAGING_PREVIEW_VERIFY: '1', VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'codex/credit-system-audit-20260929', R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_ACCESS_KEY_ID: 'private-access-fixture', R2_SECRET_ACCESS_KEY: 'private-secret-fixture', R2_BUCKET_NAME: 'private-preview-fixture' };
const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004'];
const secretFailure = `${env.R2_ACCESS_KEY_ID} ${env.R2_SECRET_ACCESS_KEY} https://private.invalid/?secret=hidden`;
const signerSource = readFileSync(new URL('../lib/r2-signed-urls.ts', import.meta.url), 'utf8');
const signerCode = ts.transpileModule(signerSource, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
function signerFor(credentials) {
  const exports = {};
  new Function('require', 'exports', 'process', signerCode)(createRequire(import.meta.url), exports, { env: credentials });
  return exports.r2PresignedPutUrl;
}
function safeError(error) {
  assert.ok(error instanceof R2StagingPreviewVerificationError);
  for (const secret of [env.R2_ACCOUNT_ID, env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY,
    env.R2_BUCKET_NAME, 'https://', 'private.invalid', 'hidden', ...ids]) assert.ok(!error.message.includes(secret));
  return true;
}
function safeLog(h) {
  assert.equal(h.logs.length, 1);
  for (const secret of [env.R2_ACCOUNT_ID, env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY,
    env.R2_BUCKET_NAME, 'https://', 'private.invalid', 'hidden', 'credit-staging/', ...ids]) assert.ok(!h.logs[0].includes(secret));
  return JSON.parse(h.logs[0]);
}
function harness(options = {}) {
  const calls = [], downloads = [], heads = [], removals = [], signed = [], logs = [], timeouts = [], stored = new Map();
  let loaded = 0, closed = 0, nextId = 0;
  const runtime = {
    signPut(key, expires, signingOptions) {
      signed.push({ key, expires, options: signingOptions });
      const ticket = signerFor(env)(key, expires, signingOptions);
      return options.ticket ? options.ticket(ticket, key) : ticket;
    },
    async download(key) {
      downloads.push(key);
      if (options.downloadFailure) throw new Error(secretFailure);
      return options.recovered ?? Buffer.from(stored.get(key) ?? []);
    },
    async exists(key) {
      heads.push(key);
      if (options.headFailure) throw new Error(secretFailure);
      return options.rejectStored && calls.length > 1 ? true : stored.has(key);
    },
    async remove(key) {
      removals.push(key);
      if (options.removeFailure && removals.length === options.removeFailure) throw new Error(secretFailure);
      stored.delete(key);
    },
    close() { closed++; if (options.closeFailure) throw new Error(secretFailure); },
  };
  const h = { calls, downloads, heads, removals, signed, logs, timeouts, stored, runtime,
    get loaded() { return loaded; }, get closed() { return closed; }, dependencies: {
      imageProcessor: sharp,
      randomId: () => ids[nextId++],
      runtimeLoader: async (credentials) => {
        loaded++;
        assert.equal(credentials.R2_ACCOUNT_ID, env.R2_ACCOUNT_ID);
        if (options.loadFailure) throw new Error(secretFailure);
        return runtime;
      },
      fetcher: async (url, request) => {
        calls.push({ url, request });
        assert.equal(url.protocol, 'https:');
        assert.equal(url.host, `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
        assert.equal(request.method, 'PUT');
        assert.equal(request.redirect, 'error');
        assert.ok(request.signal instanceof AbortSignal);
        assert.equal(request.headers['cache-control'], 'private, no-store');
        assert.equal(request.headers['content-length'], String(request.body.length));
        assert.ok(!Object.keys(request.headers).some(name => /authorization/i.test(name)));
        const key = url.pathname.split('/').slice(2).map(decodeURIComponent).join('/');
        assert.match(key, /^credit-staging\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.png$/);
        assert.equal(key, signed.at(-1).key);
        const ticket = signed.at(-1).options;
        const valid = request.headers['content-type'] === ticket.contentType && request.body.length === ticket.contentLength;
        let status = valid ? 200 : 403;
        if (options.status !== undefined) status = typeof options.status === 'function' ? options.status(calls.length, valid) : options.status;
        if (status >= 200 && status < 300) stored.set(key, Buffer.from(request.body));
        if (options.fetchFailure) throw new Error(secretFailure);
        return { status, body: { cancel: async () => {} },
          text: () => assert.fail('must never parse storage bodies'), json: () => assert.fail('must never parse storage bodies') };
      },
      timeoutSignal: milliseconds => { timeouts.push(milliseconds); return AbortSignal.timeout(milliseconds); },
      report: line => logs.push(line),
    } };
  return h;
}

test('R2 staging verifier is off by default before credentials, image preparation or storage are used', async () => {
  for (const flags of [{}, { STUDIO_R2_STAGING_PREVIEW_VERIFY: '0' }, { STUDIO_R2_STAGING_PREVIEW_VERIFY: 'true' }]) {
    const h = harness();
    const guarded = new Proxy(flags, { get(target, key) {
      assert.equal(key, 'STUDIO_R2_STAGING_PREVIEW_VERIFY', 'disabled check may not inspect sensitive environment values');
      return target[key];
    } });
    assert.deepEqual(await verifyR2StagingPreview(guarded, h.dependencies), { enabled: false });
    assert.equal(h.loaded, 0);
    assert.equal(h.calls.length, 0);
    assert.equal(h.logs.length, 0);
  }
});

test('production, development and every other Git ref are refused before storage initialization', async () => {
  for (const flags of [{ VERCEL_ENV: 'production' }, { VERCEL_ENV: 'development' }, { VERCEL_ENV: '' },
    { VERCEL_GIT_COMMIT_REF: 'main' }, { VERCEL_GIT_COMMIT_REF: `${env.VERCEL_GIT_COMMIT_REF}-extra` }]) {
    const h = harness();
    await assert.rejects(verifyR2StagingPreview({ ...env, ...flags }, h.dependencies), safeError);
    assert.equal(h.loaded, 0);
    assert.equal(h.calls.length, 0);
    assert.equal(h.logs.length, 0);
  }
});

test('missing, masked and whitespace R2 credentials or invalid endpoints fail closed without storage calls', async () => {
  for (const flags of [{ R2_ACCOUNT_ID: '' }, { R2_ACCESS_KEY_ID: '[SENSITIVE]' }, { R2_SECRET_ACCESS_KEY: 'a b' },
    { R2_ACCOUNT_ID: 'untrusted.invalid' }, { R2_BUCKET_NAME: '../other-object' }]) {
    const h = harness();
    await assert.rejects(verifyR2StagingPreview({ ...env, ...flags }, h.dependencies), safeError);
    assert.equal(h.loaded, 0);
    assert.equal(h.calls.length, 0);
  }
});

test('only fresh unique UUID staging identities may be used', async () => {
  for (const randomId of [() => ids[0], () => 'existing-account', () => '00000000-0000-1000-8000-000000000001']) {
    const h = harness();
    await assert.rejects(verifyR2StagingPreview(env, { ...h.dependencies, randomId }), safeError);
    assert.equal(h.loaded, 0);
    assert.equal(h.calls.length, 0);
  }
});

test('actual production signer binds full real alpha PNG length/type and verifies readback plus both rejected tamper objects', async () => {
  const h = harness();
  const result = await verifyR2StagingPreview(env, h.dependencies);
  assert.equal(h.loaded, 1);
  assert.equal(h.calls.length, 3);
  assert.equal(h.downloads.length, 1);
  assert.equal(h.closed, 1);
  assert.equal(h.stored.size, 0);
  assert.deepEqual(h.signed.map(({ key }) => key), ids.slice(1).map(id => `credit-staging/${ids[0]}/${id}.png`));
  for (const ticket of h.signed) {
    assert.equal(ticket.expires, 120);
    assert.deepEqual(ticket.options, { allowCutoutStaging: true, contentLength: result.sampleBytes, contentType: 'image/png' });
  }
  assert.deepEqual(h.timeouts, [20000, 20000, 20000]);
  const png = h.calls[0].request.body;
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 2);
  assert.equal(metadata.height, 2);
  assert.equal(metadata.hasAlpha, true);
  const alpha = (await sharp(png).stats()).channels.at(-1);
  assert.equal(alpha.min, 0);
  assert.equal(alpha.max, 255);
  assert.equal(h.calls[1].request.headers['content-type'], 'image/jpeg');
  assert.equal(h.calls[2].request.body.length, png.length + 1);
  assert.deepEqual(result, { enabled: true, sampleBytes: png.length, validPutStatus: 200, readbackSha256Matches: true,
    typeTamperStatus: 403, sizeTamperStatus: 403, tamperObjectsAbsent: 2, cleanupAttempts: 3,
    cleanupDeleted: 3, cleanupConfirmedAbsent: 3 });
  assert.deepEqual(safeLog(h), { check: 'r2-staging-preview', ok: true, ...result });
});

test('transport exceptions never expose private details or retry uncertain PUTs, and the possible object is removed', async () => {
  const h = harness({ fetchFailure: true });
  await assert.rejects(verifyR2StagingPreview(env, h.dependencies), safeError);
  assert.equal(h.calls.length, 1);
  assert.equal(h.removals.length, 1);
  assert.equal(h.stored.size, 0);
  assert.equal(h.closed, 1);
  assert.equal(safeLog(h).ok, false);
});

test('rejected valid uploads never read storage error bodies and still verify cleanup', async () => {
  for (const status of [401, 403, 429, 500]) {
    const h = harness({ status });
    await assert.rejects(verifyR2StagingPreview(env, h.dependencies), error => safeError(error) && error.message.includes(`HTTP ${status}`));
    assert.equal(h.calls.length, 1);
    assert.equal(h.downloads.length, 0);
    assert.equal(h.removals.length, 1);
    assert.equal(safeLog(h).validPutStatus, status);
  }
});

test('full SHA readback mismatch, oversized readback and SDK read exceptions fail with cleanup', async () => {
  for (const options of [{ recovered: Buffer.from('wrong contents') }, { recovered: Buffer.alloc(4097) }, { downloadFailure: true }]) {
    const h = harness(options);
    await assert.rejects(verifyR2StagingPreview(env, h.dependencies), safeError);
    assert.equal(h.calls.length, 1);
    assert.equal(h.downloads.length, 1);
    assert.equal(h.removals.length, 1);
    assert.equal(h.stored.size, 0);
    assert.equal(safeLog(h).readbackSha256Matches, false);
  }
});

test('a tampered type or size unexpectedly accepted by storage fails and removes every touched object', async () => {
  for (const index of [2, 3]) {
    const h = harness({ status: (count, valid) => count === index ? 200 : valid ? 200 : 403 });
    await assert.rejects(verifyR2StagingPreview(env, h.dependencies), error => safeError(error) && /not rejected/.test(error.message));
    assert.equal(h.calls.length, index);
    assert.equal(h.removals.length, index);
    assert.equal(h.stored.size, 0);
    assert.equal(safeLog(h).ok, false);
  }
});

test('a 403 response is insufficient when a rejected upload leaves an object present', async () => {
  const h = harness({ rejectStored: true });
  await assert.rejects(verifyR2StagingPreview(env, h.dependencies), safeError);
  assert.equal(h.calls.length, 2);
  assert.equal(h.removals.length, 2);
  assert.equal(safeLog(h).ok, false);
});

test('cleanup attempts continue for every object even after one delete fails and SDK always closes', async () => {
  const h = harness({ removeFailure: 1 });
  await assert.rejects(verifyR2StagingPreview(env, h.dependencies), error => safeError(error) && /cleanup/.test(error.message));
  assert.equal(h.removals.length, 3);
  assert.equal(h.closed, 1);
  const log = safeLog(h);
  assert.equal(log.cleanupAttempts, 3);
  assert.equal(log.cleanupDeleted, 2);
  assert.equal(log.cleanupConfirmedAbsent, 2);
  assert.equal(log.ok, false);
});

test('SDK absence or close failures cannot make an unverifiable cleanup succeed', async () => {
  for (const options of [{ headFailure: true }, { closeFailure: true }]) {
    const h = harness(options);
    await assert.rejects(verifyR2StagingPreview(env, h.dependencies), error => safeError(error) && /cleanup/.test(error.message));
    assert.ok(h.removals.length > 0);
    assert.equal(h.closed, 1);
    assert.equal(safeLog(h).ok, false);
  }
});

test('signer destination must name only the expected private R2 object and signed headers', async () => {
  for (const ticket of [url => url.replace('.r2.cloudflarestorage.com', '.invalid'),
    url => url.replace('credit-staging/', 'projects/'), url => url.replace('content-length%3Bcontent-type%3Bhost', 'host'),
    url => url.replace('X-Amz-Expires=120', 'X-Amz-Expires=900'), () => 'not-a-url']) {
    const h = harness({ ticket });
    await assert.rejects(verifyR2StagingPreview(env, h.dependencies), safeError);
    assert.equal(h.calls.length, 0);
    assert.equal(h.removals.length, 0);
    assert.equal(h.closed, 1);
    assert.equal(safeLog(h).ok, false);
  }
});

test('runtime failures and malformed synthetic images disclose only fixed local failure messages', async () => {
  const h = harness({ loadFailure: true });
  await assert.rejects(verifyR2StagingPreview(env, h.dependencies), safeError);
  assert.equal(h.calls.length, 0);
  assert.equal(safeLog(h).ok, false);
  const bad = harness();
  await assert.rejects(verifyR2StagingPreview(env, { ...bad.dependencies, imageProcessor: () => { throw new Error(secretFailure); } }), safeError);
  assert.equal(bad.loaded, 0);
  assert.equal(safeLog(bad).sampleBytes, 0);
});

test('build wiring appends the default-no-op R2 verifier after existing payment and provider guards', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.prebuild, 'node scripts/verify-payment-release.mjs && node scripts/verify-photoroom-preview.mjs && node scripts/verify-r2-staging-preview.mjs && node scripts/verify-legacy-cutouts-preview.mjs && node scripts/verify-order-production-release.mjs && node scripts/verify-cart-reminder-release.mjs');
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import sharp from 'sharp';
import { PhotoroomPreviewVerificationError, verifyPhotoroomPreview } from '../scripts/verify-photoroom-preview.mjs';

const env = { STUDIO_PHOTOROOM_PREVIEW_VERIFY: '1', VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'codex/credit-system-audit-20260929', PHOTOROOM_API_KEY: 'prod_private_fixture',
  SUPABASE_SERVICE_ROLE_KEY: 'never-use-db', STRIPE_SECRET_KEY: 'never-use-stripe', R2_SECRET_ACCESS_KEY: 'never-use-r2' };
const sampleEnv = { ...env, STUDIO_PHOTOROOM_SAMPLE_VERIFY: '1' };
const account = () => Response.json({ images: { available: 10, subscription: 100 },
  secret: env.PHOTOROOM_API_KEY, url: 'https://private.example.invalid/image?secret=hidden' });
const input = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#123456' } }).png().toBuffer();
async function rgbaPng({ width = 32, height = 24, opaque = false, empty = false } = {}) {
  const pixels = Buffer.alloc(width * height * 4, 255);
  if (!opaque) pixels[3] = 0;
  if (empty) for (let i = 3; i < pixels.length; i += 4) pixels[i] = 0;
  return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
const transparent = await rgbaPng();
function harness({ response, sampleReader, fetchFailure } = {}) {
  const calls = [], logs = [], timeouts = [];
  return { calls, logs, timeouts, dependencies: {
    fetcher: async (url, options) => {
      calls.push({ url, options });
      assert.ok(['https://image-api.photoroom.com/v2/account', 'https://sdk.photoroom.com/v1/segment'].includes(url),
        'no Supabase, Stripe, R2 or arbitrary URL may be requested');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers['x-api-key'], env.PHOTOROOM_API_KEY);
      assert.ok(options.signal instanceof AbortSignal);
      if (fetchFailure) throw new Error(`${env.PHOTOROOM_API_KEY} ${fetchFailure}`);
      return url.endsWith('/account') ? account() : response?.() ?? new Response(transparent, { headers: { 'content-type': 'image/png' } });
    },
    sampleReader: sampleReader ?? (async (url) => {
      assert.equal(url.pathname.split('/').at(-1), 'portrait-gallery-cover-generated.png');
      return input;
    }),
    imageProcessor: sharp,
    timeoutSignal: (milliseconds) => { timeouts.push(milliseconds); return AbortSignal.timeout(milliseconds); },
    report: (line) => logs.push(line),
  } };
}
function safeError(error) {
  assert.ok(error instanceof PhotoroomPreviewVerificationError);
  assert.ok(!error.message.includes(env.PHOTOROOM_API_KEY));
  assert.ok(!error.message.includes('private.example.invalid'));
  assert.ok(!error.message.includes('hidden'));
  return true;
}

test('Photoroom Preview verifier is completely off by default, including a sample flag alone', async () => {
  for (const flags of [{}, { STUDIO_PHOTOROOM_PREVIEW_VERIFY: '0' }, { STUDIO_PHOTOROOM_SAMPLE_VERIFY: '1' }]) {
    const result = await verifyPhotoroomPreview(flags, {
      fetcher: () => assert.fail('must not request anything'), sampleReader: () => assert.fail('must not read a sample'),
      report: () => assert.fail('must not log account information'),
    });
    assert.deepEqual(result, { enabled: false });
  }
});

test('production, other environments and wrong branches are refused before credentials or network use', async () => {
  for (const flags of [{ VERCEL_ENV: 'production' }, { VERCEL_ENV: 'development' }, { VERCEL_ENV: '' },
    { VERCEL_GIT_COMMIT_REF: 'main' }, { VERCEL_GIT_COMMIT_REF: 'codex/credit-system-audit-20260929-extra' }]) {
    const h = harness();
    await assert.rejects(verifyPhotoroomPreview({ ...env, ...flags }, h.dependencies), safeError);
    assert.equal(h.calls.length, 0);
  }
});

test('missing, masked and sandbox keys are refused before contacting Photoroom', async () => {
  for (const key of ['', '[SENSITIVE]', 'sandbox_private_fixture', 'SANDBOX_private_fixture', 'prod key with spaces', 'short']) {
    const h = harness();
    await assert.rejects(verifyPhotoroomPreview({ ...env, PHOTOROOM_API_KEY: key }, h.dependencies), /non-sandbox/);
    assert.equal(h.calls.length, 0);
  }
});

test('account-only Preview validation uses one GET and exposes only numeric allowance', async () => {
  const h = harness({ sampleReader: () => assert.fail('account-only must not prepare or process a photo') });
  const result = await verifyPhotoroomPreview(env, h.dependencies);
  assert.deepEqual(result, { enabled: true, availableImages: 10, subscriptionImages: 100 });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.method, 'GET');
  assert.deepEqual(h.timeouts, [20000]);
  assert.deepEqual(h.logs.map(JSON.parse), [{ check: 'photoroom-preview-account', ok: true, httpStatus: 200,
    availableImages: 10, subscriptionImages: 100 }]);
  assert.ok(!h.logs.join('').includes(env.PHOTOROOM_API_KEY));
  assert.ok(!h.logs.join('').includes('private.example.invalid'));
});

test('account verification supports older numeric allowance and rejects invalid/secret response fields', async () => {
  for (const body of [{ images: { available: 'hidden', subscription: 100 } }, { images: { available: -1, subscription: 100 } },
    { images: { available: 1 } }, { secret: env.PHOTOROOM_API_KEY }]) {
    const h = harness();
    h.dependencies.fetcher = async () => Response.json(body);
    await assert.rejects(verifyPhotoroomPreview(env, h.dependencies), safeError);
    assert.equal(h.logs.length, 0);
  }
  const h = harness();
  h.dependencies.fetcher = async () => Response.json({ credits: { available: 5, subscription: 10 } });
  assert.equal((await verifyPhotoroomPreview(env, h.dependencies)).availableImages, 5);
});

test('provider HTTP errors, transport errors and malformed JSON never leak details or trigger a retry', async () => {
  for (const status of [401, 403, 429, 500]) {
    const h = harness();
    h.dependencies.fetcher = async () => ({ ok: false, status, json: () => assert.fail('must not read error JSON'),
      body: { getReader: () => assert.fail('must not read provider error body') } });
    await assert.rejects(verifyPhotoroomPreview(env, h.dependencies), (error) => safeError(error) && error.message.includes(`HTTP ${status}`));
    assert.equal(h.logs.length, 0);
  }
  const h = harness({ fetchFailure: 'https://private.example.invalid/?hidden' });
  await assert.rejects(verifyPhotoroomPreview(env, h.dependencies), safeError);
  assert.equal(h.calls.length, 1);
  assert.equal(h.logs.length, 0);
  await assert.rejects(verifyPhotoroomPreview(env, { fetcher: async () => new Response(env.PHOTOROOM_API_KEY), report: () => {} }), safeError);
});

test('sample verification sends exact gateway fields and frozen JPEG once, validating real PNG bytes', async () => {
  const h = harness();
  const result = await verifyPhotoroomPreview(sampleEnv, h.dependencies);
  assert.equal(h.calls.length, 2);
  const { options } = h.calls[1];
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Accept, 'image/png');
  assert.deepEqual([...options.body.keys()], ['image_file', 'format', 'channels', 'size']);
  assert.equal(options.body.get('format'), 'png');
  assert.equal(options.body.get('channels'), 'rgba');
  assert.equal(options.body.get('size'), 'full');
  const image = options.body.get('image_file');
  assert.equal(image.type, 'image/jpeg');
  assert.equal(image.name, 'photo.jpeg');
  const metadata = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 32);
  assert.equal(metadata.height, 24);
  assert.deepEqual(h.timeouts, [20000, 70000]);
  assert.deepEqual(result.sample, { width: 32, height: 24, alphaMin: 0, alphaMax: 255 });
  assert.equal(JSON.parse(h.logs.at(-1)).check, 'photoroom-preview-sample');
  assert.ok(!JSON.stringify(result).includes('output'));
});

test('sample preparation rotates/resizes a large input before processing and refuses zero allowance', async () => {
  const large = await sharp({ create: { width: 2048, height: 1024, channels: 3, background: '#123456' } }).png().toBuffer();
  const h = harness({ sampleReader: async () => large, response: async () => new Response(await rgbaPng({ width: 1024, height: 512 })) });
  const result = await verifyPhotoroomPreview(sampleEnv, h.dependencies);
  assert.equal(result.sample.width, 1024);
  assert.equal(result.sample.height, 512);
  const zero = harness({ sampleReader: () => assert.fail('must not process exhausted allowance') });
  zero.dependencies.fetcher = async () => Response.json({ images: { available: 0, subscription: 100 } });
  await assert.rejects(verifyPhotoroomPreview(sampleEnv, zero.dependencies), /no remaining image allowance/);
});

test('sample processing failure makes just one POST and never reads rejected provider bodies', async () => {
  for (const response of [() => ({ ok: false, status: 402, body: { getReader: () => assert.fail('must not read rejected output') } }),
    () => { throw new Error(`hidden ${env.PHOTOROOM_API_KEY}`); }]) {
    const h = harness({ response });
    await assert.rejects(verifyPhotoroomPreview(sampleEnv, h.dependencies), safeError);
    assert.equal(h.calls.filter(({ options }) => options.method === 'POST').length, 1);
    assert.equal(h.logs.length, 1);
  }
});

test('sample validates encoding, alpha and unchanged dimensions rather than trusting response headers', async () => {
  for (const output of [Buffer.from(`hidden ${env.PHOTOROOM_API_KEY}`), await rgbaPng({ opaque: true }), await rgbaPng({ empty: true }),
    await rgbaPng({ width: 31 }), await sharp(input).jpeg().toBuffer()]) {
    const h = harness({ response: () => new Response(output, { headers: { 'content-type': 'image/png' } }) });
    await assert.rejects(verifyPhotoroomPreview(sampleEnv, h.dependencies), safeError);
    assert.equal(h.calls.length, 2);
    assert.equal(h.logs.length, 1);
  }
});

test('sample rejects non-finite or out-of-range alpha statistics before logging them', async () => {
  for (const maximum of [NaN, Infinity, 256]) {
    const h = harness();
    h.dependencies.imageProcessor = (...args) => {
      const pipeline = sharp(...args);
      const stats = pipeline.stats.bind(pipeline);
      pipeline.stats = async () => {
        const result = await stats();
        result.channels.at(-1).max = maximum;
        return result;
      };
      return pipeline;
    };
    await assert.rejects(verifyPhotoroomPreview(sampleEnv, h.dependencies), safeError);
    assert.equal(h.logs.length, 1);
  }
});

test('provider account and output responses have declared and streaming size limits', async () => {
  const h = harness();
  h.dependencies.fetcher = async () => new Response('{}', { headers: { 'content-length': String(64 * 1024 + 1) } });
  await assert.rejects(verifyPhotoroomPreview(env, h.dependencies), /safe size limit/);
  const declared = harness({ response: () => new Response(transparent, { headers: { 'content-length': String(20 * 1024 * 1024 + 1) } }) });
  await assert.rejects(verifyPhotoroomPreview(sampleEnv, declared.dependencies), /safe size limit/);
  let canceled = false;
  const streamed = harness({ response: () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(11 * 1024 * 1024)); controller.enqueue(new Uint8Array(11 * 1024 * 1024)); },
    cancel() { canceled = true; },
  })) });
  await assert.rejects(verifyPhotoroomPreview(sampleEnv, streamed.dependencies), /safe size limit/);
  assert.equal(canceled, true);
  assert.equal(streamed.calls.length, 2);
});

test('build wiring runs the opt-in Photoroom verifier after the existing payment guard', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts.prebuild, 'node scripts/verify-payment-release.mjs && node scripts/verify-photoroom-preview.mjs && node scripts/verify-r2-staging-preview.mjs && node scripts/verify-legacy-cutouts-preview.mjs && node scripts/verify-order-production-release.mjs');
});

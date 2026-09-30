import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const EXPECTED_BRANCH = 'codex/credit-system-audit-20260929';
const ACCOUNT_URL = 'https://image-api.photoroom.com/v2/account';
const SEGMENT_URL = 'https://sdk.photoroom.com/v1/segment';
const SAMPLE_URL = new URL('../public/marketing/portrait-gallery-cover-generated.png', import.meta.url);
const MAX_SAMPLE_BYTES = 3 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

// Only fixed, locally authored error messages may be printed by the CLI. Never
// attach the provider response or an underlying fetch/sharp error as a cause.
export class PhotoroomPreviewVerificationError extends Error {}
function fail(message) { throw new PhotoroomPreviewVerificationError(message); }
function statusOf(response) { return Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : 0; }

async function boundedBody(response, maximum, label) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    fail(`${label} response exceeded its safe size limit.`);
  }
  if (!response.body) fail(`${label} response was empty.`);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        try { await reader.cancel(); } catch { /* Do not expose transport errors. */ }
        fail(`${label} response exceeded its safe size limit.`);
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error instanceof PhotoroomPreviewVerificationError) throw error;
    fail(`${label} response could not be read.`);
  } finally { reader.releaseLock(); }
  if (!length) fail(`${label} response was empty.`);
  return Buffer.concat(chunks, length);
}

async function request(fetcher, url, options, label) {
  let response;
  try { response = await fetcher(url, { ...options, redirect: 'error' }); }
  catch { fail(`${label} request failed; provider details withheld.`); }
  if (!response.ok) fail(`${label} failed (HTTP ${statusOf(response)}); provider details withheld.`);
  return response;
}

// Deliberately build-only: no runtime route, persistence, DB/client account,
// Stripe or R2 calls. The sample POST can consume one provider image allowance.
// It has a separate opt-in and is never retried after an uncertain result.
export async function verifyPhotoroomPreview(env = process.env, {
  fetcher = fetch,
  report = console.log,
  sampleReader = readFile,
  imageProcessor,
  timeoutSignal = AbortSignal.timeout,
} = {}) {
  if (env.STUDIO_PHOTOROOM_PREVIEW_VERIFY !== '1') return { enabled: false };
  if (env.VERCEL_ENV !== 'preview') fail('Photoroom verification is permitted only in Vercel Preview.');
  if (env.VERCEL_GIT_COMMIT_REF !== EXPECTED_BRANCH) fail('Photoroom verification requires the audited credit Preview branch.');
  const key = (env.PHOTOROOM_API_KEY || '').trim();
  if (!key || key === '[SENSITIVE]' || key.length < 8 || /sandbox/i.test(key) || /\s/.test(key)) {
    fail('A private non-sandbox Photoroom API key is required.');
  }

  const accountResponse = await request(fetcher, ACCOUNT_URL, {
    method: 'GET', headers: { 'x-api-key': key, Accept: 'application/json' }, signal: timeoutSignal(20000),
  }, 'Photoroom account verification');
  let account;
  try { account = JSON.parse((await boundedBody(accountResponse, 64 * 1024, 'Photoroom account')).toString('utf8')); }
  catch (error) {
    if (error instanceof PhotoroomPreviewVerificationError) throw error;
    fail('Photoroom account response was not valid JSON.');
  }
  // Official v2 responses use images; older account responses used credits.
  const allowance = account?.images ?? account?.credits;
  if (!Number.isFinite(allowance?.available) || allowance.available < 0 ||
      !Number.isFinite(allowance?.subscription) || allowance.subscription < 0) {
    fail('Photoroom account response did not contain a valid image allowance.');
  }
  const result = { enabled: true, availableImages: allowance.available, subscriptionImages: allowance.subscription };
  report(JSON.stringify({ check: 'photoroom-preview-account', ok: true, httpStatus: statusOf(accountResponse),
    availableImages: result.availableImages, subscriptionImages: result.subscriptionImages }));
  if (env.STUDIO_PHOTOROOM_SAMPLE_VERIFY !== '1') return result;
  if (allowance.available <= 0) fail('Photoroom has no remaining image allowance for the sample.');

  let sharp = imageProcessor;
  let sample;
  let inputMetadata;
  try {
    sharp ??= (await import('sharp')).default;
    // This committed, generated marketing image contains no customer upload.
    // Freeze one auto-oriented JPEG in memory and send those exact bytes once.
    sample = await sharp(await sampleReader(SAMPLE_URL), { limitInputPixels: 16 * 1024 * 1024 })
      .rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
    inputMetadata = await sharp(sample, { limitInputPixels: 1024 * 1024 }).metadata();
  } catch { fail('The generated Photoroom sample could not be prepared.'); }
  if (!sample.length || sample.length > MAX_SAMPLE_BYTES || inputMetadata.format !== 'jpeg' ||
      !inputMetadata.width || !inputMetadata.height || Math.max(inputMetadata.width, inputMetadata.height) > 1024) {
    fail('The generated Photoroom sample did not meet the image limits.');
  }
  const body = new FormData();
  body.append('image_file', new Blob([new Uint8Array(sample)], { type: 'image/jpeg' }), 'photo.jpeg');
  body.set('format', 'png');
  body.set('channels', 'rgba');
  body.set('size', 'full');
  const sampleResponse = await request(fetcher, SEGMENT_URL, {
    method: 'POST', headers: { 'x-api-key': key, Accept: 'image/png' }, body, signal: timeoutSignal(70000),
  }, 'Photoroom sample verification');
  const output = await boundedBody(sampleResponse, MAX_OUTPUT_BYTES, 'Photoroom sample');
  let metadata;
  let alpha;
  try {
    const outputImage = sharp(output, { limitInputPixels: 1024 * 1024 });
    metadata = await outputImage.metadata();
    if (metadata.format !== 'png' || !metadata.hasAlpha || metadata.width !== inputMetadata.width ||
        metadata.height !== inputMetadata.height) fail('Photoroom sample did not return the expected PNG dimensions and alpha channel.');
    alpha = (await outputImage.stats()).channels.at(-1);
  } catch (error) {
    if (error instanceof PhotoroomPreviewVerificationError) throw error;
    fail('Photoroom sample output could not be decoded.');
  }
  if (!alpha || !Number.isFinite(alpha.min) || alpha.min < 0 || alpha.min >= 255) fail('Photoroom sample output was fully opaque.');
  if (!Number.isFinite(alpha.max) || alpha.max <= 0 || alpha.max > 255) fail('Photoroom sample output did not contain valid visible foreground alpha.');
  result.sample = { width: metadata.width, height: metadata.height, alphaMin: alpha.min, alphaMax: alpha.max };
  report(JSON.stringify({ check: 'photoroom-preview-sample', ok: true, httpStatus: statusOf(sampleResponse), ...result.sample }));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyPhotoroomPreview().catch((error) => {
    console.error('[photoroom-preview]', error instanceof PhotoroomPreviewVerificationError ? error.message : 'Verification failed; details withheld.');
    process.exitCode = 1;
  });
}

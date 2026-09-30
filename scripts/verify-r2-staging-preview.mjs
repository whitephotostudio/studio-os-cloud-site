import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const EXPECTED_BRANCH = 'codex/credit-system-audit-20260929';
const MAX_SAMPLE_BYTES = 4096;
const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const require = createRequire(import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const statusOf = response => Number.isInteger(response?.status) && response.status >= 100 && response.status <= 599 ? response.status : 0;

// Only fixed local messages may be printed. Fetch/SDK response bodies, URLs,
// object keys, account IDs and underlying exception messages stay private.
export class R2StagingPreviewVerificationError extends Error {}
function fail(message) { throw new R2StagingPreviewVerificationError(message); }

async function productionRuntime(env, timeoutSignal) {
  const [sdk, tsModule, signerSource] = await Promise.all([
    import('@aws-sdk/client-s3'), import('typescript'),
    readFile(new URL('../lib/r2-signed-urls.ts', import.meta.url), 'utf8'),
  ]);
  const ts = tsModule.default ?? tsModule;
  const code = ts.transpileModule(signerSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const signer = {};
  // Use the exact committed signer without changing process.env or loading
  // any Supabase, Stripe, provider or runtime-route module.
  new Function('require', 'exports', 'process', code)(require, signer, { env: {
    R2_ACCOUNT_ID: env.R2_ACCOUNT_ID, R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME: env.R2_BUCKET_NAME,
  } });
  const bucket = env.R2_BUCKET_NAME || 'whitephoto-media';
  // Same configuration as lib/r2.ts getR2Client(). All commands below are
  // confined to random objects created by this single build invocation.
  const client = new sdk.S3Client({ region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });
  const send = command => client.send(command, { abortSignal: timeoutSignal(20000) });
  return {
    signPut: signer.r2PresignedPutUrl,
    async download(key) {
      const signal = timeoutSignal(20000);
      const result = await client.send(new sdk.GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal });
      if (!result.Body || !Number.isSafeInteger(result.ContentLength) || result.ContentLength < 1 || result.ContentLength > MAX_SAMPLE_BYTES) {
        result.Body?.destroy?.();
        throw new Error('BoundedReadFailed');
      }
      const chunks = [];
      let length = 0;
      const stopRead = () => result.Body.destroy?.(new Error('BoundedReadFailed'));
      if (signal.aborted) { result.Body.destroy?.(); throw new Error('BoundedReadFailed'); }
      signal.addEventListener('abort', stopRead, { once: true });
      try {
        for await (const chunk of result.Body) {
          length += chunk.length;
          if (length > MAX_SAMPLE_BYTES) { result.Body.destroy?.(); throw new Error('BoundedReadFailed'); }
          chunks.push(Buffer.from(chunk));
        }
      } finally {
        signal.removeEventListener('abort', stopRead);
      }
      if (length !== result.ContentLength) throw new Error('BoundedReadFailed');
      return Buffer.concat(chunks, length);
    },
    async exists(key) {
      try { await send(new sdk.HeadObjectCommand({ Bucket: bucket, Key: key })); return true; }
      catch (error) {
        if (error?.$metadata?.httpStatusCode === 404 || ['NotFound', 'NoSuchKey'].includes(error?.name)) return false;
        throw error;
      }
    },
    async remove(key) { await send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: key })); },
    close() { client.destroy(); },
  };
}

function verifySignedDestination(value, key, env) {
  const bucket = env.R2_BUCKET_NAME || 'whitephoto-media';
  let url;
  try { url = new URL(value); } catch { fail('R2 staging signer did not return a valid private upload ticket.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
      url.host !== `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` ||
      url.pathname.split('/').slice(1).map(decodeURIComponent).join('/') !== `${bucket}/${key}` ||
      url.searchParams.get('X-Amz-SignedHeaders') !== 'content-length;content-type;host' ||
      url.searchParams.get('X-Amz-Expires') !== '120') {
    fail('R2 staging signer did not bind the expected private object and upload headers.');
  }
  return url;
}

// Build-only and opt-in. No database, customer profile, caller auth, Stripe,
// provider image, file export or runtime route is used. Every storage command
// names one freshly generated credit-staging object; uncertain PUTs are not
// retried, and cleanup is attempted before the build succeeds or fails.
export async function verifyR2StagingPreview(env = process.env, {
  fetcher = fetch, report = console.log, runtimeLoader = productionRuntime,
  randomId = randomUUID, imageProcessor, timeoutSignal = AbortSignal.timeout,
} = {}) {
  if (env.STUDIO_R2_STAGING_PREVIEW_VERIFY !== '1') return { enabled: false };
  if (env.VERCEL_ENV !== 'preview') fail('R2 staging verification is permitted only in Vercel Preview.');
  if (env.VERCEL_GIT_COMMIT_REF !== EXPECTED_BRANCH) fail('R2 staging verification requires the audited credit Preview branch.');
  for (const name of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
    const value = env[name];
    if (typeof value !== 'string' || !value || value === '[SENSITIVE]' || /\s/.test(value)) {
      fail('Private R2 credentials are required for the Preview staging check.');
    }
  }
  if (!/^[a-f0-9]{32}$/i.test(env.R2_ACCOUNT_ID) ||
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.R2_BUCKET_NAME || 'whitephoto-media')) {
    fail('The Preview R2 endpoint and bucket configuration could not be verified.');
  }
  const ids = Array.from({ length: 4 }, () => randomId());
  if (ids.some(id => typeof id !== 'string' || !UUID_V4.test(id)) || new Set(ids).size !== ids.length) {
    fail('Fresh private staging identities could not be generated.');
  }
  const keys = ids.slice(1).map(id => `credit-staging/${ids[0]}/${id}.png`);
  const result = { enabled: true, sampleBytes: 0, validPutStatus: null,
    readbackSha256Matches: false, typeTamperStatus: null, sizeTamperStatus: null,
    tamperObjectsAbsent: 0, cleanupAttempts: 0, cleanupDeleted: 0, cleanupConfirmedAbsent: 0 };
  const touched = [];
  let runtime;
  let failure;
  let cleanupFailed = false;
  try {
    let sharp = imageProcessor;
    sharp ??= (await import('sharp')).default;
    const rgba = Buffer.from([21, 101, 209, 0, 21, 101, 209, 255,
      21, 101, 209, 160, 21, 101, 209, 255]);
    const bytes = await sharp(rgba, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
    const metadata = await sharp(bytes).metadata();
    const alpha = (await sharp(bytes).stats()).channels.at(-1);
    if (!bytes.length || bytes.length > MAX_SAMPLE_BYTES || metadata.format !== 'png' ||
        metadata.width !== 2 || metadata.height !== 2 || !metadata.hasAlpha || alpha?.min !== 0 || alpha?.max !== 255) {
      fail('The temporary R2 sample did not contain the expected real transparent PNG.');
    }
    result.sampleBytes = bytes.length;
    const expectedSha = digest(bytes);
    runtime = await runtimeLoader(env, timeoutSignal);
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index];
      const ticket = runtime.signPut(key, 120, { allowCutoutStaging: true,
        contentLength: bytes.length, contentType: 'image/png' });
      const url = verifySignedDestination(ticket, key, env);
      const body = index === 2 ? Buffer.concat([bytes, Buffer.from([0])]) : Buffer.from(bytes);
      touched.push(key);
      let response;
      try {
        response = await fetcher(url, { method: 'PUT', redirect: 'error',
          headers: { 'content-type': index === 1 ? 'image/jpeg' : 'image/png',
            'content-length': String(body.length), 'cache-control': 'private, no-store' },
          body, signal: timeoutSignal(20000) });
      } catch { fail('R2 signed upload failed; storage details withheld.'); }
      const status = statusOf(response);
      try { await response.body?.cancel(); } catch { /* Never expose storage response bodies. */ }
      if (index === 0) {
        result.validPutStatus = status;
        if (status < 200 || status >= 300) fail(`R2 signed upload failed (HTTP ${status}); storage details withheld.`);
        let recovered;
        try { recovered = await runtime.download(key); }
        catch { fail('The temporary R2 sample could not be read back; storage details withheld.'); }
        if (!Buffer.isBuffer(recovered) || recovered.length > MAX_SAMPLE_BYTES || digest(recovered) !== expectedSha) {
          fail('The R2 readback did not match the full temporary PNG SHA-256.');
        }
        result.readbackSha256Matches = true;
      } else {
        if (index === 1) result.typeTamperStatus = status;
        else result.sizeTamperStatus = status;
        if (status !== 403) fail(`R2 signed-header tampering was not rejected with HTTP 403 (HTTP ${status}).`);
        let present;
        try { present = await runtime.exists(key); }
        catch { fail('Rejected R2 upload absence could not be checked; storage details withheld.'); }
        if (present) fail('A rejected R2 upload left a temporary object in storage.');
        result.tamperObjectsAbsent++;
      }
    }
  } catch (error) {
    failure = error instanceof R2StagingPreviewVerificationError ? error :
      new R2StagingPreviewVerificationError('R2 staging verification failed; storage details withheld.');
  } finally {
    for (const key of touched) {
      result.cleanupAttempts++;
      try {
        await runtime.remove(key);
        result.cleanupDeleted++;
        if (await runtime.exists(key)) cleanupFailed = true;
        else result.cleanupConfirmedAbsent++;
      } catch { cleanupFailed = true; }
    }
    try { runtime?.close(); } catch { cleanupFailed = true; }
  }
  report(JSON.stringify({ check: 'r2-staging-preview', ok: !failure && !cleanupFailed, ...result }));
  if (cleanupFailed) fail('R2 staging cleanup could not be fully verified; storage details withheld.');
  if (failure) throw failure;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyR2StagingPreview().catch(error => {
    console.error('[r2-staging-preview]', error instanceof R2StagingPreviewVerificationError ?
      error.message : 'Verification failed; storage details withheld.');
    process.exitCode = 1;
  });
}

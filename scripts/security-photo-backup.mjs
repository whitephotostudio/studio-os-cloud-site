#!/usr/bin/env node
// Opt-in, read-only source inventory and encrypted off-site photo backup.
// Object names, signed URLs, and photo bytes are never written in plaintext.
import { createHash, createHmac, randomBytes, publicEncrypt, privateDecrypt, createPublicKey, createPrivateKey, constants, createCipheriv, createDecipheriv } from 'node:crypto';
import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import http from 'node:http';
import https from 'node:https';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

const FORMAT = 'studio-security-photo-manifest-v1';
const MAGIC = Buffer.from('SOSPHB01');
const OUTPUT_BUCKET = 'studio-os-downloads';
const MAX_MANIFEST_BYTES = 128 * 1024 * 1024;
const GIB = 1024 ** 3;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const encode = value => encodeURIComponent(value).replace(/[!*'()]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{12,80}$/.test(value);
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const cleanEtag = value => typeof value === 'string' ? value.replace(/^W\//, '').replace(/^"|"$/g, '') : '';

// The one-time downloader can run for hours. Use Node's streaming HTTP client
// rather than the bundled fetch parser, which can assert inside Undici after
// a TLS response ends. Each body still flows through the same size/hash/GCM
// pipeline, and caller-supplied fetchers remain available to isolated tests.
export function createBackupDownloadTransport({ concurrency = 6, ca } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) fail('INVALID_CONCURRENCY');
  const options = { keepAlive: true, maxSockets: concurrency, maxTotalSockets: concurrency,
    maxFreeSockets: concurrency, scheduling: 'lifo' };
  const httpAgent = new http.Agent(options);
  const httpsAgent = new https.Agent({ ...options, maxCachedSessions: concurrency, ...(ca ? { ca } : {}) });
  let closed = false;
  const fetcher = (input, init = {}) => new Promise((resolve, reject) => {
    if (closed) { reject(Object.assign(new Error('BACKUP_TRANSPORT_CLOSED'), { code: 'BACKUP_TRANSPORT_CLOSED' })); return; }
    let url;
    try { url = new URL(input); } catch { reject(Object.assign(new Error('INVALID_SOURCE_URL'), { code: 'INVALID_SOURCE_URL' })); return; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (init.method && init.method !== 'GET') || init.body != null) {
      reject(Object.assign(new Error('INVALID_SOURCE_REQUEST'), { code: 'INVALID_SOURCE_REQUEST' })); return;
    }
    const headers = Object.fromEntries(new Headers(init.headers));
    // Back up stored bytes verbatim; Node does not transparently decompress.
    headers['accept-encoding'] ||= 'identity';
    const client = url.protocol === 'https:' ? https : http;
    let incoming;
    const request = client.request(url, { method: 'GET', headers,
      agent: url.protocol === 'https:' ? httpsAgent : httpAgent, signal: init.signal }, response => {
      incoming = response;
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400) {
        response.destroy();
        reject(Object.assign(new Error('SOURCE_REDIRECT_REJECTED'), { code: 'SOURCE_REDIRECT_REJECTED' })); return;
      }
      try {
        const responseHeaders = new Headers();
        for (let i = 0; i < response.rawHeaders.length; i += 2) responseHeaders.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
        // Do not retain an error response body or tie up a pooled connection
        // while the existing downloader decides whether to retry it.
        if (status < 200 || status >= 300 || status === 204) {
          response.destroy(); resolve(new Response(null, { status, headers: responseHeaders })); return;
        }
        resolve(new Response(Readable.toWeb(response), { status, headers: responseHeaders }));
      } catch (error) { response.destroy(); request.destroy(); reject(error); }
    });
    request.once('error', error => {
      // A post-header abort or truncated response must reject the body stream,
      // not escape as an unhandled asynchronous transport exception.
      if (incoming && !incoming.destroyed) incoming.destroy(error);
      reject(error);
    });
    request.end();
  });
  return { fetcher, close() { closed = true; httpAgent.destroy(); httpsAgent.destroy(); } };
}

export function presignGet(config, key, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''), date = stamp.slice(0, 8);
  const scope = `${date}/auto/s3/aws4_request`, host = `${config.accountId}.r2.cloudflarestorage.com`;
  const uri = `/${encode(config.bucket)}/${key.split('/').map(encode).join('/')}`;
  const query = [['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'], ['X-Amz-Credential', `${config.accessKeyId}/${scope}`],
    ['X-Amz-Date', stamp], ['X-Amz-Expires', '604800'], ['X-Amz-SignedHeaders', 'host']].map(([k, v]) => `${encode(k)}=${encode(v)}`).join('&');
  const canonical = ['GET', uri, query, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, date), 'auto'), 's3'), 'aws4_request');
  return `https://${host}${uri}?${query}&X-Amz-Signature=${hmac(signingKey, ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n')).toString('hex')}`;
}

export function sealManifest(manifest, publicKeyPem) {
  const publicKey = createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== 'rsa' || publicKey.asymmetricKeyDetails.modulusLength < 2048) fail('INVALID_PUBLIC_KEY');
  const plaintext = Buffer.from(JSON.stringify(manifest));
  if (plaintext.length > MAX_MANIFEST_BYTES) fail('MANIFEST_TOO_LARGE');
  const key = randomBytes(32), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${FORMAT}:${manifest.backupId}`));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const wrapped = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
  return Buffer.from(JSON.stringify({ format: FORMAT, backupId: manifest.backupId, wrappedKey: wrapped.toString('base64'), iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }));
}

export function openManifest(encrypted, privateKeyPem) {
  if (encrypted.length > MAX_MANIFEST_BYTES * 1.5) fail('MANIFEST_TOO_LARGE');
  const envelope = JSON.parse(encrypted.toString('utf8'));
  if (envelope.format !== FORMAT || !safeId(envelope.backupId)) fail('INVALID_MANIFEST');
  const privateKey = createPrivateKey(privateKeyPem);
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(envelope.wrappedKey, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(`${FORMAT}:${envelope.backupId}`)); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const manifest = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
  validateManifest(manifest);
  if (manifest.backupId !== envelope.backupId) fail('INVALID_MANIFEST');
  return manifest;
}

export function validateManifest(manifest) {
  if (manifest.format !== FORMAT || !safeId(manifest.backupId) || !Array.isArray(manifest.objects) || manifest.objects.length > 250_000) fail('INVALID_MANIFEST');
  const seen = new Set(); let bytes = 0;
  for (const object of manifest.objects) {
    if (!['r2', 'supabase'].includes(object.source) || typeof object.bucket !== 'string' || !object.bucket || typeof object.key !== 'string' || !object.key || typeof object.etag !== 'string' ||
      !Number.isSafeInteger(object.size) || object.size < 0 || typeof object.url !== 'string' || new URL(object.url).protocol !== 'https:') fail('INVALID_OBJECT');
    const identity = JSON.stringify([object.source, object.bucket, object.key]);
    if (seen.has(identity)) fail('DUPLICATE_OBJECT');
    seen.add(identity); bytes += object.size;
    if (!Number.isSafeInteger(bytes)) fail('INVALID_OBJECT_SIZE');
  }
  if (bytes !== manifest.totalBytes || manifest.objectCount !== manifest.objects.length) fail('INVALID_TOTALS');
}

export async function buildManifest({ backupId, r2, supabase, r2Config, maxBytes = 800 * GIB, maxObjects = 250_000, now = new Date(), head = fetch }) {
  if (!safeId(backupId)) fail('INVALID_BACKUP_ID');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(maxObjects) || maxObjects < 1 || maxObjects > 250_000) fail('INVALID_BACKUP_CAP');
  const objects = [], seenKeys = new Set(); let totalBytes = 0;
  const add = object => {
    const identity = JSON.stringify([object.source, object.bucket, object.key]);
    if (seenKeys.has(identity)) fail('DUPLICATE_OBJECT');
    seenKeys.add(identity); objects.push(object); totalBytes += object.size;
    if (objects.length > maxObjects || totalBytes > maxBytes || !Number.isSafeInteger(totalBytes)) fail('BACKUP_CAP_EXCEEDED');
  };
  let continuation; const tokens = new Set();
  do {
    const page = await r2.send(new ListObjectsV2Command({ Bucket: r2Config.bucket, MaxKeys: 1000, ContinuationToken: continuation }));
    for (const row of page.Contents || []) {
      if (!row.Key || !Number.isSafeInteger(row.Size) || row.Size < 0) fail('INVALID_SOURCE_METADATA');
      add({ source: 'r2', bucket: r2Config.bucket, key: row.Key, size: row.Size, etag: row.ETag || '',
        modified: row.LastModified?.toISOString() || null, url: presignGet(r2Config, row.Key, now) });
    }
    continuation = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (page.IsTruncated && (!continuation || tokens.has(continuation))) fail('INVALID_LIST_PAGINATION');
    if (continuation) tokens.add(continuation);
  } while (continuation);

  for (const bucket of ['photos', 'nobg-photos', 'thumbs']) {
    const pending = [''], folders = new Set();
    while (pending.length) {
      const folder = pending.shift();
      if (folders.has(folder) || folders.size > maxObjects) fail('INVALID_LIST_PAGINATION');
      folders.add(folder);
      let offset = 0;
      for (;;) {
        const { data, error } = await supabase.storage.from(bucket).list(folder, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
        if (error || !Array.isArray(data)) fail('LEGACY_LIST_FAILED');
        const files = [];
        for (const row of data) {
          if (typeof row.name !== 'string' || !row.name || row.name.includes('/')) fail('INVALID_SOURCE_METADATA');
          const key = folder ? `${folder}/${row.name}` : row.name;
          if (!row.id && !row.metadata) pending.push(key);
          else files.push({ key, row });
        }
        for (let offsetFiles = 0; offsetFiles < files.length; offsetFiles += 100) {
          const batch = files.slice(offsetFiles, offsetFiles + 100);
          const { data: urls, error: signError } = await supabase.storage.from(bucket).createSignedUrls(batch.map(file => file.key), 604800);
          if (signError || !urls || urls.length !== batch.length) fail('LEGACY_SIGN_FAILED');
          const urlMap = new Map(urls.map(value => [value.path, value]));
          for (const file of batch) {
            const url = urlMap.get(file.key)?.signedUrl;
            if (!url || urlMap.get(file.key)?.error) fail('LEGACY_SIGN_FAILED');
            const sourceSize = file.row.metadata?.size;
            let size = sourceSize === null || sourceSize === undefined ? NaN : Number(sourceSize), etag = file.row.metadata?.eTag || file.row.metadata?.etag || '';
            if (!Number.isSafeInteger(size) || size < 0) {
              const response = await head(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(60_000) });
              size = Number(response.headers.get('content-length')); etag ||= response.headers.get('etag') || '';
              if (!response.ok || !response.headers.has('content-length') || !Number.isSafeInteger(size) || size < 0) fail('INVALID_SOURCE_METADATA');
            }
            add({ source: 'supabase', bucket, key: file.key, size, etag, modified: file.row.updated_at || null, url });
          }
        }
        if (data.length < 1000) break;
        offset += data.length;
        if (offset > maxObjects) fail('BACKUP_CAP_EXCEEDED');
      }
    }
  }
  const manifest = { format: FORMAT, backupId, createdAt: now.toISOString(), objectCount: objects.length, totalBytes, objects };
  validateManifest(manifest);
  return manifest;
}

export async function produceBackupManifest(env = process.env) {
  if (env.STUDIO_SECURITY_PHOTO_BACKUP_ENABLED !== 'produce-v1') return { ok: true, skipped: true };
  const backupId = env.STUDIO_SECURITY_PHOTO_BACKUP_ID;
  if (!safeId(backupId)) fail('INVALID_BACKUP_ID');
  for (const name of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STUDIO_SECURITY_PHOTO_BACKUP_PUBLIC_KEY_B64']) if (!env[name]) fail('BACKUP_CONFIGURATION_MISSING');
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: bucket, error } = await supabase.storage.getBucket(OUTPUT_BUCKET);
  if (error || !bucket || bucket.public !== false) fail('PRIVATE_BACKUP_BUCKET_REQUIRED');
  const r2Config = { accountId: env.R2_ACCOUNT_ID, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_BUCKET_NAME || 'whitephoto-media' };
  const r2 = new S3Client({ region: 'auto', endpoint: `https://${r2Config.accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId: r2Config.accessKeyId, secretAccessKey: r2Config.secretAccessKey } });
  const manifest = await buildManifest({ backupId, r2, supabase, r2Config,
    maxBytes: Number(env.STUDIO_SECURITY_PHOTO_BACKUP_MAX_BYTES || 800 * GIB), maxObjects: Number(env.STUDIO_SECURITY_PHOTO_BACKUP_MAX_OBJECTS || 250_000) });
  const encrypted = sealManifest(manifest, Buffer.from(env.STUDIO_SECURITY_PHOTO_BACKUP_PUBLIC_KEY_B64, 'base64').toString('utf8'));
  const upload = await supabase.storage.from(OUTPUT_BUCKET).upload(`security-backups/${backupId}/manifest.enc`, encrypted,
    { upsert: false, contentType: 'application/octet-stream', cacheControl: '0' });
  if (upload.error) fail('ENCRYPTED_MANIFEST_UPLOAD_FAILED');
  return { ok: true, backupId, objectCount: manifest.objectCount, totalBytes: manifest.totalBytes, manifestSha256: sha256(encrypted), encryptedBytes: encrypted.length };
}

function objectId(masterKey, object) { return hmac(masterKey, JSON.stringify([object.source, object.bucket, object.key])).toString('hex'); }
function objectAad(backupId, id, object) { return Buffer.from(JSON.stringify([backupId, id, object.size, object.etag || ''])); }
async function privateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) fail('PRIVATE_KEY_DIRECTORY_REQUIRED');
}
async function readPrivateFile(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) fail('PRIVATE_KEY_FILE_REQUIRED');
  return fs.readFile(file);
}

export async function encryptPhotoResponse(response, file, key, aad, expectedSize) {
  if (!response.ok || !response.body || response.status !== 200) fail('SOURCE_DOWNLOAD_FAILED');
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) !== expectedSize) fail('SOURCE_SIZE_CHANGED');
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv), digest = createHash('sha256');
  cipher.setAAD(aad); let bytes = 0;
  await fs.writeFile(file, Buffer.concat([MAGIC, iv]), { flag: 'wx', mode: 0o600 });
  const counter = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > expectedSize) callback(Object.assign(new Error('SOURCE_SIZE_CHANGED'), { code: 'SOURCE_SIZE_CHANGED' }));
    else { digest.update(chunk); callback(null, chunk); }
  } });
  await pipeline(Readable.fromWeb(response.body), counter, cipher, createWriteStream(file, { flags: 'a' }));
  if (bytes !== expectedSize) fail('SOURCE_SIZE_CHANGED');
  await fs.appendFile(file, cipher.getAuthTag());
  const handle = await fs.open(file, 'r+'); try { await handle.sync(); } finally { await handle.close(); }
  return { bytes, sha256: digest.digest('hex'), encryptedBytes: bytes + MAGIC.length + 12 + 16 };
}

export async function verifyEncryptedPhoto(file, key, aad, expected) {
  const stat = await fs.stat(file);
  if (stat.size !== expected.bytes + MAGIC.length + 12 + 16) fail('BACKUP_SIZE_MISMATCH');
  const handle = await fs.open(file, 'r'), header = Buffer.alloc(MAGIC.length + 12), tag = Buffer.alloc(16);
  try { await handle.read(header, 0, header.length, 0); await handle.read(tag, 0, 16, stat.size - 16); }
  finally { await handle.close(); }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) fail('INVALID_BACKUP_FILE');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length)); decipher.setAAD(aad); decipher.setAuthTag(tag);
  const digest = createHash('sha256'); let bytes = 0;
  const output = new Writable({ write(chunk, _encoding, callback) { bytes += chunk.length; digest.update(chunk); callback(); } });
  if (expected.bytes === 0) { decipher.end(); await pipeline(decipher, output); }
  else await pipeline(createReadStream(file, { start: header.length, end: stat.size - 17 }), decipher, output);
  const actual = digest.digest('hex');
  if (bytes !== expected.bytes || actual !== expected.sha256) fail('BACKUP_DIGEST_MISMATCH');
  return { bytes, sha256: actual };
}

export async function downloadBackup({ manifestFile, expectedManifestSha256, privateKeyFile, keyDirectory, destination, concurrency = 6, fetcher = fetch, progress = () => {} }) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) fail('INVALID_CONCURRENCY');
  if (typeof expectedManifestSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedManifestSha256)) fail('EXPECTED_MANIFEST_HASH_REQUIRED');
  // The producer digest must arrive through its trusted result channel.
  // RSA encryption protects confidentiality; it cannot prove who created an
  // envelope when its public key is available to other parties.
  const manifestBytes = await fs.readFile(manifestFile);
  if (sha256(manifestBytes) !== expectedManifestSha256.toLowerCase()) fail('MANIFEST_HASH_MISMATCH');
  await privateDirectory(keyDirectory);
  const privateKey = await readPrivateFile(privateKeyFile);
  await fs.mkdir(destination, { recursive: true });
  const [absoluteDestination, absoluteKeyDirectory, absolutePrivateKey] = await Promise.all([
    fs.realpath(destination), fs.realpath(keyDirectory), fs.realpath(privateKeyFile),
  ]);
  const insideDestination = value => value === absoluteDestination || value.startsWith(`${absoluteDestination}${path.sep}`);
  if (insideDestination(absoluteKeyDirectory) || insideDestination(absolutePrivateKey)) fail('BACKUP_KEYS_MUST_BE_SEPARATE');
  const manifest = openManifest(manifestBytes, privateKey);
  const root = path.join(absoluteDestination, manifest.backupId), objectDirectory = path.join(root, 'objects');
  await fs.mkdir(root, { recursive: true });
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('INVALID_BACKUP_DIRECTORY');
  await fs.mkdir(objectDirectory, { recursive: true });
  const objectStat = await fs.lstat(objectDirectory);
  if (!objectStat.isDirectory() || objectStat.isSymbolicLink()) fail('INVALID_BACKUP_DIRECTORY');
  const keyFile = path.join(absoluteKeyDirectory, `photo-backup-${manifest.backupId}.key`);
  const wrappedKeyFile = path.join(root, 'key.enc');
  let masterKey, wrappedKey;
  try {
    wrappedKey = await fs.readFile(wrappedKeyFile);
    const recovered = JSON.parse(privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, wrappedKey).toString('utf8'));
    if (recovered.backupId !== manifest.backupId || typeof recovered.key !== 'string') fail('INVALID_BACKUP_KEY');
    masterKey = Buffer.from(recovered.key, 'base64');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try {
    const localKey = await readPrivateFile(keyFile);
    if (masterKey && !masterKey.equals(localKey)) fail('BACKUP_KEY_MISMATCH');
    masterKey = localKey;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    masterKey ||= randomBytes(32);
    await fs.writeFile(keyFile, masterKey, { flag: 'wx', mode: 0o600 });
  }
  if (masterKey.length !== 32) fail('INVALID_BACKUP_KEY');
  if (!wrappedKey) {
    wrappedKey = publicEncrypt({ key: createPublicKey(createPrivateKey(privateKey)), padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(JSON.stringify({ backupId: manifest.backupId, key: masterKey.toString('base64') })));
    await fs.writeFile(wrappedKeyFile, wrappedKey, { flag: 'wx', mode: 0o600 });
  }
  const available = await fs.statfs(root), free = available.bavail * available.bsize;
  const completed = new Map(); let remainingBytes = 0;
  for (const object of manifest.objects) {
    const id = objectId(masterKey, object), file = path.join(root, 'objects', `${id}.enc`), recordFile = `${file}.json`;
    try {
      const record = JSON.parse(await fs.readFile(recordFile, 'utf8'));
      const encoded = JSON.stringify(record.data);
      if (record.mac !== hmac(masterKey, encoded).toString('hex') || record.data.bytes !== object.size || record.data.etag !== object.etag) fail('INVALID_RESUME_RECORD');
      await verifyEncryptedPhoto(file, masterKey, objectAad(manifest.backupId, id, object), record.data);
      completed.set(id, record.data);
    } catch { remainingBytes += object.size + available.bsize * 2 + 128; }
  }
  if (free < remainingBytes + Math.max(GIB, available.blocks * available.bsize * 0.03)) fail('INSUFFICIENT_BACKUP_CAPACITY');
  await fs.writeFile(path.join(root, 'manifest.enc'), manifestBytes, { mode: 0o600 });
  const cancellation = new AbortController();
  let cursor = 0, count = completed.size, bytes = [...completed.values()].reduce((sum, row) => sum + row.bytes, 0), failure;
  const worker = async () => {
    for (;;) {
      if (failure) return;
      const index = cursor++; if (index >= manifest.objects.length) return;
      const object = manifest.objects[index], id = objectId(masterKey, object);
      if (completed.has(id)) continue;
      const file = path.join(root, 'objects', `${id}.enc`), temporary = `${file}.partial-${randomBytes(6).toString('hex')}`;
      let record;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        let response;
        try {
          response = await fetcher(object.url, { redirect: 'error', cache: 'no-store', headers: object.etag ? { 'If-Match': `"${cleanEtag(object.etag)}"` } : {}, signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(20 * 60_000)]) });
          if (object.etag && cleanEtag(response.headers.get('etag')) !== cleanEtag(object.etag)) fail('SOURCE_ETAG_CHANGED');
          record = { ...await encryptPhotoResponse(response, temporary, masterKey, objectAad(manifest.backupId, id, object), object.size), etag: object.etag };
          await fs.rename(temporary, file); break;
        } catch (error) {
          await fs.rm(temporary, { force: true });
          if (failure) throw failure;
          if (attempt === 2) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        } finally {
          // An ETag/size/header rejection happens before the encryption
          // pipeline owns the body. Release it so retries cannot fill the pool.
          if (response?.body) { try { await response.body.cancel(); } catch { /* Already consumed/locked by the pipeline. */ } }
        }
      }
      const encoded = JSON.stringify(record), recordTemp = `${file}.json.partial`;
      await fs.writeFile(recordTemp, JSON.stringify({ data: record, mac: hmac(masterKey, encoded).toString('hex') }), { mode: 0o600 });
      await fs.rename(recordTemp, `${file}.json`); completed.set(id, record); count += 1; bytes += record.bytes;
      progress({ backupId: manifest.backupId, completed: count, total: manifest.objectCount, bytes });
    }
  };
  const results = await Promise.allSettled(Array.from({ length: concurrency }, () => worker().catch(error => {
    failure ||= error; cancellation.abort(); throw error;
  })));
  const rejected = results.find(result => result.status === 'rejected');
  if (rejected) throw rejected.reason;
  if (count !== manifest.objectCount || bytes !== manifest.totalBytes) fail('INCOMPLETE_BACKUP');
  const sampleIndices = [...new Set([0, Math.floor(manifest.objects.length / 2), manifest.objects.length - 1])]
    .filter(index => index >= 0 && index < manifest.objects.length);
  for (const index of sampleIndices) {
    const object = manifest.objects[index], id = objectId(masterKey, object);
    await verifyEncryptedPhoto(path.join(root, 'objects', `${id}.enc`), masterKey, objectAad(manifest.backupId, id, object), completed.get(id));
  }
  const summary = { ok: true, backupId: manifest.backupId, objectCount: count, totalBytes: bytes, restoreSamplesVerified: sampleIndices.length, manifestSha256: sha256(manifestBytes) };
  await fs.writeFile(path.join(root, 'verification.json'), JSON.stringify(summary, null, 2));
  return summary;
}

function argumentsMap(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) { if (!args[i].startsWith('--') || !args[i + 1]) fail('INVALID_ARGUMENTS'); result[args[i].slice(2)] = args[i + 1]; }
  return result;
}
async function main() {
  const mode = process.argv[2];
  if (mode === 'produce') console.log(JSON.stringify(await produceBackupManifest()));
  else if (mode === 'download') {
    const args = argumentsMap(process.argv.slice(3));
    if (!args.manifest || !args['manifest-sha256'] || !args['private-key'] || !args['key-dir'] || !args.destination) fail('INVALID_ARGUMENTS');
    let last = 0;
    const concurrency = args.concurrency === undefined ? 6 : Number(args.concurrency);
    const transport = createBackupDownloadTransport({ concurrency });
    try {
      const result = await downloadBackup({ manifestFile: args.manifest, expectedManifestSha256: args['manifest-sha256'], privateKeyFile: args['private-key'], keyDirectory: args['key-dir'], destination: args.destination,
        concurrency, fetcher: transport.fetcher,
        progress: value => { if (Date.now() - last > 5000) { console.log(JSON.stringify(value)); last = Date.now(); } } });
      console.log(JSON.stringify(result));
    } finally { transport.close(); }
  } else fail('INVALID_MODE');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { const code = /^[A-Z_]{3,80}$/.test(error.code || '') ? error.code : 'BACKUP_OPERATION_FAILED'; console.error(JSON.stringify({ ok: false, code })); process.exitCode = 1; });
}

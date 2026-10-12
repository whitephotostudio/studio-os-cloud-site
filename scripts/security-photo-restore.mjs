#!/usr/bin/env node
// Offline recovery for the v1 photo backup. No providers, URLs, or network calls.
import { promises as fs, constants as fileConstants } from 'node:fs';
import { createHash, createHmac, createPrivateKey, privateDecrypt, createDecipheriv, constants, timingSafeEqual, randomBytes } from 'node:crypto';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const FORMAT = 'studio-security-photo-manifest-v1', MAGIC = Buffer.from('SOSPHB01');
const MAX_MANIFEST = 192 * 1024 * 1024;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const inside = (file, directory) => file === directory || file.startsWith(`${directory}${path.sep}`);
const onVolume = file => inside(file, '/Volumes');
const hash = value => createHash('sha256').update(value).digest('hex');
const mac = (key, value) => createHmac('sha256', key).update(value).digest();
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{12,80}$/.test(value);
const hexDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const owned = stat => !process.getuid || stat.uid === process.getuid();

function base64(value, size) {
  if (typeof value !== 'string' || value.length > 2 * MAX_MANIFEST || value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value)) fail('INVALID_BACKUP_ENCODING');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || (size !== undefined && bytes.length !== size)) fail('INVALID_BACKUP_ENCODING');
  return bytes;
}

async function regularFile(file) {
  const handle = await fs.open(file, fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) fail('REGULAR_BACKUP_FILE_REQUIRED');
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

async function readBounded(file, maximum, privateKey = false) {
  const handle = await regularFile(file);
  try {
    const stat = await handle.stat();
    if (privateKey && (!owned(stat) || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1)) fail('PRIVATE_KEY_FILE_REQUIRED');
    if (stat.size < 1 || stat.size > maximum) fail('INVALID_BACKUP_FILE_SIZE');
    const result = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < result.length) {
      const { bytesRead } = await handle.read(result, offset, result.length - offset, offset);
      if (!bytesRead) fail('BACKUP_FILE_CHANGED');
      offset += bytesRead;
    }
    if ((await handle.stat()).size !== stat.size) fail('BACKUP_FILE_CHANGED');
    return result;
  } finally { await handle.close(); }
}

async function directory(directory, { privateMode = false } = {}) {
  if (privateMode) {
    // Resolve neither a chosen output directory nor a key directory through
    // symlinked ancestors. Use a physical Mac path (for example /Users/...).
    let ancestor = path.resolve(directory);
    for (;;) {
      if ((await fs.lstat(ancestor)).isSymbolicLink()) fail('DIRECTORY_SYMLINK_REJECTED');
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
  }
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('DIRECTORY_SYMLINK_REJECTED');
  if (privateMode && (!owned(stat) || (stat.mode & 0o777) !== 0o700)) fail('PRIVATE_DIRECTORY_REQUIRED');
  return { real: await fs.realpath(directory), dev: stat.dev, ino: stat.ino };
}

function validateManifest(manifest) {
  if (!manifest || manifest.format !== FORMAT || !safeId(manifest.backupId) || !Array.isArray(manifest.objects) || manifest.objects.length > 250_000) fail('INVALID_MANIFEST');
  const seen = new Set(); let total = 0;
  for (const object of manifest.objects) {
    if (!object || !['r2', 'supabase'].includes(object.source) || typeof object.bucket !== 'string' || !object.bucket ||
      typeof object.key !== 'string' || !object.key || typeof object.etag !== 'string' || typeof object.url !== 'string' ||
      !Number.isSafeInteger(object.size) || object.size < 0 || object.size > Number.MAX_SAFE_INTEGER - 36) fail('INVALID_MANIFEST_OBJECT');
    try { if (new URL(object.url).protocol !== 'https:') fail('INVALID_MANIFEST_OBJECT'); } catch { fail('INVALID_MANIFEST_OBJECT'); }
    const identity = JSON.stringify([object.source, object.bucket, object.key]);
    if (seen.has(identity)) fail('DUPLICATE_MANIFEST_OBJECT');
    seen.add(identity); total += object.size;
    if (!Number.isSafeInteger(total)) fail('INVALID_MANIFEST_TOTALS');
  }
  if (manifest.objectCount !== manifest.objects.length || manifest.totalBytes !== total) fail('INVALID_MANIFEST_TOTALS');
}

async function context({ backupDirectory, expectedManifestSha256, expectedWrappedKeySha256, privateKeyFile }) {
  if (typeof expectedManifestSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedManifestSha256)) fail('EXPECTED_MANIFEST_HASH_REQUIRED');
  if (typeof expectedWrappedKeySha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedWrappedKeySha256)) fail('EXPECTED_WRAPPED_KEY_HASH_REQUIRED');
  const root = await directory(backupDirectory), objects = await directory(path.join(root.real, 'objects'));
  const encrypted = await readBounded(path.join(root.real, 'manifest.enc'), MAX_MANIFEST);
  if (hash(encrypted) !== expectedManifestSha256.toLowerCase()) fail('MANIFEST_HASH_MISMATCH');
  // RSA wrapping is confidentiality, not producer authentication. Bind this
  // separately generated master key to a receipt kept outside the USB backup.
  const wrappedKey = await readBounded(path.join(root.real, 'key.enc'), 16 * 1024);
  if (hash(wrappedKey) !== expectedWrappedKeySha256.toLowerCase()) fail('WRAPPED_KEY_HASH_MISMATCH');
  const keyParent = await directory(path.dirname(path.resolve(privateKeyFile)), { privateMode: true });
  const realKey = await fs.realpath(privateKeyFile);
  if (inside(realKey, root.real) || inside(keyParent.real, root.real)) fail('BACKUP_KEYS_MUST_BE_SEPARATE');
  if (onVolume(path.resolve(privateKeyFile)) || onVolume(realKey)) fail('PRIVATE_KEY_MUST_STAY_ON_MAC');
  const privatePem = await readBounded(privateKeyFile, 64 * 1024, true);
  let masterKey;
  try {
    const privateKey = createPrivateKey(privatePem);
    if (privateKey.asymmetricKeyType !== 'rsa' || privateKey.asymmetricKeyDetails.modulusLength < 2048) fail('INVALID_PRIVATE_KEY');
    const envelope = JSON.parse(encrypted.toString('utf8'));
    if (envelope.format !== FORMAT || !safeId(envelope.backupId)) fail('INVALID_MANIFEST');
    let manifest, manifestKey;
    try {
      manifestKey = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, base64(envelope.wrappedKey));
      if (manifestKey.length !== 32) fail('INVALID_MANIFEST_KEY');
      const decipher = createDecipheriv('aes-256-gcm', manifestKey, base64(envelope.iv, 12));
      decipher.setAAD(Buffer.from(`${FORMAT}:${envelope.backupId}`)); decipher.setAuthTag(base64(envelope.tag, 16));
      const plaintext = Buffer.concat([decipher.update(base64(envelope.ciphertext)), decipher.final()]);
      try { manifest = JSON.parse(plaintext.toString('utf8')); } finally { plaintext.fill(0); }
    } catch { fail('MANIFEST_AUTHENTICATION_FAILED'); }
    finally { manifestKey?.fill(0); }
    validateManifest(manifest);
    if (manifest.backupId !== envelope.backupId) fail('MANIFEST_BACKUP_ID_MISMATCH');
    let recoveredBytes;
    try {
      recoveredBytes = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, wrappedKey);
      const recovered = JSON.parse(recoveredBytes.toString('utf8'));
      if (recovered.backupId !== manifest.backupId) fail('BACKUP_KEY_ID_MISMATCH');
      masterKey = base64(recovered.key, 32);
    } catch (error) { if (error.code === 'BACKUP_KEY_ID_MISMATCH') throw error; fail('INVALID_BACKUP_KEY'); }
    finally { recoveredBytes?.fill(0); }
    return { root: root.real, objectDirectory: objects.real, manifest, masterKey };
  } catch (error) { masterKey?.fill(0); throw error; }
  finally { privatePem.fill(0); }
}

async function objectRecord(ctx, index) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= ctx.manifest.objects.length) fail('INVALID_OBJECT_INDEX');
  const object = ctx.manifest.objects[index];
  // Never use the original object key as a local filename.
  const id = mac(ctx.masterKey, JSON.stringify([object.source, object.bucket, object.key])).toString('hex');
  const file = path.join(ctx.objectDirectory, `${id}.enc`);
  const record = JSON.parse((await readBounded(`${file}.json`, 4096)).toString('utf8'));
  if (!record || !record.data || !hexDigest(record.mac) || !timingSafeEqual(Buffer.from(record.mac, 'hex'), mac(ctx.masterKey, JSON.stringify(record.data)))) fail('BACKUP_RECORD_MAC_MISMATCH');
  const data = record.data;
  if (data.bytes !== object.size || data.encryptedBytes !== object.size + 36 || data.etag !== object.etag || !hexDigest(data.sha256)) fail('INVALID_BACKUP_RECORD');
  return { file, data, aad: Buffer.from(JSON.stringify([ctx.manifest.backupId, id, object.size, object.etag || ''])) };
}

async function decryptPhoto(ctx, record, output) {
  const handle = await regularFile(record.file);
  try {
    const stat = await handle.stat(), header = Buffer.alloc(20), tag = Buffer.alloc(16);
    if (stat.size !== record.data.encryptedBytes) fail('BACKUP_SIZE_MISMATCH');
    if ((await handle.read(header, 0, 20, 0)).bytesRead !== 20 || (await handle.read(tag, 0, 16, stat.size - 16)).bytesRead !== 16 || !header.subarray(0, 8).equals(MAGIC)) fail('INVALID_PHOTO_HEADER');
    const decipher = createDecipheriv('aes-256-gcm', ctx.masterKey, header.subarray(8));
    decipher.setAAD(record.aad); decipher.setAuthTag(tag);
    const digest = createHash('sha256'); let bytes = 0;
    const counter = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > record.data.bytes) callback(Object.assign(new Error('PHOTO_SIZE_MISMATCH'), { code: 'PHOTO_SIZE_MISMATCH' }));
      else { digest.update(chunk); callback(null, chunk); }
    } });
    try {
      if (record.data.bytes === 0) { decipher.end(); await pipeline(decipher, counter, output); }
      else {
        const chunks = async function* () {
          for (let position = 20; position < stat.size - 16;) {
            const buffer = Buffer.alloc(Math.min(64 * 1024, stat.size - 16 - position));
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
            if (!bytesRead) fail('BACKUP_FILE_CHANGED');
            position += bytesRead; yield buffer.subarray(0, bytesRead);
          }
        };
        await pipeline(Readable.from(chunks()), decipher, counter, output);
      }
    } catch { fail('PHOTO_AUTHENTICATION_FAILED'); }
    if (bytes !== record.data.bytes || digest.digest('hex') !== record.data.sha256) fail('PHOTO_DIGEST_MISMATCH');
    return bytes;
  } finally { await handle.close(); }
}

export async function verifySamples(options) {
  const ctx = await context(options);
  try {
    const length = ctx.manifest.objects.length;
    const indices = [...new Set([0, Math.floor(length / 2), length - 1])].filter(index => index >= 0 && index < length);
    let bytesVerified = 0;
    for (const index of indices) bytesVerified += await decryptPhoto(ctx, await objectRecord(ctx, index), new Writable({ write(_chunk, _encoding, done) { done(); } }));
    return { ok: true, objectsVerified: indices.length, bytesVerified };
  } finally { ctx.masterKey.fill(0); }
}

export async function restoreOne({ index, restoreDirectory, outputName, ...options }) {
  if (typeof outputName !== 'string' || !outputName || outputName === '.' || outputName === '..' || /[\\/\x00-\x1f\x7f]/.test(outputName) || Buffer.byteLength(outputName) > 240) fail('INVALID_OUTPUT_NAME');
  const ctx = await context(options);
  let temporary, temporaryHandle;
  try {
    const record = await objectRecord(ctx, index);
    if (onVolume(path.resolve(restoreDirectory))) fail('RESTORE_TO_PRIVATE_MAC_DIRECTORY');
    const target = await directory(restoreDirectory, { privateMode: true });
    if (onVolume(target.real)) fail('RESTORE_TO_PRIVATE_MAC_DIRECTORY');
    if (inside(target.real, ctx.root)) fail('PLAINTEXT_INSIDE_BACKUP_REJECTED');
    const output = path.join(target.real, outputName);
    try { await fs.lstat(output); fail('OUTPUT_ALREADY_EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    temporary = path.join(target.real, `.studio-photo-restore-${randomBytes(16).toString('hex')}.partial`);
    temporaryHandle = await fs.open(temporary, fileConstants.O_WRONLY | fileConstants.O_CREAT | fileConstants.O_EXCL | fileConstants.O_NOFOLLOW, 0o600);
    await temporaryHandle.chmod(0o600);
    const sink = new Writable({ write(chunk, _encoding, done) {
      (async () => {
        let offset = 0;
        while (offset < chunk.length) {
          const { bytesWritten } = await temporaryHandle.write(chunk, offset, chunk.length - offset);
          if (!bytesWritten) fail('RESTORE_WRITE_FAILED');
          offset += bytesWritten;
        }
      })().then(() => done(), done);
    } });
    const bytes = await decryptPhoto(ctx, record, sink);
    await temporaryHandle.sync(); await temporaryHandle.close(); temporaryHandle = undefined;
    const checked = await directory(target.real, { privateMode: true });
    if (checked.dev !== target.dev || checked.ino !== target.ino) fail('RESTORE_DIRECTORY_CHANGED');
    // link() publishes an already-verified inode atomically and fails if any
    // file or symlink appeared at the destination. rename() could overwrite it.
    try { await fs.link(temporary, output); } catch (error) { if (error.code === 'EEXIST') fail('OUTPUT_ALREADY_EXISTS'); throw error; }
    return { ok: true, index, bytes, restoreVerified: true };
  } finally {
    try { await temporaryHandle?.close(); }
    finally {
      try { if (temporary) await fs.rm(temporary, { force: true }); }
      finally { ctx.masterKey.fill(0); }
    }
  }
}

function parse(args, allowed) {
  const result = Object.create(null);
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index].startsWith('--') ? args[index].slice(2) : '';
    if (!allowed.includes(name) || Object.hasOwn(result, name) || !args[index + 1]) fail('INVALID_ARGUMENTS');
    result[name] = args[index + 1];
  }
  return result;
}

async function main() {
  const mode = process.argv[2], common = ['backup-dir', 'manifest-sha256', 'wrapped-key-sha256', 'private-key'];
  if (!['verify-samples', 'restore-one'].includes(mode)) fail('INVALID_MODE');
  const args = parse(process.argv.slice(3), mode === 'restore-one' ? [...common, 'index', 'restore-dir', 'output'] : common);
  if (common.some(key => !args[key])) fail('INVALID_ARGUMENTS');
  const options = { backupDirectory: args['backup-dir'], expectedManifestSha256: args['manifest-sha256'], expectedWrappedKeySha256: args['wrapped-key-sha256'], privateKeyFile: args['private-key'] };
  let result;
  if (mode === 'verify-samples') result = await verifySamples(options);
  else {
    if (!/^(0|[1-9][0-9]*)$/.test(args.index || '') || !args['restore-dir'] || !args.output) fail('INVALID_ARGUMENTS');
    result = await restoreOne({ ...options, index: Number(args.index), restoreDirectory: args['restore-dir'], outputName: args.output });
  }
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    const code = /^[A-Z_]{3,80}$/.test(error.code || '') ? error.code : 'PHOTO_RESTORE_FAILED';
    console.error(JSON.stringify({ ok: false, code })); process.exitCode = 1;
  });
}

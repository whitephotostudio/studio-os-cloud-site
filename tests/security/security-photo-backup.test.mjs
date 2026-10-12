import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sealManifest, openManifest, validateManifest, buildManifest, presignGet, produceBackupManifest,
  encryptPhotoResponse, verifyEncryptedPhoto, downloadBackup } from '../../scripts/security-photo-backup.mjs';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const format = 'studio-security-photo-manifest-v1';
const backupId = 'security_backup_test_20261011';
const hash = value => createHash('sha256').update(value).digest('hex');
const config = { accountId: 'account', accessKeyId: 'test-access', secretAccessKey: 'test-secret', bucket: 'photos' };
const object = (key, bytes = 3) => ({ source: 'r2', bucket: 'photos', key, size: bytes, etag: 'stable-etag',
  modified: null, url: `https://storage.example.test/${encodeURIComponent(key)}?signed=private-secret` });
const manifest = (objects = [object('student-private/photo.jpg')]) => ({ format, backupId, createdAt: '2026-10-11T12:00:00.000Z',
  objectCount: objects.length, totalBytes: objects.reduce((sum, row) => sum + row.size, 0), objects });
async function temp(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-photo-backup-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('manifest encryption hides object names and signed URLs, authenticates all metadata and rejects another key', () => {
  const original = manifest(), encrypted = sealManifest(original, keys.publicKey);
  assert.deepEqual(openManifest(encrypted, keys.privateKey), original);
  for (const secret of ['student-private', 'private-secret', 'storage.example.test']) assert.equal(encrypted.includes(secret), false);
  const changed = JSON.parse(encrypted.toString()); changed.backupId = 'different_backup_20261011';
  assert.throws(() => openManifest(Buffer.from(JSON.stringify(changed)), keys.privateKey));
  const wrong = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.throws(() => openManifest(encrypted, wrong.privateKey));
  const corrupt = JSON.parse(encrypted.toString());
  const bytes = Buffer.from(corrupt.ciphertext, 'base64'); bytes[0] ^= 1; corrupt.ciphertext = bytes.toString('base64');
  assert.throws(() => openManifest(Buffer.from(JSON.stringify(corrupt)), keys.privateKey));
});

test('manifest validation rejects duplicates, unexpected totals, insecure URLs and missing source metadata', () => {
  assert.throws(() => validateManifest(manifest([object('same'), object('same')])), /DUPLICATE_OBJECT/);
  assert.throws(() => validateManifest({ ...manifest(), totalBytes: 4 }), /INVALID_TOTALS/);
  assert.throws(() => validateManifest(manifest([{ ...object('a'), url: 'http://unsafe.example/a' }])), /INVALID_OBJECT/);
  assert.throws(() => validateManifest(manifest([{ ...object('a'), etag: undefined }])), /INVALID_OBJECT/);
});

test('presigned R2 GET uses seven-day scope and preserves encoded object path components', () => {
  const signed = new URL(presignGet(config, 'a folder//file +#.jpg', new Date('2026-10-11T12:00:00Z')));
  assert.equal(signed.pathname, '/photos/a%20folder//file%20%2B%23.jpg');
  assert.equal(signed.searchParams.get('X-Amz-Expires'), '604800');
  assert.equal(signed.searchParams.get('X-Amz-Date'), '20261011T120000Z');
  assert.match(signed.searchParams.get('X-Amz-Signature'), /^[a-f0-9]{64}$/);
});

test('inventory paginates R2 and recursively inventories every legacy bucket with bounded signing batches', async () => {
  const calls = [], signedBatches = [];
  const r2 = { async send(command) {
    calls.push(command.input);
    return command.input.ContinuationToken ? { Contents: [{ Key: 'last.jpg', Size: 8, ETag: 'r2-last' }] }
      : { Contents: [{ Key: 'first.jpg', Size: 7, ETag: 'r2-first' }], IsTruncated: true, NextContinuationToken: 'next-page' };
  } };
  const supabase = { storage: { from(bucket) { return {
    async list(folder, options) {
      if (bucket === 'photos' && folder === '' && options.offset === 0) return { data: [
        { name: 'student', id: null, metadata: null },
        ...Array.from({ length: 999 }, (_, index) => ({ name: `p${index}.jpg`, id: `id-${index}`, metadata: { size: 1 } }))] };
      if (bucket === 'photos' && folder === '' && options.offset === 1000) return { data: [{ name: 'extra.jpg', id: 'extra', metadata: { size: 2 } }] };
      if (bucket === 'photos' && folder === 'student') return { data: [{ name: 'portrait.jpg', id: 'portrait', metadata: { size: null } }] };
      return { data: [{ name: `${bucket}.jpg`, id: bucket, metadata: { size: 4 } }] };
    },
    async createSignedUrls(names, expires) {
      signedBatches.push({ bucket, names, expires });
      return { data: names.map(name => ({ path: name, signedUrl: `https://legacy.example.test/${bucket}/${name}` })) };
    }
  }; } } };
  let heads = 0;
  const result = await buildManifest({ backupId, r2, supabase, r2Config: config,
    head: async () => { heads += 1; return new Response(null, { headers: { 'content-length': '9', etag: 'head-etag' } }); } });
  assert.equal(result.objectCount, 1005);
  assert.equal(result.totalBytes, 1033);
  assert.equal(calls.length, 2); assert.equal(calls[1].ContinuationToken, 'next-page');
  assert.equal(heads, 1);
  assert.deepEqual(new Set(result.objects.filter(row => row.source === 'supabase').map(row => row.bucket)), new Set(['photos', 'nobg-photos', 'thumbs']));
  assert.equal(result.objects.find(row => row.key === 'student/portrait.jpg').size, 9);
  assert.ok(signedBatches.every(row => row.names.length <= 100 && row.expires === 604800));
});

test('source inventory fails closed on loops, invalid caps and missing legacy objects', async () => {
  const legacy = { storage: { from() { return { list: async () => ({ data: [] }) }; } } };
  const looping = { send: async () => ({ Contents: [], IsTruncated: true, NextContinuationToken: 'repeated' }) };
  await assert.rejects(buildManifest({ backupId, r2: looping, supabase: legacy, r2Config: config }), /INVALID_LIST_PAGINATION/);
  await assert.rejects(buildManifest({ backupId, r2: looping, supabase: legacy, r2Config: config, maxBytes: NaN }), /INVALID_BACKUP_CAP/);
  const r2 = { send: async () => ({ Contents: [{ Key: 'too-large', Size: 11 }] }) };
  await assert.rejects(buildManifest({ backupId, r2, supabase: legacy, r2Config: config, maxBytes: 10 }), /BACKUP_CAP_EXCEEDED/);
  const missing = { storage: { from() { return { list: async () => ({ error: new Error('private diagnostic') }) }; } } };
  await assert.rejects(buildManifest({ backupId, r2: { send: async () => ({}) }, supabase: missing, r2Config: config }), /LEGACY_LIST_FAILED/);
});

test('streamed photo backup restores byte count and SHA256 without writing source bytes', async t => {
  const directory = await temp(t), key = randomBytes(32), aad = Buffer.from('bound-photo-metadata');
  const source = Buffer.from('private-test-photo-pixels'.repeat(10000)), file = path.join(directory, 'photo.enc');
  const record = await encryptPhotoResponse(new Response(source, { headers: { 'content-length': String(source.length) } }), file, key, aad, source.length);
  assert.equal(record.sha256, hash(source));
  assert.deepEqual(await verifyEncryptedPhoto(file, key, aad, record), { bytes: source.length, sha256: hash(source) });
  assert.equal((await fs.readFile(file)).includes(Buffer.from('private-test-photo-pixels')), false);
  await assert.rejects(verifyEncryptedPhoto(file, key, Buffer.from('different-photo'), record));
  const content = await fs.readFile(file); content[25] ^= 1; await fs.writeFile(file, content);
  await assert.rejects(verifyEncryptedPhoto(file, key, aad, record));
});

test('streamed empty objects verify and truncated source bodies fail closed', async t => {
  const directory = await temp(t), key = randomBytes(32), aad = Buffer.from('empty');
  const empty = path.join(directory, 'empty.enc');
  const record = await encryptPhotoResponse(new Response(Buffer.alloc(0)), empty, key, aad, 0);
  assert.deepEqual(await verifyEncryptedPhoto(empty, key, aad, record), { bytes: 0, sha256: hash(Buffer.alloc(0)) });
  await assert.rejects(encryptPhotoResponse(new Response(Buffer.from('short')), path.join(directory, 'short.enc'), key, aad, 6), /SOURCE_SIZE_CHANGED/);
});

test('local backup encrypts every object, verifies restore samples and safely resumes without downloading again', async t => {
  const directory = await temp(t), keyDirectory = path.join(directory, 'mac-keys'), destination = path.join(directory, 'external-drive');
  await fs.mkdir(keyDirectory, { mode: 0o700 });
  const privateKeyFile = path.join(keyDirectory, 'manifest-private.pem'), manifestFile = path.join(directory, 'manifest.enc');
  await fs.writeFile(privateKeyFile, keys.privateKey, { mode: 0o600 });
  const sources = [Buffer.from('sensitive-photo-A'), Buffer.from('sensitive-photo-BB'), Buffer.from('sensitive-photo-CCC')];
  const sourceManifest = manifest(sources.map((source, index) => object(`student/name/photo-${index}.jpg`, source.length)));
  await fs.writeFile(manifestFile, sealManifest(sourceManifest, keys.publicKey));
  let downloads = 0;
  const fetcher = async (url, options) => {
    downloads += 1;
    assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    assert.equal(options.headers['If-Match'], '"stable-etag"');
    const index = sourceManifest.objects.findIndex(row => row.url === url);
    return new Response(sources[index], { headers: { etag: '"stable-etag"', 'content-length': String(sources[index].length) } });
  };
  const options = { manifestFile, expectedManifestSha256: hash(await fs.readFile(manifestFile)), privateKeyFile, keyDirectory, destination, fetcher };
  const summary = await downloadBackup(options);
  assert.equal(summary.objectCount, 3); assert.equal(summary.restoreSamplesVerified, 3); assert.equal(downloads, 3);
  const root = path.join(destination, backupId), files = await fs.readdir(path.join(root, 'objects'));
  assert.equal(files.length, 6); assert.ok(files.every(name => /^[a-f0-9]{64}\.enc(?:\.json)?$/.test(name)));
  for (const name of files) {
    const content = await fs.readFile(path.join(root, 'objects', name));
    for (const secret of ['sensitive-photo', 'student/name', 'private-secret']) assert.equal(content.includes(secret), false);
  }
  assert.deepEqual(await downloadBackup(options), summary); assert.equal(downloads, 3);
  assert.deepEqual(await downloadBackup({ ...options, concurrency: 16 }), summary); assert.equal(downloads, 3);
  await fs.rm(path.join(keyDirectory, `photo-backup-${backupId}.key`));
  assert.deepEqual(await downloadBackup(options), summary); assert.equal(downloads, 3, 'RSA private key can recover the wrapped backup key');
  const corrupt = files.find(name => name.endsWith('.enc'));
  await fs.writeFile(path.join(root, 'objects', corrupt), 'corrupt-ciphertext');
  assert.deepEqual(await downloadBackup(options), summary); assert.equal(downloads, 4);
  assert.equal((await fs.stat(path.join(keyDirectory, `photo-backup-${backupId}.key`))).mode & 0o077, 0);
  assert.equal((await fs.readdir(root)).some(name => name.endsWith('.key') || name.endsWith('.pem')), false);
  assert.equal((await fs.readFile(path.join(root, 'key.enc'))).includes(Buffer.from(backupId)), false);
});

test('backup refuses readable private keys, colocated keys and unsafe concurrency', async t => {
  const directory = await temp(t), keyDirectory = path.join(directory, 'keys'), destination = path.join(directory, 'external');
  await fs.mkdir(keyDirectory, { mode: 0o700 });
  const privateKeyFile = path.join(keyDirectory, 'private.pem'), manifestFile = path.join(directory, 'manifest.enc');
  await fs.writeFile(privateKeyFile, keys.privateKey, { mode: 0o644 });
  await fs.writeFile(manifestFile, sealManifest(manifest(), keys.publicKey));
  const options = { privateKeyFile, manifestFile, expectedManifestSha256: hash(await fs.readFile(manifestFile)), keyDirectory, destination };
  await assert.rejects(downloadBackup(options), /PRIVATE_KEY_FILE_REQUIRED/);
  await fs.chmod(privateKeyFile, 0o600);
  await assert.rejects(downloadBackup({ ...options, keyDirectory: path.join(destination, 'keys') }), /BACKUP_KEYS_MUST_BE_SEPARATE/);
  await assert.rejects(downloadBackup({ ...options, concurrency: NaN }), /INVALID_CONCURRENCY/);
  await assert.rejects(downloadBackup({ ...options, concurrency: 17 }), /INVALID_CONCURRENCY/);
  await assert.rejects(downloadBackup({ ...options, concurrency: 0 }), /INVALID_CONCURRENCY/);
});

test('backup requires the trusted producer hash before decoding or downloading a manifest',async t=>{
  const directory=await temp(t), manifestFile=path.join(directory,'manifest.enc');
  await fs.writeFile(manifestFile,sealManifest(manifest(),keys.publicKey));
  const options={manifestFile,keyDirectory:path.join(directory,'keys'),privateKeyFile:path.join(directory,'missing.pem'),destination:path.join(directory,'external')};
  await assert.rejects(downloadBackup(options),/EXPECTED_MANIFEST_HASH_REQUIRED/);
  await assert.rejects(downloadBackup({...options,expectedManifestSha256:'0'.repeat(64)}),/MANIFEST_HASH_MISMATCH/);
  assert.equal(await fs.stat(options.destination).then(()=>true,()=>false),false,'hash failure occurs before destination/key mutations');
});

test('physical key separation rejects symlinked ancestors and destination aliases',async t=>{
  const directory=await temp(t), destination=path.join(directory,'external'), nested=path.join(destination,'keys');
  await fs.mkdir(nested,{recursive:true,mode:0o700});
  const privateKeyFile=path.join(nested,'private.pem'), manifestFile=path.join(directory,'manifest.enc');
  await fs.writeFile(privateKeyFile,keys.privateKey,{mode:0o600});
  await fs.writeFile(manifestFile,sealManifest(manifest(),keys.publicKey));
  const alias=path.join(directory,'alias'); await fs.symlink(destination,alias,'dir');
  const options={manifestFile,expectedManifestSha256:hash(await fs.readFile(manifestFile)),destination};
  await assert.rejects(downloadBackup({...options,keyDirectory:path.join(alias,'keys'),privateKeyFile:path.join(alias,'keys','private.pem')}),/BACKUP_KEYS_MUST_BE_SEPARATE/);
  const outsideKeys=path.join(directory,'outside-keys');await fs.mkdir(outsideKeys,{mode:0o700});
  await assert.rejects(downloadBackup({...options,keyDirectory:outsideKeys,privateKeyFile:path.join(alias,'keys','private.pem')}),/BACKUP_KEYS_MUST_BE_SEPARATE/);
  assert.equal(await fs.stat(path.join(nested,`photo-backup-${backupId}.key`)).then(()=>true,()=>false),false);
});

test('production backup producer is inert without its explicit one-time opt-in', async () => {
  assert.deepEqual(await produceBackupManifest({}), { ok: true, skipped: true });
  await assert.rejects(produceBackupManifest({ STUDIO_SECURITY_PHOTO_BACKUP_ENABLED: 'produce-v1', STUDIO_SECURITY_PHOTO_BACKUP_ID: backupId }), /BACKUP_CONFIGURATION_MISSING/);
});

test('download CLI rejects an out-of-bounds worker count before reading private files', () => {
  const script = fileURLToPath(new URL('../../scripts/security-photo-backup.mjs', import.meta.url));
  for (const concurrency of ['17', '0', '1.5']) {
    const result = spawnSync(process.execPath, [script, 'download', '--manifest', '/missing/manifest.enc',
      '--manifest-sha256', 'a'.repeat(64), '--private-key', '/missing/private.pem', '--key-dir', '/missing/keys',
      '--destination', '/missing/destination', '--concurrency', concurrency], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.deepEqual(JSON.parse(result.stderr.trim()), { ok: false, code: 'INVALID_CONCURRENCY' });
  }
});

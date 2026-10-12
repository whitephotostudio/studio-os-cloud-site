import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, createHash, publicEncrypt, constants } from 'node:crypto';
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
const receiptFormat = 'studio-security-photo-authenticity-receipt-v1';
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
  const partial = path.join(directory, 'short.enc');
  await assert.rejects(encryptPhotoResponse(new Response(Buffer.from('short')), partial, key, aad, 6), /SOURCE_SIZE_CHANGED/);
  assert.equal(await fs.lstat(partial).then(() => true, () => false), false, 'failed encryption removes only its own incomplete file');
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

async function receiptFixture(t) {
  const directory = await temp(t), keyDirectory = path.join(directory, 'mac-keys'), destination = path.join(directory, 'encrypted-drive');
  await fs.mkdir(keyDirectory, { mode: 0o700 });
  const privateKeyFile = path.join(keyDirectory, 'private.pem'), manifestFile = path.join(directory, 'manifest.enc');
  await fs.writeFile(privateKeyFile, keys.privateKey, { mode: 0o600 });
  const encrypted = sealManifest(manifest(), keys.publicKey); await fs.writeFile(manifestFile, encrypted);
  const root = path.join(destination, backupId), wrappedFile = path.join(root, 'key.enc');
  const keyFile = path.join(keyDirectory, `photo-backup-${backupId}.key`);
  const receiptFile = path.join(keyDirectory, `photo-backup-${backupId}.authenticity-receipt.json`);
  let reads = 0;
  const options = { manifestFile, expectedManifestSha256: hash(encrypted), privateKeyFile, keyDirectory, destination,
    fetcher: async () => { reads += 1; return new Response(Buffer.from('img'), { headers: { etag: 'stable-etag', 'content-length': '3' } }); } };
  const wrap = key => publicEncrypt({ key: keys.publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(JSON.stringify({ backupId, key: key.toString('base64') })));
  return { directory, root, wrappedFile, keyFile, receiptFile, keyDirectory, options, wrap, reads: () => reads };
}

test('writer automatically retains both trusted digests in a private per-backup receipt before downloading photos', async t => {
  const f = await receiptFixture(t), originalFetcher = f.options.fetcher;
  f.options.fetcher = async (...args) => {
    const receipt = JSON.parse(await fs.readFile(f.receiptFile, 'utf8'));
    assert.deepEqual(receipt, { format: receiptFormat, backupId, manifestSha256: f.options.expectedManifestSha256,
      keyEnvelopeSha256: hash(await fs.readFile(f.wrappedFile)) });
    return originalFetcher(...args);
  };
  const summary = await downloadBackup(f.options), receiptBytes = await fs.readFile(f.receiptFile);
  assert.equal((await fs.stat(f.receiptFile)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(f.receiptFile)).nlink, 1);
  assert.equal((await fs.readdir(f.root)).some(name => name.includes('authenticity-receipt')), false);
  for (const value of [keys.privateKey.slice(0, 30), 'student-private', 'private-secret', 'storage.example.test',
    (await fs.readFile(f.keyFile)).toString('base64')]) assert.equal(receiptBytes.includes(value), false);
  assert.deepEqual(await downloadBackup(f.options), summary);
  assert.deepEqual(await fs.readFile(f.receiptFile), receiptBytes, 'resume preserves the existing trusted receipt');
  assert.equal(f.reads(), 1);
  await fs.rm(f.keyFile);
  assert.deepEqual(await downloadBackup(f.options), summary, 'trusted digest permits recovery of a missing protected master key');
  assert.equal(f.reads(), 1);
});

test('existing protected master key can establish a receipt for an older backup without replacing its envelope', async t => {
  const f = await receiptFixture(t); await downloadBackup(f.options);
  const wrapped = await fs.readFile(f.wrappedFile), protectedKey = await fs.readFile(f.keyFile);
  await fs.rm(f.receiptFile);
  await downloadBackup(f.options);
  assert.deepEqual(await fs.readFile(f.wrappedFile), wrapped);
  assert.deepEqual(await fs.readFile(f.keyFile), protectedKey);
  assert.equal(JSON.parse(await fs.readFile(f.receiptFile, 'utf8')).keyEnvelopeSha256, hash(wrapped));
  assert.equal(f.reads(), 1);
});

test('unanchored USB-only wrapped keys cannot be adopted as a new trusted master key or receipt', async t => {
  const f = await receiptFixture(t); await fs.mkdir(f.root, { recursive: true });
  await fs.writeFile(f.wrappedFile, f.wrap(randomBytes(32)));
  await assert.rejects(downloadBackup(f.options), /TRUSTED_BACKUP_KEY_REQUIRED/);
  for (const file of [f.keyFile, f.receiptFile]) assert.equal(await fs.lstat(file).then(() => true, () => false), false);
  assert.equal(f.reads(), 0);
});

test('substituted envelope never changes the protected key or authenticates replacement photo records', async t => {
  const f = await receiptFixture(t); await downloadBackup(f.options);
  const receipt = await fs.readFile(f.receiptFile), protectedKey = await fs.readFile(f.keyFile);
  await fs.writeFile(f.wrappedFile, f.wrap(randomBytes(32)));
  await assert.rejects(downloadBackup(f.options), /TRUSTED_RECEIPT_MISMATCH/);
  assert.deepEqual(await fs.readFile(f.receiptFile), receipt);
  assert.deepEqual(await fs.readFile(f.keyFile), protectedKey);
  await fs.rm(f.receiptFile);
  await assert.rejects(downloadBackup(f.options), /BACKUP_KEY_MISMATCH/);
  assert.equal(await fs.lstat(f.receiptFile).then(() => true, () => false), false);
  assert.equal(f.reads(), 1);
});

test('inconsistent trusted receipts fail without downloads, overwrites or silent rewrapping', async t => {
  const f = await receiptFixture(t); await downloadBackup(f.options);
  const original = await fs.readFile(f.receiptFile), wrapped = await fs.readFile(f.wrappedFile);
  for (const field of ['format', 'backupId', 'manifestSha256', 'keyEnvelopeSha256']) {
    const altered = JSON.parse(original); altered[field] = field.endsWith('Sha256') ? '0'.repeat(64) : 'inconsistent_fixture_value';
    const bytes = Buffer.from(JSON.stringify(altered)); await fs.writeFile(f.receiptFile, bytes);
    await assert.rejects(downloadBackup(f.options), /TRUSTED_RECEIPT_MISMATCH/);
    assert.deepEqual(await fs.readFile(f.receiptFile), bytes); assert.deepEqual(await fs.readFile(f.wrappedFile), wrapped);
  }
  await fs.writeFile(f.receiptFile, original); await fs.rm(f.wrappedFile);
  await assert.rejects(downloadBackup(f.options), /TRUSTED_RECEIPT_MISMATCH/);
  assert.equal(await fs.lstat(f.wrappedFile).then(() => true, () => false), false);
  assert.equal(f.reads(), 1);
});

test('receipt refuses symlinks, hard links, nonprivate files and nonprivate key directories', async t => {
  const f = await receiptFixture(t); await downloadBackup(f.options);
  const original = await fs.readFile(f.receiptFile), alternate = path.join(f.directory, 'preserved-receipt.json');
  await fs.rename(f.receiptFile, alternate); await fs.symlink(alternate, f.receiptFile);
  await assert.rejects(downloadBackup(f.options)); assert.deepEqual(await fs.readFile(alternate), original);
  await fs.rm(f.receiptFile); await fs.link(alternate, f.receiptFile);
  await assert.rejects(downloadBackup(f.options), /PRIVATE_KEY_FILE_REQUIRED/);
  await fs.rm(f.receiptFile); await fs.rename(alternate, f.receiptFile);
  await fs.chmod(f.receiptFile, 0o644); await assert.rejects(downloadBackup(f.options), /PRIVATE_KEY_FILE_REQUIRED/);
  assert.equal((await fs.stat(f.receiptFile)).mode & 0o777, 0o644, 'unsafe existing receipts are rejected rather than blessed by chmod');
  await fs.chmod(f.receiptFile, 0o600); await fs.chmod(f.keyDirectory, 0o755);
  await assert.rejects(downloadBackup(f.options), /PRIVATE_KEY_DIRECTORY_REQUIRED/);
  await fs.chmod(f.keyDirectory, 0o700);
  const alias = path.join(f.directory, 'key-directory-alias'); await fs.symlink(f.keyDirectory, alias);
  await assert.rejects(downloadBackup({ ...f.options, keyDirectory: alias }), /PRIVATE_KEY_DIRECTORY_REQUIRED/);
  assert.equal(f.reads(), 1);
});

test('manifest authentication failure cannot create a trusted receipt or protected master key', async t => {
  const f = await receiptFixture(t), envelope = JSON.parse(await fs.readFile(f.options.manifestFile, 'utf8'));
  const tag = Buffer.from(envelope.tag, 'base64'); tag[0] ^= 1; envelope.tag = tag.toString('base64');
  const encrypted = Buffer.from(JSON.stringify(envelope)); await fs.writeFile(f.options.manifestFile, encrypted);
  await assert.rejects(downloadBackup({ ...f.options, expectedManifestSha256: hash(encrypted) }));
  for (const file of [f.keyFile, f.receiptFile]) assert.equal(await fs.lstat(file).then(() => true, () => false), false);
  assert.equal(f.reads(), 0);
});

async function outputFixture(t) {
  const f = await receiptFixture(t); await downloadBackup(f.options);
  const objectDirectory = path.join(f.root, 'objects');
  const cipherFile = path.join(objectDirectory, (await fs.readdir(objectDirectory)).find(name => name.endsWith('.enc')));
  const protectedFiles = [f.options.privateKeyFile, f.keyFile, f.receiptFile];
  const originals = await Promise.all(protectedFiles.map(file => fs.readFile(file)));
  const sentinels = originals.map((_bytes, index) => path.join(f.keyDirectory, `preserved-sentinel-${index}`));
  for (let index = 0; index < sentinels.length; index += 1) await fs.writeFile(sentinels[index], originals[index], { mode: 0o600 });
  const unchanged = async () => {
    for (let index = 0; index < originals.length; index += 1) {
      assert.deepEqual(await fs.readFile(protectedFiles[index]), originals[index]);
      assert.deepEqual(await fs.readFile(sentinels[index]), originals[index]);
    }
    for (const directory of [f.root, objectDirectory]) assert.equal((await fs.readdir(directory)).some(name => name.includes('.partial-')), false);
  };
  return { ...f, objectDirectory, cipherFile, recordFile: `${cipherFile}.json`, sentinels, unchanged };
}

test('each external final output rejects planted symlinks and hard links without changing protected RSA, master key or receipt bytes', async t => {
  const outputs = ['manifest', 'verification', 'ciphertext', 'record', 'wrapped-key'];
  for (const [index, output] of outputs.entries()) for (const link of ['symlink', 'hard-link']) {
    await t.test(`${output} ${link}`, async child => {
      const f = await outputFixture(child);
      const files = { manifest: path.join(f.root, 'manifest.enc'), verification: path.join(f.root, 'verification.json'),
        ciphertext: f.cipherFile, record: f.recordFile, 'wrapped-key': f.wrappedFile };
      const file = files[output]; await fs.rm(file);
      if (link === 'symlink') await fs.symlink(f.sentinels[index % 3], file);
      else await fs.link(f.sentinels[index % 3], file);
      await assert.rejects(downloadBackup(f.options), /INVALID_BACKUP_OUTPUT/);
      await f.unchanged(); assert.equal(f.reads(), 1, 'unsafe existing output is rejected before new downloads');
      assert.equal((await fs.lstat(file)).isSymbolicLink(), link === 'symlink');
    });
  }
});

test('external final outputs reject existing directories and leave no temporary files', async t => {
  for (const output of ['manifest', 'verification', 'ciphertext', 'record', 'wrapped-key']) {
    await t.test(output, async child => {
      const f = await outputFixture(child);
      const files = { manifest: path.join(f.root, 'manifest.enc'), verification: path.join(f.root, 'verification.json'),
        ciphertext: f.cipherFile, record: f.recordFile, 'wrapped-key': f.wrappedFile };
      await fs.rm(files[output]); await fs.mkdir(files[output]);
      await assert.rejects(downloadBackup(f.options), /INVALID_BACKUP_OUTPUT/);
      assert.deepEqual(await fs.readdir(files[output]), []); await f.unchanged(); assert.equal(f.reads(), 1);
    });
  }
});

test('legacy predictable record partial links are never opened while ordinary repair and resume still succeed', async t => {
  for (const link of ['symlink', 'hard-link']) await t.test(link, async child => {
    const f = await outputFixture(child), legacyPartial = `${f.recordFile}.partial`;
    if (link === 'symlink') await fs.symlink(f.sentinels[1], legacyPartial);
    else await fs.link(f.sentinels[1], legacyPartial);
    await fs.rm(f.cipherFile); await fs.rm(f.recordFile);
    const summary = await downloadBackup(f.options); assert.equal(summary.ok, true); assert.equal(f.reads(), 2);
    await f.unchanged(); assert.equal((await fs.lstat(legacyPartial)).isSymbolicLink(), link === 'symlink');
    assert.deepEqual(await downloadBackup(f.options), summary); assert.equal(f.reads(), 2);
  });
});

test('a final record or verification link planted after preflight cannot redirect atomic publication', async t => {
  for (const output of ['record', 'verification']) await t.test(output, async child => {
    const f = await outputFixture(child), file = output === 'record' ? f.recordFile : path.join(f.root, 'verification.json');
    await fs.rm(f.cipherFile); await fs.rm(f.recordFile);
    const fetcher = f.options.fetcher;
    f.options.fetcher = async (...args) => {
      await fs.rm(file, { force: true }); await fs.symlink(f.sentinels[2], file); return fetcher(...args);
    };
    await assert.rejects(downloadBackup(f.options), /INVALID_BACKUP_OUTPUT/);
    await f.unchanged(); assert.equal(f.reads(), 2);
  });
});

test('exclusive cipher creation preserves preexisting link targets and removes no file it did not create', async t => {
  for (const link of ['symlink', 'hard-link']) await t.test(link, async child => {
    const directory = await temp(child), sentinel = path.join(directory, 'protected-sentinel'), file = path.join(directory, 'cipher.partial');
    const original = Buffer.from(keys.privateKey); await fs.writeFile(sentinel, original, { mode: 0o600 });
    if (link === 'symlink') await fs.symlink(sentinel, file); else await fs.link(sentinel, file);
    await assert.rejects(encryptPhotoResponse(new Response(Buffer.from('img')), file, randomBytes(32), Buffer.from('bound'), 3), error => error.code === 'EEXIST');
    assert.deepEqual(await fs.readFile(sentinel), original); assert.equal((await fs.lstat(file)).isSymbolicLink(), link === 'symlink');
  });
});

test('mid-stream cipher pathname substitution cannot redirect body or GCM-tag writes into a protected file', async t => {
  for (const link of ['symlink', 'hard-link']) await t.test(link, async child => {
    const directory = await temp(child), sentinel = path.join(directory, 'protected-sentinel'), file = path.join(directory, 'cipher.partial');
    const original = Buffer.from(keys.privateKey), source = Buffer.from('synthetic-photo-body');
    await fs.writeFile(sentinel, original, { mode: 0o600 }); let substituted = false;
    const stream = new ReadableStream({ async pull(controller) {
      assert.equal((await fs.lstat(file)).isFile(), true, 'exclusive header has already been created');
      await fs.rm(file); if (link === 'symlink') await fs.symlink(sentinel, file); else await fs.link(sentinel, file);
      substituted = true; controller.enqueue(source); controller.close();
    } }, { highWaterMark: 0 });
    await assert.rejects(encryptPhotoResponse(new Response(stream, { headers: { 'content-length': String(source.length) } }),
      file, randomBytes(32), Buffer.from('bound'), source.length), /BACKUP_OUTPUT_CHANGED/);
    assert.equal(substituted, true); assert.deepEqual(await fs.readFile(sentinel), original);
    assert.equal(await fs.lstat(file).then(() => true, () => false), false, 'substituted temporary path is cleaned without touching its target');
  });
});

test('backup refuses readable private keys, colocated keys and unsafe concurrency', async t => {
  const directory = await temp(t), keyDirectory = path.join(directory, 'keys'), destination = path.join(directory, 'external');
  await fs.mkdir(keyDirectory, { mode: 0o700 });
  const privateKeyFile = path.join(keyDirectory, 'private.pem'), manifestFile = path.join(directory, 'manifest.enc');
  await fs.writeFile(privateKeyFile, keys.privateKey, { mode: 0o644 });
  await fs.chmod(privateKeyFile, 0o644);
  await fs.writeFile(manifestFile, sealManifest(manifest(), keys.publicKey));
  const options = { privateKeyFile, manifestFile, expectedManifestSha256: hash(await fs.readFile(manifestFile)), keyDirectory, destination,
    fetcher: async () => { assert.fail('unsafe key setup must never reach source downloads'); } };
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

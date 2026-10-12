import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateKeyPairSync, createHash, createHmac, publicEncrypt, constants } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sealManifest, downloadBackup, encryptPhotoResponse } from '../../scripts/security-photo-backup.mjs';
import { verifySamples, restoreOne } from '../../scripts/security-photo-restore.mjs';

const pair = () => generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const keys = pair(), backupId = 'offline_restore_fixture_20261012';
const digest = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest('hex');
const script = fileURLToPath(new URL('../../scripts/security-photo-restore.mjs', import.meta.url));

async function fixture(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'studio-photo-restore-test-')));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const keyDirectory = path.join(directory, 'keys'), destination = path.join(directory, 'encrypted-backups'), restoreDirectory = path.join(directory, 'restore');
  await fs.mkdir(keyDirectory, { mode: 0o700 }); await fs.mkdir(restoreDirectory, { mode: 0o700 });
  const privateKeyFile = path.join(keyDirectory, 'private.pem'), manifestFile = path.join(directory, 'producer-manifest.enc');
  await fs.writeFile(privateKeyFile, keys.privateKey, { mode: 0o600 });
  const sources = [Buffer.alloc(0), Buffer.from('sensitive-fixture-student-photo'), Buffer.from('streamed-private-photo'.repeat(60000))];
  const objects = sources.map((source, index) => ({ source: index === 1 ? 'supabase' : 'r2', bucket: 'photos',
    key: index === 2 ? '../../student-private/portrait.jpg' : `student-private/photo-${index}.jpg`, size: source.length,
    etag: `fixture-etag-${index}`, url: `https://private.example.test/${index}?signed=fixture-secret` }));
  const manifest = { format: 'studio-security-photo-manifest-v1', backupId, objectCount: objects.length, totalBytes: sources.reduce((total, source) => total + source.length, 0), objects };
  const encrypted = sealManifest(manifest, keys.publicKey); await fs.writeFile(manifestFile, encrypted);
  await downloadBackup({ manifestFile, expectedManifestSha256: digest(encrypted), privateKeyFile, keyDirectory, destination,
    fetcher: async url => {
      const index = objects.findIndex(object => object.url === url);
      return new Response(sources[index], { headers: { etag: objects[index].etag, 'content-length': String(sources[index].length) } });
    } });
  const backupDirectory = path.join(destination, backupId), masterKey = await fs.readFile(path.join(keyDirectory, `photo-backup-${backupId}.key`));
  const options = { backupDirectory, privateKeyFile, expectedManifestSha256: digest(encrypted), expectedWrappedKeySha256: digest(await fs.readFile(path.join(backupDirectory, 'key.enc'))) };
  const objectFile = index => path.join(backupDirectory, 'objects', `${hmac(masterKey, JSON.stringify([objects[index].source, objects[index].bucket, objects[index].key]))}.enc`);
  const restore = (extra = {}) => restoreOne({ ...options, index: 1, restoreDirectory, outputName: 'chosen-portrait.jpg', ...extra });
  const record = async (index, mutate, sign = false) => {
    const file = `${objectFile(index)}.json`, value = JSON.parse(await fs.readFile(file, 'utf8'));
    mutate(value); if (sign) value.mac = hmac(masterKey, JSON.stringify(value.data));
    await fs.writeFile(file, JSON.stringify(value));
  };
  return { directory, keyDirectory, backupDirectory, restoreDirectory, masterKey, sources, objects, manifest, options, objectFile, restore, record };
}

async function noPlaintext(f) { assert.deepEqual(await fs.readdir(f.restoreDirectory), []); }

test('actual backup writer roundtrips empty, legacy and streamed objects into owner-chosen private files', async t => {
  const f = await fixture(t);
  assert.deepEqual(await verifySamples(f.options), { ok: true, objectsVerified: 3, bytesVerified: f.manifest.totalBytes });
  await noPlaintext(f);
  for (const index of [0, 1, 2]) {
    const outputName = `selected-${index}.bin`;
    assert.deepEqual(await f.restore({ index, outputName }), { ok: true, index, bytes: f.sources[index].length, restoreVerified: true });
    const file = path.join(f.restoreDirectory, outputName);
    assert.deepEqual(await fs.readFile(file), f.sources[index]);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  }
  assert.deepEqual((await fs.readdir(f.restoreDirectory)).sort(), ['selected-0.bin', 'selected-1.bin', 'selected-2.bin']);
  assert.equal(await fs.stat(path.join(f.directory, 'student-private')).then(() => true, () => false), false);
});

test('trusted manifest digest is mandatory and tampering cannot publish plaintext', async t => {
  const f = await fixture(t);
  await assert.rejects(f.restore({ expectedManifestSha256: undefined }), /EXPECTED_MANIFEST_HASH_REQUIRED/);
  await assert.rejects(f.restore({ expectedWrappedKeySha256: undefined }), /EXPECTED_WRAPPED_KEY_HASH_REQUIRED/);
  await assert.rejects(f.restore({ expectedManifestSha256: '0'.repeat(64) }), /MANIFEST_HASH_MISMATCH/);
  const file = path.join(f.backupDirectory, 'manifest.enc'), bytes = await fs.readFile(file); bytes[25] ^= 1; await fs.writeFile(file, bytes);
  await assert.rejects(f.restore(), /MANIFEST_HASH_MISMATCH/);
  await noPlaintext(f);
});

test('wrong RSA key and altered manifest GCM envelope fail closed even with the supplied new digest', async t => {
  const f = await fixture(t), wrong = path.join(f.keyDirectory, 'wrong.pem');
  await fs.writeFile(wrong, pair().privateKey, { mode: 0o600 });
  await assert.rejects(f.restore({ privateKeyFile: wrong }), /MANIFEST_AUTHENTICATION_FAILED/);
  const file = path.join(f.backupDirectory, 'manifest.enc'), envelope = JSON.parse(await fs.readFile(file, 'utf8'));
  const tag = Buffer.from(envelope.tag, 'base64'); tag[0] ^= 1; envelope.tag = tag.toString('base64');
  const encrypted = Buffer.from(JSON.stringify(envelope)); await fs.writeFile(file, encrypted);
  await assert.rejects(f.restore({ expectedManifestSha256: digest(encrypted) }), /MANIFEST_AUTHENTICATION_FAILED/);
  await noPlaintext(f);
});

test('RSA-wrapped master key must bind the same backup ID and contain the correct key', async t => {
  const f = await fixture(t), file = path.join(f.backupDirectory, 'key.enc');
  const wrap = value => publicEncrypt({ key: keys.publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(JSON.stringify(value)));
  let wrapped = wrap({ backupId: 'different_backup_20261012', key: f.masterKey.toString('base64') });
  await fs.writeFile(file, wrapped);
  await assert.rejects(f.restore({ expectedWrappedKeySha256: digest(wrapped) }), /BACKUP_KEY_ID_MISMATCH/);
  wrapped = wrap({ backupId, key: Buffer.alloc(32).toString('base64') }); await fs.writeFile(file, wrapped);
  await assert.rejects(f.restore({ expectedWrappedKeySha256: digest(wrapped) })); // Different object-ID HMAC cannot select any existing record.
  await noPlaintext(f);
});

test('trusted wrapped-key digest rejects public-key master-key substitution and fully forged valid photo records before RSA', async t => {
  const f = await fixture(t), forgedKey = Buffer.alloc(32, 77), object = f.objects[1];
  const wrapped = publicEncrypt({ key: keys.publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(JSON.stringify({ backupId, key: forgedKey.toString('base64') })));
  await fs.writeFile(path.join(f.backupDirectory, 'key.enc'), wrapped);
  const id = hmac(forgedKey, JSON.stringify([object.source, object.bucket, object.key]));
  const aad = Buffer.from(JSON.stringify([backupId, id, object.size, object.etag]));
  const file = path.join(f.backupDirectory, 'objects', `${id}.enc`), forgedPhoto = Buffer.alloc(object.size, 65);
  const data = { ...await encryptPhotoResponse(new Response(forgedPhoto), file, forgedKey, aad, object.size), etag: object.etag };
  await fs.writeFile(`${file}.json`, JSON.stringify({ data, mac: hmac(forgedKey, JSON.stringify(data)) }));
  await assert.rejects(f.restore(), /WRAPPED_KEY_HASH_MISMATCH/);
  await assert.rejects(f.restore({ privateKeyFile: path.join(f.directory, 'missing-private.pem') }), /WRAPPED_KEY_HASH_MISMATCH/);
  await noPlaintext(f);
});

test('authenticated records reject changed byte counts, ETags and malformed MACs before output', async t => {
  const f = await fixture(t), file = `${f.objectFile(1)}.json`, original = await fs.readFile(file);
  for (const mutate of [r => { r.data.bytes += 1; }, r => { r.data.etag = 'foreign'; }, r => { r.mac = 'short'; }]) {
    await fs.writeFile(file, original); await f.record(1, mutate);
    await assert.rejects(f.restore(), /BACKUP_RECORD_MAC_MISMATCH/); await noPlaintext(f);
  }
  await fs.writeFile(file, original); await f.record(1, r => { r.data.encryptedBytes += 1; }, true);
  await assert.rejects(f.restore(), /INVALID_BACKUP_RECORD/); await noPlaintext(f);
});

test('validly authenticated wrong SHA rejects plaintext after streaming and removes temporary output', async t => {
  const f = await fixture(t);
  await f.record(2, r => { r.data.sha256 = '0'.repeat(64); }, true);
  await assert.rejects(f.restore({ index: 2 }), /PHOTO_DIGEST_MISMATCH/); await noPlaintext(f);
});

test('ciphertext, header, GCM tag and truncated-file corruption never publish partial plaintext', async t => {
  const f = await fixture(t), file = f.objectFile(2), original = await fs.readFile(file);
  for (const change of [b => { b[30] ^= 1; return b; }, b => { b[0] ^= 1; return b; }, b => { b[b.length - 1] ^= 1; return b; }, b => b.subarray(0, b.length - 1)]) {
    await fs.writeFile(file, change(Buffer.from(original)));
    await assert.rejects(f.restore({ index: 2 })); await noPlaintext(f);
  }
});

test('copying another valid ciphertext cannot bypass the exact HMAC object identity or AAD', async t => {
  const f = await fixture(t);
  await fs.copyFile(f.objectFile(2), f.objectFile(1));
  await assert.rejects(f.restore(), /BACKUP_SIZE_MISMATCH/); await noPlaintext(f);
  const replacement = { ...f.manifest, objects: f.objects.map((object, index) => index === 2 ? { ...object, etag: 'changed-authenticated-etag' } : object) };
  const encrypted = sealManifest(replacement, keys.publicKey); await fs.writeFile(path.join(f.backupDirectory, 'manifest.enc'), encrypted);
  await f.record(2, r => { r.data.etag = replacement.objects[2].etag; }, true);
  await assert.rejects(f.restore({ index: 2, expectedManifestSha256: digest(encrypted) }), /PHOTO_AUTHENTICATION_FAILED/); await noPlaintext(f);
});

test('output traversal, paths, control characters and invalid indices cannot select arbitrary files', async t => {
  const f = await fixture(t);
  for (const outputName of ['../outside.jpg', '/absolute.jpg', 'sub/photo.jpg', 'sub\\photo.jpg', '.', '..', 'nul\0.jpg', 'line\n.jpg']) await assert.rejects(f.restore({ outputName }), /INVALID_OUTPUT_NAME/);
  for (const index of [-1, 3, 1.5, NaN, '1']) await assert.rejects(f.restore({ index }), /INVALID_OBJECT_INDEX/);
  await noPlaintext(f);
});

test('existing files and dangling output symlinks are preserved without overwriting', async t => {
  const f = await fixture(t), output = path.join(f.restoreDirectory, 'chosen-portrait.jpg');
  await fs.writeFile(output, 'keep-existing');
  await assert.rejects(f.restore(), /OUTPUT_ALREADY_EXISTS/); assert.equal(await fs.readFile(output, 'utf8'), 'keep-existing');
  await fs.rm(output); await fs.symlink(path.join(f.directory, 'missing-target'), output);
  await assert.rejects(f.restore(), /OUTPUT_ALREADY_EXISTS/); assert.equal((await fs.lstat(output)).isSymbolicLink(), true);
});

test('concurrent restoration publishes exactly one verified file with no overwrite or partial files', async t => {
  const f = await fixture(t), results = await Promise.allSettled([f.restore({ index: 2 }), f.restore({ index: 2 })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.code, /OUTPUT_ALREADY_EXISTS/);
  assert.deepEqual(await fs.readFile(path.join(f.restoreDirectory, 'chosen-portrait.jpg')), f.sources[2]);
  assert.deepEqual(await fs.readdir(f.restoreDirectory), ['chosen-portrait.jpg']);
});

test('plaintext destinations reject USB paths, backup directories, unsafe permissions and directory symlinks', async t => {
  const f = await fixture(t);
  await assert.rejects(f.restore({ restoreDirectory: '/Volumes/untrusted/restore' }), /RESTORE_TO_PRIVATE_MAC_DIRECTORY/);
  const nested = path.join(f.backupDirectory, 'restore'); await fs.mkdir(nested, { mode: 0o700 });
  await assert.rejects(f.restore({ restoreDirectory: nested }), /PLAINTEXT_INSIDE_BACKUP_REJECTED/);
  const alias = path.join(f.directory, 'restore-alias'); await fs.symlink(f.restoreDirectory, alias);
  await assert.rejects(f.restore({ restoreDirectory: alias }), /DIRECTORY_SYMLINK_REJECTED/);
  const parentAlias = path.join(f.directory, 'parent-alias'); await fs.symlink(f.directory, parentAlias);
  await assert.rejects(f.restore({ restoreDirectory: path.join(parentAlias, 'restore') }), /DIRECTORY_SYMLINK_REJECTED/);
  await fs.chmod(f.restoreDirectory, 0o755); await assert.rejects(f.restore(), /PRIVATE_DIRECTORY_REQUIRED/);
  await noPlaintext(f); assert.deepEqual(await fs.readdir(nested), []);
});

test('private key requires mode 600, private parent, no symlink and physical separation from the backup', async t => {
  const f = await fixture(t);
  await fs.chmod(f.options.privateKeyFile, 0o644); await assert.rejects(f.restore(), /PRIVATE_KEY_FILE_REQUIRED/);
  await fs.chmod(f.options.privateKeyFile, 0o600); await fs.chmod(f.keyDirectory, 0o755); await assert.rejects(f.restore(), /PRIVATE_DIRECTORY_REQUIRED/);
  await fs.chmod(f.keyDirectory, 0o700);
  const symlink = path.join(f.keyDirectory, 'symlink.pem'); await fs.symlink(f.options.privateKeyFile, symlink); await assert.rejects(f.restore({ privateKeyFile: symlink }));
  const parentAlias = path.join(f.directory, 'key-parent-alias'); await fs.symlink(f.directory, parentAlias);
  await assert.rejects(f.restore({ privateKeyFile: path.join(parentAlias, 'keys', 'private.pem') }), /DIRECTORY_SYMLINK_REJECTED/);
  const nested = path.join(f.backupDirectory, 'keys'); await fs.mkdir(nested, { mode: 0o700 });
  const copiedKey = path.join(nested, 'private.pem'); await fs.writeFile(copiedKey, keys.privateKey, { mode: 0o600 });
  await assert.rejects(f.restore({ privateKeyFile: copiedKey }), /BACKUP_KEYS_MUST_BE_SEPARATE/);
  await noPlaintext(f);
});

test('encrypted objects, records and object directories reject symlink substitution', async t => {
  const f = await fixture(t), file = f.objectFile(1), moved = path.join(f.directory, 'moved.enc');
  await fs.rename(file, moved); await fs.symlink(moved, file); await assert.rejects(f.restore()); await fs.rm(file); await fs.rename(moved, file);
  await fs.rename(`${file}.json`, `${moved}.json`); await fs.symlink(`${moved}.json`, `${file}.json`); await assert.rejects(f.restore());
  const objects = path.join(f.backupDirectory, 'objects'), movedObjects = path.join(f.directory, 'moved-objects');
  await fs.rename(objects, movedObjects); await fs.symlink(movedObjects, objects);
  await assert.rejects(verifySamples(f.options), /DIRECTORY_SYMLINK_REJECTED/); await noPlaintext(f);
});

test('unsafe backup IDs remain rejected even in a trusted re-encrypted manifest', async t => {
  const f = await fixture(t), encrypted = sealManifest({ ...f.manifest, backupId: '../../outside-backup' }, keys.publicKey);
  await fs.writeFile(path.join(f.backupDirectory, 'manifest.enc'), encrypted);
  await assert.rejects(f.restore({ expectedManifestSha256: digest(encrypted) }), /INVALID_MANIFEST/); await noPlaintext(f);
});

test('standalone copied CLI needs only Node built-ins and emits no paths, URLs, names or secrets', async t => {
  const f = await fixture(t), copiedScript = path.join(f.directory, 'offline-restore.mjs'); await fs.copyFile(script, copiedScript);
  const args = ['--backup-dir', f.backupDirectory, '--manifest-sha256', f.options.expectedManifestSha256, '--wrapped-key-sha256', f.options.expectedWrappedKeySha256, '--private-key', f.options.privateKeyFile];
  const verified = spawnSync(process.execPath, [copiedScript, 'verify-samples', ...args], { encoding: 'utf8' });
  assert.equal(verified.status, 0); assert.equal(verified.stderr, ''); assert.equal(JSON.parse(verified.stdout).objectsVerified, 3);
  const restored = spawnSync(process.execPath, [copiedScript, 'restore-one', ...args, '--index', '1', '--restore-dir', f.restoreDirectory, '--output', 'owner-chosen.jpg'], { encoding: 'utf8' });
  assert.equal(restored.status, 0); assert.deepEqual(JSON.parse(restored.stdout), { ok: true, index: 1, bytes: f.sources[1].length, restoreVerified: true });
  const failed = spawnSync(process.execPath, [copiedScript, 'restore-one', ...args, '--index', '1', '--restore-dir', f.restoreDirectory, '--output', '../student-name.jpg'], { encoding: 'utf8' });
  assert.equal(failed.status, 1); assert.deepEqual(JSON.parse(failed.stderr), { ok: false, code: 'INVALID_OUTPUT_NAME' });
  for (const secret of ['student-private', 'fixture-secret', 'private.example.test', 'owner-chosen', f.directory, keys.privateKey.slice(0, 30)]) assert.equal((verified.stdout + restored.stdout + failed.stderr).includes(secret), false);
  const source = await fs.readFile(script, 'utf8');
  const imports = [...source.matchAll(/from '([^']+)'/g)].map(match => match[1]); assert.ok(imports.every(module => module.startsWith('node:')));
  assert.doesNotMatch(source, /\bfetch\s*\(|\bhttps?\.request|\bchild_process\b|@aws-sdk|supabase-js/);
});

test('CLI rejects unknown, duplicate and malformed arguments without opening the backup', () => {
  for (const args of [[], ['verify-samples', '--unknown', 'private'], ['verify-samples', '--backup-dir', 'a', '--backup-dir', 'b'], ['restore-one', '--backup-dir', 'a', '--manifest-sha256', 'a'.repeat(64), '--private-key', 'private', '--index', '1.5', '--restore-dir', 'a', '--output', 'a']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' }); assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stderr).code, /^INVALID_(?:MODE|ARGUMENTS)$/);
  }
});

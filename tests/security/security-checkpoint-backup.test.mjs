import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { checkpointFiles, createCheckpointBackup, verifyCheckpoint, restoreCheckpoint } from '../../scripts/security-checkpoint-backup.mjs';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const checkpointId = 'checkpoint_test_20261012';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-checkpoint-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceDirectory = path.join(root, 'protected-mac'), destination = path.join(root, 'external');
  await fs.mkdir(sourceDirectory, { mode: 0o700 });
  for (const name of ['data-checkpoint.json', 'security-catalog-before.json', 'provider-backups-before.json', 'counts.json']) {
    await fs.writeFile(path.join(sourceDirectory, name), JSON.stringify({ sensitive: 'sensitive-student-data-very-private', name }), { mode: 0o600 });
  }
  await fs.writeFile(path.join(sourceDirectory, 'mfa-rollback.sql'), 'SELECT 1;', { mode: 0o600 });
  const privateKeyFile = path.join(sourceDirectory, 'photo-manifest-private.pem'), publicKeyB64File = path.join(sourceDirectory, 'photo-manifest-public.b64');
  await fs.writeFile(privateKeyFile, keys.privateKey, { mode: 0o600 });
  await fs.writeFile(publicKeyB64File, Buffer.from(keys.publicKey).toString('base64'), { mode: 0o600 });
  await fs.writeFile(path.join(sourceDirectory, 'browser-gallery-fixture.json'), 'private-browser-credential', { mode: 0o600 });
  await fs.writeFile(path.join(sourceDirectory, 'photo-backup-master.key'), 'raw-master-key', { mode: 0o600 });
  await fs.mkdir(path.join(sourceDirectory, 'edge-rollback'), { mode: 0o700 });
  await fs.writeFile(path.join(sourceDirectory, 'edge-rollback', 'index.ts'), 'export const rollback = true;', { mode: 0o600 });
  const originalSource = path.join(root, 'source-code'); await fs.mkdir(originalSource);
  await fs.writeFile(path.join(originalSource, 'source.ts'), 'export const safe = true;');
  const archive = spawnSync('tar', ['-czf', path.join(sourceDirectory, 'cloud-source-test.tar.gz'), '-C', originalSource, 'source.ts']);
  assert.equal(archive.status, 0);
  return { root, sourceDirectory, destination, privateKeyFile, publicKeyB64File, checkpointId,
    archiveFile: path.join(destination, `checkpoint-${checkpointId}.enc`),
    receiptFile: path.join(sourceDirectory, `checkpoint-${checkpointId}.verification.json`) };
}

test('checkpoint selection excludes every private/raw key, base64 key, live browser fixture and hidden temp directory', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.sourceDirectory, 'raw-key.json'), 'raw-key');
  await fs.mkdir(path.join(f.sourceDirectory, '.checkpoint-stage-secret'));
  await fs.writeFile(path.join(f.sourceDirectory, '.checkpoint-stage-secret', 'data.json'), 'secret');
  const names = await checkpointFiles(f.sourceDirectory);
  assert.deepEqual(names, ['cloud-source-test.tar.gz', 'counts.json', 'data-checkpoint.json', 'edge-rollback/index.ts', 'mfa-rollback.sql', 'provider-backups-before.json', 'security-catalog-before.json']);
});

test('checkpoint archive is ciphertext only and verifies a full local decrypt/SHA restore', async t => {
  const f = await fixture(t), result = await createCheckpointBackup(f);
  assert.equal(result.restoreVerified, true); assert.equal(result.fileCount, 7);
  assert.deepEqual(await verifyCheckpoint(f), result);
  const output = await fs.readFile(f.archiveFile);
  for (const secret of ['sensitive-student-data-very-private', 'BEGIN PRIVATE KEY', 'raw-master-key', 'private-browser-credential']) assert.equal(output.includes(secret), false);
  const restoreDirectory = path.join(f.root, 'protected-restored');
  const restored = await restoreCheckpoint({ ...f, restoreDirectory });
  const plaintext = path.join(restoreDirectory, `checkpoint-${checkpointId}.tar.gz`);
  assert.equal(restored.archiveSha256, hash(await fs.readFile(plaintext)));
  assert.equal((await fs.stat(plaintext)).mode & 0o077, 0);
  const listing = spawnSync('tar', ['-tzf', plaintext], { encoding: 'utf8' });
  assert.equal(listing.status, 0); assert.match(listing.stdout, /checkpoint-index\.json/); assert.match(listing.stdout, /data-checkpoint\.json/);
  assert.doesNotMatch(listing.stdout, /\.pem|\.b64|\.key|browser-gallery/);
  assert.equal((await fs.readdir(f.destination)).includes('restore-checkpoint.mjs'), true);
  assert.equal((await fs.readdir(f.destination)).includes('RESTORE-README.md'), true);
  assert.equal((await fs.readdir(f.sourceDirectory)).some(name => name.startsWith('.checkpoint-stage-')), false);
});

test('checkpoint tampering, changed receipt and a different RSA key cannot verify', async t => {
  const f = await fixture(t); await createCheckpointBackup(f);
  const original = await fs.readFile(f.archiveFile), changed = Buffer.from(original); changed[changed.length - 20] ^= 1;
  await fs.writeFile(f.archiveFile, changed);
  await assert.rejects(verifyCheckpoint(f), /CHECKPOINT_CIPHERTEXT_MISMATCH/);
  await fs.writeFile(f.archiveFile, original);
  const receipt = JSON.parse(await fs.readFile(f.receiptFile, 'utf8')); receipt.archiveSha256 = '0'.repeat(64);
  await fs.writeFile(f.receiptFile, JSON.stringify(receipt));
  await assert.rejects(verifyCheckpoint(f), /CHECKPOINT_RESTORE_MISMATCH/);
  const wrongKey = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
  const wrongFile = path.join(f.sourceDirectory, 'wrong.pem'); await fs.writeFile(wrongFile, wrongKey, { mode: 0o600 });
  await assert.rejects(verifyCheckpoint({ ...f, privateKeyFile: wrongFile }));
});

test('existing checkpoint and restored archives are preserved when an ID is repeated', async t => {
  const f = await fixture(t); await createCheckpointBackup(f);
  const original = await fs.readFile(f.archiveFile);
  await assert.rejects(createCheckpointBackup(f), error => error.code === 'EEXIST');
  assert.deepEqual(await fs.readFile(f.archiveFile), original);
  const restoreDirectory = path.join(f.root, 'protected-restored'); await restoreCheckpoint({ ...f, restoreDirectory });
  const restored = path.join(restoreDirectory, `checkpoint-${checkpointId}.tar.gz`), restoredOriginal = await fs.readFile(restored);
  await assert.rejects(restoreCheckpoint({ ...f, restoreDirectory }), error => error.code === 'EEXIST');
  assert.deepEqual(await fs.readFile(restored), restoredOriginal);
});

test('checkpoint refuses a source archive containing a private key and unsafe key permissions', async t => {
  const f = await fixture(t), keySource = path.join(f.root, 'unsafe-source'); await fs.mkdir(keySource);
  await fs.writeFile(path.join(keySource, 'accidental.pem'), 'unsafe-private-key');
  assert.equal(spawnSync('tar', ['-czf', path.join(f.sourceDirectory, 'cloud-source-test.tar.gz'), '-C', keySource, 'accidental.pem']).status, 0);
  await assert.rejects(createCheckpointBackup(f), /PROHIBITED_ARCHIVED_FILE/);
  await fs.chmod(f.privateKeyFile, 0o644);
  await assert.rejects(createCheckpointBackup(f), /PRIVATE_FILE_REQUIRED/);
});

test('checkpoint refuses colocated keys, missing recovery data, source symlinks and unbounded caps', async t => {
  const f = await fixture(t);
  await assert.rejects(createCheckpointBackup({ ...f, destination: f.sourceDirectory }), /BACKUP_KEYS_MUST_BE_SEPARATE/);
  await assert.rejects(createCheckpointBackup({ ...f, maxBytes: NaN }), /INVALID_ARCHIVE_CAP/);
  await fs.symlink(path.join(f.root, 'elsewhere'), path.join(f.sourceDirectory, 'linked.json'));
  await assert.rejects(createCheckpointBackup(f), /SOURCE_SYMLINK_REJECTED/);
  await fs.rm(path.join(f.sourceDirectory, 'linked.json')); await fs.rm(path.join(f.sourceDirectory, 'data-checkpoint.json'));
  await assert.rejects(createCheckpointBackup(f), /REQUIRED_CHECKPOINT_MISSING/);
});

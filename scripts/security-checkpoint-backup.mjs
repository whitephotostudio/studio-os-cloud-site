#!/usr/bin/env node
// Local-only encrypted checkpoint archive. Source data and keys stay on the Mac.
import { promises as fs, constants as fileConstants, createReadStream, createWriteStream } from 'node:fs';
import { createHash, createCipheriv, createDecipheriv, createPublicKey, createPrivateKey, publicEncrypt, privateDecrypt, randomBytes, constants } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MAGIC = Buffer.from('SOSCKB01'), FORMAT = 'studio-security-checkpoint-v1';
const GIB = 1024 ** 3, MAX_HEADER = 16 * 1024;
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{12,80}$/.test(value);
const inside = (file, directory) => file === directory || file.startsWith(`${directory}${path.sep}`);
const excluded = name => name.startsWith('.') || /\.(?:pem|key|p12|pfx|der|b64)$/i.test(name) ||
  /browser.*fixture|fixture.*browser|(?:^|[-_.])(?:master|raw|private|public)[-_.]?(?:keys?|keypair)(?:[-_.]|$)|(?:^|[-_.])keys?(?:[-_.]|$)/i.test(name);
const allowed = name => /\.(?:json|sql|ts|md)$/i.test(name) || /^cloud-source-[a-zA-Z0-9_-]+\.tar(?:\.gz)?$/.test(name);

async function hashFile(file) {
  const digest = createHash('sha256');
  await pipeline(createReadStream(file), new Writable({ write(chunk, _encoding, callback) { digest.update(chunk); callback(); } }));
  return digest.digest('hex');
}
async function privateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) fail('PRIVATE_DIRECTORY_REQUIRED');
  return fs.realpath(directory);
}
async function privateFile(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) fail('PRIVATE_FILE_REQUIRED');
  return fs.readFile(file);
}

async function copyRecoveryFile(source, destination) {
  let existing;
  try { existing = await fs.lstat(destination); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) fail('RECOVERY_FILE_DESTINATION_UNSAFE');
  if (existing && await fs.realpath(source) === await fs.realpath(destination)) return;
  const temporary = `${destination}.${randomBytes(12).toString('hex')}.partial`;
  try {
    await fs.writeFile(temporary, await fs.readFile(source), { flag: 'wx', mode: 0o600 });
    // Rename replaces the destination entry without following a substituted
    // symlink or modifying another file through a pre-existing hard link.
    await fs.rename(temporary, destination);
  } finally { await fs.rm(temporary, { force: true }); }
}

export async function checkpointFiles(directory) {
  const files = [];
  async function walk(folder, prefix = '') {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      if (excluded(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (relative.startsWith('-')) fail('INVALID_SOURCE_NAME');
      if (entry.isSymbolicLink()) fail('SOURCE_SYMLINK_REJECTED');
      if (entry.isDirectory()) await walk(path.join(folder, entry.name), relative);
      else if (entry.isFile() && allowed(entry.name)) {
        files.push(relative);
      }
    }
  }
  await walk(directory);
  return files.sort();
}

function inspectSourceArchive(file) {
  const listed = spawnSync('tar', ['-tzf', file], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (listed.status !== 0 || listed.error) fail('SOURCE_ARCHIVE_INVALID');
  for (const entry of listed.stdout.split('\n').filter(Boolean)) {
    if (entry.startsWith('/') || entry.split('/').includes('..') || entry.split('/').some(name => excluded(name) && /\.(?:pem|key|p12|pfx|der|b64)$/i.test(name)) ||
      /browser.*fixture|fixture.*browser/i.test(entry)) fail('PROHIBITED_ARCHIVED_FILE');
  }
}

async function checkpointHeader(file, privateKeyPem) {
  const handle = await fs.open(file, 'r'), prefix = Buffer.alloc(12);
  let metadata, tag, size;
  try {
    size = (await handle.stat()).size;
    await handle.read(prefix, 0, 12, 0);
    const length = prefix.readUInt32BE(8);
    if (!prefix.subarray(0, 8).equals(MAGIC) || length < 1 || length > MAX_HEADER || size < 12 + length + 16) fail('INVALID_CHECKPOINT');
    const encoded = Buffer.alloc(length); await handle.read(encoded, 0, length, 12);
    metadata = JSON.parse(encoded.toString('utf8')); tag = Buffer.alloc(16); await handle.read(tag, 0, 16, size - 16);
    metadata.headerBytes = 12 + length;
  } finally { await handle.close(); }
  if (metadata.format !== FORMAT || !safeId(metadata.checkpointId)) fail('INVALID_CHECKPOINT');
  const iv = Buffer.from(metadata.iv, 'base64');
  if (iv.length !== 12) fail('INVALID_CHECKPOINT');
  const key = privateDecrypt({ key: privateKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(metadata.wrappedKey, 'base64'));
  if (key.length !== 32) fail('INVALID_CHECKPOINT');
  return { ...metadata, key, iv, tag, size, aad: Buffer.from(JSON.stringify([FORMAT, metadata.checkpointId])) };
}

async function decryptCheckpoint(file, privateKeyPem, expected, sink) {
  const header = await checkpointHeader(file, privateKeyPem);
  if (expected.checkpointId !== header.checkpointId || expected.ciphertextSha256 !== await hashFile(file)) fail('CHECKPOINT_CIPHERTEXT_MISMATCH');
  const decipher = createDecipheriv('aes-256-gcm', header.key, header.iv);
  decipher.setAAD(header.aad); decipher.setAuthTag(header.tag);
  const digest = createHash('sha256'); let bytes = 0;
  const counter = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; digest.update(chunk); callback(null, chunk); } });
  await pipeline(createReadStream(file, { start: header.headerBytes, end: header.size - 17 }), decipher, counter, sink);
  if (bytes !== expected.archiveBytes || digest.digest('hex') !== expected.archiveSha256) fail('CHECKPOINT_RESTORE_MISMATCH');
  return { bytes, sha256: expected.archiveSha256 };
}

export async function verifyCheckpoint({ archiveFile, privateKeyFile, receiptFile }) {
  const privateKey = await privateFile(privateKeyFile), expected = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
  if (expected.format !== FORMAT || !safeId(expected.checkpointId) || !/^[a-f0-9]{64}$/.test(expected.archiveSha256 || '') ||
    !/^[a-f0-9]{64}$/.test(expected.ciphertextSha256 || '') || !Number.isSafeInteger(expected.archiveBytes) || expected.archiveBytes < 0) fail('INVALID_RECEIPT');
  await decryptCheckpoint(archiveFile, privateKey, expected, new Writable({ write(_chunk, _encoding, callback) { callback(); } }));
  return { ...expected, restoreVerified: true };
}

export async function createCheckpointBackup({ sourceDirectory, publicKeyB64File, privateKeyFile, destination, checkpointId,
  maxBytes = 2 * GIB, copyRestoreTools = true }) {
  if (!safeId(checkpointId)) fail('INVALID_CHECKPOINT_ID');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) fail('INVALID_ARCHIVE_CAP');
  const source = await privateDirectory(sourceDirectory), privateKey = await privateFile(privateKeyFile);
  await fs.mkdir(destination, { recursive: true });
  const target = await fs.realpath(destination), realPrivateKey = await fs.realpath(privateKeyFile);
  if (inside(source, target) || inside(realPrivateKey, target) || inside(await fs.realpath(publicKeyB64File), target)) fail('BACKUP_KEYS_MUST_BE_SEPARATE');
  const encodedPublicKey = Buffer.from((await fs.readFile(publicKeyB64File, 'utf8')).trim(), 'base64');
  const publicKey = createPublicKey(encodedPublicKey.toString('utf8').startsWith('-----BEGIN') ? encodedPublicKey
    : { key: encodedPublicKey, format: 'der', type: 'spki' });
  if (publicKey.asymmetricKeyType !== 'rsa' || publicKey.asymmetricKeyDetails.modulusLength < 2048 ||
    !createPublicKey(createPrivateKey(privateKey)).export({ type: 'spki', format: 'der' }).equals(publicKey.export({ type: 'spki', format: 'der' }))) fail('INVALID_KEY_PAIR');
  const files = await checkpointFiles(source);
  for (const required of ['data-checkpoint.json', 'security-catalog-before.json', 'provider-backups-before.json']) if (!files.includes(required)) fail('REQUIRED_CHECKPOINT_MISSING');
  if (!files.some(name => /^cloud-source-/.test(name)) || !files.some(name => /rollback.*\.sql$/i.test(name))) fail('REQUIRED_CHECKPOINT_MISSING');
  const entries = [];
  for (const name of files) {
    const file = path.join(source, name), stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) fail('SOURCE_CHANGED');
    if (/^cloud-source-.*\.tar(?:\.gz)?$/.test(name)) inspectSourceArchive(file);
    entries.push({ name, bytes: stat.size, sha256: await hashFile(file) });
  }
  const estimated = entries.reduce((sum, entry) => sum + entry.bytes, 0), available = await fs.statfs(target);
  if (estimated > maxBytes) fail('ARCHIVE_CAP_EXCEEDED');
  if (available.bavail * available.bsize < estimated + GIB) fail('INSUFFICIENT_BACKUP_CAPACITY');
  const archiveFile = path.join(target, `checkpoint-${checkpointId}.enc`), receiptFile = path.join(source, `checkpoint-${checkpointId}.verification.json`);
  const stage = await fs.mkdtemp(path.join(source, '.checkpoint-stage-'));
  const key = randomBytes(32), iv = randomBytes(12), aad = Buffer.from(JSON.stringify([FORMAT, checkpointId]));
  const wrappedKey = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
  const metadata = Buffer.from(JSON.stringify({ format: FORMAT, checkpointId, wrappedKey: wrappedKey.toString('base64'), iv: iv.toString('base64') }));
  const prefix = Buffer.alloc(12); MAGIC.copy(prefix); prefix.writeUInt32BE(metadata.length, 8);
  let archiveBytes = 0, child, archiveHandle, createdArchive = false, createdReceipt = false;
  try {
    await fs.writeFile(path.join(stage, 'checkpoint-index.json'), JSON.stringify({ format: FORMAT, checkpointId, entries }, null, 2), { mode: 0o600 });
    archiveHandle = await fs.open(archiveFile, fileConstants.O_RDWR | fileConstants.O_CREAT | fileConstants.O_EXCL | fileConstants.O_NOFOLLOW, 0o600);
    createdArchive = true;
    const header = Buffer.concat([prefix, metadata]);
    await archiveHandle.writeFile(header);
    const digest = createHash('sha256'), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad);
    child = spawn('tar', ['-czf', '-', '-C', source, ...files, '-C', stage, 'checkpoint-index.json'], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.resume();
    let spawnError;
    const closed = new Promise(resolve => { child.on('error', error => { spawnError = error; }); child.on('close', code => resolve(code)); });
    const counter = new Transform({ transform(chunk, _encoding, callback) {
      archiveBytes += chunk.length;
      if (archiveBytes > maxBytes) callback(Object.assign(new Error('ARCHIVE_CAP_EXCEEDED'), { code: 'ARCHIVE_CAP_EXCEEDED' }));
      else { digest.update(chunk); callback(null, chunk); }
    } });
    const encryptedOutput = new Writable({ write(chunk, _encoding, callback) {
      archiveHandle.writeFile(chunk).then(() => callback(), callback);
    } });
    await pipeline(child.stdout, counter, cipher, encryptedOutput);
    if (await closed !== 0 || spawnError) fail('SOURCE_ARCHIVE_FAILED');
    const tag = cipher.getAuthTag();
    if ((await archiveHandle.write(tag, 0, tag.length, header.length + archiveBytes)).bytesWritten !== tag.length) fail('CHECKPOINT_WRITE_FAILED');
    await archiveHandle.sync();
    await archiveHandle.close(); archiveHandle = undefined;
    for (const entry of entries) if (entry.sha256 !== await hashFile(path.join(source, entry.name))) fail('SOURCE_CHANGED');
    const receipt = { format: FORMAT, checkpointId, createdAt: new Date().toISOString(), fileCount: entries.length,
      archiveBytes, archiveSha256: digest.digest('hex'), ciphertextBytes: (await fs.stat(archiveFile)).size, ciphertextSha256: await hashFile(archiveFile) };
    await fs.writeFile(receiptFile, JSON.stringify(receipt, null, 2), { flag: 'wx', mode: 0o600 });
    createdReceipt = true;
    await verifyCheckpoint({ archiveFile, privateKeyFile, receiptFile });
    await copyRecoveryFile(receiptFile, `${archiveFile}.verification.json`);
    if (copyRestoreTools) {
      await copyRecoveryFile(fileURLToPath(import.meta.url), path.join(target, 'restore-checkpoint.mjs'));
      const photoRestore = fileURLToPath(new URL('./security-photo-restore.mjs', import.meta.url));
      await copyRecoveryFile(photoRestore, path.join(target, 'security-photo-restore.mjs'));
      const runbook = fileURLToPath(new URL('../docs/security/ENCRYPTED-BACKUP-RESTORE.md', import.meta.url));
      await copyRecoveryFile(runbook, path.join(target, 'RESTORE-README.md'));
    }
    return { ...receipt, restoreVerified: true };
  } catch (error) {
    child?.kill('SIGTERM');
    await archiveHandle?.close(); archiveHandle = undefined;
    if (createdArchive) { await fs.rm(archiveFile, { force: true }); await fs.rm(`${archiveFile}.verification.json`, { force: true }); }
    if (createdReceipt) await fs.rm(receiptFile, { force: true });
    throw error;
  } finally { await archiveHandle?.close(); await fs.rm(stage, { recursive: true, force: true }); }
}

export async function restoreCheckpoint({ archiveFile, privateKeyFile, receiptFile, restoreDirectory }) {
  const target = await privateDirectory(restoreDirectory);
  if (target === '/Volumes' || target.startsWith('/Volumes/')) fail('RESTORE_TO_PRIVATE_MAC_DIRECTORY');
  const privateKey = await privateFile(privateKeyFile), expected = await verifyCheckpoint({ archiveFile, privateKeyFile, receiptFile });
  const file = path.join(target, `checkpoint-${expected.checkpointId}.tar.gz`);
  const handle = await fs.open(file, 'wx', 0o600); await handle.close();
  try { await decryptCheckpoint(archiveFile, privateKey, expected, createWriteStream(file, { flags: 'w', mode: 0o600 })); }
  catch (error) { await fs.rm(file, { force: true }); throw error; }
  return { ok: true, checkpointId: expected.checkpointId, archiveBytes: expected.archiveBytes, archiveSha256: expected.archiveSha256 };
}

function parse(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) { if (!args[index].startsWith('--') || !args[index + 1]) fail('INVALID_ARGUMENTS'); result[args[index].slice(2)] = args[index + 1]; }
  return result;
}
async function main() {
  const args = parse(process.argv.slice(3)), mode = process.argv[2];
  let result;
  if (mode === 'create') {
    for (const key of ['source', 'public-key-b64-file', 'private-key', 'destination', 'id']) if (!args[key]) fail('INVALID_ARGUMENTS');
    result = await createCheckpointBackup({ sourceDirectory: args.source, publicKeyB64File: args['public-key-b64-file'], privateKeyFile: args['private-key'], destination: args.destination, checkpointId: args.id });
  } else {
    for (const key of ['archive', 'private-key', 'receipt']) if (!args[key]) fail('INVALID_ARGUMENTS');
    const options = { archiveFile: args.archive, privateKeyFile: args['private-key'], receiptFile: args.receipt };
    if (mode === 'verify') result = await verifyCheckpoint(options);
    else if (mode === 'restore' && args['restore-dir']) result = await restoreCheckpoint({ ...options, restoreDirectory: args['restore-dir'] });
    else fail('INVALID_MODE');
  }
  console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { const code = /^[A-Z_]{3,80}$/.test(error.code || '') ? error.code : 'CHECKPOINT_OPERATION_FAILED'; console.error(JSON.stringify({ ok: false, code })); process.exitCode = 1; });
}

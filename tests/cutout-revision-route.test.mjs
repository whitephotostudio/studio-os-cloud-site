import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import sharp from 'sharp';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function png({ width = 2, height = 2, alpha = [0, 255, 160, 255], changeHiddenRgb = false } = {}) {
  const bytes = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) bytes.set([21, 101, 209, alpha[i % alpha.length]], i * 4);
  if (changeHiddenRgb) bytes[0] = 22;
  return sharp(bytes, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
async function fixture(overrides = {}) {
  const studio = randomUUID(), original = sha(Buffer.from('original fixture'));
  const before = await png(), after = await png({ alpha: [0, 160, 240, 255] });
  const calls = [];
  const storageCalls = [], storage = new Map();
  const staging = {};
  const stagingCode = ts.transpileModule(readFileSync(new URL('../lib/credit-cutout-staging.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', stagingCode)(name => ({
    '@/lib/r2': { r2Download: async (key, options) => { storageCalls.push({ read: key, options }); if (!storage.has(key)) throw new Error('missing fixture'); return storage.get(key); },
      r2Delete: async (key, options) => { storageCalls.push({ deleted: key, options }); storage.delete(key); } },
    '@/lib/credit-cutout-access': { MAX_MANAGED_CUTOUT_BYTES: 25 * 1024 * 1024 },
  })[name], staging);
  const auth = { user: { id: studio }, mfaSatisfied: true, ...overrides.auth };
  const service = { rpc: async (name, args) => {
    calls.push({ name, args });
    if (overrides.throwRpc) throw new Error('secret provider payload must not leak');
    return { data: name === 'has_studio_cutout_entitlement' ? overrides.paid !== false : overrides.registered !== false, error: null };
  } };
  const exports = {};
  const modules = { 'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } }, sharp: { default: sharp },
    '@/lib/dashboard-auth': { resolveDashboardAuth: async () => auth, createDashboardServiceClient: () => service },
    '@/lib/credit-cutout-staging': staging };
  const code = ts.transpileModule(readFileSync(new URL('../app/api/credits/cutout-revision/route.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', code)(name => name in modules ? modules[name] : require(name), exports);
  const request = ({ previous = before, edited = after, originalHash = original, length, source } = {}) => ({
    headers: new Headers(length ? { 'content-length': String(length) } : {}), formData: async () => {
      const form = new FormData();
      form.set('previous_cutout', new File([previous], 'previous.png', { type: 'application/octet-stream' }));
      form.set('image_file', new File([edited], 'edited.png', { type: 'application/octet-stream' }));
      if (originalHash !== null) form.set('original_sha256', originalHash);
      if (source) form.set('original_file', new File([source], 'source.jpg', { type: 'image/jpeg' }));
      return form;
    },
  });
  const stagedRequest = ({ previous = before, edited = after, originalHash = original, source, foreign = false } = {}) => {
    const previousKey = `credit-staging/${studio}/${randomUUID()}.png`, editedKey = `credit-staging/${foreign ? randomUUID() : studio}/${randomUUID()}.png`;
    const sourceKey = source ? `credit-staging/${studio}/${randomUUID()}.png` : undefined;
    storage.set(previousKey, previous); storage.set(editedKey, edited); if (sourceKey) storage.set(sourceKey, source);
    return { headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ previous_staging_key: previousKey,
      staging_key: editedKey, original_sha256: originalHash, ...(sourceKey ? { original_staging_key: sourceKey } : {}) }) };
  };
  return { studio, original, before, after, calls, request, stagedRequest, storageCalls, storage, POST: exports.POST };
}

test('mask-only edit computes exact previous/new full SHA and service registers after paid proof', async () => {
  const f = await fixture();
  const response = await f.POST(f.request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { ok: true, previousCutoutSha256: sha(f.before), cutoutSha256: sha(f.after) });
  assert.deepEqual(f.calls, [
    { name: 'has_studio_cutout_entitlement', args: { p_studio_id: f.studio, p_original_sha256: f.original, p_cutout_sha256: sha(f.before) } },
    { name: 'register_verified_cutout_revision', args: { p_studio_id: f.studio, p_original_sha256: f.original, p_previous_cutout_sha256: sha(f.before), p_cutout_sha256: sha(f.after) } },
  ]);
});
test('missing source permits an exact paid standalone mask edit without inventing a source hash', async () => {
  const f = await fixture();
  assert.equal((await f.POST(f.request({ originalHash: null }))).status, 200);
  assert.equal(f.calls[0].args.p_original_sha256, null);
  assert.equal(f.calls[1].args.p_original_sha256, null);
});
test('another photo hidden by transparent alpha cannot piggyback on one paid photo', async () => {
  const f = await fixture();
  const edited = await png({ alpha: [0, 160, 240, 255], changeHiddenRgb: true });
  const response = await f.POST(f.request({ edited }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /only the transparency mask/);
  assert.equal(f.calls.length, 1, 'RGB mismatch must never register new proof');
});
test('resize, opaque JPEG/PNG, wholly transparent PNG and corrupt bytes cannot become a paid revision', async () => {
  const f = await fixture();
  for (const edited of [await png({ width: 3 }), await png({ alpha: [255] }), await png({ alpha: [0] }),
    await sharp(f.after).jpeg().toBuffer(), Buffer.from('not a PNG')]) {
    f.calls.length = 0;
    assert.equal((await f.POST(f.request({ edited }))).status, 400);
    assert.equal(f.calls.length, 1);
  }
});
test('unpaid previous cutout or revoked registration cannot authorize a revision', async () => {
  const unpaid = await fixture({ paid: false });
  assert.equal((await unpaid.POST(unpaid.request())).status, 403);
  assert.equal(unpaid.calls.length, 1);
  const refunded = await fixture({ registered: false });
  assert.equal((await refunded.POST(refunded.request())).status, 403);
  assert.equal(refunded.calls.length, 2);
});
test('anonymous or incomplete MFA requests stop before body and service work', async () => {
  for (const [auth, status] of [[{ user: null }, 401], [{ mfaSatisfied: false }, 403]]) {
    const f = await fixture({ auth });
    const request = f.request(); request.formData = () => assert.fail('should not read body');
    assert.equal((await f.POST(request)).status, status);
    assert.equal(f.calls.length, 0);
  }
});
test('header, actual file and combined body limits fail before paid proof', async () => {
  const f = await fixture();
  for (const request of [f.request({ length: 5 * 1024 * 1024 }),
    f.request({ edited: Buffer.alloc(3 * 1024 * 1024 + 1) }),
    f.request({ previous: Buffer.alloc(2 * 1024 * 1024 + 1), edited: Buffer.alloc(2 * 1024 * 1024 + 1) })]) {
    assert.equal((await f.POST(request)).status, 413);
  }
  assert.equal((await f.POST(f.request({ originalHash: 'forged' }))).status, 400);
  assert.equal(f.calls.length, 0);
});
test('database exceptions return a safe error without exception, image or credentials leakage', async () => {
  const f = await fixture({ throwRpc: true });
  const response = await f.POST(f.request());
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /secret provider payload/);
});

test('private staged mask edit reads exact owned bytes and cleans only after proof registration', async () => {
  const f = await fixture();
  assert.equal((await f.POST(f.stagedRequest())).status, 200);
  assert.equal(f.storageCalls.filter(call => call.read).length, 2);
  assert.equal(f.storageCalls.filter(call => call.deleted).length, 2);
  assert.equal(f.storage.size, 0);
  assert.ok(f.storageCalls.every(call => call.options.allowCutoutStaging === true));
  const refused = await fixture({ registered: false });
  assert.equal((await refused.POST(refused.stagedRequest())).status, 403);
  assert.equal(refused.storage.size, 2, 'denial must preserve stages for review/retry');
});
test('foreign stage cannot be read or converted to paid proof', async () => {
  const f = await fixture();
  assert.equal((await f.POST(f.stagedRequest({ foreign: true }))).status, 403);
  assert.equal(f.calls.length, 0);
  assert.equal(f.storageCalls.filter(call => call.read).length, 1, 'foreign stage must be denied before its download');
});
test('native Restore may use the actual paid original RGB with bounded codec rounding, and rejects wrong/new portraits', async () => {
  const source = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#3264a0' } }).jpeg().toBuffer();
  const decoded = await sharp(source).raw().toBuffer();
  const rgba = Buffer.alloc(16);
  for (let i = 0; i < 4; i++) rgba.set([decoded[i * 3] + 4, decoded[i * 3 + 1], decoded[i * 3 + 2], i ? 255 : 0], i * 4);
  const edited = await sharp(rgba, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
  const previousPixels = Buffer.from(rgba);
  for (let i = 0; i < 4; i++) { previousPixels[i * 4] = decoded[i * 3]; previousPixels[i * 4 + 3] = [0, 140, 200, 255][i]; }
  const previous = await sharp(previousPixels, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
  const f = await fixture();
  assert.equal((await f.POST(f.request({ previous, edited, source, originalHash: sha(source) }))).status, 200);
  const staged = await fixture();
  assert.equal((await staged.POST(staged.stagedRequest({ previous, edited, source, originalHash: sha(source) }))).status, 200);
  assert.equal(staged.storageCalls.filter(call => call.deleted).length, 3);
  const wrongSource = await fixture();
  assert.equal((await wrongSource.POST(wrongSource.request({ edited, source }))).status, 403);
  assert.equal(wrongSource.calls.length, 0);
  assert.equal((await f.POST(f.request({ edited, source, originalHash: null }))).status, 403);
  const anotherPortrait = await fixture();
  assert.equal((await anotherPortrait.POST(anotherPortrait.request({ edited: await png(), source, originalHash: sha(source) }))).status, 400);
  assert.equal(anotherPortrait.calls.length, 1);
  rgba[0]++;
  const outsideTolerance = await sharp(rgba, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
  assert.equal((await f.POST(f.request({ previous, edited: outsideTolerance, source, originalHash: sha(source) }))).status, 400);
});
test('native mismatched original dimensions cannot be aliased to the paid output', async () => {
  const source = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#3264a0' } }).jpeg().toBuffer();
  const f = await fixture();
  assert.equal((await f.POST(f.request({ source, originalHash: sha(source) }))).status, 400);
  assert.equal(f.calls.length, 1);
});
test('native EXIF rotation compares the authenticated source in its actual displayed dimensions', async () => {
  const source = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#3264a0' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const rotated = await sharp(source).rotate().raw().toBuffer({ resolveWithObject: true });
  assert.equal(rotated.info.width, 2); assert.equal(rotated.info.height, 3);
  const rgba = Buffer.alloc(2 * 3 * 4);
  for (let i = 0; i < 6; i++) rgba.set([rotated.data[i * 3], rotated.data[i * 3 + 1], rotated.data[i * 3 + 2], i ? 255 : 0], i * 4);
  const edited = await sharp(rgba, { raw: { width: 2, height: 3, channels: 4 } }).png().toBuffer();
  const previousPixels = Buffer.from(rgba); previousPixels[7] = 160;
  const previous = await sharp(previousPixels, { raw: { width: 2, height: 3, channels: 4 } }).png().toBuffer();
  const f = await fixture();
  assert.equal((await f.POST(f.request({ previous, edited, source, originalHash: sha(source) }))).status, 200);
});
test('a paid portrait A labeled with original B cannot use native source mode to authorize portrait B', async () => {
  const sourceB = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#3264a0' } }).jpeg().toBuffer();
  const rgbB = await sharp(sourceB).raw().toBuffer();
  const rgbaB = Buffer.alloc(16);
  for (let i = 0; i < 4; i++) rgbaB.set([rgbB[i * 3], rgbB[i * 3 + 1], rgbB[i * 3 + 2], i ? 255 : 0], i * 4);
  const editedB = await sharp(rgbaB, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
  const f = await fixture();
  // The fixture grants active paid proof to the actual prior A bytes with a
  // client-chosen original B label, mirroring the local receipt RPC boundary.
  const response = await f.POST(f.request({ previous: f.before, edited: editedB, source: sourceB, originalHash: sha(sourceB) }));
  assert.equal(response.status, 400);
  assert.equal(f.calls.length, 1, 'matching source label and new RGB cannot substitute a different paid previous image');
  const staged = await fixture();
  assert.equal((await staged.POST(staged.stagedRequest({ edited: editedB, source: sourceB, originalHash: sha(sourceB) }))).status, 400);
  assert.equal(staged.calls.length, 1); assert.equal(staged.storage.size, 3, 'rejected working files must remain available for retry/review');
});

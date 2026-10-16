import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';

function load(file, dependencies) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('require', 'exports', code)(name => { assert(name in dependencies, name); return dependencies[name]; }, exports);
  return exports;
}
const assets = load('lib/labs/in-house-sample-assets.ts', { 'node:fs/promises': fsp, 'node:path': path, 'node:crypto': crypto });

test('sample output files have distinct correct print shapes, 300ppi metadata and exact durable hashes', async () => {
  const manifest = await assets.inHouseSampleAssets();
  assert.equal(manifest.length, 2);
  assert.deepEqual(manifest.map(file => file.quantity), [1, 2]);
  assert.equal(assets.IN_HOUSE_SAMPLE_PHOTO_ID, 'studio-os-inhouse-demo-v1');
  for (const expected of manifest) {
    const result = await assets.readInHouseSampleAsset(expected.id);
    const metadata = await sharp(result.bytes).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.equal(metadata.density, 300);
    assert.equal(metadata.width, expected.widthPixels);
    assert.equal(metadata.height, expected.heightPixels);
    assert.equal(metadata.width / metadata.height, expected.widthInches / expected.heightInches);
    assert.equal(metadata.width, expected.widthInches * 300);
    assert.equal(metadata.height, expected.heightInches * 300);
    assert.equal(result.bytes.length, expected.byteSize);
    assert.equal(crypto.createHash('sha256').update(result.bytes).digest('hex'), expected.sha256);
  }
  await assert.rejects(() => assets.readInHouseSampleAsset('../lab-order-sample.jpg'));
  await assert.rejects(() => assets.readInHouseSampleAsset('/etc/passwd'));
  manifest[0].sha256 = 'broken';
  assert.notEqual((await assets.inHouseSampleAssets())[0].sha256, 'broken', 'Callers cannot alter the pinned sample manifest');
});

test('corrupted synthetic sample fails before a production manifest can be created', async () => {
  const broken = load('lib/labs/in-house-sample-assets.ts', { 'node:fs/promises': { readFile: async () => Buffer.from('wrong') }, 'node:path': path, 'node:crypto': crypto });
  await assert.rejects(() => broken.inHouseSampleAssets(), /verified manifest/);
});

function preload(env, calls = []) {
  const context = { process: { env }, URL, Request, Error, globalThis: { fetch: async (...args) => { calls.push(args); return { ok: true }; } } };
  vm.runInNewContext(fs.readFileSync(new URL('../scripts/lab-pilot-fixture-fetch.cjs', import.meta.url), 'utf8'), context);
  return context.globalThis.fetch;
}
test('synthetic pilot HTTP mode retains real route guards while forcing all provider fetches to loopback', async () => {
  for (const env of [{}, { STUDIO_OS_SYNTHETIC_LAB_HTTP: '1', STUDIO_OS_SYNTHETIC_LAB_FIXTURE_URL: 'https://external.example' },
    { STUDIO_OS_SYNTHETIC_LAB_HTTP: '1', STUDIO_OS_SYNTHETIC_LAB_FIXTURE_URL: 'http://127.0.0.1:1234', NODE_ENV: 'production' }]) {
    assert.throws(() => preload(env), /explicit local/);
  }
  const calls = [], fetch = preload({ STUDIO_OS_SYNTHETIC_LAB_HTTP: '1', STUDIO_OS_SYNTHETIC_LAB_FIXTURE_URL: 'http://127.0.0.1:1234', NODE_ENV: 'development' }, calls);
  await fetch('https://lgwmxqjwgkzktikhkebp.supabase.co/auth/v1/user', { headers: { Authorization: 'Bearer synthetic-only' }, redirect: 'follow' });
  assert.equal(calls[0][0], 'http://127.0.0.1:1234/auth/v1/user');
  assert.equal(calls[0][1].redirect, 'error', 'Redirects cannot escape the local fixture');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer synthetic-only');
  await fetch(new Request('https://lgwmxqjwgkzktikhkebp.supabase.co/rest/v1/rpc/example', { method: 'POST', body: '{}' }));
  assert.equal(calls[1][0].url, 'http://127.0.0.1:1234/rest/v1/rpc/example');
  assert.equal(calls[1][1].redirect, 'error');
  await fetch('http://localhost:5432/health', { redirect: 'follow' });
  assert.equal(calls[2][1].redirect, 'error');
  for (const url of ['https://bwqhzczxoevouiondjak.supabase.co/rest/v1/orders', 'https://stripe.com', 'https://127.0.0.1.evil.example']) {
    assert.throws(() => fetch(url), /External provider/);
  }
  assert.equal(calls.length, 3);
});

test('private parent gallery emits neither page-view nor marked-link marketing telemetry', () => {
  const effects = [], handlers = [], calls = [];
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(new URL('../components/marketing/MarketingEventTracker.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const pathname = '/labs-pilot/in-house/11111111-1111-4111-8111-111111111111';
  new Function('require', 'exports', 'window', 'document', 'navigator', 'fetch', code)(name => {
    if (name === 'react') return { useEffect: action => effects.push(action) };
    if (name === 'next/navigation') return { usePathname: () => pathname };
    throw Error(name);
  }, exports, { location: { pathname }, localStorage: { getItem: () => { throw Error('Private gallery must not allocate tracking IDs'); } } },
  { addEventListener: (name, handler) => handlers.push(handler), removeEventListener: () => {} },
  { sendBeacon: (...args) => calls.push(args) }, (...args) => calls.push(args));
  exports.MarketingEventTracker();
  for (const effect of effects) effect();
  for (const handler of handlers) handler({ target: { closest: () => ({ dataset: { marketingEvent: 'should-not-send' } }) } });
  assert.deepEqual(calls, []);
});

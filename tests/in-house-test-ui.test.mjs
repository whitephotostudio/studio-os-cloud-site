import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import * as icons from 'lucide-react';

function load(file, deps = {}) {
  const code = ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(name => { if (!(name in deps)) throw Error(`Missing dependency ${name}`); return deps[name]; }, exports);
  return exports;
}
const money = load('lib/labs/money.ts');
const deps = {
  react: React, 'react/jsx-runtime': jsxRuntime, 'lucide-react': icons, '@/lib/labs/money': money,
  'next/link': ({ children, href, ...props }) => React.createElement('a', { href, ...props }, children),
  'next/image': ({ unoptimized, ...props }) => React.createElement('img', props),
  '@/lib/supabase/client': { createClient() { throw Error('Server rendering must not fetch private data or submit orders'); } },
  './in-house-test-workspace.module.css': {}, './in-house-test-gallery.module.css': {},
};
const owner = load('components/labs/in-house-test-workspace.tsx', deps);
const parent = load('components/labs/in-house-test-gallery.tsx', deps);
const fixedDate = '2026-10-15T18:00:00.000Z';
function order(status = 'submitted', quantity = 1) {
  return {
    id: '11000000-0000-4000-8000-000000000001', reference: 'TEST-FIXTURE-001', galleryId: '22000000-0000-4000-8000-000000000001', status, version: 1, createdAt: fixedDate, updatedAt: fixedDate,
    snapshot: { schemaVersion: 1, testOnly: true, galleryName: 'Private sample gallery', studioName: 'Fixture Studio', currency: 'CAD', offer: { id: 'private-source-entry', name: 'Family print package', retailCents: 4299, contents: [{ name: '8x10 Lustre', qty: 1 }, { name: '5x7 Lustre', qty: 2 }] }, photoId: 'studio-os-inhouse-demo-v1', quantity, subtotalMinor: quantity * 4299, taxMinor: 0, shippingMinor: 0, paymentCollectedMinor: 0, fulfillment: 'in_house', delivery: 'pickup', assets: [{ id: 'sample-8x10', filename: 'Fixture 8x10.jpg', widthPixels: 2400, heightPixels: 3000, sha256: 'a'.repeat(64), byteSize: 4000, quantity }, { id: 'sample-5x7', filename: 'Fixture 5x7.jpg', widthPixels: 1500, heightPixels: 2100, sha256: 'b'.repeat(64), byteSize: 3000, quantity: quantity * 2 }], source: { sheetId: 'private-sheet-id', sheetVersion: 9, entryId: 'private-source-entry', sourceHash: 'private-source-hash', sourceProfileId: 'private-profile-id' } },
    events: [{ id: 'event-1', status, version: 1, createdAt: fixedDate }],
  };
}

test('private gallery access stays in the fragment and rejects missing or malformed capabilities', () => {
  const id = '22000000-0000-4000-8000-000000000001', token = 'ab'.repeat(32);
  const link = owner.privateInHouseGalleryPath(id, token);
  const parsed = new URL(link, 'https://pilot.example');
  assert.equal(parsed.search, '');
  assert.equal(parsed.hash, `#access=${token}`);
  assert.equal(parent.inHouseTestAccessFromHash(parsed.hash), token);
  for (const invalid of ['', '#access=short', '#access=' + 'g'.repeat(64), '#other=' + token, '#access=' + token.toUpperCase()]) assert.equal(parent.inHouseTestAccessFromHash(invalid), null);
  assert.throws(() => owner.privateInHouseGalleryPath(id, 'short'));
  assert.throws(() => owner.privateInHouseGalleryPath('../escape', token));
});

test('parent package quantities allow exactly whole sets from one to ten', () => {
  for (let quantity = 1; quantity <= 10; quantity++) assert.equal(parent.inHouseTestQuantity(String(quantity)), quantity);
  for (const invalid of ['', '0', '-1', '11', '1.5', '1e1', '01', ' 2', '2 ', 'NaN']) assert.equal(parent.inHouseTestQuantity(invalid), null, invalid);
});

test('owner receiving detail preserves exact two-set quantities, retail subtotal, file metadata and only the next production action', () => {
  const value = order('accepted', 2);
  const html = renderToStaticMarkup(React.createElement(owner.InHouseTestOrderDetail, { order: value, tracking: false, busy: false, downloadBusy: '', onTransition() { throw Error('Rendering cannot update status'); }, onDownload() { throw Error('Rendering cannot download'); } }));
  for (const label of ['2 package sets', '6 prints in total', '2 prints', '4 prints', '85.98', 'Start production', '8×10 sample', '5×7 sample', 'Order manifest', 'No payment collected']) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /Accept order|Mark ready|Complete order|private-source-hash|private-profile-id|private-sheet-id/);
});

test('photographer tracking shows the shared receipt and history without receiving controls', () => {
  const html = renderToStaticMarkup(React.createElement(owner.InHouseTestOrderDetail, { order: order('ready'), tracking: true, busy: false, downloadBusy: '', onTransition() {}, onDownload() {} }));
  assert.match(html, /Order progress/); assert.match(html, /Order history/); assert.match(html, /TEST-FIXTURE-001/); assert.match(html, /Ready/);
  assert.doesNotMatch(html, /Complete order|Sample production files|Order manifest|Accept order/);
});

test('parent receipt renders one frozen package and timeline without private source IDs, contact fields or payment controls', () => {
  const value = order('completed');
  const html = renderToStaticMarkup(React.createElement(parent.InHouseTestReceiptView, { receipt: value, busy: false, onRefresh() { throw Error('Rendering cannot refresh'); } }));
  for (const label of ['TEST-FIXTURE-001', 'Family print package', '42.99', '1 × 8x10 Lustre', '2 × 5x7 Lustre', 'Completed', 'Refresh order status', 'No card was charged']) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /private-source-entry|private-sheet-id|private-source-hash|private-profile-id|email|phone|card number|Pay now|Stripe|Place test order/);
});

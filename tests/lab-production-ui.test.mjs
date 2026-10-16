import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import * as icons from 'lucide-react';

function load(file, deps = {}) {
  const code = ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(name => { if (!(name in deps)) throw Error(`Missing dependency ${name}`); return deps[name]; }, exports);
  return exports;
}
const money = load('lib/labs/money.ts'), labels = load('components/labs/production-labels.ts');
const deps = { react: React, 'react/jsx-runtime': jsxRuntime, 'lucide-react': icons, 'next/link': ({ children, href, ...props }) => React.createElement('a', { href, ...props }, children), 'next/image': ({ unoptimized, ...props }) => React.createElement('img', props), '@/lib/labs/money': money, './production.module.css': {}, './production-labels': labels, '@/lib/supabase/client': { createClient() { throw Error('Rendering cannot access private accounts'); } }, './production-client': { productionRequest() { throw Error('Rendering cannot mutate production'); } } };
const crop = load('components/labs/production-crop-editor.tsx', deps);
const owner = load('components/labs/production-workspace.tsx', { ...deps, './production-crop-editor': crop });
const parent = load('components/labs/production-gallery.tsx', deps);
const stamp = '2026-10-16T01:00:00.000Z';
const asset = (id, width = 2400, height = 3000) => ({ id, kind: 'crop', filename: `Synthetic-${id}.jpg`, sha256: 'a'.repeat(64), byteSize: 3000, widthPixels: width, heightPixels: height, contentType: 'image/jpeg' });
function job(overrides = {}) {
    return { id: 'job-synthetic', reference: 'PROOF-SYNTHETIC-LONG-REFERENCE-ONLY', galleryId: 'private-gallery-id', version: 2, status: 'accepted', studioName: 'Synthetic Studio', targetLabel: 'Synthetic Lab', targetKind: 'partner_lab', amountKind: 'retail', canReceive: true, canApproveOrder: true, canCrop: true, policy: { autoApprove: false, cropResponsibility: 'photographer', labColourCorrection: false }, offer: { id: 'offer-synthetic', name: 'Synthetic print package', retailCents: 4299, contents: [{ name: '8x10 Lustre', qty: 1 }, { name: '5x7 Lustre', qty: 2 }] }, currency: 'CAD', quantity: 2, subtotalMinor: 8598, source: { ...asset('private-original', 4000, 6000), kind: 'original' }, photographerApproved: false, photographerApprovedAt: null, lines: ['8x10', '5x7'].map(size => ({ size, quantity: size === '8x10' ? 2 : 4, widthInches: size === '8x10' ? 8 : 5, heightInches: size === '8x10' ? 10 : 7, crop: null, cropAsset: null, cropApproved: false, cropApprovedAt: null, colourAsset: null, colourCompletedAt: null, finalReviewedAt: null, finalAsset: null })), holds: ['photographer_approval', 'crop_8x10', 'crop_5x7', 'final_review_8x10', 'final_review_5x7'], events: [{ id: 'event-test', action: 'submitted', actorRole: 'photographer', version: 1, createdAt: stamp }], testOnly: true, payment: 'test_no_payment', printAllowed: false, createdAt: stamp, updatedAt: stamp, ...overrides };
}
const detail = value => renderToStaticMarkup(React.createElement(owner.ProductionJobDetail, { job: value, audience: 'studio', userId: 'synthetic-user', busy: false, fileBusy: '', crop: null, onAction() { throw Error('Rendering cannot approve'); }, onCrop() {}, onSaveCrop() {}, onCancelCrop() {}, onCorrected() {}, onDownload() {}, onDownloadAsset() {} }));

test('manual crop geometry stays in source bounds and preserves each print aspect across positions and zoom', () => {
  for (const [sourceWidth, sourceHeight] of [[4000, 6000], [6000, 4000], [4000, 4000]]) for (const [width, height] of [[8, 10], [5, 7]]) for (const zoom of [1, 1.17, 2, 4]) for (const x of [-10, 0, 50, 100, 110]) for (const y of [0, 50, 100]) {
    const rect = crop.productionCropRect(sourceWidth, sourceHeight, width, height, zoom, x, y);
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 1.000000001 && rect.y + rect.height <= 1.000000001);
    assert.ok(Math.abs(rect.width * sourceWidth / (rect.height * sourceHeight) - width / height) < 1e-10);
    const pixels = owner.productionCropPixels(rect, sourceWidth, sourceHeight);
    assert.equal(pixels.rotation, 0); assert.ok(pixels.x + pixels.width <= sourceWidth && pixels.y + pixels.height <= sourceHeight);
  }
  assert.throws(() => crop.productionCropRect(0, 6000, 8, 10, 1, 50, 50));
});

test('gallery photo eligibility keeps undersized originals available privately but excludes them from this print package', () => {
  for (const [widthPixels, heightPixels, expected] of [[1600, 2000, true], [4000, 6000, true], [1599, 2000, false], [1600, 1999, false], [2000, 1600, false]]) assert.equal(owner.productionOriginalEligible({ widthPixels, heightPixels }), expected);
});

test('large original libraries mount only the newest page plus selected older photos until the user loads more', () => {
  const originals = Array.from({ length: 2000 }, (_, index) => ({ ...asset(`original-${index}`), kind: 'original' }));
  const mixed = [asset('derived-file'), ...originals];
  assert.equal(owner.productionVisibleOriginals(mixed, []).length, 20);
  assert.deepEqual(owner.productionVisibleOriginals(mixed, []).map(value => value.id), originals.slice(0, 20).map(value => value.id));
  const selected = ['original-1', 'original-1999'];
  const firstPage = owner.productionVisibleOriginals(mixed, selected);
  assert.equal(firstPage.length, 21); assert.equal(firstPage.at(-1).id, 'original-1999');
  const nextPage = owner.productionVisibleOriginals(mixed, selected, 40);
  assert.equal(nextPage.length, 41); assert.ok(nextPage.some(value => value.id === 'original-39')); assert.equal(nextPage.at(-1).id, 'original-1999');
  assert.equal(owner.productionVisibleOriginals(mixed, [], 2000).length, 2000);
});

test('crop editor requires loaded preview and explicit review, shows retained resolution, and blocks insufficient pixels', () => {
  const props = { sourceUrl: 'blob:synthetic', sourceWidth: 1000, sourceHeight: 1200, targetWidth: 8, targetHeight: 10, size: '8x10', busy: false, onSave() { throw Error('Rendering cannot save a crop'); }, onCancel() {} };
  const html = renderToStaticMarkup(React.createElement(crop.ProductionCropEditor, props));
  for (const label of ['Horizontal position', 'Vertical position', 'Minimum 200 ppi', 'too few pixels', 'I reviewed the crop', 'Waiting for the original preview', 'Save crop for 8x10']) assert.ok(html.includes(label), label);
  assert.match(html, /disabled=""[^>]*>[^<]*<svg[\s\S]*Save crop for/);
  assert.doesNotMatch(html, /Auto.?approve|Smart.?crop|AI/);
});

test('automatic photographer approval keeps crop and colour production holds independently visible', () => {
  const value = job({ policy: { autoApprove: true, cropResponsibility: 'lab', labColourCorrection: true }, photographerApproved: true, holds: ['crop_8x10', 'colour_8x10', 'final_review_8x10'] });
  const html = detail(value);
  for (const label of ['Automatically approved', 'Crop responsibility', '0/2 sizes approved', '0/2 sizes reviewed', 'Review and approve the 8×10 crop', 'lab needs to complete 8×10 colour review', 'final print file needs review']) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /Approve order for production review/);
  assert.match(html, /disabled=""[^>]*>Start production preparation/);
});

test('read-only job permissions remove production mutation controls without changing saved quantities or prices', () => {
  const html = detail(job({ canReceive: false, canApproveOrder: false, canCrop: false }));
  assert.ok(html.includes('8×10 print')); assert.ok(html.includes('2 copies')); assert.ok(html.includes('4 copies')); assert.ok(html.includes('85.98'));
  assert.doesNotMatch(html, /Approve order for production review|Accept job for review|Crop for|Approve saved crop|Start production preparation|Approve final print file/);
});

test('receiving labels the server-projected wholesale basis separately from a photographer retail subtotal', () => {
  const retail = detail(job());
  assert.match(retail, /Retail subtotal/); assert.doesNotMatch(retail, /Lab product cost:/);
  const wholesale = detail(job({ amountKind: 'wholesale', subtotalMinor: 2400, offer: { ...job().offer, name: '1 × 8×10 + 2 × 5×7', retailCents: 1200 } }));
  assert.match(wholesale, /Lab product cost:.*24\.00/); assert.doesNotMatch(wholesale, /Retail subtotal|85\.98/);
});

test('colour review offers an honest same-geometry upload and separate unchecked no-change acknowledgment', () => {
  const value = job({ policy: { autoApprove: true, cropResponsibility: 'lab', labColourCorrection: true }, photographerApproved: true });
  value.lines = value.lines.map(line => ({ ...line, cropAsset: asset(`crop-${line.size}`, line.size === '8x10' ? 2400 : 1500, line.size === '8x10' ? 3000 : 2100), cropApproved: true }));
  const html = detail(value);
  for (const label of ['Production files use sRGB', 'Upload colour-corrected print file', 'Keep the crop unchanged', 'I reviewed this cropped file and no colour change is needed', 'Save no-change colour review', 'Download cropped file for colour review']) assert.ok(html.includes(label), label);
  assert.match(html, /disabled=""[^>]*>Save no-change colour review/);
});

test('final handoff includes the packed two-up 10x7 sheet and parent receipt excludes production actions and source metadata', () => {
  const value = job({ holds: [], photographerApproved: true, status: 'ready' });
  value.lines = value.lines.map(line => ({ ...line, cropApproved: true, finalReviewedAt: stamp, finalAsset: asset(`final-${line.size}`) }));
  const html = detail(value);
  assert.ok(html.includes('Download 10×7 sheet (two 5×7)')); assert.ok(html.includes('Physical printing stays disabled'));
  const receipt = renderToStaticMarkup(React.createElement(parent.ProductionReceiptView, { receipt: value, busy: false, onRefresh() {} }));
  for (const text of ['85.98', '2 × 8x10 Lustre', '4 × 5x7 Lustre', 'Refresh order status', 'No payment collected']) assert.ok(receipt.includes(text), text);
  assert.doesNotMatch(receipt, /private-original|private-gallery-id|sha256|Crop for|Upload colour|Approve final|canReceive|assetId/);
});

test('parent quantities stay bounded to complete sets without fractional or alternate numeric forms', () => {
  for (let quantity = 1; quantity <= 10; quantity++) assert.equal(parent.productionParentQuantity(String(quantity)), quantity);
  for (const bad of ['', '0', '11', '1.2', '-1', '1e1', '01', ' 2']) assert.equal(parent.productionParentQuantity(bad), null);
});

test('private download bytes are withheld when the signed-in account changes while the blob is being read', async () => {
  let activeAccount = 'synthetic-owner', switchDuringRead = false;
  const api = load('components/labs/production-client.ts', { '@/lib/supabase/client': { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-token', user: { id: activeAccount } } } }) } }) } });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, blob: async () => { if (switchDuringRead) activeAccount = 'different-account'; return new Blob(['synthetic-private-file']); } });
  try {
    const valid = await api.productionPrivateBlob('/synthetic-private-file', 'synthetic-owner');
    assert.equal(await valid.text(), 'synthetic-private-file');
    switchDuringRead = true;
    await assert.rejects(() => api.productionPrivateBlob('/synthetic-private-file', 'synthetic-owner'), /connected to this private production workspace/);
  } finally { globalThis.fetch = previousFetch; }
});

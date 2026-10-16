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
  const exports = {}; new Function('require', 'exports', code)(name => { if (!(name in deps)) throw Error(`Missing dependency ${name}`); return deps[name]; }, exports); return exports;
}
const guidance = load('lib/labs/production-v2-guidance.ts');
const money = load('lib/labs/money.ts'), labels = load('components/labs/production-labels.ts'), slotLabels = load('components/labs/production-v2-labels.ts'), slotTypes = load('lib/labs/production-v2-types.ts');
const deps = { react: React, 'react/jsx-runtime': jsxRuntime, 'lucide-react': icons, 'next/link': ({ children, href, ...props }) => React.createElement('a', { href, ...props }, children), 'next/image': ({ unoptimized, ...props }) => React.createElement('img', props), '@/lib/labs/money': money, '@/lib/labs/production-v2-types': slotTypes, './production.module.css': {}, './production-v2.module.css': {}, './production-v2-guided.module.css': {}, './production-connectors.module.css': {}, '@/lib/labs/production-v2-guidance': guidance, './production-labels': labels, './production-v2-labels': slotLabels, '@/lib/supabase/client': { createClient() { throw Error('Render cannot read accounts'); } }, './production-client': { productionFetch() { throw Error('Render cannot request private data'); } }, './production-v2-client': { productionV2Request() { throw Error('Render cannot mutate jobs'); } } };
const crop = load('components/labs/production-crop-editor.tsx', deps), connectors = load('components/labs/production-connectors.tsx', deps);
const owner = load('components/labs/production-v2-workspace.tsx', { ...deps, './production-crop-editor': crop, './production-connectors': connectors });
const parent = load('components/labs/production-v2-gallery.tsx', deps);
const stamp = '2026-10-16T01:00:00.000Z';
const asset = (id, width = 2400, height = 3000) => ({ id, kind: 'crop', filename: `Synthetic-${id}.jpg`, sha256: 'a'.repeat(64), byteSize: 3000, widthPixels: width, heightPixels: height, contentType: 'image/jpeg' });
function job(overrides = {}) {
  return { workflowVersion: 2, id: 'job-synthetic', reference: 'TEST-SYNTHETIC-LONG-REFERENCE-ONLY', galleryId: 'private-gallery-id', version: 2, status: 'accepted', studioName: 'Synthetic Studio', targetLabel: 'Synthetic Lab', targetKind: 'partner_lab', amountKind: 'retail', canReceive: true, canApproveOrder: true, canCrop: true, canChangeSource: true, canReopen: false, canReprint: false, dispatchState: 'idle', reprintOf: null, availablePhotos: ['8x10','5x7-a','5x7-b'].map(id => ({ id: `public-${id}`, filename: `Synthetic-${id}.jpg`, widthPixels: 4000, heightPixels: 6000 })), policy: { autoApprove: false, cropResponsibility: 'photographer', labColourCorrection: false }, offer: { id: 'offer-synthetic', name: 'Synthetic print package', retailCents: 4299, contents: [{ name: '8x10 Lustre', qty: 1 }, { name: '5x7 Lustre', qty: 2 }] }, currency: 'CAD', quantity: 2, subtotalMinor: 8598, photographerApproved: false, photographerApprovedAt: null, slots: ['8x10','5x7-a','5x7-b'].map(id => ({ id, photoId: `public-${id}`, size: id === '8x10' ? '8x10' : '5x7', quantity: 2, source: { ...asset(`private-original-${id}`, 4000, 6000), kind: 'original' }, widthInches: id === '8x10' ? 8 : 5, heightInches: id === '8x10' ? 10 : 7, crop: null, cropAsset: null, cropApproved: false, cropApprovedAt: null, colourAsset: null, colourCompletedAt: null, finalReviewedAt: null, finalAsset: null })), holds: ['photographer_approval','crop_8x10','crop_5x7-a','crop_5x7-b','final_review_8x10','final_review_5x7-a','final_review_5x7-b'], events: [{ id: 'event-test', action: 'submitted', actorRole: 'photographer', version: 1, createdAt: stamp }], testOnly: true, payment: 'test_no_payment', printAllowed: false, createdAt: stamp, updatedAt: stamp, ...overrides };
}
const detail = value => renderToStaticMarkup(React.createElement(owner.ProductionV2JobDetail, { job: value, audience: 'studio', userId: 'synthetic-user', busy: false, fileBusy: '', crop: null, onAction() { throw Error('Render cannot approve'); }, onCrop() {}, onSaveCrop() {}, onCancelCrop() {}, onCorrected() {}, onDownload() {}, onDownloadAsset() {}, onStage() {} }));

test('parents must choose all three available decoded photos, allowing independent or repeated sources', () => {
  const photos = ['a','b','c'].map(id => ({ id }));
  assert.equal(parent.productionV2SelectionsValid({ '8x10': 'a', '5x7-a': 'b', '5x7-b': 'c' }, photos, ['a','b','c']), true);
  assert.equal(parent.productionV2SelectionsValid({ '8x10': 'a', '5x7-a': 'a', '5x7-b': 'a' }, photos, ['a']), true);
  for (const selections of [{ '8x10': 'a', '5x7-a': 'b', '5x7-b': '' }, { '8x10': 'a', '5x7-a': 'b', '5x7-b': 'private-asset' }]) assert.equal(parent.productionV2SelectionsValid(selections, photos, ['a','b','private-asset']), false);
  assert.equal(parent.productionV2SelectionsValid({ '8x10': 'a', '5x7-a': 'b', '5x7-b': 'c' }, photos, ['a','b']), false);
});
test('package quantity permits only 1 through 10 complete sets', () => {
  for (let i = 1; i <= 10; i++) assert.equal(parent.productionV2ParentQuantity(String(i)), i);
  for (const bad of ['', '0', '11', '-1', '1.5', '1e1', '01', ' 2']) assert.equal(parent.productionV2ParentQuantity(bad), null);
});
test('independent slot reviews expose all three sources and keep automatic order release separate from image work', () => {
  const html = detail(job({ photographerApproved: true, policy: { autoApprove: true, cropResponsibility: 'lab', labColourCorrection: true }, holds: ['crop_5x7-a','colour_5x7-b','final_review_8x10'] }));
  for (const label of ['8×10 · 2 copies', '5×7 A · 2 copies', '5×7 B · 2 copies', 'Synthetic-private-original-5x7-a.jpg', 'Synthetic-private-original-5x7-b.jpg', 'Automatically approved', '0/3 crops', 'Review and approve the 5×7 A crop', 'Complete 5×7 B lab colour review', 'Review the 8×10 final print file']) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, />Start production preparation</);
  assert.equal((html.match(/aria-label="[^"]+ print review"/g) || []).length, 1);
  assert.match(html, /NEXT STEP/);
  assert.doesNotMatch(html, /Approve order for production review/);
});
test('source replacement and crop controls follow permissions and close after dispatch is sealed', () => {
  assert.match(detail(job()), /Choose another gallery photo for 8×10/);
  const viewer = detail(job({ canReceive: false, canApproveOrder: false, canCrop: false, canChangeSource: false }));
  assert.doesNotMatch(viewer, /Change 5×7 A photo|Choose another gallery photo|Start production preparation|Accept job for review|Approve order for/);
  assert.match(viewer, /85\.98/);
  const sealed = detail(job({ dispatchState: 'claimed', canReprint: true }));
  assert.doesNotMatch(sealed, /Choose another gallery photo|Crop 5×7 A|Approve saved 5×7 A crop/);
  assert.match(sealed, /Create linked full-package reprint/);
});
test('only the focused saved crop and final file can be approved, after its own preview loads', () => {
  for (const id of ['8x10', '5x7-a', '5x7-b']) {
    const value = job({ photographerApproved: true });
    value.slots = value.slots.map(slot => ({ ...slot, cropAsset: asset(`crop-${slot.id}`) }));
    value.slots.sort((a, b) => Number(b.id === id) - Number(a.id === id));
    const label = slotLabels.productionV2SlotLabel(id), html = detail(value);
    assert.ok(new RegExp(`disabled=""[^>]*>Approve saved ${label} crop`).test(html), label);
    assert.equal((html.match(/>Approve saved [^<]+ crop/g) || []).length, 1);
    value.slots = value.slots.map(slot => ({ ...slot, cropApproved: true }));
    const finalHtml = detail(value);
    assert.ok(new RegExp(`disabled=""[^>]*>Approve ${label} final print file`).test(finalHtml), label);
  }
});
test('each focused colour slot retains external correction and a separate unchecked no-change review', () => {
  for (const id of ['5x7-a', '5x7-b']) {
    const value = job({ photographerApproved: true, policy: { autoApprove: false, cropResponsibility: 'photographer', labColourCorrection: true } });
    value.slots = value.slots.map(slot => ({ ...slot, cropApproved: true, cropAsset: asset(`crop-${slot.id}`, slot.widthInches * 300, slot.heightInches * 300) }));
    value.slots.sort((a, b) => Number(b.id === id) - Number(a.id === id));
    const html = detail(value), label = slotLabels.productionV2SlotLabel(id);
    for (const text of [`Upload corrected ${label} file`, `Save ${label} no-change review`, 'Production files use sRGB', 'keep this print’s 1500 × 2100 pixels unchanged', 'Colour needs a correction']) assert.ok(html.includes(text), text);
    assert.ok(new RegExp(`disabled=""[^>]*>Save ${label} no-change review`).test(html));
  }
});
test('reviewed handoff keeps distinct paper downloads in collapsed details and requires acknowledgment', () => {
  const value = job({ status: 'in_production', photographerApproved: true, holds: [] }); value.slots = value.slots.map(slot => { const final = asset(`final-${slot.id}`); return { ...slot, cropAsset: final, cropApproved: true, finalReviewedAt: stamp, finalAsset: final }; });
  const html = detail(value);
  for (const label of ['5×7 A file', '5×7 B file', '10×7 sheet · A + B', 'left and right cells keep the independent 5×7 A and B renders', 'does not print them', 'Physical printing disabled']) assert.ok(html.includes(label), label);
  assert.match(html, /disabled=""[^>]*>Stage on Windows test helper/);
  assert.match(html, /<details[^>]*><summary>Order details, files &amp; history/);
  assert.doesNotMatch(html, /<details[^>]*open=""/);
  assert.ok(html.indexOf('Order details, files &amp; history') < html.indexOf('Order manifest'));
});
test('public receipt shows all three public filename choices and no private source or receiver controls', () => {
  const value = job(); const receipt = { ...value, printSlots: value.slots.map(slot => ({ slotId: slot.id, photoId: slot.photoId, filename: `Parent-choice-${slot.id}.jpg` })) };
  const html = renderToStaticMarkup(React.createElement(parent.ProductionV2ReceiptView, { receipt, busy: false, onRefresh() {} }));
  for (const text of ['2 × 8×10', '2 × 5×7 A', '2 × 5×7 B', 'Parent-choice-5x7-b.jpg', '85.98', 'Refresh order status']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /private-original|private-gallery-id|sourceAsset|Crop 5|Upload corrected|Approve.*final|assetId|sha256/);
});
test('partner lab amount is honestly identified as wholesale, without synthetic studio retail', () => {
  const html = detail(job({ amountKind: 'wholesale', subtotalMinor: 2400, offer: { ...job().offer, retailCents: 1200, name: '1 × 8×10 + 2 × 5×7' } }));
  assert.match(html, /Lab product cost:.*24\.00/); assert.doesNotMatch(html, /Retail subtotal|85\.98/);
});
test('private gallery client keeps capability in fragment and parent POST retains all print selections', async () => {
  class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const client = load('components/labs/production-v2-client.ts', { './production-client': { ProductionApiError: ApiError } });
  const id = '11111111-1111-4111-8111-111111111111', token = 'a'.repeat(64);
  const path = client.productionV2GalleryPath(id, token); assert.equal(path, `/labs-pilot/production-v2/${id}#access=${token}`); assert.ok(!path.includes('?')); assert.throws(() => client.productionV2GalleryPath(id, 'bad'));
  const body = { action: 'submit', galleryId: id, accessToken: token, requestId: id, receiptToken: 'b'.repeat(64), selections: { '8x10': 'photo-1', '5x7-a': 'photo-2', '5x7-b': 'photo-3' }, quantity: 2 };
  const previous = globalThis.fetch; let seen;
  globalThis.fetch = async (url, options) => { seen = { url, options }; return { ok: true, json: async () => ({ ok: true }) }; };
  try { await client.productionV2ParentRequest(body); assert.equal(seen.url, '/api/labs-pilot/production-v2'); assert.deepEqual(JSON.parse(seen.options.body), body); assert.equal(seen.options.cache, 'no-store'); }
  finally { globalThis.fetch = previous; }
});
test('connector setup defaults require explicit authorization and reveal no generated secret during render', () => {
  const html = renderToStaticMarkup(React.createElement(connectors.ProductionConnectorPanel, { audience: 'lab', userId: 'synthetic-user' }));
  for (const label of ['Windows test helper', 'physical printing remain disabled', 'Codes expire after 10 minutes', '90 days', 'I authorize this Windows test helper', '/labs-pilot/connector-download']) assert.ok(html.includes(label), label);
  assert.match(html, /disabled=""[^>]*>[\s\S]*?Create private pairing code/); assert.doesNotMatch(html, /Enter this code in the Windows test helper|checked=""|hotfolder/i);
});

test('reopen and linked reprint reasons reject short and control-character input before retaining a mutation', () => {
  assert.equal(owner.productionV2CorrectionReason('  Correct 5x7 B framing  '), 'Correct 5x7 B framing');
  for (const invalid of ['', '  ', 'crop', 'x'.repeat(501), 'bad\nreason', 'bad\u0000reason']) assert.equal(owner.productionV2CorrectionReason(invalid), null);
});

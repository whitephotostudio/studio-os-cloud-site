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
const ui = load('components/labs/in-house-price-sheets.tsx', {
  react: React, 'react/jsx-runtime': jsxRuntime, 'lucide-react': icons, '@/lib/labs/money': money,
  '@/lib/supabase/client': { createClient() { throw Error('Rendering must not fetch or mutate private sheets'); } },
  './lab-dialog': { LabDialog({ children }) { return React.createElement('div', null, children); } },
  './labs.module.css': { default: {} }, './in-house-price-sheets.module.css': { default: {} },
});
const fixture = (currency = 'CAD') => ({ id: 'sheet-test', version: 5, name: 'Sample studio copy', studioName: 'Sample Studio', currency, status: 'draft', fulfillment: 'in_house', updatedAt: '2026-10-15T22:00:00Z', source: { profileId: 'profile-test', profileName: 'Original sample profile', contentHash: 'fixture-hash' }, tax: { enabled: true, percent: 13, label: 'Sample tax' }, warnings: ['Two source rows share the same name; both are preserved.', 'A name and recorded quantity differ; both are preserved.'], sourceSnapshot: { untouched: true }, entries: [
  { id: 'print-1', sourceKey: '0', section: 'individual', name: '4 × 6 Print', retailCents: 500, active: true, category: 'Prints', contents: [{ size: '4x6', qty: 1, finish: 'Lustre' }], original: { price: 5 } },
  { id: 'pack-1', sourceKey: '1', section: 'package', name: 'Gift Package', retailCents: 2500, active: true, category: 'Packages', contents: [{ name: 'Wallet sheet', qty: 1, type: 'print', size: 'As configured' }, { name: 'Digital Download', qty: 1, type: 'digital', selectionMode: 'one chosen portrait' }], original: { options: { includeDigital: true } } },
  { id: 'print-2', sourceKey: '2', section: 'individual', name: '4 × 6 Print', retailCents: 750, active: false, category: 'Prints', contents: [], original: { price: 7.5 } },
  { id: 'special-1', sourceKey: '3', section: 'specialty', name: 'Group portrait', retailCents: 1000, active: true, category: 'Groups', contents: [{ format: 'Source setting' }], original: {} },
] });

test('private in-house cards show copied studio identity and all preserved rows, without publishing controls', () => {
  const html = renderToStaticMarkup(React.createElement(ui.InHousePriceSheets, { sheets: [fixture()], onSheetsChange() { throw Error('Rendering cannot save'); } }));
  for (const label of ['Your studio prices', 'Sample Studio', 'Sample studio copy', 'Private', 'Test copy', 'individual sizes', 'packages', 'specialty products', 'Internal cost not set']) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /Assign to gallery|Publish|Send to lab|profit|Source setting|Digital Download/);
  assert.match(html, /Current schools, original price profiles and existing orders keep their pricing/);
});

test('empty in-house section does not invent products or show local file paths', () => {
  const html = renderToStaticMarkup(React.createElement(ui.InHousePriceSheets, { sheets: [], onSheetsChange() {} }));
  assert.match(html, /Bring your in-house prices here/);
  assert.doesNotMatch(html, /\/Users\/|\.json|\.csv|\$[0-9]|Upload/);
});

test('contents retain explicitly recorded wallet, digital, quantities and false or zero options without inferred units', () => {
  const content = [{ name: 'Wallet sheet', qty: 1, size: 'As configured' }, { name: 'Digital Download', qty: 1, includeRetouch: false }, { border: 0 }];
  const before = structuredClone(content);
  assert.equal(ui.inHouseContentText(content), 'name: Wallet sheet · qty: 1 · size: As configured; name: Digital Download · qty: 1 · include Retouch: false; border: 0');
  assert.deepEqual(content, before);
  assert.doesNotMatch(ui.inHouseContentText(content), /2.5|3.5|eight|8 wallets/);
});

test('save serializes only copy name, version and exact entry price or active edits, retaining duplicate source rows', () => {
  const sheet = fixture(), before = structuredClone(sheet);
  const prices = Object.fromEntries(sheet.entries.map(entry => [entry.id, money.formatCurrencyAmount(entry.retailCents, sheet.currency)]));
  const active = Object.fromEntries(sheet.entries.map(entry => [entry.id, entry.active]));
  prices['print-1'] = '6.25'; active['pack-1'] = false;
  const changes = ui.inHouseSaveChanges(sheet, ' New test copy ', prices, active);
  assert.equal(changes.name, 'New test copy'); assert.equal(changes.expectedVersion, 5);
  assert.equal(changes.entries.length, 4); assert.deepEqual(changes.entries[0], { id: 'print-1', retailCents: 625, active: true });
  assert.deepEqual(changes.entries[2], { id: 'print-2', retailCents: 750, active: false });
  assert.equal(changes.entries[1].active, false);
  assert.doesNotMatch(JSON.stringify(changes), /contents|original|tax|source|studioName|wholesale|fulfillment|gallery/);
  assert.deepEqual(sheet, before);
});

test('manual retail edits respect zero and three digit currencies and reject blank, negative, overprecision and huge values', () => {
  for (const [currency, value, expected] of [['JPY', '1250', 1250], ['BHD', '1.234', 1234], ['CAD', '1.23', 123]]) {
    const sheet = fixture(currency), prices = Object.fromEntries(sheet.entries.map(entry => [entry.id, value]));
    assert.equal(ui.inHouseSaveChanges(sheet, sheet.name, prices, {}).entries[0].retailCents, expected);
  }
  for (const [currency, value] of [['JPY', '1.2'], ['BHD', '1.2345'], ['CAD', ''], ['CAD', '-1'], ['CAD', 'NaN'], ['CAD', '1000000.01']]) {
    const sheet = fixture(currency), prices = Object.fromEntries(sheet.entries.map(entry => [entry.id, value]));
    assert.throws(() => ui.inHouseSaveChanges(sheet, sheet.name, prices, {}), /Check the/);
  }
});

test('editor keeps both duplicate rows and source warnings with reference tax, without checkout actions or cost assumptions', () => {
  const html = renderToStaticMarkup(React.createElement(ui.InHousePriceSheetEditor, { initialSheet: fixture(), onClose() {}, onSaved() {} }));
  assert.equal((html.match(/4 × 6 Print<\/h3>/g) ?? []).length, 2);
  for (const label of ['Original sample profile', 'Sample tax · 13% · enabled', 'does not calculate or collect tax', 'Two source rows share', 'name and recorded quantity differ', 'Original contents preserved']) {
    assert.ok(html.includes(label), label);
  }
  assert.match(html, /Inactive/); assert.match(html, /Reload saved copy/); assert.match(html, /Save test copy/);
  assert.doesNotMatch(html, /Publish|Assign to gallery|Send to lab|Lab cost:|Profit:/);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../lib/credit-purchase-link.ts', import.meta.url), 'utf8');
const exports = {};
new Function('exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(exports);
const id = '7bfc8311-1085-4f0d-a3be-6f48f126ceb2';
test('desktop pack selection survives sign-in without trusting identity or credit amount from the URL', () => {
  const url = new URL(exports.creditPurchaseSignInUrl(`?package_id=${id}&studio_id=someone-else&credits=999999&email=other@example.com`), 'https://example.com');
  assert.equal(url.searchParams.get('redirect'), `/credits?package_id=${id}`);
  assert.equal(exports.selectedCreditPack(`?package_id=${id}&credits=999999`, [{ id, code: 'background_credits_250' }]), 'background_credits_250');
});
test('unrecognized package IDs and forged destinations cannot start or redirect a purchase', () => {
  assert.equal(exports.selectedCreditPack('?package_id=other', [{ id, code: 'background_credits_250' }]), null);
  assert.equal(exports.creditPurchaseSignInUrl('?package_id=https://evil.example/&redirect=//evil.example'), '/sign-in?redirect=%2Fcredits');
});

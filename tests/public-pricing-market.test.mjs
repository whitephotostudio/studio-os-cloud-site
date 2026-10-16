import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(path) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', 'process', code)(name => {
    assert.equal(name, './studio-pricing');
    return load('lib/studio-pricing.ts');
  }, exports, { env: {} });
  return exports;
}

const { publicPricingMarket } = load('lib/public-pricing-market.ts');

test('public pricing defaults US visitors to USD and visitors in Canada to CAD', () => {
  assert.equal(publicPricingMarket(undefined, 'US').currency, 'usd');
  assert.equal(publicPricingMarket(undefined, 'CA').currency, 'cad');
  for (const country of [undefined, '', 'FR', 'AU', 'GB', 'invalid']) {
    assert.equal(publicPricingMarket(undefined, country).currency, 'usd');
  }
});

test('an explicit supported pricing selection wins over visitor location', () => {
  assert.equal(publicPricingMarket('CA', 'US').currency, 'cad');
  assert.equal(publicPricingMarket('US', 'CA').currency, 'usd');
  assert.equal(publicPricingMarket(' usd ', 'CA').currency, 'usd');
  assert.equal(publicPricingMarket('AU', 'CA').orderingAvailable, false);
  assert.equal(publicPricingMarket('GB', 'US').orderingAvailable, false);
  assert.equal(publicPricingMarket(['CA', 'US'], 'US').currency, 'usd');
  assert.equal(publicPricingMarket('untrusted', 'CA').currency, 'cad');
});

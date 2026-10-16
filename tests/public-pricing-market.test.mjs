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

test('public pricing defaults visitors in each supported country to its currency', () => {
  for (const [country, currency] of [['CA', 'cad'], ['US', 'usd'], ['AU', 'aud'], ['GB', 'gbp']]) {
    const market = publicPricingMarket(undefined, country);
    assert.equal(market.currency, currency);
    assert.equal(market.orderingAvailable, true);
  }
  assert.equal(publicPricingMarket(undefined, ' au ').currency, 'aud');
  for (const country of [undefined, '', 'FR', 'invalid']) {
    assert.equal(publicPricingMarket(undefined, country).currency, 'usd');
  }
});

test('an explicit supported pricing selection wins over visitor location', () => {
  assert.equal(publicPricingMarket('CA', 'US').currency, 'cad');
  assert.equal(publicPricingMarket('US', 'CA').currency, 'usd');
  assert.equal(publicPricingMarket(' usd ', 'CA').currency, 'usd');
  assert.equal(publicPricingMarket('AU', 'CA').currency, 'aud');
  assert.equal(publicPricingMarket('gbp', 'US').currency, 'gbp');
  assert.equal(publicPricingMarket(['CA', 'US'], 'US').currency, 'usd');
  assert.equal(publicPricingMarket('untrusted', 'CA').currency, 'cad');
});

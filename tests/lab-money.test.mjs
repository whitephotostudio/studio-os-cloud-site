import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';

const source = ts.transpileModule(fs.readFileSync(new URL('../lib/labs/money.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const money = {};
new Function('exports', source)(money);

test('currency exponents, decimal parsing and editable displays preserve CAD/USD/JPY/BHD minor units', () => {
  for (const [currency, exponent, decimal, minor] of [['CAD', 2, '12.34', 1234], ['USD', 2, '12.34', 1234], ['JPY', 0, '1234', 1234], ['BHD', 3, '12.345', 12345]]) {
    assert.equal(money.currencyMinorUnits(currency), exponent);
    assert.equal(money.currencyScale(currency), 10 ** exponent);
    assert.equal(money.parseCurrencyAmount(decimal, currency), minor);
    assert.equal(money.formatCurrencyAmount(minor, currency), decimal);
    assert.equal(money.parseCurrencyAmount(money.formatCurrencyAmount(minor, currency), currency), minor);
    assert.equal(typeof money.formatCurrencyMinor(minor, currency), 'string');
  }
  assert.equal(money.parseCurrencyAmount('0.29', 'CAD'), 29, 'Decimal conversion never truncates float 0.29 to 28 cents');
  assert.equal(money.parseCurrencyAmount('0.001', 'BHD'), 1);
  assert.equal(money.formatCurrencyAmount(-1, 'BHD'), '-0.001');
  assert.equal(money.formatCurrencyAmount(1, 'JPY'), '1');
  assert.equal(money.formatCurrencyAmount(0, 'CAD'), '0.00');
  assert.equal(money.parseCurrencyAmount('90071992547409.91', 'CAD'), Number.MAX_SAFE_INTEGER);
  assert.equal(money.formatCurrencyAmount(Number.MAX_SAFE_INTEGER, 'CAD'), '90071992547409.91');
});

test('currency validation rejects invented identifiers, excess precision, ambiguous formatting and unsafe values', () => {
  for (const currency of ['ZZZ', 'cad', ' CAD', 'US', '123', '', null]) {
    assert.equal(money.isSupportedCurrency(currency), false);
    assert.throws(() => money.currencyMinorUnits(currency));
    assert.equal(money.parseCurrencyAmount('12', currency), null);
  }
  for (const [value, currency] of [['12.345', 'CAD'], ['12.3', 'JPY'], ['12.3456', 'BHD'], ['-1', 'USD'], ['1e3', 'USD'], ['1,000.00', 'CAD'], ['NaN', 'CAD'], ['Infinity', 'CAD'], ['9007199254740992', 'JPY'], ['90071992547409.92', 'CAD'], ['1'.repeat(10_000), 'CAD']]) {
    assert.equal(money.parseCurrencyAmount(value, currency), null, `${value.slice(0, 40)} ${currency}`);
  }
  assert.throws(() => money.formatCurrencyAmount(1.5, 'CAD'));
  assert.throws(() => money.formatCurrencyMinor(Number.NaN, 'CAD'));
});

test('retail rounding uses the actual currency scale and cannot manufacture fractions for JPY', () => {
  assert.equal(money.roundedLabRetail(317, 100, 'none', 'CAD'), 634);
  assert.equal(money.roundedLabRetail(317, 100, 'nearest-dollar', 'CAD'), 600);
  assert.equal(money.roundedLabRetail(317, 100, '0.99', 'CAD'), 699);
  assert.equal(money.roundedLabRetail(317, 100, 'nearest-dollar', 'JPY'), 634);
  assert.equal(money.roundedLabRetail(317, 100, '0.99', 'JPY'), 634);
  assert.equal(money.roundedLabRetail(1234, 100, 'none', 'BHD'), 2468);
  assert.equal(money.roundedLabRetail(1234, 100, 'nearest-dollar', 'BHD'), 2000);
  assert.equal(money.roundedLabRetail(1234, 100, '0.99', 'BHD'), 2990);
  assert.throws(() => money.roundedLabRetail(-1, 100, 'none', 'CAD'));
  assert.throws(() => money.roundedLabRetail(100, Number.NaN, 'none', 'CAD'));
});

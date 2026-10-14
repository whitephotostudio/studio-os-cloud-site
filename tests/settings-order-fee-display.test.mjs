import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

const require = createRequire(import.meta.url);
const settingsSource = readFileSync(new URL('../app/dashboard/settings/page.tsx', import.meta.url), 'utf8');
const catalogPlans = [
  {code: 'starter', label: 'Starter', description: 'Online gallery plan details.', priceCents: 4900, annualPriceCents: 52920, usageFeeApplies: true, usageRateCents: 55, websiteLogoIncluded: false},
  {code: 'core', label: 'App Plan', description: 'Desktop app plan details.', priceCents: 9900, annualPriceCents: 106920, usageFeeApplies: true, usageRateCents: 40, websiteLogoIncluded: true},
  {code: 'studio', label: 'Studio', description: 'Full studio plan details.', priceCents: 19900, annualPriceCents: 214920, usageFeeApplies: true, usageRateCents: 35, websiteLogoIncluded: true},
];
const catalog = {currency: 'cad', plans: catalogPlans, annualDiscountPercent: 10, extraDesktopKeyMonthlyCents: 5500, extraDesktopKeyAnnualCents: 59400, creditPacks: []};

/** Render the actual settings page with named state initialized as a completed status response. */
function settingsHtml(state = {}) {
  const fixture = {loading: false, sessionReady: true, signedIn: true, billingCatalog: catalog, ...state};
  const injected = new Set();
  const compiled = ts.transpileModule(settingsSource, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
    transformers: {before: [context => {
      const visit = node => {
        if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === 'useState') {
          const first = node.name.elements[0];
          if (first && ts.isBindingElement(first) && ts.isIdentifier(first.name) && Object.hasOwn(fixture, first.name.text)) {
            injected.add(first.name.text);
            const call = ts.factory.updateCallExpression(node.initializer, node.initializer.expression, node.initializer.typeArguments, [ts.factory.createCallExpression(ts.factory.createIdentifier('__stateFixture'), undefined, [ts.factory.createStringLiteral(first.name.text)])]);
            return ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type, call);
          }
        }
        return ts.visitEachChild(node, visit, context);
      };
      return source => ts.visitNode(source, visit);
    }]},
  }).outputText;
  assert.deepEqual([...injected].sort(), Object.keys(fixture).sort(), 'all fixture states must match actual named page states');
  const overrides = {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    'lucide-react': require('lucide-react'),
    'next/link': {__esModule: true, default: ({children, ...props}) => React.createElement('a', props, children)},
    'qrcode.react': {QRCodeSVG: () => null},
    '@/lib/supabase/client': {createClient: () => ({})},
    '@/components/whats-new-dot': {WhatsNewDot: () => null, useIsFeatureNew: () => ({isNew: false, dismiss() {}})},
  };
  const sharedExports = {};
  const shared = ts.transpileModule(readFileSync(new URL('../lib/order-fee-display.ts', import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText;
  new Function('exports', shared)(sharedExports);
  overrides['@/lib/order-fee-display'] = sharedExports;
  for (const path of ['lib/proof-watermark', 'components/parents/proof-watermark-overlay']) {
    const dependencyExports = {};
    const output = ts.transpileModule(readFileSync(new URL(`../${path}.${path.startsWith('components/') ? 'tsx' : 'ts'}`, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX}}).outputText;
    new Function('require', 'exports', output)(name => {
      assert.ok(Object.hasOwn(overrides, name), `unexpected watermark dependency: ${name}`);
      return overrides[name];
    }, dependencyExports);
    overrides[`@/${path}`] = dependencyExports;
  }
  const exports = {};
  new Function('require', 'exports', '__stateFixture', compiled)(name => {
    assert.ok(Object.hasOwn(overrides, name), `unexpected settings dependency: ${name}`);
    return overrides[name];
  }, exports, name => fixture[name]);
  return renderToStaticMarkup(React.createElement(exports.default));
}

function text(html) {
  return html.replace(/<[^>]*>/g, ' ').replaceAll('&amp;', '&').replaceAll('&#x27;', "'").replace(/\s+/g, ' ').trim();
}

function markedDiv(html, marker) {
  const start = html.search(new RegExp(`<div\\b[^>]*\\b${marker}(?:=|\\s|>)`));
  assert.ok(start >= 0, `rendered ${marker} panel exists`);
  let depth = 0;
  for (const match of html.slice(start).matchAll(/<div\b[^>]*>|<\/div>/g)) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(start, start + match.index + match[0].length);
  }
  assert.fail(`unclosed ${marker} panel`);
}

for (const interval of ['month', 'year']) {
  test(`settings ${interval} plan cards show catalog order fees at the bottom after notes`, () => {
    const html = settingsHtml({desiredBillingInterval: interval});
    const cards = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]).filter(card => card.includes('data-order-fee'));
    assert.equal(cards.length, 3);
    for (const [index, card] of cards.entries()) {
      const plan = catalogPlans[index], fee = markedDiv(card, 'data-order-fee');
      assert.match(card, /display:flex;flex-direction:column/);
      assert.match(card, /margin-top:auto/);
      assert.match(fee, /font-size:13px;font-weight:400/);
      assert.doesNotMatch(fee, /border:|background:|box-shadow:|font-weight:(?:[6-9]00|bold)/);
      assert.ok(text(fee).includes(`${(plan.usageRateCents / 100).toFixed(2)} per paid order in your sales currency · deducted from each sale.`));
      assert.ok(text(fee).includes('Stripe processing fees are additional.'));
      const note = index === 0 ? 'Online gallery only.' : 'Background credits sold separately.';
      assert.ok(card.indexOf(note) > card.indexOf(plan.description));
      assert.ok(card.indexOf(fee) > card.indexOf(note), 'fee follows the last plan note');
      assert.equal(card.slice(card.indexOf(fee) + fee.length), '</div></button>', 'only the notes footer closes after the fee');
    }
    assert.doesNotMatch(text(html), /aggregated order usage separately through platform billing/);
  });
}

test('settings plan fees use the response catalog rather than stored rate or hardcoded defaults', () => {
  const customPlans = catalogPlans.map((plan, index) => ({...plan, usageRateCents: [73, 62, 51][index]}));
  const html = settingsHtml({billingCatalog: {...catalog, plans: customPlans}, orderUsageRateCents: 25, desiredBillingInterval: 'year'});
  for (const rate of ['0.73', '0.62', '0.51']) assert.ok(text(html).includes(`${rate} per paid order in your sales currency · deducted from each sale.`));
});

test('owner account shows exemption instead of a stale billable rate or refund credit instructions', () => {
  for (const subscriptionPlanCode of ['studio', null]) {
    const html = settingsHtml({isPlatformAdmin: true, subscriptionPlanCode, orderUsageRateCents: 25, studioUsage: {billableOrders: 171, countedOrders: 0, unreportedOrders: 171, estimatedChargeCents: 4275, refundCreditCents: 25, pendingFeeWaivers: 1, feeReviewRequired: 1}});
    const panel = text(markedDiv(html, 'data-order-usage'));
    assert.ok(panel.includes('Owner account exempt. No Studio OS per-order fees are billed to this account.'));
    assert.doesNotMatch(panel, /Usage rate|Billable paid orders|reported to Stripe|Pending report|Estimated usage|refund|next subscription bill|0\.25|42\.75/i);
  }
});

test('paid subscriber usage keeps the actual historical Stripe rate and refund follow-up', () => {
  const html = settingsHtml({isPlatformAdmin: false, subscriptionPlanCode: 'studio', stripeSubscriptionId: 'sub_fixture', subscriptionStatus: 'active', subscriptionIsActive: true, orderUsageRateCents: 25, studioUsage: {billableOrders: 10, countedOrders: 8, unreportedOrders: 2, estimatedChargeCents: 250, refundCreditCents: 25, pendingFeeWaivers: 1, feeReviewRequired: 1}});
  const panel = text(markedDiv(html, 'data-order-usage'));
  assert.ok(panel.includes('Legacy usage rate: $0.25 per paid order'), 'the actual subscriber rate remains independent of new catalog pricing');
  assert.ok(text(html).includes('0.35 per paid order in your sales currency · deducted from each sale.'), 'selection card shows current catalog pricing');
  assert.ok(panel.includes('Billable paid orders: 10'));
  assert.ok(panel.includes('Already reported to Stripe: 8'));
  assert.ok(panel.includes('$0.25 in refunded order fee credits queued this cycle.'));
  assert.ok(panel.includes('Full refunds of reported legacy order fees receive a credit on the next subscription bill.'));
  assert.doesNotMatch(panel, /Owner account exempt/);
});

test('new trial with no legacy activity shows current sale fees without a stale legacy rate', () => {
  const html = settingsHtml({isPlatformAdmin: false, subscriptionPlanCode: 'studio', subscriptionStatus: 'trialing', orderUsageRateCents: 25, studioUsage: {billableOrders: 0, countedOrders: 0, unreportedOrders: 0, estimatedChargeCents: 0, refundCreditCents: 0, pendingFeeWaivers: 0, feeReviewRequired: 0}});
  assert.doesNotMatch(html, /data-order-usage/);
  assert.doesNotMatch(text(html), /Legacy usage rate|Legacy order usage this cycle|\$0\.25 per paid order/);
  assert.ok(text(html).includes('0.35 per paid order in your sales currency · deducted from each sale.'));
});

test('legacy refund-only follow-up remains visible even without a current subscription', () => {
  const html = settingsHtml({isPlatformAdmin: false, subscriptionPlanCode: null, studioUsage: {billableOrders: 0, countedOrders: 0, unreportedOrders: 0, estimatedChargeCents: 0, refundCreditCents: 25, pendingFeeWaivers: 0, feeReviewRequired: 0}});
  const panel = text(markedDiv(html, 'data-order-usage'));
  assert.ok(panel.includes('$0.25 in refunded order fee credits queued this cycle.'));
});

function galleryCatalog(env = {STUDIO_GALLERY_PRICING_V2_ENABLED: '1'}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../lib/studio-pricing.ts', import.meta.url), 'utf8'),
    {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  new Function('exports', 'process', source)(exports, {env});
  const snapshot = exports.getPricingCatalogSnapshot();
  return {...snapshot, plans: Object.values(snapshot.plans), orderUsageRateCents: 0, creditPacks: []};
}

test('enabled settings show exact new prices, plan-specific annual savings and scoped production fees', () => {
  for (const desiredBillingInterval of ['month', 'year']) {
    const html = settingsHtml({billingCatalog: galleryCatalog(), desiredBillingInterval, orderUsageRateCents: 0});
    const rendered = text(html);
    assert.ok(rendered.includes('$59.00'), 'comparison sidebar derives monthly Gallery price from the server catalog');
    for (const amount of ['$599.00', '$1,069.20', '$2,149.20']) assert.ok(rendered.includes(amount), 'exact annual amount is preserved');
    assert.ok(rendered.includes('Save 15.4%'));
    assert.ok(rendered.includes('0.45 per qualifying school production order · deducted from each qualifying sale.'));
    assert.ok(rendered.includes('No platform fee on ordinary gallery sales.'));
    assert.ok(rendered.includes('Photo gallery hosting included.'));
    assert.doesNotMatch(rendered, /Unlimited JPEG|50 ?MB/i);
    assert.ok(rendered.includes('Existing subscriptions keep their current Stripe prices.'));
    assert.doesNotMatch(rendered, /Save null%|\$529|0\.00 per paid order|0\.40 per paid order|0\.35 per paid order/);
  }
});

test('production fees use the sales currency while subscription prices remain CAD', () => {
  for (const billingCurrency of ['usd', 'eur']) {
    const html = settingsHtml({billingCatalog: galleryCatalog(), billingCurrency, desiredBillingInterval: 'year', orderUsageRateCents: 0});
    const cards = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]).filter(card => card.includes('data-order-fee'));
    const salesFee = new Intl.NumberFormat('en-CA', {style: 'currency', currency: billingCurrency.toUpperCase()}).format(0.45);
    const cadAnnual = new Intl.NumberFormat('en-CA', {style: 'currency', currency: 'CAD'}).format(1069.20);
    assert.ok(text(cards[1]).includes(cadAnnual), 'subscription still uses the CAD catalog');
    for (const card of cards.slice(1)) {
      const fee = text(markedDiv(card, 'data-order-fee'));
      assert.ok(fee.includes(`${salesFee} per qualifying school production order`));
      assert.doesNotMatch(fee, /^(?:CA)?\$0\.45 per qualifying school production order/);
    }
  }
});

test('new pricing preserves real legacy rates and does not present a disabled meter as a zero prospective fee', () => {
  const billingCatalog = galleryCatalog();
  for (const orderUsageRateCents of [0, 25]) {
    const html = settingsHtml({billingCatalog, subscriptionPlanCode: 'core', orderUsageRateCents,
      studioUsage: {billableOrders: 0, countedOrders: 0, unreportedOrders: 0, estimatedChargeCents: 0, refundCreditCents: 25}});
    const panel = text(markedDiv(html, 'data-order-usage'));
    if (orderUsageRateCents === 0) {
      assert.ok(panel.includes('Subscription-billed order fees are disabled.'));
      assert.doesNotMatch(panel, /Legacy usage rate: \$0\.00/);
    } else assert.ok(panel.includes('Legacy usage rate: $0.25 per paid order'));
    assert.ok(panel.includes('$0.25 in refunded order fee credits queued this cycle.'));
    assert.ok(text(html).includes('0.45 per qualifying school production order'));
  }
});

test('all-order settings disclose every paid-plan fee using sales currency and retain CAD subscription prices', () => {
  for (const desiredBillingInterval of ['month', 'year']) {
    for (const billingCurrency of ['cad', 'usd', 'eur']) {
      const html = settingsHtml({billingCatalog: galleryCatalog({STUDIO_GALLERY_PRICING_V3_ENABLED: '1'}),
        billingCurrency, desiredBillingInterval, orderUsageRateCents: 0});
      const cards = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]).filter(card => card.includes('data-order-fee'));
      assert.equal(cards.length, 3);
      for (const [index, card] of cards.entries()) {
        const fee = text(markedDiv(card, 'data-order-fee'));
        const expectedRate = new Intl.NumberFormat('en-CA', {style: 'currency', currency: billingCurrency.toUpperCase()}).format(index === 0 ? .55 : .45);
        assert.ok(fee.includes(`${expectedRate} per paid order · deducted from each sale.`));
        assert.match(fee, /Stripe processing fees are additional/);
      }
      const rendered = text(html);
      assert.ok(rendered.includes(desiredBillingInterval === 'year' ? '$599.00' : '$59.00'));
      assert.match(rendered, /gallery, school, sports, event, print and digital orders/);
      assert.doesNotMatch(rendered, /ordinary gallery sales have no|qualifying school production|school production fee|Unlimited JPEG|50 ?MB/i);
    }
  }
});

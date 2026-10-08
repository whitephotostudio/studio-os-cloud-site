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

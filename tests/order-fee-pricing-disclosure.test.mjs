import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

const require = createRequire(import.meta.url);
const purpose = 'This flat fee helps cover secure photo hosting, order delivery, and ongoing platform maintenance and support.';
const billing = 'Billed monthly to your studio on paid plans, including annual subscriptions. Payment processing fees and AI background credits are separate.';
const paidPlans = [
  {code: 'starter', fee: '$0.55 CAD per paid order'},
  {code: 'core', fee: '$0.40 CAD per paid order'},
  {code: 'studio', fee: '$0.35 CAD per paid order'},
];
const surfaces = [
  {name: 'pricing page', path: 'app/pricing/page.tsx', exportName: 'default', props: {}, names: ['Web Gallery Plan', 'App Plan', 'Studio Plan']},
  {name: 'home pricing showcase', path: 'components/pricing-showcase.tsx', exportName: 'PricingShowcase', props: {variant: 'home'}, names: ['Web Gallery Plan', 'App Plan', 'Studio Plan']},
  {name: 'full pricing showcase', path: 'components/pricing-showcase.tsx', exportName: 'PricingShowcase', props: {variant: 'page'}, names: ['Starter Plan', 'Core Plan', 'Pro Plan']},
];

/** Render the actual components and catalog; only shell UI and initial cadence are substituted. */
function serverHtml(surface, interval, env = {}) {
  let stateIndex = 0;
  const react = {...React, useState(initial) {
    if (stateIndex++ === 0) {
      assert.equal(initial, 'month', 'pricing cadence is the first state');
      initial = interval;
    }
    return React.useState(initial);
  }};
  const overrides = {
    react,
    'react/jsx-runtime': jsxRuntime,
    'lucide-react': require('lucide-react'),
    'next/link': {__esModule: true, default: ({children, ...props}) => React.createElement('a', props, children)},
    '@/components/marketing/Reveal': {Reveal: ({children, className}) => React.createElement('div', {className}, children)},
    '@/components/json-ld': {PricingJsonLd: () => null},
    '@/components/site-header': {SiteHeader: () => null},
    '@/components/site-footer': {SiteFooter: () => null},
  };
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const exports = {};
    cache.set(path, exports);
    const compiled = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
    }).outputText;
    new Function('require', 'exports', 'process', compiled)(name => {
      if (name in overrides) return overrides[name];
      assert.ok(name.startsWith('@/lib/'), `unexpected pricing dependency: ${name}`);
      return load(name.slice(2) + '.ts');
    }, exports, {env});
    return exports;
  }
  return renderToStaticMarkup(React.createElement(load(surface.path)[surface.exportName], surface.props));
}

function decode(html) {
  return html.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&#39;', "'").replaceAll('&nbsp;', ' ');
}

function text(html) {
  return decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function planCard(html, name) {
  const matches = [...html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)]
    .map(match => match[0])
    .filter(article => [...article.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/g)]
      .some(heading => text(heading[1]) === name));
  assert.equal(matches.length, 1, `one rendered card for ${name}`);
  return matches[0];
}

function assertCardDisclosure(html, name, plan, interval) {
  const card = planCard(html, name);
  const cardText = text(card);
  assert.ok(cardText.includes(plan.fee), `${name}: exact fee with cents and CAD currency`);
  const afterFee = cardText.slice(cardText.indexOf(plan.fee) + plan.fee.length);
  assert.match(afterFee, /^\s*(?:Flat platform fee\s*·\s*|·\s*)?billed monthly/i, `${name}: monthly billing is attached to the order fee`);
  const anchors = [...card.matchAll(/<a\b[^>]*>/g)];
  const cta = anchors.filter(anchor => decode(anchor[0]).includes(`href="/sign-up?plan=${plan.code}&interval=${interval}"`));
  assert.equal(cta.length, 1, `${name}: CTA selects the rendered plan and cadence`);
  const feeIndex = card.indexOf(plan.fee);
  assert.ok(feeIndex >= 0 && feeIndex < cta[0].index, `${name}: order fee is visible before the purchase CTA`);
  assert.ok(cardText.includes(`/${interval === 'year' ? 'year' : 'month'}`), `${name}: selected subscription cadence rendered`);
  if (interval === 'year') assert.match(cardText, /Paid (?:annually|in advance)/, `${name}: actual annual subscription branch rendered`);
}

for (const surface of surfaces) {
  for (const interval of ['month', 'year']) {
    test(`${surface.name}: ${interval} cards disclose all flat order fees before signup`, () => {
      const html = serverHtml(surface, interval);
      for (const [index, plan] of paidPlans.entries()) assertCardDisclosure(html, surface.names[index], plan, interval);
      const renderedText = text(html);
      assert.ok(renderedText.includes(purpose), 'explains hosting, delivery, maintenance and support');
      assert.ok(renderedText.includes(billing), 'monthly order-fee billing also applies to annual subscriptions; processing and AI are separate');
      assert.doesNotMatch(renderedText, /\b(?:0\s*%|zero(?:\s+percent)?)\s*(?:sales\s*)?commission\b|commission[-\s]free|\bno\s+commission\b/i, 'flat order fees must not be described as zero commission');
    });
  }
}

test('public cards derive order fees from the catalog without applying the annual subscription discount', () => {
  const env = {
    STRIPE_STARTER_ORDER_USAGE_RATE_CENTS: '73',
    STRIPE_CORE_ORDER_USAGE_RATE_CENTS: '62',
    STRIPE_STUDIO_ORDER_USAGE_RATE_CENTS: '51',
    STRIPE_ANNUAL_DISCOUNT_PERCENT: '25',
  };
  const configuredPlans = paidPlans.map((plan, index) => ({...plan, fee: ['$0.73 CAD per paid order', '$0.62 CAD per paid order', '$0.51 CAD per paid order'][index]}));
  for (const surface of surfaces) {
    for (const interval of ['month', 'year']) {
      const html = serverHtml(surface, interval, env);
      for (const [index, plan] of configuredPlans.entries()) assertCardDisclosure(html, surface.names[index], plan, interval);
    }
  }
});

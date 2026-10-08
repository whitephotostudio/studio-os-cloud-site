import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

const require = createRequire(import.meta.url);
const purpose = 'Studio OS charges your studio a small flat fee for each paid order. This helps cover secure photo hosting, order delivery, platform maintenance, and support.';
const billing = 'Order fees are deducted automatically from each sale, including on annual plans. The same fee amount is charged in your studio’s sales currency. Stripe payment processing fees and AI background credits are additional.';
const paidPlans = [
  {code: 'starter', fee: '$0.55 per paid order'},
  {code: 'core', fee: '$0.40 per paid order'},
  {code: 'studio', fee: '$0.35 per paid order'},
];
const publicPlanNotes = [
  'Best if you only need client-facing gallery delivery and ordering.',
  'Includes 1 key only. If you need a second key, you must upgrade to Studio.',
  'Studio includes 2 keys and is the only plan that can add extra keys for $55 each.',
];
const surfaces = [
  {name: 'pricing page', path: 'app/pricing/page.tsx', exportName: 'default', props: {}, names: ['Web Gallery Plan', 'App Plan', 'Studio Plan'], notes: publicPlanNotes},
  {name: 'home pricing showcase', path: 'components/pricing-showcase.tsx', exportName: 'PricingShowcase', props: {variant: 'home'}, names: ['Web Gallery Plan', 'App Plan', 'Studio Plan'], notes: publicPlanNotes},
  {name: 'full pricing showcase', path: 'components/pricing-showcase.tsx', exportName: 'PricingShowcase', props: {variant: 'page'}, names: ['Starter Plan', 'Core Plan', 'Pro Plan'], notes: [
    'A simple way to start selling and delivering online.',
    'Best fit for photographers replacing multiple tools with one connected system.',
    'Built for studios ready to scale production volume without adding more disconnected software.',
  ]},
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

function assertCardDisclosure(html, name, note, plan, interval) {
  const card = planCard(html, name);
  const cardText = text(card);
  assert.ok(cardText.includes(plan.fee), `${name}: exact nominal fee with cents`);
  const afterFee = cardText.slice(cardText.indexOf(plan.fee) + plan.fee.length);
  assert.match(afterFee, /^\s*·\s*deducted from each sale/i, `${name}: fee collection is attached to the order fee`);
  const anchors = [...card.matchAll(/<a\b[^>]*>/g)];
  const href = plan.href ?? `/sign-up?plan=${plan.code}&interval=${interval}`;
  const cta = anchors.filter(anchor => decode(anchor[0]).includes(`href="${href}"`));
  assert.equal(cta.length, 1, `${name}: CTA selects the rendered plan and cadence`);
  const feeIndex = card.indexOf(plan.fee);
  assert.equal(card.split(plan.fee).length - 1, 1, `${name}: fee appears once near signup`);
  const lastFeatureListEnd = card.lastIndexOf('</ul>') + '</ul>'.length;
  assert.ok(lastFeatureListEnd >= '</ul>'.length && feeIndex > lastFeatureListEnd, `${name}: fee follows included and excluded features`);
  const noteIndex = card.indexOf(note);
  assert.ok(noteIndex > lastFeatureListEnd && noteIndex + note.length < feeIndex, `${name}: plan note appears after features and before the fee`);
  assert.ok(feeIndex >= 0 && feeIndex < cta[0].index, `${name}: order fee is visible before the purchase CTA`);
  const disclosures = [...card.matchAll(/<div\b[^>]*\bdata-order-fee(?:="[^"]*")?[^>]*>[\s\S]*?<\/div>/g)];
  assert.equal(disclosures.length, 1, `${name}: one plain order-fee disclosure`);
  const disclosure = disclosures[0][0];
  assert.ok(disclosure.includes(plan.fee), `${name}: the exact fee is inside its plain disclosure`);
  const disclosureClasses = [...disclosure.matchAll(/class="([^"]*)"/g)].map(match => match[1]).join(' ');
  assert.match(disclosureClasses, /(?:^|\s)text-(?:xs|sm|\[13px\])(?:\s|$)/, `${name}: fee uses small text`);
  assert.doesNotMatch(disclosureClasses, /(?:^|\s)(?:\S+:)?(?:rounded|border|bg|shadow|font-(?:semibold|bold|black))(?=[-\s]|$)/, `${name}: fee has no boxed or bold emphasis`);
  assert.ok(text(disclosure).includes('Stripe processing fees are additional.'), `${name}: additional processing fees remain visible near signup`);
  assert.doesNotMatch(text(disclosure), /billed monthly|monthly invoice|next[- ](?:subscription[- ])?bill/i, `${name}: new order fees are not described as monthly charges`);
  assert.doesNotMatch(text(disclosure), /\bCAD\b|converted|exchange rate/i, `${name}: local-currency fee is not described as CAD conversion`);
  if (plan.code) {
    assert.ok(cardText.includes(`/${interval === 'year' ? 'year' : 'month'}`), `${name}: selected subscription cadence rendered`);
    if (interval === 'year') assert.match(cardText, /Paid (?:annually|in advance)/, `${name}: actual annual subscription branch rendered`);
  }
}

for (const surface of surfaces) {
  for (const interval of ['month', 'year']) {
    test(`${surface.name}: ${interval} cards disclose small flat fees after plan details and before signup`, () => {
      const html = serverHtml(surface, interval);
      for (const [index, plan] of paidPlans.entries()) assertCardDisclosure(html, surface.names[index], surface.notes[index], plan, interval);
      const renderedText = text(html);
      assert.ok(renderedText.includes(purpose), 'explains hosting, delivery, maintenance and support');
      assert.ok(renderedText.includes(billing), 'deduction from each sale also applies to annual subscriptions; processing and AI are additional');
      assert.doesNotMatch(renderedText, /\b(?:0\s*%|zero(?:\s+percent)?)\s*(?:sales\s*)?commission\b|commission[-\s]free|\bno\s+commission\b/i, 'flat order fees must not be described as zero commission');
    });
  }
}

test('Free Trial discloses the Studio order fee near signup without describing it as a free order', () => {
  const note = 'Includes everything in the Studio Plan for 30 days. After the trial, choose the plan that fits your studio.';
  for (const interval of ['month', 'year']) {
    assertCardDisclosure(serverHtml(surfaces[0], interval), 'Free Trial', note,
      {fee: '$0.35 per paid order', href: '/sign-up'}, interval);
    assertCardDisclosure(serverHtml(surfaces[0], interval, {STRIPE_STUDIO_ORDER_USAGE_RATE_CENTS: '51'}), 'Free Trial', note,
      {fee: '$0.51 per paid order', href: '/sign-up'}, interval);
  }
});

test('public cards derive order fees from the catalog without applying the annual subscription discount', () => {
  const env = {
    STRIPE_STARTER_ORDER_USAGE_RATE_CENTS: '73',
    STRIPE_CORE_ORDER_USAGE_RATE_CENTS: '62',
    STRIPE_STUDIO_ORDER_USAGE_RATE_CENTS: '51',
    STRIPE_ANNUAL_DISCOUNT_PERCENT: '25',
  };
  const configuredPlans = paidPlans.map((plan, index) => ({...plan, fee: ['$0.73 per paid order', '$0.62 per paid order', '$0.51 per paid order'][index]}));
  for (const surface of surfaces) {
    for (const interval of ['month', 'year']) {
      const html = serverHtml(surface, interval, env);
      for (const [index, plan] of configuredPlans.entries()) assertCardDisclosure(html, surface.names[index], surface.notes[index], plan, interval);
    }
  }
});

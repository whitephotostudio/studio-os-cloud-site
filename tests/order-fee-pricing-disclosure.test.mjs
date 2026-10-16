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
  {name: 'pricing page', path: 'components/pricing-page-client.tsx', exportName: 'PricingPageClient', props: {}, names: ['Web Gallery Plan', 'App Plan', 'Studio Plan'], notes: publicPlanNotes},
  {name: 'home pricing showcase', path: 'components/pricing-showcase.tsx', exportName: 'PricingShowcase', props: {variant: 'home'}, names: ['Web Gallery Plan', 'App Plan', 'Studio Plan'], notes: publicPlanNotes},
  {name: 'full pricing showcase', path: 'components/pricing-showcase.tsx', exportName: 'PricingShowcase', props: {variant: 'page'}, names: ['Starter Plan', 'Core Plan', 'Pro Plan'], notes: [
    'A simple way to start selling and delivering online.',
    'Best fit for photographers replacing multiple tools with one connected system.',
    'Built for studios ready to scale production volume without adding more disconnected software.',
  ]},
];

/** Render the actual components and catalog; only shell UI and initial cadence are substituted. */
function serverHtml(surface, interval, env = {}, currency = "cad") {
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
    'next/navigation': {useRouter:()=>({push(){}})},
    'next/link': {__esModule: true, default: ({children, ...props}) => React.createElement('a', props, children)},
    '@/components/marketing/Reveal': {Reveal: ({children, className}) => React.createElement('div', {className}, children)},
    '@/components/json-ld': {PricingJsonLd: () => null},
    '@/components/site-header': {SiteHeader: () => null},
    '@/components/site-footer': {SiteFooter: () => null},
    '@/components/csp-nonce': {useCspNonce: () => 'schema-test-nonce'},
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
  const catalog = load("lib/studio-pricing.ts").getPricingCatalogSnapshot(currency);
  return renderToStaticMarkup(React.createElement(load(surface.path)[surface.exportName], {...surface.props, catalog}));
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


test('new monthly and annual offers match exact CAD subscriptions and qualifying production fees across public cards', () => {
  const env = {STUDIO_GALLERY_PRICING_V2_ENABLED: '1'};
  for (const surface of surfaces) {
    for (const interval of ['month', 'year']) {
      const html = serverHtml(surface, interval, env);
      const gallery = text(planCard(html, 'Gallery'));
      const core = text(planCard(html, 'Core'));
      const studio = text(planCard(html, 'Studio'));
      for (const [actual, expected] of [[gallery, interval === 'month' ? '$59' : '$599.00'],
        [core, interval === 'month' ? '$99' : '$1,069.20'], [studio, interval === 'month' ? '$199' : '$2,149.20']]) {
        assert.ok(actual.includes(expected), `${surface.name}: exact ${interval} price ${expected}`);
        assert.ok(actual.includes('Photo gallery hosting included'), 'pricing publishes without unverified unlimited storage');
        assert.doesNotMatch(actual, /Unlimited|50 MB|50MB/);
      }
      assert.ok(gallery.includes('No platform fee on ordinary gallery sales'));
      for (const card of [core, studio]) {
        assert.ok(card.includes('0.45 per qualifying school production order'));
        assert.ok(card.includes('Ordinary gallery sales have no platform fee.'));
        assert.ok(card.includes('Stripe processing fees are additional.'));
      }
      assert.doesNotMatch(text(html), /saves 10% on the base subscription/, 'does not falsely apply one discount to Gallery');
    }
  }
});

test('unlimited needs its separate storage switch and states its storage boundaries', () => {
  const surface = surfaces[0];
  const legacy = text(serverHtml(surface, 'month'));
  const pricingOnly = text(serverHtml(surface, 'year', {STUDIO_GALLERY_PRICING_V2_ENABLED: '1'}));
  const next = text(serverHtml(surface, 'year', {STUDIO_GALLERY_PRICING_V2_ENABLED: '1', STUDIO_GALLERY_UNLIMITED_STORAGE_ENABLED: '1'}));
  assert.doesNotMatch(legacy, /Unlimited JPEG|What unlimited gallery storage includes/);
  assert.doesNotMatch(pricingOnly, /Unlimited|50 MB|50MB/);
  assert.ok(next.includes('There is no total photo-count or GB cap.'));
  assert.ok(next.includes('while your subscription is active'));
  assert.ok(next.includes('50 MB each'));
  assert.ok(next.includes('RAW files, PSD files, videos and general-purpose backup storage are excluded.'));
  assert.ok(next.includes('AI processing is billed separately.'));
});

test('Free Trial keeps its existing paid-order fee when the new paid catalog is published', () => {
  for (const interval of ['month', 'year']) {
    const html = serverHtml(surfaces[0], interval, {STUDIO_GALLERY_PRICING_V2_ENABLED: '1'});
    const trial = planCard(html, 'Free Trial');
    assert.match(text(trial), /\$0\.35 per paid order/);
    assert.doesNotMatch(text(trial), /0\.45|ordinary gallery sales have no platform fee|Unlimited/i);
    assert.ok(trial.indexOf('$0.35 per paid order') < trial.indexOf('href="/sign-up"'));
  }
});

test('rendered public pricing schemas advertise actual prices without unverified storage claims', () => {
  for (const exportName of ['PricingJsonLd', 'SoftwareApplicationJsonLd']) {
    const surface = {path: 'components/json-ld.tsx', exportName, props: {}};
    const html = serverHtml(surface, 'month', {STUDIO_GALLERY_PRICING_V2_ENABLED: '1'});
    const schema = JSON.parse(html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1]);
    const offers = Array.isArray(schema.offers) ? schema.offers : schema.offers.offers;
    assert.deepEqual(offers.map(offer => [offer.name, offer.price, offer.priceCurrency]),
      [['Gallery', '59.00', 'CAD'], ['Core', '99.00', 'CAD'], ['Studio', '199.00', 'CAD']]);
    assert.ok(offers.every(offer => /gallery hosting/i.test(offer.description)));
    assert.doesNotMatch(JSON.stringify(schema), /Unlimited|50 ?MB/i);
  }
});

test('all-order profile shows 55/45/45 fees on every monthly and annual paid card', () => {
  const env = {STUDIO_GALLERY_PRICING_V3_ENABLED: '1', STUDIO_GALLERY_PRICING_V2_ENABLED: '1'};
  for (const surface of surfaces) {
    for (const interval of ['month', 'year']) {
      const html = serverHtml(surface, interval, env);
      for (const [index, name] of ['Gallery', 'Core', 'Studio'].entries()) {
        const card = planCard(html, name);
        const rate = index === 0 ? '0.55' : '0.45';
        const disclosure = card.match(/<div\b[^>]*\bdata-order-fee(?:="[^"]*")?[^>]*>[\s\S]*?<\/div>/)[0];
        assert.ok(text(disclosure).includes(`${rate} per paid order · deducted from each sale`));
        assert.match(text(disclosure), /Order fees are charged in your sales currency/);
        assert.match(text(disclosure), /Stripe processing fees are additional/);
        assert.ok(card.indexOf(disclosure) < card.indexOf(`href="/sign-up?plan=${['starter', 'core', 'studio'][index]}&amp;interval=${interval}"`));
      }
      const rendered = text(html);
      assert.match(rendered, /This applies to gallery, school, sports, event, print and digital orders/);
      assert.doesNotMatch(rendered, /ordinary gallery sales have no|qualifying school production|school production fee|Unlimited|50 ?MB/i);
      if (surface === surfaces[0]) assert.match(text(planCard(html, 'Free Trial')), /\$0\.35 per paid order/);
    }
  }
});

test('all-order public schemas match card prices and order fees without old exemption claims', () => {
  for (const exportName of ['PricingJsonLd', 'SoftwareApplicationJsonLd']) {
    const surface = {path: 'components/json-ld.tsx', exportName, props: {}};
    const html = serverHtml(surface, 'month', {STUDIO_GALLERY_PRICING_V3_ENABLED: '1'});
    const schema = JSON.parse(html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1]);
    const offers = Array.isArray(schema.offers) ? schema.offers : schema.offers.offers;
    assert.deepEqual(offers.map(offer => [offer.name, offer.price]), [['Gallery', '59.00'], ['Core', '99.00'], ['Studio', '199.00']]);
    for (const [index, offer] of offers.entries()) assert.match(offer.description, new RegExp(`${index === 0 ? '0\\.55' : '0\\.45'} per paid order`));
    assert.doesNotMatch(JSON.stringify(schema), /ordinary gallery sales have no|qualifying school production|Unlimited|50 ?MB/i);
  }
});


for (const [country, currency] of [['CA','cad'],['US','usd'],['AU','aud'],['GB','gbp']]) {
  for (const interval of ['month','year']) test(`localized public ${country} ${interval} prices retain exact amounts and signup selections`, () => {
    const env = {STUDIO_GALLERY_PRICING_V3_ENABLED:'1',STUDIO_LOCAL_SUBSCRIPTIONS_ENABLED:'1'};
    const html = serverHtml(surfaces[0], interval, env, currency), rendered = text(html);
    assert.match(html, /aria-label="Subscription pricing country"/);
    assert.match(html, new RegExp(`<option value="${country}" selected=""`));
    const amounts = interval === 'year' ? [59900,106920,214920] : [5900,9900,19900];
    for (const [index,name] of ['Gallery','Core','Studio'].entries()) {
      const card = planCard(html,name);
      const formatted = new Intl.NumberFormat('en-CA',{style:'currency',currency:currency.toUpperCase(),minimumFractionDigits:interval==='year'?2:0,maximumFractionDigits:2}).format(amounts[index]/100);
      assert.ok(text(card).includes(formatted), `${name} exact ${currency} amount`);
      assert.ok(text(card).includes(`${index===0?'0.55':'0.45'} per paid order`));
      assert.ok(decode(card).includes(`/sign-up?plan=${['starter','core','studio'][index]}&interval=${interval}&country=${country}`));
    }
    assert.match(rendered,new RegExp(`Subscription prices are in ${currency.toUpperCase()}`));
    assert.match(rendered,/AI background credits are sold separately in CAD/);
    assert.doesNotMatch(rendered, /Pricing preview|not available yet/i);
  });
  test(`localized structured offers for ${country} match the shown purchasable currency`, () => {
    const html=serverHtml({path:'components/json-ld.tsx',exportName:'PricingJsonLd',props:{}},'month',{STUDIO_GALLERY_PRICING_V3_ENABLED:'1',STUDIO_LOCAL_SUBSCRIPTIONS_ENABLED:'1'},currency);
    const schema=JSON.parse(html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1]);
    assert.equal(schema.offers.priceCurrency,currency.toUpperCase());
    assert.deepEqual(schema.offers.offers.map(o=>[o.price,o.priceCurrency]),[['59.00',currency.toUpperCase()],['99.00',currency.toUpperCase()],['199.00',currency.toUpperCase()]]);
  });
}
test('localized selector stays absent with the release disabled',()=>{const html=serverHtml(surfaces[0],'month',{STUDIO_GALLERY_PRICING_V3_ENABLED:'1'});assert.doesNotMatch(html,/Subscription pricing country/);assert.match(text(html),/Subscriptions in CAD/);});

test('localized free-trial signup keeps the selected pricing country in all four markets', () => {
  const env = {STUDIO_GALLERY_PRICING_V3_ENABLED: '1', STUDIO_LOCAL_SUBSCRIPTIONS_ENABLED: 'true'};
  for (const [currency, country] of [['usd', 'US'], ['cad', 'CA'], ['aud', 'AU'], ['gbp', 'GB']]) {
    const html = serverHtml(surfaces[0], 'month', env, currency);
    const trial = planCard(html, 'Free Trial');
    assert.ok(trial.includes(`href="/sign-up?country=${country}"`));
  }
});

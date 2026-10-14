import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { verifyGalleryPricingRelease, galleryReleaseEntries } from '../scripts/verify-gallery-pricing-release.mjs';

const env = { STUDIO_GALLERY_PRICING_V2_ENABLED: '1', STRIPE_SECRET_KEY: 'sk_live_InterceptedFixtureOnly',
  STUDIO_GALLERY_PRICING_EXPECTED_ACCOUNT_ID: 'acct_PlatformFixture', STRIPE_BILLING_CURRENCY: 'cad' };
const entries = galleryReleaseEntries();
const objectId = (prefix, lookup) => `${prefix}_${lookup.replaceAll('-', '_')}`;
function priceFor(entry, product = objectId('prod', entry.lookupKey)) {
  return { object: 'price', id: objectId('price', entry.lookupKey), active: true, livemode: true,
    lookup_key: entry.lookupKey, unit_amount: entry.unitAmount, currency: 'cad', type: 'recurring',
    billing_scheme: 'per_unit', recurring: { interval: entry.interval, interval_count: 1, usage_type: 'licensed', meter: null },
    product, metadata: {} };
}
function productFor(entry) {
  return { object: 'product', id: objectId('prod', entry.lookupKey), active: true, livemode: true,
    name: entry.name, description: entry.description, metadata: { lookup_key: entry.lookupKey } };
}
function fixture({ existing = [], accountId = env.STUDIO_GALLERY_PRICING_EXPECTED_ACCOUNT_ID,
  failFinalList = false, providerFailure = false, productPatch = {}, releaseEnv = env, checkoutLineAmount = null } = {}) {
  const selectedProfile = releaseEnv.STUDIO_GALLERY_PRICING_V3_ENABLED === '1' ? 'gallery_v3' : 'gallery_v2';
  const entries = galleryReleaseEntries(selectedProfile);
  const prices = new Map(existing.map(row => [row.lookup_key, structuredClone(row)]));
  const products = new Map([...galleryReleaseEntries('gallery_v2'), ...galleryReleaseEntries('gallery_v3')]
    .map(entry => [objectId('prod', entry.lookupKey), { ...productFor(entry), ...productPatch }]));
  const checkouts = new Map();
  const calls = [], reports = [], idempotency = new Map();
  let listCount = 0;
  const fetcher = async (target, options) => {
    const url = new URL(target);
    assert.equal(url.origin, 'https://api.stripe.com', 'all provider requests are intercepted');
    assert.equal(options.headers.Authorization, `Bearer ${releaseEnv.STRIPE_SECRET_KEY}`);
    assert.equal(options.headers['Stripe-Account'], undefined, 'catalog belongs to the platform');
    const body = new URLSearchParams(options.body);
    const call = { path: url.pathname.slice('/v1/'.length), method: options.method, body,
      key: options.headers['Idempotency-Key'], query: url.searchParams };
    calls.push(call);
    if (providerFailure) return { ok: false, status: 500, json: () => assert.fail('Provider failure details must not be read') };
    let response;
    if (call.method === 'GET' && call.path === 'account') {
      response = { object: 'account', id: accountId, charges_enabled: true, payouts_enabled: true,
        details_submitted: true, requirements: { currently_due: [], past_due: [], disabled_reason: null } };
    } else if (call.method === 'GET' && call.path === 'prices') {
      assert.deepEqual(call.query.getAll('lookup_keys[]'), entries.map(entry => entry.lookupKey));
      response = { object: 'list', has_more: false, data: failFinalList && ++listCount > 1 ? []
        : [...prices.values()].filter(price => call.query.getAll('lookup_keys[]').includes(price.lookup_key)) };
    } else if (call.method === 'GET' && call.path.startsWith('products/')) {
      response = products.get(call.path.slice('products/'.length));
    } else if (call.method === 'POST' && call.path === 'products') {
      const entry = entries.find(entry => entry.lookupKey === body.get('metadata[lookup_key]'));
      assert.ok(entry, 'only versioned Gallery products can be created');
      assert.deepEqual([...body], [['name', entry.name], ['description', entry.description], ['metadata[lookup_key]', entry.lookupKey]]);
      assert.equal(call.key, `studio-os-product-${entry.lookupKey}`);
      response = idempotency.get(call.key) ?? productFor(entry);
      products.set(response.id, response); idempotency.set(call.key, response);
    } else if (call.method === 'POST' && call.path === 'prices') {
      const entry = entries.find(entry => entry.lookupKey === body.get('lookup_key'));
      assert.ok(entry, 'legacy lookup keys cannot be transferred');
      assert.deepEqual([...body], [['currency', 'cad'], ['unit_amount', String(entry.unitAmount)],
        ['product', objectId('prod', entry.lookupKey)], ['lookup_key', entry.lookupKey], ['transfer_lookup_key', 'true'],
        ['recurring[interval]', entry.interval]]);
      assert.equal(call.key, `studio-os-price-${entry.lookupKey}-${entry.unitAmount}`);
      response = idempotency.get(call.key) ?? priceFor(entry);
      prices.set(entry.lookupKey, response); idempotency.set(call.key, response);
    } else if (call.method === 'POST' && call.path === 'checkout/sessions') {
      assert.equal(body.get('mode'), 'subscription');
      assert.equal(body.get('line_items[0][quantity]'), '1');
      assert.ok([...body.keys()].every(key => !key.startsWith('customer')), 'no customer/email fields transmitted');
      const price = [...prices.values()].find(row => row.id === body.get('line_items[0][price]'));
      assert.ok(price, 'only a verified catalog price can enter Checkout');
      response = { object: 'checkout.session', id: `cs_live_Verification${checkouts.size + 1}`,
        livemode: true, mode: 'subscription', status: 'open', payment_status: 'unpaid',
        currency: 'cad', amount_total: price.unit_amount, customer: null, subscription: null, payment_intent: null,
        priceId: price.id };
      checkouts.set(response.id, response);
    } else if (call.path.startsWith('checkout/sessions/')) {
      const [id, action] = call.path.slice('checkout/sessions/'.length).split('/');
      const session = checkouts.get(id);
      assert.ok(session, 'known verification session required');
      if (call.method === 'GET' && action === 'line_items') response = { object: 'list', has_more: false,
        data: [{price: {id: session.priceId}, quantity: 1, currency: 'cad', amount_total: checkoutLineAmount ?? session.amount_total}] };
      else if (call.method === 'GET' && !action) response = session;
      else if (call.method === 'POST' && action === 'expire') {
        session.status = 'expired'; response = session;
      } else assert.fail(`Unexpected checkout operation: ${call.method} ${call.path}`);
    } else assert.fail(`Unexpected provider request: ${call.method} ${call.path}`);
    return { ok: true, json: async () => structuredClone(response) };
  };
  return { fetcher, calls, reports, report: value => reports.push(value), prices, checkouts };
}

test('the disabled release has no provider requests or catalog writes', async () => {
  for (const flag of [undefined, '0', 'true']) {
    const result = await verifyGalleryPricingRelease({ STUDIO_GALLERY_PRICING_V2_ENABLED: flag }, () => assert.fail('No network'));
    assert.deepEqual(result, { skipped: true });
  }
});

test('missing, placeholder or test keys and missing expected account stop before network', async () => {
  for (const patch of [{ STRIPE_SECRET_KEY: '[SENSITIVE]' }, { STRIPE_SECRET_KEY: 'sk_test_Fixture' },
    { STRIPE_SECRET_KEY: 'rk_live_Fixture' }, { STUDIO_GALLERY_PRICING_EXPECTED_ACCOUNT_ID: '' }, { STRIPE_BILLING_CURRENCY: 'usd' }]) {
    await assert.rejects(verifyGalleryPricingRelease({ ...env, ...patch }, () => assert.fail('No network')));
  }
});

test('a different platform stops before any catalog read or write', async () => {
  const f = fixture({ accountId: 'acct_DifferentPlatform' });
  await assert.rejects(verifyGalleryPricingRelease(env, f.fetcher, f.report), /platform account does not match/);
  assert.deepEqual(f.calls.map(call => [call.method, call.path]), [['GET', 'account']]);
});

test('an incompatible existing sixth price stops every creation and never transfers its key', async () => {
  for (const patch of [{ unit_amount: 1 }, { currency: 'usd' }, { active: false }, { livemode: false },
    { type: 'one_time' }, { metadata: { pricing_profile: 'legacy' } },
    { recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } },
    { recurring: { interval: 'year', interval_count: 1, usage_type: 'metered' } }]) {
    const f = fixture({ existing: [{ ...priceFor(entries[5]), ...patch }] });
    await assert.rejects(verifyGalleryPricingRelease(env, f.fetcher, f.report), /incompatible/);
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
  }
});

test('an existing product bound to another profile stops before any creation', async () => {
  const f = fixture({ existing: [priceFor(entries[5])], productPatch: { metadata: { lookup_key: entries[5].lookupKey, pricing_profile: 'legacy' } } });
  await assert.rejects(verifyGalleryPricingRelease(env, f.fetcher, f.report), /product is incompatible/);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
});

test('creates and verifies all six exact prices; retry reuses the same IDs and never touches legacy billing', async () => {
  const f = fixture();
  const result = await verifyGalleryPricingRelease(env, f.fetcher, f.report);
  assert.deepEqual([...f.prices.values()].map(price => [price.unit_amount, price.recurring.interval]),
    [[5900, 'month'], [59900, 'year'], [9900, 'month'], [106920, 'year'], [19900, 'month'], [214920, 'year']]);
  assert.equal(result.catalogMutations, 12);
  assert.equal(f.reports.map(row => JSON.parse(row)).filter(row => row.check === 'gallery-subscription-price').length, 6);
  assert.ok(f.reports.every(row => !row.includes(env.STRIPE_SECRET_KEY)));
  const originalMutations = f.calls.filter(call => call.method === 'POST').length;
  const second = await verifyGalleryPricingRelease(env, f.fetcher, f.report);
  assert.deepEqual(second.prices, result.prices);
  assert.equal(second.catalogMutations, 0);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, originalMutations);
  assert.ok(f.calls.filter(call => call.method === 'POST').every(call => ['products', 'prices'].includes(call.path)));
});

test('a price missing from authoritative final GET blocks the build after partial catalog preparation', async () => {
  const f = fixture({ failFinalList: true });
  await assert.rejects(verifyGalleryPricingRelease(env, f.fetcher, f.report), /still missing.*Release stopped/);
  assert.equal(f.reports.length, 0, 'no successful price proof is emitted');
});

test('provider failures never expose response bodies or request error details', async () => {
  const f = fixture({ providerFailure: true });
  await assert.rejects(verifyGalleryPricingRelease(env, f.fetcher, f.report), /HTTP 500.*details withheld/);
  await assert.rejects(verifyGalleryPricingRelease(env, async () => { throw Error(`secret ${env.STRIPE_SECRET_KEY}`); }),
    error => !error.message.includes(env.STRIPE_SECRET_KEY) && /details withheld/.test(error.message));
});

test('production build verifies payment prerequisites before catalog preparation', () => {
  const prebuild = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts.prebuild;
  assert.ok(prebuild.indexOf('verify-payment-release.mjs') < prebuild.indexOf('verify-gallery-pricing-release.mjs'));
  assert.ok(prebuild.includes('verify-gallery-pricing-release.mjs'));
});

test('V3 prepares separate exact prices and preserves every previous V2 catalog entry', async () => {
  const releaseEnv = {...env, STUDIO_GALLERY_PRICING_V3_ENABLED: '1'};
  const previous = entries.map(entry => priceFor(entry));
  const f = fixture({releaseEnv, existing: previous});
  const result = await verifyGalleryPricingRelease(releaseEnv, f.fetcher, f.report);
  assert.equal(result.prices.length, 6);
  for (const price of previous) assert.deepEqual(f.prices.get(price.lookup_key), price);
  const proof = f.reports.map(JSON.parse).filter(row => row.check === 'gallery-subscription-price');
  assert.deepEqual(proof.map(row => [row.unitAmount, row.orderFeeRateCents, row.orderFeeScope]),
    [[5900,55,'all_paid_orders'],[59900,55,'all_paid_orders'],[9900,45,'all_paid_orders'],
      [106920,45,'all_paid_orders'],[19900,45,'all_paid_orders'],[214920,45,'all_paid_orders']]);
  assert.ok(proof.every(row => row.pricingProfile === 'gallery_v3' && row.lookupKey.endsWith('-gallery-v3')));
});

const checkoutEnv = {...env, STUDIO_GALLERY_PRICING_V3_ENABLED: '1', STUDIO_GALLERY_PRICING_CHECKOUT_VERIFY: '1',
  VERCEL_URL: 'studio-os-cloud-site-verification-whitephotostudio-7289s-projects.vercel.app'};

test('provider Checkout verification tests all six amounts then expires every session without any customer or payment', async () => {
  const f = fixture({releaseEnv: checkoutEnv});
  const result = await verifyGalleryPricingRelease(checkoutEnv, f.fetcher, f.report);
  assert.equal(result.verifiedCheckouts, 6);
  assert.equal(result.checkoutSessionMutations, 12);
  assert.equal(f.checkouts.size, 6);
  assert.ok([...f.checkouts.values()].every(session => session.status === 'expired'
    && session.customer === null && session.subscription === null && session.payment_intent === null));
  assert.ok(f.calls.filter(call => call.method === 'POST').every(call => ['products','prices','checkout/sessions'].includes(call.path)
    || /^checkout\/sessions\/cs_live_Verification\d+\/expire$/.test(call.path)));
});

test('a Checkout amount mismatch expires the probe and fails release before successful proof', async () => {
  const f = fixture({releaseEnv: checkoutEnv, checkoutLineAmount: 1});
  await assert.rejects(verifyGalleryPricingRelease(checkoutEnv, f.fetcher, f.report), /exact advertised price/);
  assert.equal(f.checkouts.size, 1);
  assert.equal([...f.checkouts.values()][0].status, 'expired');
  assert.ok(f.reports.map(JSON.parse).every(row => row.check !== 'gallery-subscription-checkout'));
});

test('Checkout verification rejects an unrelated deployment before any provider operation', async () => {
  await assert.rejects(verifyGalleryPricingRelease({...checkoutEnv, VERCEL_URL:'other-app.vercel.app'},
    () => assert.fail('No network')), /project deployment identity/);
});

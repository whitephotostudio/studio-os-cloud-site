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
    lookup_key: entry.lookupKey, unit_amount: entry.unitAmount, currency: entry.currency, type: 'recurring',
    billing_scheme: 'per_unit', recurring: { interval: entry.interval, interval_count: 1, usage_type: 'licensed', meter: null },
    product, metadata: {} };
}
function productFor(entry) {
  return { object: 'product', id: objectId('prod', entry.lookupKey), active: true, livemode: true,
    name: entry.name, description: entry.description, metadata: { lookup_key: entry.lookupKey } };
}
function fixture({ existing = [], accountId = env.STUDIO_GALLERY_PRICING_EXPECTED_ACCOUNT_ID,
  failFinalList = false, providerFailure = false, productPatch = {}, releaseEnv = env, checkoutLineAmount = null,
  balanceLivemode = true, checkoutLinePatch = {}, checkoutPatch = {} } = {}) {
  const selectedProfile = releaseEnv.STUDIO_GALLERY_PRICING_V3_ENABLED === '1' ? 'gallery_v3' : 'gallery_v2';
  const localized = ['1', 'true'].includes(releaseEnv.STUDIO_LOCAL_SUBSCRIPTIONS_ENABLED);
  const entries = galleryReleaseEntries(selectedProfile, localized);
  const prices = new Map(existing.map(row => [row.lookup_key, structuredClone(row)]));
  const products = new Map([...galleryReleaseEntries('gallery_v2'), ...galleryReleaseEntries('gallery_v3', true)]
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
    } else if (call.method === 'GET' && call.path === 'balance') {
      response = { object: 'balance', livemode: balanceLivemode };
    } else if (call.method === 'GET' && call.path === 'prices') {
      const requested = call.query.getAll('lookup_keys[]');
      assert.ok(requested.length > 0 && requested.length <= 10, 'Stripe supports at most ten lookup keys');
      const batchStart = entries.findIndex(entry => entry.lookupKey === requested[0]);
      assert.deepEqual(requested, entries.slice(batchStart, batchStart + 10).map(entry => entry.lookupKey));
      response = { object: 'list', has_more: false, data: failFinalList && ++listCount > 1 ? []
        : [...prices.values()].filter(price => call.query.getAll('lookup_keys[]').includes(price.lookup_key)
          && (!call.query.has('active') || String(price.active) === call.query.get('active'))) };
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
      assert.deepEqual([...body], [['currency', entry.currency], ['unit_amount', String(entry.unitAmount)],
        ['product', objectId('prod', entry.lookupKey)], ['lookup_key', entry.lookupKey],
        ...(!localized || entry.currency === 'cad' ? [['transfer_lookup_key', 'true']] : []),
        ['recurring[interval]', entry.interval]]);
      assert.equal(call.key, `studio-os-price-${entry.lookupKey}-${entry.unitAmount}`);
      response = idempotency.get(call.key) ?? priceFor(entry);
      prices.set(entry.lookupKey, response); idempotency.set(call.key, response);
    } else if (call.method === 'POST' && call.path === 'checkout/sessions') {
      assert.equal(body.get('mode'), 'subscription');
      assert.equal(body.get('line_items[0][quantity]'), '1');
      assert.ok([...body.keys()].every(key => !key.startsWith('customer')), 'no customer/email fields transmitted');
      const linePrices = [];
      for (let index = 0; body.has(`line_items[${index}][price]`); index++) {
        assert.equal(body.get(`line_items[${index}][quantity]`), '1');
        const price = [...prices.values()].find(row => row.id === body.get(`line_items[${index}][price]`));
        assert.ok(price, 'only a verified catalog price can enter Checkout'); linePrices.push(price);
      }
      assert.ok(linePrices.length >= 1 && linePrices.length <= 2);
      assert.ok(linePrices.every(price => price.currency === linePrices[0].currency
        && price.recurring.interval === linePrices[0].recurring.interval));
      response = { object: 'checkout.session', id: `cs_live_Verification${checkouts.size + 1}`,
        livemode: true, mode: 'subscription', status: 'open', payment_status: 'unpaid',
        currency: linePrices[0].currency, amount_total: linePrices.reduce((sum, price) => sum + price.unit_amount, 0),
        customer: null, subscription: null, payment_intent: null, linePrices, ...checkoutPatch };
      checkouts.set(response.id, response);
    } else if (call.path.startsWith('checkout/sessions/')) {
      const [id, action] = call.path.slice('checkout/sessions/'.length).split('/');
      const session = checkouts.get(id);
      assert.ok(session, 'known verification session required');
      if (call.method === 'GET' && action === 'line_items') response = { object: 'list', has_more: false,
        data: session.linePrices.map(price => ({price: {id: price.id}, quantity: 1, currency: price.currency,
          amount_total: checkoutLineAmount ?? price.unit_amount, ...checkoutLinePatch })) };
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

const localizedEnv = { ...env, STUDIO_GALLERY_PRICING_V3_ENABLED: '1', STUDIO_LOCAL_SUBSCRIPTIONS_ENABLED: '1' };
const localizedEntries = galleryReleaseEntries('gallery_v3', true);

test('localized catalog shares exact backend keys, amounts and fee policy across four currencies', () => {
  assert.equal(localizedEntries.length, 32);
  assert.equal(new Set(localizedEntries.map(entry => entry.lookupKey)).size, 32);
  for (const currency of ['cad', 'usd', 'aud', 'gbp']) {
    const rows = localizedEntries.filter(entry => entry.currency === currency);
    assert.deepEqual(rows.filter(entry => entry.kind === 'base').map(entry =>
      [entry.unitAmount, entry.interval, entry.orderFeeRateCents, entry.orderFeeScope]), [
      [5900, 'month', 55, 'all_paid_orders'], [59900, 'year', 55, 'all_paid_orders'],
      [9900, 'month', 45, 'all_paid_orders'], [106920, 'year', 45, 'all_paid_orders'],
      [19900, 'month', 45, 'all_paid_orders'], [214920, 'year', 45, 'all_paid_orders'],
    ]);
    assert.deepEqual(rows.filter(entry => entry.kind === 'extra_key').map(entry => [entry.unitAmount, entry.interval]),
      [[5500, 'month'], [59400, 'year']]);
    assert.ok(rows.every(entry => currency === 'cad' ? !entry.lookupKey.endsWith('-cad') : entry.lookupKey.endsWith(`-${currency}`)));
  }
  assert.deepEqual(localizedEntries.filter(entry => entry.currency === 'cad' && entry.kind === 'base').map(entry => entry.lookupKey),
    galleryReleaseEntries('gallery_v3').map(entry => entry.lookupKey));
  assert.deepEqual(localizedEntries.filter(entry => entry.currency === 'cad' && entry.kind === 'extra_key').map(entry => entry.lookupKey),
    ['studio-os-extra-desktop-key-monthly-v2', 'studio-os-extra-desktop-key-annual-v2']);
});

test('localized flag accepts only explicit approved values and requires V3 before network', async () => {
  for (const value of ['1', 'true']) {
    await assert.rejects(verifyGalleryPricingRelease({ ...env, STUDIO_LOCAL_SUBSCRIPTIONS_ENABLED: value },
      () => assert.fail('No network')), /require.*V3/);
    const releaseEnv = { ...localizedEnv, STUDIO_LOCAL_SUBSCRIPTIONS_ENABLED: value };
    const f = fixture({ releaseEnv, existing: localizedEntries.map(entry => priceFor(entry)) });
    const result = await verifyGalleryPricingRelease(releaseEnv, f.fetcher, f.report);
    assert.equal(result.prices.length, 32);
  }
  for (const value of [undefined, '0', 'TRUE', 'yes']) {
    const releaseEnv = { ...localizedEnv, STUDIO_LOCAL_SUBSCRIPTIONS_ENABLED: value };
    const f = fixture({ releaseEnv, existing: galleryReleaseEntries('gallery_v3').map(entry => priceFor(entry)) });
    assert.equal((await verifyGalleryPricingRelease(releaseEnv, f.fetcher, f.report)).prices.length, 6);
  }
  await assert.rejects(verifyGalleryPricingRelease({ ...env, STUDIO_LOCAL_SUBSCRIPTIONS_CATALOG_PREPARE: '1' },
    () => assert.fail('No network')), /requires localized subscriptions/);
});

test('normal localized release reads all 32 existing entries with zero provider mutations', async () => {
  const existing = localizedEntries.map(entry => priceFor(entry));
  const f = fixture({ releaseEnv: localizedEnv, existing });
  const result = await verifyGalleryPricingRelease(localizedEnv, f.fetcher, f.report);
  assert.equal(result.prices.length, 32); assert.equal(result.catalogMutations, 0);
  assert.ok(f.calls.every(call => call.method === 'GET'));
  assert.deepEqual(f.calls.filter(call => call.path === 'prices').map(call => call.query.getAll('lookup_keys[]').length),
    [10,10,10,10,10,10,2,2,10,10,10,10,10,10,2,2], 'active and inactive complete reads respect the actual Stripe list limit');
  assert.deepEqual([...f.prices.values()], existing);
  const summary = f.reports.map(JSON.parse).find(row => row.check === 'gallery-pricing-release');
  assert.equal(summary.verifiedBasePrices, 24); assert.equal(summary.verifiedExtraKeyPrices, 8);
  assert.equal(summary.localizedCatalogPreparation, false);
});

test('missing localized prices fail before any POST unless one-shot preparation is explicitly enabled', async () => {
  for (const flag of [undefined, '0', 'true']) {
    const releaseEnv = { ...localizedEnv, STUDIO_LOCAL_SUBSCRIPTIONS_CATALOG_PREPARE: flag };
    const f = fixture({ releaseEnv, existing: localizedEntries.slice(0, 8).map(entry => priceFor(entry)) });
    await assert.rejects(verifyGalleryPricingRelease(releaseEnv, f.fetcher, f.report), /incomplete.*no catalog writes/);
    assert.ok(f.calls.every(call => call.method === 'GET'));
  }
  const releaseEnv = { ...localizedEnv, STUDIO_LOCAL_SUBSCRIPTIONS_CATALOG_PREPARE: '1' };
  const originalCad = localizedEntries.slice(0, 8).map(entry => priceFor(entry));
  const f = fixture({ releaseEnv, existing: originalCad });
  const prepared = await verifyGalleryPricingRelease(releaseEnv, f.fetcher, f.report);
  assert.equal(prepared.catalogMutations, 48, 'only 24 missing foreign products and prices are created');
  const posts = f.calls.filter(call => call.method === 'POST');
  assert.ok(posts.filter(call => call.path === 'prices').every(call => !call.body.has('transfer_lookup_key')));
  for (const price of originalCad) assert.deepEqual(f.prices.get(price.lookup_key), price);
  const retry = await verifyGalleryPricingRelease(releaseEnv, f.fetcher, f.report);
  assert.equal(retry.catalogMutations, 0); assert.deepEqual(retry.prices, prepared.prices);
});

test('any foreign mismatch blocks all preparation, including a late extra-key mismatch with earlier prices missing', async () => {
  const releaseEnv = { ...localizedEnv, STUDIO_LOCAL_SUBSCRIPTIONS_CATALOG_PREPARE: '1' };
  for (const patch of [{unit_amount: 1}, {currency: 'cad'}, {active: false}, {livemode: false},
    {metadata: {pricing_profile: 'legacy'}}, {recurring: {interval: 'month', interval_count: 1, usage_type: 'licensed'}},
    {recurring: {interval: 'year', interval_count: 1, usage_type: 'metered'}}]) {
    const f = fixture({ releaseEnv, existing: [{ ...priceFor(localizedEntries.at(-1)), ...patch }] });
    await assert.rejects(verifyGalleryPricingRelease(releaseEnv, f.fetcher, f.report), /incompatible/);
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
  }
  const last = localizedEntries.at(-1);
  const f = fixture({ releaseEnv, existing: [priceFor(last)], productPatch: {
    metadata: { lookup_key: last.lookupKey, pricing_profile: 'legacy' } } });
  await assert.rejects(verifyGalleryPricingRelease(releaseEnv, f.fetcher, f.report), /product is incompatible/);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
});

test('an inactive foreign lookup hidden from active results blocks every catalog creation', async () => {
  const releaseEnv = { ...localizedEnv, STUDIO_LOCAL_SUBSCRIPTIONS_CATALOG_PREPARE: '1' };
  const inactive = { ...priceFor(localizedEntries.at(-1)), active: false };
  const f = fixture({ releaseEnv, existing: [inactive] });
  await assert.rejects(verifyGalleryPricingRelease(releaseEnv, f.fetcher, f.report), /incompatible/);
  const reads = f.calls.filter(call => call.path === 'prices');
  assert.deepEqual(reads.map(call => call.query.get('active')), ['true','false','true','false','true','false','true','false']);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
});

test('localized release verifies exact live platform and balance mode before catalog operations', async () => {
  for (const options of [{ accountId: 'acct_AnotherPlatform' }, { balanceLivemode: false }, { balanceLivemode: null }]) {
    const f = fixture({ releaseEnv: localizedEnv, ...options });
    await assert.rejects(verifyGalleryPricingRelease(localizedEnv, f.fetcher, f.report), /platform account|live platform balance/);
    assert.ok(f.calls.every(call => call.method === 'GET' && ['account','balance'].includes(call.path)));
  }
});

test('localized unpaid probes verify all 24 bases and eight matching-currency/cadence extra-key combinations', async () => {
  const releaseEnv = { ...checkoutEnv, STUDIO_LOCAL_SUBSCRIPTIONS_ENABLED: '1' };
  const f = fixture({ releaseEnv, existing: localizedEntries.map(entry => priceFor(entry)) });
  const result = await verifyGalleryPricingRelease(releaseEnv, f.fetcher, f.report);
  assert.equal(result.catalogMutations, 0); assert.equal(result.verifiedCheckouts, 32);
  assert.equal(result.checkoutSessionMutations, 64);
  assert.equal([...f.checkouts.values()].filter(session => session.linePrices.length === 1).length, 24);
  assert.equal([...f.checkouts.values()].filter(session => session.linePrices.length === 2).length, 8);
  assert.ok([...f.checkouts.values()].every(session => session.status === 'expired' && session.customer === null
    && session.subscription === null && session.payment_intent === null));
  const extraProof = f.reports.map(JSON.parse).filter(row => row.check === 'gallery-extra-key-checkout');
  assert.deepEqual(extraProof.map(row => row.checkoutAmount), [25400,274320,25400,274320,25400,274320,25400,274320]);
  assert.ok(f.reports.every(row => !row.includes(releaseEnv.STRIPE_SECRET_KEY)));
});

test('localized invalid line currency, amount or identity always expires the unpaid probe and stops', async () => {
  const releaseEnv = { ...checkoutEnv, STUDIO_LOCAL_SUBSCRIPTIONS_ENABLED: '1' };
  for (const patch of [{currency: 'invalid'}, {amount_total: 1}, {price: {id: 'price_Foreign'}}]) {
    const f = fixture({ releaseEnv, existing: localizedEntries.map(entry => priceFor(entry)), checkoutLinePatch: patch });
    await assert.rejects(verifyGalleryPricingRelease(releaseEnv, f.fetcher, f.report), /exact advertised price/);
    assert.equal(f.checkouts.size, 1); assert.equal([...f.checkouts.values()][0].status, 'expired');
  }
});

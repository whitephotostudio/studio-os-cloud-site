import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);


const compiled = ts.transpileModule(
  readFileSync(new URL('../lib/studio-pricing.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function pricing(env = {}) {
  const exports = {};
  new Function('exports', 'process', compiled)(exports, { env });
  return exports;
}

test('the new offer is disabled by default and public or truthy flags cannot enable it', () => {
  for (const env of [{}, { NEXT_PUBLIC_STUDIO_GALLERY_PRICING_V2_ENABLED: '1' },
    { STUDIO_GALLERY_PRICING_V2_ENABLED: 'true' }, { STUDIO_GALLERY_PRICING_V2_ENABLED: '0' }]) {
    const api = pricing(env);
    assert.equal(api.isGalleryPricingV2Enabled(), false);
    const snapshot = api.getPricingCatalogSnapshot();
    assert.equal(snapshot.pricingProfile, 'legacy');
    assert.equal(snapshot.galleryStoragePolicy, 'existing');
    assert.equal(snapshot.annualDiscountPercent, 10);
    assert.deepEqual(Object.values(snapshot.plans).map(plan => [plan.priceCents, plan.annualPriceCents, plan.usageRateCents]),
      [[4900, 52920, 55], [9900, 106920, 40], [19900, 214920, 35]]);
    assert.ok(Object.values(snapshot.plans).every(plan => plan.orderFeeScope === 'all_paid_orders'));
  }
});

test('legacy deployment overrides remain effective until the private release switch is enabled', () => {
  const api = pricing({ STRIPE_ANNUAL_DISCOUNT_PERCENT: '20', STRIPE_STARTER_MONTHLY_CENTS: '5700',
    STRIPE_CORE_ANNUAL_CENTS: '95000', STRIPE_STUDIO_MONTHLY_CENTS: '22000',
    STRIPE_STARTER_ORDER_USAGE_RATE_CENTS: '62', STRIPE_CORE_ORDER_USAGE_RATE_CENTS: '47',
    STRIPE_STUDIO_ORDER_USAGE_RATE_CENTS: '39' });
  assert.equal(api.getPlanPriceCents('starter', 'month'), 5700);
  assert.equal(api.getPlanPriceCents('starter', 'year'), 54720);
  assert.equal(api.getPlanPriceCents('core', 'year'), 95000);
  assert.equal(api.getPlanPriceCents('studio', 'year'), 211200);
  assert.deepEqual(Object.values(api.PLAN_DEFS).map(plan => plan.usageRateCents), [62, 47, 39]);
  assert.equal(api.getPricingCatalogSnapshot().annualDiscountPercent, 20);
});

test('the enabled catalog offers the exact approved prices and distinguishes gallery sales from production orders', () => {
  const api = pricing({ STUDIO_GALLERY_PRICING_V2_ENABLED: '1' });
  assert.equal(api.isGalleryPricingV2Enabled(), true);
  const snapshot = api.getPricingCatalogSnapshot();
  assert.equal(snapshot.pricingProfile, 'gallery_v2');
  assert.equal(snapshot.currency, 'cad');
  assert.equal(snapshot.galleryStoragePolicy, 'existing', 'prices can launch without unlimited storage');
  assert.equal(snapshot.annualDiscountPercent, null, 'no misleading universal discount for plans with different savings');
  assert.deepEqual(Object.values(snapshot.plans).map(plan => [plan.publicName, plan.priceCents,
    plan.annualPriceCents, plan.usageFeeApplies, plan.usageRateCents, plan.orderFeeScope]), [
    ['Gallery', 5900, 59900, false, 0, 'none'],
    ['Core', 9900, 106920, true, 45, 'production_orders'],
    ['Studio', 19900, 214920, true, 45, 'production_orders'],
  ]);
  for (const code of ['starter', 'core', 'studio']) {
    assert.equal(api.getPlanPriceCents(code, 'month'), snapshot.plans[code].priceCents);
    assert.equal(api.getPlanPriceCents(code, 'year'), snapshot.plans[code].annualPriceCents);
    assert.equal(snapshot.plans[code].galleryStoragePolicy, 'existing');
  }
  assert.deepEqual(Object.values(snapshot.plans).map(plan => plan.includedDesktopKeys), [0, 1, 2]);
  assert.deepEqual(Object.values(snapshot.plans).map(plan => plan.includedCredits), [0, 0, 0]);
});

test('enabled base prices cannot be changed by stale legacy pricing and rate environment overrides', () => {
  const api = pricing({ STUDIO_GALLERY_PRICING_V2_ENABLED: '1', STRIPE_ANNUAL_DISCOUNT_PERCENT: '25',
    STRIPE_STARTER_MONTHLY_CENTS: '4900', STRIPE_STARTER_ANNUAL_CENTS: '52920',
    STRIPE_CORE_MONTHLY_CENTS: '8800', STRIPE_CORE_ANNUAL_CENTS: '75000',
    STRIPE_STUDIO_MONTHLY_CENTS: '14900', STRIPE_STUDIO_ANNUAL_CENTS: '99900',
    STRIPE_STARTER_ORDER_USAGE_RATE_CENTS: '55', STRIPE_CORE_ORDER_USAGE_RATE_CENTS: '40',
    STRIPE_STUDIO_ORDER_USAGE_RATE_CENTS: '35' });
  assert.deepEqual(Object.values(api.PLAN_DEFS).map(plan => [plan.priceCents, plan.annualPriceCents, plan.usageRateCents]),
    [[5900, 59900, 0], [9900, 106920, 45], [19900, 214920, 45]]);
});

test('annual savings come from the actual billed amounts, and order fees receive no annual discount', () => {
  const snapshot = pricing({ STUDIO_GALLERY_PRICING_V2_ENABLED: '1' }).getPricingCatalogSnapshot();
  assert.deepEqual(Object.values(snapshot.plans).map(plan => [plan.annualSavingsCents, plan.annualSavingsPercent]),
    [[10900, 15.4], [11880, 10], [23880, 10]]);
  assert.equal(snapshot.plans.core.usageRateCents, 45);
  assert.equal(snapshot.plans.studio.usageRateCents, 45);
});

test('server catalog snapshots survive serialization and consumer edits cannot mutate the billing catalog', () => {
  const api = pricing({ STUDIO_GALLERY_PRICING_V2_ENABLED: '1' });
  const snapshot = api.getPricingCatalogSnapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
  snapshot.plans.starter.priceCents = 1;
  snapshot.plans.core.usageRateCents = 99;
  assert.equal(api.getPlanPriceCents('starter', 'month'), 5900);
  assert.equal(api.getPricingCatalogSnapshot().plans.core.usageRateCents, 45);
  assert.equal(api.PLAN_DEFS.core.usageRateCents, 45);
});

test('unlimited storage is separately disabled until both private switches are explicitly enabled', () => {
  for (const env of [{STUDIO_GALLERY_UNLIMITED_STORAGE_ENABLED: '1'},
    {STUDIO_GALLERY_PRICING_V2_ENABLED: '1'},
    {STUDIO_GALLERY_PRICING_V2_ENABLED: '1', NEXT_PUBLIC_STUDIO_GALLERY_UNLIMITED_STORAGE_ENABLED: '1'},
    {STUDIO_GALLERY_PRICING_V2_ENABLED: '1', STUDIO_GALLERY_UNLIMITED_STORAGE_ENABLED: 'true'}]) {
    const api = pricing(env);
    assert.equal(api.isUnlimitedGalleryStorageEnabled(), false);
    const snapshot = api.getPricingCatalogSnapshot();
    assert.equal(snapshot.galleryStoragePolicy, 'existing');
    assert.ok(Object.values(snapshot.plans).every(plan => plan.galleryStoragePolicy === 'existing'));
    assert.ok(Object.values(snapshot.plans).every(plan => !/unlimited|50 ?MB/i.test(plan.description)));
  }
  const api = pricing({STUDIO_GALLERY_PRICING_V2_ENABLED: '1', STUDIO_GALLERY_UNLIMITED_STORAGE_ENABLED: '1'});
  assert.equal(api.isUnlimitedGalleryStorageEnabled(), true);
  assert.equal(api.getPricingCatalogSnapshot().galleryStoragePolicy, 'unlimited_jpeg');
  assert.ok(Object.values(api.getPricingCatalogSnapshot().plans).every(plan => plan.galleryStoragePolicy === 'unlimited_jpeg'));
});

test('free trials retain the legacy Studio fee and storage policy independently of paid catalog', () => {
  for (const env of [{}, {STUDIO_GALLERY_PRICING_V2_ENABLED: '1'},
    {STUDIO_GALLERY_PRICING_V2_ENABLED: '1', STUDIO_GALLERY_UNLIMITED_STORAGE_ENABLED: '1'}]) {
    const trial = pricing(env).getPricingCatalogSnapshot().trialPlan;
    assert.equal(trial.usageRateCents, 35);
    assert.equal(trial.orderFeeScope, 'all_paid_orders');
    assert.equal(trial.galleryStoragePolicy, 'existing');
  }
});


test('the actual v2 Stripe catalog and checkout use the public prices without transferring legacy subscription lookups', async () => {
  const env = { STUDIO_GALLERY_PRICING_V2_ENABLED: '1', STRIPE_SECRET_KEY: 'sk_test_catalog_intercepted',
    STRIPE_BILLING_CURRENCY: 'cad' };
  const catalogApi = pricing(env);
  const payments = {};
  const calls = [];
  const priceRows = new Map();
  const originalLegacyPrices = [];
  for (const [plan, monthly, annual] of [['starter', 4900, 52920], ['core', 9900, 106920], ['studio', 19900, 214920]]) {
    for (const [cadence, amount] of [['monthly', monthly], ['annual', annual]]) {
      const key = `studio-os-${plan}-${cadence}-v2`;
      const row = { id: `price_legacy_${plan}_${cadence}`, lookup_key: key, currency: 'cad', unit_amount: amount,
        recurring: { interval: cadence === 'annual' ? 'year' : 'month' }, active: true };
      priceRows.set(key, row);
      originalLegacyPrices.push(structuredClone(row));
    }
  }
  const paymentsSource = ts.transpileModule(readFileSync(new URL('../lib/payments.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', 'fetch', 'process', paymentsSource)(name =>
    name === '@/lib/studio-pricing' ? catalogApi : name.startsWith('@/') ? {} : require(name), payments,
  async (target, options) => {
    const url = new URL(target);
    assert.equal(url.origin, 'https://api.stripe.com', 'every provider request is intercepted');
    assert.equal(options.headers.Authorization, 'Bearer sk_test_catalog_intercepted');
    const call = { path: url.pathname.slice('/v1/'.length), method: options.method,
      query: url.searchParams, body: new URLSearchParams(options.body) };
    calls.push(call);
    let response;
    if (call.path === 'billing/meters' && call.method === 'GET') response = { data: [], has_more: false };
    else if (call.path === 'prices' && call.method === 'GET') {
      const row = priceRows.get(call.query.get('lookup_keys[]'));
      response = { data: row ? [row] : [], has_more: false };
    } else if (call.path === 'products' && call.method === 'POST') {
      response = { id: `prod_fixture_${call.body.get('metadata[lookup_key]')}` };
    } else if (call.path === 'prices' && call.method === 'POST') {
      const key = call.body.get('lookup_key');
      const row = { id: `price_fixture_${key}`, lookup_key: key, currency: call.body.get('currency'),
        unit_amount: Number(call.body.get('unit_amount')), active: true };
      priceRows.set(key, row);
      response = row;
    } else if (call.path === 'checkout/sessions' && call.method === 'POST') {
      response = { id: `cs_fixture_${calls.length}`, url: 'https://checkout.stripe.invalid/fixture' };
    } else throw Error(`Unexpected provider write/read: ${call.method} ${call.path}`);
    return { ok: true, text: async () => JSON.stringify(response) };
  }, { env });

  const stripeCatalog = await payments.ensureStripeCatalog();
  assert.deepEqual(stripeCatalog.usagePriceIds, { starter: null, core: null, studio: null },
    'new direct-fee subscriptions do not gain a metered order fee');
  for (const code of ['starter', 'core', 'studio']) {
    for (const interval of ['month', 'year']) {
      const cadence = interval === 'month' ? 'monthly' : 'annual';
      const key = `studio-os-${code}-${cadence}-gallery-v2`;
      const row = priceRows.get(key);
      assert.ok(row, `the new ${code}/${interval} price has a separate lookup`);
      assert.equal(row.unit_amount, catalogApi.getPlanPriceCents(code, interval));
      assert.equal(stripeCatalog.planPrices[code][interval], row.id);
      await payments.createPlanCheckoutSession({ customerId: 'cus_fixture', photographerId: 'studio_fixture',
        userId: 'user_fixture', planCode: code, billingInterval: interval, extraDesktopKeys: 0,
        successUrl: 'https://example.invalid/success', cancelUrl: 'https://example.invalid/cancel' });
      const checkout = calls.at(-1);
      assert.equal(checkout.path, 'checkout/sessions');
      assert.equal(checkout.body.get('line_items[0][price]'), row.id,
        'checkout selects the same amount advertised by the server catalog');
      assert.equal(checkout.body.get('subscription_data[metadata][pricing_profile]'), 'gallery_v2');
      assert.equal(checkout.body.get('line_items[1][price]'), null, 'no order usage item is added to checkout');
    }
  }
  for (const legacy of originalLegacyPrices) {
    assert.deepEqual(priceRows.get(legacy.lookup_key), legacy, 'existing subscription prices and lookups are unchanged');
  }
  assert.ok(calls.every(call => !(call.path === 'billing/meters' && call.method !== 'GET')));
  assert.ok(calls.every(call => !call.path.startsWith('subscriptions/') && !call.path.startsWith('subscription_items/')),
    'catalog preparation cannot rewrite existing subscriptions');
});

test('routine sync of new monthly and annual v2 subscriptions never attaches a second metered order fee', async () => {
  const env = { STUDIO_GALLERY_PRICING_V2_ENABLED: '1' };
  const catalogApi = pricing(env);
  const periods = {};
  new Function('exports', ts.transpileModule(readFileSync(new URL('../lib/stripe-billing-period.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(periods);
  const paymentsSource = ts.transpileModule(readFileSync(new URL('../lib/payments.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const providerCalls = [];
  const mirrors = [];
  const dependencies = {
    '@/lib/studio-pricing': catalogApi,
    '@/lib/stripe-billing-period': periods,
    '@/lib/order-usage-billing': { reconcileOrderUsageFeeRefunds: async () => {} },
    '@/lib/subscription-access': { isStripeBillingActive: status => ['active', 'trialing'].includes(status) },
    '@/lib/studio-os-app': { syncPhotographyKeysByPhotographerId: async () => {} },
  };
  const payments = {};
  new Function('require', 'exports', 'fetch', 'process', paymentsSource)(name =>
    dependencies[name] ?? (name.startsWith('@/') ? {} : require(name)), payments,
  async target => { providerCalls.push(target); throw Error('Provider requests are forbidden for routine v2 sync'); }, { env });

  for (const code of ['starter', 'core', 'studio']) {
    for (const interval of ['month', 'year']) {
      const photographer = { id: 'studio_fixture', user_id: 'user_fixture', stripe_subscription_item_usage_id: null,
        stripe_subscription_id: 'sub_fixture', subscription_status: 'active', subscription_plan_code: code,
        stripe_connected_account_id: 'acct_fixture', billing_currency: 'cad', extra_desktop_keys: 0 };
      const service = { from(table) {
        if (table === 'photographers') return { update(values) { return { async eq() {
          Object.assign(photographer, values); return { error: null };
        } }; } };
        assert.equal(table, 'subscriptions');
        return { async upsert(value) { mirrors.push(value); return { error: null }; } };
      } };
      const subscription = { id: 'sub_fixture', customer: 'cus_fixture', status: 'active',
        metadata: { pricing_profile: 'gallery_v2', plan_code: code, billing_interval: interval },
        items: { data: [{ id: 'si_base_fixture', current_period_start: 1788220800,
          current_period_end: interval === 'year' ? 1819756800 : 1790812800,
          price: { id: `price_fixture_${code}_${interval}`, currency: 'cad',
            lookup_key: `studio-os-${code}-${interval === 'year' ? 'annual' : 'monthly'}-gallery-v2`,
            unit_amount: catalogApi.getPlanPriceCents(code, interval), recurring: { interval } } }] } };
      for (let repeat = 0; repeat < 2; repeat++) {
        const result = await payments.syncSubscriptionStateFromStripe(service, photographer, subscription);
        assert.equal(result.planCode, code);
        assert.equal(result.usageItemId, null);
        assert.equal(result.photographer.order_usage_rate_cents, 0,
          'the legacy monthly meter rate is zero; production application fees use the separate trusted order policy');
        assert.equal(result.photographer.subscription_billing_interval, interval);
        assert.equal(subscription.items.data.length, 1, 'renewal/webhook sync cannot add a usage subscription item');
      }
    }
  }
  assert.equal(providerCalls.length, 0);
  assert.equal(mirrors.length, 12);
});

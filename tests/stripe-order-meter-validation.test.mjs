import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, overrides = {}, append = '') {
  const exports = {};
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8') + append;
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', compiled)(name => name in overrides ? overrides[name] : name.startsWith('@/') ? {} : require(name), exports);
  return exports;
}

const expectedName = 'studio_os_core_order_usage';
const displayName = 'Core Order Usage';
const meter = { id: 'mtr_core_fixture', object: 'billing.meter', event_name: expectedName, display_name: displayName, status: 'active',
  default_aggregation: { formula: 'sum' }, customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
  value_settings: { event_payload_key: 'value' }, event_time_window: null };
const jsonResponse = value => ({ ok: true, text: async () => JSON.stringify(value) });

async function fixture(run, responder, { rates = {} } = {}) {
  const savedFetch = globalThis.fetch;
  const savedKey = process.env.STRIPE_SECRET_KEY;
  const savedCurrency = process.env.STRIPE_BILLING_CURRENCY;
  const rateVars = ['STRIPE_STARTER_ORDER_USAGE_RATE_CENTS', 'STRIPE_CORE_ORDER_USAGE_RATE_CENTS', 'STRIPE_STUDIO_ORDER_USAGE_RATE_CENTS'];
  const savedRates = rateVars.map(name => [name, process.env[name]]);
  for (const name of rateVars) {
    if (rates[name] === undefined) delete process.env[name];
    else process.env[name] = String(rates[name]);
  }
  process.env.STRIPE_SECRET_KEY = 'sk_test_meter_fixture';
  process.env.STRIPE_BILLING_CURRENCY = 'cad';
  const calls = [];
  globalThis.fetch = async (target, options) => {
    const url = new URL(target);
    assert.equal(url.origin, 'https://api.stripe.com', 'all provider requests are intercepted by the fixture');
    assert.equal(options.headers.Authorization, 'Bearer sk_test_meter_fixture');
    assert.equal(options.headers['Stripe-Account'], undefined);
    const call = { path: url.pathname.replace('/v1/', ''), method: options.method, query: url.searchParams,
      body: new URLSearchParams(options.body), idempotencyKey: options.headers['Idempotency-Key'] };
    calls.push(call);
    return jsonResponse(await responder(call, calls));
  };
  try {
    const api = load('lib/payments.ts', { '@/lib/studio-pricing': load('lib/studio-pricing.ts'), '@/lib/trial-config': { FREE_TRIAL_DAYS: 30 } },
      '\nexport { ensureBillingMeter };');
    await run(api, calls);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = savedKey;
    if (savedCurrency === undefined) delete process.env.STRIPE_BILLING_CURRENCY; else process.env.STRIPE_BILLING_CURRENCY = savedCurrency;
    for (const [name, value] of savedRates) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
}

test('correct active raw sum meter is reused without any provider write', async () => {
  await fixture(async (api, calls) => {
    assert.equal(await api.ensureBillingMeter({ eventName: expectedName, displayName }), meter.id);
    assert.equal(calls.length, 1);
    assert.ok(calls.every(call => call.method === 'GET'));
    assert.equal(calls[0].query.get('status'), null, 'inactive definitions must also be inspected');
  }, call => { assert.equal(call.path, 'billing/meters'); return { data: [meter], has_more: false }; });
});

test('reused meter rejects inactive, wrong or missing aggregation/payload fields and preaggregated ingestion before writes', async () => {
  const invalid = [
    { status: 'inactive' }, { status: 'unknown' }, { default_aggregation: { formula: 'count' } }, { default_aggregation: { formula: 'last' } },
    { default_aggregation: null }, { customer_mapping: { type: 'by_email', event_payload_key: 'stripe_customer_id' } },
    { customer_mapping: { type: 'by_id', event_payload_key: 'customer_id' } }, { customer_mapping: null },
    { value_settings: { event_payload_key: 'quantity' } }, { value_settings: undefined }, { event_time_window: 'hour' },
    { event_time_window: 'day' }, { event_time_window: undefined }, { object: 'unknown' },
  ];
  for (const change of invalid) {
    await fixture(async (api, calls) => {
      await assert.rejects(api.ensureBillingMeter({ eventName: expectedName, displayName }), /incompatible order usage settings/);
      assert.ok(calls.every(call => call.method === 'GET'), JSON.stringify(change));
    }, () => ({ data: [{ ...meter, display_name: 'A name that would otherwise trigger an update', ...change }], has_more: false }));
  }
});

test('duplicate event-name matches across list pages fail closed instead of selecting or creating a meter', async () => {
  await fixture(async (api, calls) => {
    await assert.rejects(api.ensureBillingMeter({ eventName: expectedName, displayName }), /event name is ambiguous/);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.method === 'GET'));
    assert.equal(calls[1].query.get('starting_after'), meter.id);
  }, (_call, calls) => calls.length === 1 ? { data: [meter], has_more: true }
    : { data: [{ ...meter, id: 'mtr_inactive_duplicate', status: 'inactive' }], has_more: false });
});

test('pagination finds an existing meter on a later page without creating a duplicate', async () => {
  const unrelated = { ...meter, id: 'mtr_other', event_name: 'another_application_event' };
  await fixture(async (api, calls) => {
    assert.equal(await api.ensureBillingMeter({ eventName: expectedName, displayName }), meter.id);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.method === 'GET'));
    assert.equal(calls[1].query.get('starting_after'), unrelated.id);
  }, (_call, calls) => calls.length === 1 ? { data: [unrelated], has_more: true } : { data: [meter], has_more: false });
});

test('incomplete, repeating or excessive meter pagination never falls back to catalog creation', async () => {
  const cases = [
    () => ({ data: [], has_more: true }),
    () => ({ data: [] }),
    () => ({ data: [null], has_more: false }),
    () => ({ data: [{ ...meter, id: '' }], has_more: false }),
    () => ({ data: [{ ...meter, id: 123 }], has_more: false }),
    () => ({ data: [{ ...meter, id: 'mtr_repeating', event_name: 'unrelated' }], has_more: true }),
    (_call, calls) => ({ data: [{ ...meter, id: `mtr_page_${calls.length}`, event_name: 'unrelated' }], has_more: true }),
  ];
  for (const responder of cases) {
    await fixture(async (api, calls) => {
      await assert.rejects(api.ensureBillingMeter({ eventName: expectedName, displayName }), /meter (list|pagination)/);
      assert.ok(calls.every(call => call.method === 'GET'));
      assert.ok(calls.length <= 10);
    }, responder);
  }
});

test('correct reused meter retains the existing display-name update behavior', async () => {
  await fixture(async (api, calls) => {
    assert.equal(await api.ensureBillingMeter({ eventName: expectedName, displayName }), meter.id);
    const writes = calls.filter(call => call.method !== 'GET');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, `billing/meters/${meter.id}`);
    assert.deepEqual([...writes[0].body], [['display_name', displayName]]);
  }, call => call.method === 'GET' ? { data: [{ ...meter, display_name: 'Old name' }], has_more: false } : meter);
});

test('missing meter creation keeps the original sum/customer/value payload and stable idempotency key', async () => {
  await fixture(async (api, calls) => {
    assert.equal(await api.ensureBillingMeter({ eventName: expectedName, displayName }), 'mtr_created');
    const writes = calls.filter(call => call.method !== 'GET');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, 'billing/meters');
    assert.deepEqual(Object.fromEntries(writes[0].body), { display_name: displayName, event_name: expectedName,
      'default_aggregation[formula]': 'sum', 'value_settings[event_payload_key]': 'value',
      'customer_mapping[type]': 'by_id', 'customer_mapping[event_payload_key]': 'stripe_customer_id' });
    assert.equal(writes[0].idempotencyKey, `studio-os-meter-${expectedName}`);
  }, call => call.method === 'GET' ? { data: [], has_more: false } : { id: 'mtr_created' });
});

test('catalog preflight rejects an incompatible last-plan meter before any product, price or checkout write', async () => {
  const starter = { ...meter, id: 'mtr_starter', event_name: 'studio_os_starter_order_usage', display_name: 'Starter Order Usage' };
  const invalidStudio = { ...meter, id: 'mtr_studio', event_name: 'studio_os_studio_order_usage', customer_mapping: { type: 'by_id', event_payload_key: 'wrong_customer' } };
  await fixture(async (api, calls) => {
    await assert.rejects(api.createPlanCheckoutSession({ customerId: 'cus_fixture', photographerId: 'studio_fixture', userId: 'user_fixture', planCode: 'core',
      billingInterval: 'month', extraDesktopKeys: 0, successUrl: 'https://fixture.invalid/success', cancelUrl: 'https://fixture.invalid/cancel' }), /incompatible order usage settings/);
    assert.ok(calls.length > 0);
    assert.ok(calls.every(call => call.path === 'billing/meters' && call.method === 'GET'), 'even missing base-plan prices must remain untouched');
  }, call => { assert.equal(call.method, 'GET', 'catalog writes are forbidden before successful preflight'); return { data: [starter, meter, invalidStudio], has_more: false }; });
});

test('catalog preflight checks ambiguity even when the requested subscription uses another plan', async () => {
  await fixture(async (api, calls) => {
    await assert.rejects(api.ensureStripeCatalog(), /event name is ambiguous/);
    assert.ok(calls.every(call => call.path === 'billing/meters' && call.method === 'GET'));
  }, () => ({ data: [meter, { ...meter, id: 'mtr_duplicate' }], has_more: false }));
});

const planMeters = ['starter', 'core', 'studio'].map(plan => ({ ...meter, id: `mtr_${plan}`, event_name: `studio_os_${plan}_order_usage`,
  display_name: `${plan[0].toUpperCase()}${plan.slice(1)} Order Usage` }));

function catalogResponder({ oldUsageRates } = {}) {
  return call => {
    if (call.path === 'billing/meters') return { data: planMeters, has_more: false };
    if (call.path === 'prices' && call.method === 'GET') {
      const lookup = call.query.get('lookup_keys[]');
      const plan = ['starter', 'core', 'studio'].find(value => lookup === `studio-os-${value}-order-usage-monthly-v2`);
      if (plan && oldUsageRates?.[plan] !== undefined) return { data: [{ id: `price_old_${plan}`, unit_amount: oldUsageRates[plan], currency: 'cad',
        recurring: { interval: 'month', usage_type: 'metered', meter: `mtr_${plan}` } }], has_more: false };
      return { data: [], has_more: false };
    }
    if (call.path === 'products' && call.method === 'POST') return { id: `prod_${call.body.get('metadata[lookup_key]')}` };
    if (call.path === 'prices' && call.method === 'POST') return { id: `price_new_${call.body.get('lookup_key')}` };
    throw Error(`Unexpected intercepted request: ${call.method} ${call.path}`);
  };
}

test('selected default rates produce Starter55c App40c Studio35c prices and matching catalog descriptions', async () => {
  await fixture(async (api, calls) => {
    const pricing = load('lib/studio-pricing.ts');
    assert.deepEqual(['starter', 'core', 'studio'].map(plan => pricing.PLAN_DEFS[plan].usageRateCents), [55, 40, 35]);
    await api.ensureStripeCatalog();
    for (const [plan, rate] of [['starter', 55], ['core', 40], ['studio', 35]]) {
      const lookup = `studio-os-${plan}-order-usage-monthly-v2`;
      const product = calls.find(call => call.path === 'products' && call.body.get('metadata[lookup_key]') === lookup);
      const price = calls.find(call => call.path === 'prices' && call.method === 'POST' && call.body.get('lookup_key') === lookup);
      assert.equal(product.body.get('description'), `Completed paid order usage billed monthly at ${new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', currencyDisplay: 'code' }).format(rate / 100)} per order`);
      assert.equal(price.body.get('unit_amount'), String(rate));
      assert.equal(product.idempotencyKey, `studio-os-product-${lookup}-${rate}`);
      assert.equal(price.idempotencyKey, `studio-os-price-${lookup}-${rate}`);
    }
  }, catalogResponder());
});

test('configured rate overrides are used in both catalog unit amounts and descriptions', async () => {
  const rates = { STRIPE_STARTER_ORDER_USAGE_RATE_CENTS: 61, STRIPE_CORE_ORDER_USAGE_RATE_CENTS: 47, STRIPE_STUDIO_ORDER_USAGE_RATE_CENTS: 39 };
  await fixture(async (api, calls) => {
    await api.ensureStripeCatalog();
    for (const [plan, rate] of [['starter', 61], ['core', 47], ['studio', 39]]) {
      const lookup = `studio-os-${plan}-order-usage-monthly-v2`;
      const product = calls.find(call => call.path === 'products' && call.body.get('metadata[lookup_key]') === lookup);
      const price = calls.find(call => call.path === 'prices' && call.method === 'POST' && call.body.get('lookup_key') === lookup);
      assert.equal(price.body.get('unit_amount'), String(rate));
      assert.ok(product.body.get('description').includes((rate / 100).toFixed(2)));
      assert.equal(product.idempotencyKey, `studio-os-product-${lookup}-${rate}`);
    }
  }, catalogResponder(), { rates });
});

test('a prospective rate change creates new prices and transfers lookups without mutating old prices or subscribers', async () => {
  await fixture(async (api, calls) => {
    const catalog = await api.ensureStripeCatalog();
    assert.equal(catalog.usagePriceIds.starter, 'price_old_starter');
    for (const [plan, rate] of [['core', 40], ['studio', 35]]) {
      const lookup = `studio-os-${plan}-order-usage-monthly-v2`;
      assert.equal(catalog.usagePriceIds[plan], `price_new_${lookup}`);
      const creation = calls.find(call => call.path === 'prices' && call.method === 'POST' && call.body.get('lookup_key') === lookup);
      assert.equal(creation.body.get('unit_amount'), String(rate));
      assert.equal(creation.body.get('transfer_lookup_key'), 'true');
    }
    assert.ok(calls.every(call => !call.path.startsWith('subscriptions/') && !call.path.startsWith('subscription_items/') && !call.path.startsWith('prices/')));
  }, catalogResponder({ oldUsageRates: { starter: 55, core: 35, studio: 25 } }));
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import * as pricing from '../lib/studio-pricing.ts';
import * as periods from '../lib/stripe-billing-period.ts';
import * as orderPolicy from '../lib/order-payment-policy.ts';

const start = Date.parse('2026-09-01T00:00:00Z') / 1000;
const end = Date.parse('2026-10-01T00:00:00Z') / 1000;
const nextYear = Date.parse('2027-09-01T00:00:00Z') / 1000;
const source = readFileSync(new URL('../lib/payments.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const ledgerCompiled = ts.transpileModule(readFileSync(new URL('../lib/order-usage-billing.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const ledger = {};
new Function('require', 'exports', ledgerCompiled)(name => name === 'node:crypto' ? { randomUUID } : {}, ledger);

function fixture({ annual = false, missingUsage = false } = {}) {
  const calls = [];
  const tables = {
    photographers: [{ id: 'studio', user_id: 'owner', subscription_plan_code: 'core', subscription_status: 'active',
      stripe_platform_customer_id: 'cus_owner', stripe_subscription_id: 'sub_owner',
      stripe_subscription_item_usage_id: missingUsage ? null : 'si_usage', order_usage_rate_cents: 35,
      subscription_current_period_start: null, subscription_current_period_end: null }],
    subscriptions: [],
    order_usage_fees: [],
    orders: [
      { id: 'paid', photographer_id: 'studio', paid_at: '2026-09-20T10:00:00Z', payment_status: 'paid', is_test: false, counted_for_monthly_usage: false },
      { id: 'test', photographer_id: 'studio', paid_at: '2026-09-20T10:00:00Z', payment_status: 'paid', is_test: true, counted_for_monthly_usage: false },
      { id: 'refund', photographer_id: 'studio', paid_at: '2026-09-20T10:00:00Z', payment_status: 'paid', is_test: false, counted_for_monthly_usage: false, refund_status: 'refunded' },
      { id: 'partial', photographer_id: 'studio', paid_at: '2026-09-20T10:00:00Z', payment_status: 'paid', is_test: false, counted_for_monthly_usage: false, refund_status: 'partially_refunded' },
      { id: 'unpaid', photographer_id: 'studio', paid_at: null, payment_status: 'pending', is_test: false, counted_for_monthly_usage: false },
    ],
  };
  tables.orders.forEach(order => { order.total_cents = 1000; });
  const base = { id: 'si_base', current_period_start: start, current_period_end: annual ? nextYear : end,
    price: { lookup_key: `studio-os-core-${annual ? 'annual' : 'monthly'}-v2`, currency: 'cad', recurring: { interval: annual ? 'year' : 'month' } } };
  const usage = { id: 'si_usage', current_period_start: start, current_period_end: end,
    price: { lookup_key: 'studio-os-core-order-usage-monthly-v2', unit_amount: 35, currency: 'cad', recurring: { interval: 'month', meter: 'meter_core' } } };
  const subscription = { id: 'sub_owner', customer: 'cus_owner', status: 'active', billing_mode: { type: 'classic' }, items: { data: missingUsage ? [base] : [base, usage] } };
  const service = { from(table) {
    let predicate = () => true; let update; let bounds; let sortKey;
    const chain = {
      select() { return chain; },
      eq(key, value) { const previous = predicate; predicate = row => previous(row) && row[key] === value; return chain; },
      in(key, values) { const previous = predicate; predicate = row => previous(row) && values.includes(row[key]); return chain; },
      gte(key, value) { const previous = predicate; predicate = row => previous(row) && row[key] >= value; return chain; },
      lt(key, value) { const previous = predicate; predicate = row => previous(row) && row[key] < value; return chain; },
      or() { const previous = predicate; predicate = row => previous(row) && row.is_test !== true; return chain; },
      order(key) { sortKey = key; return chain; },
      range(from, to) { bounds = [from, to]; return chain; },
      limit() { return chain; },
      update(value) { update = value; return chain; },
      async upsert(value) { tables[table].push(value); return { error: null }; },
      then(resolve, reject) { let matching = tables[table].filter(predicate); if (sortKey) matching.sort((a,b)=>String(a[sortKey]).localeCompare(String(b[sortKey])));
        if (bounds) matching = matching.slice(bounds[0],bounds[1]+1);
        if (update) matching.forEach(row => Object.assign(row, update)); return Promise.resolve({ data: structuredClone(matching), error: null }).then(resolve, reject); },
    }; return chain;
  }, async rpc(name, args) {
    const order = tables.orders.find(order => order.id === args.p_order_id);
    let fee = tables.order_usage_fees.find(fee => fee.order_id === args.p_order_id);
    if (name === 'stage_order_usage_fee') {
      if (!fee && !order.counted_for_monthly_usage && order.refund_status !== 'refunded') {
        fee = { order_id: order.id, photographer_id: args.p_photographer_id, stripe_customer_id: args.p_customer_id, event_name: args.p_event_name,
          event_identifier: `studio-os-usage-order-${order.id}`, usage_timestamp: args.p_usage_timestamp, amount_cents: args.p_amount_cents,
          currency: args.p_currency, billing_period: args.p_billing_period, report_status: 'pending', report_first_attempt_at: null,
          refund_status: 'none', refund_requested_at: null, refund_strategy: null, refund_first_attempt_at: null };
        tables.order_usage_fees.push(fee);
      }
    } else if (name === 'claim_order_usage_fee') {
      if (!fee || fee.report_status === 'reported') return { data: null, error: null };
      fee.lock_token = args.p_token; fee.report_status = 'processing'; fee.report_first_attempt_at ??= new Date().toISOString();
    } else if (name === 'complete_order_usage_fee_report') {
      fee.report_status = 'reported'; fee.reported_at = args.p_reported_at; fee.lock_token = null;
      order.counted_for_monthly_usage = true; order.monthly_usage_billing_period = fee.billing_period;
    } else throw Error(name);
    return { data: structuredClone(fee), error: null };
  } };
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname.replace('/v1/', '');
    const params = new URLSearchParams(options.body);
    calls.push({ path, method: options.method, headers: options.headers, params });
    let result;
    if (path === 'subscriptions/sub_owner/migrate') { subscription.billing_mode = { type: 'flexible' }; result = subscription; }
    else if (path === 'subscriptions/sub_owner') result = subscription;
    else if (path === 'subscription_items') { assert.equal(subscription.billing_mode.type, 'flexible'); subscription.items.data.push(usage); result = usage; }
    else if (path === 'billing/meter_events') result = { identifier: params.get('identifier'), created: Math.floor(Date.now() / 1000) };
    else if (path === 'checkout/sessions') result = { id: 'cs_test', url: 'https://checkout.stripe.test' };
    else throw Error(`Unexpected request ${path}`);
    return { ok: true, text: async () => JSON.stringify(result) };
  };
  const dependencies = {
    '@/lib/studio-pricing': pricing,
    '@/lib/stripe-billing-period': periods,
    '@/lib/order-usage-billing': ledger,
    '@/lib/order-payment-policy': orderPolicy,
    '@/lib/trial-config': { FREE_TRIAL_DAYS: 14 },
    '@/lib/subscription-access': { isStripeBillingActive: value => ['active', 'trialing'].includes(value) },
    '@/lib/studio-os-app': { syncPhotographyKeysByPhotographerId: async () => {} },
  };
  const exports = {};
  new Function('require', 'exports', 'fetch', compiled + '\nexports.seedCatalog = value => { catalogPromise = Promise.resolve(value); };')(
    name => dependencies[name] || {}, exports, fetcher,
  );
  exports.seedCatalog({ usagePriceIds: { core: 'price_usage' }, planPrices: { core: { month: 'price_month', year: 'price_year' } }, extraDesktopKeyPriceIds: { month: 'price_extra_month', year: 'price_extra_year' } });
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
  return { exports, calls, tables, service, subscription };
}

test('Basil item periods restore per-order owner fees and repeated sync does not double count', async () => {
  const f = fixture();
  await f.exports.syncSubscriptionStateFromStripe(f.service, f.tables.photographers[0], f.subscription);
  const events = f.calls.filter(call => call.path === 'billing/meter_events');
  assert.equal(events.length, 2, 'paid and partially refunded orders remain billable');
  assert.equal(events[0].params.get('event_name'), 'studio_os_core_order_usage');
  assert.equal(events[0].params.get('payload[stripe_customer_id]'), 'cus_owner');
  assert.equal(events[0].params.get('payload[value]'), '1');
  assert.equal(events[0].params.get('timestamp'), String(Date.parse('2026-09-20T10:00:00Z') / 1000));
  assert.equal(events[0].headers['Stripe-Account'], undefined, 'owner usage revenue is on the platform Stripe account');
  assert.equal(f.tables.photographers[0].subscription_current_period_end, '2026-10-01T00:00:00.000Z');
  assert.equal(f.tables.orders[0].counted_for_monthly_usage, true);
  await f.exports.syncSubscriptionStateFromStripe(f.service, f.tables.photographers[0], f.subscription);
  assert.equal(f.calls.filter(call => call.path === 'billing/meter_events').length, 2);
});

test('annual plan keeps annual renewal date while usage uses its monthly period', async () => {
  const f = fixture({ annual: true, missingUsage: true });
  await f.exports.syncSubscriptionStateFromStripe(f.service, f.tables.photographers[0], f.subscription);
  assert.ok(f.calls.findIndex(call => call.path.endsWith('/migrate')) < f.calls.findIndex(call => call.path === 'subscription_items'));
  assert.equal(f.tables.photographers[0].subscription_current_period_end, '2027-09-01T00:00:00.000Z');
  assert.equal(f.tables.orders[0].monthly_usage_billing_period, '2026-09-01:2026-10-01');
  const summary = await f.exports.getUsageSummaryForCurrentPeriod(f.service, f.tables.photographers[0]);
  assert.equal(summary.billingPeriodKey, '2026-09-01:2026-10-01');
  assert.equal(summary.estimatedChargeCents, 70);
});

test('annual Checkout is flexible and attaches monthly usage after checkout, preserving supported Stripe intervals', async () => {
  const f = fixture({ annual: true });
  await f.exports.createPlanCheckoutSession({ customerId: 'cus_owner', photographerId: 'studio', userId: 'owner', planCode: 'core', billingInterval: 'year', extraDesktopKeys: 0, successUrl: 'https://example.test/success', cancelUrl: 'https://example.test/cancel' });
  const checkout = f.calls.at(-1);
  assert.equal(checkout.params.get('subscription_data[billing_mode][type]'), 'flexible');
  assert.equal(checkout.params.get('line_items[0][price]'), 'price_year');
  assert.equal(checkout.params.get('line_items[1][price]'), null);
});

test('billing estimate retains original fee rates and includes older-order refund credits in this cycle', async () => {
  const f = fixture();
  await f.exports.syncSubscriptionStateFromStripe(f.service, f.tables.photographers[0], f.subscription);
  f.tables.photographers[0].order_usage_rate_cents = 25;
  let summary = await f.exports.getUsageSummaryForCurrentPeriod(f.service, f.tables.photographers[0]);
  assert.equal(summary.estimatedChargeCents, 70, 'changing plan rate cannot reprice reported fees');
  f.tables.order_usage_fees.push({ order_id: 'last-month', photographer_id: 'studio', amount_cents: 35,
    usage_timestamp: start - 1, report_status: 'reported', refund_status: 'completed', refund_strategy: 'invoice_credit', refund_completed_at: '2026-09-25T00:00:00Z' });
  summary = await f.exports.getUsageSummaryForCurrentPeriod(f.service, f.tables.photographers[0]);
  assert.equal(summary.refundCreditCents, 35); assert.equal(summary.estimatedChargeCents, 35);
});

test('usage summaries include every paid record past PostgREST 1000-row pages', async () => {
  const f = fixture();
  const photographer = f.tables.photographers[0];
  photographer.subscription_current_period_start = '2026-09-01T00:00:00Z';
  photographer.subscription_current_period_end = '2026-10-01T00:00:00Z';
  f.tables.orders = Array.from({length:2207},(_,index)=>({id:String(index).padStart(5,'0'),photographer_id:'studio',paid_at:'2026-09-20T10:00:00Z',
    total_cents:1000,payment_status:'paid',is_test:false,counted_for_monthly_usage:true}));
  f.tables.order_usage_fees = f.tables.orders.map(order=>({order_id:order.id,photographer_id:'studio',usage_timestamp:start+1,amount_cents:35,
    report_status:'reported',refund_status:'none',refund_strategy:null}));
  const summary = await f.exports.getUsageSummaryForCurrentPeriod(f.service,photographer);
  assert.equal(summary.billableOrders,2207);assert.equal(summary.countedOrders,2207);assert.equal(summary.estimatedChargeCents,2207*35);
});

test('customer order proceeds go directly to photographer Stripe Connect account', async () => {
  const f = fixture();
  await f.exports.createDirectOrderCheckoutSession({ accountId: 'acct_photographer', orderId: 'order', photographerId: 'studio', currency: 'cad', totalCents: 10360, productName: 'Print order', description: 'Prints', successUrl: 'https://example.test/success', cancelUrl: 'https://example.test/cancel' });
  const checkout = f.calls.at(-1);
  assert.equal(checkout.headers['Stripe-Account'], 'acct_photographer');
  assert.equal(checkout.params.get('line_items[0][price_data][unit_amount]'), '10360');
  assert.equal(checkout.params.get('payment_intent_data[application_fee_amount]'), null, 'service fees are separately invoiced to the photographer');
});

test('period resolution supports old webhooks and independent annual/monthly item periods', () => {
  assert.deepEqual(periods.resolveStripeBillingPeriod({ current_period_start: start, current_period_end: end }), { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' });
  assert.deepEqual(periods.resolveStripeBillingPeriod({}), { start: null, end: null });
  const annual = { current_period_start: start, current_period_end: nextYear };
  const monthly = { current_period_start: start, current_period_end: end };
  assert.equal(periods.resolveStripeBillingPeriod({ items: { data: [annual, monthly] } }, annual).end, '2027-09-01T00:00:00.000Z');
  assert.equal(periods.resolveStripeBillingPeriod({ items: { data: [annual, monthly] } }, monthly).end, '2026-10-01T00:00:00.000Z');
});

test('invoice subscription references support Basil parent and earlier webhook shapes', () => {
  assert.equal(periods.stripeInvoiceSubscriptionId({ parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_basil' } } }), 'sub_basil');
  assert.equal(periods.stripeInvoiceSubscriptionId({ parent: { type: 'subscription_details', subscription_details: { subscription: { id: 'sub_expanded' } } } }), 'sub_expanded');
  assert.equal(periods.stripeInvoiceSubscriptionId({ subscription: 'sub_legacy' }), 'sub_legacy');
  assert.equal(periods.stripeInvoiceSubscriptionId({ parent: { type: 'quote_details' } }), null);
});

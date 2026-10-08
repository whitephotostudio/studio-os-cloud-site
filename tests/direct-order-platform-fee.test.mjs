import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as pricing from '../lib/studio-pricing.ts';
import * as orderPolicy from '../lib/order-payment-policy.ts';
import * as orderCurrency from '../lib/order-currency.ts';

const compiled = ts.transpileModule(readFileSync(new URL('../lib/payments.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const refundHelperCompiled = ts.transpileModule(readFileSync(new URL('../lib/direct-order-fee-refund.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const checkoutInput = { accountId: 'acct_fixture', orderId: 'order-a', photographerId: 'studio', currency: 'cad', totalCents: 3000,
  productName: 'Photos', description: 'Fixture photos', successUrl: 'https://example.invalid/success', cancelUrl: 'https://example.invalid/cancel' };

function fixture(context) {
  const savedKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_intercepted_fixture';
  context.after(() => { if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = savedKey; });
  const calls = []; const writes = [];
  const tables = { orders: [], photographers: [{ id: 'studio', stripe_connected_account_id: 'acct_fixture', stripe_account_id: null,
    is_platform_admin: false, subscription_plan_code: 'core', subscription_status: 'active', stripe_subscription_item_usage_id: null }] };
  let intent;
  let readFault;
  let providerReadFault;
  let charge;
  let applicationFee;
  let refunds = [];
  let legacyWaivers = 0;
  const dependencies = {
    'node:crypto': crypto, '@/lib/studio-pricing': pricing, '@/lib/order-payment-policy': orderPolicy,
    '@/lib/order-currency': orderCurrency,
    '@/lib/trial-config': { FREE_TRIAL_DAYS: 30 },
    '@/lib/subscription-access': { isStripeBillingActive: value => ['active', 'trialing'].includes(value) },
    '@/lib/credit-maintenance': { creditMaintenanceActive: () => false }, '@/lib/resend': { resendConfigured: () => false },
    '@/lib/order-usage-billing': { reconcileOrderUsageFeeRefunds: async () => { legacyWaivers++; } },
  };
  const api = {};
  new Function('require', 'exports', 'fetch', compiled)(name => dependencies[name] || {}, api, async (target, options) => {
    const url = new URL(target);
    assert.equal(url.origin, 'https://api.stripe.com', 'every provider request is intercepted');
    const call = { path: url.pathname.replace('/v1/', ''), method: options.method, headers: options.headers, body: new URLSearchParams(options.body) };
    calls.push(call);
    if (providerReadFault === call.path) throw Error('fixture provider read unavailable');
    if (call.path === 'checkout/sessions' && call.method === 'POST') return { ok: true, text: async () => JSON.stringify({ id: 'cs_fixture', url: 'https://checkout.stripe.invalid/fixture' }) };
    if (call.path === 'payment_intents/pi_fixture' && call.method === 'GET') return { ok: true, text: async () => JSON.stringify(intent) };
    if (call.path === 'refunds' && call.method === 'GET') return { ok: true, text: async () => JSON.stringify({ data: refunds, has_more: false }) };
    if (call.path === 'charges/ch_fixture' && call.method === 'GET') return { ok: true, text: async () => JSON.stringify(charge) };
    if (call.path === 'application_fees/fee_fixture' && call.method === 'GET') {
      assert.equal(call.headers['Stripe-Account'], undefined, 'the application fee read belongs to the platform');
      return { ok: true, text: async () => JSON.stringify(applicationFee) };
    }
    assert.fail(`Unexpected intercepted provider request ${call.method} ${call.path}`);
  });
  const refundHelper = {};
  new Function('require', 'exports', refundHelperCompiled)(name => name === '@/lib/payments' ? api : dependencies[name] || {}, refundHelper);
  dependencies['@/lib/direct-order-fee-refund'] = refundHelper;
  const service = { from(table) {
    assert.ok(table in tables);
    let predicate = () => true; let update; let selected;
    const result = (single = false) => {
      let matching = tables[table].filter(predicate);
      if (table === 'orders' && selected === 'id, order_group_id' && readFault === 'seed-error') return { data: null, error: Error('fixture seed lookup unavailable'), count: null };
      if (table === 'orders' && selected === 'id' && readFault === 'group-error') return { data: null, error: Error('fixture group lookup unavailable'), count: null };
      let count = matching.length;
      if (table === 'orders' && selected === 'id') {
        if (readFault === 'group-empty') { matching = []; count = 0; }
        if (readFault === 'group-truncated') matching = matching.slice(0, 1);
        if (readFault === 'group-seed-missing') { matching = matching.slice(1); count = matching.length; }
        if (readFault === 'group-duplicate') matching = [matching[0], matching[0]];
      }
      if (update) { writes.push({ table, ids: matching.map(row => row.id), values: update }); matching.forEach(row => Object.assign(row, update)); }
      return { data: structuredClone(single ? matching[0] || null : matching), error: null, count };
    };
    const chain = {
      select(fields) { selected = fields; return chain; },
      eq(key, value) { const before = predicate; predicate = row => before(row) && row[key] === value; return chain; },
      neq(key, value) { const before = predicate; predicate = row => before(row) && row[key] !== value; return chain; },
      in(key, values) { const before = predicate; predicate = row => before(row) && values.includes(row[key]); return chain; },
      update(values) { update = values; return chain; },
      limit() { return chain; },
      order() { return chain; },
      async maybeSingle() { return result(true); },
      async single() { return result(true); },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    }; return chain;
  } };
  async function freeze(orders, options = {}) {
    const currency = options.currency || 'cad';
    const quote = await api.quoteDirectOrderPlatformFees({ planCode: 'core', subscriptionStatus: 'active', isPlatformAdmin: false,
      currency, orders, ...options });
    tables.orders = orders.map((order, index) => ({ id: order.id, photographer_id: 'studio', order_group_id: orders.length > 1 ? 'group_fixture' : null,
      total_cents: order.totalCents, currency, package_name: 'Prints', status: 'pending', payment_status: 'pending', paid_at: null,
      notes: '', platform_fee_collection_method: quote.orders[index].collectionMethod, platform_fee_amount_cents: quote.orders[index].amountCents,
      platform_fee_currency: quote.currency, platform_fee_rate_cents: quote.rateCents, stripe_application_fee_id: null }));
    const fee = api.directOrderPlatformFeePayload(tables.orders, currency);
    intent = { id: 'pi_fixture', status: 'succeeded', amount: orders.reduce((sum, order) => sum + order.totalCents, 0),
      amount_received: orders.reduce((sum, order) => sum + order.totalCents, 0), currency, application_fee_amount: fee.amountCents || null, latest_charge: 'ch_fixture',
      metadata: { billing_flow: 'customer_order', photographer_id: 'studio', order_id: orders[0].id,
        ...(orders.length > 1 ? { order_group_id: 'group_fixture' } : {}), ...api.directOrderPlatformFeeMetadata(fee) } };
    charge = { id: 'ch_fixture', payment_intent: intent.id, amount: intent.amount, amount_refunded: intent.amount, currency,
      application_fee_amount: fee.amountCents || null, application_fee: fee.amountCents ? 'fee_fixture' : null };
    applicationFee = { id: 'fee_fixture', object: 'application_fee', account: 'acct_fixture', charge: charge.id,
      amount: fee.amountCents, amount_refunded: fee.amountCents, currency, refunded: true };
    refunds = [{ id: 're_fixture', status: 'succeeded', amount: intent.amount, currency }];
    return { quote, fee };
  }
  return { api, calls, writes, tables, service, freeze, failRead(value) { readFault = value; }, failProviderRead(value) { providerReadFault = value; },
    get intent() { return intent; }, get charge() { return charge; }, get applicationFee() { return applicationFee; }, get refunds() { return refunds; }, get legacyWaivers() { return legacyWaivers; } };
}

test('Starter55c App40c and Studio35c are deducted inside connected Checkout without increasing the customer total', async context => {
  const f = fixture(context);
  for (const [planCode, expected] of [['starter', 55], ['core', 40], ['studio', 35]]) {
    const { fee } = await f.freeze([{ id: 'order-a', totalCents: 3000 }], { planCode });
    await f.api.createDirectOrderCheckoutSession({ ...checkoutInput, platformFee: fee });
    const call = f.calls.at(-1);
    assert.equal(call.headers['Stripe-Account'], 'acct_fixture');
    assert.equal(call.body.get('line_items[0][price_data][unit_amount]'), '3000');
    assert.equal(call.body.get('payment_intent_data[application_fee_amount]'), String(expected));
    for (const [key, value] of Object.entries(f.api.directOrderPlatformFeeMetadata(fee))) {
      assert.equal(call.body.get(`metadata[${key}]`), value);
      assert.equal(call.body.get(`payment_intent_data[metadata][${key}]`), value);
    }
  }
});

test('combined checkout deducts one flat fee per positive non-test order and zero for test or free members', async context => {
  const f = fixture(context);
  const { quote, fee } = await f.freeze([{ id: 'order-a', totalCents: 1000 }, { id: 'order-b', totalCents: 1500 },
    { id: 'test', totalCents: 500, isTest: true }, { id: 'free', totalCents: 0 }]);
  assert.equal(fee.amountCents, 80); assert.equal(fee.billableOrderCount, 2);
  assert.deepEqual(quote.orders.map(row => row.amountCents), [40, 40, 0, 0]);
  await f.api.createDirectOrderCheckoutSession({ ...checkoutInput, orderGroupId: 'group_fixture', platformFee: fee });
  assert.equal(f.calls.at(-1).body.get('payment_intent_data[application_fee_amount]'), '80');
});

test('a valid free app trial uses Studio35c while expired or inactive accounts cannot accept payment', async context => {
  const f = fixture(context);
  const order = { id: 'order-a', totalCents: 3000 };
  const { fee } = await f.freeze([order], { planCode: null, subscriptionStatus: 'trial', freeTrialActive: true });
  assert.equal(fee.amountCents, 35); assert.equal(fee.rateCents, 35);
  for (const subscriptionStatus of ['trial', 'canceled', 'past_due', null]) {
    await assert.rejects(f.api.quoteDirectOrderPlatformFees({ planCode: 'studio', subscriptionStatus, isPlatformAdmin: false, freeTrialActive: false, currency: 'cad', orders: [order] }), /active subscription/);
  }
  assert.equal(f.calls.length, 0);
});

test('owner foreign orders are explicitly waived without provider application fees', async context => {
  const f = fixture(context);
  const { fee } = await f.freeze([{ id: 'order-a', totalCents: 3000 }], { planCode: null, subscriptionStatus: null, isPlatformAdmin: true, currency: 'usd' });
  assert.equal(fee.collectionMethod, 'waived'); assert.equal(fee.amountCents, 0);
  await f.api.createDirectOrderCheckoutSession({ ...checkoutInput, currency: 'usd', platformFee: fee });
  assert.equal(f.calls.at(-1).body.get('payment_intent_data[application_fee_amount]'), null);
  assert.equal(f.calls.at(-1).body.get('metadata[platform_fee_collection_method]'), 'waived');
});

test('every supported sales currency deducts the same nominal fee and frozen retries do not requote', async context => {
  const f = fixture(context);
  for (const currency of ['usd', 'cad', 'eur', 'gbp', 'aud', 'aed', 'sar', 'amd']) {
    const { fee } = await f.freeze([{ id: 'order-a', totalCents: 3000 }], { currency });
    assert.equal(fee.rateCents, 40); assert.equal(fee.amountCents, 40);
    await f.api.createDirectOrderCheckoutSession({ ...checkoutInput, currency, platformFee: fee });
    const first = f.calls.at(-1);
    await f.api.createDirectOrderCheckoutSession({ ...checkoutInput, currency, platformFee: fee });
    const retry = f.calls.at(-1);
    assert.equal(first.body.toString(), retry.body.toString());
    assert.equal(first.headers['Idempotency-Key'], retry.headers['Idempotency-Key']);
    assert.equal(first.body.get('payment_intent_data[application_fee_amount]'), '40');
    assert.equal(first.body.get('metadata[platform_fee_rate_cents]'), '40');
    assert.equal(first.body.get('metadata[platform_fee_currency]'), currency);
    assert.equal(first.body.get('metadata[platform_fee_rate_cad_cents]'), null);
    assert.equal(first.body.get('metadata[platform_fee_fx_source]'), null);
  }
  assert.equal(f.calls.length, 16, 'only the intercepted Checkout calls run; quoting requires no currency conversion service');
});

test('legacy Checkout retries retain the original no-fee payload and stable idempotency key', async context => {
  const f = fixture(context);
  await f.api.createDirectOrderCheckoutSession(checkoutInput);
  assert.equal(f.calls[0].body.get('payment_intent_data[application_fee_amount]'), null);
  assert.equal(f.calls[0].body.get('metadata[platform_fee_collection_method]'), null);
  assert.equal(f.calls[0].headers['Idempotency-Key'], 'studio-os-order-session-order-a');
});

test('saved fee hash is order-independent and binds the frozen local-currency rate and each member', async context => {
  const f = fixture(context);
  await f.freeze([{ id: 'order-b', totalCents: 1000 }, { id: 'order-a', totalCents: 2000 }], { currency: 'usd' });
  const rows = structuredClone(f.tables.orders);
  const key = f.api.directOrderPlatformFeeSnapshotKey(rows);
  rows.reverse();
  assert.equal(f.api.directOrderPlatformFeeSnapshotKey(rows), key);
  rows[0].platform_fee_rate_cents = 35;
  rows[0].platform_fee_amount_cents = 35;
  assert.notEqual(f.api.directOrderPlatformFeeSnapshotKey(rows), key);
  assert.throws(() => f.api.directOrderPlatformFeePayload(rows, 'usd'), /do not agree/);
});

test('invalid fee snapshots or fee exceeding gross fail before any provider request without silent capping', async context => {
  const f = fixture(context);
  const { fee } = await f.freeze([{ id: 'order-a', totalCents: 3000 }]);
  for (const change of [{ amountCents: -1 }, { amountCents: 40.5 }, { amountCents: 3001 }, { currency: 'usd' },
    { snapshotKey: '' }, { billableOrderCount: 0 }, { rateCents: 35 }, { currency: 'jpy' }, { currency: 'bhd' },
    { collectionMethod: 'waived' }, { collectionMethod: 'unknown' }]) {
    await assert.rejects(f.api.createDirectOrderCheckoutSession({ ...checkoutInput, platformFee: { ...fee, ...change } }));
  }
  await assert.rejects(f.api.quoteDirectOrderPlatformFees({ planCode: 'starter', subscriptionStatus: 'active', isPlatformAdmin: false, currency: 'cad', orders: [{ id: 'tiny', totalCents: 54 }] }), /too small/);
  for (const currency of ['jpy', 'bhd', 'unknown']) {
    await assert.rejects(f.api.quoteDirectOrderPlatformFees({ planCode: 'core', subscriptionStatus: 'active', isPlatformAdmin: false, currency, orders: [{ id: 'order-a', totalCents: 3000 }] }), /currency/);
  }
  assert.equal(f.calls.length, 0);
});

test('verified aggregate application fee allows every combined order to finalize once', async context => {
  const f = fixture(context);
  const { fee } = await f.freeze([{ id: 'order-a', totalCents: 1000 }, { id: 'order-b', totalCents: 2000 }]);
  assert.deepEqual(await f.api.verifyDirectOrderPlatformFeePayment(f.service, { orderIds: ['order-a', 'order-b'], paymentIntentId: 'pi_fixture' }), fee);
  await f.api.finalizePaidOrderOrGroup(f.service, { orderId: 'order-a', paymentIntentId: 'pi_fixture', paymentStatus: 'paid', note: 'Fixture payment confirmed.' });
  assert.ok(f.tables.orders.every(row => row.payment_status === 'paid'));
  const writes = f.writes.length;
  await f.api.finalizePaidOrderOrGroup(f.service, { orderId: 'order-a', paymentStatus: 'paid', note: 'Already-paid confirm reload.' });
  assert.equal(f.writes.length, writes, 'repeated webhook cannot mutate already paid orders');
  assert.ok(f.calls.every(call => call.method === 'GET' && call.headers['Stripe-Account'] === 'acct_fixture'), 'finalization verifies payment without provider financial writes');
});

test('actual application-fee mismatch prevents all paid flags even when connected merchant metadata claims the expected fee', async context => {
  const f = fixture(context);
  await f.freeze([{ id: 'order-a', totalCents: 1000 }, { id: 'order-b', totalCents: 2000 }]);
  f.intent.application_fee_amount = 40;
  await assert.rejects(f.api.finalizePaidOrderOrGroup(f.service, { orderId: 'order-a', paymentIntentId: 'pi_fixture', paymentStatus: 'paid', note: 'Unverified fee.' }), /does not match/);
  assert.ok(f.tables.orders.every(row => row.payment_status === 'pending'));
  assert.equal(f.writes.length, 0);
});

test('amount, currency, scope, metadata, partial-group and missing payment mismatches fail before fulfillment', async context => {
  const f = fixture(context);
  for (const change of [{ amount: 3001 }, { amount_received: 2999 }, { currency: 'usd' }, { status: 'processing' },
    { metadata: { billing_flow: 'customer_order', photographer_id: 'wrong-studio' } }]) {
    await f.freeze([{ id: 'order-a', totalCents: 1000 }, { id: 'order-b', totalCents: 2000 }]);
    Object.assign(f.intent, change);
    await assert.rejects(f.api.verifyDirectOrderPlatformFeePayment(f.service, { orderIds: ['order-a', 'order-b'], paymentIntentId: 'pi_fixture' }));
  }
  await f.freeze([{ id: 'order-a', totalCents: 1000 }, { id: 'order-b', totalCents: 2000 }]);
  await assert.rejects(f.api.verifyDirectOrderPlatformFeePayment(f.service, { orderIds: ['order-a'], paymentIntentId: 'pi_fixture' }));
  await assert.rejects(f.api.verifyDirectOrderPlatformFeePayment(f.service, { orderIds: ['order-a', 'order-b'] }));
  f.tables.orders[1].platform_fee_collection_method = null;
  await assert.rejects(f.api.verifyDirectOrderPlatformFeePayment(f.service, { orderIds: ['order-a', 'order-b'], paymentIntentId: 'pi_fixture' }));
  assert.equal(f.writes.length, 0);
});

test('lost or incomplete group lookups never finalize, fail or refund just the seed, including legacy orders', async context => {
  const f = fixture(context);
  for (const legacy of [false, true]) {
    for (const fault of ['seed-error', 'group-error', 'group-empty', 'group-truncated', 'group-seed-missing', 'group-duplicate']) {
      await f.freeze([{ id: 'order-a', totalCents: 1000 }, { id: 'order-b', totalCents: 2000 }]);
      if (legacy) f.tables.orders.forEach(row => { row.platform_fee_collection_method = null; });
      f.failRead(fault);
      await assert.rejects(f.api.finalizePaidOrderOrGroup(f.service, { orderId: 'order-a', paymentIntentId: 'pi_fixture', note: 'Fixture paid.' }));
      await assert.rejects(f.api.markOrderOrGroupPaymentFailure(f.service, { orderId: 'order-a', note: 'Fixture failed.' }));
      await assert.rejects(f.api.markOrderOrGroupRefunded(f.service, { orderId: 'order-a', partial: false, refundAmountCents: 3000, note: 'Fixture refunded.' }));
      assert.equal(f.writes.length, 0, `${legacy ? 'legacy' : 'direct'} ${fault}`);
      assert.equal(f.calls.length, 0);
      assert.ok(f.tables.orders.every(row => row.payment_status === 'pending'));
    }
  }
  f.failRead(null);
  assert.equal(await f.api.finalizePaidOrderOrGroup(f.service, { orderId: 'unknown-order', note: 'Unknown order remains a no-op.' }), null);
  assert.equal(f.writes.length, 0);
});

async function paidRefundFixture(context, options = {}) {
  const f = fixture(context);
  await f.freeze([{ id: 'order-a', totalCents: 1000 }, { id: 'order-b', totalCents: 2000 }], options);
  f.tables.orders.forEach(row => Object.assign(row, { status: 'paid', payment_status: 'paid', paid_at: '2026-10-07T19:00:00Z', stripe_payment_intent_id: 'pi_fixture' }));
  return f;
}

test('actual refund reconciliation closes the complete direct group only after customer and platform fees are both confirmed', async context => {
  const f = await paidRefundFixture(context);
  const result = await f.api.reconcileOrderRefundFromStripe(f.service, 'acct_fixture', 'pi_fixture');
  assert.equal(result.fullyRefunded, true);
  assert.equal(result.verifiedRefunds.length, 1);
  assert.ok(f.tables.orders.every(row => row.status === 'refunded' && row.payment_status === 'refunded'));
  assert.deepEqual(f.tables.orders.map(row => row.refund_amount_cents), [1000, 2000]);
  assert.equal(f.legacyWaivers, 0, 'a direct fee cannot become a monthly ledger credit');
  assert.ok(f.calls.every(call => call.method === 'GET'), 'reconciliation never requests a financial write');
});

test('an outstanding fee in its actual settlement currency keeps the full customer refund on hold until a read confirms the whole fee', async context => {
  const f = await paidRefundFixture(context);
  Object.assign(f.applicationFee, { currency: 'usd', amount: 32, amount_refunded: 31, refunded: false });
  assert.equal(await f.api.reconcileOrderRefundFromStripe(f.service, 'acct_fixture', 'pi_fixture'), null);
  assert.ok(f.tables.orders.every(row => row.status === 'refund_pending' && row.payment_status === 'paid'));
  assert.equal(f.legacyWaivers, 0);
  Object.assign(f.applicationFee, { amount_refunded: 32, refunded: true });
  assert.equal((await f.api.reconcileOrderRefundFromStripe(f.service, 'acct_fixture', 'pi_fixture')).fullyRefunded, true);
  assert.ok(f.tables.orders.every(row => row.status === 'refunded'));
  assert.ok(f.calls.every(call => call.method === 'GET'));
});

test('lost charge or fee reads retain a durable hold and a safe read-only retry can complete reconciliation', async context => {
  for (const path of ['charges/ch_fixture', 'application_fees/fee_fixture']) {
    const f = await paidRefundFixture(context);
    f.failProviderRead(path);
    await assert.rejects(f.api.reconcileOrderRefundFromStripe(f.service, 'acct_fixture', 'pi_fixture'), /provider read unavailable/);
    assert.ok(f.tables.orders.every(row => row.status === 'refund_pending' && row.payment_status === 'paid'));
    f.failProviderRead(null);
    assert.equal((await f.api.reconcileOrderRefundFromStripe(f.service, 'acct_fixture', 'pi_fixture')).fullyRefunded, true);
    assert.ok(f.calls.every(call => call.method === 'GET'));
  }
});

test('pending customer refunds or missing and mismatched application fee proof never close a direct group', async context => {
  const pending = await paidRefundFixture(context);
  pending.refunds[0].status = 'pending';
  assert.equal(await pending.api.reconcileOrderRefundFromStripe(pending.service, 'acct_fixture', 'pi_fixture'), null);
  assert.ok(pending.tables.orders.every(row => row.status === 'refund_pending'));
  assert.equal(pending.calls.some(call => call.path.startsWith('application_fees/')), false);
  for (const mutate of [f => { f.charge.application_fee = null; }, f => { f.charge.application_fee_amount = 40; }, f => { f.applicationFee.account = 'acct_other'; }]) {
    const f = await paidRefundFixture(context);
    mutate(f);
    await assert.rejects(f.api.reconcileOrderRefundFromStripe(f.service, 'acct_fixture', 'pi_fixture'));
    assert.ok(f.tables.orders.every(row => row.status === 'refund_pending' && row.payment_status === 'paid'));
    assert.equal(f.legacyWaivers, 0);
    assert.ok(f.calls.every(call => call.method === 'GET'));
  }
});

test('legacy full and direct partial refunds retain their previous customer-refund behavior without a new fee write', async context => {
  const legacy = await paidRefundFixture(context);
  legacy.tables.orders.forEach(row => { row.platform_fee_collection_method = null; });
  assert.equal((await legacy.api.reconcileOrderRefundFromStripe(legacy.service, 'acct_fixture', 'pi_fixture')).fullyRefunded, true);
  assert.ok(legacy.tables.orders.every(row => row.status === 'refunded'));
  assert.equal(legacy.legacyWaivers, 2);
  assert.equal(legacy.calls.some(call => call.path.startsWith('application_fees/') || call.path.startsWith('charges/')), false);
  const partial = await paidRefundFixture(context);
  partial.refunds[0].amount = 500;
  const result = await partial.api.reconcileOrderRefundFromStripe(partial.service, 'acct_fixture', 'pi_fixture');
  assert.equal(result.fullyRefunded, false);
  assert.ok(partial.tables.orders.every(row => row.status === 'paid' && row.payment_status === 'partially_refunded'));
  assert.equal(partial.legacyWaivers, 0);
  assert.ok([...legacy.calls, ...partial.calls].every(call => call.method === 'GET'));
});

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as crypto from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';
import * as pricing from '../lib/studio-pricing.ts';
import * as policy from '../lib/order-payment-policy.ts';
import * as currency from '../lib/order-currency.ts';
import * as digitalLabels from '../lib/digital-product-label.ts';

process.env.STRIPE_SECRET_KEY = 'sk_test_intercepted_webhook_fixture';
process.env.STRIPE_WEBHOOK_SECRET = 'local-fixture-secret';

function fixture({combined = false, direct = false, noStoredReferences = false} = {}) {
  const writes = [], reads = [], recorded = new Set(), sequence = [];
  const tables = {
    orders: [{id: 'order-a', photographer_id: 'studio', order_group_id: combined ? 'group' : null,
      status: 'payment_pending', payment_status: 'pending', paid_at: null, total_cents: 3000,
      total_amount: 30, currency: 'cad', package_name: 'Prints', notes: '', platform_fee_collection_method: null,
      stripe_checkout_session_id: noStoredReferences ? null : 'cs_fixture', stripe_payment_intent_id: null}],
    photographers: [{id: 'studio', stripe_connected_account_id: 'acct_fixture', stripe_account_id: null}],
    order_payment_locks: [],
  };
  if (combined) tables.orders.push({...tables.orders[0], id: 'order-b', total_cents: 2500, total_amount: 25});
  const metadata = {billing_flow: 'customer_order', photographer_id: 'studio', order_id: 'order-a', ...(combined ? {order_group_id: 'group'} : {})};
  const total = combined ? 5500 : 3000;
  let session = {id: 'cs_fixture', mode: 'payment', status: 'complete', payment_status: 'paid',
    amount_total: total, currency: 'cad', payment_intent: 'pi_fixture', client_reference_id: 'order-a', metadata: {...metadata}};
  let intent = {id: 'pi_fixture', status: 'succeeded', amount: total, amount_received: total,
    currency: 'cad', application_fee_amount: null, metadata: {...metadata}};
  let providerError = false, groupFault = null, recordError = false, failWriteId = null, onLock;
  const service = {async rpc(name, args) {
    assert.equal(name, 'acquire_order_payment_lock');
    if (tables.order_payment_locks.some(row => row.key === args.p_key)) return {data: false, error: null};
    tables.order_payment_locks.push({key: args.p_key, token: args.p_token});
    sequence.push(`lock:${args.p_key}`); onLock?.();
    return {data: true, error: null};
  }, from(table) {
    let predicates = [], values, deleting = false, selected;
    const result = single => {
      if (table === 'stripe_events') {
        if (deleting) recorded.clear();
        return {data: null, error: null};
      }
      assert.ok(table in tables, `Unexpected fixture table ${table}`);
      let rows = tables[table].filter(row => predicates.every(p => p(row))), count = rows.length;
      if (table === 'order_payment_locks' && deleting) {
        sequence.push(`unlock:${rows[0]?.key}`);
        tables.order_payment_locks = tables.order_payment_locks.filter(row => !rows.includes(row));
        return {data: null, error: null};
      }
      if (table === 'orders' && selected?.includes('total_amount') && combined && rows.length > 1) {
        if (groupFault === 'truncated') rows = rows.slice(0, 1);
        if (groupFault === 'missing-seed') {rows = rows.slice(1); count = rows.length;}
        if (groupFault === 'duplicate') rows = [rows[0], rows[0]];
      }
      if (values) {
        if (rows.some(row => row.id === failWriteId)) return {data: null, error: Error('Fixture order write interrupted'), count: null};
        if (values.status === 'paid') {
          assert.ok(tables.order_payment_locks.some(lock => lock.key === (rows[0].order_group_id || rows[0].id)), 'paid writes require the shared group/order lock');
          sequence.push(`paid:${rows[0].id}`);
        }
        writes.push({table, ids: rows.map(row => row.id), values: structuredClone(values)}); rows.forEach(row => Object.assign(row, values));
      }
      return {data: structuredClone(single ? rows[0] ?? null : rows), error: null, count};
    };
    const chain = {
      select(value) {selected = value; return chain;},
      eq(k, v) {predicates.push(row => row[k] === v); return chain;},
      in(k, v) {predicates.push(row => v.includes(row[k])); return chain;},
      is(k, v) {predicates.push(row => row[k] === v); return chain;},
      not(k, _operator, v) {const excluded = v.slice(1, -1).split(','); predicates.push(row => !excluded.includes(row[k])); return chain;},
      update(value) {values = value; return chain;}, delete() {deleting = true; return chain;}, limit() {return chain;},
      maybeSingle() {return Promise.resolve(result(true));},
      then(resolve, reject) {return Promise.resolve(result(false)).then(resolve, reject);},
    }; return chain;
  }};
  const dependencies = {
    'node:crypto': crypto,
    '@/lib/studio-pricing': pricing, '@/lib/order-payment-policy': policy, '@/lib/order-currency': currency,
    '@/lib/digital-product-label': digitalLabels,
    '@/lib/trial-config': {FREE_TRIAL_DAYS: 30},
    '@/lib/credit-maintenance': {creditMaintenanceActive: () => true, pausePlatformCreditEvent: () => false},
    '@/lib/resend': {resendConfigured: () => false},
    '@/lib/dashboard-auth': {createDashboardServiceClient: () => service},
    'next/server': {NextResponse: {json: (value, options) => Response.json(value, options)}},
  };
  function load(path) {
    const exports = {}, compiled = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText;
    new Function('require', 'exports', 'fetch', 'console', compiled)(name => dependencies[name] || {}, exports, async (url, options) => {
      assert.equal(options.method, 'GET', 'verification never charges, refunds, or creates checkout');
      assert.equal(options.headers['Stripe-Account'], 'acct_fixture');
      reads.push(new URL(url).pathname);
      if (providerError) throw new Error('Fixture provider read unavailable');
      const value = url.endsWith('/checkout/sessions/cs_fixture') ? session : url.endsWith('/payment_intents/pi_fixture') ? intent : null;
      assert.ok(value, `Unexpected provider URL ${url}`);
      return {ok: true, text: async () => JSON.stringify(value)};
    }, {error() {}, warn() {}, log() {}});
    return exports;
  }
  const payments = load('lib/payments.ts');
  dependencies['@/lib/payments'] = {...payments, verifyStripeSignature: async () => true,
    recordStripeEvent: async (_service, event) => {
      sequence.push(`record:${event.id}`);
      if (recordError) {recordError = false; throw new Error('Fixture completion recording unavailable');}
      if (recorded.has(event.id)) return {inserted: false}; recorded.add(event.id); return {inserted: true};
    }};
  if (direct) {
    const amount = 40;
    tables.orders.forEach(order => Object.assign(order, {platform_fee_collection_method: 'connect_application_fee',
      platform_fee_amount_cents: amount, platform_fee_currency: 'cad', platform_fee_rate_cents: amount}));
    const fee = payments.directOrderPlatformFeePayload(tables.orders, 'cad');
    const feeMetadata = payments.directOrderPlatformFeeMetadata(fee);
    Object.assign(session.metadata, feeMetadata); Object.assign(intent.metadata, feeMetadata);
    intent.application_fee_amount = amount * tables.orders.length;
  }
  dependencies['@/lib/order-webhook-payment'] = load('lib/order-webhook-payment.ts');
  dependencies['@/lib/order-payment-lock'] = load('lib/order-payment-lock.ts');
  const webhook = load('app/api/stripe/webhook/route.ts');
  async function invoke(type = 'checkout.session.completed', changes = {}) {
    const object = type.startsWith('checkout.') ? structuredClone(session) : structuredClone(intent);
    Object.assign(object, changes.object || {});
    return webhook.POST({headers: new Headers({'stripe-signature': 'fixture-signature'}), text: async () => JSON.stringify({
      id: changes.eventId || 'evt_fixture', type, account: changes.account || 'acct_fixture', data: {object},
    })});
  }
  return {tables, writes, reads, recorded, sequence, invoke, get session() {return session;}, get intent() {return intent;},
    failProvider() {providerError = true;}, recoverProvider() {providerError = false;}, groupFault(value) {groupFault = value;},
    failRecordOnce() {recordError = true;}, failOrderWrite(id) {failWriteId = id;}, onLock(callback) {onLock = callback;}};
}

for (const type of ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'payment_intent.succeeded']) {
  test(`${type} cannot mark another studio's legacy order paid`, async () => {
    const f = fixture(), before = structuredClone(f.tables.orders);
    assert.equal((await f.invoke(type, {account: 'acct_foreign'})).status, 500);
    assert.deepEqual(f.tables.orders, before); assert.equal(f.writes.length, 0); assert.equal(f.reads.length, 0);
  });
  for (const direct of [false, true]) test(`${type} verifies ${direct ? 'frozen-fee' : 'legacy'} combined payment before every member is finalized`, async () => {
    const f = fixture({combined: true, direct});
    assert.equal((await f.invoke(type)).status, 200);
    assert.ok(f.tables.orders.every(row => row.status === 'paid' && row.paid_at && row.stripe_payment_intent_id === 'pi_fixture'));
    assert.equal(f.writes.length, 2);
    assert.equal((await f.invoke(type)).status, 200); assert.equal(f.writes.length, 2, 'duplicate delivery cannot finalize twice');
  });
}

test('foreign failure metadata cannot regress another studio order', async () => {
  const f = fixture(), before = structuredClone(f.tables.orders);
  f.intent.status = 'requires_payment_method'; f.intent.amount_received = 0;
  assert.equal((await f.invoke('payment_intent.payment_failed', {account: 'acct_foreign'})).status, 500);
  assert.deepEqual(f.tables.orders, before); assert.equal(f.writes.length, 0);
});

test('a verified current combined decline updates all unpaid members without payment or notification', async () => {
  const f = fixture({combined: true});
  f.session.status = 'open'; f.session.payment_status = 'unpaid'; f.intent.status = 'requires_payment_method'; f.intent.amount_received = 0;
  assert.equal((await f.invoke('payment_intent.payment_failed')).status, 200);
  assert.ok(f.tables.orders.every(row => row.payment_status === 'failed' && row.paid_at === null));
  assert.equal(f.writes.length, 2);
});

test('a delayed failure event is ignored once Stripe reports the payment succeeded', async () => {
  const f = fixture();
  assert.equal((await f.invoke('payment_intent.payment_failed', {object: {status: 'requires_payment_method'}})).status, 200);
  assert.equal(f.writes.length, 0); assert.equal(f.tables.orders[0].payment_status, 'pending');
});

for (const mismatch of ['amount', 'received', 'currency', 'intent-owner', 'intent-group', 'session-owner', 'session-reference', 'saved-session', 'saved-intent', 'session-intent']) {
  test(`legacy webhook ${mismatch} mismatch leaves paid flags and references unchanged`, async () => {
    const f = fixture({combined: true});
    if (mismatch === 'amount') f.intent.amount = 100;
    if (mismatch === 'received') f.intent.amount_received = 100;
    if (mismatch === 'currency') f.intent.currency = 'usd';
    if (mismatch === 'intent-owner') f.intent.metadata.photographer_id = 'other';
    if (mismatch === 'intent-group') f.intent.metadata.order_group_id = 'other';
    if (mismatch === 'session-owner') f.session.metadata.photographer_id = 'other';
    if (mismatch === 'session-reference') f.session.client_reference_id = 'other';
    if (mismatch === 'saved-session') f.tables.orders[1].stripe_checkout_session_id = 'cs_other';
    if (mismatch === 'saved-intent') f.tables.orders[1].stripe_payment_intent_id = 'pi_other';
    if (mismatch === 'session-intent') f.session.payment_intent = 'pi_other';
    const before = structuredClone(f.tables.orders);
    assert.equal((await f.invoke()).status, 500); assert.equal(f.writes.length, 0); assert.deepEqual(f.tables.orders, before);
  });
}

for (const fault of ['truncated', 'missing-seed', 'duplicate']) test(`incomplete legacy group ${fault} cannot partially finalize`, async () => {
  const f = fixture({combined: true}); f.groupFault(fault);
  assert.equal((await f.invoke()).status, 500); assert.equal(f.writes.length, 0);
});

test('mixed studio group fails before provider reads or order writes', async () => {
  const f = fixture({combined: true}); f.tables.orders[1].photographer_id = 'other';
  assert.equal((await f.invoke()).status, 500); assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
});

test('verification outage releases webhook dedup so the same paid delivery retries safely', async () => {
  const f = fixture(); f.failProvider();
  assert.equal((await f.invoke()).status, 500); assert.equal(f.recorded.size, 0); assert.equal(f.writes.length, 0);
  f.recoverProvider(); assert.equal((await f.invoke()).status, 200); assert.equal(f.writes.length, 1);
});

test('genuine webhook arriving before session persistence remains payable and verifiable', async () => {
  const f = fixture({noStoredReferences: true});
  assert.equal((await f.invoke()).status, 200); assert.equal(f.tables.orders[0].stripe_checkout_session_id, 'cs_fixture');
});

test('legacy cent fallback and successful zero-payment sessions are retained', async () => {
  const f = fixture(); f.tables.orders[0].total_cents = null;
  assert.equal((await f.invoke()).status, 200);
  const free = fixture(); Object.assign(free.tables.orders[0], {total_cents: 0, total_amount: 0});
  Object.assign(free.session, {amount_total: 0, payment_intent: null, payment_status: 'no_payment_required'});
  assert.equal((await free.invoke()).status, 200); assert.equal(free.writes.length, 1); assert.equal(free.reads.length, 2);
});

test('genuine already-paid, canceled, and refunded orders retain their state on verified delayed delivery', async () => {
  for (const state of ['paid', 'cancelled', 'refunded']) {
    const f = fixture(); Object.assign(f.tables.orders[0], {status: state, paid_at: state === 'paid' ? '2026-10-01T00:00:00Z' : null,
      payment_status: state === 'paid' ? 'paid' : state === 'refunded' ? 'refunded' : 'pending', stripe_payment_intent_id: 'pi_fixture'});
    const before = structuredClone(f.tables.orders);
    assert.equal((await f.invoke()).status, 200); assert.deepEqual(f.tables.orders, before); assert.equal(f.writes.length, 0);
  }
});

for (const type of ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'payment_intent.succeeded']) {
  test(`${type} repairs an old event claim left behind before paid order writes`, async () => {
    const f = fixture({combined: true}); f.recorded.add('evt_fixture');
    assert.equal((await f.invoke(type)).status, 200);
    assert.ok(f.tables.orders.every(row => row.status === 'paid'));
    assert.equal(f.writes.length, 2); assert.equal(f.tables.order_payment_locks.length, 0);
    assert.ok(f.sequence.indexOf('record:evt_fixture') > f.sequence.indexOf('paid:order-b'));
  });
}

test('recording completion failure after paid flags allows a safe same-event retry', async () => {
  const f = fixture(); f.failRecordOnce();
  assert.equal((await f.invoke()).status, 500);
  assert.equal(f.tables.orders[0].status, 'paid'); assert.equal(f.recorded.size, 0);
  assert.equal(f.tables.order_payment_locks.length, 0);
  assert.equal((await f.invoke()).status, 200); assert.equal(f.writes.length, 1); assert.equal(f.recorded.size, 1);
});

test('partial combined paid writes are repaired on retry without repeating completed member writes', async () => {
  const f = fixture({combined: true}); f.failOrderWrite('order-b');
  assert.equal((await f.invoke()).status, 500);
  assert.equal(f.tables.orders[0].status, 'paid'); assert.equal(f.tables.orders[1].status, 'payment_pending');
  assert.equal(f.recorded.size, 0); assert.equal(f.tables.order_payment_locks.length, 0);
  f.failOrderWrite(null); assert.equal((await f.invoke()).status, 200);
  assert.ok(f.tables.orders.every(row => row.status === 'paid')); assert.equal(f.writes.length, 2);
});

test('concurrent session and payment events serialize on the same saved group and retry contended work', async () => {
  const f = fixture({combined: true});
  const responses = await Promise.all([
    f.invoke('checkout.session.completed', {eventId: 'evt_session'}),
    f.invoke('payment_intent.succeeded', {eventId: 'evt_intent'}),
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 500]);
  assert.equal(f.writes.length, 2); assert.equal(f.tables.order_payment_locks.length, 0);
  assert.ok(f.sequence.filter(value => value.startsWith('lock:')).every(value => value === 'lock:group'));
  assert.equal((await f.invoke('payment_intent.succeeded', {eventId: 'evt_intent'})).status, 200);
  assert.equal((await f.invoke('checkout.session.completed', {eventId: 'evt_session'})).status, 200);
  assert.equal(f.writes.length, 2);
});

test('an existing checkout/cancel/refund lock returns retryable failure before any paid write', async () => {
  const f = fixture({combined: true}); f.tables.order_payment_locks.push({key: 'group', token: 'other-action'});
  assert.equal((await f.invoke()).status, 500); assert.equal(f.writes.length, 0); assert.equal(f.recorded.size, 0);
  assert.equal(f.tables.order_payment_locks.length, 1, 'cannot release another payment action lock');
  f.tables.order_payment_locks = [];
  assert.equal((await f.invoke()).status, 200); assert.equal(f.writes.length, 2);
});

test('payment scope is freshly verified after acquiring the saved lock', async () => {
  const f = fixture({combined: true}); f.onLock(() => {f.tables.orders[1].photographer_id = 'other';});
  assert.equal((await f.invoke()).status, 500); assert.equal(f.writes.length, 0); assert.equal(f.recorded.size, 0);
  assert.deepEqual(f.sequence, ['lock:group', 'unlock:group']);
  assert.equal(f.tables.order_payment_locks.length, 0);
});

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20260930100000_order_usage_fee_ledger.sql', import.meta.url), 'utf8');
const platformFeeMigration = readFileSync(new URL('../supabase/migrations/20261007010000_order_platform_fee_collection.sql', import.meta.url), 'utf8');
const compiled = ts.transpileModule(readFileSync(new URL('../lib/order-usage-billing.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const billing = {};
new Function('require', 'exports', compiled)(name => name === 'node:crypto' ? { randomUUID } : {}, billing);

async function fixture({method = null, applyPlatformFeeMigration = true} = {}) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table photographers(id uuid primary key);
    create table orders(id uuid primary key,photographer_id uuid,paid_at timestamptz,payment_status text,
      refund_status text,is_test boolean,total_cents integer,counted_for_monthly_usage boolean default false,monthly_usage_billing_period text,
      status text,stripe_checkout_session_id text,stripe_payment_intent_id text);`);
  await db.exec(migration);
  if (applyPlatformFeeMigration) await db.exec(platformFeeMigration);
  const photographerId = randomUUID(); const orderId = randomUUID(); const now = Date.now();
  await db.query('insert into photographers values ($1)', [photographerId]);
  if (method) {
    await db.query(`insert into orders(id,photographer_id,paid_at,payment_status,total_cents,is_test,
      platform_fee_collection_method,platform_fee_amount_cents,platform_fee_currency,platform_fee_rate_cents)
      values ($1,$2,$3,'paid',1000,false,$4,$5,'cad',35)`, [orderId, photographerId, new Date(now - 60000).toISOString(), method, method === 'waived' ? 0 : 35]);
  } else {
    await db.query("insert into orders(id,photographer_id,paid_at,payment_status,total_cents,is_test) values ($1,$2,$3,'paid',1000,false)", [orderId, photographerId, new Date(now - 60000).toISOString()]);
  }
  const calls = []; const replies = new Map(); let failCompletion = false; let failAfterProvider = false;
  const stagedOrderIds = [];
  let creditReceiptOverride; let finalizedInvoice; let queuedInvoiceCreditCents = 0;
  const service = {
    from(table) {
      assert.ok(['orders', 'order_usage_fees'].includes(table));
      const predicates = []; const values = []; let changes; let sort = ''; let limit = '';
      const predicate = (key, operator, value) => { values.push(value); predicates.push(`${key}${operator}$${values.length}`); return chain; };
      const chain = {
        select() { return chain; },
        eq(key, value) { return predicate(key, '=', value); },
        is(key, value) { assert.equal(value, null); predicates.push(`${key} is null`); return chain; },
        gte(key, value) { return predicate(key, '>=', value); },
        lt(key, value) { return predicate(key, '<', value); },
        in(key, choices) { const placeholders = choices.map(value => { values.push(value); return `$${values.length}`; }); predicates.push(`${key} in (${placeholders.join(',')})`); return chain; },
        or() { predicates.push('(is_test is false or is_test is null)'); return chain; },
        order(key) { sort = ` order by ${key}`; return chain; },
        limit(count) { limit = ` limit ${count}`; return chain; },
        update(value) { changes = value; return chain; },
        then(resolve, reject) {
          let query = `select * from ${table}`;
          if (changes) {
            const sets = Object.entries(changes).map(([key, value]) => { values.push(value); return `${key}=$${values.length}`; });
            query = `update ${table} set ${sets.join(',')}`;
          }
          if (predicates.length) query += ' where ' + predicates.join(' and ');
          query += changes ? ' returning *' : sort + limit;
          return db.query(query, values).then(result => ({ data: result.rows, error: null }), error => ({ data: null, error })).then(resolve, reject);
        },
      }; return chain;
    },
    async rpc(name, args) {
      if (name === 'stage_order_usage_fee') stagedOrderIds.push(args.p_order_id);
      if (name === 'complete_order_usage_fee_report' && failCompletion) { failCompletion = false; return { data: null, error: Error('expected completion outage') }; }
      const entries = Object.entries(args);
      try {
        const result = await db.query(`select ${name}(${entries.map(([key], index) => `${key}=>$${index + 1}`).join(',')}) as result`, entries.map(([, value]) => value));
        return { data: result.rows[0].result, error: null };
      } catch (error) { return { data: null, error }; }
    },
  };
  const request = async (path, options) => {
    const params = new URLSearchParams(options.body);
    calls.push({ path, params, key: options.idempotencyKey, body: options.body.toString() });
    assert.ok(['billing/meter_events', 'invoiceitems'].includes(path), 'new refunds must never request meter cancellation');
    if (!replies.has(options.idempotencyKey)) {
      const result = path === 'billing/meter_events'
        ? { identifier: params.get('identifier'), created: Math.floor(now / 1000) }
        : { id: 'ii_credit', object: 'invoiceitem', customer: params.get('customer'), currency: params.get('currency'),
          amount: Number(params.get('amount')), invoice: null, metadata: {
            billing_flow: params.get('metadata[billing_flow]'), order_id: params.get('metadata[order_id]'),
            photographer_id: params.get('metadata[photographer_id]'), original_meter_event: params.get('metadata[original_meter_event]'),
          } };
      replies.set(options.idempotencyKey, result);
      if (path === 'invoiceitems') queuedInvoiceCreditCents -= result.amount;
    }
    if (failAfterProvider) { failAfterProvider = false; throw Error('expected lost successful response'); }
    const receipt = replies.get(options.idempotencyKey);
    return path === 'invoiceitems' && creditReceiptOverride ? creditReceiptOverride(structuredClone(receipt)) : receipt;
  };
  const input = { photographerId, customerId: 'cus_original', eventName: 'studio_os_core_order_usage', amountCents: 35, currency: 'cad',
    periodStart: new Date(now - 86400000).toISOString(), periodEnd: new Date(now + 86400000).toISOString(), billingPeriod: 'original-period' };
  return { db, service, request, input, calls, replies, orderId, now, stagedOrderIds,
    failCompletion: () => { failCompletion = true; }, failAfterProvider: () => { failAfterProvider = true; },
    overrideCreditReceipt: override => { creditReceiptOverride = override; },
    finalizeInvoice: () => { finalizedInvoice = { status: 'paid', finalizedAt: now + 60000, feeCents: 35, creditCents: 0 }; },
    invoiceState: () => ({ finalizedInvoice, queuedInvoiceCreditCents }),
    async row() { return (await db.query('select * from order_usage_fees where order_id=$1', [orderId])).rows[0]; },
    async refund(partial = false) { await db.query('update orders set payment_status=$1,refund_status=$1 where id=$2', [partial ? 'partially_refunded' : 'refunded', orderId]); },
    sync: () => billing.syncOrderUsageFees(service, input, request, now),
    reconcile: () => billing.reconcileOrderUsageFeeRefunds(service, photographerId, request, now),
  };
}

test('fees are staged atomically, retain original money snapshots and do not double charge concurrently', async () => {
  const f = await fixture();
  try {
    await Promise.all(Array.from({ length: 5 }, () => f.sync()));
    assert.equal(f.calls.length, 1);
    const row = await f.row();
    assert.equal(row.amount_cents, 35); assert.equal(row.currency, 'cad'); assert.equal(row.report_status, 'reported');
    assert.equal((await f.db.query('select counted_for_monthly_usage from orders')).rows[0].counted_for_monthly_usage, true);
    await f.db.exec('set role authenticated');
    await assert.rejects(() => f.db.query('select * from order_usage_fees'));
    await assert.rejects(() => f.db.query('select claim_order_usage_fee($1,$2,$3)', [f.orderId, 'report', randomUUID()]));
  } finally { await f.db.close(); }
});

test('lost completion recovers across renewal with the exact original event, customer and rate', async () => {
  const f = await fixture();
  try {
    f.failCompletion(); await assert.rejects(() => f.sync(), /completion outage/);
    await billing.syncOrderUsageFees(f.service, { ...f.input, periodStart: new Date(f.now + 1000).toISOString(), periodEnd: new Date(f.now + 86400000).toISOString(),
      amountCents: 25, customerId: 'cus_new', currency: 'usd', eventName: 'studio_os_studio_order_usage', billingPeriod: 'new-period' }, f.request, f.now + 3600000);
    assert.equal(f.calls.length, 2); assert.equal(f.calls[0].body, f.calls[1].body); assert.equal(f.calls[0].key, f.calls[1].key);
    assert.equal(f.replies.size, 1); assert.equal((await f.row()).billing_period, 'original-period');
  } finally { await f.db.close(); }
});

test('partial refund remains paid; a recent full refund queues one next-subscription-bill credit', async () => {
  const f = await fixture();
  try {
    await f.sync(); await f.refund(true); await f.reconcile(); assert.equal(f.calls.length, 1);
    await f.refund(); await f.reconcile(); await f.reconcile();
    assert.equal(f.calls.length, 2); assert.equal(f.calls[1].path, 'invoiceitems');
    assert.equal(f.calls[1].params.get('metadata[original_meter_event]'), f.calls[0].params.get('identifier'));
    assert.equal(f.calls[1].params.get('amount'), '-35');
    assert.equal((await f.row()).refund_status, 'completed'); assert.equal((await f.row()).refund_strategy, 'invoice_credit');
    assert.equal(f.invoiceState().queuedInvoiceCreditCents, 35);
  } finally { await f.db.close(); }
});

test('concurrent full-refund reconciliation queues only one accepted credit', async () => {
  const f = await fixture();
  try {
    await f.sync(); await f.refund(); await Promise.all(Array.from({ length: 5 }, () => f.reconcile()));
    assert.equal(f.calls.filter(call => call.path === 'invoiceitems').length, 1);
    assert.equal(f.invoiceState().queuedInvoiceCreditCents, 35); assert.equal((await f.row()).refund_status, 'completed');
  } finally { await f.db.close(); }
});

test('a recent full refund after monthly invoice finalization queues a credit without pretending to amend the paid invoice', async () => {
  const f = await fixture();
  try {
    await f.sync(); f.finalizeInvoice(); await f.refund();
    await billing.reconcileOrderUsageFeeRefunds(f.service, f.input.photographerId, f.request, f.now + 120000);
    await billing.reconcileOrderUsageFeeRefunds(f.service, f.input.photographerId, f.request, f.now + 180000);
    assert.deepEqual(f.invoiceState(), { finalizedInvoice: { status: 'paid', finalizedAt: f.now + 60000, feeCents: 35, creditCents: 0 }, queuedInvoiceCreditCents: 35 });
    assert.equal(f.calls.filter(call => call.path === 'invoiceitems').length, 1);
    assert.equal((await f.row()).refund_strategy, 'invoice_credit');
    assert.equal((await f.row()).stripe_adjustment_id, 'ii_credit');
    assert.equal((await f.row()).refund_status, 'completed', 'completion records validated queueing, not paid-invoice settlement');
  } finally { await f.db.close(); }
});

test('older full refund credits the original cents/currency once, even after changing plans', async () => {
  const f = await fixture();
  try {
    await f.sync();
    await f.db.query("update order_usage_fees set reported_at=now()-interval '3 days' where order_id=$1", [f.orderId]);
    await f.refund(); f.failAfterProvider(); await assert.rejects(() => f.reconcile(), /lost successful response/);
    assert.equal((await f.row()).refund_status, 'processing');
    await billing.syncOrderUsageFees(f.service, { ...f.input, customerId: 'cus_new', amountCents: 25, currency: 'usd',
      eventName: 'studio_os_studio_order_usage', billingPeriod: 'new-period' }, f.request, f.now + 3600000);
    await f.reconcile();
    const credits = f.calls.filter(call => call.path === 'invoiceitems');
    assert.equal(credits.length, 2); assert.equal(credits[0].body, credits[1].body);
    assert.equal(credits[0].params.get('amount'), '-35'); assert.equal(credits[0].params.get('currency'), 'cad'); assert.equal(credits[0].params.get('customer'), 'cus_original');
    assert.equal(credits[0].key, credits[1].key); assert.equal(credits[0].params.get('metadata[original_meter_event]'), (await f.row()).event_identifier);
    assert.equal((await f.row()).billing_period, 'original-period');
    assert.equal(f.replies.size, 2, 'one usage event and one adjustment were accepted');
    assert.equal(f.invoiceState().queuedInvoiceCreditCents, 35, 'a lost receipt cannot queue a second accepted credit');
  } finally { await f.db.close(); }
});

test('an uncertain next-bill credit at the 23-hour retry boundary requires review without another money request', async () => {
  const f = await fixture();
  try {
    await f.sync(); await f.refund(); f.failAfterProvider(); await assert.rejects(() => f.reconcile(), /lost successful response/);
    await f.db.query('update order_usage_fees set refund_first_attempt_at=$1 where order_id=$2', [new Date(f.now).toISOString(), f.orderId]);
    await billing.reconcileOrderUsageFeeRefunds(f.service, f.input.photographerId, f.request, f.now + 23 * 3600000);
    assert.equal(f.calls.length, 2); assert.equal(f.invoiceState().queuedInvoiceCreditCents, 35);
    assert.equal((await f.row()).refund_status, 'review_required'); assert.equal((await f.row()).stripe_adjustment_id, null);
  } finally { await f.db.close(); }
});

for (const [name, invalidate] of [
  ['null receipt', () => null],
  ['wrong object', receipt => ({ ...receipt, object: 'credit_note' })],
  ['missing ID', receipt => ({ ...receipt, id: '' })],
  ['wrong ID kind', receipt => ({ ...receipt, id: 'cn_credit' })],
  ['wrong customer', receipt => ({ ...receipt, customer: 'cus_somebody_else' })],
  ['wrong currency', receipt => ({ ...receipt, currency: 'usd' })],
  ['positive amount', receipt => ({ ...receipt, amount: 35 })],
  ['wrong original amount', receipt => ({ ...receipt, amount: -25 })],
  ['string amount', receipt => ({ ...receipt, amount: '-35' })],
  ['already attached invoice', receipt => ({ ...receipt, invoice: 'in_paid' })],
  ['missing pending-invoice field', receipt => { delete receipt.invoice; return receipt; }],
  ['missing metadata', receipt => ({ ...receipt, metadata: undefined })],
  ['wrong billing flow', receipt => ({ ...receipt, metadata: { ...receipt.metadata, billing_flow: 'credit_pack' } })],
  ['wrong order', receipt => ({ ...receipt, metadata: { ...receipt.metadata, order_id: randomUUID() } })],
  ['wrong photographer', receipt => ({ ...receipt, metadata: { ...receipt.metadata, photographer_id: randomUUID() } })],
  ['wrong original meter event', receipt => ({ ...receipt, metadata: { ...receipt.metadata, original_meter_event: 'different-event' } })],
]) {
  test(`an invalid pending invoice-item receipt (${name}) never completes the fee refund`, async () => {
    const f = await fixture();
    try {
      await f.sync(); await f.refund(); f.overrideCreditReceipt(invalidate);
      await assert.rejects(() => f.reconcile(), /unverified pending service-fee credit/);
      const row = await f.row();
      assert.equal(row.refund_status, 'processing'); assert.equal(row.stripe_adjustment_id, null); assert.equal(row.refund_completed_at, null);
      f.overrideCreditReceipt(undefined); await f.reconcile();
      assert.equal((await f.row()).refund_status, 'completed'); assert.equal(f.invoiceState().queuedInvoiceCreditCents, 35);
      assert.equal(f.calls[1].body, f.calls[2].body); assert.equal(f.calls[1].key, f.calls[2].key);
    } finally { await f.db.close(); }
  });
}

for (const status of ['processing', 'completed']) {
  test(`a legacy ${status} meter cancellation goes to review without a second cancellation or credit`, async () => {
    const f = await fixture();
    try {
      await f.sync(); await f.refund();
      const reference = `cancel:${(await f.row()).event_identifier}`;
      await f.db.query("update order_usage_fees set refund_strategy='cancel_meter_event',refund_status=$1,refund_first_attempt_at=$2,stripe_adjustment_id=$3 where order_id=$4",
        [status, new Date(f.now).toISOString(), reference, f.orderId]);
      await f.reconcile(); await f.reconcile();
      const row = await f.row();
      assert.equal(row.refund_status, 'review_required'); assert.equal(row.refund_strategy, 'cancel_meter_event'); assert.equal(row.stripe_adjustment_id, reference);
      assert.equal(f.calls.length, 1); assert.equal(f.invoiceState().queuedInvoiceCreditCents, 0);
    } finally { await f.db.close(); }
  });
}

test('uncertain requests older than Stripe idempotency retention require review instead of repeating money', async () => {
  const f = await fixture();
  try {
    f.failAfterProvider(); await assert.rejects(() => f.sync());
    await billing.syncOrderUsageFees(f.service, f.input, f.request, f.now + 86400000);
    assert.equal(f.calls.length, 1); assert.equal((await f.row()).report_status, 'review_required');
  } finally { await f.db.close(); }
});

test('a full refund before the first report waives the staged fee without a Stripe request', async () => {
  const f = await fixture();
  try {
    const result = await f.service.rpc('stage_order_usage_fee', { p_order_id: f.orderId, p_photographer_id: f.input.photographerId, p_customer_id: 'cus_original',
      p_event_name: f.input.eventName, p_usage_timestamp: Math.floor((f.now - 60000) / 1000), p_amount_cents: 35, p_currency: 'cad', p_billing_period: 'original-period' });
    assert.equal(result.error, null); await f.refund(); await f.sync();
    assert.equal(f.calls.length, 0); assert.equal((await f.row()).report_status, 'waived');
  } finally { await f.db.close(); }
});

function stageArgs(f, id = f.orderId) {
  return {p_order_id: id, p_photographer_id: f.input.photographerId, p_customer_id: f.input.customerId,
    p_event_name: f.input.eventName, p_usage_timestamp: Math.floor((f.now - 60000) / 1000),
    p_amount_cents: f.input.amountCents, p_currency: f.input.currency, p_billing_period: f.input.billingPeriod};
}

for (const method of ['connect_application_fee', 'waived']) {
  test(`${method} orders cannot enter the monthly ledger through query, RPC or refund recovery`, async () => {
    const f = await fixture({method});
    try {
      await f.sync();
      assert.deepEqual(f.stagedOrderIds, [], 'monthly selection excludes explicit collection methods before staging');
      const staged = await f.service.rpc('stage_order_usage_fee', stageArgs(f));
      assert.equal(staged.error, null); assert.equal(staged.data, null, 'a direct RPC caller cannot bypass the exclusion');
      await f.refund(); await f.reconcile(); await f.sync();
      assert.equal(f.calls.length, 0); assert.equal(await f.row(), undefined);
      const order = (await f.db.query('select * from orders where id=$1', [f.orderId])).rows[0];
      assert.equal(order.platform_fee_collection_method, method); assert.equal(order.counted_for_monthly_usage, false);
    } finally { await f.db.close(); }
  });
}

test('new collection migration preserves existing ledger snapshots, legacy retries and refund credits', async () => {
  const f = await fixture({applyPlatformFeeMigration: false});
  try {
    const staged = await f.service.rpc('stage_order_usage_fee', stageArgs(f));
    assert.equal(staged.error, null);
    const original = await f.row();
    await f.db.exec(platformFeeMigration);
    assert.deepEqual(await f.row(), original, 'migration does not rewrite the legacy ledger');
    assert.equal((await f.db.query('select platform_fee_collection_method from orders where id=$1', [f.orderId])).rows[0].platform_fee_collection_method, null);
    f.failCompletion(); await assert.rejects(() => f.sync(), /completion outage/);
    await f.sync(); await f.refund(); await f.reconcile(); await f.reconcile();
    assert.equal(f.calls.filter(call => call.path === 'billing/meter_events').length, 2);
    assert.equal(f.replies.size, 2, 'one accepted legacy charge and one accepted refund credit');
    assert.equal(f.calls.filter(call => call.path === 'invoiceitems').length, 1);
    assert.equal((await f.row()).amount_cents, original.amount_cents);
    assert.equal((await f.row()).refund_status, 'completed');
  } finally { await f.db.close(); }
});

function snapshot(id, overrides = {}) {
  return {id, platform_fee_collection_method: 'connect_application_fee', platform_fee_amount_cents: 40,
    platform_fee_currency: 'usd', platform_fee_rate_cents: 40, ...overrides};
}

async function pendingOrder(f, photographerId = f.input.photographerId) {
  const id = randomUUID();
  await f.db.query("insert into orders(id,photographer_id,total_cents,payment_status,status) values ($1,$2,1000,'pending','payment_pending')", [id, photographerId]);
  return id;
}

async function freeze(f, snapshots, photographerId = f.input.photographerId) {
  return f.db.query('select freeze_order_platform_fees($1,$2) as saved', [photographerId, JSON.stringify(snapshots)]);
}

test('combined checkout freezes nominal rates and charge currency atomically, and equal retries recover the same rows', async () => {
  const f = await fixture();
  try {
    const paidId = await pendingOrder(f), waivedId = await pendingOrder(f);
    const snapshots = [snapshot(paidId), snapshot(waivedId, {platform_fee_collection_method: 'waived', platform_fee_amount_cents: 0})];
    const saved = (await freeze(f, snapshots)).rows[0].saved;
    assert.equal(saved.length, 2);
    const paid = saved.find(row => row.id === paidId);
    assert.equal(paid.platform_fee_rate_cents, 40); assert.equal(paid.platform_fee_amount_cents, 40);
    assert.equal(paid.platform_fee_currency, 'usd');
    assert.ok(!('platform_fee_fx_rate' in paid), 'nominal local-currency fees carry no FX snapshot');
    const replayed = await Promise.all(Array.from({length: 3}, () => freeze(f, [...snapshots].reverse())));
    for (const result of replayed) assert.deepEqual(result.rows[0].saved, saved);
    await f.db.query("update orders set stripe_checkout_session_id='cs_frozen',status='checkout_starting' where id=any($1::uuid[])", [[paidId, waivedId]]);
    assert.deepEqual((await freeze(f, snapshots)).rows[0].saved.map(row => row.platform_fee_amount_cents), saved.map(row => row.platform_fee_amount_cents));
    await assert.rejects(() => freeze(f, [snapshot(paidId, {platform_fee_amount_cents: 31})]), /already frozen/);
    await f.db.query("update orders set stripe_application_fee_id='fee_verified' where id=$1", [paidId]);
    await assert.rejects(() => f.db.query("update orders set stripe_application_fee_id='fee_different' where id=$1", [paidId]), /already recorded/);
  } finally { await f.db.close(); }
});

test('a combined freeze failure rolls back all rows, rejects wrong studios, missing IDs and duplicate IDs', async () => {
  const f = await fixture();
  try {
    const first = await pendingOrder(f), second = await pendingOrder(f), foreign = await pendingOrder(f, randomUUID());
    await assert.rejects(() => freeze(f, [snapshot(first), snapshot(second, {platform_fee_amount_cents: -1})]), /orders_platform_fee_snapshot_valid/);
    assert.deepEqual((await f.db.query('select platform_fee_collection_method from orders where id=any($1::uuid[])', [[first, second]])).rows,
      [{platform_fee_collection_method: null}, {platform_fee_collection_method: null}], 'partial group cannot persist');
    await assert.rejects(() => freeze(f, [snapshot(first), snapshot(foreign)]), /belong to this studio/);
    await assert.rejects(() => freeze(f, [snapshot(first), snapshot(randomUUID())]), /belong to this studio/);
    await assert.rejects(() => freeze(f, [snapshot(first), snapshot(first)]), /Duplicate or missing/);
    await assert.rejects(() => freeze(f, [{id: first}]), /complete direct or waived/);
  } finally { await f.db.close(); }
});

test('direct collection must freeze the nominal local-currency amount instead of a converted amount', async () => {
  const f = await fixture();
  try {
    const id = await pendingOrder(f);
    await assert.rejects(() => freeze(f, [snapshot(id, {platform_fee_amount_cents: 29})]), /orders_platform_fee_snapshot_valid/);
    assert.equal((await f.db.query('select platform_fee_collection_method from orders where id=$1', [id])).rows[0].platform_fee_collection_method, null);
    assert.equal((await freeze(f, [snapshot(id)])).rows[0].saved[0].platform_fee_amount_cents, 40);
  } finally { await f.db.close(); }
});

for (const prior of ['paid', 'ledger', 'counted', 'session', 'intent', 'ambiguous', 'paid_without_timestamp', 'refunded_without_timestamp']) {
  test(`historical ${prior} orders cannot be converted to direct collection`, async () => {
    const f = await fixture();
    try {
      const id = prior === 'paid' || prior === 'ledger' ? f.orderId : await pendingOrder(f);
      if (prior === 'ledger') assert.equal((await f.service.rpc('stage_order_usage_fee', stageArgs(f))).error, null);
      if (prior === 'counted') await f.db.query('update orders set counted_for_monthly_usage=true where id=$1', [id]);
      if (prior === 'session') await f.db.query("update orders set stripe_checkout_session_id='cs_old' where id=$1", [id]);
      if (prior === 'intent') await f.db.query("update orders set stripe_payment_intent_id='pi_old' where id=$1", [id]);
      if (prior === 'ambiguous') await f.db.query("update orders set status='checkout_starting' where id=$1", [id]);
      if (prior === 'paid_without_timestamp') await f.db.query("update orders set payment_status='paid' where id=$1", [id]);
      if (prior === 'refunded_without_timestamp') await f.db.query("update orders set refund_status='refunded' where id=$1", [id]);
      await assert.rejects(() => freeze(f, [snapshot(id)]), /historical checkout/);
      assert.equal((await f.db.query('select platform_fee_collection_method from orders where id=$1', [id])).rows[0].platform_fee_collection_method, null);
    } finally { await f.db.close(); }
  });
}

test('clients cannot waive or initialize fees, invoke atomic freeze, or read the release probe', async () => {
  const f = await fixture();
  try {
    const id = await pendingOrder(f);
    await f.db.exec('grant select,insert,update on orders to authenticated; set role authenticated');
    await assert.rejects(() => freeze(f, [snapshot(id)]), /permission denied/);
    await assert.rejects(() => f.db.query('select order_platform_fee_schema_status()'), /permission denied/);
    await assert.rejects(() => f.db.query("update orders set platform_fee_collection_method='waived',platform_fee_amount_cents=0,platform_fee_rate_cents=0,platform_fee_currency='cad' where id=$1", [id]), /only be changed by Studio OS billing/);
    await assert.rejects(() => f.db.query("insert into orders(id,platform_fee_collection_method,platform_fee_amount_cents,platform_fee_rate_cents,platform_fee_currency) values ($1,'waived',0,0,'cad')", [randomUUID()]), /only be changed by Studio OS billing/);
    await f.db.query("insert into orders(id,total_cents,payment_status) values ($1,1000,'pending')", [randomUUID()]);
  } finally { await f.db.close(); }
});

test('schema probe is read-only, reports all protections, and detects a replaced legacy staging body', async () => {
  const f = await fixture();
  try {
    const count = (await f.db.query('select count(*)::int as n from orders')).rows[0].n;
    const status = (await f.db.query('select order_platform_fee_schema_status() as status')).rows[0].status;
    assert.deepEqual(status, {version: '20261007010000', columns_present: true, constraint_present: true,
      snapshot_guard_present: true, legacy_usage_guard_present: true, atomic_freeze_present: true});
    assert.equal((await f.db.query('select count(*)::int as n from orders')).rows[0].n, count);
    await f.db.exec(migration);
    assert.equal((await f.db.query('select order_platform_fee_schema_status() as status')).rows[0].status.legacy_usage_guard_present, false);
  } finally { await f.db.close(); }
});

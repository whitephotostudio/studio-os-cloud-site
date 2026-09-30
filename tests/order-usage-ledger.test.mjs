import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20260930100000_order_usage_fee_ledger.sql', import.meta.url), 'utf8');
const compiled = ts.transpileModule(readFileSync(new URL('../lib/order-usage-billing.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const billing = {};
new Function('require', 'exports', compiled)(name => name === 'node:crypto' ? { randomUUID } : {}, billing);

async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table photographers(id uuid primary key);
    create table orders(id uuid primary key,photographer_id uuid,paid_at timestamptz,payment_status text,
      refund_status text,is_test boolean,total_cents integer,counted_for_monthly_usage boolean default false,monthly_usage_billing_period text);`);
  await db.exec(migration);
  const photographerId = randomUUID(); const orderId = randomUUID(); const now = Date.now();
  await db.query('insert into photographers values ($1)', [photographerId]);
  await db.query("insert into orders(id,photographer_id,paid_at,payment_status,total_cents,is_test) values ($1,$2,$3,'paid',1000,false)", [orderId, photographerId, new Date(now - 60000).toISOString()]);
  const calls = []; const replies = new Map(); let failCompletion = false; let failAfterProvider = false;
  const service = {
    from(table) {
      assert.ok(['orders', 'order_usage_fees'].includes(table));
      const predicates = []; const values = []; let changes; let sort = ''; let limit = '';
      const predicate = (key, operator, value) => { values.push(value); predicates.push(`${key}${operator}$${values.length}`); return chain; };
      const chain = {
        select() { return chain; },
        eq(key, value) { return predicate(key, '=', value); },
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
    if (!replies.has(options.idempotencyKey)) replies.set(options.idempotencyKey, path === 'billing/meter_events'
      ? { identifier: params.get('identifier'), created: Math.floor(now / 1000) }
      : path === 'invoiceitems' ? { id: 'ii_credit' }
      : { object: 'billing.meter_event_adjustment', event_name: params.get('event_name'), type: 'cancel', status: 'pending', cancel: { identifier: params.get('cancel[identifier]') } });
    if (failAfterProvider) { failAfterProvider = false; throw Error('expected lost successful response'); }
    return replies.get(options.idempotencyKey);
  };
  const input = { photographerId, customerId: 'cus_original', eventName: 'studio_os_core_order_usage', amountCents: 35, currency: 'cad',
    periodStart: new Date(now - 86400000).toISOString(), periodEnd: new Date(now + 86400000).toISOString(), billingPeriod: 'original-period' };
  return { db, service, request, input, calls, replies, orderId, now,
    failCompletion: () => { failCompletion = true; }, failAfterProvider: () => { failAfterProvider = true; },
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

test('partial refund remains a paid order, full refund cancels recent metering once', async () => {
  const f = await fixture();
  try {
    await f.sync(); await f.refund(true); await f.reconcile(); assert.equal(f.calls.length, 1);
    await f.refund(); await f.reconcile(); await f.reconcile();
    assert.equal(f.calls.length, 2); assert.equal(f.calls[1].path, 'billing/meter_event_adjustments');
    assert.equal(f.calls[1].params.get('cancel[identifier]'), f.calls[0].params.get('identifier'));
    assert.equal((await f.row()).refund_status, 'completed');
  } finally { await f.db.close(); }
});

test('older full refund credits the original cents/currency once, even after changing plans', async () => {
  const f = await fixture();
  try {
    await f.sync();
    await f.db.query("update order_usage_fees set reported_at=now()-interval '3 days' where order_id=$1", [f.orderId]);
    await f.refund(); f.failAfterProvider(); await assert.rejects(() => f.reconcile(), /lost successful response/);
    await f.reconcile(); await f.reconcile();
    const credits = f.calls.filter(call => call.path === 'invoiceitems');
    assert.equal(credits.length, 2); assert.equal(credits[0].body, credits[1].body);
    assert.equal(credits[0].params.get('amount'), '-35'); assert.equal(credits[0].params.get('currency'), 'cad'); assert.equal(credits[0].params.get('customer'), 'cus_original');
    assert.equal(f.replies.size, 2, 'one usage event and one adjustment were accepted');
  } finally { await f.db.close(); }
});

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

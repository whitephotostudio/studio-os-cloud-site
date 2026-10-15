import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import * as pricing from '../lib/studio-pricing.ts';
import * as periods from '../lib/stripe-billing-period.ts';
import * as orderPolicy from '../lib/order-payment-policy.ts';
import * as maintenance from '../lib/credit-maintenance.ts';
import { canonicalCheckoutJson } from '../lib/checkout-attempt.ts';
import { sumStoredOrderTotalsCents } from '../lib/order-checkout-totals.ts';
import { parentGalleryEntryFixture } from './fixtures/parent-gallery-entry.mjs';

function load(path, modules = {}, fetch = () => assert.fail('Unexpected external provider call')) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', 'fetch', compiled)(name => modules[name] ?? {}, exports, fetch);
  return exports;
}

// This adapter executes every payment write, trigger, claim and outbox RPC in
// PostgreSQL. Fault injection changes only whether a database response arrives.
async function fixture({ failure = null, combined = false, loseProviderResponse = false, providerAmountDelta = 0 } = {}) {
  const db = new PGlite();
  const owner = crypto.randomUUID(), project = crypto.randomUUID(), group = combined ? crypto.randomUUID() : null;
  const ids = [crypto.randomUUID(), ...(combined ? [crypto.randomUUID()] : [])];
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table photographers(id uuid primary key,user_id uuid,business_name text,billing_email text,studio_email text,
      studio_phone text,studio_address text,logo_url text,stripe_account_id text,stripe_connected_account_id text);
    create table projects(id uuid primary key,title text,photographer_id uuid,access_pin text);
    create table schools(id uuid primary key,school_name text,photographer_id uuid);
    create table students(id uuid primary key,first_name text,last_name text,pin text,school_id uuid);
    create table orders(id uuid primary key,photographer_id uuid,order_group_id uuid,project_id uuid,school_id uuid,student_id uuid,
      customer_name text,parent_name text,customer_email text,parent_email text,parent_phone text,
      package_name text,currency text default 'cad',total_cents integer,total_amount numeric,subtotal_cents integer,tax_cents integer,
      status text default 'payment_pending',payment_status text default 'pending',paid_at timestamptz,
      refund_status text,refund_amount_cents integer default 0,notes text,special_notes text,cart_snapshot jsonb default '[]',
      stripe_checkout_session_id text,stripe_payment_intent_id text,counted_for_monthly_usage boolean default false,
      monthly_usage_billing_period text,seen_by_photographer boolean,
      created_at timestamptz default now(),updated_at timestamptz default now()-interval '5 minutes');
    create table order_items(id uuid primary key default gen_random_uuid(),order_id uuid references orders(id),
      product_name text,quantity integer,unit_price_cents integer,line_total_cents integer,sku text);
    create table stripe_events(id text primary key,event_type text,stripe_account text,livemode boolean,payload jsonb);
  `);
  await db.query("insert into photographers(id,business_name,billing_email,studio_email,stripe_connected_account_id) values($1,'Integration Studio','owner@example.test','studio@example.test','acct_integration')", [owner]);
  await db.query("insert into projects values($1,'Original event',$2,'private-event-pin')", [project, owner]);
  for (const path of ['20261005004000_paid_order_email_outbox.sql', '20261005005000_customer_order_webhook_recovery.sql']) {
    await db.exec(readFileSync(new URL(`../supabase/migrations/${path}`, import.meta.url), 'utf8'));
  }
  const insertOrder = async (id, sessionId = 'cs_integration', orderGroup = group) => {
    await db.query(`insert into orders(id,photographer_id,order_group_id,project_id,parent_name,parent_email,customer_email,
      package_name,total_cents,total_amount,subtotal_cents,tax_cents,stripe_checkout_session_id)
      values($1,$2,$3,$4,'Original Parent','buyer@example.test','buyer@example.test','8x10 print',2900,29,2900,0,$5)`, [id, owner, orderGroup, project, sessionId]);
    await db.query("insert into order_items(order_id,product_name,quantity,unit_price_cents,line_total_cents,sku) values($1,'8x10 print',1,2900,2900,'private/saved-photo.jpg')", [id]);
  };
  for (const id of ids) await insertOrder(id);
  const databaseCalls = [];
  const allowedTables = new Set(['orders', 'photographers', 'stripe_events', 'customer_order_webhooks', 'paid_order_emails']);
  const service = {
    from(table) {
      databaseCalls.push(`table:${table}`);
      assert.ok(allowedTables.has(table), `Unexpected business table ${table}`);
      const predicates = [], sorts = [], values = [];
      let changes, insert, count = false, limit;
      const column = key => { assert.match(key, /^[a-z_]+$/); return `"${key}"`; };
      const bind = value => { values.push(value); return `$${values.length}`; };
      const chain = {
        select(_fields, options) { count = !!options?.count; return chain; },
        update(value) { changes = value; return chain; },
        insert(value) { insert = value; return chain; },
        eq(key, value) { predicates.push(`${column(key)}=${bind(value)}`); return chain; },
        in(key, list) { predicates.push(list.length ? `${column(key)} in (${list.map(bind).join(',')})` : 'false'); return chain; },
        lte(key, value) { predicates.push(`${column(key)}<=${bind(value)}`); return chain; },
        is(key, value) { assert.equal(value, null); predicates.push(`${column(key)} is null`); return chain; },
        order(key, options) { sorts.push(`${column(key)} ${options?.ascending === false ? 'desc' : 'asc'}`); return chain; },
        limit(value) { limit = value; return chain; },
        maybeSingle() { return run(true); },
        then(resolve, reject) { return run(false).then(resolve, reject); },
      };
      async function run(single) {
        const paidWrite = table === 'orders' && changes?.payment_status === 'paid';
        if (paidWrite && failure === 'before-paid') { failure = null; throw new Error('Database response failed before paid commit'); }
        try {
          let query;
          if (insert) query = `insert into ${table}(${Object.keys(insert).map(column)}) values(${Object.values(insert).map(bind)}) returning *`;
          else if (changes) query = `update ${table} set ${Object.entries(changes).map(([key, value]) => `${column(key)}=${bind(value)}`).join(',')}${predicates.length ? ` where ${predicates.join(' and ')}` : ''} returning *`;
          else query = `select * from ${table}${predicates.length ? ` where ${predicates.join(' and ')}` : ''}${sorts.length ? ` order by ${sorts.join(',')}` : ''}`;
          let rows = (await db.query(query, values)).rows;
          if (paidWrite && failure === 'after-paid') { failure = null; throw new Error('Database response lost after paid and outbox commit'); }
          const fullCount = rows.length;
          if (limit !== undefined) rows = rows.slice(0, limit);
          return { data: single ? rows[0] ?? null : rows, error: null, count: count ? fullCount : null };
        } catch (error) { return { data: null, error, count: null }; }
      }
      return chain;
    },
    async rpc(name, p) {
      databaseCalls.push(`rpc:${name}`);
      if (name === 'resolve_order_payment_account') return { data: null, error: { code: 'PGRST202' } };
      const calls = {
        claim_customer_order_webhook: ['select claim_customer_order_webhook($1,$2,$3,$4,$5,$6,$7) value', [p.p_event_id, p.p_order_id, p.p_account, p.p_event_type, p.p_payload_hash, p.p_payload, p.p_token], true],
        finish_customer_order_webhook: ['select finish_customer_order_webhook($1,$2,$3) value', [p.p_event_id, p.p_token, p.p_result], true],
        ensure_paid_order_emails: ['select * from ensure_paid_order_emails($1)', [p.p_order_id]],
        claim_paid_order_emails: ['select * from claim_paid_order_emails($1,$2)', [p.p_ids, p.p_limit]],
        prepare_paid_order_email: ['select * from prepare_paid_order_email($1,$2,$3)', [p.p_id, p.p_lease_token, p.p_payload]],
        release_paid_order_email_worker: ['select release_paid_order_email_worker($1)', [p.p_lease_token]],
      };
      assert.ok(name in calls, `Unexpected RPC ${name}`);
      try {
        const [sql, args, scalar] = calls[name];
        const result = await db.query(sql, args);
        return { data: scalar ? result.rows[0].value : result.rows, error: null };
      } catch (error) { return { data: null, error }; }
    },
  };
  const deferred = [], providerCalls = [], providerReceipts = new Map();
  const resend = load('lib/resend.ts', {}, async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    const key = options.headers['Idempotency-Key'], body = options.body;
    providerCalls.push({ key, body });
    if (providerReceipts.has(key)) assert.equal(body, providerReceipts.get(key).body, 'Retries preserve the actual serialized provider request');
    else providerReceipts.set(key, { body, id: `email_${providerReceipts.size + 1}` });
    if (loseProviderResponse) { loseProviderResponse = false; throw new Error('Provider accepted; response lost'); }
    return Response.json({ id: providerReceipts.get(key).id });
  });
  const photoUrls = load('lib/photo-url.ts');
  const media = load('lib/private-media-references.ts', {
    '@/lib/r2-signed-urls': load('lib/r2-signed-urls.ts', { crypto }),
    '@/lib/photo-url': photoUrls,
    '@/lib/legacy-storage-token': load('lib/legacy-storage-token.ts', { 'node:crypto': crypto, '@/lib/photo-url': photoUrls }),
    '@/lib/r2-media-token': load('lib/r2-media-token.ts', { 'node:crypto': crypto, '@/lib/r2-access-security': load('lib/r2-access-security.ts') }),
  });
  const builderModules = { './order-display': load('lib/order-display.ts'), './private-media-references': media };
  const emails = load('lib/paid-order-emails.ts', {
    'node:timers/promises': { setTimeout: async () => {} },
    'next/server': { after: callback => deferred.push(callback) },
    '@/lib/order-notification-email': load('lib/order-notification-email.ts', builderModules),
    '@/lib/order-receipt-email': load('lib/order-receipt-email.ts', builderModules),
    '@/lib/digital-delivery': { buildDigitalDeliveryEmailForOrder: () => assert.fail('Print orders must not invoke digital delivery') },
    '@/lib/resend': resend, '@/lib/parent-gallery-entry': parentGalleryEntryFixture(),
    '@/lib/pin-recovery': parentGalleryEntryFixture(),
  });
  const accountHistory = load('lib/stripe-connect-history.ts');
  const payments = load('lib/payments.ts', {
    'node:crypto': crypto, '@/lib/studio-pricing': pricing, '@/lib/stripe-billing-period': periods,
    '@/lib/order-payment-policy': orderPolicy, '@/lib/trial-config': { FREE_TRIAL_DAYS: 30 },
    '@/lib/subscription-access': load('lib/subscription-access.ts', { '@/lib/studio-pricing': pricing, '@/lib/trial-config': { FREE_TRIAL_DAYS: 30 } }),
    '@/lib/order-usage-billing': load('lib/order-usage-billing.ts', { 'node:crypto': crypto }),
    '@/lib/credit-maintenance': maintenance, '@/lib/paid-order-emails': emails, '@/lib/resend': resend,
    '@/lib/order-push': { sendNewOrderPush: async () => {} },
    '@/lib/digital-product-label': load('lib/digital-product-label.ts'),
    '@/lib/stripe-connect-history': accountHistory,
  });
  // Use the real payment verifier and finalizer. Only external provider reads
  // and the lease transport are synthetic; all outbox/claim writes use SQL.
  const providerReads = [], lockKeys = [], activeLocks = new Set();
  async function savedProviderPayment(sessionId, accountId) {
    assert.equal(accountId, 'acct_integration');
    const { rows } = await db.query('select * from orders where stripe_checkout_session_id=$1 order by id', [sessionId]);
    assert.ok(rows.length, 'Provider fixture must correspond to a saved checkout');
    assert.ok(rows.every(row => row.photographer_id === owner && row.order_group_id === rows[0].order_group_id));
    return { amount: rows.reduce((sum, row) => sum + row.total_cents, 0) + providerAmountDelta,
      metadata: { billing_flow: 'customer_order', photographer_id: owner, order_id: rows[0].id,
        ...(rows[0].order_group_id ? { order_group_id: rows[0].order_group_id } : {}) } };
  }
  const providerPayments = {
    ...payments,
    async retrieveCheckoutSession(sessionId, accountId) {
      providerReads.push(['session', sessionId]);
      const saved = await savedProviderPayment(sessionId, accountId);
      return { id: sessionId, mode: 'payment', status: 'complete', payment_status: 'paid', currency: 'cad',
        amount_total: saved.amount, payment_intent: `pi_${sessionId}`, metadata: saved.metadata };
    },
    async retrievePaymentIntent(intentId, accountId) {
      providerReads.push(['intent', intentId]);
      assert.ok(intentId.startsWith('pi_cs_'));
      const saved = await savedProviderPayment(intentId.slice(3), accountId);
      return { id: intentId, status: 'succeeded', currency: 'cad', amount: saved.amount,
        amount_received: saved.amount, metadata: saved.metadata };
    },
  };
  const verifier = load('lib/order-webhook-payment.ts', { '@/lib/payments': providerPayments, '@/lib/stripe-connect-history': accountHistory });
  const lock = { async lockOrderPayment(lockedService, key) {
    assert.equal(lockedService, service);
    const { rows } = await db.query('select id,photographer_id from orders where coalesce(order_group_id,id)=$1', [key]);
    assert.ok(rows.length > 0 && rows.every(row => row.photographer_id === owner), 'Lock key must bind the exact saved order/group');
    assert.equal(activeLocks.has(key), false, 'One worker may own an order/group lease at a time');
    activeLocks.add(key); lockKeys.push(key);
    return async () => { assert.equal(activeLocks.delete(key), true, 'Every payment lock must be released exactly once'); };
  } };
  const customer = load('lib/customer-order-webhook.ts', {
    'node:crypto': crypto, '@/lib/payments': providerPayments,
    '@/lib/order-webhook-payment': verifier, '@/lib/order-payment-lock': lock,
    '@/lib/checkout-attempt': { canonicalCheckoutJson }, '@/lib/order-checkout-totals': { sumStoredOrderTotalsCents },
    '@/lib/stripe-connect-history': accountHistory,
  });
  const route = load('app/api/stripe/webhook/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/customer-order-webhook': customer, '@/lib/payments': payments, '@/lib/credit-maintenance': maintenance,
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => service },
    '@/lib/stripe-merchant-webhook': load('lib/stripe-merchant-webhook.ts', {
      'node:crypto':crypto,'@/lib/checkout-attempt':{canonicalCheckoutJson},'@/lib/stripe-connect-history':accountHistory,
      '@/lib/payments':providerPayments,
    }),
  });
  const event = (seed = ids[0], session = 'cs_integration', orderGroup = group, eventId = 'evt_integration') => ({
    id: eventId, account: 'acct_integration', type: 'checkout.session.completed', livemode: false,
    data: { object: { id: session, payment_intent: `pi_${session}`, payment_status: 'paid', currency: 'cad', amount_total: orderGroup ? 5800 : 2900,
      metadata: { billing_flow: 'customer_order', order_id: seed, photographer_id: owner, ...(orderGroup ? { order_group_id: orderGroup } : {}) } } },
  });
  const post = async (payload = event(), valid = true) => {
    const raw = JSON.stringify(payload), timestamp = Math.floor(Date.now() / 1000);
    const digest = crypto.createHmac('sha256', valid ? process.env.STRIPE_WEBHOOK_SECRET : 'wrong-secret').update(`${timestamp}.${raw}`).digest('hex');
    return route.POST({ headers: new Headers({ 'stripe-signature': `t=${timestamp},v1=${digest}` }), text: async () => raw });
  };
  return { db, owner, ids, group, deferred, databaseCalls, providerCalls, providerReceipts, insertOrder, event, post, service, customer, emails, providerReads, lockKeys, activeLocks };
}

async function run(options, callback) {
  const names = ['STUDIO_CREDIT_MAINTENANCE', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'STRIPE_WEBHOOK_SECRET', 'R2_MEDIA_TOKEN_SECRET', 'LEGACY_STORAGE_TOKEN_SECRET'];
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { STUDIO_CREDIT_MAINTENANCE: '1', RESEND_API_KEY: 'integration-provider-fixture', RESEND_FROM_EMAIL: 'sender@example.test', STRIPE_WEBHOOK_SECRET: 'integration-signature-fixture', R2_MEDIA_TOKEN_SECRET: 'integration-r2-media-fixture', LEGACY_STORAGE_TOKEN_SECRET: 'integration-legacy-media-fixture' });
  const f = await fixture(options);
  try { await callback(f); } finally {
    await f.db.close();
    for (const name of names) { if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name]; }
  }
}

for (const failure of ['before-paid', 'after-paid']) test(`signed webhook → real finalizer → SQL outbox survives ${failure} interruption`, () => run({ failure }, async f => {
  assert.equal((await f.post()).status, 503);
  const firstJobs = (await f.db.query('select * from paid_order_emails')).rows;
  assert.equal(firstJobs.length, failure === 'before-paid' ? 0 : 2, 'Paid mutation and email staging share one committed transaction');
  assert.equal(f.deferred.length, 0, 'Recovery must survive death before post-response scheduling');
  assert.equal((await f.post()).status, 200);
  assert.equal((await f.post()).status, 200);
  const orders = (await f.db.query('select * from orders')).rows;
  assert.equal(orders[0].payment_status, 'paid'); assert.ok(orders[0].paid_at);
  assert.equal(orders[0].stripe_payment_intent_id, 'pi_cs_integration');
  assert.ok(f.providerReads.some(([kind]) => kind === 'session') && f.providerReads.some(([kind]) => kind === 'intent'));
  assert.ok(f.lockKeys.length >= 2);
  assert.ok(f.lockKeys.every(key => key === f.ids[0]));
  assert.equal(f.activeLocks.size, 0);
  const jobs = (await f.db.query('select * from paid_order_emails order by kind')).rows;
  assert.equal(jobs.length, 2);
  assert.ok(jobs.every(row => row.snapshot.items[0].sku === 'private/saved-photo.jpg'));
  if (firstJobs.length) assert.deepEqual(jobs.map(row => row.id).sort(), firstJobs.map(row => row.id).sort());
  assert.equal((await f.db.query('select count(*)::int n from stripe_events')).rows[0].n, 1);
  assert.equal((await f.db.query('select status from customer_order_webhooks')).rows[0].status, 'processed');
  assert.deepEqual(await f.emails.deliverPaidOrderEmails(f.service), { sent: 2, failed: 0, deferred: 0 });
  assert.equal(f.providerReceipts.size, 2);
  assert.equal((await f.db.query("select count(*)::int n from paid_order_emails where status='sent'")).rows[0].n, 2);
}));

test('real combined finalization recovers a partially committed group without duplicating paid jobs', () => run({ combined: true, failure: 'after-paid' }, async f => {
  assert.equal((await f.post()).status, 503);
  assert.equal((await f.db.query("select count(*)::int n from orders where paid_at is not null")).rows[0].n, 2);
  const before = (await f.db.query('select id from paid_order_emails order by id')).rows;
  assert.equal(before.length, 4);
  assert.equal((await f.post()).status, 200);
  assert.deepEqual((await f.db.query('select id from paid_order_emails order by id')).rows, before);
  assert.deepEqual(await f.emails.deliverPaidOrderEmails(f.service), { sent: 4, failed: 0, deferred: 0 });
  assert.equal(f.providerReceipts.size, 4);
  assert.ok(f.lockKeys.every(key => key === f.group), 'Combined finalization locks the shared group, never a single member');
  assert.equal(f.activeLocks.size, 0);
}));

test('real outbox dispatcher retries a lost provider response using its committed frozen request', () => run({ loseProviderResponse: true }, async f => {
  assert.equal((await f.post()).status, 200);
  assert.deepEqual(await f.emails.deliverPaidOrderEmails(f.service), { sent: 1, failed: 1, deferred: 0 });
  await f.db.exec("update paid_order_emails set next_attempt_at=now() where status='pending'");
  assert.deepEqual(await f.emails.deliverPaidOrderEmails(f.service), { sent: 1, failed: 0, deferred: 0 });
  assert.equal(f.providerCalls.length, 3); assert.equal(f.providerReceipts.size, 2);
  assert.equal((await f.db.query("select count(*)::int n from paid_order_emails where status='sent'")).rows[0].n, 2);
}));

test('real signature validation and connected-account checks prevent unauthorized paid commits and outbox work', () => run({}, async f => {
  assert.equal((await f.post(f.event(), false)).status, 400);
  assert.equal((await f.db.query('select count(*)::int n from customer_order_webhooks')).rows[0].n, 0);
  assert.equal((await f.post({ ...f.event(), account: 'acct_other' })).status, 400);
  assert.equal((await f.db.query('select count(*)::int n from paid_order_emails')).rows[0].n, 0);
  assert.equal((await f.db.query('select paid_at from orders')).rows[0].paid_at, null);
}));

test('real provider verification rejects a signed event when the retrieved checkout amount differs from saved SQL orders', () => run({ providerAmountDelta: 1 }, async f => {
  assert.equal((await f.post()).status, 503);
  assert.equal((await f.db.query('select paid_at from orders')).rows[0].paid_at, null);
  assert.equal((await f.db.query('select count(*)::int n from paid_order_emails')).rows[0].n, 0);
  assert.equal(f.providerReads.length, 1, 'The real verifier inspects provider checkout before acquiring a payment lease');
  assert.equal(f.lockKeys.length, 0);
}));

test('1000 signed webhooks execute real payment finalization and stage exactly 2000 SQL outbox jobs', () => run({}, async f => {
  const events = [];
  for (let index = 0; index < 1000; index++) {
    const id = crypto.randomUUID(), session = `cs_integrated_${index}`;
    await f.insertOrder(id, session, null);
    events.push(f.event(id, session, null, `evt_integrated_${index}`));
  }
  for (let index = 0; index < events.length; index += 10) {
    const results = await Promise.all(events.slice(index, index + 10).map(event => f.post(event)));
    assert.ok(results.every(result => result.status === 200));
  }
  for (const event of events.slice(0, 20)) assert.equal((await f.post(event)).status, 200);
  assert.equal((await f.db.query("select count(*)::int n from orders where paid_at is not null")).rows[0].n, 1000);
  assert.equal((await f.db.query("select count(*)::int n from customer_order_webhooks where status='processed'")).rows[0].n, 1000);
  assert.equal((await f.db.query('select count(*)::int n from stripe_events')).rows[0].n, 1000);
  assert.equal((await f.db.query('select count(*)::int n from paid_order_emails')).rows[0].n, 2000);
  assert.equal((await f.db.query("select count(*)::int n from paid_order_emails where snapshot->'items'->0->>'sku'='private/saved-photo.jpg'")).rows[0].n, 2000);
  assert.equal(f.deferred.length, 1000); assert.equal(f.providerCalls.length, 0, 'Payment completion does not await email provider delivery');
}));


test('real signed unrelated Standard payments are acknowledged without UUID queries or even an installed paid-email outbox',()=>run({},async f=>{
  await f.db.exec('drop table paid_order_emails cascade');
  for(const billing_flow of [undefined,null,'merchant_external']) {
    for(const order_id of ['external-invoice-not-uuid',f.ids[0]]) {
      const event=f.event();
      event.data.object.metadata={billing_flow,order_id,photographer_id:f.owner};
      const response=await f.post(event);
      assert.equal(response.status,200);assert.equal((await response.json()).ignored,true);
      assert.deepEqual(f.databaseCalls,[]);assert.deepEqual(f.providerReads,[]);assert.deepEqual(f.providerCalls,[]);
      assert.deepEqual(f.lockKeys,[]);assert.deepEqual(f.deferred,[]);
    }
  }
  assert.equal((await f.db.query('select count(*)::int n from customer_order_webhooks')).rows[0].n,0);
  assert.equal((await f.db.query('select count(*)::int n from stripe_events')).rows[0].n,0);
  assert.equal((await f.db.query('select payment_status from orders')).rows[0].payment_status,'pending');
  const invalid=f.event();invalid.data.object.metadata={order_id:'external-invoice-not-uuid'};
  assert.equal((await f.post(invalid,false)).status,400,'Unrelated events still require a genuine signature');
  assert.deepEqual(f.databaseCalls,[]);
}));

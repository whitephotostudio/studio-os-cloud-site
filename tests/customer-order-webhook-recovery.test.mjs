import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { canonicalCheckoutJson } from "../lib/checkout-attempt.ts";
import { sumStoredOrderTotalsCents } from "../lib/order-checkout-totals.ts";

const migration = readFileSync(new URL("../supabase/migrations/20261005005000_customer_order_webhook_recovery.sql", import.meta.url), "utf8");
function load(path, modules) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)(name => {
    if (!(name in modules)) throw new Error(`Unexpected dependency ${name}`);
    return modules[name];
  }, exports);
  return exports;
}

async function fixture(options = {}) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table photographers(id uuid primary key,stripe_connected_account_id text,stripe_account_id text);
    create table orders(id uuid primary key,photographer_id uuid,order_group_id uuid,total_cents integer,total_amount numeric,currency text,
      stripe_checkout_session_id text,stripe_payment_intent_id text,status text default 'payment_pending',payment_status text default 'pending',
      paid_at timestamptz,updated_at timestamptz default now()-interval '5 minutes');`);
  await db.exec(migration);
  const owner = crypto.randomUUID(), group = options.combined ? crypto.randomUUID() : null, orderId = crypto.randomUUID();
  const ids = [orderId, ...(group ? [crypto.randomUUID()] : [])];
  await db.query("insert into photographers values($1,'acct_fixture',null)", [owner]);
  for (const id of ids) await db.query("insert into orders(id,photographer_id,order_group_id,total_cents,currency,stripe_checkout_session_id) values($1,$2,$3,2900,'cad','cs_fixture')", [id, owner, group]);
  const calls = [], receipts = new Set(), providerReads = [], history = new Set();
  let failure = options.failure, truncate = options.truncate;
  const service = {
    from(table) {
      assert.ok(["orders", "photographers", "customer_order_webhooks"].includes(table));
      const predicates = [], values = [], sorts = [];
      let maxRows, exactCount = false;
      const column = key => { assert.match(key, /^[a-z_]+$/); return `"${key}"`; };
      const bind = value => { values.push(value); return `$${values.length}`; };
      const chain = {
        select(_columns, opts) { exactCount = !!opts?.count; return chain; },
        eq(key, value) { predicates.push(`${column(key)}=${bind(value)}`); return chain; },
        in(key, list) { predicates.push(list.length ? `${column(key)} in (${list.map(bind).join(",")})` : "false"); return chain; },
        lte(key, value) { predicates.push(`${column(key)}<=${bind(value)}`); return chain; },
        is(key, value) { assert.equal(value, null); predicates.push(`${column(key)} is null`); return chain; },
        not(key, operation, value) { assert.equal(operation, "is"); assert.equal(value, null); predicates.push(`${column(key)} is not null`); return chain; },
        order(key, opts) { sorts.push(`${column(key)} ${opts?.ascending === false ? "desc" : "asc"}`); return chain; },
        limit(limit) { maxRows = limit; return chain; },
        maybeSingle() { return run(true); },
        then(resolve, reject) { return run(false).then(resolve, reject); },
      };
      async function run(single) {
        let rows = (await db.query(`select * from ${table}${predicates.length ? ` where ${predicates.join(" and ")}` : ""}${sorts.length ? ` order by ${sorts.join(",")}` : ""}`, values)).rows;
        const count = exactCount ? rows.length : null;
        if (truncate && exactCount && rows.length > 1) rows = rows.slice(0, 1);
        if (maxRows !== undefined) rows = rows.slice(0, maxRows);
        return { data: single ? rows[0] ?? null : rows, error: null, count };
      }
      return chain;
    },
    async rpc(name, params) {
      try {
        let result;
        if (name === "claim_customer_order_webhook") result = await db.query("select claim_customer_order_webhook($1,$2,$3,$4,$5,$6,$7) as value", [params.p_event_id, params.p_order_id, params.p_account, params.p_event_type, params.p_payload_hash, JSON.stringify(params.p_payload), params.p_token]);
        else if (name === "finish_customer_order_webhook") {
          if (failure === "finish") { failure = null; return { data: null, error: { message: "fixture completion write failed" } }; }
          result = await db.query("select finish_customer_order_webhook($1,$2,$3) as value", [params.p_event_id, params.p_token, params.p_result]);
        } else if (name === "claim_pending_customer_order_payment_checks") {
          return { data: (await db.query("select * from claim_pending_customer_order_payment_checks($1)", [params.p_limit])).rows, error: null };
        } else assert.fail(`Unexpected RPC ${name}`);
        return { data: result.rows[0].value, error: null };
      } catch (error) { return { data: null, error }; }
    },
  };
  const payments = {
    getConnectedAccountId: row => row.stripe_connected_account_id || row.stripe_account_id,
    async finalizePaidOrderOrGroup(_service, input) {
      calls.push(input);
      if (options.finalizerNull) return null;
      if (failure === "before-paid") { failure = null; throw new Error("fixture termination before paid commit"); }
      const seed = (await db.query("select * from orders where id=$1", [input.orderId])).rows[0];
      const targets = (await db.query(seed.order_group_id ? "select * from orders where order_group_id=$1" : "select * from orders where id=$1", [seed.order_group_id || seed.id])).rows;
      for (const target of targets) {
        if (options.incompleteGroup && target.id !== seed.id) continue;
        await db.query("update orders set status='paid',payment_status='paid',paid_at=now(),stripe_payment_intent_id=$2 where id=$1", [target.id, input.paymentIntentId]);
        receipts.add(target.id); // Idempotent paid-commit outbox fixture.
      }
      if (failure === "after-paid") { failure = null; throw new Error("fixture termination after paid commit"); }
      return seed;
    },
    async markOrderOrGroupPaymentFailure(_service, input) { calls.push({ failed: input }); },
    async recordStripeEvent(_service, event) { const inserted = !history.has(event.id); history.add(event.id); return { inserted }; },
    async retrieveCheckoutSession(sessionId, account) {
      providerReads.push({ sessionId, account });
      assert.equal(account, "acct_fixture");
      if (options.providerUnavailable) throw new Error("fixture Stripe outage");
      return { ...event.data.object, ...(options.sessionOverrides ?? {}) };
    },
  };
  const api = load("lib/customer-order-webhook.ts", {
    "node:crypto": crypto, "@/lib/checkout-attempt": { canonicalCheckoutJson },
    "@/lib/order-checkout-totals": { sumStoredOrderTotalsCents }, "@/lib/payments": payments,
  });
  const event = {
    id: "evt_fixture", type: "checkout.session.completed", account: "acct_fixture", livemode: false,
    data: { object: { id: "cs_fixture", payment_intent: "pi_fixture", payment_status: "paid", amount_total: 2900 * ids.length, currency: "cad",
      metadata: { order_id: orderId, photographer_id: owner, ...(group ? { order_group_id: group } : {}) } } },
  };
  const claim = token => service.rpc("claim_customer_order_webhook", {
    p_event_id: event.id, p_order_id: orderId, p_account: event.account, p_event_type: event.type,
    p_payload_hash: crypto.createHash("sha256").update(canonicalCheckoutJson(event)).digest("hex"), p_payload: event, p_token: token,
  });
  return { db, service, api, event, owner, ids, calls, receipts, providerReads, history, claim, payments, setTruncate: value => { truncate = value; } };
}
async function run(options, callback) {
  const f = await fixture(options);
  try { await callback(f); } finally { await f.db.close(); }
}

test("an interrupted claim stays retryable, concurrent deliveries cannot acknowledge unfinished work", () => run({}, async f => {
  const oldToken = crypto.randomUUID();
  assert.equal((await f.claim(oldToken)).data, "claimed");
  const busy = await Promise.all(Array.from({ length: 12 }, () => f.api.processCustomerOrderStripeEvent(f.service, f.event)));
  assert.ok(busy.every(result => result.status === 503));
  assert.equal(f.calls.length, 0);
  await f.db.query("update customer_order_webhooks set lease_until=now()-interval '1 second',next_attempt_at=now()-interval '1 second'");
  const recovered = await f.api.recoverCustomerOrderWebhooks(f.service);
  assert.equal(recovered.recovered, 1);
  assert.equal(f.calls.length, 1);
  assert.equal((await f.service.rpc("finish_customer_order_webhook", { p_event_id: f.event.id, p_token: oldToken, p_result: "pending" })).data, false);
  assert.equal((await f.api.processCustomerOrderStripeEvent(f.service, f.event)).duplicate, true);
  assert.equal(f.calls.length, 1);
}));

for (const failure of ["before-paid", "after-paid", "finish"]) test(`failure ${failure} retries the same combined payment without duplicating outbox work`, () => run({ failure, combined: true }, async f => {
  assert.equal((await f.api.processCustomerOrderStripeEvent(f.service, f.event)).status, 503);
  const second = await f.api.processCustomerOrderStripeEvent(f.service, f.event);
  assert.equal(second.status, 200);
  assert.equal(f.receipts.size, 2);
  const rows = (await f.db.query("select payment_status,stripe_payment_intent_id from orders")).rows;
  assert.ok(rows.every(row => row.payment_status === "paid" && row.stripe_payment_intent_id === "pi_fixture"));
  assert.equal((await f.api.processCustomerOrderStripeEvent(f.service, f.event)).duplicate, true);
}));

test("a no-op finalizer or incomplete group cannot acknowledge a successful payment", async () => {
  await run({ finalizerNull: true }, async f => {
    assert.equal((await f.api.processCustomerOrderStripeEvent(f.service, f.event)).review, true);
    assert.equal((await f.db.query("select status from customer_order_webhooks")).rows[0].status, "review");
  });
  await run({ incompleteGroup: true, combined: true }, async f => {
    assert.equal((await f.api.processCustomerOrderStripeEvent(f.service, f.event)).status, 503);
    assert.equal((await f.db.query("select status from customer_order_webhooks")).rows[0].status, "pending");
  });
});

test("provider presentation changes do not change a synthetic recovery payment identity", () => run({ failure: "before-paid" }, async f => {
  const first = await f.api.reconcilePendingCustomerOrderPayments(f.service);
  assert.equal(first.retry, 1);
  await f.db.exec("update customer_order_payment_checks set checked_at=now()-interval '3 minutes'");
  f.event.data.object.customer_details = { name: "Updated payer presentation" };
  f.event.data.object.metadata.optional_note = "New presentation metadata";
  const second = await f.api.reconcilePendingCustomerOrderPayments(f.service);
  assert.equal(second.recovered, 1);
  assert.equal((await f.db.query("select count(*)::int n from customer_order_webhooks")).rows[0].n, 1);
}));

test("mismatched connected accounts, ownership, totals, references and truncated groups stay in review", () => run({ combined: true }, async f => {
  const variants = [
    { account: "acct_other" },
    { data: { object: { ...f.event.data.object, currency: "usd" } } },
    { data: { object: { ...f.event.data.object, amount_total: 1 } } },
    { data: { object: { ...f.event.data.object, id: "cs_other" } } },
    { data: { object: { ...f.event.data.object, metadata: { ...f.event.data.object.metadata, photographer_id: crypto.randomUUID() } } } },
    { data: { object: { ...f.event.data.object, metadata: { ...f.event.data.object.metadata, order_group_id: crypto.randomUUID() } } } },
  ];
  for (const [index, patch] of variants.entries()) {
    const event = { ...f.event, ...patch, id: `evt_wrong_${index}` };
    assert.equal((await f.api.processCustomerOrderStripeEvent(f.service, event)).status, 400);
    assert.equal((await f.api.processCustomerOrderStripeEvent(f.service, event)).review, true);
  }
  f.setTruncate(true);
  assert.equal((await f.api.processCustomerOrderStripeEvent(f.service, { ...f.event, id: "evt_truncated" })).status, 400);
  assert.equal(f.calls.length, 0);
}));

test("changed event payloads cannot replace a prior signed payment identity", () => run({}, async f => {
  await f.claim(crypto.randomUUID());
  await assert.rejects(() => f.api.processCustomerOrderStripeEvent(f.service, { ...f.event, data: { object: { ...f.event.data.object, amount_total: 1 } } }));
  assert.equal(f.calls.length, 0);
}));

test("unpaid completion, delayed success and payment-intent events preserve their payment transitions", () => run({}, async f => {
  const unpaid = { ...f.event, id: "evt_unpaid", data: { object: { ...f.event.data.object, payment_status: "unpaid" } } };
  assert.equal((await f.api.processCustomerOrderStripeEvent(f.service, unpaid)).status, 200);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.api.processCustomerOrderStripeEvent(f.service, { ...f.event, id: "evt_delayed", type: "checkout.session.async_payment_succeeded" })).status, 200);
  const intent = { id: "pi_fixture", amount: 2900, currency: "cad", status: "succeeded", metadata: f.event.data.object.metadata };
  assert.equal((await f.api.processCustomerOrderStripeEvent(f.service, { ...f.event, id: "evt_intent", type: "payment_intent.succeeded", data: { object: intent } })).status, 200);
  assert.equal(f.calls[1].checkoutSessionId, null);
  assert.equal(f.calls[1].paymentIntentId, "pi_fixture");
  assert.equal((await f.api.processCustomerOrderStripeEvent(f.service, { ...f.event, id: "evt_failed", type: "payment_intent.payment_failed", data: { object: { ...intent, status: "requires_payment_method" } } })).status, 200);
  assert.equal(f.calls[2].failed.paymentIntentId, "pi_fixture");
  assert.equal(f.receipts.size, 1);
}));

test("pending reconciliation uses the saved account, provider-confirmed payment and complete group once", () => run({ combined: true }, async f => {
  const result = await f.api.reconcilePendingCustomerOrderPayments(f.service);
  assert.equal(result.checked, 1);
  assert.equal(result.recovered, 1);
  assert.deepEqual(f.providerReads, [{ sessionId: "cs_fixture", account: "acct_fixture" }]);
  assert.equal(f.receipts.size, 2);
}));

test("pending work rotates across 1000 abandoned drafts without starving later payments or changing orders", () => run({}, async f => {
  const ids = [];
  for (let index = 0; index < 1000; index++) {
    const id = crypto.randomUUID(); ids.push(id);
    await f.db.query("insert into orders(id,photographer_id,total_cents,currency,stripe_checkout_session_id,updated_at) values($1,$2,2900,'cad',$3,now()-interval '1 day')", [id, f.owner, `cs_abandoned_${index}`]);
  }
  const checked = new Set();
  for (let page = 0; page < 101; page++) {
    const result = await f.service.rpc("claim_pending_customer_order_payment_checks", { p_limit: 10 });
    assert.equal(result.error, null);
    assert.ok(result.data.length <= 10);
    for (const row of result.data) { assert.equal(checked.has(row.id), false); checked.add(row.id); }
  }
  assert.equal(checked.size, 1001);
  assert.ok(checked.has(f.ids[0]), "The later draft must be reached despite 1000 older abandoned sessions");
  assert.equal((await f.db.query("select count(*)::int as n from orders where payment_status='pending'")).rows[0].n, 1001);
  assert.equal(f.calls.length, 0);
}));

for (const sessionOverrides of [{ payment_status: "unpaid" }, { id: "cs_other" }, { metadata: { order_id: crypto.randomUUID(), photographer_id: crypto.randomUUID() } }, { amount_total: 1 }]) {
  test(`provider pending or mismatched recovery cannot mark an order paid: ${JSON.stringify(sessionOverrides)}`, () => run({ sessionOverrides }, async f => {
    const result = await f.api.reconcilePendingCustomerOrderPayments(f.service);
    assert.equal(result.recovered, 0);
    assert.equal(f.calls.length, 0);
  }));
}

test("webhook signatures are checked before customer payment claims and other flows keep legacy handling", () => run({}, async f => {
  let signatureValid = false, claimed = 0, legacy = 0;
  const deps = {
    "next/server": { NextResponse: { json: (value, options) => Response.json(value, options) } },
    "@/lib/dashboard-auth": { createDashboardServiceClient: () => f.service },
    "@/lib/customer-order-webhook": { ...f.api, processCustomerOrderStripeEvent: async (...args) => { claimed++; return f.api.processCustomerOrderStripeEvent(...args); } },
    "@/lib/payments": { verifyStripeSignature: async () => signatureValid, recordStripeEvent: async () => { legacy++; return { inserted: false }; } },
    "@/lib/credit-maintenance": { pausePlatformCreditEvent: () => false },
  };
  for (const name of ["order-refund-notifications", "studio-os-app", "admin-notification-center", "owner-notifications", "resend", "r2", "audit", "stripe-billing-period"]) deps[`@/lib/${name}`] = {};
  const route = load("app/api/stripe/webhook/route.ts", deps);
  const oldSecret = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = "fixture-secret";
  const request = event => ({ headers: new Headers({ "stripe-signature": "fixture-signature" }), text: async () => JSON.stringify(event) });
  try {
    assert.equal((await route.POST(request(f.event))).status, 400);
    assert.equal(claimed, 0);
    signatureValid = true;
    assert.equal((await route.POST(request(f.event))).status, 200);
    assert.equal(claimed, 1);
    assert.equal(legacy, 0);
    assert.equal((await route.POST(request({ ...f.event, type: "refund.updated" }))).status, 200);
    assert.equal(legacy, 1);
    assert.equal((await route.POST(request({ ...f.event, account: undefined }))).status, 200);
    assert.equal(legacy, 2);
  } finally { if (oldSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = oldSecret; }
}));

test("recovery cron fails closed without its secret and uses bounded work without charging or emailing", async () => {
  const before = process.env.CRON_SECRET;
  let calls = 0;
  const route = load("app/api/cron/customer-order-payment-recovery/route.ts", {
    "next/server": { NextResponse: { json: (value, options) => Response.json(value, options) } },
    "@/lib/dashboard-auth": { createDashboardServiceClient: () => ({}) },
    "@/lib/customer-order-webhook": {
      recoverCustomerOrderWebhooks: async (_service, limit) => { calls++; assert.equal(limit, 50); return { recovered: 0, retry: 0 }; },
      reconcilePendingCustomerOrderPayments: async (_service, limit) => { calls++; assert.equal(limit, 10); return { recovered: 0, retry: 0 }; },
    },
  });
  try {
    delete process.env.CRON_SECRET;
    assert.equal((await route.GET({ headers: new Headers() })).status, 401);
    process.env.CRON_SECRET = "fixture-cron-secret";
    assert.equal((await route.GET({ headers: new Headers() })).status, 401);
    assert.equal(calls, 0);
    assert.equal((await route.GET({ headers: new Headers({ authorization: "Bearer fixture-cron-secret" }) })).status, 200);
    assert.equal(calls, 2);
  } finally { if (before === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = before; }
});

test("1000 payment events and concurrent retries produce 1000 durable completions and bounded recovery", () => run({}, async f => {
  const events = [];
  for (let index = 0; index < 1000; index++) {
    const id = crypto.randomUUID();
    await f.db.query("insert into orders(id,photographer_id,total_cents,currency,stripe_checkout_session_id) values($1,$2,2900,'cad',$3)", [id, f.owner, `cs_load_${index}`]);
    events.push({ ...f.event, id: `evt_load_${index}`, data: { object: { ...f.event.data.object, id: `cs_load_${index}`, payment_intent: `pi_load_${index}`, metadata: { order_id: id, photographer_id: f.owner } } } });
  }
  for (let index = 0; index < events.length; index += 10) {
    const results = await Promise.all(events.slice(index, index + 10).map(event => f.api.processCustomerOrderStripeEvent(f.service, event)));
    assert.ok(results.every(result => result.status === 200));
  }
  for (const event of events.slice(0, 20)) assert.equal((await f.api.processCustomerOrderStripeEvent(f.service, event)).duplicate, true);
  assert.equal(f.calls.length, 1000);
  assert.equal(f.receipts.size, 1000);
  assert.equal(f.history.size, 1000);
  assert.equal((await f.db.query("select count(*)::int as n from customer_order_webhooks where status='processed'")).rows[0].n, 1000);
  const recovered = await f.api.recoverCustomerOrderWebhooks(f.service, 10000);
  assert.equal(recovered.checked, 0);
  await f.db.exec("set role anon");
  await assert.rejects(() => f.db.query("select * from customer_order_webhooks"));
  await assert.rejects(() => f.db.query("select finish_customer_order_webhook('evt_load_0',$1,'pending')", [crypto.randomUUID()]));
  await assert.rejects(() => f.db.query("select * from customer_order_payment_checks"));
  await assert.rejects(() => f.db.query("select * from claim_pending_customer_order_payment_checks(10)"));
}));

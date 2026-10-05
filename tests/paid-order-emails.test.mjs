import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const id = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plain = value => JSON.parse(JSON.stringify(value));

function fixture({ orderCount = 1, kinds = ['receipt'], notes = null } = {}) {
  const f = { now: Date.parse('2026-10-05T02:00:00.000Z'), configured: true,
    rows: [], orders: new Map(), calls: [], accepted: new Map(), rpcs: [], mutations: [], builders: [],
    digitalBuilds: [], delays: [], deferredWork: [], errors: [], env: { RESEND_API_KEY: 'synthetic-provider-key', CRON_SECRET: 'fixture-cron-secret' },
    worker: null, tokenCount: 0, failSentAck: null, providerBehavior: null, onPrepare: null, onOrderNotesRead: null,
    resendFetch: async () => assert.fail('Unexpected fake Resend HTTP request'), databaseCreations: 0 };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [f.now])); }
    static now() { return f.now; }
  }
  function load(path, dependencies = {}, extra = {}) {
    const exports = {};
    const compiled = ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(compiled, { exports, require: name => {
      assert.ok(Object.hasOwn(dependencies, name), `Unmocked dependency ${name} in ${path}`); return dependencies[name];
    }, Date: ClockDate, URL, URLSearchParams, Response, Headers, AbortSignal, process: { env: f.env },
    fetch: (...args) => f.resendFetch(...args), console: { error: (...args) => f.errors.push(plain(args)) }, ...extra }, { filename: path });
    return exports;
  }
  const resend = load('lib/resend.ts');
  for (let index = 0; index < orderCount; index += 1) {
    const order = { id: id(index + 1), photographer_id: id(9000), project_id: id(9001),
      parent_name: `Parent ${index + 1}`, customer_email: `parent-${index + 1}@example.test`, parent_email: `parent-${index + 1}@example.test`,
      status: 'paid', payment_status: 'paid', paid_at: new ClockDate().toISOString(), refund_amount_cents: 0, refund_status: 'none', notes };
    f.orders.set(order.id, order);
    for (const kind of kinds) f.rows.push({ id: id(10000 + f.rows.length), order_id: order.id, photographer_id: order.photographer_id, kind,
      recipient_email: kind === 'photographer' ? 'owner@example.test' : order.customer_email,
      snapshot: { order: structuredClone(order), items: [{ product_name: '8x10 print', quantity: 1, line_total_cents: 1800 }],
        photographer: { business_name: 'Frozen Studio', studio_email: 'studio@example.test' },
        context: { project_title: 'Frozen Event', project_pin: 'event-90876' } },
      payload: null, status: 'pending', attempts: 0, first_attempt_at: null, next_attempt_at: new ClockDate().toISOString(),
      lease_token: null, lease_until: null, resend_email_id: null });
  }
  const eligible = row => {
    const order = f.orders.get(row.order_id);
    return order && order.photographer_id === row.photographer_id && order.paid_at &&
      ['paid', 'succeeded', 'no_payment_required'].includes(order.payment_status) &&
      !['refunded', 'refund_pending', 'cancelled', 'canceled', 'cancel_pending'].includes(order.status) &&
      Number(order.refund_amount_cents ?? 0) === 0 && ['', 'none', 'not_refunded', 'not_requested'].includes(order.refund_status ?? '');
  };
  const stableKey = row => row.kind === 'receipt' ? `order-receipt-${row.order_id}` : row.kind === 'photographer'
    ? `order-notify-${row.order_id}` : `digital-delivery-${row.order_id}-${row.recipient_email}`;
  const service = {
    async rpc(name, args) {
      f.rpcs.push({ name, args: structuredClone(args) });
      if (name === 'ensure_paid_order_emails') return { data: f.rows.filter(row => row.order_id === args.p_order_id && ['pending', 'sending'].includes(row.status) && f.orders.get(row.order_id)?.photographer_id === row.photographer_id).map(row => ({ id: row.id })), error: null };
      if (name === 'claim_paid_order_emails') {
        if (f.worker?.until > f.now) return { data: [], error: null };
        const token = `worker-${++f.tokenCount}`;
        f.worker = { token, until: f.now + 180000 };
        for (const row of f.rows) {
          if (!['pending', 'sending'].includes(row.status) || Date.parse(row.lease_until) > f.now) continue;
          if (!eligible(row)) row.status = 'cancelled';
          else if (row.attempts >= 20 || (row.first_attempt_at && Date.parse(row.first_attempt_at) < f.now - 23 * 3600000)) row.status = 'needs_review';
        }
        const rows = f.rows.filter(row => ['pending', 'sending'].includes(row.status) && Date.parse(row.next_attempt_at) <= f.now &&
          !(Date.parse(row.lease_until) > f.now) && (!args.p_ids || args.p_ids.includes(row.id))).slice(0, Math.max(1, Math.min(args.p_limit ?? 200, 200)));
        for (const row of rows) Object.assign(row, { status: 'sending', attempts: row.attempts + 1, lease_token: token, lease_until: new ClockDate(f.now + 180000).toISOString() });
        if (!rows.length) f.worker = null;
        return { data: structuredClone(rows), error: null };
      }
      if (name === 'prepare_paid_order_email') {
        const row = f.rows.find(row => row.id === args.p_id); await f.onPrepare?.(row);
        const payload = args.p_payload;
        if (!row || row.status !== 'sending' || row.lease_token !== args.p_lease_token || Date.parse(row.lease_until) <= f.now || !eligible(row) ||
          typeof payload?.to !== 'string' || payload.to.toLowerCase() !== row.recipient_email || payload.idempotencyKey !== stableKey(row)) return { data: [], error: null };
        row.payload ??= structuredClone(payload); row.first_attempt_at ??= new ClockDate().toISOString();
        return { data: [structuredClone(row)], error: null };
      }
      if (name === 'release_paid_order_email_worker') {
        if (f.worker?.token === args.p_lease_token) f.worker = null;
        return { data: null, error: null };
      }
      assert.fail(`Unexpected RPC ${name}`);
    },
    from(table) {
      assert.ok(['orders', 'paid_order_emails'].includes(table), `Unexpected table ${table}`);
      const predicates = []; let changes;
      const rows = () => (table === 'orders' ? [...f.orders.values()] : f.rows).filter(row => predicates.every(predicate => predicate(row)));
      const chain = {
        select() { return chain; },
        eq(key, value) { predicates.push(row => row[key] === value); return chain; },
        is(key, value) { predicates.push(row => row[key] === value); return chain; },
        update(value) { changes = structuredClone(value); return chain; },
        async maybeSingle() {
          const matching = rows()[0]; const value = matching ? structuredClone(matching) : null;
          if (table === 'orders') await f.onOrderNotesRead?.(matching);
          return { data: value, error: null };
        },
        then(resolve, reject) {
          const matching = rows(); let error = null;
          if (changes) {
            f.mutations.push({ table, changes: structuredClone(changes), matched: matching.map(row => row.id) });
            const fail = table === 'paid_order_emails' && changes.status === 'sent' && f.failSentAck;
            if (!fail || fail === 'after') matching.forEach(row => Object.assign(row, changes));
            if (fail) { f.failSentAck = null; error = { message: 'Synthetic database acknowledgement unavailable' }; }
          }
          return Promise.resolve({ data: error ? null : matching.map(row => ({ id: row.id })), error }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  f.accept = payload => {
    const key = payload.idempotencyKey, existing = f.accepted.get(key);
    if (existing) { assert.deepEqual(plain(payload), existing.payload, 'one provider key must always retain the same request'); return { id: existing.id }; }
    const value = { id: `email_${f.accepted.size + 1}`, payload: plain(payload) }; f.accepted.set(key, value);
    return { id: value.id };
  };
  const provider = async payload => {
    const row = f.rows.find(row => stableKey(row) === payload.idempotencyKey);
    assert.ok(row?.payload && row.first_attempt_at, 'persist exact request and first-attempt timestamp before provider');
    f.calls.push({ at: f.now, payload: plain(payload) });
    return f.providerBehavior ? f.providerBehavior(payload, f.calls.length) : f.accept(payload);
  };
  f.api = load('lib/paid-order-emails.ts', {
    'node:timers/promises': { setTimeout: async ms => { f.delays.push(ms); f.now += ms; } },
    'next/server': { after: callback => f.deferredWork.push(callback) },
    '@/lib/order-notification-email': { buildOrderNotificationEmail: input => { f.builders.push({ kind: 'photographer', input: plain(input) }); return { subject: 'Photographer order', html: 'Frozen photographer content', text: 'Frozen photographer content' }; } },
    '@/lib/order-receipt-email': { buildOrderReceiptEmail: input => { f.builders.push({ kind: 'receipt', input: plain(input) }); return { subject: 'Receipt', html: 'Frozen receipt content', text: 'Frozen receipt content' }; } },
    '@/lib/digital-delivery': { buildDigitalDeliveryEmailForOrder: async (_service, orderId, options) => {
      f.digitalBuilds.push({ orderId, options: plain(options) });
      if (!options.force && f.orders.get(orderId)?.notes?.includes('Digital delivery link emailed')) return { skipped: true };
      const token = `original-digital-token-${f.digitalBuilds.length}`;
      return { skipped: false, payload: { to: options.recipientEmail, subject: 'Your digital photos', html: `<a href="https://fixture.test/download?token=${token}">Download</a>`, text: token,
        idempotencyKey: `digital-delivery-${orderId}-${options.recipientEmail}` } };
    } },
    '@/lib/resend': { ...resend, resendConfigured: () => f.configured, sendResendEmail: provider },
  });
  f.cron = load('app/api/cron/paid-order-emails/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => { f.databaseCreations += 1; return service; } },
    '@/lib/paid-order-emails': f.api,
  });
  f.service = service; f.resend = resend; f.deliver = ids => f.api.deliverPaidOrderEmails(service, ids);
  f.advanceToRetry = () => { f.now = Math.max(...f.rows.filter(row => row.status === 'pending').map(row => Date.parse(row.next_attempt_at)), f.now); };
  return f;
}

test('provider outage leaves the frozen request pending with a safe retry and releases the worker', async () => {
  const f = fixture(); f.providerBehavior = async () => { throw new Error('PRIVATE provider error must not be persisted'); };
  assert.deepEqual(plain(await f.deliver()), { sent: 0, failed: 1, deferred: 0 });
  const row = f.rows[0]; assert.equal(row.status, 'pending'); assert.equal(row.attempts, 1); assert.ok(row.payload && row.first_attempt_at);
  assert.equal(Date.parse(row.next_attempt_at) - f.calls[0].at, 120000);
  assert.equal(row.last_error, 'Email delivery could not be confirmed; retry scheduled.');
  assert.equal(f.worker, null); assert.equal(f.accepted.size, 0);
  f.providerBehavior = null; f.advanceToRetry();
  assert.deepEqual(plain(await f.deliver()), { sent: 1, failed: 0, deferred: 0 });
  assert.equal(f.builders.length, 1); assert.deepEqual(f.calls[1].payload, f.calls[0].payload);
});

test('provider accepted but lost response retries the same bytes and key without a duplicate delivery', async () => {
  const f = fixture(); f.providerBehavior = async (payload, attempt) => {
    const result = f.accept(payload); if (attempt === 1) throw new Error('Synthetic lost response'); return result;
  };
  await f.deliver(); assert.equal(f.accepted.size, 1); assert.equal(f.rows[0].status, 'pending');
  const original = structuredClone(f.rows[0].payload);
  f.rows[0].snapshot.order.parent_name = 'Edited parent'; f.rows[0].snapshot.photographer.business_name = 'Edited studio';
  f.advanceToRetry(); await f.deliver();
  assert.equal(f.rows[0].status, 'sent'); assert.equal(f.calls.length, 2); assert.equal(f.accepted.size, 1);
  assert.deepEqual(f.calls.map(call => call.payload), [original, original]); assert.equal(f.builders.length, 1);
});

for (const acknowledgement of ['before', 'after']) test(`sent acknowledgement failure ${acknowledgement} database commit never creates a duplicate provider delivery`, async () => {
  const f = fixture(); f.failSentAck = acknowledgement;
  assert.equal((await f.deliver()).failed, 1); assert.equal(f.accepted.size, 1);
  const original = structuredClone(f.rows[0].payload);
  if (acknowledgement === 'before') { assert.equal(f.rows[0].status, 'pending'); f.advanceToRetry(); }
  else assert.equal(f.rows[0].status, 'sent');
  await f.deliver(); assert.equal(f.rows[0].status, 'sent'); assert.equal(f.accepted.size, 1);
  assert.ok(f.calls.every(call => JSON.stringify(call.payload) === JSON.stringify(original)));
  assert.equal(f.calls.length, acknowledgement === 'before' ? 2 : 1); assert.equal(f.builders.length, 1);
});

test('concurrent webhook/cron dispatch and a completed replay share one paced provider worker', async () => {
  const f = fixture(); let started, release;
  const began = new Promise(resolve => { started = resolve; }); const gate = new Promise(resolve => { release = resolve; });
  f.providerBehavior = async payload => { started(); await gate; return f.accept(payload); };
  const first = f.deliver(); await began;
  assert.deepEqual(plain(await f.deliver()), { sent: 0, failed: 0, deferred: 0 });
  assert.equal(f.calls.length, 1);
  release(); assert.deepEqual(plain(await first), { sent: 1, failed: 0, deferred: 0 });
  assert.deepEqual(plain(await f.deliver()), { sent: 0, failed: 0, deferred: 0 });
  assert.equal(f.calls.length, 1); assert.equal(f.accepted.size, 1); assert.equal(f.worker, null);
});

for (const changed of ['owner', 'payment']) test(`changed ${changed} during preparation denies the provider and the next claim cancels invalid work`, async () => {
  const f = fixture(); f.onPrepare = row => {
    const order = f.orders.get(row.order_id);
    if (changed === 'owner') order.photographer_id = id(9999); else order.payment_status = 'refunded';
  };
  assert.deepEqual(plain(await f.deliver()), { sent: 0, failed: 1, deferred: 0 });
  assert.equal(f.calls.length, 0); assert.equal(f.rows[0].status, 'pending');
  assert.equal(f.rows[0].payload, null); assert.equal(f.rows[0].first_attempt_at, null); assert.equal(f.worker, null);
  f.advanceToRetry();
  assert.deepEqual(plain(await f.deliver()), { sent: 0, failed: 0, deferred: 0 });
  assert.equal(f.rows[0].status, 'cancelled'); assert.equal(f.calls.length, 0);
});

test('digital delivery is built once and a lost response preserves its original token through retry and note recording', async () => {
  const f = fixture({ kinds: ['digital'], notes: 'Photographer original note' });
  f.providerBehavior = async (payload, attempt) => { const result = f.accept(payload); if (attempt === 1) throw new Error('Lost response'); return result; };
  await f.deliver(); const original = structuredClone(f.rows[0].payload); assert.equal(f.digitalBuilds.length, 1);
  f.advanceToRetry(); await f.deliver();
  assert.equal(f.digitalBuilds.length, 1); assert.equal(f.accepted.size, 1); assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls.map(call => call.payload), [original, original]);
  assert.ok(original.html.includes('original-digital-token-1'));
  const notes = f.orders.get(f.rows[0].order_id).notes;
  assert.ok(notes.startsWith('Photographer original note\n\n'));
  assert.equal(notes.split('Digital delivery link emailed').length - 1, 1);
  assert.equal(f.rows[0].status, 'sent');
});

test('manual digital delivery marker skips the provider and marks tracked work complete', async () => {
  const notes = 'Original notes\nDigital delivery link emailed previously';
  const f = fixture({ kinds: ['digital'], notes });
  assert.deepEqual(plain(await f.deliver()), { sent: 1, failed: 0, deferred: 0 });
  assert.equal(f.calls.length, 0); assert.equal(f.digitalBuilds.length, 1); assert.equal(f.rows[0].status, 'sent');
  assert.equal(f.rows[0].first_attempt_at, null); assert.equal(f.orders.get(f.rows[0].order_id).notes, notes);
});

test('manual digital delivery after an automatic outage completes the frozen job without another provider request', async () => {
  const f = fixture({ kinds: ['digital'], notes: 'Original photographer note' });
  f.providerBehavior = async () => { throw new Error('Synthetic provider outage'); };
  assert.deepEqual(plain(await f.deliver()), { sent: 0, failed: 1, deferred: 0 });
  const row = f.rows[0], original = structuredClone(row.payload), firstAttempt = row.first_attempt_at;
  assert.equal(row.status, 'pending'); assert.ok(original.html.includes('original-digital-token-1'));
  assert.equal(f.calls.length, 1); assert.equal(f.digitalBuilds.length, 1); assert.ok(firstAttempt);
  const notes = 'Original photographer note\n\nDigital delivery link emailed manually after the outage.';
  f.orders.get(row.order_id).notes = notes;
  f.providerBehavior = null; f.advanceToRetry();
  assert.deepEqual(plain(await f.deliver()), { sent: 1, failed: 0, deferred: 0 });
  assert.equal(row.status, 'sent'); assert.equal(f.calls.length, 1); assert.equal(f.digitalBuilds.length, 1);
  assert.equal(f.accepted.size, 0); assert.deepEqual(row.payload, original); assert.equal(row.first_attempt_at, firstAttempt);
  assert.equal(f.orders.get(row.order_id).notes, notes); assert.equal(row.lease_token, null); assert.equal(f.worker, null);
  assert.equal(f.rpcs.filter(call => call.name === 'prepare_paid_order_email').length, 1);
});

test('optimistic digital note update preserves concurrent edits and retries the frozen accepted email safely', async () => {
  const f = fixture({ kinds: ['digital'], notes: null }); let changed = false;
  f.onOrderNotesRead = order => { if (!changed) { changed = true; order.notes = 'Concurrent photographer note'; } };
  assert.equal((await f.deliver()).failed, 1);
  assert.equal(f.orders.get(f.rows[0].order_id).notes, 'Concurrent photographer note'); assert.equal(f.rows[0].status, 'pending');
  f.advanceToRetry(); await f.deliver();
  assert.equal(f.digitalBuilds.length, 1); assert.equal(f.accepted.size, 1); assert.equal(f.calls.length, 2);
  const notes = f.orders.get(f.rows[0].order_id).notes;
  assert.ok(notes.startsWith('Concurrent photographer note\n\n'));
  assert.equal(notes.split('Digital delivery link emailed').length - 1, 1); assert.equal(f.rows[0].status, 'sent');
});

test('real provider Retry-After parsing extends the dispatcher retry beyond its exponential fallback', async () => {
  const f = fixture({ orderCount: 3 }); f.resendFetch = async () => Response.json({ message: 'Synthetic rate limit' }, { status: 429, headers: { 'retry-after': '900' } });
  f.providerBehavior = payload => f.resend.sendResendEmail(payload);
  assert.deepEqual(plain(await f.deliver()), { sent: 0, failed: 1, deferred: 2 });
  assert.equal(f.calls.length, 1, 'the rate-limited account must pause the remaining batch');
  assert.equal(Date.parse(f.rows[0].next_attempt_at) - f.calls[0].at, 900000);
  assert.equal(f.rows[0].status, 'pending'); assert.equal(f.worker, null);
  for (const row of f.rows.slice(1)) {
    assert.equal(Date.parse(row.next_attempt_at) - f.calls[0].at, 900000);
    assert.equal(row.attempts, 0); assert.equal(row.payload, null); assert.equal(row.first_attempt_at, null);
  }
  f.providerBehavior = null; f.advanceToRetry();
  assert.deepEqual(plain(await f.deliver()), { sent: 3, failed: 0, deferred: 0 });
  assert.equal(f.accepted.size, 3); assert.equal(f.builders.length, 3);
});

test('time budget defers unprocessed rows, returns their claimed attempts, and releases the global worker', async () => {
  const f = fixture({ orderCount: 4 });
  f.providerBehavior = async payload => { f.now += 111000; return f.accept(payload); };
  assert.deepEqual(plain(await f.deliver()), { sent: 1, failed: 0, deferred: 3 });
  assert.equal(f.calls.length, 1); assert.equal(f.worker, null);
  for (const row of f.rows.slice(1)) {
    assert.equal(row.status, 'pending'); assert.equal(row.attempts, 0); assert.equal(row.first_attempt_at, null);
    assert.equal(row.payload, null); assert.equal(row.lease_token, null); assert.equal(row.lease_until, null);
  }
  f.providerBehavior = null;
  assert.deepEqual(plain(await f.deliver()), { sent: 3, failed: 0, deferred: 0 });
  assert.equal(f.accepted.size, 4); assert.ok(f.rows.every(row => row.status === 'sent' && row.attempts === 1));
});

test('1000 orders dispatch 2000 fake-provider messages in ten bounded paced batches without duplication', async () => {
  const f = fixture({ orderCount: 1000, kinds: ['receipt', 'photographer'] });
  let sent = 0;
  for (let batch = 0; batch < 10; batch += 1) {
    const result = plain(await f.deliver()); assert.deepEqual(result, { sent: 200, failed: 0, deferred: 0 }); sent += result.sent;
  }
  assert.equal(sent, 2000); assert.equal(f.calls.length, 2000); assert.equal(f.accepted.size, 2000);
  assert.ok(f.rows.every(row => row.status === 'sent' && row.attempts === 1));
  assert.equal(f.delays.length, 2000); assert.ok(f.delays.every(ms => ms === 250));
  assert.deepEqual(plain(await f.deliver()), { sent: 0, failed: 0, deferred: 0 });
});

test('queue discovers tracked work only and post-response scheduling leaves historical orders untouched', async () => {
  const f = fixture(), orderId = f.rows[0].order_id;
  assert.deepEqual(plain(await f.api.queuePaidOrderEmails(f.service, id(99999))), []);
  await f.api.schedulePaidOrderEmails(f.service, id(99999)); assert.equal(f.deferredWork.length, 0);
  await f.api.schedulePaidOrderEmails(f.service, orderId);
  assert.equal(f.calls.length, 0); assert.equal(f.deferredWork.length, 1);
  await f.deferredWork[0](); assert.equal(f.rows[0].status, 'sent'); assert.equal(f.calls.length, 1);
  assert.deepEqual(plain(await f.api.queuePaidOrderEmails(f.service, orderId)), []);
  await f.api.schedulePaidOrderEmails(f.service, orderId);
  assert.equal(f.deferredWork.length, 1, 'completed replay must schedule no additional dispatcher'); assert.equal(f.calls.length, 1);
});

test('cron authenticates before database/provider access and reports provider configuration failure safely', async () => {
  const f = fixture(); const request = value => ({ headers: new Headers(value ? { authorization: value } : {}) });
  for (const value of [null, 'Bearer wrong-secret', 'fixture-cron-secret']) assert.equal((await f.cron.GET(request(value))).status, 401);
  f.env.CRON_SECRET = ''; assert.equal((await f.cron.GET(request('Bearer fixture-cron-secret'))).status, 401);
  assert.equal(f.databaseCreations, 0); assert.equal(f.calls.length, 0); assert.equal(f.rpcs.length, 0);
  f.env.CRON_SECRET = ' fixture-cron-secret '; f.configured = false;
  const unavailable = await f.cron.GET(request('Bearer fixture-cron-secret'));
  assert.equal(unavailable.status, 503); assert.deepEqual(await unavailable.json(), { ok: false, message: 'Paid order email retry unavailable.' });
  assert.equal(f.calls.length, 0); assert.equal(f.rpcs.length, 0);
  f.configured = true; const ready = await f.cron.GET(request('Bearer fixture-cron-secret'));
  assert.equal(ready.status, 200); assert.deepEqual(await ready.json(), { ok: true, sent: 1, failed: 0, deferred: 0 });
});

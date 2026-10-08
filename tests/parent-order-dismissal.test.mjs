import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as policy from '../lib/parent-order-dismissal.ts';
import * as paymentPolicy from '../lib/order-payment-policy.ts';
import * as orderDisplay from '../lib/order-display.ts';
import { hasCurrentDigitalPayment } from '../lib/digital-entitlement-payment.ts';

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL('../app/api/portal/orders/dismiss/route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const historyCompiled = ts.transpileModule(readFileSync(new URL('../app/api/portal/orders/history/route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const id = '11111111-1111-4111-8111-111111111111';
const studio = '22222222-2222-4222-8222-222222222222';
const school = '33333333-3333-4333-8333-333333333333';
const student = '44444444-4444-4444-8444-444444444444';
const project = '55555555-5555-4555-8555-555555555555';
const group = '66666666-6666-4666-8666-666666666666';
const second = '77777777-7777-4777-8777-777777777777';
const email = 'parent@example.test';
function fixture(options = {}) {
  const orders = [{ id, photographer_id: studio, order_group_id: options.group ? group : null,
    school_id: options.event ? null : school, student_id: options.event ? null : student,
    project_id: options.event ? project : null, parent_email: email, customer_email: email,
    status: 'payment_pending', payment_status: 'pending', paid_at: null,
    refund_status: 'none', refund_amount_cents: 0,
    stripe_checkout_session_id: options.noProvider || options.intentOnly ? null : 'cs_draft',
    stripe_payment_intent_id: options.intentOnly || options.intent ? 'pi_draft' : null,
    total_cents: 1050, currency: 'cad', cart_snapshot: [{ key: 'original-photo', quantity: 1 }], parent_dismissed_at: null,
    ...options.row }];
  if (options.group) orders.push({ ...orders[0], id: second, ...options.secondRow });
  const tables = { orders, schools: [{ id: school, photographer_id: studio, status: 'active', portal_status: 'active', expiration_date: null }],
    students: [{ id: student, school_id: school, pin: '1234' }], photographers: [{ id: studio, stripe_connected_account_id: 'acct_owner' }],
    school_gallery_visitors: [{ school_id: school, viewer_email: email }], event_gallery_visitors: [{ project_id: project, viewer_email: email }] };
  const actions = [], writes = [], stops = [], audit = [];
  const metadata = { photographer_id: studio, order_id: id, billing_flow: 'customer_order',
    ...(options.event ? { project_id: project } : { school_id: school, student_id: student }) };
  const session = { id: 'cs_draft', status: 'open', payment_status: 'unpaid', payment_intent: options.intent ? 'pi_draft' : null,
    amount_total: orders.reduce((sum, o) => sum + o.total_cents, 0), currency: 'cad', customer_email: email, metadata, ...options.session };
  const intent = { id: 'pi_draft', status: 'requires_payment_method', amount_received: 0,
    amount: orders.reduce((sum, o) => sum + o.total_cents, 0), currency: 'cad', metadata, ...options.payment };
  let reads = 0, locked = false;
  const service = { from(table) {
    let predicate = () => true, update;
    const chain = { select() { return chain; }, order() { return chain; }, limit() { return chain; },
      eq(key, value) { const prev = predicate; predicate = row => prev(row) && row[key] === value; return chain; },
      in(key, values) { const prev = predicate; predicate = row => prev(row) && values.includes(row[key]); return chain; },
      is(key, value) { return chain.eq(key, value); },
      or(expression) { const prev = predicate;
        const recipient = expression.match(/parent_email\.ilike\.([^,]+)/)?.[1];
        predicate = row => prev(row) && (recipient ? [row.parent_email, row.customer_email].some(value => value?.trim().toLowerCase() === recipient)
          : row.payment_status == null || ['pending', 'unpaid', 'failed', 'cancelled', 'canceled', 'requires_payment_method', 'requires_confirmation', 'requires_action'].includes(row.payment_status)); return chain; },
      update(value) { update = value; return chain; }, maybeSingle() { return run(true); },
      then(resolve, reject) { return run(false).then(resolve, reject); } };
    async function run(single) {
      if (table === 'orders' && !update) { reads++; options.onRead?.(reads, orders, tables); }
      const matches = tables[table].filter(predicate);
      if (update) { writes.push({ ...update }); matches.forEach(row => Object.assign(row, update)); }
      return { data: single ? matches.length === 1 ? structuredClone(matches[0]) : null : structuredClone(matches),
        error: null, count: options.truncated && !single && table === 'orders' ? matches.length + 1 : matches.length };
    }
    return chain;
  }, async rpc(name, params) {
    assert.equal(name, 'stop_abandoned_cart_reminders');
    assert.ok(locked, 'suppression is inside the shared payment lock');
    assert.ok(orders.every(row => ['payment_pending', 'cancel_pending', 'cancelled', 'canceled'].includes(row.status)), 'only unpaid cancellation states can stop reminders');
    stops.push(params);
    return { data: !options.stopConflict, error: options.stopError ? { message: 'unavailable' } : null };
  } };
  async function stripeRequest(path, params = {}) {
    assert.equal(params.account, 'acct_owner', 'always use captured connected owner account');
    if (params.method === 'POST') {
      actions.push({ path, ...params });
      assert.ok(stops.length >= orders.length, 'all reminder stops precede external actions');
      assert.ok(orders.every(row => row.status === 'cancel_pending'), 'hold precedes external action');
      if (options.paymentWins) { session.status = 'complete'; session.payment_status = 'paid'; throw Error('payment completed during expiry'); }
      options.onProvider?.(orders, tables);
      if (options.lostReply) throw Error('lost reply');
      if (path.endsWith('/expire')) { session.status = 'expired'; return { ...session }; }
      if (path.endsWith('/cancel')) { intent.status = 'canceled'; return { ...intent }; }
      throw Error('Money/refund action is forbidden');
    }
    if (path.startsWith('checkout/sessions/')) return structuredClone(session);
    if (path.startsWith('payment_intents/')) return structuredClone(intent);
    throw Error(`Unexpected request ${path}`);
  }
  const dependencies = {
    'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } }, zod: require('zod'),
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => service },
    '@/lib/api-validation': { parseJson: async (request, schema) => { const parsed = schema.safeParse(await request.json()); return parsed.success ? { ok: true, data: parsed.data } : { ok: false, response: Response.json({ ok: false }, { status: 400 }) }; } },
    '@/lib/rate-limit': { getClientIp: () => '127.0.0.1', rateLimit: async () => ({ allowed: !options.rateLimited }) },
    '@/lib/calendar-dates': { hasCalendarBoundaryPassed: () => !!options.expired },
    '@/lib/subscription-gate': { hasActiveSubscription: () => !options.inactiveOwner },
    '@/lib/event-gallery-access': { validateEventGalleryAccess: async () => ({ ok: !options.invalidAccess, project: { photographer_id: studio }, collectionIds: ['album'] }) },
    '@/lib/payments': { getConnectedAccountId: row => row.stripe_connected_account_id, stripeRequest },
    '@/lib/order-payment-lock': { lockOrderPayment: async () => { options.onLock?.(orders); locked = true; return async () => { locked = false; }; } },
    '@/lib/order-payment-policy': paymentPolicy, '@/lib/parent-order-dismissal': policy,
    '@/lib/order-display': orderDisplay, '@/lib/digital-entitlement-payment': { hasCurrentDigitalPayment },
    '@/lib/portal-order-media': { canonicalPortalOrderReference: value => value || null, canonicalPortalOrderSnapshot: value => value },
    '@/lib/digital-delivery': { createDigitalDeliveryDownloadUrl: () => '/verified-download' },
    '@/lib/audit': { recordAudit: async value => audit.push(value) },
  };
  const exports = {};
  new Function('require', 'exports', compiled)(name => { if (!dependencies[name]) throw Error(name); return dependencies[name]; }, exports);
  const history = {};
  new Function('require', 'exports', historyCompiled)(name => { if (!dependencies[name]) throw Error(name); return dependencies[name]; }, history);
  const body = { orderId: id, pin: '1234', email, ...(options.event ? { projectId: project } : { schoolId: school }), confirmed: true };
  const request = (data = body) => ({ nextUrl: new URL('https://example.test/api/portal/orders/dismiss'),
    headers: new Headers({ origin: options.origin || 'https://example.test' }), json: async () => data });
  return { exports, history, orders, actions, writes, stops, audit, request, body, tables };
}

test('authorized draft stops reminders, expires Stripe before cancellation, and retains its data', async () => {
  const f = fixture(); const before = structuredClone(f.orders[0].cart_snapshot);
  const response = await f.exports.POST(f.request());
  assert.equal(response.status, 200); assert.equal(f.orders[0].status, 'cancelled');
  assert.deepEqual(f.orders[0].cart_snapshot, before); assert.equal(f.orders.length, 1);
  assert.ok(f.orders[0].parent_dismissed_at);
  assert.equal(f.stops[0].p_recipient_email, email); assert.equal(f.actions[0].path, 'checkout/sessions/cs_draft/expire');
  assert.equal(f.actions[0].idempotencyKey, 'studio-os-expire-cs_draft');
  assert.equal(f.audit[0].action, 'parent.checkout.discard');
  assert.equal(JSON.stringify(f.audit).includes('1234'), false);
  assert.equal((await f.exports.POST(f.request())).status, 200); assert.equal(f.actions.length, 1); assert.equal(f.stops.length, 2);
});
test('delete then reload removes only the unpaid cancelled draft, retaining paid/refunded history', async () => {
  const f = fixture();
  const before = await (await f.history.POST(f.request())).json();
  assert.equal(before.orders[0].canDiscardCheckout, true);
  assert.equal((await f.exports.POST(f.request())).status, 200);
  assert.deepEqual((await (await f.history.POST(f.request())).json()).orders, []);
  assert.equal(f.orders.length, 1, 'retained database record is never deleted');
  const cancelled = structuredClone(f.orders[0]);
  for (const markers of [{ status: 'paid', payment_status: 'succeeded', paid_at: '2026-10-08' },
    { status: 'cancelled', payment_status: 'succeeded' }, { status: 'cancelled', payment_status: 'processing' },
    { status: 'refunded', payment_status: 'refunded', refund_amount_cents: 1050 },
    { status: 'cancelled', refund_status: 'pending' }]) {
    Object.assign(f.orders[0], cancelled, markers);
    const rows = (await (await f.history.POST(f.request())).json()).orders;
    assert.equal(rows.length, 1, 'a dismissal marker cannot hide current financial authority');
    assert.equal(rows[0].canDiscardCheckout, false);
    assert.equal((await f.exports.POST(f.request())).status, 409);
  }
});
test('history fallback remains viewable with no deletion grant and incomplete grouped history stays read-only', async () => {
  const f = fixture(); const response = await f.history.POST(f.request({ ...f.body, email: 'viewer@example.test' }));
  const json = await response.json(); assert.equal(response.status, 200); assert.equal(json.orders.length, 1);
  assert.equal(json.orders[0].canDiscardCheckout, false); assert.equal(json.orders[0].parentEmail, null);
  for (const options of [{ group: true, truncated: true }, { group: true, secondRow: { student_id: second } }]) {
    const combined = fixture(options); const rows = (await (await combined.history.POST(combined.request())).json()).orders;
    assert.ok(rows.length); assert.ok(rows.every(row => row.canDiscardCheckout === false));
  }
});
test('only every-member authorization permits grouped or event draft dismissal', async () => {
  for (const options of [{ group: true }, { event: true }, { noProvider: true }, { intentOnly: true }]) {
    const f = fixture(options); assert.equal((await f.exports.POST(f.request())).status, 200);
    assert.ok(f.orders.every(row => row.status === 'cancelled'));
  }
  for (const secondRow of [{ student_id: second }, { customer_email: 'other@example.test' }, { photographer_id: second }, { school_id: second }, { status: 'paid', payment_status: 'succeeded', paid_at: '2026-10-08' }]) {
    const f = fixture({ group: true, secondRow }); assert.equal((await f.exports.POST(f.request())).status, 409);
    assert.equal(f.actions.length, 0); assert.equal(f.writes.length, 0); assert.equal(f.stops.length, 0);
  }
  const album = fixture({ event: true, row: { cart_snapshot: [{ purchasedEventScope: { version: 1, projectId: project, collectionIds: ['private-album'] } }] } });
  assert.equal((await album.exports.POST(album.request())).status, 409); assert.equal(album.writes.length, 0);
});
test('purchase recipient, PIN, gallery owner and complete group proof cannot use history fallback access', async () => {
  const cases = [
    { row: { customer_email: 'different@example.test', parent_email: email } },
    { row: { photographer_id: second } }, { row: { student_id: second } },
    { group: true, truncated: true }, { expired: true }, { inactiveOwner: true },
    { event: true, invalidAccess: true },
  ];
  for (const options of cases) { const f = fixture(options); assert.equal((await f.exports.POST(f.request())).status, 409); assert.equal(f.writes.length, 0); assert.equal(f.stops.length, 0); }
  const pin = fixture(); assert.equal((await pin.exports.POST(pin.request({ ...pin.body, pin: '9999' }))).status, 409);
});
test('completed, processing, refunded and genuine pending orders are never discarded', async () => {
  const rows = [{ status: 'paid' }, { status: 'pending' }, { status: 'checkout_starting' },
    { payment_status: 'succeeded' }, { payment_status: 'processing' }, { paid_at: '2026-10-08' },
    { refund_status: 'pending' }, { refund_amount_cents: 1 }, { refund_amount_cents: -1 }, { total_cents: NaN }];
  for (const row of rows) { const f = fixture({ row }); assert.equal((await f.exports.POST(f.request())).status, 409); assert.equal(f.writes.length, 0); assert.equal(f.stops.length, 0); }
  for (const session of [{ status: 'complete' }, { payment_status: 'paid' }, { payment_status: 'no_payment_required' }, { amount_total: 1 }, { customer_email: 'different@example.test' },
    { metadata: { photographer_id: second, order_id: id } }, { metadata: { photographer_id: studio, order_id: id, billing_flow: 'customer_order', school_id: school, student_id: second } }]) {
    const f = fixture({ session }); assert.equal((await f.exports.POST(f.request())).status, 409); assert.equal(f.actions.length, 0); assert.equal(f.writes.length, 0);
  }
  for (const payment of [{ status: 'processing' }, { status: 'requires_capture' }, { status: 'succeeded' }, { amount_received: 1 }, { amount: 1 }, { metadata: { photographer_id: second, order_id: id } }]) {
    const f = fixture({ intent: true, payment }); assert.equal((await f.exports.POST(f.request())).status, 409); assert.equal(f.writes.length, 0);
  }
});
test('payment and account races preserve a hold and never report cancellation', async () => {
  for (const options of [{ paymentWins: true }, { lostReply: true }, { onProvider: (orders, tables) => { tables.photographers[0].stripe_connected_account_id = 'acct_new'; } },
    { onProvider: orders => { orders[0].customer_email = 'changed@example.test'; } },
    { onProvider: orders => { orders[0].total_cents += 1; } }]) {
    const f = fixture(options); assert.equal((await f.exports.POST(f.request())).status, 409);
    assert.equal(f.orders[0].status, 'cancel_pending'); assert.equal(f.audit.length, 0);
    assert.equal(f.stops.length, 1);
  }
  const changed = fixture({ onLock: orders => { orders[0].order_group_id = group; } });
  assert.equal((await changed.exports.POST(changed.request())).status, 409); assert.equal(changed.writes.length, 0);
});
test('failed stop watermark fails before hold/Stripe, while hold retries remain safe', async () => {
  for (const options of [{ stopError: true }, { stopConflict: true }]) {
    const f = fixture(options); assert.equal((await f.exports.POST(f.request())).status, 409);
    assert.equal(f.writes.length, 0); assert.equal(f.actions.length, 0); assert.equal(f.orders[0].status, 'payment_pending');
  }
  const retry = fixture({ row: { status: 'cancel_pending' }, session: { status: 'expired' } });
  assert.equal((await retry.exports.POST(retry.request())).status, 200); assert.equal(retry.orders[0].status, 'cancelled');
  assert.equal(retry.stops.length, 1, 'held retry idempotently preserves its stop watermark');
});
test('an anomalous cancelled draft with an open provider session is expired before hiding', async () => {
  const f = fixture({ row: { status: 'cancelled', payment_status: 'cancelled' } });
  assert.equal((await f.exports.POST(f.request())).status, 200);
  assert.equal(f.actions[0].path, 'checkout/sessions/cs_draft/expire');
  assert.deepEqual(f.writes.map(write => write.status), ['cancel_pending', 'cancelled']);
  assert.ok(f.orders[0].parent_dismissed_at);
});
test('confirmation, strict body, origin and rate limit reject forged requests', async () => {
  const f = fixture();
  for (const body of [{ ...f.body, confirmed: false }, { ...f.body, confirmed: undefined }, { ...f.body, projectId: project }, { ...f.body, photographerId: studio }, { ...f.body, schoolId: undefined }]) {
    assert.equal((await f.exports.POST(f.request(body))).status, 400);
  }
  const origin = fixture({ origin: 'https://attacker.test' }); assert.equal((await origin.exports.POST(origin.request())).status, 403);
  const limited = fixture({ rateLimited: true }); assert.equal((await limited.exports.POST(limited.request())).status, 429);
  assert.equal(f.writes.length, 0);
});

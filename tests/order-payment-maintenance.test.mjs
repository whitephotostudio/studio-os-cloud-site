import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as pricing from '../lib/studio-pricing.ts';
import * as periods from '../lib/stripe-billing-period.ts';
import * as orderPolicy from '../lib/order-payment-policy.ts';
import { creditMaintenanceActive } from '../lib/credit-maintenance.ts';

function load(path, dependencies = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', 'fetch', compiled)(name => dependencies[name] || {}, exports,
    () => assert.fail('This fixture must never contact Stripe, email or another external provider'));
  return exports;
}

function fixture() {
  const now = Date.now(); const orderId = crypto.randomUUID(); const photographerId = crypto.randomUUID();
  const sequence = []; const emails = []; const pushes = []; const rpcs = [];
  const order = { id: orderId, photographer_id: photographerId, package_name: 'Print package', status: 'pending',
    payment_status: 'pending', paid_at: null, notes: '', counted_for_monthly_usage: false, total_cents: 2900,
    customer_email: 'buyer@example.invalid', parent_name: 'Fixture buyer', currency: 'cad', is_test: false };
  const photographer = { id: photographerId, user_id: 'fixture-account', subscription_plan_code: 'core', subscription_status: 'active',
    stripe_platform_customer_id: 'cus_fixture', stripe_subscription_id: null, stripe_subscription_item_usage_id: 'si_fixture',
    subscription_current_period_start: new Date(now - 86400000).toISOString(),
    subscription_current_period_end: new Date(now + 86400000).toISOString(), order_usage_rate_cents: 35, billing_currency: 'cad',
    business_name: 'Fixture Studio', billing_email: 'photographer@example.invalid', studio_email: 'studio@example.invalid' };
  const tables = { orders: [order], photographers: [photographer], order_items: [{ order_id: orderId, product_name: '8x10 Print', quantity: 1, unit_price_cents: 2900, line_total_cents: 2900 }] };
  const service = {
    from(table) {
      assert.ok(table in tables, `No unrelated table ${table} is expected`);
      let predicate = () => true; let changes;
      const chain = {
        select() { return chain; },
        eq(key, value) { const previous = predicate; predicate = row => previous(row) && row[key] === value; return chain; },
        in(key, values) { const previous = predicate; predicate = row => previous(row) && values.includes(row[key]); return chain; },
        gte(key, value) { const previous = predicate; predicate = row => previous(row) && row[key] >= value; return chain; },
        lt(key, value) { const previous = predicate; predicate = row => previous(row) && row[key] < value; return chain; },
        or(expression) { assert.equal(expression, 'is_test.is.false,is_test.is.null'); return chain; },
        order() { return chain; },
        update(value) { changes = value; return chain; },
        async maybeSingle() { return { data: structuredClone(tables[table].find(predicate) || null), error: null }; },
        then(resolve, reject) {
          const matching = tables[table].filter(predicate);
          if (changes) {
            matching.forEach(row => Object.assign(row, changes));
            if (table === 'orders' && changes.payment_status === 'paid') sequence.push('paid-commit');
          }
          return Promise.resolve({ data: structuredClone(matching), error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
    async rpc(name, args) {
      rpcs.push({ name, args }); sequence.push('fee-schema-unavailable');
      assert.equal(name, 'stage_order_usage_fee');
      return { data: null, error: { code: 'PGRST202', message: 'stage_order_usage_fee is absent before migration' } };
    },
  };
  const ledger = load('lib/order-usage-billing.ts', { 'node:crypto': crypto });
  const payments = load('lib/payments.ts', {
    'node:crypto': crypto,
    '@/lib/studio-pricing': pricing,
    '@/lib/stripe-billing-period': periods,
    '@/lib/order-payment-policy': orderPolicy,
    '@/lib/order-usage-billing': ledger,
    '@/lib/credit-maintenance': { creditMaintenanceActive },
    '@/lib/subscription-access': { isStripeBillingActive: value => ['active', 'trialing'].includes(value) },
    '@/lib/resend': { resendConfigured: () => true, resolveReplyTo: value => value,
      sendResendEmail: async message => { emails.push(message); sequence.push(message.tags[0].value); } },
    '@/lib/order-notification-email': { buildOrderNotificationEmail: () => ({ subject: 'Order confirmed', html: 'Fixture', text: 'Fixture' }) },
    '@/lib/order-receipt-email': { buildOrderReceiptEmail: () => ({ subject: 'Payment receipt', html: 'Fixture', text: 'Fixture' }) },
    '@/lib/order-push': { sendNewOrderPush: async (_service, id, content) => pushes.push({ id, content }) },
  });
  const finalize = () => payments.finalizePaidOrder(service, { orderId, paymentStatus: 'paid', checkoutSessionId: 'cs_fixture',
    paymentIntentId: 'pi_fixture', note: 'Connected-account payment confirmed', paidAt: new Date(now).toISOString() });
  return { order, photographer, sequence, emails, pushes, rpcs, finalize };
}

for (const maintenance of [true, false]) {
  test(`a paid Connect order completes notifications ${maintenance ? 'while fee sync is paused before migration' : 'when the fee ledger is unavailable'}`, async () => {
    const previousPause = process.env.STUDIO_CREDIT_MAINTENANCE;
    const previousError = console.error;
    const failures = [];
    try {
      process.env.STUDIO_CREDIT_MAINTENANCE = maintenance ? '1' : '0';
      console.error = (...args) => failures.push(args);
      const f = fixture();
      const result = await f.finalize();
      assert.equal(result.status, 'paid'); assert.equal(f.order.payment_status, 'paid'); assert.ok(f.order.paid_at);
      assert.equal(f.order.counted_for_monthly_usage, false, 'the durable order remains eligible for current-period fee reconciliation');
      assert.equal(f.rpcs.length, maintenance ? 0 : 1);
      assert.deepEqual(f.emails.map(message => [message.to, message.idempotencyKey]), [
        ['photographer@example.invalid', `order-notify-${f.order.id}`], ['buyer@example.invalid', `order-receipt-${f.order.id}`],
      ]);
      assert.equal(f.pushes.length, 1); assert.equal(f.pushes[0].id, f.photographer.id);
      assert.deepEqual(f.sequence, maintenance
        ? ['paid-commit', 'order-notification', 'order-receipt']
        : ['paid-commit', 'fee-schema-unavailable', 'order-notification', 'order-receipt']);
      assert.equal(failures.length, maintenance ? 0 : 1);
      assert.equal((await f.finalize()).payment_status, 'paid');
      assert.equal(f.emails.length, 2, 'retrying an already committed payment does not duplicate notifications');
      assert.equal(f.rpcs.length, maintenance ? 0 : 1);
    } finally {
      console.error = previousError;
      if (previousPause === undefined) delete process.env.STUDIO_CREDIT_MAINTENANCE; else process.env.STUDIO_CREDIT_MAINTENANCE = previousPause;
    }
  });
}

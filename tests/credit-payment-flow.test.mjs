import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function load(path, overrides = {}) {
  const exports = {};
  const compiled = ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', compiled)((name) => name in overrides ? overrides[name] : name.startsWith('@/') ? {} : require(name), exports);
  return exports;
}
function payments() {
  return load('lib/payments.ts', { '@/lib/studio-pricing': load('lib/studio-pricing.ts'), '@/lib/trial-config': { FREE_TRIAL_DAYS: 30 } });
}
const photographer = { id: 'studio', user_id: 'owner', stripe_platform_customer_id: 'cus_platform' };
const paidSession = {
  id: 'cs_purchase', mode: 'payment', payment_status: 'paid', customer: 'cus_platform',
  payment_intent: 'pi_purchase', amount_total: 1500, currency: 'cad',
  metadata: { billing_flow: 'credit_pack', pack_code: 'background_credits_250', photographer_id: 'studio', user_id: 'owner', credit_package_id: 'package', credits: '250', price_cents: '1500', currency: 'cad' },
};
function service({ rpcError = null, studio = photographer } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      assert.equal(table, 'photographers');
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: studio, error: null }) }) }) };
    },
    async rpc(name, args) {
      calls.push({ name, args });
      if (rpcError) return { error: rpcError };
      return { data: [{ applied: true, balance: args.p_delta ?? 0, credits_delta: args.p_delta ?? 0, photographer_id: 'studio' }], error: null };
    },
  };
}
async function stripeReads(fn, refunds = []) {
  const original = globalThis.fetch;
  const originalKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    assert.equal(options.method, 'GET');
    assert.equal(options.headers['Stripe-Account'], undefined, 'credits are paid to the platform');
    const result = url.includes('/refunds?') ? { data: refunds, has_more: false } : { id: 'pi_purchase', amount: 1500, metadata: paidSession.metadata };
    return { ok: true, text: async () => JSON.stringify(result) };
  };
  try { await fn(calls); } finally {
    globalThis.fetch = original;
    if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalKey;
  }
}

test('unpaid credit checkout never grants credits', async () => {
  const db = service();
  assert.equal(await payments().handleCreditPackCheckoutCompleted(db, { ...paidSession, payment_status: 'unpaid' }), null);
  assert.equal(db.calls.length, 0);
});

test('paid purchase validates its signed amount, currency and studio ownership before mutation', async () => {
  for (const change of [
    { amount_total: 1 }, { currency: 'usd' }, { mode: 'subscription' }, { payment_intent: null },
    { customer: 'cus_other' }, { metadata: { ...paidSession.metadata, user_id: 'other' } },
    { metadata: { ...paidSession.metadata, credits: '-250' } },
  ]) {
    const db = service();
    await assert.rejects(payments().handleCreditPackCheckoutCompleted(db, { ...paidSession, ...change }), /credit checkout/);
    assert.equal(db.calls.length, 0);
  }
});

test('credit purchase snapshots the paid offer and uses one atomic balance-and-ledger RPC', async () => {
  const db = service();
  // A session can finish after the advertised price changes.
  const oldOffer = { ...paidSession, amount_total: 1200, metadata: { ...paidSession.metadata, price_cents: '1200' } };
  await stripeReads(async () => {
    assert.deepEqual(await payments().handleCreditPackCheckoutCompleted(db, oldOffer), { photographerId: 'studio', creditsGranted: 250 });
  });
  assert.deepEqual(db.calls, [{ name: 'apply_credit_adjustment', args: {
    p_studio_id: 'owner', p_photographer_id: 'studio', p_delta: 250, p_type: 'purchase', p_source: 'purchase',
    p_description: '250 Credits purchased', p_package_id: 'package', p_source_reference_id: 'pi_purchase', p_checkout_session_id: 'cs_purchase', p_payment_intent_id: 'pi_purchase',
  } }]);
});

test('failed atomic credit write propagates so Stripe can retry', async () => {
  const db = service({ rpcError: { message: 'database unavailable' } });
  await assert.rejects(payments().handleCreditPackCheckoutCompleted(db, paidSession), { message: 'database unavailable' });
  assert.equal(db.calls.length, 1);
});

test('duplicate grant still reconciles a refund received before checkout', async () => {
  const db = service();
  db.rpc = async (name, args) => {
    db.calls.push({ name, args });
    return { data: [{ applied: false, balance: 0, credits_delta: 0, photographer_id: 'studio' }], error: null };
  };
  await stripeReads(async () => {
    assert.equal((await payments().handleCreditPackCheckoutCompleted(db, paidSession)).creditsGranted, 0);
  }, [{ id: 're_partial', amount: 750, status: 'succeeded' }, { id: 're_pending', amount: 250, status: 'pending' }, { id: 're_failed', amount: 200, status: 'failed' }]);
  assert.equal(db.calls[1].name, 'reverse_credit_purchase');
  assert.equal(db.calls[1].args.p_refunded_amount_cents, 750, 'only successful refunds reverse credits');
});

test('credit refund passes cumulative cents to the atomic proportional reversal', async () => {
  const db = service();
  await payments().handleCreditChargeRefunded(db, { id: 'ch_purchase', payment_intent: 'pi_purchase', amount: 1500, amount_refunded: 300 });
  assert.equal(db.calls[0].name, 'reverse_credit_purchase');
  assert.equal(db.calls[0].args.p_charge_amount_cents, 1500);
  assert.equal(db.calls[0].args.p_refunded_amount_cents, 300);
  await assert.rejects(payments().handleCreditChargeRefunded(db, { payment_intent: 'pi_purchase', amount: 1500, amount_refunded: 1501 }), /Invalid credit purchase refund/);
});

test('credit balance reads server expiry/debt; owner reads do not create artificial purchased credits', async () => {
  const api = payments();
  const db = { rpc: async (name, args) => {
    assert.equal(name, 'get_studio_credit_balance'); assert.equal(args.p_studio_id, 'owner');
    return { data: [{ balance: 12, expires_at: '2026-10-29T00:00:00Z', credit_debt: 3 }], error: null };
  } };
  assert.deepEqual(await api.getCreditBalanceDetails(db, 'owner', 'studio'), { balance: 12, expiresAt: '2026-10-29T00:00:00Z', creditDebt: 3 });
  assert.equal(await api.getCreditBalance(db, 'owner', 'studio'), 12);
  assert.equal(await api.getCreditBalance({}, 'owner', 'studio', { isPlatformAdmin: true }), api.OWNER_UNLIMITED_CREDIT_BALANCE);
});

function webhookHarness({ failGrant = false, failRecord = false } = {}) {
  process.env.STRIPE_WEBHOOK_SECRET = 'test-signing-secret';
  const record = new Set();
  const grants = [];
  const refunds = [];
  let grantFailure = failGrant;
  let recordFailure = failRecord;
  const api = load('app/api/stripe/webhook/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => ({}) },
    '@/lib/payments': {
      verifyStripeSignature: async () => true,
      recordStripeEvent: async (_db, event) => {
        if (recordFailure) { recordFailure = false; throw new Error('expected event ledger failure'); }
        const inserted = !record.has(event.id); record.add(event.id); return { inserted };
      },
      handleCreditPackCheckoutCompleted: async (_db, session) => {
        assert.equal(record.size, 0, 'record only after the first purchase finishes');
        if (grantFailure) { grantFailure = false; throw new Error('expected credit database failure'); }
        grants.push(session.payment_intent);
      },
      reconcileCreditRefundFromStripe: async (_db, intent) => refunds.push(intent),
      reconcileOrderRefundFromStripe: async () => null,
    },
  });
  const run = (type, object = paidSession, account) => api.POST({
    headers: new Headers({ 'stripe-signature': 'test' }), text: async () => JSON.stringify({ id: 'evt_purchase', type, account, data: { object } }),
  });
  return { record, grants, refunds, run };
}

test('connected-account metadata cannot mint platform credits or reverse platform purchases', async () => {
  for (const type of ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'charge.refunded']) {
    const h = webhookHarness();
    const object = type === 'charge.refunded' ? { payment_intent: 'pi_purchase', metadata: paidSession.metadata } : paidSession;
    assert.equal((await h.run(type, object, 'acct_photographer')).status, 200);
    assert.equal(h.grants.length, 0); assert.equal(h.refunds.length, 0);
  }
});

test('immediate and delayed platform checkout events grant credits after payment', async () => {
  for (const type of ['checkout.session.completed', 'checkout.session.async_payment_succeeded']) {
    const h = webhookHarness();
    assert.equal((await h.run(type)).status, 200);
    assert.deepEqual(h.grants, ['pi_purchase']); assert.equal(h.record.size, 1);
  }
});

test('credit failure and event-record failure leave paid purchases retryable', async () => {
  for (const options of [{ failGrant: true }, { failRecord: true }]) {
    const h = webhookHarness(options);
    assert.equal((await h.run('checkout.session.completed')).status, 500);
    assert.equal(h.record.size, 0);
    assert.equal((await h.run('checkout.session.completed')).status, 200);
    assert.equal(h.record.size, 1);
  }
});

test('platform charge and refund status events reconcile live successful refunds', async () => {
  for (const type of ['charge.refunded', 'refund.updated', 'refund.failed']) {
    const h = webhookHarness();
    assert.equal((await h.run(type, { payment_intent: 'pi_purchase' })).status, 200);
    assert.deepEqual(h.refunds, ['pi_purchase']);
  }
});

test('credits checkout return path is restricted to a server-owned destination', async () => {
  let captured;
  const api = load('app/api/stripe/billing/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/dashboard-auth': { resolveDashboardAuth: async () => ({ user: { id: 'owner' } }), createDashboardServiceClient: () => ({}) },
    '@/lib/payments': {
      getOrCreatePhotographerByUser: async () => photographer, ensurePlatformCustomer: async () => 'cus_platform',
      normalizeCreditPackCode: (code) => code === 'background_credits_250' ? code : null,
      ensureCreditPackageCatalog: async () => [{ code: 'background_credits_250', id: 'package' }],
      createCreditsCheckoutSession: async (input) => { captured = input; return { id: 'cs', url: 'https://checkout.stripe.com/test' }; },
      billingReturnUrl: (origin, marker) => `${origin}/dashboard/settings?billing=${marker}`,
    },
  });
  for (const returnTo of ['credits', 'https://evil.invalid']) {
    const response = await api.POST({ url: 'https://studio.example/api/stripe/billing', json: async () => ({ action: 'buy_credits', packCode: 'background_credits_250', returnTo }) });
    assert.equal(response.status, 200);
    assert.equal(new URL(captured.successUrl).origin, 'https://studio.example');
    assert.equal(new URL(captured.successUrl).pathname, returnTo === 'credits' ? '/credits' : '/dashboard/settings');
  }
});

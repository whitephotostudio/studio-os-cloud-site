import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const primaryId = '11111111-1111-4111-8111-111111111111';
const photographerId = '22222222-2222-4222-8222-222222222222';
const groupId = '33333333-3333-4333-8333-333333333333';
const siblingId = '44444444-4444-4444-8444-444444444444';
const schoolId = '55555555-5555-4555-8555-555555555555';

/** The actual POST handler, quote, snapshot payload and Stripe form builder run against isolated dependencies. */
function fixture(options = {}) {
  const sequence = [], quoteInputs = [], freezeCalls = [], checkoutInputs = [], stripeRequests = [];
  let locked = false;
  const row = {id: primaryId, order_group_id: options.combined ? groupId : null, photographer_id: photographerId,
    school_id: schoolId, project_id: null, student_id: null, parent_email: 'buyer@example.invalid', customer_email: null,
    package_id: null, package_name: '8x10 print', cart_snapshot: [], subtotal_cents: 1000, tax_cents: 0,
    total_cents: 1000, total_amount: 10, currency: options.currency ?? 'cad', status: 'payment_pending', payment_status: 'pending',
    stripe_checkout_session_id: options.legacySession ? 'cs_legacy' : null, stripe_payment_intent_id: null,
    paid_at: null, is_test: false, counted_for_monthly_usage: false, platform_fee_collection_method: null,
    platform_fee_amount_cents: null, platform_fee_currency: null, platform_fee_rate_cents: null};
  const rows = [row];
  if (options.combined) rows.push({...row, id: siblingId});
  if (options.storedSnapshot) rows.forEach(member => Object.assign(member, {
    status: 'checkout_starting', platform_fee_collection_method: 'connect_application_fee',
    platform_fee_amount_cents: 25, platform_fee_currency: row.currency, platform_fee_rate_cents: 25,
  }));
  const now = Date.now();
  const photographer = {id: photographerId, business_name: 'Fixture Studio', stripe_connected_account_id: 'acct_fixture',
    stripe_account_id: null, stripe_connect_onboarding_complete: true, stripe_connect_charges_enabled: true,
    stripe_connect_payouts_enabled: true, subscription_status: 'active', subscription_plan_code: options.planCode ?? 'core',
    is_platform_admin: false, created_at: new Date(now - 86_400_000).toISOString(), trial_starts_at: null, trial_ends_at: null};
  if (options.trial || options.expiredTrial) Object.assign(photographer, {
    subscription_status: 'trial', subscription_plan_code: 'core', trial_starts_at: new Date(now - 86_400_000).toISOString(),
    trial_ends_at: new Date(now + (options.expiredTrial ? -1 : 1) * 86_400_000).toISOString(),
  });
  if (options.owner) Object.assign(photographer, {is_platform_admin: true, subscription_status: null, subscription_plan_code: null});
  const tables = {orders: rows, photographers: [photographer], schools: [{id: schoolId, photographer_id: photographerId, school_name: 'Fixture school'}],
    order_items: rows.map(member => ({order_id: member.id, line_total_cents: 1000, unit_price_cents: 1000, quantity: 1, product_name: '8x10 print', sku: null})), packages: []};
  const service = {
    from(table) {
      assert.ok(table in tables, `unexpected table ${table}`);
      let predicate = () => true, changes, sortKey;
      const chain = {
        select() {return chain;},
        eq(key, value) {const before = predicate; predicate = member => before(member) && member[key] === value; return chain;},
        in(key, values) {const before = predicate; predicate = member => before(member) && values.includes(member[key]); return chain;},
        order(key) {sortKey = key; return chain;},
        update(value) {changes = value; return chain;},
        maybeSingle() {return run(true);},
        then(resolve, reject) {return run(false).then(resolve, reject);},
      };
      async function run(single) {
        let matching = tables[table].filter(predicate);
        if (sortKey) matching = [...matching].sort((a, b) => String(a[sortKey]).localeCompare(String(b[sortKey])));
        if (changes) {
          assert.equal(locked, true, 'checkout writes require the payment lock');
          sequence.push(`write:${changes.status}`);
          matching.forEach(member => Object.assign(member, changes));
        }
        return {data: structuredClone(single ? matching[0] ?? null : matching), error: null, count: matching.length};
      }
      return chain;
    },
    async rpc(name, args) {
      assert.equal(name, 'freeze_order_platform_fees'); assert.equal(locked, true);
      assert.equal(args.p_photographer_id, photographerId);
      sequence.push('freeze'); freezeCalls.push(structuredClone(args));
      assert.ok(rows.every(member => member.status === 'payment_pending'), 'snapshots precede checkout_starting');
      if (options.freezeError) return {data: null, error: new Error('fixture snapshot RPC unavailable')};
      assert.equal(args.p_snapshots.length, rows.length);
      for (const snapshot of args.p_snapshots) Object.assign(rows.find(member => member.id === snapshot.id), snapshot);
      return {data: structuredClone(rows), error: null};
    },
  };
  const cache = new Map();
  const safeProcess = {env: {STRIPE_SECRET_KEY: 'sk_test_routeFixture', STRIPE_BILLING_CURRENCY: 'cad'}};
  async function provider(target, request) {
    assert.equal(target, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(request.method, 'POST'); assert.equal(locked, true);
    sequence.push('provider-checkout');
    stripeRequests.push({headers: request.headers, params: new URLSearchParams(request.body)});
    return Response.json({id: 'cs_created', url: 'https://checkout.stripe.invalid/fixture'});
  }
  const pure = new Set(['studio-pricing', 'trial-config', 'subscription-access', 'order-payment-policy', 'order-checkout-totals', 'order-currency']);
  function load(path, overrides = {}) {
    if (cache.has(path)) return cache.get(path);
    const exports = {}; cache.set(path, exports);
    const compiled = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText;
    new Function('require', 'exports', 'process', 'fetch', 'console', compiled)(name => {
      if (name in overrides) return overrides[name];
      if (name.startsWith('@/lib/')) {
        const moduleName = name.slice('@/lib/'.length);
        return pure.has(moduleName) ? load(`lib/${moduleName}.ts`) : {};
      }
      return require(name);
    }, exports, safeProcess, provider, {error() {}, warn() {}, log() {}});
    return exports;
  }
  const actualPayments = load('lib/payments.ts');
  const dependencies = {
    'next/server': {NextResponse: {json: (value, init) => Response.json(value, init)}},
    '@/lib/dashboard-auth': {createDashboardServiceClient: () => service},
    '@/lib/order-payment-lock': {lockOrderPayment: async () => {
      assert.equal(locked, false); locked = true; sequence.push('lock');
      return async () => {sequence.push('unlock'); locked = false;};
    }},
    '@/lib/stored-order-backdrop-preflight': {assertStoredOrderBackdropCutouts: async () => {sequence.push('preflight');}},
    '@/lib/parent-cutout-preflight': {ParentCutoutPreflightError: class extends Error {}},
    '@/lib/retouching': {retouchPrintPurchaseIssue: () => null},
    '@/lib/order-checkout-totals': load('lib/order-checkout-totals.ts'),
    '@/lib/payments': {...actualPayments,
      retrieveStripeAccount: async () => ({id: 'acct_fixture', details_submitted: true, charges_enabled: true, payouts_enabled: true}),
      syncConnectState: async () => {},
      retrieveCheckoutSession: async id => ({id, status: options.legacySession === 'expired' ? 'expired' : 'open', url: 'https://checkout.stripe.invalid/legacy'}),
      quoteDirectOrderPlatformFees: async input => {sequence.push('quote'); quoteInputs.push(structuredClone(input)); return actualPayments.quoteDirectOrderPlatformFees(input);},
      createDirectOrderCheckoutSession: async input => {
        sequence.push('create-checkout'); checkoutInputs.push(structuredClone(input));
        return actualPayments.createDirectOrderCheckoutSession(input);
      },
    },
  };
  const handler = load('app/api/stripe/checkout/route.ts', dependencies);
  const invoke = extra => handler.POST({url: 'https://gallery.example.invalid/api/stripe/checkout',
    json: async () => ({orderId: primaryId, pin: 'PIN123', ...extra})});
  return {invoke, rows, sequence, quoteInputs, freezeCalls, checkoutInputs, stripeRequests, photographer};
}

test('new App order freezes the actual40c CAD quote before marking or sending Stripe Checkout', async () => {
  const f = fixture(); assert.equal((await f.invoke()).status, 200);
  assert.equal(f.freezeCalls.length, 1); assert.equal(f.freezeCalls[0].p_snapshots[0].platform_fee_amount_cents, 40);
  assert.ok(f.sequence.indexOf('freeze') < f.sequence.indexOf('write:checkout_starting'));
  assert.ok(f.sequence.indexOf('write:checkout_starting') < f.sequence.indexOf('provider-checkout'));
  assert.equal(f.checkoutInputs[0].platformFee.amountCents, 40);
  assert.equal(f.stripeRequests[0].params.get('payment_intent_data[application_fee_amount]'), '40');
  assert.equal(f.stripeRequests[0].headers['Stripe-Account'], 'acct_fixture');
  assert.equal(f.sequence.at(-1), 'unlock');
});

test('combined checkout freezes both orders once and collects80c through one charge', async () => {
  const f = fixture({combined: true}); assert.equal((await f.invoke()).status, 200);
  assert.equal(f.freezeCalls.length, 1); assert.equal(f.freezeCalls[0].p_snapshots.length, 2);
  assert.ok(f.rows.every(member => member.platform_fee_amount_cents === 40));
  assert.equal(f.stripeRequests.length, 1); assert.equal(f.stripeRequests[0].params.get('payment_intent_data[application_fee_amount]'), '80');
  assert.equal(f.stripeRequests[0].params.get('line_items[0][price_data][unit_amount]'), '2000');
});

test('an ordinary active trial uses the server-derived Studio35c rate', async () => {
  const f = fixture({trial: true}); assert.equal((await f.invoke({freeTrialActive: false, planCode: 'starter'})).status, 200);
  assert.equal(f.quoteInputs[0].freeTrialActive, true); assert.equal(f.quoteInputs[0].planCode, 'studio');
  assert.equal(f.freezeCalls[0].p_snapshots[0].platform_fee_rate_cents, 35);
  assert.equal(f.stripeRequests[0].params.get('payment_intent_data[application_fee_amount]'), '35');
});

test('expired trial rejects a client trial claim with403 before fee or provider mutations', async () => {
  const f = fixture({expiredTrial: true}); assert.equal((await f.invoke({freeTrialActive: true, isPlatformAdmin: true})).status, 403);
  assert.equal(f.quoteInputs.length, 0); assert.equal(f.freezeCalls.length, 0); assert.equal(f.checkoutInputs.length, 0);
  assert.equal(f.stripeRequests.length, 0); assert.equal(f.sequence.at(-1), 'unlock');
});

test('persisted platform owner gets a waived snapshot and no Stripe application fee', async () => {
  const f = fixture({owner: true}); assert.equal((await f.invoke()).status, 200);
  assert.equal(f.freezeCalls[0].p_snapshots[0].platform_fee_collection_method, 'waived');
  assert.equal(f.rows[0].platform_fee_amount_cents, 0); assert.equal(f.checkoutInputs[0].platformFee.amountCents, 0);
  assert.equal(f.stripeRequests[0].params.get('payment_intent_data[application_fee_amount]'), null);
  assert.equal(f.stripeRequests[0].params.get('payment_intent_data[metadata][platform_fee_collection_method]'), 'waived');
});

test('stored snapshot retry skips requoting and freezing and preserves its original25c rate', async () => {
  const f = fixture({storedSnapshot: true}); assert.equal((await f.invoke()).status, 200);
  assert.equal(f.quoteInputs.length, 0); assert.equal(f.freezeCalls.length, 0);
  assert.equal(f.checkoutInputs[0].platformFee.amountCents, 25); assert.equal(f.checkoutInputs[0].platformFee.rateCents, 25);
  assert.equal(f.stripeRequests[0].params.get('payment_intent_data[application_fee_amount]'), '25');
});

test('open legacy checkout is reused without freezing, quoting or creating another session', async () => {
  const f = fixture({legacySession: 'open'}), response = await f.invoke();
  assert.equal(response.status, 200); assert.equal((await response.json()).sessionId, 'cs_legacy');
  assert.equal(f.quoteInputs.length, 0); assert.equal(f.freezeCalls.length, 0); assert.equal(f.checkoutInputs.length, 0);
  assert.equal(f.stripeRequests.length, 0); assert.equal(f.rows[0].platform_fee_collection_method, null);
});

test('expired legacy checkout recreates a session without adding a prospective application fee', async () => {
  const f = fixture({legacySession: 'expired'}); assert.equal((await f.invoke()).status, 200);
  assert.equal(f.quoteInputs.length, 0); assert.equal(f.freezeCalls.length, 0);
  assert.equal(f.checkoutInputs[0].platformFee, undefined); assert.equal(f.checkoutInputs[0].previousExpiredSessionId, 'cs_legacy');
  assert.equal(f.stripeRequests[0].params.get('payment_intent_data[application_fee_amount]'), null);
  assert.equal(f.stripeRequests[0].params.get('payment_intent_data[metadata][platform_fee_collection_method]'), null);
});

test('snapshot RPC failure stops before checkout_starting and every Stripe request', async () => {
  const f = fixture({freezeError: true}); assert.equal((await f.invoke()).status, 500);
  assert.equal(f.freezeCalls.length, 1); assert.equal(f.checkoutInputs.length, 0); assert.equal(f.stripeRequests.length, 0);
  assert.equal(f.rows[0].platform_fee_collection_method, null); assert.equal(f.rows[0].status, 'payment_pending');
  assert.equal(f.sequence.at(-1), 'unlock');
});

test('local-currency checkouts retain the nominal40/35/55 fee without CAD conversion metadata', async () => {
  for (const [currency, planCode, fee] of [['usd', 'core', 40], ['eur', 'studio', 35], ['gbp', 'starter', 55]]) {
    const f = fixture({currency, planCode}); assert.equal((await f.invoke()).status, 200);
    assert.equal(f.rows[0].platform_fee_amount_cents, fee); assert.equal(f.rows[0].platform_fee_rate_cents, fee);
    assert.equal(f.rows[0].platform_fee_currency, currency);
    assert.equal(f.stripeRequests[0].params.get('payment_intent_data[application_fee_amount]'), String(fee));
    assert.equal(f.stripeRequests[0].params.get('line_items[0][price_data][currency]'), currency);
    assert.ok([...f.stripeRequests[0].params.keys()].every(key => !/fx_|cad_cents/.test(key)));
  }
});

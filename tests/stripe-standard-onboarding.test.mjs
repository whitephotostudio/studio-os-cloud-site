import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, overrides = {}) {
  const result = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', code)(name => name in overrides ? overrides[name] : name.startsWith('@/') ? {} : require(name), result);
  return result;
}
const envNames = ['STRIPE_STANDARD_MIGRATION_ENABLED', 'STRIPE_SECRET_KEY', 'NEXT_PUBLIC_SUPABASE_URL',
  'STRIPE_STANDARD_LIVE_MIGRATION_ENABLED', 'STRIPE_STANDARD_LIVE_CHECKOUT_ENABLED', 'STUDIO_STANDARD_EXPECTED_PLATFORM_ACCOUNT_ID',
  'STUDIO_STANDARD_SANDBOX_PLATFORM_VERIFIED', 'STUDIO_STANDARD_SANDBOX_EXPECTED_PLATFORM_ACCOUNT_ID'];
const originalEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
const paymentPolicy = load('lib/order-payment-policy.ts');
const historyModule = load('lib/stripe-connect-history.ts');
const actualPayments = load('lib/payments.ts', {'@/lib/studio-pricing': load('lib/studio-pricing.ts'), '@/lib/order-currency': load('lib/order-currency.ts')});
test.beforeEach(() => {
  for (const key of envNames) delete process.env[key];
  Object.assign(process.env, { STRIPE_STANDARD_MIGRATION_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_mock123', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' });
});
test.after(() => envNames.forEach(name => originalEnv[name] === undefined ? delete process.env[name] : process.env[name] = originalEnv[name]));
const oldAccount = { id: 'acct_old', type: 'express', country: 'CA', charges_enabled: true, payouts_enabled: true, details_submitted: true,
  capabilities: {card_payments: 'active'}, controller: {fees: {payer: 'application_express'}, losses: {payments: 'application'}, requirement_collection: 'stripe', stripe_dashboard: {type: 'express'}} };
const newAccount = { id: 'acct_new', type: 'standard', country: 'CA', charges_enabled: true, payouts_enabled: true, details_submitted: true,
  capabilities: {card_payments: 'active', transfers: 'active'}, requirements: {currently_due: [], eventually_due: [], past_due: [], pending_verification: [], errors: []},
  future_requirements: {currently_due: [], eventually_due: [], past_due: [], pending_verification: [], errors: []},
  controller: {fees: {payer: 'account'}, losses: {payments: 'stripe'}, requirement_collection: 'stripe', stripe_dashboard: {type: 'full'}} };

function fixture(options = {}) {
  const scope = historyModule.WHITEPHOTO_STANDARD_LIVE_SCOPE;
  const ownerId = options.live ? scope.userId : 'owner';
  const photographerId = options.live ? scope.photographerId : 'photographer';
  const oldId = options.live ? scope.expressAccountId : 'acct_old';
  const newId = options.live ? scope.standardAccountId : 'acct_new';
  const photographer = { id: photographerId, user_id: options.otherOwner ? 'other' : ownerId, business_name: 'Test studio', business_country: 'CA', stripe_connect_country: 'CA',
    stripe_connected_account_id: options.noCurrent ? null : oldId, stripe_account_id: options.noCurrent ? null : oldId, billing_email: 'owner@example.test',
    stripe_platform_customer_id: 'cus_subscription', stripe_subscription_id: 'sub_keep' };
  const binding = {photographer_id: photographerId, user_id: ownerId};
  const accounts = new Map([[oldId, structuredClone({...oldAccount, id: oldId, ...(options.live ? {metadata: binding} : {})})],
    [newId, structuredClone({...newAccount, id: newId, ...(options.live ? {metadata: options.unbound ? {} : binding} : {}), ...(options.accountChanges || {})})]]);
  const history = options.pending ? [{stripe_account_id: newId, photographer_id: photographerId, livemode: !!options.live, account_type: 'standard', status: 'pending'}] : [];
  if (options.rollback) history.push({stripe_account_id: oldId, photographer_id: photographerId, livemode: !!options.live, account_type: 'express', status: 'legacy'});
  const releaseControls={release_key:'whitephoto-20261015',migration_enabled:true,checkout_enabled:true,reservation_required:true,
    activation_enabled:options.activationEnabled!==false,platform_account_id:scope.platformAccountId,photographer_id:scope.photographerId,
    actor_user_id:scope.userId,express_account_id:scope.expressAccountId,standard_account_id:scope.standardAccountId,allowed_currencies:['cad','usd']};
  let intent = options.intent ? structuredClone(options.intent) : null;
  const calls = []; const activations = []; const registrations = []; const backfills = []; const lockKeys = []; const orders = structuredClone(options.orders || []);
  let authCalls = 0; let lostCreateReply = !!options.lostCreateReply; let registrationFailure = !!options.registrationFailure;
  const service = {
    from(table) {
      let predicate = () => true; let limit = Infinity; let single = false;
      const query = {select(){return query},eq(key, value){const previous = predicate; predicate = row => previous(row) && row[key] === value; return query},
        is(key, value){return query.eq(key, value)},or(){const previous = predicate; predicate = row => previous(row) && (row.stripe_checkout_session_id || row.stripe_payment_intent_id || row.status === 'checkout_starting'); return query},
        gt(key, value){const previous = predicate; predicate = row => previous(row) && row[key] > value; return query},order(){return query},limit(value){limit = value; return query},
        maybeSingle(){single = true; return query},then(resolve, reject){const data = (table === 'orders' ? orders : table === 'stripe_standard_live_release_controls' ? (options.missingControls?[]:[releaseControls]) : [photographer]).filter(predicate).sort((a,b) => a.id.localeCompare(b.id)).slice(0, limit); return Promise.resolve({data: single ? data[0] || null : structuredClone(data), count: data.length, error: null}).then(resolve, reject)}};
      return query;
    },
    async rpc(name, args) {
      calls.push({rpc: name, args});
      if (name === 'reserve_photographer_standard_intent') {
        intent ||= {id: 'intent1', stripe_account_id: null, attempted_at: new Date().toISOString(), status: 'creating', creation_params: structuredClone(args.p_creation_params)};
        intent.creation_params ||= structuredClone(args.p_creation_params);
        return {data: structuredClone(intent), error: null};
      }
      if (name === 'record_photographer_standard_intent') {
        intent.status = args.p_status; intent.stripe_account_id ||= args.p_account_id; return {data: structuredClone(intent), error: null};
      }
      throw Error(`unexpected RPC ${name}`);
    },
  };
  const historyApi = {
    WHITEPHOTO_STANDARD_LIVE_SCOPE: scope, assertStandardLiveEnvironment: historyModule.assertStandardLiveEnvironment,
    async getStripeConnectionHistory(){return structuredClone(history)},
    async getReusableStandardCandidate(){return structuredClone(history.find(row => row.account_type === 'standard' && ['pending', 'ready'].includes(row.status)) || null)},
    async registerStripeAccountCandidate(_service, input) {
      registrations.push(input);calls.push({historyRegistration:input.account.id});
      if(input.livemode)historyModule.assertStandardLiveScope({...input,accountId:input.account.id});
      if (registrationFailure && input.account.id === 'acct_new') {registrationFailure = false; throw Error('database acknowledgment unavailable')}
      let row = history.find(row => row.stripe_account_id === input.account.id);
      if (!row) { row = {stripe_account_id: input.account.id, livemode: input.livemode, account_type: input.account.type, status: input.account.id === photographer.stripe_connected_account_id ? 'active' : 'pending'}; history.push(row); }
      return structuredClone(row);
    },
    async activateStandardAccount(_service, input) {
      if(input.livemode)historyModule.assertStandardLiveScope(input);
      activations.push(input); photographer.stripe_connected_account_id = input.accountId;
      history.forEach(row => row.status = row.stripe_account_id === input.accountId ? 'active' : 'legacy');
      return {accountId: input.accountId, previousAccountId: input.expectedCurrentAccountId, routeVersion: 1};
    },
    async rollbackStandardAccount(_service, input) {if(input.livemode)historyModule.assertStandardLiveScope(input);activations.push(input); return {accountId: input.accountId, previousAccountId: input.expectedCurrentAccountId, routeVersion: 2}},
    async backfillOrderPaymentAccount(_service, input) {
      backfills.push(structuredClone(input));
      for (const row of orders.filter(row => input.orderIds.includes(row.id))) row.stripe_payment_account_binding_id = 'binding_original';
      return {attemptId: 'binding_original', accountId: input.accountId, idempotencyKey: 'verified-history-cs_legacy', routeVersion: 0};
    },
  };
  const dependencies = {
    '@/lib/dashboard-auth': {resolveDashboardAuth: async () => {authCalls++; return {user: options.signedOut ? null : {id: ownerId, email: 'owner@example.test'}, mfaSatisfied: options.unknownMfa ? undefined : !options.missingMfa}}, createDashboardServiceClient: () => service},
    '@/lib/payments': {getConnectedAccountId: row => row.stripe_connected_account_id || row.stripe_account_id || null,
      async stripeRequest(path, settings = {}) {
        calls.push({path, ...settings});
        if (path === 'account') return {id: options.wrongPlatform ? 'acct_foreign' : options.sandboxPlatformId || scope.platformAccountId};
        if (path === 'balance') return {object: 'balance', livemode: options.wrongMode ? !options.live : Boolean(options.live)};
        if (path.startsWith('accounts/')) {
          const account = accounts.get(path.split('/')[1]);
          if (!account || options.liveCurrent && path === 'accounts/acct_old') throw Error('test key cannot read a live account');
          if (settings.method === 'POST') {
            for (const [key, value] of settings.body.entries()) {
              const field = /^metadata\[(.+)\]$/.exec(key);
              assert.ok(field, 'adoption may only bind ownership metadata');
              if(!options.ignoreMetadataWrite){account.metadata ||= {}; account.metadata[field[1]] = value;}
            }
          }
          return structuredClone(account);
        }
        if (path === 'accounts') {if (lostCreateReply) {lostCreateReply = false; throw Error('accepted request but lost response')} return structuredClone(accounts.get('acct_new'))}
        if (path === 'account_links') return {url: options.badLink ? 'https://evil.example/setup' : 'https://connect.stripe.com/setup/test-link'};
        if (orders.length) {
          if (path.startsWith('application_fees/')) assert.equal(settings.account, undefined); else assert.equal(settings.account, 'acct_old');
          assert.ok(!settings.method || settings.method === 'GET', 'backfill provider traffic is read-only');
          const referencedId = path.split('/').at(-1);
          const group = orders.filter(row => row.stripe_checkout_session_id === referencedId || row.stripe_payment_intent_id === referencedId);
          const selected = group.length ? group : orders;
          const total = selected.reduce((sum,row) => sum + row.total_cents, 0);
          const metadata = {billing_flow: 'customer_order', photographer_id: 'photographer', order_id: selected[0].id,
            ...(selected[0].order_group_id ? {order_group_id: selected[0].order_group_id} : {})};
          const frozen = selected.some(row => row.platform_fee_collection_method != null) ? actualPayments.directOrderPlatformFeePayload(selected, 'cad') : null;
          if (frozen) Object.assign(metadata, actualPayments.directOrderPlatformFeeMetadata(frozen));
          if (path.startsWith('checkout/sessions/')) return {id: referencedId, mode: 'payment', status: options.open ? 'open' : 'complete', payment_status: options.open ? 'unpaid' : 'paid',
            amount_total: total, currency: 'cad', client_reference_id: metadata.order_id, payment_intent: options.sessionNoIntent ? null : 'pi_legacy', metadata, ...options.sessionChanges};
          if (path.startsWith('payment_intents/')) return {id: referencedId, status: options.open ? 'requires_payment_method' : 'succeeded', amount: total, amount_received: options.open ? 0 : total,
            application_fee_amount: frozen?.amountCents || null, currency: 'cad', latest_charge: options.open ? null : 'ch_legacy', metadata, ...options.intentChanges};
          if (path.startsWith('charges/')) return {id: referencedId, payment_intent: 'pi_legacy', amount: total, currency: 'cad', application_fee_amount: frozen?.amountCents || null,
            application_fee: frozen?.amountCents ? 'fee_legacy' : null, ...options.chargeChanges};
          if (path.startsWith('application_fees/')) return {id: referencedId, object: 'application_fee', account: 'acct_old', charge: 'ch_legacy', amount: frozen.amountCents,
            amount_refunded: 0, currency: 'cad', refunded: false, ...options.feeChanges};
        }
        throw Error(`unexpected Stripe request ${path}`);
      }},
    '@/lib/stripe-connect-country': load('lib/stripe-connect-country.ts', {'./order-currency': load('lib/order-currency.ts')}), '@/lib/stripe-connect-history': historyApi,
  };
  Object.assign(dependencies['@/lib/payments'], {directOrderPlatformFeePayload: actualPayments.directOrderPlatformFeePayload, directOrderPlatformFeeMetadata: actualPayments.directOrderPlatformFeeMetadata});
  dependencies['@/lib/order-payment-policy'] = paymentPolicy;
  dependencies['@/lib/order-payment-lock'] = {lockOrderPayment: async (_service, key) => {lockKeys.push(key); return async () => {lockKeys.push(`released:${key}`)}}};
  dependencies['@/lib/direct-order-fee-refund'] = load('lib/direct-order-fee-refund.ts', {'@/lib/payments': dependencies['@/lib/payments'], '@/lib/order-payment-policy': paymentPolicy});
  const api = load('lib/stripe-standard-connect.ts', dependencies);
  const request = (body = {}) => ({url: 'http://localhost:3000/api/stripe/standard/start', json: async () => body, headers: new Headers({authorization: 'Bearer fixture-explicit-client'})});
  return {api, request, photographer, accounts, history, calls, activations, registrations, backfills, lockKeys, orders, authCalls: () => authCalls, intent: () => intent};
}

test('default-off status does no auth, database or Stripe work; all mutations stay unavailable', async () => {
  delete process.env.STRIPE_STANDARD_MIGRATION_ENABLED;
  const f = fixture();
  assert.deepEqual(await f.api.standardConnectionStatus(f.request()), {ok: true, enabled: false});
  for (const name of ['startStandardConnection', 'activateStandardConnection', 'rollbackStandardConnection', 'backfillStandardPaymentHistory']) await assert.rejects(f.api[name](f.request()), /not enabled/);
  assert.equal(f.authCalls(), 0); assert.equal(f.calls.length, 0);
});

test('live and restricted keys, remote databases, auth/MFA and wrong owner fail before Stripe creation', async () => {
  const f = fixture();
  for (const key of ['sk_live_mock123', 'rk_test_mock123', '']) {
    process.env.STRIPE_SECRET_KEY = key;
    await assert.rejects(f.api.startStandardConnection(f.request()), /test key/);
  }
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock123'; process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://production.supabase.co';
  await assert.rejects(f.api.startStandardConnection(f.request()), /local test database/);
  assert.equal(f.authCalls(), 0); assert.equal(f.calls.length, 0);
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  for (const options of [{signedOut: true}, {missingMfa: true}, {unknownMfa: true}, {otherOwner: true}, {liveCurrent: true}]) {
    const denied = fixture(options); await assert.rejects(denied.api.startStandardConnection(denied.request()));
    assert.equal(denied.calls.filter(call => call.path === 'accounts').length, 0); assert.equal(denied.activations.length, 0);
  }
});

test('cross-origin and cookie-only mutations stop before auth, service access or provider calls', async () => {
  for (const origin of ['https://hostile.example', 'null']) {
    const f = fixture(); const request = f.request(backfillBody); request.headers.set('origin', origin);
    for (const name of ['startStandardConnection', 'activateStandardConnection', 'rollbackStandardConnection', 'backfillStandardPaymentHistory']) {
      await assert.rejects(f.api[name](request), /must come from this Studio OS page/);
    }
    assert.equal(f.authCalls(), 0); assert.equal(f.calls.length, 0);
  }
  const cookieOnly = fixture(); const missingOrigin = cookieOnly.request(); missingOrigin.headers.delete('authorization');
  await assert.rejects(cookieOnly.api.startStandardConnection(missingOrigin), /same-origin browser/);
  assert.equal(cookieOnly.authCalls(), 0);
  const sameOrigin = fixture(); const allowed = sameOrigin.request(); allowed.headers.delete('authorization'); allowed.headers.set('origin', 'http://localhost:3000');
  assert.equal((await sameOrigin.api.startStandardConnection(allowed)).accountId, 'acct_new');
});

test('hosted Standard starts a separate durable pending account without changing current account or subscription', async () => {
  const f = fixture(); const result = await f.api.startStandardConnection(f.request());
  assert.equal(result.accountId, 'acct_new'); assert.equal(result.testOnly, true);
  assert.equal(f.photographer.stripe_connected_account_id, 'acct_old'); assert.equal(f.photographer.stripe_subscription_id, 'sub_keep');
  assert.equal(f.intent().stripe_account_id, 'acct_new'); assert.equal(f.intent().status, 'registered');
  const creation = f.calls.find(call => call.path === 'accounts');
  assert.equal(creation.body.get('type'), 'standard'); assert.equal(creation.body.get('country'), 'CA');
  assert.equal(creation.idempotencyKey, 'studio-os-standard-test-intent1');
  assert.ok(f.calls.findIndex(call => call.rpc === 'reserve_photographer_standard_intent') < f.calls.indexOf(creation));
  const link = f.calls.find(call => call.path === 'account_links');
  assert.equal(link.body.get('account'), 'acct_new'); assert.equal(link.body.get('type'), 'account_onboarding');
  assert.equal(new URL(link.body.get('refresh_url')).searchParams.get('standard'), 'refresh');
});

test('lost creation reply reuses one durable idempotency key and stops after its safe retry window', async () => {
  const f = fixture({lostCreateReply: true});
  await assert.rejects(f.api.startStandardConnection(f.request()), /lost response/);
  assert.equal(f.intent().status, 'uncertain');
  f.photographer.billing_email = 'changed@example.test';
  await f.api.startStandardConnection(f.request());
  assert.deepEqual(f.calls.filter(call => call.path === 'accounts').map(call => call.idempotencyKey), ['studio-os-standard-test-intent1', 'studio-os-standard-test-intent1']);
  assert.ok(f.calls.filter(call => call.path === 'accounts').every(call => call.body.get('email') === 'owner@example.test'));
  const stale = fixture({intent: {id: 'intent_old', stripe_account_id: null, attempted_at: '2020-01-01T00:00:00Z', status: 'uncertain'}});
  await assert.rejects(stale.api.startStandardConnection(stale.request()), /needs reconciliation/);
  assert.equal(stale.calls.filter(call => call.path === 'accounts').length, 0);
});

test('known provider identity survives registry failure; retry reads the account without another creation', async () => {
  const f = fixture({registrationFailure: true}); await assert.rejects(f.api.startStandardConnection(f.request()), /database acknowledgment/);
  assert.equal(f.intent().stripe_account_id, 'acct_new');
  await f.api.startStandardConnection(f.request());
  assert.equal(f.calls.filter(call => call.path === 'accounts').length, 1);
  const badLink = fixture({badLink: true}); await assert.rejects(badLink.api.startStandardConnection(badLink.request()), /valid onboarding link/);
});

test('onboarding return/status uses fresh Stripe readiness and performs no writes or activation', async () => {
  const f = fixture({pending: true, accountChanges: {charges_enabled: false}});
  assert.equal((await f.api.standardConnectionStatus(f.request())).pending.ready, false);
  f.accounts.get('acct_new').charges_enabled = true;
  assert.equal((await f.api.standardConnectionStatus(f.request())).pending.ready, true);
  assert.equal(f.registrations.length, 0); assert.equal(f.calls.filter(call => call.rpc).length, 0); assert.equal(f.activations.length, 0);
});

test('readiness rejects wrong controller/country/live mode and blocks incomplete capabilities or requirements', () => {
  const f = fixture();
  for (const patch of [{country: 'US'}, {livemode: true}, {type: 'express'}, {controller: {...newAccount.controller, fees: {payer: 'application'}}}]) {
    assert.throws(() => f.api.standardAccountReadiness({...newAccount, ...patch}, 'CA'));
  }
  for (const patch of [{charges_enabled: false}, {payouts_enabled: false}, {details_submitted: false}, {capabilities: {card_payments: 'pending'}},
    {requirements: {currently_due: ['business_profile.url']}}, {requirements: {past_due: ['individual.verification.document']}},
    {requirements: {pending_verification: ['individual.id_number']}}, {requirements: {disabled_reason: 'requirements.past_due'}}]) {
    assert.equal(f.api.standardAccountReadiness({...newAccount, ...patch}, 'CA').ready, false);
  }
});

test('activation requires matching pending account, explicit confirmation, expected current pointer and fresh readiness', async () => {
  for (const body of [{accountId: 'acct_other', confirmed: true, expectedCurrentAccountId: 'acct_old'}, {accountId: 'acct_new', confirmed: false, expectedCurrentAccountId: 'acct_old'},
    {accountId: 'acct_new', confirmed: true, expectedCurrentAccountId: 'acct_stale'}]) {
    const f = fixture({pending: true}); await assert.rejects(f.api.activateStandardConnection(f.request(body))); assert.equal(f.activations.length, 0);
  }
  const notReady = fixture({pending: true, accountChanges: {capabilities: {card_payments: 'pending'}}});
  await assert.rejects(notReady.api.activateStandardConnection(notReady.request({accountId: 'acct_new', confirmed: true, expectedCurrentAccountId: 'acct_old'})), /verification is incomplete/);
  assert.equal(notReady.activations.length, 0);
  const f = fixture({pending: true}); const result = await f.api.activateStandardConnection(f.request({accountId: 'acct_new', confirmed: true, expectedCurrentAccountId: 'acct_old'}));
  assert.equal(result.accountId, 'acct_new'); assert.deepEqual(f.activations[0], {photographerId: 'photographer', userId: 'owner', accountId: 'acct_new', expectedCurrentAccountId: 'acct_old', livemode: false});
  assert.equal(f.photographer.stripe_subscription_id, 'sub_keep');
});

test('rollback only accepts an owned legacy test account and never moves a historical payment', async () => {
  const f = fixture({rollback: true}); f.photographer.stripe_connected_account_id = 'acct_new';
  const body = {accountId: 'acct_old', expectedCurrentAccountId: 'acct_new', confirmed: true};
  await assert.rejects(f.api.rollbackStandardConnection(f.request({...body, accountId: 'acct_foreign'})), /not available/);
  f.accounts.get('acct_old').payouts_enabled = false;
  await assert.rejects(f.api.rollbackStandardConnection(f.request(body)), /cannot currently/);
  assert.equal(f.activations.length, 0);
  f.accounts.get('acct_old').payouts_enabled = true;
  assert.equal((await f.api.rollbackStandardConnection(f.request(body))).accountId, 'acct_old');
  assert.equal(f.calls.filter(call => call.path?.includes('refund') || call.path?.includes('payment_intent')).length, 0);
});

test('HTTP handlers expose disabled/read-only status and safe errors without provider error details', async () => {
  const f = fixture({liveCurrent: true});
  const route = name => load(`app/api/stripe/standard/${name}/route.ts`, {
    'next/server': {NextResponse: {json: (body, options) => Response.json(body, options)}},
    '@/lib/stripe-standard-connect': f.api,
  });
  const start = route('start'); const status = route('status');
  const denied = await start.POST(f.request());
  assert.equal(denied.status, 409); assert.doesNotMatch(JSON.stringify(await denied.json()), /test key cannot read|acct_old|sk_test/);
  delete process.env.STRIPE_STANDARD_MIGRATION_ENABLED;
  assert.equal((await start.POST(f.request())).status, 404);
  const disabled = await status.GET(f.request());
  assert.equal(disabled.status, 200); assert.equal(disabled.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await disabled.json(), {ok: true, enabled: false});
});

const orderId = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function oldOrder(n = 1, patch = {}) {
  return {id: orderId(n), photographer_id: 'photographer', order_group_id: null, status: 'paid', payment_status: 'succeeded', paid_at: '2026-10-01T00:00:00Z',
    total_cents: 1000, total_amount: 10, currency: 'cad', stripe_checkout_session_id: 'cs_legacy', stripe_payment_intent_id: 'pi_legacy',
    stripe_payment_account_binding_id: null, platform_fee_collection_method: null, platform_fee_amount_cents: null, platform_fee_currency: null, platform_fee_rate_cents: null,
    stripe_application_fee_id: null, ...patch};
}
const backfillBody = {expectedCurrentAccountId: 'acct_old', batchSize: 10};

test('historical backfill uses original Express, locks the complete group and stores only verified immutable evidence', async () => {
  const groupId = orderId(90);
  const f = fixture({orders: [oldOrder(1, {order_group_id: groupId}), oldOrder(2, {order_group_id: groupId})]});
  const before = f.orders.map(row => ({status: row.status, payment_status: row.payment_status, fee: row.platform_fee_amount_cents}));
  const result = await f.api.backfillStandardPaymentHistory(f.request(backfillBody));
  assert.equal(result.mappedOrders, 2); assert.equal(result.mappedPayments, 1); assert.equal(result.reviewNeeded, 0);
  assert.deepEqual(f.lockKeys, [groupId, `released:${groupId}`]);
  assert.equal(f.backfills.length, 1);
  assert.deepEqual(f.backfills[0].orderIds, [orderId(1), orderId(2)]);
  assert.equal(f.backfills[0].accountId, 'acct_old'); assert.equal(f.backfills[0].amountCents, 2000);
  assert.deepEqual(Object.fromEntries(Object.entries(f.backfills[0].evidence).filter(([key]) => key !== 'verified_at')), {
    source: 'verified_stripe_get', account_id: 'acct_old', photographer_id: 'photographer', livemode: false,
    checkout_session_id: 'cs_legacy', payment_intent_id: 'pi_legacy',
  });
  assert.deepEqual(f.orders.map(row => ({status: row.status, payment_status: row.payment_status, fee: row.platform_fee_amount_cents})), before);
  assert.equal(f.photographer.stripe_connected_account_id, 'acct_old'); assert.equal(f.activations.length, 0);
  assert.ok(f.calls.filter(call => call.path).every(call => !call.method || call.method === 'GET'));
  const replay = await f.api.backfillStandardPaymentHistory(f.request(backfillBody));
  assert.equal(replay.mappedOrders, 0); assert.equal(f.backfills.length, 1);
});

test('historical backfill verifies frozen old fees and charge/application-fee ownership without repricing or refunds', async () => {
  const row = oldOrder(1, {platform_fee_collection_method: 'connect_application_fee', platform_fee_amount_cents: 40,
    platform_fee_currency: 'cad', platform_fee_rate_cents: 40, stripe_application_fee_id: 'fee_legacy'});
  const f = fixture({orders: [row]});
  assert.equal((await f.api.backfillStandardPaymentHistory(f.request(backfillBody))).mappedOrders, 1);
  assert.equal(f.orders[0].platform_fee_rate_cents, 40); assert.equal(f.orders[0].platform_fee_amount_cents, 40);
  assert.ok(f.calls.some(call => call.path === 'application_fees/fee_legacy' && !call.account));
  for (const patch of [{intentChanges: {application_fee_amount: 45}}, {feeChanges: {account: 'acct_foreign'}}, {chargeChanges: {application_fee_amount: 45}}]) {
    const bad = fixture({orders: [row], ...patch});
    const result = await bad.api.backfillStandardPaymentHistory(bad.request(backfillBody));
    assert.equal(result.reviewNeeded, 1); assert.equal(bad.backfills.length, 0); assert.equal(bad.orders[0].platform_fee_amount_cents, 40);
  }
});

test('saved references, metadata, amount/currency, test mode and original charge identity cannot be forged into history', async () => {
  for (const patch of [{sessionChanges: {id: 'cs_other'}}, {sessionChanges: {amount_total: 2000}}, {sessionChanges: {currency: 'usd'}},
    {sessionChanges: {metadata: {billing_flow: 'customer_order', photographer_id: 'other', order_id: orderId(1)}}},
    {sessionChanges: {payment_intent: 'pi_other'}}, {sessionChanges: {livemode: true}},
    {intentChanges: {id: 'pi_other'}}, {intentChanges: {amount: 2000}}, {intentChanges: {currency: 'usd'}}, {intentChanges: {livemode: true}},
    {intentChanges: {metadata: {billing_flow: 'customer_order', photographer_id: 'photographer', order_id: orderId(99)}}},
    {chargeChanges: {payment_intent: 'pi_other'}}, {chargeChanges: {amount: 2000}}, {chargeChanges: {livemode: true}},
    {chargeChanges: {paid: false, status: 'failed'}}, {sessionChanges: {status: 'open'}}, {sessionNoIntent: true}]) {
    const f = fixture({orders: [oldOrder()], ...patch}); const result = await f.api.backfillStandardPaymentHistory(f.request(backfillBody));
    assert.equal(result.reviewNeeded, 1, JSON.stringify(patch)); assert.equal(f.backfills.length, 0); assert.equal(f.orders[0].stripe_payment_account_binding_id, null);
  }
  const missingScope = fixture({orders: [oldOrder(1, {order_group_id: orderId(90)}), oldOrder(2, {order_group_id: orderId(90), photographer_id: 'other'})]});
  assert.equal((await missingScope.api.backfillStandardPaymentHistory(missingScope.request(backfillBody))).reviewNeeded, 1);
  assert.equal(missingScope.backfills.length, 0);
});

test('open and refunded historical payments stay in their original state; unknown starting attempts require review', async () => {
  const open = fixture({orders: [oldOrder(1, {status: 'payment_pending', payment_status: 'pending', paid_at: null, stripe_payment_intent_id: null})], open: true, sessionNoIntent: true});
  assert.equal((await open.api.backfillStandardPaymentHistory(open.request(backfillBody))).mappedOrders, 1);
  assert.equal(open.backfills[0].paymentIntentId, null); assert.equal(open.orders[0].status, 'payment_pending');
  const refunded = fixture({orders: [oldOrder(1, {status: 'refunded', payment_status: 'refunded'})]});
  assert.equal((await refunded.api.backfillStandardPaymentHistory(refunded.request(backfillBody))).mappedOrders, 1);
  assert.equal(refunded.orders[0].status, 'refunded');
  const unknown = fixture({orders: [oldOrder(1, {status: 'checkout_starting', payment_status: 'pending', paid_at: null, stripe_checkout_session_id: null, stripe_payment_intent_id: null})]});
  assert.equal((await unknown.api.backfillStandardPaymentHistory(unknown.request(backfillBody))).reviewNeeded, 1);
  assert.equal(unknown.backfills.length, 0); assert.equal(unknown.orders[0].status, 'checkout_starting');
  assert.equal(unknown.calls.filter(call => call.path?.startsWith('checkout/') || call.path?.startsWith('payment_intents/')).length, 0);
});

test('failed frozen-fee attempts can preserve original routing without inventing a collected application fee', async () => {
  const row = oldOrder(1, {status: 'payment_failed', payment_status: 'failed', paid_at: null, platform_fee_collection_method: 'connect_application_fee',
    platform_fee_amount_cents: 40, platform_fee_currency: 'cad', platform_fee_rate_cents: 40});
  const patches = {sessionChanges: {payment_status: 'unpaid'}, intentChanges: {status: 'requires_payment_method', amount_received: 0},
    chargeChanges: {status: 'failed', paid: false, captured: false, application_fee: null, application_fee_amount: 40}};
  const f = fixture({orders: [row], ...patches});
  assert.equal((await f.api.backfillStandardPaymentHistory(f.request(backfillBody))).mappedOrders, 1);
  assert.equal(f.orders[0].status, 'payment_failed'); assert.equal(f.orders[0].platform_fee_amount_cents, 40);
  assert.ok(!f.calls.some(call => call.path?.startsWith('application_fees/')));
  const wrong = fixture({orders: [row], ...patches, intentChanges: {...patches.intentChanges, amount_received: 10}});
  assert.equal((await wrong.api.backfillStandardPaymentHistory(wrong.request(backfillBody))).reviewNeeded, 1);
  assert.equal(wrong.backfills.length, 0);
});

test('history backfill has bounded pagination and cannot activate, change a route or bypass missing MFA', async () => {
  const patch = {status: 'checkout_starting', payment_status: 'pending', paid_at: null, stripe_checkout_session_id: null, stripe_payment_intent_id: null};
  const f = fixture({orders: [oldOrder(1, patch), oldOrder(2, patch)]});
  const first = await f.api.backfillStandardPaymentHistory(f.request({...backfillBody, batchSize: 1}));
  assert.equal(first.hasMore, true); assert.equal(first.nextCursor, orderId(1)); assert.equal(first.reviewRequired[0].orderId, orderId(1));
  const second = await f.api.backfillStandardPaymentHistory(f.request({...backfillBody, batchSize: 1, afterOrderId: first.nextCursor}));
  assert.equal(second.hasMore, false); assert.equal(second.reviewRequired[0].orderId, orderId(2));
  const missingMfa = fixture({orders: [oldOrder()], unknownMfa: true});
  await assert.rejects(missingMfa.api.backfillStandardPaymentHistory(missingMfa.request(backfillBody)), /two-factor/);
  assert.equal(missingMfa.calls.length, 0);
  await assert.rejects(f.api.backfillStandardPaymentHistory(f.request({...backfillBody, batchSize: 26})), /1–25/);
  await assert.rejects(f.api.backfillStandardPaymentHistory(f.request({...backfillBody, expectedCurrentAccountId: 'acct_stale'})), /Refresh/);
  f.photographer.stripe_standard_migrated_at = '2026-10-13T00:00:00Z';
  await assert.rejects(f.api.backfillStandardPaymentHistory(f.request(backfillBody)), /before the first switch/);
  assert.equal(f.activations.length, 0);
});


const liveScope=historyModule.WHITEPHOTO_STANDARD_LIVE_SCOPE;
function enableLive(){
  Object.assign(process.env,{STRIPE_STANDARD_MIGRATION_ENABLED:'true',STRIPE_STANDARD_LIVE_MIGRATION_ENABLED:'true',
    STRIPE_STANDARD_LIVE_CHECKOUT_ENABLED:'true',STUDIO_STANDARD_EXPECTED_PLATFORM_ACCOUNT_ID:liveScope.platformAccountId,
    STRIPE_SECRET_KEY:'sk_live_mock123',NEXT_PUBLIC_SUPABASE_URL:`https://${liveScope.projectRef}.supabase.co`});
}
const liveAdoptionBody=()=>({accountId:liveScope.standardAccountId,expectedCurrentAccountId:liveScope.expressAccountId,confirmed:true});
const liveRollbackBody=()=>({accountId:liveScope.expressAccountId,expectedCurrentAccountId:liveScope.standardAccountId,confirmed:true});
function assertNoCommercialWrites(f){
  assert.equal(f.calls.filter(call=>call.path==='accounts'||call.path==='account_links'||call.path?.includes('refund')||call.path?.includes('payment_intent')||call.path?.includes('subscriptions')).length,0);
  assert.equal(f.photographer.stripe_subscription_id,'sub_keep');assert.equal(f.photographer.stripe_platform_customer_id,'cus_subscription');
}
function assertFreshProof(input,accountId){
  assert.deepEqual({photographerId:input.photographerId,userId:input.userId,livemode:input.livemode},
    {photographerId:liveScope.photographerId,userId:liveScope.userId,livemode:true});
  assert.equal(input.providerProof.platformAccountId,liveScope.platformAccountId);assert.equal(input.providerProof.accountId,accountId);
  assert.equal(input.providerProof.livemode,true);assert.ok(Date.now()-Date.parse(input.providerProof.verifiedAt)<5000);
}

test('live context fails closed on incorrect platform, mode, owner and incomplete MFA before account mutations',async()=>{
  enableLive();
  for(const options of [{wrongPlatform:true},{wrongMode:true},{otherOwner:true},{missingMfa:true},{unknownMfa:true},{signedOut:true}]){
    const f=fixture({live:true,...options});
    await assert.rejects(()=>f.api.startStandardConnection(f.request(liveAdoptionBody())));
    assert.equal(f.calls.filter(call=>call.method==='POST').length,0);assert.equal(f.registrations.length,0);assert.equal(f.activations.length,0);
  }
  for(const key of ['STRIPE_STANDARD_LIVE_CHECKOUT_ENABLED','STUDIO_STANDARD_EXPECTED_PLATFORM_ACCOUNT_ID','STRIPE_STANDARD_MIGRATION_ENABLED']){
    const previous=process.env[key];delete process.env[key];const f=fixture({live:true});
    await assert.rejects(()=>f.api.startStandardConnection(f.request(liveAdoptionBody())),/disabled|unverified/);
    assert.equal(f.authCalls(),0);assert.equal(f.calls.length,0);process.env[key]=previous;
  }
});

test('live status is GET-only and an unbound candidate cannot claim migration readiness',async()=>{
  enableLive();const f=fixture({live:true,unbound:true});
  const result=await f.api.standardConnectionStatus(f.request());
  assert.equal(result.testOnly,false);assert.equal(result.currentAccountId,liveScope.expressAccountId);
  assert.equal(result.pending.accountId,liveScope.standardAccountId);assert.equal(result.pending.status,'unbound');
  assert.equal(result.pending.ready,false);assert.equal(result.pending.ownershipBound,false);
  assert.equal(f.calls.filter(call=>call.method==='POST'||call.rpc).length,0);assert.equal(f.registrations.length,0);assert.equal(f.activations.length,0);
  assertNoCommercialWrites(f);
});

test('live adoption accepts only the explicit existing Standard identity and preserves the Express route',async()=>{
  enableLive();
  for(const body of [
    {...liveAdoptionBody(),accountId:'acct_other'}, {...liveAdoptionBody(),expectedCurrentAccountId:'acct_other'},
    {...liveAdoptionBody(),confirmed:false}, {},
  ]){
    const f=fixture({live:true,unbound:true});await assert.rejects(()=>f.api.startStandardConnection(f.request(body)),/Confirm WhitePhoto/);
    assert.equal(f.registrations.length,0);assert.equal(f.calls.filter(call=>call.method==='POST').length,0);assertNoCommercialWrites(f);
  }
  const f=fixture({live:true,unbound:true});const result=await f.api.startStandardConnection(f.request(liveAdoptionBody()));
  assert.equal(result.accountId,liveScope.standardAccountId);assert.equal(result.ownershipBound,true);assert.equal(result.testOnly,false);
  assert.equal(f.photographer.stripe_connected_account_id,liveScope.expressAccountId);assert.equal(f.photographer.stripe_account_id,liveScope.expressAccountId);
  const mutation=f.calls.find(call=>call.method==='POST');assert.equal(mutation.path,`accounts/${liveScope.standardAccountId}`);
  assert.deepEqual([...mutation.body.keys()].sort(),['metadata[photographer_id]','metadata[studio_os_migration]','metadata[user_id]']);
  const mutationIndex=f.calls.indexOf(mutation),verifiedIndex=f.calls.findIndex((call,index)=>index>mutationIndex&&call.path===mutation.path&&!call.method);
  const registrationIndex=f.calls.findIndex(call=>call.historyRegistration===liveScope.standardAccountId);
  assert.ok(verifiedIndex>mutationIndex&&registrationIndex>verifiedIndex,'Metadata must be reread from Stripe before history registration');
  assert.equal(f.activations.length,0);assert.equal(f.intent(),null);assertNoCommercialWrites(f);
  for(const registered of f.registrations)assertFreshProof(registered,registered.account.id);
  f.calls.length=0;await f.api.startStandardConnection(f.request(liveAdoptionBody()));
  assert.equal(f.calls.filter(call=>call.method==='POST').length,0,'An already verified ownership binding needs no repeated provider write');
});

test('live adoption refuses conflicting ownership and refuses an unacknowledged metadata binding',async()=>{
  enableLive();
  for(const metadata of [{photographer_id:'other'},{user_id:'other'},{studio_os_migration:'other-release'}]){
    const f=fixture({live:true,accountChanges:{metadata}});
    await assert.rejects(()=>f.api.startStandardConnection(f.request(liveAdoptionBody())),/conflicting ownership/);
    assert.equal(f.calls.filter(call=>call.method==='POST').length,0);assert.equal(f.registrations.filter(row=>row.account.id===liveScope.standardAccountId).length,0);
    assert.equal(f.activations.length,0);assertNoCommercialWrites(f);
  }
  const f=fixture({live:true,unbound:true,ignoreMetadataWrite:true});
  await assert.rejects(()=>f.api.startStandardConnection(f.request(liveAdoptionBody())),/did not verify/);
  assert.equal(f.registrations.filter(row=>row.account.id===liveScope.standardAccountId).length,0);assert.equal(f.activations.length,0);
  assert.equal(f.photographer.stripe_connected_account_id,liveScope.expressAccountId);assertNoCommercialWrites(f);
});

test('live activation verifies current and candidate ownership, readiness and fresh provider proof',async()=>{
  enableLive();
  for(const patch of [
    {capabilities:{card_payments:'active',transfers:'pending'}},{requirements:{currently_due:['individual.id_number']}},
    {requirements:{errors:[{code:'verification_failed'}]}},{future_requirements:{pending_verification:['individual.id_number']}},
    {requirements:undefined},{requirements:{}},{future_requirements:undefined},{future_requirements:{}},
    {future_requirements:{...newAccount.future_requirements,currently_due:null}},
    {metadata:{photographer_id:'other',user_id:liveScope.userId}},
  ]){
    const f=fixture({live:true,pending:true,accountChanges:patch});
    await assert.rejects(()=>f.api.activateStandardConnection(f.request(liveAdoptionBody())));
    assert.equal(f.activations.length,0);assert.equal(f.photographer.stripe_connected_account_id,liveScope.expressAccountId);assertNoCommercialWrites(f);
  }
  const wrongOriginal=fixture({live:true,pending:true});wrongOriginal.accounts.get(liveScope.expressAccountId).metadata.user_id='other';
  await assert.rejects(()=>wrongOriginal.api.activateStandardConnection(wrongOriginal.request(liveAdoptionBody())),/ownership/);
  assert.equal(wrongOriginal.activations.length,0);assert.equal(wrongOriginal.registrations.length,0);
  const f=fixture({live:true,pending:true});const result=await f.api.activateStandardConnection(f.request(liveAdoptionBody()));
  assert.equal(result.accountId,liveScope.standardAccountId);assert.equal(f.activations.length,1);assertFreshProof(f.activations[0],liveScope.standardAccountId);
  const originalRegistration=f.registrations.find(row=>row.account.id===liveScope.expressAccountId);
  assert.ok(originalRegistration);assertFreshProof(originalRegistration,liveScope.expressAccountId);
  const targetRegistration=f.registrations.find(row=>row.account.id===liveScope.standardAccountId);assertFreshProof(targetRegistration,liveScope.standardAccountId);
  assert.equal(f.calls.filter(call=>call.method==='POST').length,0);assertNoCommercialWrites(f);
});

test('live rollback is restricted to the owned original Express account and carries fresh provider proof',async()=>{
  enableLive();const f=fixture({live:true,rollback:true});f.photographer.stripe_connected_account_id=liveScope.standardAccountId;
  for(const body of [{...liveRollbackBody(),accountId:'acct_other'},{...liveRollbackBody(),confirmed:false},{...liveRollbackBody(),expectedCurrentAccountId:liveScope.expressAccountId}]){
    await assert.rejects(()=>f.api.rollbackStandardConnection(f.request(body)));assert.equal(f.activations.length,0);
  }
  const original=f.accounts.get(liveScope.expressAccountId);original.metadata.user_id='other';
  await assert.rejects(()=>f.api.rollbackStandardConnection(f.request(liveRollbackBody())),/ownership/);assert.equal(f.activations.length,0);
  original.metadata.user_id=liveScope.userId;original.payouts_enabled=false;
  await assert.rejects(()=>f.api.rollbackStandardConnection(f.request(liveRollbackBody())),/cannot currently/);assert.equal(f.activations.length,0);
  original.payouts_enabled=true;
  const result=await f.api.rollbackStandardConnection(f.request(liveRollbackBody()));assert.equal(result.accountId,liveScope.expressAccountId);
  assertFreshProof(f.activations[0],liveScope.expressAccountId);assert.equal(f.calls.filter(call=>call.method==='POST').length,0);assertNoCommercialWrites(f);
});

test('claimable sandbox access needs a local database, verified marker and exact sandbox platform preflight',async()=>{
  process.env.STRIPE_SECRET_KEY='rkcs_test_ephemeral';
  let f=fixture({sandboxPlatformId:'acct_sandbox'});
  await assert.rejects(()=>f.api.startStandardConnection(f.request()),/test key|sandbox/);assert.equal(f.calls.length,0);
  process.env.STUDIO_STANDARD_SANDBOX_PLATFORM_VERIFIED='true';
  f=fixture({sandboxPlatformId:'acct_sandbox'});
  await assert.rejects(()=>f.api.startStandardConnection(f.request()),/sandbox|platform|test key/);assert.equal(f.calls.length,0);
  process.env.STUDIO_STANDARD_SANDBOX_EXPECTED_PLATFORM_ACCOUNT_ID='acct_sandbox';
  for(const options of [{wrongPlatform:true},{wrongMode:true}]){
    const denied=fixture({sandboxPlatformId:'acct_sandbox',...options});
    await assert.rejects(()=>denied.api.startStandardConnection(denied.request()),/sandbox|platform|environment/);
    assert.equal(denied.calls.filter(call=>call.method==='POST').length,0);assert.equal(denied.registrations.length,0);
  }
  f=fixture({sandboxPlatformId:'acct_sandbox'});const result=await f.api.startStandardConnection(f.request());
  assert.equal(result.testOnly,true);assert.deepEqual(f.calls.slice(0,2).map(call=>call.path),['account','balance']);
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://remote.supabase.co';
  const remote=fixture({sandboxPlatformId:'acct_sandbox'});await assert.rejects(()=>remote.api.startStandardConnection(remote.request()),/local test database/);
  assert.equal(remote.calls.length,0);
});

test('a photographer outside the live pilot gets a hidden migration panel and cannot mutate the authorized connection',async()=>{
  enableLive();const f=fixture({live:true});f.photographer.id='another-photographer';
  const route=load('app/api/stripe/standard/status/route.ts',{
    'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)}},'@/lib/stripe-standard-connect':f.api,
  });
  const response=await route.GET(f.request());assert.equal(response.status,403);assert.equal((await response.json()).enabled,false);
  await assert.rejects(()=>f.api.startStandardConnection(f.request(liveAdoptionBody())),/restricted/);
  assert.equal(f.calls.length,0);assert.equal(f.registrations.length,0);assert.equal(f.activations.length,0);
});

test('live preparation status exposes activation disabled while verified ownership and Express routing stay intact',async()=>{
  enableLive();const f=fixture({live:true,pending:true,activationEnabled:false});
  const status=await f.api.standardConnectionStatus(f.request());
  assert.equal(status.activationAvailable,false);assert.equal(status.pending.ready,true);assert.equal(status.pending.ownershipBound,true);
  assert.equal(status.currentAccountId,liveScope.expressAccountId);assert.equal(status.feePolicy,'saved_subscription_and_frozen_order');
  assert.equal(f.calls.filter(call=>call.method==='POST'||call.rpc).length,0);assert.equal(f.registrations.length,0);assert.equal(f.activations.length,0);
  assertNoCommercialWrites(f);
});

test('live status fails closed when the service-only activation control is absent',async()=>{
  enableLive();const f=fixture({live:true,pending:true,missingControls:true});
  const route=load('app/api/stripe/standard/status/route.ts',{
    'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)}},'@/lib/stripe-standard-connect':f.api,
  });
  const response=await route.GET(f.request());assert.equal(response.status,503);const body=await response.json();
  assert.equal(body.ok,false);assert.equal(body.activationAvailable,undefined);
  assert.equal(f.calls.filter(call=>call.method==='POST'||call.rpc).length,0);assert.equal(f.activations.length,0);assertNoCommercialWrites(f);
});

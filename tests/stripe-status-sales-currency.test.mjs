import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as pricing from '../lib/studio-pricing.ts';
import { connectCountry } from './helpers/stripe-connect-country.mjs';

const compiled = ts.transpileModule(readFileSync(new URL('../app/api/stripe/status/route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

/** Execute the real status handler with isolated Connect and subscription responses. */
function fixture({ subscription = false, country = 'US', savedCountry = null, providerFailure = false, mfaSatisfied, catalogSnapshot, noCurrent=false, accountChanges={},signupResult=null,signupFailure=false, subscriptionCurrency='cad', subscriptionCurrencyFailure=false } = {}) {
  const stored = { id: 'studio-fixture', user_id: 'owner-fixture', business_name: 'Fixture studio',
    billing_currency: 'eur', stripe_connected_account_id: noCurrent?null:'acct_fixture', stripe_account_id: null,
    stripe_subscription_id: subscription ? 'sub_fixture' : null, studio_id: null,
    stripe_platform_customer_id: null, subscription_status: 'active', subscription_plan_code: 'core',
    stripe_connect_onboarding_complete: false, stripe_connect_charges_enabled: false,
    stripe_connect_payouts_enabled: false, is_platform_admin: false, business_country: savedCountry };
  const connectCalls = [], subscriptionInputs = [], usageInputs = [];
  let serviceCalls = 0,providerCalls=0;const signupCalls=[];let currentSignup=signupResult;
  const service = { from: () => assert.fail('Unexpected direct database access in the status fixture') };
  const payments = {
    ...pricing,
    DEFAULT_BILLING_CURRENCY: 'cad', FREE_TRIAL_DAYS: 30, ORDER_USAGE_RATE_CENTS: 35,
    getOrCreatePhotographerByUser: async () => structuredClone(stored),
    getConnectedAccountId: photographer => photographer.stripe_connected_account_id || photographer.stripe_account_id,
    retrieveStripeAccount: async accountId => {
      providerCalls++;assert.equal(accountId, 'acct_fixture');
      if (providerFailure) throw new Error('Fixture provider unavailable');
      return { id: accountId, country, default_currency: 'usd', details_submitted: true, charges_enabled: true,
        payouts_enabled: true, requirements: { disabled_reason: null },...accountChanges };
    },
    syncConnectState: async (actualService, photographerId, account) => {
      assert.equal(actualService, service); assert.equal(photographerId, stored.id);
      connectCalls.push(structuredClone(account));
      // The separately tested payments helper updates provider flags, preserving sales currency.
      Object.assign(stored, { stripe_connected_account_id: account.id, stripe_account_id: account.id,
        stripe_connect_onboarding_complete: true, stripe_connect_charges_enabled: true,
        stripe_connect_payouts_enabled: true });
    },
    retrieveStripeSubscription: async id => {
      assert.equal(id, 'sub_fixture');
      return { id, status: 'active', items: { data: [{ price: { currency: 'cad' } }] } };
    },
    syncSubscriptionStateFromStripe: async (actualService, photographer, actualSubscription) => {
      assert.equal(actualService, service); assert.equal(actualSubscription.id, 'sub_fixture');
      subscriptionInputs.push(structuredClone(photographer));
      return { photographer: { ...photographer, subscription_status: actualSubscription.status } };
    },
    resolveSubscriptionCurrency: async (photographer, actualSubscription) => {
      assert.equal(photographer.id, stored.id);
      if (subscription) assert.equal(actualSubscription.id, 'sub_fixture');
      if (subscriptionCurrencyFailure) throw new Error('Select your business country before subscribing.');
      return subscriptionCurrency;
    },
    getCreditBalanceDetails: async () => ({ balance: 0, expiresAt: null, creditDebt: 0 }),
    ensureCreditPackageCatalog: async () => [],
    getUsageSummaryForCurrentPeriod: async (actualService, photographer) => {
      assert.equal(actualService, service); usageInputs.push(structuredClone(photographer));
      return { countedOrders: 0, billableOrders: 0, unreportedOrders: 0, estimatedChargeCents: 0, billingPeriodKey: null };
    },
    describeConnectStatus: () => ({ label: 'Connected', message: 'Ready for payments.', readyForPayments: true }),
    isStripeBillingActive: status => status === 'active',
    resolveFreeTrialEndsAt: () => null, isFreeTrialActive: () => false,
    isFreeTrialExpired: () => false, getFreeTrialDaysRemaining: () => 0,
  };
  const modules = {
    'next/server': { NextResponse: { json: (value, init) => Response.json(value, init) } },
    '@/lib/credit-maintenance': { creditMaintenanceActive: () => false },
    '@/lib/r2': { hasR2Config: () => false },
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => { serviceCalls++; return service; },
      resolveDashboardAuth: async () => ({ user: { id: stored.user_id, email: 'owner@example.invalid' }, mfaSatisfied }) },
    '@/lib/payments': payments,
    '@/lib/stripe-standard-signup': {refreshStandardSignupForPhotographer:async(actualService,input)=>{
      assert.equal(actualService,service);assert.equal(input.userId,stored.user_id);signupCalls.push(input);
      if(signupFailure)throw new Error('signup verification interrupted');
      if(!currentSignup)return{handled:false,account:null,photographer:input.photographer,pending:false,blocked:false,active:false};
      const photographer={...input.photographer,...currentSignup.photographer};
      if(currentSignup.active&&currentSignup.account){photographer.stripe_connected_account_id=currentSignup.account.id;photographer.stripe_account_id=currentSignup.account.id;Object.assign(stored,photographer);}
      return{...currentSignup,photographer};
    }},
    '@/lib/studio-pricing': {...pricing, getPricingCatalogSnapshot: currency => {
      const snapshot = catalogSnapshot ?? pricing.getPricingCatalogSnapshot();
      return {...snapshot, currency: currency || snapshot.currency};
    }},
    '@/lib/stripe-connect-country': connectCountry,
  };
  const api = {};
  new Function('require', 'exports', 'process', 'fetch', compiled)(name => {
    assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name];
  }, api, { env: {} }, () => assert.fail('No live provider request is permitted'));
  return { invoke: () => api.GET({}), stored, connectCalls, subscriptionInputs, usageInputs, get serviceCalls() { return serviceCalls; },get providerCalls(){return providerCalls;},signupCalls,setSignupResult:value=>{currentSignup=value;} };
}

test('actual status refresh retains EUR sales currency when the connected account defaults to USD', async () => {
  const f = fixture();
  const response = await f.invoke();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(f.connectCalls.length, 1);
  assert.equal(f.connectCalls[0].default_currency, 'usd');
  assert.equal(body.billingCurrency, 'eur');
  assert.equal(f.stored.billing_currency, 'eur');
  assert.equal(f.usageInputs[0].billing_currency, 'eur');
  assert.equal(body.billingCatalog.currency, 'cad', 'platform subscriptions retain their own catalog currency');
  assert.equal(body.connectReadyForPayments, true);
  assert.equal(body.onboardingComplete, true);
  assert.deepEqual(body.warnings, []);
});

test('localized subscription status keeps its currency separate from sales and CAD credits', async () => {
  for (const subscriptionCurrency of ['cad', 'usd', 'aud', 'gbp']) {
    const f = fixture({ subscriptionCurrency });
    const body = await (await f.invoke()).json();
    assert.equal(body.subscriptionCurrency, subscriptionCurrency);
    assert.equal(body.billingCatalog.currency, subscriptionCurrency);
    assert.equal(body.billingCurrency, 'eur');
    assert.equal(body.creditCurrency, 'cad');
    assert.equal(body.billingCatalog.creditCurrency, 'cad');
    assert.equal(f.stored.billing_currency, 'eur');
    assert.equal(body.subscriptionCountryRequired, false);
  }
});

test('unknown subscription country does not block CAD credit catalog or advertise a subscription currency', async () => {
  const f = fixture({ subscriptionCurrencyFailure: true });
  const body = await (await f.invoke()).json();
  assert.equal(body.ok, true);
  assert.equal(body.subscriptionCurrency, null);
  assert.equal(body.subscriptionCountryRequired, true);
  assert.equal(body.creditCurrency, 'cad');
  assert.equal(body.billingCurrency, 'eur');
  assert.match(body.warnings.join(' '), /business country/);
});

test('actual status refresh passes selected EUR to subscription and usage sync despite USD Connect and CAD subscription', async () => {
  const f = fixture({ subscription: true });
  const response = await f.invoke();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(f.subscriptionInputs.length, 1);
  assert.equal(f.subscriptionInputs[0].billing_currency, 'eur');
  assert.equal(f.usageInputs[0].billing_currency, 'eur');
  assert.equal(body.billingCurrency, 'eur');
  assert.equal(body.billingCatalog.currency, 'cad');
  assert.equal(body.subscriptionIsActive, true);
  assert.deepEqual(body.warnings, []);
});

test('status exposes the real Stripe country and flags a saved-country mismatch for support review', async () => {
  const f = fixture({ country: 'CA', savedCountry: 'US' });
  const body = await (await f.invoke()).json();
  assert.equal(body.businessCountry, 'US'); assert.equal(body.stripeAccountCountry, 'CA');
  assert.equal(body.businessCountryLocked, true); assert.equal(body.connectReadyForPayments, false);
  assert.equal(body.onboardingComplete, false); assert.equal(body.connectStatusLabel, 'Needs review');
  assert.match(body.connectStatusMessage, /registered in CA/); assert.equal(f.connectCalls.length, 0);
});

test('missing country and unavailable provider cannot advertise cached payment readiness', async () => {
  for (const options of [{ country: null }, { providerFailure: true }]) {
    const f = fixture(options);
    Object.assign(f.stored, { stripe_connect_onboarding_complete: true, stripe_connect_charges_enabled: true, stripe_connect_payouts_enabled: true });
    const body = await (await f.invoke()).json();
    assert.equal(body.connectReadyForPayments, false); assert.equal(body.chargesEnabled, false); assert.equal(body.payoutsEnabled, false);
    assert.equal(body.onboardingComplete, false); assert.equal(body.connectStatusLabel, 'Needs review');
    assert.equal(f.connectCalls.length, 0);
  }
});

test('billing status denies an incomplete MFA session before service or provider access', async () => {
  const f = fixture({ mfaSatisfied: false, subscription: true });
  const response = await f.invoke(); assert.equal(response.status, 403);
  const body = await response.json(); assert.match(body.message, /two-factor/);
  assert.equal(f.serviceCalls, 0); assert.equal(f.connectCalls.length, 0); assert.equal(f.subscriptionInputs.length, 0);
  assert.equal(body.connectReadyForPayments, false); assert.equal(body.photographerId, null);
});

test('status returns the enabled server catalog without replacing the subscriber legacy meter rate', async () => {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../lib/studio-pricing.ts', import.meta.url), 'utf8'),
    {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  new Function('exports', 'process', source)(exports, {env: {STUDIO_GALLERY_PRICING_V2_ENABLED: '1'}});
  const f = fixture({catalogSnapshot: exports.getPricingCatalogSnapshot()});
  f.stored.order_usage_rate_cents = 25;
  const body = await (await f.invoke()).json();
  assert.equal(body.orderUsageRateCents, 25, 'actual historical billing state is separate from prospective fees');
  assert.equal(body.billingCatalog.pricingProfile, 'gallery_v2');
  assert.equal(body.billingCatalog.annualDiscountPercent, null);
  assert.equal(body.billingCatalog.galleryStoragePolicy, 'existing');
  assert.deepEqual(body.billingCatalog.plans.map(plan => [plan.priceCents, plan.annualPriceCents, plan.usageRateCents, plan.orderFeeScope]),
    [[5900, 59900, 0, 'none'], [9900, 106920, 45, 'production_orders'], [19900, 214920, 45, 'production_orders']]);
  assert.deepEqual(body.billingCatalog.plans.map(plan => plan.annualSavingsPercent), [15.4, 10, 10]);
});

test('status returns all-order profile and 55/45/45 rates while preserving subscriber historical state', async () => {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../lib/studio-pricing.ts', import.meta.url), 'utf8'),
    {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  new Function('exports', 'process', source)(exports, {env: {STUDIO_GALLERY_PRICING_V3_ENABLED: '1'}});
  const f = fixture({catalogSnapshot: exports.getPricingCatalogSnapshot()});
  f.stored.order_usage_rate_cents = 25;
  const body = await (await f.invoke()).json();
  assert.equal(body.orderUsageRateCents, 25);
  assert.equal(body.billingCatalog.pricingProfile, 'gallery_v3');
  assert.equal(body.billingCatalog.galleryStoragePolicy, 'existing');
  assert.deepEqual(body.billingCatalog.plans.map(plan => [plan.priceCents, plan.annualPriceCents, plan.usageRateCents, plan.orderFeeScope]),
    [[5900, 59900, 55, 'all_paid_orders'], [9900, 106920, 45, 'all_paid_orders'], [19900, 214920, 45, 'all_paid_orders']]);
});

const readyStandard=()=>({id:'acct_fixture',object:'account',type:'standard',country:'US',default_currency:'usd',details_submitted:true,charges_enabled:true,payouts_enabled:true,controller:{fees:{payer:'account'},losses:{payments:'stripe'},requirement_collection:'stripe',stripe_dashboard:{type:'full'}},capabilities:{card_payments:'active',transfers:'active'},requirements:{disabled_reason:null,currently_due:[],eventually_due:[],past_due:[],pending_verification:[],errors:[]},future_requirements:{disabled_reason:null,currently_due:[],eventually_due:[],past_due:[],pending_verification:[],errors:[]}});
test('owned incomplete Standard signup remains pending and a returned onboarding URL alone cannot advertise readiness',async()=>{const account={...readyStandard(),details_submitted:false,charges_enabled:false,payouts_enabled:false};const f=fixture({noCurrent:true,mfaSatisfied:true,signupResult:{handled:true,account,pending:true,blocked:false,active:false}});const body=await(await f.invoke()).json();assert.equal(body.stripeAccountId,null);assert.equal(body.stripePendingAccountId,'acct_fixture');assert.equal(body.stripeAccountType,'standard');assert.equal(body.stripeDashboardType,'full');assert.equal(body.onboardingComplete,false);assert.equal(body.connectReadyForPayments,false);assert.equal(body.connectStatusLabel,'Setup in progress');assert.equal(f.signupCalls.length,1);assert.equal(f.providerCalls,0);assert.equal(f.connectCalls.length,0);});
test('existing ready signup can first-activate through the shared refresh helper with new creation disabled',async()=>{const f=fixture({noCurrent:true,mfaSatisfied:true,signupResult:{handled:true,account:readyStandard(),pending:false,blocked:false,active:true}});const body=await(await f.invoke()).json();assert.equal(body.stripeAccountId,'acct_fixture');assert.equal(body.stripePendingAccountId,null);assert.equal(body.stripeAccountType,'standard');assert.equal(body.stripeDashboardType,'full');assert.equal(body.onboardingComplete,true);assert.equal(body.connectReadyForPayments,true);assert.equal(f.signupCalls.length,1);assert.equal(f.providerCalls,0,'reuse the freshly verified account instead of another provider GET');assert.equal(f.connectCalls.length,1);assert.equal(body.billingCurrency,'eur');});
test('Standard readiness requires complete current/future requirements and correct controller/capabilities',async()=>{for(const patch of [{future_requirements:undefined},{requirements:{...readyStandard().requirements,pending_verification:['due']}},{future_requirements:{...readyStandard().future_requirements,eventually_due:['due']}},{capabilities:{card_payments:'inactive',transfers:'active'}},{controller:{...readyStandard().controller,fees:{payer:'application'}}}]){const f=fixture({accountChanges:{...readyStandard(),...patch}}),body=await(await f.invoke()).json();assert.equal(body.stripeAccountType,'standard');assert.equal(body.onboardingComplete,false);assert.equal(body.connectReadyForPayments,false);assert.equal(body.connectStatusLabel,'Needs verification');}});
test('revoked signup or failed owned signup refresh cannot reuse cached readiness or provider fallback',async()=>{for(const options of [{signupFailure:true},{signupResult:{handled:true,account:readyStandard(),pending:false,blocked:true,active:false}}]){const f=fixture({mfaSatisfied:true,...options});Object.assign(f.stored,{stripe_connect_onboarding_complete:true,stripe_connect_charges_enabled:true,stripe_connect_payouts_enabled:true});const body=await(await f.invoke()).json();assert.equal(body.connectReadyForPayments,false);assert.equal(body.onboardingComplete,false);assert.equal(body.chargesEnabled,false);assert.equal(body.payoutsEnabled,false);assert.equal(f.providerCalls,0);assert.equal(f.connectCalls.length,0);}});


test('verified Australian and UK accounts expose their actual business country without altering sales currency',async()=>{
 for(const country of ['AU','GB']){const f=fixture({country});const response=await f.invoke();assert.equal(response.status,200);const body=await response.json();assert.equal(body.businessCountry,country);assert.equal(body.stripeAccountCountry,country);assert.equal(body.billingCurrency,'eur');assert.equal(f.stored.billing_currency,'eur');}
});

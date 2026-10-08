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
function fixture({ subscription = false, country = 'US', savedCountry = null, providerFailure = false, mfaSatisfied } = {}) {
  const stored = { id: 'studio-fixture', user_id: 'owner-fixture', business_name: 'Fixture studio',
    billing_currency: 'eur', stripe_connected_account_id: 'acct_fixture', stripe_account_id: null,
    stripe_subscription_id: subscription ? 'sub_fixture' : null, studio_id: null,
    stripe_platform_customer_id: null, subscription_status: 'active', subscription_plan_code: 'core',
    stripe_connect_onboarding_complete: false, stripe_connect_charges_enabled: false,
    stripe_connect_payouts_enabled: false, is_platform_admin: false, business_country: savedCountry };
  const connectCalls = [], subscriptionInputs = [], usageInputs = [];
  let serviceCalls = 0;
  const service = { from: () => assert.fail('Unexpected direct database access in the status fixture') };
  const payments = {
    ...pricing,
    DEFAULT_BILLING_CURRENCY: 'cad', FREE_TRIAL_DAYS: 30, ORDER_USAGE_RATE_CENTS: 35,
    getOrCreatePhotographerByUser: async () => structuredClone(stored),
    getConnectedAccountId: photographer => photographer.stripe_connected_account_id || photographer.stripe_account_id,
    retrieveStripeAccount: async accountId => {
      assert.equal(accountId, 'acct_fixture');
      if (providerFailure) throw new Error('Fixture provider unavailable');
      return { id: accountId, country, default_currency: 'usd', details_submitted: true, charges_enabled: true,
        payouts_enabled: true, requirements: { disabled_reason: null } };
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
    '@/lib/stripe-connect-country': connectCountry,
  };
  const api = {};
  new Function('require', 'exports', 'process', 'fetch', compiled)(name => {
    assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name];
  }, api, { env: {} }, () => assert.fail('No live provider request is permitted'));
  return { invoke: () => api.GET({}), stored, connectCalls, subscriptionInputs, usageInputs, get serviceCalls() { return serviceCalls; } };
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

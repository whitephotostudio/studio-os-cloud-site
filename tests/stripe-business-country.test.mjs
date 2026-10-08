import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import * as pricing from '../lib/studio-pricing.ts';
import { connectCountry } from './helpers/stripe-connect-country.mjs';

const photographerId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const paymentsCompiled = compile('../lib/payments.ts');
const connectCompiled = compile('../app/api/stripe/connect/route.ts');
const profileCompiled = compile('../app/api/stripe/business-profile/route.ts');
const migration = readFileSync(new URL('../supabase/migrations/20261008200000_explicit_stripe_business_country.sql', import.meta.url), 'utf8');

async function fixture(context, { existing = false, accountCountry = null } = {}) {
  const db = new PGlite();
  context.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.photographers (
      id uuid primary key, user_id uuid, business_name text, brand_color text, logo_url text,
      billing_email text, studio_email text, studio_id uuid, billing_currency text default 'cad',
      stripe_account_id text, stripe_connected_account_id text,
      stripe_connect_onboarding_complete boolean default false,
      stripe_connect_charges_enabled boolean default false, stripe_connect_payouts_enabled boolean default false,
      stripe_subscription_id text, subscription_status text default 'active', is_platform_admin boolean default false
    );`);
  const insert = () => db.query('insert into photographers(id,user_id,business_name,brand_color,billing_email) values($1,$2,$3,$4,$5)',
    [photographerId, userId, 'Fixture studio', '#0f172a', 'owner@example.invalid']);
  if (existing) await insert();
  await db.exec(migration);
  if (!existing) await insert();
  if (accountCountry) await db.query("update photographers set stripe_connected_account_id='acct_existing', stripe_account_id='acct_existing' where id=$1", [photographerId]);
  const calls = [];
  const accounts = new Map(accountCountry ? [['acct_existing', { id: 'acct_existing', country: accountCountry }]] : []);
  let providerCountryOverride;
  let failAccountLink = false;
  let loseCreationResponse = false;
  const savedKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture_intercepted';
  context.after(() => { if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = savedKey; });

  const service = {
    from(table) {
      assert.equal(table, 'photographers');
      let values; const filters = [];
      const result = async () => {
        const params = []; let sql = 'select * from photographers';
        if (values) {
          sql = `update photographers set ${Object.entries(values).map(([key, value]) => { assert.match(key, /^[a-z_]+$/); params.push(value); return `${key}=$${params.length}`; }).join(',')}`;
        }
        if (filters.length) sql += ` where ${filters.map(([key, value]) => { assert.match(key, /^[a-z_]+$/); params.push(value); return `${key}=$${params.length}`; }).join(' and ')}`;
        if (values) sql += ' returning *';
        const response = await db.query(sql, params);
        return { data: response.rows[0] || null, error: null };
      };
      const chain = { select() { return chain; }, eq(key, value) { filters.push([key, value]); return chain; },
        update(update) { values = update; return chain; }, maybeSingle: result,
        then(resolve, reject) { return result().then(resolve, reject); } };
      return chain;
    },
    async rpc(name, args) {
      assert.ok(['configure_photographer_payment_profile', 'sync_photographer_connect_state'].includes(name));
      try {
        const values = Object.values(args);
        const result = await db.query(`select public.${name}(${values.map((_, index) => `$${index + 1}`).join(',')}) as result`, values);
        return { data: result.rows[0].result, error: null };
      } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
    },
  };
  const dependencies = {
    '@/lib/studio-pricing': pricing, '@/lib/stripe-connect-country': connectCountry,
    '@/lib/order-currency': {}, '@/lib/trial-config': { FREE_TRIAL_DAYS: 30 },
    '@/lib/subscription-access': { isStripeBillingActive: status => status === 'active' },
  };
  const payments = {};
  new Function('require', 'exports', 'fetch', paymentsCompiled)(name => dependencies[name] || {}, payments, async (target, options) => {
    assert.equal(new URL(target).origin, 'https://api.stripe.com', 'all provider requests are intercepted');
    const path = new URL(target).pathname.replace('/v1/', '');
    const params = new URLSearchParams(options.body);
    calls.push({ path, method: options.method, params, key: options.headers['Idempotency-Key'] });
    let response;
    if (path === 'accounts' && options.method === 'POST') {
      assert.equal(params.get('type'), 'express');
      assert.equal(params.get('business_type'), null, 'Stripe collects the legal business type');
      const account = accounts.get('acct_created') || { id: 'acct_created', country: providerCountryOverride || params.get('country') };
      accounts.set(account.id, account); response = account;
      if (loseCreationResponse) { loseCreationResponse = false; throw new Error('Fixture lost creation response'); }
    } else if (path.startsWith('accounts/') && options.method === 'GET') {
      response = accounts.get(path.split('/')[1]); assert.ok(response);
    } else if (path === 'account_links') {
      if (failAccountLink) throw new Error('Fixture account link unavailable');
      assert.ok(accounts.has(params.get('account')));
      response = { object: 'account_link', url: 'https://connect.stripe.invalid/fixture' };
    } else assert.fail(`Unexpected intercepted provider request ${path}`);
    return { ok: true, text: async () => JSON.stringify({ details_submitted: true, charges_enabled: true, payouts_enabled: true, ...response }) };
  });
  let signedIn = true;
  let mfaSatisfied;
  let serviceCalls = 0;
  const routeDependencies = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => { serviceCalls++; return service; },
      resolveDashboardAuth: async () => ({ user: signedIn ? { id: userId, email: 'owner@example.invalid' } : null, mfaSatisfied }) },
    '@/lib/payments': payments, '@/lib/stripe-connect-country': connectCountry,
  };
  const connect = {}, profile = {};
  for (const [compiled, route] of [[connectCompiled, connect], [profileCompiled, profile]]) {
    new Function('require', 'exports', compiled)(name => { assert.ok(name in routeDependencies, name); return routeDependencies[name]; }, route);
  }
  const invoke = (route, body) => route.POST({ url: 'https://example.invalid/api/stripe/connect', json: async () => body });
  return { db, calls, payments, service, connect: body => invoke(connect, body), profile: body => invoke(profile, body),
    row: async () => (await db.query('select * from photographers where id=$1', [photographerId])).rows[0],
    overrideCountry: country => { providerCountryOverride = country; },
    failLink: value => { failAccountLink = value; }, loseNextCreationResponse: () => { loseCreationResponse = true; },
    signOut: () => { signedIn = false; }, requireMfa: () => { mfaSatisfied = false; }, get serviceCalls() { return serviceCalls; } };
}

test('new US business connects in US, defaults sales to USD, and retains CAD subscription catalog', async context => {
  const f = await fixture(context);
  const response = await f.connect({ businessCountry: 'us', salesCurrency: 'cad', salesCurrencyExplicit: false });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).stripeAccountCountry, 'US');
  const row = await f.row();
  assert.equal(row.billing_currency, 'usd'); assert.equal(row.business_country, 'US'); assert.equal(row.stripe_connect_country, 'US');
  assert.equal(f.calls.find(call => call.path === 'accounts').params.get('country'), 'US');
  assert.equal(f.payments.DEFAULT_BILLING_CURRENCY, 'cad');
});

test('explicit CAD sales choice for a US business is preserved and cannot infer Canada', async context => {
  const f = await fixture(context);
  assert.equal((await f.connect({ businessCountry: 'US', salesCurrency: 'cad', salesCurrencyExplicit: true })).status, 200);
  assert.equal((await f.row()).billing_currency, 'cad');
  assert.equal(f.calls.find(call => call.path === 'accounts').params.get('country'), 'US');
});

test('legacy Canada account and EUR sales survive status sync and reopening onboarding', async context => {
  const f = await fixture(context, { existing: true, accountCountry: 'CA' });
  await f.db.exec("update photographers set billing_currency='eur'");
  assert.equal((await f.connect({})).status, 200);
  const row = await f.row();
  assert.equal(row.billing_currency, 'eur'); assert.equal(row.business_country, 'CA'); assert.equal(row.sales_currency_configured, true);
  assert.equal(f.calls.filter(call => call.path === 'accounts').length, 0);
});

test('missing, unsupported or malformed selections fail without Stripe account creation', async context => {
  const f = await fixture(context);
  for (const body of [{}, { salesCurrency: 'usd', salesCurrencyExplicit: true }, { businessCountry: 'GB' }, { businessCountry: 1 }, { businessCountry: 'US', salesCurrency: 'jpy' },
    { businessCountry: 'US', salesCurrencyExplicit: 'false' }]) {
    assert.ok((await f.connect(body)).status >= 400);
  }
  assert.equal(f.calls.length, 0); assert.equal((await f.row()).stripe_connected_account_id, null);
});

test('existing Canadian Stripe account rejects US selection without replacing or deleting the account', async context => {
  const f = await fixture(context, { existing: true, accountCountry: 'CA' });
  const before = await f.row();
  const response = await f.connect({ businessCountry: 'US' });
  assert.equal(response.status, 409); assert.match((await response.json()).message, /registered in CA/);
  assert.deepEqual(await f.row(), before); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].method, 'GET');
});

test('an unexpected provider country is refused before an account link or enabled flags', async context => {
  const f = await fixture(context);
  f.overrideCountry('CA');
  assert.equal((await f.connect({ businessCountry: 'US' })).status, 409);
  const row = await f.row();
  assert.equal(row.stripe_connected_account_id, 'acct_created', 'retain identity for support review instead of creating again');
  assert.equal(row.stripe_connect_charges_enabled, false);
  assert.equal(f.calls.filter(call => call.path === 'account_links').length, 0);
});

test('failed onboarding-link request keeps the reserved country and retries the original account', async context => {
  const f = await fixture(context);
  f.failLink(true);
  assert.equal((await f.connect({ businessCountry: 'US' })).status, 500);
  assert.equal((await f.connect({ businessCountry: 'CA' })).status, 409);
  f.failLink(false);
  assert.equal((await f.connect({ businessCountry: 'US' })).status, 200);
  const creates = f.calls.filter(call => call.path === 'accounts');
  assert.equal(creates.length, 1); assert.equal(creates[0].key, `studio-os-connect-account-${photographerId}`);
});

test('lost provider creation response keeps country reserved and retries the same idempotent request', async context => {
  const f = await fixture(context);
  f.loseNextCreationResponse();
  assert.equal((await f.connect({ businessCountry: 'US' })).status, 500);
  const uncertain = await f.row();
  assert.equal(uncertain.stripe_connected_account_id, null); assert.equal(uncertain.stripe_connect_country, 'US');
  assert.equal((await f.connect({ businessCountry: 'CA' })).status, 409);
  assert.equal((await f.connect({ businessCountry: 'US' })).status, 200);
  const creates = f.calls.filter(call => call.path === 'accounts');
  assert.equal(creates.length, 2); assert.equal(creates[0].key, creates[1].key);
  assert.equal(creates[0].params.toString(), creates[1].params.toString());
  assert.equal((await f.row()).stripe_connected_account_id, 'acct_created');
});

test('saving and reloading an unconnected payment profile retains country/default without creating an account', async context => {
  const f = await fixture(context);
  const response = await f.profile({ businessCountry: 'US', salesCurrencyExplicit: false });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).salesCurrency, 'usd');
  const reloaded = await f.row(); assert.equal(reloaded.business_country, 'US'); assert.equal(reloaded.billing_currency, 'usd');
  assert.equal(reloaded.stripe_connected_account_id, null); assert.equal(f.calls.length, 0);
});

test('country reservation and authenticated-client protections are enforced by the real migration', async context => {
  const f = await fixture(context);
  const configure = (country, reserve) => f.service.rpc('configure_photographer_payment_profile', {
    p_photographer_id: photographerId, p_business_country: country, p_sales_currency: null, p_currency_explicit: false, p_reserve_connect: reserve,
  });
  assert.equal((await configure('US', true)).error, null);
  assert.equal((await configure('CA', true)).error.code, '23514');
  await f.db.exec('grant select,insert,update on photographers to authenticated; set role authenticated;');
  await assert.rejects(f.db.exec("update photographers set business_country='CA'"), /Save payment country settings/);
  await assert.rejects(f.db.exec("update photographers set stripe_connected_account_id='acct_other'"), /Save payment country settings/);
  await assert.rejects(f.db.exec("insert into photographers(id,stripe_account_id) values('30000000-0000-4000-8000-000000000001','acct_other')"), /Save payment country settings/);
  await assert.rejects(f.db.exec("select configure_photographer_payment_profile('10000000-0000-4000-8000-000000000001','CA',null,false,false)"), /permission denied/);
  await f.db.exec("update photographers set billing_currency='eur'; reset role;");
  assert.equal((await f.row()).sales_currency_configured, true, 'legacy direct currency selection counts as explicit');
});

test('signed-out profile and onboarding requests cannot reach providers or write country settings', async context => {
  const f = await fixture(context); f.signOut(); const before = await f.row();
  assert.equal((await f.profile({ businessCountry: 'US' })).status, 401);
  assert.equal((await f.connect({ businessCountry: 'US' })).status, 401);
  assert.deepEqual(await f.row(), before); assert.equal(f.calls.length, 0);
});

test('incomplete MFA cannot initialize a service client, save a payment profile, or begin onboarding', async context => {
  const f = await fixture(context); const before = await f.row(); f.requireMfa();
  assert.equal((await f.profile({ businessCountry: 'US' })).status, 403);
  assert.equal((await f.connect({ businessCountry: 'US' })).status, 403);
  assert.equal(f.serviceCalls, 0); assert.equal(f.calls.length, 0); assert.deepEqual(await f.row(), before);
});

test('read-only deployment schema guard verifies the installed schema and is service-only', async context => {
  const f = await fixture(context);
  const expected = { version: 1, columns_ready: true, country_constraints_ready: true, atomic_profile_guard_ready: true,
    connect_sync_guard_ready: true, client_country_guard_ready: true, service_only: true };
  await f.db.exec('set role service_role');
  assert.deepEqual((await f.db.query('select stripe_business_profile_schema_status() as status')).rows[0].status, expected);
  await f.db.exec('reset role; set role authenticated');
  await assert.rejects(f.db.exec('select stripe_business_profile_schema_status()'), /permission denied/);
  await f.db.exec('reset role; alter table photographers disable trigger protect_photographer_payment_country');
  assert.equal((await f.db.query('select stripe_business_profile_schema_status() as status')).rows[0].status.client_country_guard_ready, false);
});

import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { verifyFinancialSandbox, FinancialSandboxVerificationError } from '../scripts/verify-financial-sandbox.mjs';

const ref = 'tttttttttttttttttttt';
const token = (role, project = ref) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role, ref: project })).toString('base64url')}.fixture`;
const env = {
  STUDIO_FINANCIAL_SANDBOX_VERIFY: '1', VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'codex/credit-system-audit-20260929',
  STRIPE_SECRET_KEY: 'sk_test_sandboxFixture123',
  STRIPE_PLATFORM_WEBHOOK_SECRET: 'whsec_platformFixture123', STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_connectFixture123',
  STUDIO_SANDBOX_EXPECTED_PROJECT_REF: ref, NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: token('anon'), SUPABASE_SERVICE_ROLE_KEY: token('service_role'),
  STUDIO_SANDBOX_EXPECTED_APP_ORIGIN: 'https://isolated-studio-fixture.vercel.app',
  STUDIO_SANDBOX_EXPECTED_STRIPE_ACCOUNT_ID: 'acct_sandboxFixture',
  STUDIO_SANDBOX_PLATFORM_WEBHOOK_ID: 'we_platformFixture', STUDIO_SANDBOX_CONNECT_WEBHOOK_ID: 'we_connectFixture',
};
const platform = { id: env.STUDIO_SANDBOX_PLATFORM_WEBHOOK_ID, livemode: false, status: 'enabled', application: null,
  url: `${env.STUDIO_SANDBOX_EXPECTED_APP_ORIGIN}/api/stripe/webhook`, enabled_events: ['*'] };
const connect = { ...platform, id: env.STUDIO_SANDBOX_CONNECT_WEBHOOK_ID };
const migrationNames = ['20260930010000_atomic_credit_accounting.sql', '20260930012000_protect_photographer_billing.sql',
  '20260930013000_cloud_credit_jobs.sql', '20260930100000_order_usage_fee_ledger.sql', '20260930120000_paid_cutout_entitlements.sql'];
const sql = (await Promise.all(migrationNames.map(name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')))).join('\n');
// Use actual migration ACLs, not a regex that grants every declared function
// to every mocked API role. PGlite models SQL privileges, not hosted Auth/RLS.
async function roleSchemas() {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$select null::uuid$$;
      create table photographers(id uuid primary key,user_id uuid not null unique,is_platform_admin boolean not null default false,
        created_at timestamptz default now(),trial_starts_at timestamptz,subscription_current_period_start timestamptz,subscription_current_period_end timestamptz);
      create table credit_packages(id uuid primary key);
      create table studio_credits(id uuid primary key default gen_random_uuid(),studio_id uuid not null unique,photographer_id uuid,
        balance integer not null default 0 check(balance>=0),total_purchased integer not null default 0,total_used integer not null default 0,updated_at timestamptz default now());
      create table credit_transactions(id uuid primary key default gen_random_uuid(),studio_id uuid not null,photographer_id uuid,
        type text not null check(type in ('purchase','usage','refund','monthly_included')),amount integer not null,balance_after integer not null,
        description text,package_id uuid references credit_packages(id),created_at timestamptz default now(),credits_delta integer,
        credit_transaction_type text,source text,source_reference_id text,stripe_checkout_session_id text,stripe_payment_intent_id text,
        ai_operation text,processing_method text,photo_path text);
      create table orders(id uuid primary key,photographer_id uuid,paid_at timestamptz,payment_status text,refund_status text,
        is_test boolean,total_cents integer,counted_for_monthly_usage boolean default false,monthly_usage_billing_period text);`);
    await db.exec(sql);
    const privileges = (await db.query(`select p.proname as name,
      has_function_privilege('service_role',p.oid,'execute') as service,
      has_function_privilege('authenticated',p.oid,'execute') as authenticated,
      has_function_privilege('anon',p.oid,'execute') as anon
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`)).rows;
    const schemaFor = role => ({ paths: Object.fromEntries(privileges.filter(row => row[role]).map(row => [`/rpc/${row.name}`, { post: {} }])) });
    return { service: schemaFor('service'), authenticated: schemaFor('authenticated'), privileges };
  } finally { await db.close(); }
}
const schemas = await roleSchemas();
const schema = schemas.service;

function fixture(overrides = {}) {
  const calls = [], logs = [];
  const fetcher = async (target, options) => {
    const url = new URL(target);
    calls.push({ url, options });
    assert.equal(options.method, 'GET', 'sandbox preparation must not create, alter or fulfill financial objects');
    assert.equal(options.body, undefined);
    assert.equal(options.redirect, 'error', 'secrets must never follow redirected destinations');
    assert.ok(options.signal instanceof AbortSignal);
    let data;
    if (url.origin === 'https://api.stripe.com') {
      assert.equal(options.headers.Authorization, `Bearer ${env.STRIPE_SECRET_KEY}`);
      if (url.pathname === '/v1/account') data = { id: env.STUDIO_SANDBOX_EXPECTED_STRIPE_ACCOUNT_ID };
      else if (url.pathname === '/v1/balance') data = { object: 'balance', livemode: false, available: [{ amount: 999999 }] };
      else if (url.pathname === `/v1/webhook_endpoints/${platform.id}`) data = platform;
      else if (url.pathname === `/v1/webhook_endpoints/${connect.id}`) data = connect;
      else if (url.pathname === '/v1/events/evt_sample') data = { id: 'evt_sample', object: 'event', livemode: false,
        type: 'checkout.session.completed', data: { object: { object: 'checkout.session', livemode: false } } };
      else assert.fail('unexpected Stripe sandbox request');
    } else {
      assert.equal(url.origin, env.NEXT_PUBLIC_SUPABASE_URL);
      assert.equal(options.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
      assert.equal(options.headers.Authorization, `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
      assert.ok(url.pathname.startsWith('/rest/v1/'));
      if (url.pathname === '/rest/v1/') data = schema;
      else if (url.searchParams.has('livemode')) {
        assert.equal(url.pathname, '/rest/v1/stripe_events');
        assert.equal(url.searchParams.get('livemode'), 'eq.true');
        assert.equal(url.searchParams.get('limit'), '1');
        assert.equal(url.searchParams.get('select'), 'id');
        data = [];
      } else {
        assert.equal(url.searchParams.get('limit'), '0', 'schema checks must not download customer table contents');
        data = [];
      }
    }
    const override = overrides[url.pathname];
    if (typeof override === 'function') return override(data, url);
    return Response.json(override ?? data);
  };
  return { calls, logs, fetcher, report: value => logs.push(value) };
}

test('sandbox verifier defaults off even when the ambient environment has production keys', async () => {
  const result = await verifyFinancialSandbox({ STRIPE_SECRET_KEY: 'sk_live_fixture', VERCEL_ENV: 'production' }, {
    fetcher: () => assert.fail('disabled verifier must not use production credentials'), report: () => assert.fail('must not log') });
  assert.deepEqual(result, { enabled: false });
});

test('production metadata, live keys, inherited release mutations and wrong branches refuse before network', async () => {
  for (const change of [{ VERCEL_ENV: 'production' }, { VERCEL_ENV: 'development' }, { VERCEL_ENV: undefined },
    { VERCEL_GIT_COMMIT_REF: 'main' }, { STRIPE_SECRET_KEY: 'sk_live_fixture' }, { STRIPE_SECRET_KEY: 'rk_live_fixture' },
    { STRIPE_SECRET_KEY: '[SENSITIVE]' }, { NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_fixture' },
    { STUDIO_PAYMENT_RELEASE_VERIFY: '1' }, { STUDIO_CREDIT_WEBHOOK_CONFIGURE: '1' },
    { STUDIO_PAYMENT_REFUND_WEBHOOK_ID: 'we_production' }]) {
    await assert.rejects(verifyFinancialSandbox({ ...env, ...change }, { fetcher: () => assert.fail('must reject before any request') }),
      FinancialSandboxVerificationError);
  }
});

test('production database, project aliases and mismatched public/service JWTs refuse before network', async () => {
  for (const change of [
    { STUDIO_SANDBOX_EXPECTED_PROJECT_REF: 'bwqhzczxoevouiondjak', NEXT_PUBLIC_SUPABASE_URL: 'https://bwqhzczxoevouiondjak.supabase.co' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://bwqhzczxoevouiondjak.supabase.co' },
    { DATABASE_URL: 'postgres://fixture:withheld@db.bwqhzczxoevouiondjak.supabase.co/postgres' },
    { SUPABASE_SERVICE_ROLE_KEY: token('service_role', 'bwqhzczxoevouiondjak') },
    { NEXT_PUBLIC_SUPABASE_ANON_KEY: token('service_role') },
    { SUPABASE_SERVICE_ROLE_KEY: token('anon') },
    { NEXT_PUBLIC_SUPABASE_URL: `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/` },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://credentials:withheld@tttttttttttttttttttt.supabase.co' },
  ]) await assert.rejects(verifyFinancialSandbox({ ...env, ...change }, { fetcher: () => assert.fail('must reject before any request') }), FinancialSandboxVerificationError);
});

test('production origins, aliases, duplicate endpoints and mixed legacy webhook secrets refuse before network', async () => {
  for (const change of [{ STUDIO_SANDBOX_EXPECTED_APP_ORIGIN: 'https://studiooscloud.com' },
    { STUDIO_SANDBOX_EXPECTED_APP_ORIGIN: 'https://www.studiooscloud.com' },
    { STUDIO_SANDBOX_EXPECTED_APP_ORIGIN: 'https://sandbox.studiooscloud.com' },
    { NEXT_PUBLIC_SITE_URL: 'https://studiooscloud.com' },
    { APP_URL: 'https://another-sandbox.vercel.app' },
    { STRIPE_WEBHOOK_SECRET: 'whsec_oldLiveSecret' },
    { STRIPE_CONNECT_WEBHOOK_SECRET: env.STRIPE_PLATFORM_WEBHOOK_SECRET },
    { STUDIO_SANDBOX_CONNECT_WEBHOOK_ID: env.STUDIO_SANDBOX_PLATFORM_WEBHOOK_ID },
    { STUDIO_SANDBOX_EVENT_IDS: 'evt_sample,evt_sample' },
    { STUDIO_SANDBOX_EVENT_IDS: 'evt_path/escape' },
  ]) await assert.rejects(verifyFinancialSandbox({ ...env, ...change }, { fetcher: () => assert.fail('must reject before any request') }), FinancialSandboxVerificationError);
});

test('complete sandbox verification uses bounded GETs and leaves checkout and signing unverified', async () => {
  const f = fixture();
  const result = await verifyFinancialSandbox({ ...env, STUDIO_SANDBOX_EVENT_IDS: 'evt_sample' }, f);
  assert.equal(result.financialMutations, 0);
  assert.equal(result.databaseMutations, 0);
  assert.equal(result.externalCheckoutVerified, false);
  assert.equal(result.webhookSigningSecretVerified, false);
  assert.equal(result.authOnboardingVerified, false);
  assert.equal(result.authenticatedCreditRpcVerified, false);
  assert.equal(result.rlsPoliciesVerified, false);
  assert.equal(f.calls.length, 23);
  assert.equal(f.calls.filter(call => call.url.searchParams.get('limit') === '0').length, 16);
  assert.equal(f.logs.length, 2);
  for (const sensitive of [env.STRIPE_SECRET_KEY, env.SUPABASE_SERVICE_ROLE_KEY, env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    env.STRIPE_PLATFORM_WEBHOOK_SECRET, env.STRIPE_CONNECT_WEBHOOK_SECRET, env.NEXT_PUBLIC_SUPABASE_URL,
    env.STUDIO_SANDBOX_EXPECTED_APP_ORIGIN, env.STUDIO_SANDBOX_EXPECTED_STRIPE_ACCOUNT_ID, '999999']) {
    assert.ok(!f.logs.join('').includes(sensitive));
  }
});

test('modern project keys are accepted but still target only the explicit isolated URL', async () => {
  const f = fixture();
  const modern = { ...env, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fixture', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_fixture' };
  await verifyFinancialSandbox(modern, { ...f, fetcher: (url, options) => {
    if (url.startsWith(env.NEXT_PUBLIC_SUPABASE_URL)) {
      assert.equal(options.headers.apikey, modern.SUPABASE_SERVICE_ROLE_KEY);
      const parsed = new URL(url);
      return Promise.resolve(Response.json(parsed.pathname === '/rest/v1/' ? schema : []));
    }
    return f.fetcher(url, options);
  } });
});

test('live/unknown Stripe balance and wrong account identity stop before database access', async () => {
  for (const override of [{ '/v1/balance': { object: 'balance', livemode: true } },
    { '/v1/balance': { object: 'balance' } }, { '/v1/account': { id: 'acct_wrong' } }]) {
    const f = fixture(override);
    await assert.rejects(verifyFinancialSandbox(env, f), /balance|account/);
    assert.ok(f.calls.every(call => call.url.origin === 'https://api.stripe.com'));
  }
});

test('live webhooks, wrong destinations, Connect platform mix and missing events refuse', async () => {
  for (const endpoint of [{ ...platform, livemode: true }, { ...platform, livemode: undefined },
    { ...platform, url: 'https://studiooscloud.com/api/stripe/webhook' },
    { ...platform, url: `${env.STUDIO_SANDBOX_EXPECTED_APP_ORIGIN}/api/stripe/webhook?production=1` },
    { ...platform, application: 'ca_connectApplication' },
    { ...platform, status: 'disabled' }, { ...platform, enabled_events: ['checkout.session.completed'] }]) {
    const f = fixture({ [`/v1/webhook_endpoints/${platform.id}`]: endpoint });
    await assert.rejects(verifyFinancialSandbox(env, f), /Sandbox webhook/);
    assert.ok(f.calls.every(call => call.url.origin === 'https://api.stripe.com'));
  }
});

test('live event envelopes and nested live payment objects cannot be accepted as sandbox evidence', async () => {
  for (const event of [
    { id: 'evt_sample', object: 'event', livemode: true, data: { object: { livemode: false } } },
    { id: 'evt_sample', object: 'event', livemode: false, data: { object: { livemode: true } } },
    { id: 'evt_sample', object: 'event', data: { object: {} } },
  ]) {
    const f = fixture({ '/v1/events/evt_sample': event });
    await assert.rejects(verifyFinancialSandbox({ ...env, STUDIO_SANDBOX_EVENT_IDS: 'evt_sample' }, f), /live or unknown-mode/);
  }
});

test('missing RPCs and copied live Stripe events block sandbox readiness', async () => {
  for (const name of ['apply_credit_adjustment', 'authorized_credit_cutout_keys']) {
    const absent = structuredClone(schema); delete absent.paths[`/rpc/${name}`];
    await assert.rejects(verifyFinancialSandbox(env, fixture({ '/rest/v1/': absent })), /service credit or fee RPCs are missing/);
  }
  const live = fixture({ '/rest/v1/stripe_events': (_data, url) => Response.json(url.searchParams.has('livemode') ? [{ id: 'evt_liveWithheld' }] : []) });
  await assert.rejects(verifyFinancialSandbox(env, live), /database contains live Stripe events/);
});

test('actual SQL grants keep client-only RPCs out of service OpenAPI without blocking read-only verification', async () => {
  for (const name of ['deduct_studio_credits', 'refund_studio_credits', 'finalize_background_credit_job']) {
    const permissions = schemas.privileges.find(row => row.name === name);
    assert.ok(permissions, name);
    assert.equal(permissions.authenticated, true, name);
    assert.equal(permissions.service, false, name);
    assert.equal(permissions.anon, false, name);
    assert.equal(schema.paths[`/rpc/${name}`], undefined, name);
    assert.ok(schemas.authenticated.paths[`/rpc/${name}`]?.post, name);
  }
  const f = fixture();
  const result = await verifyFinancialSandbox(env, f);
  assert.equal(result.authenticatedCreditRpcVerified, false, 'server metadata must not claim real authenticated RPC acceptance');
  assert.equal(result.rlsPoliciesVerified, false, 'local role grants do not prove hosted ownership policies');
  assert.ok(f.calls.every(call => call.options.method === 'GET'));
});

test('provider errors, malformed bodies and transport exceptions never leak private data', async () => {
  const secret = 'provider_body_secret_and_private_url';
  for (const fetcher of [
    async () => ({ ok: false, status: 403, get body() { assert.fail('must not read an error body'); } }),
    async () => { throw new Error(secret); },
    async () => new Response(secret, { headers: { 'content-type': 'application/json' } }),
    async () => new Response(secret, { headers: { 'content-length': String(2 * 1024 * 1024) } }),
    async () => new Response('x'.repeat(1024 * 1024 + 1)),
  ]) {
    const logs = [];
    await assert.rejects(verifyFinancialSandbox(env, { fetcher, report: value => logs.push(value) }), error => {
      assert.ok(error instanceof FinancialSandboxVerificationError);
      assert.ok(!error.message.includes(secret)); return true;
    });
    assert.deepEqual(logs, []);
  }
});

test('CLI never autoloads a local production env file and the tracked example cannot run requests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-financial-sandbox-'));
  try {
    await writeFile(join(directory, '.env.local'), 'STUDIO_FINANCIAL_SANDBOX_VERIFY=1\nSTRIPE_SECRET_KEY=sk_live_fixture\n');
    const run = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/verify-financial-sandbox.mjs', import.meta.url))], {
      cwd: directory, encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 5000,
    });
    assert.equal(run.status, 0); assert.equal(run.stdout, ''); assert.equal(run.stderr, '');
    const example = await readFile(new URL('../config/financial-sandbox.env.example', import.meta.url), 'utf8');
    const values = Object.fromEntries(example.split('\n').filter(line => /^[A-Z_]+\d*\s*=/.test(line)).map(line => {
      const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
    }));
    assert.equal(values.STUDIO_FINANCIAL_SANDBOX_VERIFY, '0');
    await assert.rejects(verifyFinancialSandbox({ ...values, STUDIO_FINANCIAL_SANDBOX_VERIFY: '1' }, {
      fetcher: () => assert.fail('example placeholders must never reach a provider') }), FinancialSandboxVerificationError);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

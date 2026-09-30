import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { pausePlatformCreditEvent, creditMaintenanceActive } from '../lib/credit-maintenance.ts';
import * as pricing from '../lib/studio-pricing.ts';

function load(path, modules) {
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', compiled)(name => modules[name] || {}, exports);
  return exports;
}

test('upgrade pause queues platform fulfillment before claiming events and keeps customer-order events eligible', async () => {
  const oldPause = process.env.STUDIO_CREDIT_MAINTENANCE;
  const oldSecret = process.env.STRIPE_WEBHOOK_SECRET;
  try {
    process.env.STUDIO_CREDIT_MAINTENANCE = '1';
    process.env.STRIPE_WEBHOOK_SECRET = 'fixture-signing-secret';
    const api = load('app/api/stripe/webhook/route.ts', {
      'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
      '@/lib/credit-maintenance': { pausePlatformCreditEvent },
      '@/lib/dashboard-auth': { createDashboardServiceClient: () => assert.fail('No database mutation while paused') },
      '@/lib/payments': { verifyStripeSignature: async () => true },
    });
    for (const type of ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'charge.refunded', 'refund.updated', 'refund.failed',
      'invoice.paid', 'invoice.payment_failed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']) {
      const response = await api.POST({ headers: new Headers({ 'stripe-signature': 'fixture' }), text: async () => JSON.stringify({ id: 'evt', type, data: { object: {} } }) });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('retry-after'), '120');
      assert.equal(pausePlatformCreditEvent({ type, account: 'acct_photographer' }), false);
    }
    assert.equal((await api.POST({ headers: new Headers(), text: async () => assert.fail('Unsigned input must not be read') })).status, 400);
    delete process.env.STUDIO_CREDIT_MAINTENANCE;
    assert.equal(pausePlatformCreditEvent({ type: 'checkout.session.completed' }), false);
  } finally {
    if (oldPause === undefined) delete process.env.STUDIO_CREDIT_MAINTENANCE; else process.env.STUDIO_CREDIT_MAINTENANCE = oldPause;
    if (oldSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = oldSecret;
  }
});

test('upgrade pause stops every platform billing action before body, profile, trial, customer or catalog work', async () => {
  const old = process.env.STUDIO_CREDIT_MAINTENANCE;
  try {
    process.env.STUDIO_CREDIT_MAINTENANCE = '1';
    let signedIn = true; let bodyReads = 0;
    const api = load('app/api/stripe/billing/route.ts', {
      'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
      '@/lib/credit-maintenance': { creditMaintenanceActive },
      '@/lib/dashboard-auth': { resolveDashboardAuth: async () => ({ user: signedIn ? { id: 'photographer' } : null }), createDashboardServiceClient: () => assert.fail('The schema is absent: no service/profile access is allowed') },
    });
    for (const action of ['subscribe', 'update_plan', 'update_extra_keys', 'buy_credits', 'portal']) {
      const response = await api.POST({ json: async () => { bodyReads++; return { action }; } });
      assert.equal(response.status, 503); assert.equal(response.headers.get('retry-after'), '120');
      assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal((await response.json()).maintenance, true);
    }
    assert.equal(bodyReads, 0);
    signedIn = false;
    assert.equal((await api.POST({ json: async () => assert.fail('Unauthenticated body must not be read') })).status, 401);
    signedIn = true; process.env.STUDIO_CREDIT_MAINTENANCE = '0';
    assert.equal((await api.POST({ json: async () => { bodyReads++; return { action: 'invalid' }; } })).status, 400);
    assert.equal(bodyReads, 1, 'normal action validation resumes when maintenance ends');
  } finally { if (old === undefined) delete process.env.STUDIO_CREDIT_MAINTENANCE; else process.env.STUDIO_CREDIT_MAINTENANCE = old; }
});

test('paused billing status preserves authentication and returns a retry before any missing-schema/new-account work', async () => {
  const old = process.env.STUDIO_CREDIT_MAINTENANCE;
  let signedIn = true; let serviceCreates = 0;
  try {
    process.env.STUDIO_CREDIT_MAINTENANCE = '1';
    const api = load('app/api/stripe/status/route.ts', {
      'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
      '@/lib/credit-maintenance': { creditMaintenanceActive },
      '@/lib/payments': { ...pricing, DEFAULT_BILLING_CURRENCY: 'cad', FREE_TRIAL_DAYS: 14, ORDER_USAGE_RATE_CENTS: 35 },
      '@/lib/dashboard-auth': {
        resolveDashboardAuth: async () => ({ user: signedIn ? { id: 'new-account' } : null }),
        createDashboardServiceClient: () => { serviceCreates++; throw Error('order_usage_fees schema has not been installed'); },
      },
    });
    const paused = await api.GET({});
    assert.equal(paused.status, 503); assert.equal(paused.headers.get('retry-after'), '120');
    assert.equal(paused.headers.get('cache-control'), 'no-store');
    const body = await paused.json(); assert.equal(body.signedIn, true); assert.equal(body.ok, false); assert.equal(body.maintenance, true);
    assert.equal(serviceCreates, 0, 'opening settings must not initialize a trial or mutate accounts before migration');
    signedIn = false; assert.equal((await api.GET({})).status, 401); assert.equal(serviceCreates, 0);
  } finally { if (old === undefined) delete process.env.STUDIO_CREDIT_MAINTENANCE; else process.env.STUDIO_CREDIT_MAINTENANCE = old; }
});

test('both financial crons authenticate first and pause before touching absent credit/fee schema', async () => {
  const oldPause = process.env.STUDIO_CREDIT_MAINTENANCE; const oldSecret = process.env.CRON_SECRET;
  try {
    process.env.STUDIO_CREDIT_MAINTENANCE = '1'; process.env.CRON_SECRET = 'fixture-scheduler-secret';
    for (const path of ['app/api/cron/stripe-billing-sync/route.ts', 'app/api/cron/credit-processing-recovery/route.ts']) {
      const api = load(path, {
        'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
        '@/lib/credit-maintenance': { creditMaintenanceActive },
        '@/lib/dashboard-auth': { createDashboardServiceClient: () => assert.fail('No absent-schema access or grants while paused') },
      });
      assert.equal((await api.GET({ headers: new Headers() })).status, 401);
      assert.equal((await api.GET({ headers: new Headers({ authorization: 'Bearer wrong' }) })).status, 401);
      const paused = await api.GET({ headers: new Headers({ authorization: 'Bearer fixture-scheduler-secret' }) });
      assert.equal(paused.status, 503); assert.equal(paused.headers.get('retry-after'), '120');
      assert.equal(paused.headers.get('cache-control'), 'no-store');
    }
  } finally {
    if (oldPause === undefined) delete process.env.STUDIO_CREDIT_MAINTENANCE; else process.env.STUDIO_CREDIT_MAINTENANCE = oldPause;
    if (oldSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = oldSecret;
  }
});

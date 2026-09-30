import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { pausePlatformCreditEvent, creditMaintenanceActive } from '../lib/credit-maintenance.ts';

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
    for (const type of ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'charge.refunded', 'refund.updated', 'refund.failed']) {
      const response = await api.POST({ headers: new Headers({ 'stripe-signature': 'fixture' }), text: async () => JSON.stringify({ id: 'evt', type, data: { object: {} } }) });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('retry-after'), '120');
      assert.equal(pausePlatformCreditEvent({ type, account: 'acct_photographer' }), false);
    }
    assert.equal(pausePlatformCreditEvent({ type: 'invoice.paid' }), false);
    delete process.env.STUDIO_CREDIT_MAINTENANCE;
    assert.equal(pausePlatformCreditEvent({ type: 'checkout.session.completed' }), false);
  } finally {
    if (oldPause === undefined) delete process.env.STUDIO_CREDIT_MAINTENANCE; else process.env.STUDIO_CREDIT_MAINTENANCE = oldPause;
    if (oldSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = oldSecret;
  }
});

test('upgrade pause stops credit checkout before creating a customer or payment session', async () => {
  const old = process.env.STUDIO_CREDIT_MAINTENANCE;
  try {
    process.env.STUDIO_CREDIT_MAINTENANCE = '1';
    const api = load('app/api/stripe/billing/route.ts', {
      'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
      '@/lib/credit-maintenance': { creditMaintenanceActive },
      '@/lib/dashboard-auth': { resolveDashboardAuth: async () => ({ user: { id: 'photographer' } }), createDashboardServiceClient: () => assert.fail('No billing mutation while paused') },
    });
    const response = await api.POST({ json: async () => ({ action: 'buy_credits' }) });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '120');
  } finally { if (old === undefined) delete process.env.STUDIO_CREDIT_MAINTENANCE; else process.env.STUDIO_CREDIT_MAINTENANCE = old; }
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { creditMaintenanceActive } from '../lib/credit-maintenance.ts';

const source = readFileSync(new URL('../app/api/cron/stripe-billing-sync/route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

test('billing cron reaches subscribers beyond the first 200 and isolates a failed account', async context => {
  const previousPause = process.env.STUDIO_CREDIT_MAINTENANCE;
  process.env.STUDIO_CREDIT_MAINTENANCE = '0';
  context.after(() => { if (previousPause === undefined) delete process.env.STUDIO_CREDIT_MAINTENANCE; else process.env.STUDIO_CREDIT_MAINTENANCE = previousPause; });
  const photographers = Array.from({ length: 207 }, (_, index) => ({ id: String(index).padStart(4, '0'), stripe_subscription_id: `sub_${index}` }));
  const ranges = []; const synchronized = [];
  let concurrent = 0; let peakConcurrent = 0;
  const dependencies = {
    '@/lib/credit-maintenance': { creditMaintenanceActive },
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => ({ from(table) {
      assert.equal(table, 'photographers');
      const chain = { select() { return chain; }, not() { return chain; }, order(key, options) { assert.equal(key, 'id'); assert.equal(options.ascending, true); return chain; },
        async range(from, to) { ranges.push([from, to]); return { data: photographers.slice(from, to + 1), error: null }; } }; return chain;
    } }) },
    '@/lib/payments': {
      isStripeBillingActive: status => status === 'active',
      retrieveStripeSubscription: async id => {
        concurrent++; peakConcurrent = Math.max(concurrent, peakConcurrent);
        await new Promise(resolve => setImmediate(resolve));
        concurrent--;
        if (id === 'sub_3') throw Error('expected individual Stripe failure');
        return { id, status: 'active' };
      },
      syncSubscriptionStateFromStripe: async (_service, photographer) => { synchronized.push(photographer.id); },
    },
  };
  const exports = {};
  new Function('require', 'exports', compiled)(name => dependencies[name], exports);
  process.env.CRON_SECRET = 'cron-test-secret';
  const result = await exports.GET({ headers: new Headers({ authorization: 'Bearer cron-test-secret' }) });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true, processed: 207, synced: 206, failed: 1 });
  assert.deepEqual(ranges, [[0, 99], [100, 199], [200, 299]]);
  assert.ok(synchronized.includes('0206'));
  assert.ok(peakConcurrent <= 5);
  assert.equal((await exports.GET({ headers: new Headers() })).status, 401);
});

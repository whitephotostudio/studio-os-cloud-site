import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { z } from 'zod';

function load(path, modules = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', code)((name) => {
    assert.ok(name in modules, `Unexpected dependency ${name}`);
    return modules[name];
  }, exports);
  return exports;
}

const subscriptions = load('lib/subscription-gate.ts', {
  '@/lib/subscription-access': load('lib/subscription-access.ts', {
    '@/lib/trial-config': load('lib/trial-config.ts'),
    '@/lib/studio-pricing': { normalizePlanCode: () => 'studio' },
  }),
});
const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const userId = id(1), photographerId = id(2), otherPhotographerId = id(3), orderId = id(4);

function fixture(options = {}) {
  const authCalls = [], queries = [], rateCalls = [], deliveries = [];
  let serviceCreates = 0;
  const photographer = options.photographer === null ? null : {
    id: photographerId, subscription_status: 'active', ...options.photographer,
  };
  const rows = options.orders ?? [{ id: orderId, photographer_id: photographerId }];
  const service = {
    from(table) {
      assert.ok(['photographers', 'orders'].includes(table));
      const filters = new Map();
      let ids;
      const execute = async () => {
        queries.push({ table, filters: Object.fromEntries(filters), ids });
        if (table === 'photographers') {
          assert.equal(filters.get('user_id'), options.auth?.user?.id ?? userId);
          return { data: photographer, error: options.photographerError ?? null };
        }
        assert.equal(filters.get('photographer_id'), photographerId);
        assert.ok(ids.length <= 100, 'Ownership reads keep their URL bounded');
        return {
          data: options.ignoreOrderFilters ? rows : rows.filter((row) =>
            ids.includes(row.id) && row.photographer_id === filters.get('photographer_id')),
          error: options.ordersError ?? null,
        };
      };
      const query = {
        select() { return query; },
        eq(field, value) { filters.set(field, value); return query; },
        in(field, value) { assert.equal(field, 'id'); ids = value; return query; },
        maybeSingle: execute,
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      return query;
    },
  };
  const route = load('app/api/dashboard/orders/abandoned-cart-reminders/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    zod: { z },
    '@/lib/dashboard-auth': {
      resolveDashboardAuth: async (request) => {
        authCalls.push(request);
        if (options.authError) throw options.authError;
        return { user: { id: userId }, mfaSatisfied: true, ...options.auth };
      },
      createDashboardServiceClient: () => { serviceCreates++; return service; },
    },
    '@/lib/subscription-gate': subscriptions,
    '@/lib/rate-limit': {
      rateLimit: async (key, config) => {
        rateCalls.push({ key, config });
        return { allowed: true, remaining: 9, resetAt: Date.now() + 600_000, ...options.rate };
      },
    },
    '@/lib/abandoned-cart-reminders': {
      deliverAbandonedCartReminders: async (client, config) => {
        assert.equal(client, service);
        deliveries.push(config);
        if (options.deliveryError) throw options.deliveryError;
        return options.result ?? { processed: 1, sent: 1, skipped: 0, failed: 0 };
      },
    },
  });
  return {
    route, authCalls, queries, rateCalls, deliveries,
    get serviceCreates() { return serviceCreates; },
    post(body = { orderIds: [orderId] }, raw = false) {
      return route.POST(new Request('https://studiooscloud.com/api/dashboard/orders/abandoned-cart-reminders', {
        method: 'POST',
        headers: { authorization: 'Bearer fixture-caller-jwt', 'content-type': 'application/json' },
        body: raw ? body : JSON.stringify(body),
      }));
    },
  };
}

async function expectNoDelivery(h, status, body) {
  const response = await h.post(body);
  assert.equal(response.status, status);
  const result = await response.json();
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string', 'Legacy desktop clients receive an error string');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(h.deliveries.length, 0);
  return result;
}

test('cross-origin cookie requests fail before authentication or sending', async () => {
  const h = fixture();
  const response = await h.route.POST(new Request('https://studiooscloud.com/api/dashboard/orders/abandoned-cart-reminders', {
    method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
    body: JSON.stringify({ orderIds: [orderId] }),
  }));
  assert.equal(response.status, 403);
  assert.equal(h.authCalls.length, 0);
  assert.equal(h.deliveries.length, 0);
});

test('GET cannot authenticate, read orders or deliver reminders', async () => {
  const h = fixture();
  const response = await h.route.GET();
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
  assert.deepEqual(h.authCalls, []);
  assert.deepEqual(h.queries, []);
  assert.deepEqual(h.deliveries, []);
  assert.equal(h.serviceCreates, 0);
});

test('signed-out and insufficient-MFA callers fail before privileged reads', async () => {
  for (const [auth, status] of [
    [{ user: null }, 401],
    [{ mfaSatisfied: false }, 403],
    [{ mfaSatisfied: undefined }, 403],
  ]) {
    const h = fixture({ auth });
    await expectNoDelivery(h, status);
    assert.equal(h.serviceCreates, 0);
    assert.deepEqual(h.queries, []);
    assert.deepEqual(h.rateCalls, []);
  }
});

test('the original caller JWT request reaches dashboard authentication', async () => {
  const h = fixture();
  assert.equal((await h.post()).status, 200);
  assert.equal(h.authCalls.length, 1);
  assert.equal(h.authCalls[0].headers.get('authorization'), 'Bearer fixture-caller-jwt');
});

test('missing and inactive studio subscriptions fail before order access', async () => {
  const profiles = [null,
    { subscription_status: 'cancelled' },
    { subscription_status: 'past_due' },
    { subscription_status: null },
    { subscription_status: 'trial', trial_ends_at: '2020-01-01T00:00:00Z' },
  ];
  for (const photographer of profiles) {
    const h = fixture({ photographer });
    await expectNoDelivery(h, 403);
    assert.equal(h.queries.length, 1);
    assert.deepEqual(h.rateCalls, []);
  }
});

test('active, Stripe trialing, live free trial and owner access use the shared subscription gate', async () => {
  for (const photographer of [
    { subscription_status: 'active' },
    { subscription_status: 'trialing' },
    { subscription_status: 'trial', trial_ends_at: '2099-01-01T00:00:00Z' },
    { subscription_status: 'cancelled', is_platform_admin: true },
  ]) {
    const h = fixture({ photographer });
    assert.equal((await h.post()).status, 200);
    assert.equal(h.deliveries.length, 1);
  }
});

test('strict UUID body and legacy option types reject malformed or widening requests', async () => {
  for (const body of [null, [], {}, { orderIds: [] }, { orderIds: [123] },
    { orderIds: ['not-an-order'] }, { order_ids: [orderId] },
    { orderIds: [orderId], photographerId: otherPhotographerId },
    { orderIds: [orderId], force: 'true' }, { orderIds: [orderId], force: 1 },
    { orderIds: [orderId], cooldownDays: '0' }, { orderIds: [orderId], cooldownDays: -1 },
    { orderIds: Array.from({ length: 1001 }, (_, index) => id(index + 100)) },
  ]) {
    const h = fixture();
    await expectNoDelivery(h, 400, body);
    assert.equal(h.serviceCreates, 0);
  }
  const h = fixture();
  const response = await h.post('{invalid JSON', true);
  assert.equal(response.status, 400);
  assert.equal(typeof (await response.json()).error, 'string');
  assert.equal(h.serviceCreates, 0);
  assert.deepEqual(h.deliveries, []);
});

test('nonfinite legacy cooldown numbers cannot pass JSON validation', async () => {
  const h = fixture();
  const response = await h.post(`{"orderIds":["${orderId}"],"cooldownDays":1e999}`, true);
  assert.equal(response.status, 400);
  assert.deepEqual(h.deliveries, []);
});

test('mixed studio, missing and deleted order selections never partially deliver', async () => {
  for (const orders of [[], [{ id: orderId, photographer_id: otherPhotographerId }],
    [{ id: orderId, photographer_id: photographerId }],
  ]) {
    const h = fixture({ orders });
    await expectNoDelivery(h, 403, { orderIds: [orderId, id(5)] });
  }
  const h = fixture({ orders: [{ id: orderId, photographer_id: otherPhotographerId }], ignoreOrderFilters: true });
  await expectNoDelivery(h, 403);
});

test('only verified owned UUIDs and bounded scope reach one shared worker invocation', async () => {
  const h = fixture();
  const response = await h.post({ orderIds: [orderId], force: true, cooldownDays: 0 });
  assert.equal(response.status, 200);
  assert.deepEqual(h.deliveries, [{
    origin: 'https://studiooscloud.com', orderIds: [orderId], photographerId, limit: 100,
  }]);
  assert.equal((await response.json()).forced, false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(h.rateCalls[0].key, photographerId);
  assert.equal(h.rateCalls[0].config.namespace, 'abandoned-cart-reminders-manual');
});

test('canonical UUID deduplication cannot multiply reminder claims or totals', async () => {
  const canonical = 'abcdef12-abcd-4abc-8abc-abcdef123456';
  const h = fixture({ orders: [{ id: canonical, photographer_id: photographerId }] });
  const response = await h.post({ orderIds: [canonical.toUpperCase(), canonical] });
  assert.equal(response.status, 200);
  assert.deepEqual(h.deliveries[0].orderIds, [canonical]);
  assert.equal((await response.json()).requested, 1);
});

test('a 1000-order legacy selection verifies all ownership before one limited run', async () => {
  const orderIds = Array.from({ length: 1000 }, (_, index) => id(index + 100));
  const h = fixture({ orders: orderIds.map(id => ({ id, photographer_id: photographerId })),
    result: { processed: 100, sent: 98, skipped: 1, failed: 1 } });
  const response = await h.post({ orderIds });
  assert.equal(response.status, 200);
  assert.equal(h.queries.filter(query => query.table === 'orders').length, 10);
  assert.equal(h.deliveries.length, 1);
  assert.deepEqual(h.deliveries[0].orderIds, orderIds);
  assert.equal(h.deliveries[0].limit, 100);
  assert.deepEqual(await response.json(), { ok: true, processed: 100, sent: 98, skipped: 1, failed: 1,
    total: 100, requested: 1000, notClaimed: 900, limit: 100, forced: false });
});

test('a foreign order in the last ownership batch stops every delivery', async () => {
  const orderIds = Array.from({ length: 101 }, (_, index) => id(index + 100));
  const orders = orderIds.map((id, index) => ({ id, photographer_id: index === 100 ? otherPhotographerId : photographerId }));
  const h = fixture({ orders });
  await expectNoDelivery(h, 403, { orderIds });
  assert.equal(h.queries.filter(query => query.table === 'orders').length, 2);
});

test('rate limits are keyed to the authenticated studio and return 429 before order reads', async () => {
  const h = fixture({ rate: { allowed: false } });
  await expectNoDelivery(h, 429);
  assert.equal(h.rateCalls[0].key, photographerId);
  assert.equal(h.queries.length, 1);
  const response = await h.post();
  assert.ok(Number(response.headers.get('retry-after')) >= 1);
});

test('provider-unconfigured warning and claimed skip counters retain their exact meaning', async () => {
  for (const result of [
    { processed: 0, sent: 0, skipped: 0, failed: 0, warning: 'Resend is not configured on the server.' },
    { processed: 1, sent: 0, skipped: 1, failed: 0 },
  ]) {
    const h = fixture({ result });
    const response = await h.post();
    assert.equal(response.status, 200);
    const body = await response.json();
    for (const [key, value] of Object.entries(result)) assert.equal(body[key], value);
    assert.equal(body.total, result.processed);
    assert.equal(body.notClaimed, 1 - result.processed);
  }
});

test('authentication, profile, ownership and claim outages fail closed without leaking exception details', async () => {
  const sensitiveError = new Error('private service credential and customer details');
  for (const options of [
    { authError: sensitiveError }, { photographerError: sensitiveError },
    { ordersError: sensitiveError }, { deliveryError: sensitiveError },
  ]) {
    const h = fixture(options);
    const response = await h.post();
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(typeof body.error, 'string');
    assert.ok(!JSON.stringify(body).includes(sensitiveError.message));
    assert.equal(h.deliveries.length, options.deliveryError ? 1 : 0);
  }
});

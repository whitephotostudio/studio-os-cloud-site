import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyPaymentRelease } from '../scripts/verify-payment-release.mjs';

const env = { STUDIO_PAYMENT_RELEASE_VERIFY: '1', STRIPE_SECRET_KEY: 'sk_live_fake', SUPABASE_SERVICE_ROLE_KEY: 'fake-service',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', STUDIO_PAYMENT_EXPECTED_PROJECT_REF: 'example',
  STUDIO_PAYMENT_EXPECTED_APP_URL: 'https://example.com' };
const endpoint = { url: 'https://example.com/api/stripe/webhook', status: 'enabled', livemode: true, enabled_events: ['*'] };
test('release check rejects masked credentials before making a network request', async () => {
  await assert.rejects(() => verifyPaymentRelease({ ...env, STRIPE_SECRET_KEY: '[SENSITIVE]' }, () => assert.fail('must not call providers')), /real production Stripe secret/);
});
test('release checks only read provider state and do not log credentials', async () => {
  const logs = [];
  await verifyPaymentRelease(env, async (url, options) => {
    assert.equal(options.method, 'GET');
    const body = url.includes('webhook_endpoints') ? { data: [endpoint], has_more: false } : url.endsWith('/account') ? { id: 'acct_example' } : [];
    return { ok: true, json: async () => body };
  }, (line) => logs.push(line));
  assert.match(logs.at(-1), /"financialMutations":0/);
  assert.ok(!logs.join('').includes(env.STRIPE_SECRET_KEY));
  assert.ok(!logs.join('').includes(env.SUPABASE_SERVICE_ROLE_KEY));
});
test('missing refund webhook subscriptions block release', async () => {
  await assert.rejects(() => verifyPaymentRelease(env, async (url) => ({ ok: true, json: async () => url.includes('webhook_endpoints') ? { data: [{ ...endpoint, enabled_events: ['checkout.session.completed'] }] } : {} }), () => {}), /missing: payment_intent.succeeded, charge.refunded, refund.updated, refund.failed/);
});
test('Stripe authentication errors never expose the provider response body', async () => {
  await assert.rejects(() => verifyPaymentRelease(env, async () => ({ ok: false, status: 401, json: () => assert.fail('must not read error bodies') }), () => {}), /HTTP 401/);
});
test('webhook verification accepts the production www alias and rejects lookalike hosts', async () => {
  const run = (url) => verifyPaymentRelease(env, async (path) => ({ ok: true, json: async () => path.includes('webhook_endpoints') ? { data: [{ ...endpoint, url }] } : {} }), () => {});
  await run('https://www.example.com/api/stripe/webhook?source=connect');
  await assert.rejects(() => run('https://www.example.com.evil.invalid/api/stripe/webhook'), /subscription is missing/);
});
test('explicit webhook configuration only adds refund events to the existing payment endpoint', async () => {
  const existing = { ...endpoint, id: 'we_selected', enabled_events: ['checkout.session.completed', 'payment_intent.succeeded', 'payment_intent.payment_failed', 'charge.refunded'] };
  const mutations = [];
  const logs = [];
  await verifyPaymentRelease({ ...env, STUDIO_PAYMENT_REFUND_WEBHOOK_ID: existing.id }, async (url, options) => {
    if (options.method === 'POST') {
      assert.equal(url, 'https://api.stripe.com/v1/webhook_endpoints/we_selected');
      assert.deepEqual([...new Set(options.body.keys())], ['enabled_events[]']);
      const events = options.body.getAll('enabled_events[]');
      assert.deepEqual(events, [...existing.enabled_events, 'refund.updated', 'refund.failed']);
      mutations.push(url);
      return { ok: true, json: async () => ({ ...existing, enabled_events: events }) };
    }
    return { ok: true, json: async () => url.includes('webhook_endpoints') ? { data: [existing] } : {} };
  }, (line) => logs.push(line));
  assert.equal(mutations.length, 1);
  assert.match(logs.at(-1), /"financialMutations":0/);
});
test('webhook configuration refuses a different destination or an unknown endpoint', async () => {
  for (const existing of [{ ...endpoint, id: 'we_other' }, { ...endpoint, id: 'we_selected', url: 'https://unrelated.example/api/stripe/webhook' }]) {
    await assert.rejects(() => verifyPaymentRelease({ ...env, STUDIO_PAYMENT_REFUND_WEBHOOK_ID: 'we_selected' }, async (url, options) => {
      assert.equal(options.method, 'GET');
      return { ok: true, json: async () => url.includes('webhook_endpoints') ? { data: [existing] } : {} };
    }, () => {}), /not the existing production/);
  }
});

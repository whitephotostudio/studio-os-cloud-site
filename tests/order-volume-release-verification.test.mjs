import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyOrderVolumeRelease } from '../scripts/verify-order-volume-release.mjs';
const env = { STUDIO_PAYMENT_RELEASE_VERIFY: '1', NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co',
  STUDIO_PAYMENT_EXPECTED_PROJECT_REF: 'fixture', SUPABASE_SERVICE_ROLE_KEY: 'service-fixture',
  RESEND_API_KEY: 'email-fixture', CRON_SECRET: 'cron-fixture' };
const functions = ['claim_customer_order_webhook', 'finish_customer_order_webhook', 'claim_pending_customer_order_payment_checks',
  'ensure_paid_order_emails', 'claim_paid_order_emails', 'prepare_paid_order_email', 'release_paid_order_email_worker'];
function fixture({ missing, status = 200, verified = true } = {}) {
  const calls = [];
  return { calls, fetcher: async (url, options) => {
    assert.equal(options.method, 'GET', 'release checks cannot mutate financial or delivery state'); calls.push(url);
    return { ok: status === 200, status, json: async () => url.endsWith('/rest/v1/')
      ? { paths: Object.fromEntries(functions.filter(name => name !== missing).map(name => [`/rpc/${name}`, { post: {} }])) }
      : url.includes('resend.com') ? { data: [{ name: 'studiooscloud.com', status: verified ? 'verified' : 'pending' }] } : [] };
  } };
}
test('production release verifies all recovery tables and functions without writes or sends', async () => {
  const f = fixture(), reports = []; await verifyOrderVolumeRelease(env, f.fetcher, value => reports.push(JSON.parse(value)));
  assert.equal(f.calls.length, 6); assert.equal(reports[0].rpcCount, 7);
  assert.equal(reports[0].financialMutations, 0); assert.equal(reports[0].emailsSent, 0);
});
test('missing recovery function, failed credential and unverified sender block release', async () => {
  for (const missing of functions) await assert.rejects(verifyOrderVolumeRelease(env, fixture({ missing }).fetcher), /RPCs are missing/);
  await assert.rejects(verifyOrderVolumeRelease(env, fixture({ status: 401 }).fetcher), /HTTP 401/);
  await assert.rejects(verifyOrderVolumeRelease(env, fixture({ verified: false }).fetcher), /sender domain/);
});
test('wrong project and missing retry secret block before provider requests; local tests stay isolated', async () => {
  const forbidden = () => assert.fail('provider call forbidden');
  await assert.rejects(verifyOrderVolumeRelease({ ...env, NEXT_PUBLIC_SUPABASE_URL: 'https://wrong.supabase.co' }, forbidden), /project/);
  for (const secret of ['', '   ', ' [SENSITIVE] ']) await assert.rejects(verifyOrderVolumeRelease({ ...env, CRON_SECRET: secret }, forbidden), /retry-worker/);
  await verifyOrderVolumeRelease({ ...env, RESEND_FROM_EMAIL: ' galleries@studiooscloud.com ' }, fixture().fetcher, () => {});
  await verifyOrderVolumeRelease({}, forbidden);
});

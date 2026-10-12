import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyCartReminderRelease } from '../scripts/verify-cart-reminder-release.mjs';

test('production guard checks migration with reads only, never invokes claiming, stops or email delivery', async () => {
  const calls = [], reports = [];
  const env = { VERCEL_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'https://bwqhzczxoevouiondjak.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-secret' };
  await verifyCartReminderRelease(env, async (url, options) => { calls.push([url, options]); return new Response('[]'); }, value => reports.push(value));
  assert.equal(calls.length, 4);
  assert.ok(calls.every(([, options]) => options.method === 'GET'));
  assert.ok(calls.every(([url]) => !/claim_abandoned|stop_abandoned|authorize_abandoned|resend/.test(url)));
  assert.match(reports[0], /"emailsSent":0/);
  await assert.rejects(() => verifyCartReminderRelease({ ...env, NEXT_PUBLIC_SUPABASE_URL: 'https://other.supabase.co' }), /production project/);
  await assert.rejects(() => verifyCartReminderRelease(env, async () => new Response('private diagnostic', { status: 404 })), /HTTP 404/);
  await verifyCartReminderRelease({ VERCEL_ENV: 'preview' }, async () => assert.fail('Unexpected preview call'));
});

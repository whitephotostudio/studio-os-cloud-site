import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyOnlineBackdropRelease } from '../scripts/verify-online-backdrop-release.mjs';

const env = { STUDIO_ONLINE_BACKDROP_RELEASE_VERIFY: '1', NEXT_PUBLIC_SUPABASE_URL: 'https://bwqhzczxoevouiondjak.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only' };
const ready = { version: 1, columns_ready: true, client_policy_guard_ready: true, service_only: true };

test('production release checks policy schema with a read-only RPC and no customer queries', async () => {
  const calls = [], reports = [];
  await verifyOnlineBackdropRelease(env, async (url, options) => {
    calls.push({ url, options }); return Response.json(ready);
  }, item => reports.push(JSON.parse(item)));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/online_backdrop_policy_schema_status`);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(reports[0].customerMutations, 0);
  assert.equal(reports[0].financialMutations, 0);
});

test('release refuses missing columns, writable client policy, wrong version and query errors', async () => {
  for (const status of [{ ...ready, version: 2 }, ...['columns_ready', 'client_policy_guard_ready', 'service_only'].map(flag => ({ ...ready, [flag]: false }))]) {
    await assert.rejects(verifyOnlineBackdropRelease(env, async () => Response.json(status)), /incomplete/);
  }
  await assert.rejects(verifyOnlineBackdropRelease(env, async () => new Response('private failure details', { status: 500 })), /HTTP 500/);
});

test('release refuses another project and preview does not query production', async () => {
  let calls = 0;
  await assert.rejects(verifyOnlineBackdropRelease({ ...env, NEXT_PUBLIC_SUPABASE_URL: 'https://other.supabase.co' }, async () => { calls++; }), /configured production/);
  await verifyOnlineBackdropRelease({}, async () => { calls++; });
  assert.equal(calls, 0);
});

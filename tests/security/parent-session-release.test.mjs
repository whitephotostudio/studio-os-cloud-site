import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyParentSessionRelease } from '../../scripts/verify-parent-session-release.mjs';

const env = { VERCEL_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'https://bwqhzczxoevouiondjak.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon' };

test('release gate reads every private schema and requires anonymous denial without customer writes', async () => {
  const calls = [], reports = [];
  await verifyParentSessionRelease(env, async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.method, 'GET');
    assert.equal(new URL(url).searchParams.get('limit'), '0');
    return new Response(null, { status: init.headers.apikey === env.SUPABASE_SERVICE_ROLE_KEY ? 200 : 403 });
  }, value => reports.push(JSON.parse(value)));
  assert.equal(calls.length, 6);
  assert.equal(new Set(calls.map(call => new URL(call.url).pathname)).size, 3);
  assert.deepEqual(reports, [{ check: 'private-parent-session-schema', ok: true,
    serviceSchemas: 3, anonymousDenied: 3, customerMutations: 0, paymentsCreated: 0 }]);
});

test('release gate rejects even empty anonymous-readable tables and missing schema', async () => {
  for (const status of [200, 404, 500]) {
    await assert.rejects(verifyParentSessionRelease(env, async (_url, init) => new Response(null, {
      status: init.headers.apikey === env.SUPABASE_SERVICE_ROLE_KEY ? 200 : status,
    }), () => {}), /verification failed/);
  }
  await assert.rejects(verifyParentSessionRelease(env, async () => new Response(null, { status: 404 }), () => {}), /verification failed/);
});

test('release gate fails configuration before fetching and ordinary local builds skip it', async () => {
  const unexpected = () => { throw Error('unexpected fetch'); };
  await assert.rejects(verifyParentSessionRelease({ ...env, NEXT_PUBLIC_SUPABASE_URL: 'https://foreign.test' }, unexpected), /configured production project/);
  await assert.rejects(verifyParentSessionRelease({ ...env, SUPABASE_SERVICE_ROLE_KEY: '' }, unexpected), /configured production project/);
  await verifyParentSessionRelease({}, unexpected);
});

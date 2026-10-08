import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyRivieraRelease } from '../scripts/verify-riviera-release.mjs';

const env = { STUDIO_RIVIERA_RELEASE_VERIFY: '1', STUDIO_PAYMENT_EXPECTED_PROJECT_REF: 'abcdefghijklmnopqrst',
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-server-credential' };
const ready = {
  stripe_business_profile_schema_status: { version: 1, columns_ready: true, country_constraints_ready: true,
    atomic_profile_guard_ready: true, connect_sync_guard_ready: true, client_country_guard_ready: true, service_only: true },
  school_yearbook_schema_status: { version: 1, settingsRls: true, selectionsRls: true, clientWritesRevoked: true,
    settingsSaveServiceOnly: true, selectionSaveServiceOnly: true, atomicRevision: true, currentPhotoScope: true },
  gotphoto_migration_schema_status: { version: '20261008230000', import_rpc: true, ledger_rls: true,
    ledger_forced_rls: true, ledger_fields_complete: true, service_only: true },
};

test('production release checks schema contracts and both school/student relationships through read-only requests', async () => {
  const calls = [], reports = [];
  await verifyRivieraRelease({ ...env, STUDIO_RIVIERA_RELEASE_VERIFY: undefined, VERCEL_ENV: 'production' }, async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
    assert.equal(options.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
    const parsed = new URL(url), name = parsed.pathname.split('/').pop();
    if (name === 'schools' || name === 'students') {
      assert.equal(parsed.searchParams.get('limit'), '0');
      assert.match(parsed.searchParams.get('select'), /!(students_school_id_fkey)/);
      if (name === 'students') assert.match(parsed.searchParams.get('select'), /!inner/);
      return Response.json([]);
    }
    assert.ok(name in ready); return Response.json(ready[name]);
  }, value => reports.push(JSON.parse(value)));
  assert.equal(calls.length, 5); assert.equal(reports.length, 5);
  assert.ok(reports.every(r => r.databaseMutations === 0 && r.financialMutations === 0));
  assert.ok(!JSON.stringify(reports).includes(env.SUPABASE_SERVICE_ROLE_KEY));
});

test('an ambiguous or unavailable school/student relationship blocks release without disclosing provider details', async () => {
  for (const table of ['schools', 'students']) {
    await assert.rejects(verifyRivieraRelease(env, async url => {
      const name = new URL(url).pathname.split('/').pop();
      if (name === table) return Response.json({ code: 'PGRST201', details: 'private relationship metadata' }, { status: 300 });
      return Response.json(ready[name] ?? []);
    }, () => {}), error => error.message.includes(table) && /HTTP 300/.test(error.message) && !error.message.includes('private relationship metadata'));
  }
});

test('relationship probes reject unexpected customer rows', async () => {
  await assert.rejects(verifyRivieraRelease(env, async url => {
    const name = new URL(url).pathname.split('/').pop();
    return Response.json(ready[name] ?? [{ id: 'private-record' }]);
  }, () => {}), error => /zero records/.test(error.message) && !error.message.includes('private-record'));
});

test('database mismatch fails before credentials can be sent to another project', async () => {
  await assert.rejects(verifyRivieraRelease({ ...env, NEXT_PUBLIC_SUPABASE_URL: 'https://different-project.supabase.co' },
    () => assert.fail('no request should be made')), /does not match/);
});

test('missing credentials and unavailable schema fail closed without provider body disclosure', async () => {
  await assert.rejects(verifyRivieraRelease({ ...env, SUPABASE_SERVICE_ROLE_KEY: '[SENSITIVE]' },
    () => assert.fail('no request should be made')), /server database credential/);
  await assert.rejects(verifyRivieraRelease(env, async () => new Response('private database details', { status: 404 })),
    error => /HTTP 404/.test(error.message) && !error.message.includes('private database details'));
});

test('missing protection and wrong migration versions block release', async () => {
  for (const [name, status] of Object.entries(ready)) {
    for (const key of Object.keys(status)) {
      const bad = { ...status, [key]: key === 'version' ? 'wrong' : false };
      await assert.rejects(verifyRivieraRelease(env, async url => {
        const rpc = new URL(url).pathname.split('/').pop();
        return Response.json(rpc === name ? bad : ready[rpc]);
      }, () => {}), /missing schema protections/);
    }
  }
});

test('offline fixture builds need no external service', async () => {
  await verifyRivieraRelease({}, () => assert.fail('offline fixture build must not call a service'));
});

import { pathToFileURL } from 'node:url';

const schemas = [
  { rpc: 'stripe_business_profile_schema_status', version: 1, flags: ['columns_ready', 'country_constraints_ready', 'atomic_profile_guard_ready', 'connect_sync_guard_ready', 'client_country_guard_ready', 'service_only'] },
  { rpc: 'school_yearbook_schema_status', version: 1, flags: ['settingsRls', 'selectionsRls', 'clientWritesRevoked', 'settingsSaveServiceOnly', 'selectionSaveServiceOnly', 'atomicRevision', 'currentPhotoScope'] },
  { rpc: 'gotphoto_migration_schema_status', version: '20261008230000', flags: ['import_rpc', 'ledger_rls', 'ledger_forced_rls', 'ledger_fields_complete', 'service_only'] },
];

const relations = [
  { table: 'schools', selection: 'id,students:students!students_school_id_fkey(count)' },
  { table: 'students', selection: 'id,schools:schools!students_school_id_fkey!inner(id)' },
];

// These stable, service-only RPCs inspect schema capabilities without reading
// customer records. The zero-row relationship probes also catch schema-cache
// ambiguity after adding a bridge table. No provider or financial calls are made.
export async function verifyRivieraRelease(env = process.env, fetcher = fetch, report = console.log) {
  if (env.STUDIO_RIVIERA_RELEASE_VERIFY !== '1' && env.VERCEL_ENV !== 'production') return;
  const ref = (env.STUDIO_PAYMENT_EXPECTED_PROJECT_REF || '').trim();
  const databaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const key = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!/^[a-z0-9]{20}$/.test(ref) || databaseUrl !== `https://${ref}.supabase.co`) {
    throw new Error('Readiness release database does not match the expected project.');
  }
  if (!key || key === '[SENSITIVE]') throw new Error('Readiness schema verification requires the server database credential.');
  for (const schema of schemas) {
    const response = await fetcher(`${databaseUrl}/rest/v1/rpc/${schema.rpc}`, {
      method: 'GET', headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`${schema.rpc} failed (HTTP ${response.status}); database details withheld.`);
    const status = await response.json();
    if (status?.version !== schema.version || schema.flags.some(flag => status?.[flag] !== true)) {
      throw new Error(`${schema.rpc} reports missing schema protections; apply the reviewed migration before release.`);
    }
    report(JSON.stringify({ check: schema.rpc, ok: true, version: schema.version, databaseMutations: 0, financialMutations: 0 }));
  }
  for (const relation of relations) {
    const url = new URL(`${databaseUrl}/rest/v1/${relation.table}`);
    url.searchParams.set('select', relation.selection);
    url.searchParams.set('limit', '0');
    const response = await fetcher(url.href, {
      method: 'GET', headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`${relation.table} school/student relationship check failed (HTTP ${response.status}); database details withheld.`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 0) throw new Error(`${relation.table} relationship verification must return zero records.`);
    report(JSON.stringify({ check: `${relation.table}_school_student_relationship`, ok: true, rows: 0, databaseMutations: 0, financialMutations: 0 }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyRivieraRelease().catch(error => { console.error(error.message); process.exitCode = 1; });
}

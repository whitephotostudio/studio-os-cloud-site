import { pathToFileURL } from 'node:url';

export async function verifyOnlineBackdropRelease(env = process.env, fetcher = fetch, report = console.log) {
  if (env.VERCEL_ENV !== 'production' && env.STUDIO_ONLINE_BACKDROP_RELEASE_VERIFY !== '1') return;
  const base = (env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const key = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (base !== 'https://bwqhzczxoevouiondjak.supabase.co' || !key || key === '[SENSITIVE]') {
    throw Error('Online backdrop release requires the configured production project and server credential.');
  }
  const response = await fetcher(`${base}/rest/v1/rpc/online_backdrop_policy_schema_status`, {
    method: 'GET', headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: 'no-store', signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw Error(`Online backdrop schema verification failed (HTTP ${response.status}); details withheld.`);
  const status = await response.json();
  if (status?.version !== 1 || ['columns_ready', 'client_policy_guard_ready', 'service_only'].some(flag => status?.[flag] !== true)) {
    throw Error('Online backdrop schema protections are incomplete; apply the reviewed migration before release.');
  }
  report(JSON.stringify({ check: 'online-backdrop-policy-schema', ok: true, version: 1, customerMutations: 0, financialMutations: 0 }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyOnlineBackdropRelease().catch(error => { console.error(error.message); process.exitCode = 1; });
}

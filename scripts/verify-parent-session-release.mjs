import { pathToFileURL } from 'node:url';

const TABLES = [
  'parent_gallery_sessions?select=id,token_hash,scope_hash,gallery_kind,gallery_id,photographer_id,pin,viewer_email,expires_at,revoked_at&limit=0',
  'parent_order_session_access?select=order_id,token_hash,photographer_id,order_group_id,school_id,project_id,student_id,lane_ids&limit=0',
  'parent_checkout_returns?select=id,anchor_order_id,order_ids,order_scopes,legacy_school,return_lane_id,token_hash,attempt_key,stripe_session_id,expires_at&limit=0',
];

/** Schema reads only: this preflight never issues a session, order or payment. */
export async function verifyParentSessionRelease(env = process.env, fetcher = fetch, report = console.log) {
  if (env.VERCEL_ENV !== 'production' && env.STUDIO_PARENT_SESSION_RELEASE_VERIFY !== '1') return;
  const base = (env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const service = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const anon = (env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  if (base !== 'https://bwqhzczxoevouiondjak.supabase.co' || !service || !anon || service === '[SENSITIVE]' || anon === '[SENSITIVE]') {
    throw Error('Private parent session release requires the configured production project and service/public credentials.');
  }
  for (const table of TABLES) {
    for (const [key, authorized] of [[service, true], [anon, false]]) {
      const response = await fetcher(`${base}/rest/v1/${table}`, {
        method: 'GET', headers: { apikey: key, Authorization: `Bearer ${key}` },
        cache: 'no-store', signal: AbortSignal.timeout(15_000),
      });
      await response.body?.cancel();
      if (authorized ? !response.ok : ![401, 403].includes(response.status)) {
        throw Error(`Private parent session schema/permission verification failed (HTTP ${response.status}); details withheld.`);
      }
    }
  }
  report(JSON.stringify({ check: 'private-parent-session-schema', ok: true,
    serviceSchemas: TABLES.length, anonymousDenied: TABLES.length, customerMutations: 0, paymentsCreated: 0 }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await verifyParentSessionRelease();

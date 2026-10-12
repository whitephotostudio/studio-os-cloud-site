import { pathToFileURL } from 'node:url';

export async function verifyCartReminderRelease(env = process.env, fetcher = fetch, report = console.log) {
  if (env.VERCEL_ENV !== 'production' && env.STUDIO_CART_REMINDER_RELEASE_VERIFY !== '1') return;
  const base = (env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const key = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (base !== 'https://bwqhzczxoevouiondjak.supabase.co' || !key || key === '[SENSITIVE]') {
    throw Error('Cart reminder release requires the configured production project and service credential.');
  }
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  for (const path of [
    'orders?select=id,parent_dismissed_at&limit=0',
    'cart_reminder_scopes?select=scope_key,stop_through&limit=0',
    'cart_reminder_claims?select=id,provider_attempted_at&limit=0',
    'rpc/cart_reminder_context?p_order_id=00000000-0000-4000-8000-000000000000',
  ]) {
    const response = await fetcher(`${base}/rest/v1/${path}`, {
      method: 'GET', headers, cache: 'no-store', signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw Error(`Cart reminder migration verification failed (HTTP ${response.status}); details withheld.`);
    await response.body?.cancel();
  }
  report(JSON.stringify({ check: 'cart-reminder-migration', ok: true, customerMutations: 0, emailsSent: 0 }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyCartReminderRelease();
}

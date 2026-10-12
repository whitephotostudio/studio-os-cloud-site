import { pathToFileURL } from 'node:url';

// Read-only checks in the production build; no claims, sends or payment writes.
export async function verifyOrderVolumeRelease(env = process.env, fetcher = fetch, report = console.log) {
  if (env.STUDIO_PAYMENT_RELEASE_VERIFY !== '1') return;
  const origin = (env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const emailKey = (env.RESEND_API_KEY || '').trim();
  const cronSecret = (env.CRON_SECRET || '').trim();
  if (origin !== `https://${env.STUDIO_PAYMENT_EXPECTED_PROJECT_REF}.supabase.co` ||
      !serviceKey || serviceKey === '[SENSITIVE]') throw new Error('Order recovery database credentials or project are unavailable.');
  if (!emailKey || emailKey === '[SENSITIVE]' || !cronSecret || cronSecret === '[SENSITIVE]') {
    throw new Error('Paid order email provider and retry-worker credentials are required.');
  }
  async function get(url, headers) {
    const response = await fetcher(url, { method: 'GET', headers, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Order recovery verification failed (HTTP ${response.status}); provider details withheld.`);
    return response.json();
  }
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  for (const path of ['customer_order_webhooks?select=event_id,status,lease_until&limit=0',
    'customer_order_payment_checks?select=order_id,checked_at&limit=0',
    'paid_order_emails?select=id,status,payload,lease_token,first_attempt_at&limit=0',
    'paid_order_email_worker?select=singleton,lease_until&limit=0']) {
    await get(`${origin}/rest/v1/${path}`, headers);
  }
  const schema = await get(`${origin}/rest/v1/`, headers);
  const functions = ['claim_customer_order_webhook', 'finish_customer_order_webhook',
    'claim_pending_customer_order_payment_checks', 'ensure_paid_order_emails',
    'claim_paid_order_emails', 'prepare_paid_order_email', 'release_paid_order_email_worker'];
  const missing = functions.filter(name => !schema.paths?.[`/rpc/${name}`]?.post);
  if (missing.length) throw new Error(`Order recovery RPCs are missing: ${missing.join(', ')}.`);
  const domains = await get('https://api.resend.com/domains', { Authorization: `Bearer ${emailKey}` });
  const sender = (env.RESEND_FROM_EMAIL || '').trim() || 'galleries@studiooscloud.com';
  const domain = sender.split('@')[1]?.toLowerCase();
  if (!domains.data?.some(item => item.name.toLowerCase() === domain && item.status === 'verified')) {
    throw new Error('Paid order email sender domain is not verified.');
  }
  report(JSON.stringify({ check: 'order-volume-recovery', ok: true, senderDomain: domain,
    rpcCount: functions.length, financialMutations: 0, emailsSent: 0 }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyOrderVolumeRelease().catch(error => {
    console.error('[order-volume-release]', error instanceof Error ? error.message : 'Verification failed.');
    process.exitCode = 1;
  });
}

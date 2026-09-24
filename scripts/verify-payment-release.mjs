import { pathToFileURL } from 'node:url';

// Run inside the remote build: Vercel deliberately exports Secret values as
// [SENSITIVE]. Never export secrets, log provider error bodies, or move money.
export async function verifyPaymentRelease(env = process.env, fetcher = fetch, report = console.log) {
  if (env.STUDIO_PAYMENT_RELEASE_VERIFY !== '1') return;
  const key = (env.STRIPE_SECRET_KEY || '').trim();
  const serviceKey = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const databaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  if (!/^sk_live_[A-Za-z0-9]+$/.test(key)) throw new Error('A real production Stripe secret is required in the build environment.');
  if (!serviceKey || serviceKey === '[SENSITIVE]') throw new Error('A real Supabase service credential is required.');
  if (databaseUrl !== `https://${env.STUDIO_PAYMENT_EXPECTED_PROJECT_REF}.supabase.co`) throw new Error('Release database project does not match the expected project.');

  async function get(url, headers, label) {
    const response = await fetcher(url, { method: 'GET', headers, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`${label} failed (HTTP ${response.status}); provider details withheld.`);
    return response.json();
  }
  const db = (path) => get(`${databaseUrl}/rest/v1/${path}`, { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, 'Database verification');
  const stripe = (path, account) => get(`https://api.stripe.com/v1/${path}`, {
    Authorization: `Bearer ${key}`, ...(account ? { 'Stripe-Account': account } : {}),
    ...(env.STRIPE_API_VERSION ? { 'Stripe-Version': env.STRIPE_API_VERSION.trim() } : {}),
  }, 'Stripe verification');

  const account = await stripe('account');
  report(JSON.stringify({ check: 'stripe-authentication', ok: true, accountId: account.id }));
  await db('checkout_attempts?select=key&limit=0');
  await db('order_payment_locks?select=key&limit=0');
  report(JSON.stringify({ check: 'payment-migration-api', ok: true }));

  const endpoints = await stripe('webhook_endpoints?limit=100');
  if (endpoints.has_more) throw new Error('Webhook list requires manual pagination before release.');
  const webhookUrl = new URL('/api/stripe/webhook', env.STUDIO_PAYMENT_EXPECTED_APP_URL).href;
  const matching = endpoints.data.filter((e) => e.url === webhookUrl && e.status === 'enabled' && e.livemode);
  const requiredEvents = ['checkout.session.completed', 'payment_intent.succeeded', 'charge.refunded', 'refund.updated', 'refund.failed'];
  const missingEvents = requiredEvents.filter((event) => !matching.some((e) => e.enabled_events.includes('*') || e.enabled_events.includes(event)));
  report(JSON.stringify({ check: 'stripe-webhooks', endpointCount: matching.length, missingEvents }));
  if (missingEvents.length) throw new Error(`Production webhook subscription is missing: ${missingEvents.join(', ')}.`);

  const orderIds = (env.STUDIO_PAYMENT_AUDIT_ORDER_IDS || '').split(',').filter(Boolean);
  for (const id of orderIds) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid audit order ID.');
    const rows = await db(`orders?select=id,photographer_id,order_group_id,total_cents,currency,stripe_payment_intent_id,status,payment_status&id=eq.${id}`);
    const order = rows[0];
    if (!order?.stripe_payment_intent_id) throw new Error(`Audit order ${id} has no payment reference.`);
    const photographers = await db(`photographers?select=stripe_account_id,stripe_connected_account_id&id=eq.${order.photographer_id}`);
    const connectedAccount = photographers[0]?.stripe_connected_account_id || photographers[0]?.stripe_account_id;
    if (!connectedAccount) throw new Error(`Audit order ${id} has no connected Stripe account.`);
    const orders = order.order_group_id ? await db(`orders?select=id,photographer_id,total_cents,currency,stripe_payment_intent_id&order_group_id=eq.${order.order_group_id}`) : rows;
    const intent = await stripe(`payment_intents/${encodeURIComponent(order.stripe_payment_intent_id)}`, connectedAccount);
    if (orders.some((o) => o.photographer_id !== order.photographer_id || (o.currency || 'cad').toLowerCase() !== intent.currency || (o.stripe_payment_intent_id && o.stripe_payment_intent_id !== intent.id)) ||
        intent.amount !== orders.reduce((sum, o) => sum + o.total_cents, 0) || intent.metadata?.photographer_id !== order.photographer_id ||
        !(orders.some((o) => o.id === intent.metadata?.order_id) || (order.order_group_id && intent.metadata?.order_group_id === order.order_group_id))) {
      throw new Error(`Stripe ownership, amount or currency does not match audit order ${id}.`);
    }
    const refunds = await stripe(`refunds?payment_intent=${encodeURIComponent(intent.id)}&limit=100`, connectedAccount);
    if (refunds.has_more) throw new Error(`Audit order ${id} requires refund history pagination.`);
    const charge = intent.latest_charge ? await stripe(`charges/${encodeURIComponent(typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge.id)}`, connectedAccount) : null;
    report(JSON.stringify({ check: 'incident-payment', orderId: id, paymentId: intent.id, status: intent.status,
      currency: intent.currency, chargedCents: intent.amount_received, chargePaid: charge?.paid ?? false,
      chargeCaptured: charge?.captured ?? false, refundedCents: refunds.data.filter((r) => r.status === 'succeeded').reduce((sum, r) => sum + r.amount, 0),
      pendingRefunds: refunds.data.filter((r) => ['pending', 'requires_action'].includes(r.status)).length }));
  }
  report(JSON.stringify({ check: 'payment-release-verification', ok: true, financialMutations: 0 }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyPaymentRelease().catch((error) => {
    console.error('[payment-release]', error instanceof Error ? error.message : 'Verification failed.');
    process.exitCode = 1;
  });
}

import { pathToFileURL } from 'node:url';

// Run inside the remote build: Vercel deliberately exports Secret values as
// [SENSITIVE]. Never export secrets, log provider error bodies, or move money.
// Explicit webhook configuration flags may update event subscriptions only.
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
  const configureCreditWebhook = env.STUDIO_CREDIT_WEBHOOK_CONFIGURE === '1';
  if (configureCreditWebhook) {
    const expectedAccountId = (env.STUDIO_CREDIT_EXPECTED_ACCOUNT_ID || '').trim();
    if (!/^acct_[A-Za-z0-9_]+$/.test(expectedAccountId) || account.id !== expectedAccountId) {
      throw new Error('Platform credit webhook configuration requires the exact expected Stripe account ID.');
    }
    if (env.STUDIO_PAYMENT_REFUND_WEBHOOK_ID) {
      throw new Error('Platform credit and order refund webhook configuration must run separately.');
    }
  }
  await db('checkout_attempts?select=key&limit=0');
  await db('order_payment_locks?select=key&limit=0');
  report(JSON.stringify({ check: 'payment-migration-api', ok: true }));
  if (env.STUDIO_CREDIT_RELEASE_VERIFY === '1') {
    await db('studio_credits?select=id,studio_id,balance,credit_debt&limit=0');
    await db('order_usage_fees?select=order_id,report_status,refund_status,event_identifier,amount_cents,currency&limit=0');
    await db('credit_cloud_jobs?select=id,studio_id,status,input_sha256,original_sha256,output_sha256,output_key&limit=0');
    await db('credit_cutout_claims?select=id,studio_id,receipt_id,original_sha256&limit=0');
    await db('credit_cutout_entitlements?select=claim_id,cutout_sha256&limit=0');
    await db('credit_cutout_objects?select=object_key,studio_id,original_sha256,cutout_sha256&limit=0');
    await db('credit_legacy_cutout_objects?select=object_key,studio_id,cutout_sha256,review_snapshot_at&limit=0');
    const schema = await db('');
    const requiredRpcs = ['apply_credit_adjustment', 'reverse_credit_purchase', 'get_studio_credit_balance',
      'stage_order_usage_fee', 'claim_order_usage_fee', 'complete_order_usage_fee_report', 'reserve_cloud_credit_job', 'finish_cloud_credit_job',
      'expire_due_credit_accounts', 'get_studio_cutout_entitlement', 'register_studio_cutout_entitlement',
      'register_verified_cutout_revision', 'bind_cloud_cutout_original', 'set_cloud_cutout_output',
      'link_credit_cutout_object', 'authorized_credit_cutout_keys', 'has_studio_cutout_entitlement'];
    const missingRpcs = requiredRpcs.filter((name) => !schema.paths?.[`/rpc/${name}`]?.post);
    if (missingRpcs.length) throw new Error(`Credit migration RPCs are missing: ${missingRpcs.join(', ')}.`);
    report(JSON.stringify({ check: 'credit-migration-api', ok: true, financialMutations: 0 }));
  }
  if (env.STUDIO_REFUND_EMAIL_VERIFY === '1') {
    await db('order_refund_emails?select=id&limit=0');
    const emailKey = (env.RESEND_API_KEY || '').trim();
    if (!emailKey || emailKey === '[SENSITIVE]' || !env.CRON_SECRET || env.CRON_SECRET === '[SENSITIVE]') throw new Error('Refund email provider and retry-worker credentials are required.');
    const domains = await get('https://api.resend.com/domains', { Authorization: `Bearer ${emailKey}` }, 'Refund email provider verification');
    const domain = (env.RESEND_FROM_EMAIL || 'galleries@studiooscloud.com').split('@')[1]?.toLowerCase();
    if (!domains.data?.some(d => d.name.toLowerCase() === domain && d.status === 'verified')) throw new Error('Refund email sender domain is not verified.');
    report(JSON.stringify({ check: 'refund-email-configuration', ok: true, senderDomain: domain }));
  }


  const endpoints = await stripe('webhook_endpoints?limit=100');
  if (endpoints.has_more) throw new Error('Webhook list requires manual pagination before release.');
  const expectedOrigin = new URL(env.STUDIO_PAYMENT_EXPECTED_APP_URL);
  const matchesOrigin = (value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.replace(/^www\./, '') === expectedOrigin.hostname.replace(/^www\./, '') &&
      url.port === expectedOrigin.port && url.pathname.replace(/\/$/, '') === '/api/stripe/webhook';
  };
  const configureId = env.STUDIO_PAYMENT_REFUND_WEBHOOK_ID;
  if (configureId) {
    const endpoint = endpoints.data.find((e) => e.id === configureId);
    if (!endpoint || !matchesOrigin(endpoint.url) || endpoint.status !== 'enabled' || !endpoint.livemode ||
        !['checkout.session.completed', 'payment_intent.succeeded', 'charge.refunded'].every((event) => endpoint.enabled_events.includes('*') || endpoint.enabled_events.includes(event))) {
      throw new Error('The selected webhook is not the existing production order-payment endpoint.');
    }
    const addedEvents = ['refund.updated', 'refund.failed'].filter((event) => !endpoint.enabled_events.includes('*') && !endpoint.enabled_events.includes(event));
    if (addedEvents.length) {
      const body = new URLSearchParams();
      for (const event of [...endpoint.enabled_events, ...addedEvents]) body.append('enabled_events[]', event);
      const response = await fetcher(`https://api.stripe.com/v1/webhook_endpoints/${encodeURIComponent(endpoint.id)}`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body, signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error(`Refund webhook configuration failed (HTTP ${response.status}); provider details withheld.`);
      const updated = await response.json();
      if (updated.id !== endpoint.id || updated.url !== endpoint.url || !updated.livemode || updated.status !== 'enabled' ||
          ![...endpoint.enabled_events, ...addedEvents].every((event) => updated.enabled_events.includes(event))) {
        throw new Error('Updated webhook subscription could not be verified.');
      }
      endpoints.data[endpoints.data.indexOf(endpoint)] = updated;
      report(JSON.stringify({ check: 'stripe-refund-webhook-update', endpointId: endpoint.id, addedEvents }));
    }
  }
  const matching = endpoints.data.filter((e) => matchesOrigin(e.url) && e.status === 'enabled' && e.livemode);
  const requiredEvents = ['checkout.session.completed', 'payment_intent.succeeded', 'charge.refunded', 'refund.updated', 'refund.failed'];
  if (env.STUDIO_CREDIT_RELEASE_VERIFY === '1' || env.STUDIO_CREDIT_WEBHOOK_VERIFY === '1' || env.STUDIO_CREDIT_WEBHOOK_CONFIGURE === '1') {
    const creditEvents = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'charge.refunded', 'refund.updated', 'refund.failed'];
    // Connect endpoints receive photographers' customer-order events. Credits
    // must be fulfilled by an endpoint listening on the platform's account.
    const platformEndpoints = matching.filter((endpoint) => endpoint.application === null && endpoint.livemode === true);
    report(JSON.stringify({ check: 'stripe-credit-webhook-selection', endpoints: platformEndpoints.map((endpoint) => ({
      id: endpoint.id, url: new URL(endpoint.url).origin + new URL(endpoint.url).pathname,
      status: endpoint.status, livemode: endpoint.livemode, application: endpoint.application, events: endpoint.enabled_events,
    })) }));
    // This is deliberately an additional exact opt-in. Missing event checks are
    // read-only by default, even when they block the candidate build.
    if (configureCreditWebhook) {
      const candidates = platformEndpoints.filter((endpoint) => Array.isArray(endpoint.enabled_events) &&
        endpoint.enabled_events.some((event) => event === '*' || event === 'checkout.session.completed'));
      if (candidates.length !== 1 || !/^we_[A-Za-z0-9_]+$/.test(candidates[0].id || '') ||
          !candidates[0].enabled_events.every((event) => typeof event === 'string')) {
        throw new Error('Platform credit webhook configuration requires exactly one existing production platform checkout endpoint.');
      }
      const selected = candidates[0];
      const addedEvents = creditEvents.filter((event) => !selected.enabled_events.includes('*') && !selected.enabled_events.includes(event));
      if (addedEvents.length) {
        const body = new URLSearchParams();
        for (const event of [...selected.enabled_events, ...addedEvents]) body.append('enabled_events[]', event);
        const response = await fetcher(`https://api.stripe.com/v1/webhook_endpoints/${encodeURIComponent(selected.id)}`, {
          method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body, signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) throw new Error(`Platform credit webhook configuration failed (HTTP ${response.status}); provider details withheld.`);
        const updated = await response.json();
        if (updated.id !== selected.id || updated.url !== selected.url || updated.livemode !== true || updated.status !== 'enabled' ||
            updated.application !== null || !Array.isArray(updated.enabled_events) ||
            ![...selected.enabled_events, ...addedEvents].every((event) => updated.enabled_events.includes(event))) {
          throw new Error('Updated platform credit webhook subscription could not be verified.');
        }
        endpoints.data[endpoints.data.indexOf(selected)] = updated;
        matching[matching.indexOf(selected)] = updated;
        platformEndpoints[platformEndpoints.indexOf(selected)] = updated;
        report(JSON.stringify({ check: 'stripe-credit-webhook-update', endpointId: selected.id, addedEvents }));
      }
    }
    const missingCreditEvents = creditEvents.filter((event) => !platformEndpoints.some((endpoint) => endpoint.enabled_events.includes('*') || endpoint.enabled_events.includes(event)));
    report(JSON.stringify({ check: 'stripe-credit-webhooks', endpointCount: platformEndpoints.length, missingEvents: missingCreditEvents }));
    if (missingCreditEvents.length) throw new Error(`Platform credit webhook subscription is missing: ${missingCreditEvents.join(', ')}.`);
  }
  const missingEvents = requiredEvents.filter((event) => !matching.some((e) => e.enabled_events.includes('*') || e.enabled_events.includes(event)));
  report(JSON.stringify({ check: 'stripe-webhooks', endpointCount: matching.length, missingEvents,
    endpoints: endpoints.data.map((e) => ({ id: e.id, url: new URL(e.url).origin + new URL(e.url).pathname,
      status: e.status, livemode: e.livemode, events: e.enabled_events })) }));

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
      refunds: refunds.data.map(r => ({ id:r.id, status:r.status, amount:r.amount, currency:r.currency, created:r.created })),
      pendingRefunds: refunds.data.filter((r) => ['pending', 'requires_action'].includes(r.status)).length }));
  }
  if (missingEvents.length) throw new Error(`Production webhook subscription is missing: ${missingEvents.join(', ')}.`);
  report(JSON.stringify({ check: 'payment-release-verification', ok: true, financialMutations: 0 }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyPaymentRelease().catch((error) => {
    console.error('[payment-release]', error instanceof Error ? error.message : 'Verification failed.');
    process.exitCode = 1;
  });
}

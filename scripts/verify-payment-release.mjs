import { pathToFileURL } from 'node:url';

const missingHistorySchemaCodes = new Set(['42883','42P01','42703','PGRST202','PGRST204','PGRST205']);
const missingHistorySchema = error => missingHistorySchemaCodes.has(error?.code);
const validAccount = value => typeof value === 'string' && /^acct_[A-Za-z0-9_]+$/.test(value);

// These routing identities are public configuration, never credentials.
export const WHITEPHOTO_STANDARD_AUDIT_SCOPE = Object.freeze({
  releaseKey: 'whitephoto-20261015', projectRef: 'bwqhzczxoevouiondjak',
  platformAccountId: 'acct_1TBlT4PxlnWeytFA', photographerId: 'ed6b8a99-1f38-48f3-a198-447c49b5ac34',
  userId: '4a9f37fe-d217-4edd-bcf9-3a561da2e2f0', expressAccountId: 'acct_1TIHTrLqg5vdCgpU',
  standardAccountId: 'acct_1UQHR5LZhEC2SlmP',
});
export const STANDARD_CONNECT_WEBHOOK_EVENTS = Object.freeze([
  'checkout.session.completed','payment_intent.succeeded','charge.refunded','refund.updated','refund.failed',
  'account.updated','account.application.deauthorized','charge.dispute.created','charge.dispute.updated',
  'charge.dispute.closed','charge.dispute.funds_withdrawn','charge.dispute.funds_reinstated',
]);
export const STANDARD_PLATFORM_WEBHOOK_EVENTS = Object.freeze(['application_fee.refunded','application_fee.refund.updated']);

/** v1 application identifies an associated Connect application, not an explicit
 * event scope. Require the provider's v2 events_from and snapshot payload instead.
 * https://docs.stripe.com/api/v2/core/event-destinations/object */
export function verifyStandardWebhookDestinations(list, expectedAppUrl) {
  if (!Array.isArray(list?.data) || list.next_page_url !== null) throw new Error('Standard webhook destination scope proof is incomplete or requires pagination.');
  const expected=new URL(expectedAppUrl);
  const matches=destination=>{
    try{const url=new URL(destination.webhook_endpoint?.url);return url.protocol==='https:'&&url.hostname.replace(/^www\./,'')===expected.hostname.replace(/^www\./,'')&&
      url.port===expected.port&&url.pathname.replace(/\/$/,'')==='/api/stripe/webhook'&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{return false;}
  };
  const endpoints=list.data.filter(destination=>destination?.object==='v2.core.event_destination'&&destination.type==='webhook_endpoint'&&
    destination.status==='enabled'&&destination.livemode===true&&destination.event_payload==='snapshot'&&
    Array.isArray(destination.events_from)&&destination.events_from.every(scope=>typeof scope==='string')&&
    Array.isArray(destination.enabled_events)&&destination.enabled_events.every(event=>typeof event==='string')&&matches(destination));
  const connected=endpoints.filter(endpoint=>endpoint.events_from.includes('@accounts'));
  const platform=endpoints.filter(endpoint=>endpoint.events_from.includes('@self'));
  const missing=(names,eligible)=>names.filter(event=>!eligible.some(endpoint=>endpoint.enabled_events.includes('*')||endpoint.enabled_events.includes(event)));
  const missingConnectedEvents=missing(STANDARD_CONNECT_WEBHOOK_EVENTS,connected),missingPlatformEvents=missing(STANDARD_PLATFORM_WEBHOOK_EVENTS,platform);
  return {ok:missingConnectedEvents.length===0&&missingPlatformEvents.length===0,scopeProof:'provider_v2_events_from',
    connectedDestinationIds:connected.map(endpoint=>endpoint.id),platformDestinationIds:platform.map(endpoint=>endpoint.id),
    missingConnectedEvents,missingPlatformEvents,
    destinations:endpoints.map(endpoint=>({id:endpoint.id,eventsFrom:endpoint.events_from,eventPayload:endpoint.event_payload,enabledEvents:endpoint.enabled_events,
      url:new URL(endpoint.webhook_endpoint.url).origin+new URL(endpoint.webhook_endpoint.url).pathname}))};
}

async function standardDestinationsGet(key,fetcher) {
  const response=await fetcher('https://api.stripe.com/v2/core/event_destinations?include%5B0%5D=webhook_endpoint.url&limit=100',{
    method:'GET',headers:{Authorization:`Bearer ${key}`,'Stripe-Version':'2026-09-30.endive'},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`Standard webhook destination scope verification failed (HTTP ${response.status}); use signed Workbench review, never infer scope from v1 application.`);
  return response.json();
}

/** Optional pre-schema, GET-only audit inside the protected remote build. It
 * never proves DB routing or activation readiness and permits only empty (not
 * conflicting) candidate ownership while reporting that binding still remains. */
export async function verifyStandardProviderRelease(env=process.env,fetcher=fetch,report=console.log) {
  if(env.STUDIO_STANDARD_PROVIDER_RELEASE_VERIFY!=='1')return;
  const scope=WHITEPHOTO_STANDARD_AUDIT_SCOPE,key=(env.STRIPE_SECRET_KEY||'').trim();
  if(!/^sk_live_[A-Za-z0-9]+$/.test(key)||env.STUDIO_STANDARD_EXPECTED_PLATFORM_ACCOUNT_ID!==scope.platformAccountId||
    env.STUDIO_PAYMENT_EXPECTED_PROJECT_REF!==scope.projectRef||env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/,'')!==`https://${scope.projectRef}.supabase.co`||
    !['https://studiooscloud.com','https://www.studiooscloud.com'].includes(env.STUDIO_PAYMENT_EXPECTED_APP_URL?.replace(/\/$/,'')))throw new Error('Provider-only Standard proof requires exact live platform/project/app configuration in the protected build.');
  const get=async path=>{const response=await fetcher(`https://api.stripe.com/v1/${path}`,{method:'GET',headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error(`Provider-only Standard GET verification failed (HTTP ${response.status}); details withheld.`);return response.json();};
  const platform=await get('account'),balance=await get('balance');
  if(platform.id!==scope.platformAccountId||balance.object!=='balance'||balance.livemode!==true)throw new Error('Provider-only exact platform or live balance proof failed.');
  const standard=await get(`accounts/${scope.standardAccountId}`),express=await get(`accounts/${scope.expressAccountId}`);
  const ready=verifyStandardReleaseAccounts(standard,express,{allowUnboundCandidate:true});
  report(JSON.stringify({check:'stripe-standard-provider-only-readiness',ok:true,platformAccountId:platform.id,
    standardAccountId:standard.id,expressAccountId:express.id,ownershipBound:ready.ownershipBound,currentRequirementsClear:true,
    futureRequirementsClear:true,expressRollbackReady:true,databaseRoutingVerified:false,activationReady:false,databaseMutations:0,financialMutations:0}));
  const destinations=verifyStandardWebhookDestinations(await standardDestinationsGet(key,fetcher),env.STUDIO_PAYMENT_EXPECTED_APP_URL);
  report(JSON.stringify({check:'stripe-standard-provider-only-webhooks',...destinations,databaseMutations:0,financialMutations:0}));
  if(!destinations.ok)throw new Error('Standard webhook connected/platform snapshot subscriptions are incomplete.');
}

export function verifyStandardReleaseControl(control, env, platformAccountId) {
  const scope = WHITEPHOTO_STANDARD_AUDIT_SCOPE;
  const liveCheckout = env.STRIPE_STANDARD_LIVE_CHECKOUT_ENABLED === 'true';
  const liveMigration = env.STRIPE_STANDARD_LIVE_MIGRATION_ENABLED === 'true';
  if (platformAccountId !== scope.platformAccountId || env.STUDIO_PAYMENT_EXPECTED_PROJECT_REF !== scope.projectRef ||
      env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '') !== `https://${scope.projectRef}.supabase.co` ||
      control?.release_key !== scope.releaseKey || control.platform_account_id !== scope.platformAccountId ||
      control.photographer_id !== scope.photographerId || control.actor_user_id !== scope.userId ||
      control.express_account_id !== scope.expressAccountId || control.standard_account_id !== scope.standardAccountId ||
      !['migration_enabled','checkout_enabled','reservation_required','activation_enabled'].every(name => typeof control[name] === 'boolean') ||
      !Array.isArray(control.allowed_currencies) || control.allowed_currencies.length !== 2 ||
      [...control.allowed_currencies].sort().join(',') !== 'cad,usd') {
    throw new Error('The exact WhitePhoto live release scope and CAD/USD controls could not be verified.');
  }
  if (control.migration_enabled && !control.checkout_enabled || liveCheckout && !control.checkout_enabled ||
      liveMigration && (!control.migration_enabled || !liveCheckout || env.STRIPE_STANDARD_MIGRATION_ENABLED !== 'true') ||
      (liveCheckout || liveMigration || control.migration_enabled || control.checkout_enabled) && !control.reservation_required ||
      (liveCheckout || liveMigration) && env.STUDIO_STANDARD_EXPECTED_PLATFORM_ACCOUNT_ID !== scope.platformAccountId) {
    throw new Error('The live Standard flags, reservation barrier and database release controls disagree.');
  }
  return {liveCheckout,liveMigration};
}

function emptyRequirements(requirements) {
  return requirements && typeof requirements === 'object' && !requirements.disabled_reason &&
    ['currently_due','eventually_due','past_due','pending_verification','errors']
      .every(name => Array.isArray(requirements[name]) && requirements[name].length === 0);
}

export function verifyStandardReleaseAccounts(standard, express, {allowUnboundCandidate = false} = {}) {
  const scope = WHITEPHOTO_STANDARD_AUDIT_SCOPE;
  const owned = account => account.metadata?.photographer_id === scope.photographerId && account.metadata?.user_id === scope.userId;
  const metadata = standard?.metadata || {};
  const ownershipBound = Boolean(standard && owned(standard));
  const conflicting = metadata.photographer_id && metadata.photographer_id !== scope.photographerId ||
    metadata.user_id && metadata.user_id !== scope.userId ||
    metadata.studio_os_migration && metadata.studio_os_migration !== scope.releaseKey;
  const emptyOwnership = !metadata.photographer_id && !metadata.user_id;
  const ownershipAllowed = !conflicting && (ownershipBound || allowUnboundCandidate && emptyOwnership);
  if (standard?.id !== scope.standardAccountId || standard.type !== 'standard' || standard.country !== 'CA' ||
      standard.default_currency !== 'cad' || standard.details_submitted !== true || standard.charges_enabled !== true ||
      standard.payouts_enabled !== true || standard.capabilities?.card_payments !== 'active' || standard.capabilities?.transfers !== 'active' ||
      standard.controller?.fees?.payer !== 'account' || standard.controller?.losses?.payments !== 'stripe' ||
      standard.controller?.requirement_collection !== 'stripe' || standard.controller?.stripe_dashboard?.type !== 'full' ||
      standard.livemode === false || !ownershipAllowed || !emptyRequirements(standard.requirements) ||
      !emptyRequirements(standard.future_requirements)) {
    throw new Error('The exact Standard account ownership, payment configuration or current/future requirements are unverified.');
  }
  const expressRequirements = express?.requirements;
  const expressCurrentlyReady = expressRequirements && !expressRequirements.disabled_reason &&
    ['currently_due','past_due','pending_verification','errors'].every(name => Array.isArray(expressRequirements[name]) && expressRequirements[name].length === 0);
  if (express?.id !== scope.expressAccountId || express.type !== 'express' || express.country !== 'CA' ||
      express.details_submitted !== true || express.charges_enabled !== true || express.payouts_enabled !== true ||
      express.livemode === false || !owned(express) || express.capabilities?.card_payments !== 'active' ||
      express.capabilities?.transfers !== 'active' || !expressCurrentlyReady) {
    throw new Error('The original Express account ownership or rollback readiness is unverified.');
  }
  return {ownershipBound};
}


/** GET-only account proof. The immutable resolver runs even when the optional
 * full-schema release probe is off; disabling a flag cannot rewrite history. */
export async function resolveAuditedPaymentAccount(db, order, historyRequired = false) {
  const parameters = new URLSearchParams({p_photographer_id: order.photographer_id, p_order_id: order.id,
    p_payment_intent_id: order.stripe_payment_intent_id});
  if (order.order_group_id) parameters.set('p_order_group_id', order.order_group_id);
  try {
    const account = await db(`rpc/resolve_order_payment_account?${parameters}`);
    if (!validAccount(account)) throw new Error('Audit payment original account cannot be verified.');
    return account;
  } catch (error) {
    if (!missingHistorySchema(error)) throw error;
    if (historyRequired) throw new Error('Required payment account history schema is unavailable.');
  }
  let photographers;
  try {
    photographers = await db(`photographers?select=stripe_account_id,stripe_connected_account_id,stripe_standard_migrated_at&id=eq.${order.photographer_id}`);
  } catch (error) {
    // Only an absent marker column identifies a genuinely pre-history schema.
    // Other errors, including a timeout, must never select another account.
    if (!['42703','PGRST204'].includes(error?.code)) throw error;
    photographers = await db(`photographers?select=stripe_account_id,stripe_connected_account_id&id=eq.${order.photographer_id}`);
  }
  if (!Array.isArray(photographers) || photographers.length !== 1 || photographers[0].stripe_standard_migrated_at) {
    throw new Error('A migrated audit payment requires its verified original account.');
  }
  const account = photographers[0].stripe_connected_account_id || photographers[0].stripe_account_id;
  if (!validAccount(account)) throw new Error('Audit payment has no verified merchant account.');
  return account;
}

// Run inside the remote build: Vercel deliberately exports Secret values as
// [SENSITIVE]. Never export secrets, log provider error bodies, or move money.
// Explicit webhook configuration flags may update event subscriptions only.
export async function verifyPaymentRelease(env = process.env, fetcher = fetch, report = console.log) {
  await verifyStandardProviderRelease(env,fetcher,report);
  const liveStandardRequested = env.STRIPE_STANDARD_LIVE_CHECKOUT_ENABLED === 'true' || env.STRIPE_STANDARD_LIVE_MIGRATION_ENABLED === 'true';
  let standardWebhooksRequired=liveStandardRequested;
  const historyRequired = env.STUDIO_STRIPE_ACCOUNT_HISTORY_VERIFY === '1' || liveStandardRequested;
  if (env.STUDIO_PAYMENT_RELEASE_VERIFY !== '1' && env.STUDIO_ORDER_PLATFORM_FEE_RELEASE_VERIFY !== '1' && !historyRequired) return;
  const key = (env.STRIPE_SECRET_KEY || '').trim();
  const serviceKey = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const databaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  if (!/^sk_live_[A-Za-z0-9]+$/.test(key)) throw new Error('A real production Stripe secret is required in the build environment.');
  if (!serviceKey || serviceKey === '[SENSITIVE]') throw new Error('A real Supabase service credential is required.');
  if (databaseUrl !== `https://${env.STUDIO_PAYMENT_EXPECTED_PROJECT_REF}.supabase.co`) throw new Error('Release database project does not match the expected project.');

  async function get(url, headers, label) {
    const response = await fetcher(url, { method: 'GET', headers, signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      const failure = new Error(`${label} failed (HTTP ${response.status}); provider details withheld.`);
      if (label === 'Database verification' && typeof response.json === 'function') {
        // Keep only a known schema error code for fail-closed compatibility.
        // Never expose raw PostgREST/Stripe error bodies or credential fragments.
        try {
          const body = await response.json();
          if (missingHistorySchemaCodes.has(body?.code)) failure.code = body.code;
        } catch { /* Invalid/missing error JSON cannot authorize fallback. */ }
      }
      throw failure;
    }
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
  if (historyRequired) {
    await db('photographers?select=id,stripe_standard_migrated_at,stripe_connect_route_version&limit=0');
    await db('photographer_stripe_accounts?select=id,stripe_account_id,livemode,status,future_requirements&limit=0');
    await db('order_payment_accounts?select=id,stripe_account_id,order_ids,fee_snapshot,request_hash&limit=0');
    await db('stripe_merchant_events?select=event_id,status&limit=0');
    await db('stripe_merchant_disputes?select=dispute_id,status&limit=0');
    const schema = await db('');
    const required = ['resolve_order_payment_account','reserve_order_payment_account','bind_order_payment_references',
      'backfill_order_payment_account','activate_photographer_standard_account','rollback_photographer_standard_account',
      'claim_stripe_merchant_event','finish_stripe_merchant_event','get_photographer_checkout_routing',
      'register_photographer_stripe_account','assert_whitephoto_live_stripe_scope','stripe_account_history_schema_status'];
    if (required.some(name => !schema.paths?.[`/rpc/${name}`]?.post)) throw new Error('Stripe account-history or merchant recovery schema is incomplete.');
    const protections = await db('rpc/stripe_account_history_schema_status');
    if (protections?.version !== '20261015010000' || protections.history_schema_present !== true || protections.reservation_guard_present !== true) {
      throw new Error('The installed Stripe history or reservation protections are incomplete.');
    }
    const scope = WHITEPHOTO_STANDARD_AUDIT_SCOPE;
    const controls = await db('stripe_standard_live_release_controls?select=release_key,migration_enabled,checkout_enabled,reservation_required,activation_enabled,platform_account_id,photographer_id,actor_user_id,express_account_id,standard_account_id,allowed_currencies&release_key=eq.' + scope.releaseKey);
    if (!Array.isArray(controls) || controls.length !== 1) throw new Error('The exact Standard release-control row is unavailable.');
    const control = controls[0];
    standardWebhooksRequired ||= control.migration_enabled===true||control.checkout_enabled===true||control.activation_enabled===true;
    const flags = verifyStandardReleaseControl(control, env, account.id);
    report(JSON.stringify({check:'stripe-standard-live-release-controls',ok:true,releaseKey:scope.releaseKey,
      exactScopeVerified:true,migrationEnabled:control.migration_enabled,checkoutEnabled:control.checkout_enabled,
      reservationRequired:control.reservation_required,activationEnabled:control.activation_enabled,allowedCurrencies:control.allowed_currencies,
      liveCheckoutFlag:flags.liveCheckout,liveMigrationFlag:flags.liveMigration,databaseMutations:0,financialMutations:0}));
    if (liveStandardRequested || control.migration_enabled || control.checkout_enabled) {
      const balance = await stripe('balance');
      if (balance.object !== 'balance' || balance.livemode !== true) throw new Error('The exact live Stripe platform balance could not be verified.');
      const standard = await stripe(`accounts/${scope.standardAccountId}`);
      const express = await stripe(`accounts/${scope.expressAccountId}`);
      const photographers = await db('photographers?select=id,user_id,stripe_account_id,stripe_connected_account_id,stripe_standard_migrated_at&id=eq.' + scope.photographerId);
      if (!Array.isArray(photographers) || photographers.length !== 1 || photographers[0].id !== scope.photographerId || photographers[0].user_id !== scope.userId) {
        throw new Error('The fresh WhitePhoto payment-route owner could not be verified.');
      }
      const photographer = photographers[0];
      const selectedAccount = photographer.stripe_connected_account_id || photographer.stripe_account_id;
      if (![scope.expressAccountId,scope.standardAccountId].includes(selectedAccount) ||
          selectedAccount === scope.standardAccountId && !photographer.stripe_standard_migrated_at) {
        throw new Error('The fresh WhitePhoto payment route or migration marker is unverified.');
      }
      const preparation = control.activation_enabled === false && selectedAccount === scope.expressAccountId && !photographer.stripe_standard_migrated_at;
      const readiness = verifyStandardReleaseAccounts(standard, express, {allowUnboundCandidate:preparation});
      report(JSON.stringify({check:'stripe-standard-live-account-readiness',ok:true,ownershipBound:readiness.ownershipBound,
        preparationOnly:preparation,activationEnabled:control.activation_enabled,
        futureRequirementsClear:true,currentRequirementsClear:true,expressRollbackReady:true,databaseMutations:0,financialMutations:0}));
    }
    report(JSON.stringify({check:'stripe-account-history-schema',ok:true,financialMutations:0,databaseMutations:0}));
  }
  if (env.STUDIO_ORDER_PLATFORM_FEE_RELEASE_VERIFY === '1') {
    await db('orders?select=id,platform_fee_collection_method,platform_fee_amount_cents,platform_fee_currency,platform_fee_rate_cents,stripe_application_fee_id&limit=0');
    const feeSchema = await db('rpc/order_platform_fee_schema_status');
    const protections = ['columns_present', 'constraint_present', 'snapshot_guard_present', 'legacy_usage_guard_present', 'atomic_freeze_present'];
    if (feeSchema?.version !== '20261007010000' || protections.some(name => feeSchema?.[name] !== true)) {
      throw new Error('Direct order service-fee schema protections are missing; apply the exact collection migration before release.');
    }
    report(JSON.stringify({ check: 'direct-order-fee-schema', ok: true, version: feeSchema.version, financialMutations: 0, databaseMutations: 0 }));
  }
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
  if(standardWebhooksRequired){
    const destinations=verifyStandardWebhookDestinations(await standardDestinationsGet(key,fetcher),env.STUDIO_PAYMENT_EXPECTED_APP_URL);
    report(JSON.stringify({check:'stripe-standard-webhook-scopes',...destinations,databaseMutations:0,financialMutations:0}));
    if(!destinations.ok)throw new Error('Standard webhook connected/platform snapshot subscriptions are incomplete.');
  }

  const orderIds = (env.STUDIO_PAYMENT_AUDIT_ORDER_IDS || '').split(',').filter(Boolean);
  for (const id of orderIds) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid audit order ID.');
    const rows = await db(`orders?select=id,photographer_id,order_group_id,total_cents,currency,stripe_payment_intent_id,status,payment_status&id=eq.${id}`);
    const order = rows[0];
    if (!order?.stripe_payment_intent_id) throw new Error(`Audit order ${id} has no payment reference.`);
    const connectedAccount = await resolveAuditedPaymentAccount(db, order, historyRequired);
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

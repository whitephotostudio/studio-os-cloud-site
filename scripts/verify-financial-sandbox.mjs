import { pathToFileURL } from 'node:url';

const AUDITED_BRANCH = 'codex/credit-system-audit-20260929';
const PRODUCTION_PROJECT = 'bwqhzczxoevouiondjak';
const PRODUCTION_HOST = 'studiooscloud.com';
const CREDIT_EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'charge.refunded', 'refund.updated', 'refund.failed'];
const BILLING_EVENTS = ['customer.subscription.created', 'customer.subscription.updated',
  'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'];
const ORDER_EVENTS = ['checkout.session.completed', 'payment_intent.succeeded',
  'payment_intent.payment_failed', 'charge.refunded', 'refund.updated', 'refund.failed', 'account.updated'];
const TABLE_PROBES = [
  'photographers?select=id,user_id,stripe_platform_customer_id,stripe_subscription_id,subscription_current_period_start,subscription_current_period_end,order_usage_rate_cents&limit=0',
  'credit_packages?select=id&limit=0',
  'studio_credits?select=id,studio_id,balance,credit_debt,credit_lots_initialized&limit=0',
  'credit_transactions?select=id,studio_id,credits_delta,stripe_payment_intent_id&limit=0',
  'credit_lots?select=id,studio_id,remaining_credits,expires_at&limit=0',
  'credit_usage_allocations?select=transaction_id,lot_id&limit=0',
  'credit_debt_payments?select=id,original_lot_id,payment_lot_id&limit=0',
  'credit_cloud_jobs?select=id,status,original_sha256,output_sha256,output_key&limit=0',
  'credit_cutout_security_epoch?select=singleton,secured_at&limit=0',
  'credit_cutout_claims?select=id,studio_id,receipt_id,original_sha256&limit=0',
  'credit_cutout_entitlements?select=claim_id,cutout_sha256&limit=0',
  'credit_cutout_objects?select=object_key,studio_id,original_sha256,cutout_sha256&limit=0',
  'order_usage_fees?select=order_id,event_identifier,amount_cents,report_status,refund_status&limit=0',
  'checkout_attempts?select=key&limit=0',
  'order_payment_locks?select=key&limit=0',
  'stripe_events?select=id,event_type,livemode&limit=0',
];
// The OpenAPI request below authenticates as service_role. Client-only RPCs
// are intentionally absent from that role's schema when grants are enforced.
const REQUIRED_SERVICE_RPCS = ['apply_credit_adjustment', 'reverse_credit_purchase', 'get_studio_credit_balance', 'expire_due_credit_accounts',
  'stage_order_usage_fee', 'claim_order_usage_fee', 'complete_order_usage_fee_report',
  'reserve_cloud_credit_job', 'finish_cloud_credit_job', 'get_studio_cutout_entitlement',
  'register_studio_cutout_entitlement', 'register_verified_cutout_revision', 'bind_cloud_cutout_original',
  'set_cloud_cutout_output', 'link_credit_cutout_object', 'authorized_credit_cutout_keys', 'has_studio_cutout_entitlement'];

export class FinancialSandboxVerificationError extends Error {}
function fail(message) { throw new FinancialSandboxVerificationError(message); }
function configured(value) {
  return typeof value === 'string' && value.trim() && value !== '[SENSITIVE]' &&
    !/replace|placeholder|your[_-]|[<>]/i.test(value) && !/\s/.test(value);
}
function safeUrl(value, label) {
  let url;
  try { url = new URL(value); } catch { fail(`${label} is invalid.`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port ||
      !configured(url.hostname) || url.pathname !== '/') fail(`${label} must be one explicit HTTPS origin.`);
  return url;
}
function productionHost(hostname) {
  return hostname === PRODUCTION_HOST || hostname.endsWith(`.${PRODUCTION_HOST}`);
}
function validateDatabaseKey(value, role, ref) {
  if (!configured(value)) fail('Separate sandbox database credentials are required.');
  if (value.startsWith('eyJ')) {
    let claims;
    try { claims = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8')); }
    catch { fail('Sandbox database credential metadata is invalid.'); }
    if (claims.ref !== ref || claims.role !== role) fail('Sandbox database credentials target the wrong project or role.');
  } else if (!value.startsWith(role === 'anon' ? 'sb_publishable_' : 'sb_secret_')) {
    fail('A project-bound sandbox database credential is required.');
  }
}

// No dotenv import and no fallback to the project's production .env.local.
// Pass an explicit isolated env file with Node --env-file, or run with the
// separate Preview project's scoped configuration. Only GET requests are used.
export function validateFinancialSandboxEnvironment(env) {
  if (env.VERCEL_ENV !== 'preview') fail('Financial sandbox verification requires Vercel Preview metadata.');
  if (env.VERCEL_GIT_COMMIT_REF !== AUDITED_BRANCH) fail('Financial sandbox verification requires the audited credit branch.');
  if (env.STUDIO_PAYMENT_RELEASE_VERIFY === '1' || env.STUDIO_CREDIT_WEBHOOK_CONFIGURE === '1' ||
      env.STUDIO_PAYMENT_REFUND_WEBHOOK_ID) fail('Production release and webhook mutation flags must be disabled.');
  const key = (env.STRIPE_SECRET_KEY || '').trim();
  if (!configured(key) || !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key)) fail('Only a private Stripe test-mode key is permitted.');
  for (const name of ['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'STRIPE_PUBLISHABLE_KEY']) {
    if (env[name] && (!configured(env[name]) || !/^pk_test_[A-Za-z0-9]+$/.test(env[name]))) {
      fail('Any configured Stripe public key must also use test mode.');
    }
  }
  // whsec_ does not encode mode. Exact remote endpoint checks and a subsequent
  // real signed test delivery are needed; do not trust a secret's prefix alone.
  const platformSecret = env.STRIPE_PLATFORM_WEBHOOK_SECRET;
  const connectSecret = env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!configured(platformSecret) || !configured(connectSecret) ||
      !/^whsec_[A-Za-z0-9]+$/.test(platformSecret) || !/^whsec_[A-Za-z0-9]+$/.test(connectSecret) ||
      platformSecret === connectSecret || env.STRIPE_WEBHOOK_SECRET) {
    fail('Distinct sandbox platform and Connect signing secrets are required; the legacy secret must be unset.');
  }
  const ref = env.STUDIO_SANDBOX_EXPECTED_PROJECT_REF || '';
  if (!/^[a-z0-9]{20}$/.test(ref) || ref === PRODUCTION_PROJECT) fail('An explicit separate sandbox Supabase project is required.');
  const database = safeUrl(env.NEXT_PUBLIC_SUPABASE_URL, 'Sandbox database URL');
  if (database.origin !== `https://${ref}.supabase.co`) fail('Sandbox database URL does not match its expected project.');
  for (const name of ['SUPABASE_URL', 'DATABASE_URL', 'DIRECT_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL',
    'POSTGRES_URL_NON_POOLING', 'STUDIO_PAYMENT_EXPECTED_PROJECT_REF']) {
    if (env[name]?.includes(PRODUCTION_PROJECT)) fail('A production database alias is present in the sandbox environment.');
  }
  validateDatabaseKey(env.SUPABASE_SERVICE_ROLE_KEY, 'service_role', ref);
  validateDatabaseKey(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'anon', ref);
  const origin = safeUrl(env.STUDIO_SANDBOX_EXPECTED_APP_ORIGIN, 'Sandbox application URL');
  if (productionHost(origin.hostname)) fail('The sandbox must use an origin outside the production site.');
  for (const name of ['NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_APP_URL', 'APP_URL', 'SITE_URL', 'STUDIO_PAYMENT_EXPECTED_APP_URL']) {
    if (!env[name]) continue;
    const alias = safeUrl(env[name], 'Sandbox application alias');
    if (productionHost(alias.hostname) || alias.origin !== origin.origin) fail('A production or mismatched application origin is configured.');
  }
  const endpointIds = [env.STUDIO_SANDBOX_PLATFORM_WEBHOOK_ID, env.STUDIO_SANDBOX_CONNECT_WEBHOOK_ID];
  if (endpointIds.some(id => !configured(id) || !/^we_[A-Za-z0-9]+$/.test(id)) || endpointIds[0] === endpointIds[1]) {
    fail('Two distinct exact sandbox webhook endpoint IDs are required.');
  }
  const accountId = env.STUDIO_SANDBOX_EXPECTED_STRIPE_ACCOUNT_ID;
  if (!configured(accountId) || !/^acct_[A-Za-z0-9]+$/.test(accountId)) fail('The exact sandbox Stripe account ID is required.');
  const eventIds = (env.STUDIO_SANDBOX_EVENT_IDS || '').split(',').filter(Boolean);
  if (eventIds.length > 10 || new Set(eventIds).size !== eventIds.length ||
      eventIds.some(id => !/^evt_[A-Za-z0-9]+$/.test(id))) fail('Optional sandbox event IDs are invalid or exceed the limit.');
  return { key, database: database.origin, origin: origin.origin, endpointIds, accountId, eventIds };
}

async function getJson(fetcher, url, headers, label, maximum = 1024 * 1024) {
  let response;
  try { response = await fetcher(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
  catch { fail(`${label} request failed; provider details withheld.`); }
  if (!response.ok) {
    const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : 0;
    fail(`${label} failed (HTTP ${status}); provider details withheld.`);
  }
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) fail(`${label} response exceeded its safe size limit.`);
  if (!response.body) fail(`${label} response was empty.`);
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) {
        try { await reader.cancel(); } catch { /* Withhold transport details. */ }
        fail(`${label} response exceeded its safe size limit.`);
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error instanceof FinancialSandboxVerificationError) throw error;
    fail(`${label} response could not be read.`);
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')); }
  catch { fail(`${label} response was not valid JSON.`); }
}

function verifyEndpoint(endpoint, id, origin, events, platform) {
  let url;
  try { url = new URL(endpoint?.url); } catch { fail('Sandbox webhook destination is invalid.'); }
  if (endpoint?.id !== id || endpoint.livemode !== false || endpoint.status !== 'enabled' ||
      url.origin !== origin || url.pathname !== '/api/stripe/webhook' || url.search || url.hash || url.username || url.password ||
      (platform && endpoint.application !== null)) fail('Sandbox webhook destination, account scope or mode does not match.');
  if (!Array.isArray(endpoint.enabled_events) || !endpoint.enabled_events.every(event => typeof event === 'string') ||
      events.some(event => !endpoint.enabled_events.includes('*') && !endpoint.enabled_events.includes(event))) {
    fail('Sandbox webhook is missing required credit, billing or order events.');
  }
}

export async function verifyFinancialSandbox(env = process.env, { fetcher = fetch, report = console.log } = {}) {
  if (env.STUDIO_FINANCIAL_SANDBOX_VERIFY !== '1') return { enabled: false };
  const config = validateFinancialSandboxEnvironment(env);
  const stripeHeaders = { Authorization: `Bearer ${config.key}`, ...(env.STRIPE_API_VERSION ? { 'Stripe-Version': env.STRIPE_API_VERSION } : {}) };
  const stripe = path => getJson(fetcher, `https://api.stripe.com/v1/${path}`, stripeHeaders, 'Stripe sandbox verification');
  const account = await stripe('account');
  if (account.id !== config.accountId) fail('Stripe sandbox account does not match the expected account.');
  const balance = await stripe('balance');
  if (balance.object !== 'balance' || balance.livemode !== false) fail('Stripe returned a live or unknown-mode balance.');
  for (const [index, id] of config.endpointIds.entries()) {
    const endpoint = await stripe(`webhook_endpoints/${id}`);
    verifyEndpoint(endpoint, id, config.origin, index === 0 ? [...CREDIT_EVENTS, ...BILLING_EVENTS] : ORDER_EVENTS, index === 0);
  }
  for (const id of config.eventIds) {
    const event = await stripe(`events/${id}`);
    if (event.id !== id || event.object !== 'event' || event.livemode !== false ||
        !event.data?.object || (Object.hasOwn(event.data.object, 'livemode') && event.data.object.livemode !== false)) {
      fail('Sandbox event contains live or unknown-mode financial state.');
    }
  }
  report(JSON.stringify({ check: 'financial-sandbox-stripe', ok: true, livemode: false, webhookCount: 2,
    checkedEventCount: config.eventIds.length, financialMutations: 0 }));
  const dbHeaders = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
  const db = (path, maximum) => getJson(fetcher, `${config.database}/rest/v1/${path}`, dbHeaders, 'Sandbox schema verification', maximum);
  for (const probe of TABLE_PROBES) {
    const rows = await db(probe);
    if (!Array.isArray(rows) || rows.length !== 0) fail('Sandbox schema probe returned unexpected data.');
  }
  const schema = await db('', 4 * 1024 * 1024);
  if (REQUIRED_SERVICE_RPCS.some(name => !schema.paths?.[`/rpc/${name}`]?.post)) fail('Required sandbox service credit or fee RPCs are missing.');
  const liveEvents = await db('stripe_events?select=id&livemode=eq.true&limit=1');
  if (!Array.isArray(liveEvents) || liveEvents.length !== 0) fail('The sandbox database contains live Stripe events.');
  const result = { enabled: true, financialMutations: 0, databaseMutations: 0, schemaProbeCount: TABLE_PROBES.length,
    externalCheckoutVerified: false, webhookSigningSecretVerified: false, authOnboardingVerified: false,
    authenticatedCreditRpcVerified: false, rlsPoliciesVerified: false };
  report(JSON.stringify({ check: 'financial-sandbox-schema', ok: true, ...result }));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyFinancialSandbox().catch(error => {
    console.error('[financial-sandbox]', error instanceof FinancialSandboxVerificationError ? error.message : 'Verification failed; details withheld.');
    process.exitCode = 1;
  });
}

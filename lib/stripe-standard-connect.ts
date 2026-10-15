import type { NextRequest } from "next/server";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";
import { directOrderPlatformFeeMetadata, directOrderPlatformFeePayload, getConnectedAccountId, stripeRequest, type DirectOrderFeeSnapshotRow } from "@/lib/payments";
import { normalizeBusinessCountry, verifiedConnectCountry } from "@/lib/stripe-connect-country";
import {
  activateStandardAccount, getReusableStandardCandidate, getStripeConnectionHistory,
  registerStripeAccountCandidate, rollbackStandardAccount, backfillOrderPaymentAccount,
  WHITEPHOTO_STANDARD_LIVE_SCOPE, assertStandardLiveEnvironment, type FreshStripeProviderProof,
} from "@/lib/stripe-connect-history";
import { lockOrderPayment } from "@/lib/order-payment-lock";
import { assertPaymentBelongsToOrders, type ApplicationFeeCharge, type PaymentOrder } from "@/lib/order-payment-policy";
import { verifyDirectOrderApplicationFeeRefund } from "@/lib/direct-order-fee-refund";

type Service = ReturnType<typeof createDashboardServiceClient>;
export type StandardAccount = {
  id: string; type?: string; country?: string | null; livemode?: boolean;
  charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean;
  capabilities?: Record<string, string>;
  controller?: {
    fees?: { payer?: string }; losses?: { payments?: string };
    requirement_collection?: string; stripe_dashboard?: { type?: string };
  };
  requirements?: AccountRequirements;
  future_requirements?: AccountRequirements;
  metadata?: Record<string, string>;
};
type AccountRequirements = {
  disabled_reason?: string | null; currently_due?: string[]; eventually_due?: string[];
  past_due?: string[]; pending_verification?: string[]; errors?: unknown[];
};
type Photographer = {
  id: string; user_id: string; business_name: string | null; business_country: string | null;
  stripe_connect_country: string | null; stripe_account_id: string | null;
  stripe_connected_account_id: string | null; billing_email: string | null;
  stripe_standard_migrated_at?: string | null;
};
type StandardIntent = { id: string; stripe_account_id: string | null; attempted_at: string; status: string; creation_params: Record<string, string> };

export class StandardConnectError extends Error {
  constructor(message: string, public readonly status = 409, public readonly hideFeature = false) { super(message); }
}

export function standardConnectFeatureEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return environment.STRIPE_STANDARD_MIGRATION_ENABLED === "true";
}

/** Test credentials stay on a disposable local database. Never infer test mode from Preview. */
export function assertStandardConnectTestMode(environment: NodeJS.ProcessEnv = process.env) {
  if (!standardConnectFeatureEnabled(environment)) throw new StandardConnectError("Standard payment migration is not enabled.", 404);
  const key = environment.STRIPE_SECRET_KEY || "";
  const sandboxAccount = environment.STUDIO_STANDARD_SANDBOX_EXPECTED_PLATFORM_ACCOUNT_ID || "";
  const verifiedClaimable = /^rkcs_test_[A-Za-z0-9]+$/.test(key) && environment.STUDIO_STANDARD_SANDBOX_PLATFORM_VERIFIED === "true" &&
    /^acct_[A-Za-z0-9]+$/.test(sandboxAccount) && sandboxAccount !== WHITEPHOTO_STANDARD_LIVE_SCOPE.platformAccountId;
  if (!/^sk_test_[A-Za-z0-9]+$/.test(key) && !verifiedClaimable) {
    throw new StandardConnectError("This payment migration preview requires a Stripe test key. Live accounts are disabled.", 503);
  }
  let databaseHost = "";
  try { databaseHost = new URL(environment.NEXT_PUBLIC_SUPABASE_URL || "").hostname; } catch { /* fail closed */ }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(databaseHost)) {
    throw new StandardConnectError("This payment migration preview requires a local test database.", 503);
  }
}

export function assertStandardConnectEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.STRIPE_STANDARD_LIVE_MIGRATION_ENABLED === "true") {
    try { assertStandardLiveEnvironment(environment); }
    catch { throw new StandardConnectError("Live payment migration is disabled or its exact production environment is unverified.", 503); }
    return { livemode: true } as const;
  }
  assertStandardConnectTestMode(environment);
  return { livemode: false } as const;
}

export function standardAccountReadiness(account: StandardAccount, country: string, options: { livemode?: boolean } = {}) {
  const live = options.livemode === true;
  if (!/^acct_[A-Za-z0-9]+$/.test(account.id) || (account.livemode != null && account.livemode !== live)) {
    throw new StandardConnectError("A verified Stripe account in the intended payment environment is required.");
  }
  try { verifiedConnectCountry(account, country); } catch { throw new StandardConnectError("The Stripe account country does not match your studio business country."); }
  const controller = account.controller;
  if (account.type !== "standard" || controller?.fees?.payer !== "account" ||
      controller.losses?.payments !== "stripe" || controller.requirement_collection !== "stripe" ||
      controller.stripe_dashboard?.type !== "full") {
    throw new StandardConnectError("The account does not have the required Standard fee and dashboard configuration.");
  }
  const clean = (requirements: AccountRequirements | undefined) => Boolean(requirements) &&
    !requirements?.disabled_reason && ["currently_due", "eventually_due", "past_due", "pending_verification", "errors"]
      .every(key => Array.isArray(requirements?.[key as keyof AccountRequirements]) &&
        (requirements?.[key as keyof AccountRequirements] as unknown[]).length === 0);
  const ready = account.details_submitted === true && account.charges_enabled === true && account.payouts_enabled === true &&
    account.capabilities?.card_payments === "active" && account.capabilities?.transfers === "active" &&
    clean(account.requirements) && clean(account.future_requirements);
  return {
    ready,
    message: ready ? "Verified Standard account is ready for the checkout switch." : "Stripe still needs verification or payment/payout activation. Your previous account remains selected.",
  };
}

export function assertStandardMutationOrigin(request: Pick<NextRequest, "url" | "headers">) {
  const origin = request.headers.get("origin");
  if (origin) {
    if (origin !== new URL(request.url).origin) throw new StandardConnectError("Payment connection changes must come from this Studio OS page.", 403);
    return;
  }
  // Cookie-only POSTs must include their browser Origin. Native clients can
  // authenticate explicitly; ambient cookies cannot authorize this fallback.
  if (!/^Bearer\s+\S+$/i.test(request.headers.get("authorization") || "")) {
    throw new StandardConnectError("A same-origin browser request or explicit authenticated client is required.", 403);
  }
}

async function context(request: NextRequest, mutation = true) {
  const { livemode } = assertStandardConnectEnvironment();
  if (mutation) assertStandardMutationOrigin(request);
  const { user, mfaSatisfied } = await resolveDashboardAuth(request);
  if (!user) throw new StandardConnectError("Sign in again before changing your payment connection.", 401);
  if (mfaSatisfied !== true) throw new StandardConnectError("Complete two-factor sign-in before changing your payment connection.", 403);
  const service = createDashboardServiceClient();
  const { data, error } = await service.from("photographers")
    .select("id,user_id,business_name,business_country,stripe_connect_country,stripe_account_id,stripe_connected_account_id,billing_email,stripe_standard_migrated_at")
    .eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  const photographer = data as Photographer | null;
  if (!photographer || photographer.user_id !== user.id) throw new StandardConnectError("A verified photographer profile is required.", 403);
  if (livemode && (photographer.id !== WHITEPHOTO_STANDARD_LIVE_SCOPE.photographerId || user.id !== WHITEPHOTO_STANDARD_LIVE_SCOPE.userId)) {
    throw new StandardConnectError("This release is restricted to the authorized WhitePhoto account.", 403, true);
  }
  const country = normalizeBusinessCountry(photographer.business_country || photographer.stripe_connect_country);
  if (!country) throw new StandardConnectError("Choose your business country before starting payment migration.");
  const sandboxPlatform = process.env.STUDIO_STANDARD_SANDBOX_EXPECTED_PLATFORM_ACCOUNT_ID;
  if (livemode || sandboxPlatform) {
    const platform = await stripeRequest<{ id: string }>("account");
    const balance = await stripeRequest<{ object: string; livemode: boolean }>("balance");
    if (platform.id !== (livemode ? WHITEPHOTO_STANDARD_LIVE_SCOPE.platformAccountId : sandboxPlatform) ||
        balance.object !== "balance" || balance.livemode !== livemode) {
      throw new StandardConnectError("The exact Stripe platform and payment environment could not be verified.", 503);
    }
  }
  return { service, photographer, country, user, livemode };
}

type StandardContext = Awaited<ReturnType<typeof context>>;
function providerProof(ctx: StandardContext, accountId: string): FreshStripeProviderProof | undefined {
  return ctx.livemode ? { platformAccountId: WHITEPHOTO_STANDARD_LIVE_SCOPE.platformAccountId, accountId,
    livemode: true, verifiedAt: new Date().toISOString() } : undefined;
}
async function retrieveScopedAccount(ctx: StandardContext, accountId: string) {
  assertStandardConnectEnvironment();
  if (!/^acct_[A-Za-z0-9]+$/.test(accountId) || ctx.livemode &&
      accountId !== WHITEPHOTO_STANDARD_LIVE_SCOPE.expressAccountId && accountId !== WHITEPHOTO_STANDARD_LIVE_SCOPE.standardAccountId) {
    throw new StandardConnectError("The requested account is outside this payment migration.", 403);
  }
  const account = await stripeRequest<StandardAccount>(`accounts/${accountId}`);
  if (account.id !== accountId || (account.livemode != null && account.livemode !== ctx.livemode)) throw new StandardConnectError("Stripe did not verify the requested account and payment environment.");
  return account;
}

async function verifyCurrentAccount(ctx: Awaited<ReturnType<typeof context>>, persist = false) {
  const current = getConnectedAccountId(ctx.photographer);
  if (!current) return null;
  // Read in the guarded test context. Account IDs alone do not establish a
  // payment environment; the local-database guard protects real studio rows.
  const account = await retrieveScopedAccount(ctx, current);
  verifiedConnectCountry(account, ctx.country);
  if (ctx.livemode && (account.metadata?.photographer_id !== ctx.photographer.id || account.metadata?.user_id !== ctx.user.id)) {
    throw new StandardConnectError("The selected account's verified ownership does not match WhitePhoto.");
  }
  if (persist) await registerStripeAccountCandidate(ctx.service, {
    photographerId: ctx.photographer.id, userId: ctx.user.id, account, livemode: ctx.livemode,
    ...(ctx.livemode ? { providerProof: providerProof(ctx, account.id) } : {}),
  });
  return current;
}

async function reserveIntent(service: Service, photographer: Photographer, userId: string, country: string, email?: string | null) {
  const creationParams: Record<string, string> = { type: "standard", country, "metadata[photographer_id]": photographer.id, "capabilities[card_payments][requested]": "true" };
  if (photographer.billing_email || email) creationParams.email = photographer.billing_email || email || "";
  if (photographer.business_name) creationParams["business_profile[name]"] = photographer.business_name;
  const { data, error } = await service.rpc("reserve_photographer_standard_intent", {
    p_photographer_id: photographer.id, p_actor_user_id: userId, p_country: country, p_livemode: false, p_creation_params: creationParams,
  });
  if (error) throw error;
  const intent = (Array.isArray(data) ? data[0] : data) as StandardIntent | null;
  if (!intent?.id || !intent.attempted_at || !intent.creation_params || intent.creation_params.type !== "standard" ||
      intent.creation_params.country !== country || intent.creation_params["metadata[photographer_id]"] !== photographer.id ||
      Object.values(intent.creation_params).some(value => typeof value !== "string")) {
    throw new StandardConnectError("The test account creation intent could not be reserved.");
  }
  return intent;
}

async function recordIntent(service: Service, intent: StandardIntent, userId: string, status: "uncertain" | "registered", accountId?: string) {
  const { error } = await service.rpc("record_photographer_standard_intent", {
    p_intent_id: intent.id, p_actor_user_id: userId, p_status: status, p_account_id: accountId || null,
  });
  if (error) throw error;
}

export function standardCreationRetryAllowed(intent: StandardIntent, now = Date.now()) {
  // Stripe retains idempotency keys for at least 24 hours. Stop before that
  // boundary; a lost result requires reconciliation rather than a new account.
  const age = now - new Date(intent.attempted_at).getTime();
  return Number.isFinite(age) && age >= 0 && age < 23 * 60 * 60 * 1000;
}

export async function startStandardConnection(request: NextRequest) {
  const ctx = await context(request);
  if (ctx.livemode) return adoptExistingWhitePhotoStandard(request, ctx);
  await verifyCurrentAccount(ctx, true);
  let candidate = await getReusableStandardCandidate(ctx.service, ctx.photographer.id, false);
  let account: StandardAccount;
  if (candidate) {
    account = await retrieveScopedAccount(ctx, candidate.stripe_account_id);
  } else {
    const intent = await reserveIntent(ctx.service, ctx.photographer, ctx.user.id, ctx.country, ctx.user.email);
    if (intent.stripe_account_id) {
      account = await retrieveScopedAccount(ctx, intent.stripe_account_id);
    } else {
      if (!standardCreationRetryAllowed(intent)) throw new StandardConnectError("An earlier account creation needs reconciliation before another Stripe request can be made.");
      // Retry exactly the original request even if the profile changed since a
      // lost response. Changing parameters would invalidate Stripe idempotency.
      const body = new URLSearchParams(intent.creation_params);
      body.set("metadata[standard_intent_id]", intent.id);
      try {
        account = await stripeRequest<StandardAccount>("accounts", {
          method: "POST", body, idempotencyKey: `studio-os-standard-test-${intent.id}`,
        });
        // Save the known provider identity before any subsequent work can fail.
        await recordIntent(ctx.service, intent, ctx.user.id, "uncertain", account.id);
        standardAccountReadiness(account, ctx.country);
      } catch (error) {
        await recordIntent(ctx.service, intent, ctx.user.id, "uncertain").catch(() => undefined);
        throw error;
      }
    }
    standardAccountReadiness(account, ctx.country);
    candidate = await registerStripeAccountCandidate(ctx.service, { photographerId: ctx.photographer.id, userId: ctx.user.id, account, livemode: false });
    await recordIntent(ctx.service, intent, ctx.user.id, "registered", account.id);
  }
  standardAccountReadiness(account, ctx.country);
  const origin = new URL(request.url).origin;
  const returnUrl = new URL("/dashboard/settings", origin);
  returnUrl.searchParams.set("standard", "returned");
  const refreshUrl = new URL("/dashboard/settings", origin);
  refreshUrl.searchParams.set("standard", "refresh");
  const link = await stripeRequest<{ url: string }>("account_links", {
    method: "POST", body: new URLSearchParams({ account: account.id, type: "account_onboarding", return_url: returnUrl.toString(), refresh_url: refreshUrl.toString() }),
  });
  const linkUrl = new URL(link.url);
  if (linkUrl.protocol !== "https:" || linkUrl.hostname !== "connect.stripe.com") throw new StandardConnectError("Stripe did not return a valid onboarding link.");
  return { ok: true, enabled: true, testOnly: true, accountId: account.id, url: link.url };
}

/** Adopts only the Standard account Harout already created. Never creates a live merchant. */
async function adoptExistingWhitePhotoStandard(request: NextRequest, ctx: StandardContext) {
  const body = await request.json().catch(() => ({})) as { accountId?: unknown; expectedCurrentAccountId?: unknown; confirmed?: unknown };
  const scope = WHITEPHOTO_STANDARD_LIVE_SCOPE;
  if (body.accountId !== scope.standardAccountId || body.confirmed !== true ||
      body.expectedCurrentAccountId !== scope.expressAccountId || getConnectedAccountId(ctx.photographer) !== scope.expressAccountId) {
    throw new StandardConnectError("Confirm WhitePhoto's displayed existing Standard account and original Express account before binding ownership.");
  }
  await verifyCurrentAccount(ctx, true);
  let account = await retrieveScopedAccount(ctx, scope.standardAccountId);
  if (!standardAccountReadiness(account, ctx.country, { livemode: true }).ready) {
    throw new StandardConnectError("WhitePhoto's Standard verification is incomplete. Express remains selected.");
  }
  const metadata = account.metadata || {};
  if ((metadata.photographer_id && metadata.photographer_id !== ctx.photographer.id) ||
      (metadata.user_id && metadata.user_id !== ctx.user.id) ||
      (metadata.studio_os_migration && metadata.studio_os_migration !== "whitephoto-20261015")) {
    throw new StandardConnectError("The existing Standard account has a conflicting ownership binding.");
  }
  if (metadata.photographer_id !== ctx.photographer.id || metadata.user_id !== ctx.user.id) {
    await stripeRequest<StandardAccount>(`accounts/${scope.standardAccountId}`, {
      method: "POST", idempotencyKey: "studio-os-whitephoto-standard-binding-20261015",
      body: new URLSearchParams({ "metadata[photographer_id]": ctx.photographer.id,
        "metadata[user_id]": ctx.user.id, "metadata[studio_os_migration]": "whitephoto-20261015" }),
    });
    account = await retrieveScopedAccount(ctx, scope.standardAccountId);
  }
  if (account.metadata?.photographer_id !== ctx.photographer.id || account.metadata?.user_id !== ctx.user.id ||
      !standardAccountReadiness(account, ctx.country, { livemode: true }).ready) {
    throw new StandardConnectError("Stripe did not verify the existing Standard account's ownership and readiness.");
  }
  await registerStripeAccountCandidate(ctx.service, { photographerId: ctx.photographer.id, userId: ctx.user.id,
    account, livemode: true, providerProof: providerProof(ctx, account.id) });
  return { ok: true, enabled: true, testOnly: false, accountId: account.id, ownershipBound: true };
}

export async function standardConnectionStatus(request: NextRequest) {
  if (!standardConnectFeatureEnabled()) return { ok: true, enabled: false };
  const ctx = await context(request, false);
  const currentAccountId = await verifyCurrentAccount(ctx);
  const candidate = await getReusableStandardCandidate(ctx.service, ctx.photographer.id, ctx.livemode);
  let pending = null;
  const pendingId = candidate?.stripe_account_id || (ctx.livemode && currentAccountId !== WHITEPHOTO_STANDARD_LIVE_SCOPE.standardAccountId
    ? WHITEPHOTO_STANDARD_LIVE_SCOPE.standardAccountId : null);
  if (pendingId) {
    const account = await retrieveScopedAccount(ctx, pendingId);
    const readiness = standardAccountReadiness(account, ctx.country, { livemode: ctx.livemode });
    const ownershipBound = !ctx.livemode || account.metadata?.photographer_id === ctx.photographer.id && account.metadata?.user_id === ctx.user.id;
    pending = { accountId: account.id, country: account.country, status: candidate?.status || "unbound",
      ready: readiness.ready && Boolean(candidate) && ownershipBound, ownershipBound,
      message: ownershipBound && candidate ? readiness.message : "Confirm the existing WhitePhoto Standard account to bind ownership. Express remains selected." };
  }
  const history = await getStripeConnectionHistory(ctx.service, ctx.photographer.id);
  let activationAvailable = true;
  if (ctx.livemode) {
    const control = await ctx.service.from("stripe_standard_live_release_controls")
      .select("activation_enabled").eq("release_key", "whitephoto-20261015").maybeSingle();
    if (control.error || typeof control.data?.activation_enabled !== "boolean") {
      throw new StandardConnectError("The live migration release control could not be verified.", 503);
    }
    activationAvailable = control.data.activation_enabled;
  }
  return {
    ok: true, enabled: true, testOnly: !ctx.livemode, currentAccountId, pending,
    history: history.filter(row => row.livemode === ctx.livemode).map(row => ({ accountId: row.stripe_account_id, status: row.status, accountType: row.account_type })),
    feePolicy: "saved_subscription_and_frozen_order", existingAccountReuseAvailable: ctx.livemode, activationAvailable,
    backfillAvailable: !ctx.photographer.stripe_standard_migrated_at && Boolean(currentAccountId),
  };
}

type BackfillOrder = PaymentOrder & { total_amount?: number | null; stripe_payment_account_binding_id?: string | null };
type BackfillSession = {
  id: string; mode: string; status: string; payment_status: string; amount_total: number;
  currency: string; client_reference_id?: string | null; payment_intent?: string | null;
  livemode?: boolean; metadata?: Record<string, string>;
};
type BackfillIntent = {
  id: string; amount: number; amount_received: number; currency: string; status: string;
  latest_charge?: string | null; application_fee_amount?: number | null; livemode?: boolean;
  metadata?: Record<string, string>;
};
const backfillSelect = "id,photographer_id,order_group_id,status,payment_status,paid_at,total_cents,total_amount,currency,stripe_checkout_session_id,stripe_payment_intent_id,stripe_payment_account_binding_id,platform_fee_collection_method,platform_fee_amount_cents,platform_fee_currency,platform_fee_rate_cents,stripe_application_fee_id";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function verifiedBackfillScope(rows: BackfillOrder[], photographerId: string, groupId: string | null) {
  if (!rows.length || new Set(rows.map(row => row.id)).size !== rows.length || rows.some(row =>
    row.photographer_id !== photographerId || row.order_group_id !== groupId || !uuidPattern.test(row.id))) {
    throw new StandardConnectError("The complete original order group needs review.");
  }
  const orders = rows.map(row => ({ ...row, total_cents: row.total_cents != null ? Number(row.total_cents)
    : row.total_amount != null ? Math.round(Number(row.total_amount) * 100) : Number.NaN }));
  const currency = (orders[0].currency || "cad").toLowerCase();
  const total = orders.reduce((sum, row) => sum + row.total_cents, 0);
  if (orders.some(row => !Number.isSafeInteger(row.total_cents) || row.total_cents < 0 ||
      (row.currency || "cad").toLowerCase() !== currency) || !Number.isSafeInteger(total) || total < 0) {
    throw new StandardConnectError("The saved amount or currency needs review.");
  }
  const sessions = [...new Set(orders.map(row => row.stripe_checkout_session_id).filter((value): value is string => Boolean(value)))];
  const intents = [...new Set(orders.map(row => row.stripe_payment_intent_id).filter((value): value is string => Boolean(value)))];
  if (sessions.length > 1 || intents.length > 1 || (!sessions.length && !intents.length) ||
      (sessions.length && orders.some(row => row.stripe_checkout_session_id !== sessions[0]))) {
    throw new StandardConnectError("Saved Stripe references are missing or disagree. Review is required.");
  }
  return { orders, currency, total, sessionId: sessions[0] || null, intentId: intents[0] || null };
}

function verifyBackfillMetadata(metadata: Record<string, string> | undefined, orders: BackfillOrder[], currency: string) {
  const owner = orders[0].photographer_id;
  const groupId = orders[0].order_group_id;
  if (metadata?.billing_flow !== "customer_order" || metadata.photographer_id !== owner ||
      !orders.some(row => row.id === metadata.order_id) || (metadata.order_group_id || null) !== groupId) {
    throw new StandardConnectError("Stripe metadata does not match the saved original order group.");
  }
  const frozen = orders.some(row => row.platform_fee_collection_method != null)
    ? directOrderPlatformFeePayload(orders as DirectOrderFeeSnapshotRow[], currency) : null;
  if (frozen) {
    const expected = directOrderPlatformFeeMetadata(frozen);
    if (Object.entries(expected).some(([key, value]) => metadata[key] !== value)) {
      throw new StandardConnectError("The original service-fee snapshot does not match Stripe.");
    }
  } else if (metadata.platform_fee_collection_method || orders.some(row => row.stripe_application_fee_id || (row.platform_fee_amount_cents ?? 0) !== 0)) {
    throw new StandardConnectError("The original service-fee snapshot needs review.");
  }
  return frozen;
}

/** Reads provider evidence and stores immutable routing only. Never changes payment/order status or moves money. */
export async function backfillStandardPaymentHistory(request: NextRequest) {
  const ctx = await context(request);
  const body = await request.json().catch(() => ({})) as { afterOrderId?: unknown; batchSize?: unknown; expectedCurrentAccountId?: unknown };
  const accountId = getConnectedAccountId(ctx.photographer);
  if (!accountId || body.expectedCurrentAccountId !== accountId || ctx.photographer.stripe_standard_migrated_at) {
    throw new StandardConnectError("Refresh the original Express account before verifying old test payments. This step is available before the first switch.");
  }
  const account = await retrieveScopedAccount(ctx, accountId);
  if (account.type !== "express") throw new StandardConnectError("Historical backfill must use the original Express account before cutover.");
  verifiedConnectCountry(account, ctx.country);
  if (ctx.livemode && (account.metadata?.photographer_id !== ctx.photographer.id || account.metadata?.user_id !== ctx.user.id)) {
    throw new StandardConnectError("The original Express ownership binding could not be verified.");
  }
  await registerStripeAccountCandidate(ctx.service, { photographerId: ctx.photographer.id, userId: ctx.user.id, account,
    livemode: ctx.livemode, ...(ctx.livemode ? { providerProof: providerProof(ctx, account.id) } : {}) });
  const batchSize = body.batchSize == null ? 10 : body.batchSize;
  if (typeof batchSize !== "number" || !Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 25 ||
      (body.afterOrderId != null && (typeof body.afterOrderId !== "string" || !uuidPattern.test(body.afterOrderId)))) {
    throw new StandardConnectError("Use a batch of 1–25 orders and a valid pagination cursor.", 400);
  }
  let query = ctx.service.from("orders").select(backfillSelect).eq("photographer_id", ctx.photographer.id)
    .is("stripe_payment_account_binding_id", null)
    .or("stripe_checkout_session_id.not.is.null,stripe_payment_intent_id.not.is.null,status.eq.checkout_starting")
    .order("id", { ascending: true }).limit(batchSize + 1);
  if (body.afterOrderId) query = query.gt("id", body.afterOrderId);
  const page = await query;
  if (page.error) throw page.error;
  const seeds = (page.data ?? []) as BackfillOrder[];
  const selected = seeds.slice(0, batchSize);
  const seen = new Set<string>();
  let mappedOrders = 0, mappedPayments = 0, alreadyMappedOrders = 0;
  const reviewRequired: Array<{ orderId: string; reason: string }> = [];
  for (const seed of selected) {
    const key = seed.order_group_id || seed.id;
    if (seen.has(key)) continue;
    seen.add(key);
    let release: (() => Promise<void>) | undefined;
    try {
      release = await lockOrderPayment(ctx.service, key);
      const fresh = seed.order_group_id
        ? await ctx.service.from("orders").select(backfillSelect, { count: "exact" }).eq("order_group_id", seed.order_group_id).order("id")
        : await ctx.service.from("orders").select(backfillSelect, { count: "exact" }).eq("id", seed.id);
      if (fresh.error) throw fresh.error;
      const rows = (fresh.data ?? []) as BackfillOrder[];
      if (fresh.count == null || fresh.count !== rows.length || rows.length > 100 || !rows.some(row => row.id === seed.id)) {
        throw new StandardConnectError("The complete original order group needs review.");
      }
      const scope = verifiedBackfillScope(rows, ctx.photographer.id, seed.order_group_id);
      if (rows.every(row => row.stripe_payment_account_binding_id)) { alreadyMappedOrders += rows.length; continue; }
      if (rows.some(row => row.stripe_payment_account_binding_id)) throw new StandardConnectError("The group's saved payment mappings disagree.");
      let intentId = scope.intentId;
      let session: BackfillSession | null = null;
      if (scope.sessionId) {
        session = await stripeRequest<BackfillSession>(`checkout/sessions/${encodeURIComponent(scope.sessionId)}`, { account: accountId });
        if (session.id !== scope.sessionId || (ctx.livemode ? session.livemode !== true : session.livemode === true) || session.mode !== "payment" ||
            session.amount_total !== scope.total || session.currency?.toLowerCase() !== scope.currency ||
            !["open", "complete", "expired"].includes(session.status) || !["paid", "unpaid", "no_payment_required"].includes(session.payment_status) ||
            (session.payment_status === "paid" && session.status !== "complete") ||
            (session.payment_status === "no_payment_required" && scope.total !== 0) ||
            (intentId && session.payment_intent !== intentId) ||
            (session.client_reference_id != null && session.client_reference_id !== session.metadata?.order_id)) {
          throw new StandardConnectError("The original Stripe checkout does not match the saved order group.");
        }
        verifyBackfillMetadata(session.metadata, scope.orders, scope.currency);
        intentId ||= session.payment_intent || null;
      }
      const savedPaid = scope.orders.some(row => row.paid_at || ["paid", "refunded", "partially_refunded"].includes(row.status || "") ||
        ["paid", "succeeded", "refunded", "partially_refunded"].includes(row.payment_status || ""));
      if (intentId) {
        const intent = await stripeRequest<BackfillIntent>(`payment_intents/${encodeURIComponent(intentId)}`, { account: accountId });
        if (intent.id !== intentId || (ctx.livemode ? intent.livemode !== true : intent.livemode === true) || !["requires_payment_method", "requires_confirmation", "requires_action", "processing", "requires_capture", "canceled", "succeeded"].includes(intent.status)) {
          throw new StandardConnectError("The original Stripe payment identity needs review.");
        }
        assertPaymentBelongsToOrders(scope.orders, intent);
        const frozen = verifyBackfillMetadata(intent.metadata, scope.orders, scope.currency);
        if ((intent.application_fee_amount ?? 0) !== (frozen?.amountCents ?? 0) ||
            !Number.isSafeInteger(intent.amount_received) || intent.amount_received < 0 || intent.amount_received > scope.total ||
            (intent.status === "succeeded" && intent.amount_received !== scope.total) ||
            ((savedPaid || session?.payment_status === "paid") && (intent.status !== "succeeded" || session && session.payment_status !== "paid"))) {
          throw new StandardConnectError("The original payment amount, fee or paid state needs review.");
        }
        if (intent.latest_charge) {
          const charge = await stripeRequest<ApplicationFeeCharge & { livemode?: boolean; status?: string; paid?: boolean; captured?: boolean }>(`charges/${encodeURIComponent(intent.latest_charge)}`, { account: accountId });
          const chargeIntent = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
          if (charge.id !== intent.latest_charge || (ctx.livemode ? charge.livemode !== true : charge.livemode === true) || chargeIntent !== intent.id ||
              charge.amount !== intent.amount || charge.currency?.toLowerCase() !== intent.currency.toLowerCase() ||
              (intent.status === "succeeded" && (charge.paid === false || charge.status === "failed" || charge.captured === false))) {
            throw new StandardConnectError("The original charge identity needs review.");
          }
          const uncaptured = (charge.paid === false && ["failed", "pending"].includes(charge.status || "")) ||
            (["requires_capture", "canceled"].includes(intent.status) && charge.paid === true && charge.captured === false);
          if (intent.status !== "succeeded" && uncaptured) {
            // A failed/authorized attempt has a requested fee quote but no
            // collected application fee. Do not manufacture one or refund it.
            if (intent.amount_received !== 0 || charge.application_fee || scope.orders.some(row => row.stripe_application_fee_id) ||
                (charge.amount_refunded ?? 0) !== 0 || ![0, frozen?.amountCents ?? 0].includes(charge.application_fee_amount ?? 0)) {
              throw new StandardConnectError("The original uncaptured charge or fee needs review.");
            }
          } else {
            await verifyDirectOrderApplicationFeeRefund({ orders: scope.orders, account: accountId, payment: intent, charge });
          }
        } else if (intent.status === "succeeded" && scope.total > 0) {
          throw new StandardConnectError("The original paid charge needs review.");
        }
      } else if ((savedPaid || session?.payment_status === "paid") && !(session?.payment_status === "no_payment_required" && scope.total === 0)) {
        throw new StandardConnectError("The original paid payment reference needs review.");
      }
      await backfillOrderPaymentAccount(ctx.service, {
        photographerId: ctx.photographer.id, orderIds: scope.orders.map(row => row.id), accountId,
        checkoutSessionId: scope.sessionId, paymentIntentId: intentId, amountCents: scope.total, currency: scope.currency,
        evidence: { source: "verified_stripe_get", account_id: accountId, photographer_id: ctx.photographer.id, livemode: ctx.livemode,
          checkout_session_id: scope.sessionId, payment_intent_id: intentId, verified_at: new Date().toISOString() },
      });
      mappedOrders += rows.length; mappedPayments++;
    } catch (error) {
      reviewRequired.push({ orderId: seed.id, reason: error instanceof StandardConnectError ? error.message : "Provider proof or saved history could not be verified. Review this original test payment before switching." });
    } finally { if (release) await release(); }
  }
  return { ok: true, testOnly: !ctx.livemode, accountId, scannedOrders: selected.length, mappedOrders, mappedPayments, alreadyMappedOrders,
    reviewNeeded: reviewRequired.length, reviewRequired, hasMore: seeds.length > batchSize,
    nextCursor: seeds.length > batchSize && selected.length ? selected[selected.length - 1].id : null };
}

export async function activateStandardConnection(request: NextRequest) {
  const ctx = await context(request);
  const body = await request.json().catch(() => ({})) as { accountId?: unknown; expectedCurrentAccountId?: unknown; confirmed?: unknown };
  const candidate = await getReusableStandardCandidate(ctx.service, ctx.photographer.id, ctx.livemode);
  if (!candidate || body.accountId !== candidate.stripe_account_id || body.confirmed !== true) throw new StandardConnectError("Confirm the verified pending test account before switching.");
  const current = getConnectedAccountId(ctx.photographer);
  if (body.expectedCurrentAccountId !== current) throw new StandardConnectError("The selected payment account changed. Refresh before switching.");
  await verifyCurrentAccount(ctx, true);
  const account = await retrieveScopedAccount(ctx, candidate.stripe_account_id);
  if (!standardAccountReadiness(account, ctx.country, { livemode: ctx.livemode }).ready) throw new StandardConnectError("Stripe verification is incomplete. The previous account remains selected.");
  if (ctx.livemode && (account.metadata?.photographer_id !== ctx.photographer.id || account.metadata?.user_id !== ctx.user.id)) {
    throw new StandardConnectError("The Standard account's ownership binding could not be verified.");
  }
  await registerStripeAccountCandidate(ctx.service, { photographerId: ctx.photographer.id, userId: ctx.user.id, account,
    livemode: ctx.livemode, ...(ctx.livemode ? { providerProof: providerProof(ctx, account.id) } : {}) });
  const result = await activateStandardAccount(ctx.service, {
    photographerId: ctx.photographer.id, userId: ctx.user.id, accountId: account.id,
    expectedCurrentAccountId: current, livemode: ctx.livemode, ...(ctx.livemode ? { providerProof: providerProof(ctx, account.id) } : {}),
  });
  return { ok: true, testOnly: !ctx.livemode, ...result };
}

export async function rollbackStandardConnection(request: NextRequest) {
  const ctx = await context(request);
  const body = await request.json().catch(() => ({})) as { accountId?: unknown; expectedCurrentAccountId?: unknown; confirmed?: unknown };
  const current = getConnectedAccountId(ctx.photographer);
  if (body.confirmed !== true || body.expectedCurrentAccountId !== current) throw new StandardConnectError("Refresh and confirm the test account before restoring the previous route.");
  const history = await getStripeConnectionHistory(ctx.service, ctx.photographer.id);
  const target = history.find(row => row.livemode === ctx.livemode && row.status === "legacy" && row.stripe_account_id === body.accountId);
  if (!target) throw new StandardConnectError("The previous test account is not available for this photographer.");
  const account = await retrieveScopedAccount(ctx, target.stripe_account_id);
  verifiedConnectCountry(account, ctx.country);
  if (!account.charges_enabled || !account.payouts_enabled) throw new StandardConnectError("The previous test account cannot currently accept and pay out new sales.");
  if (ctx.livemode && (account.metadata?.photographer_id !== ctx.photographer.id || account.metadata?.user_id !== ctx.user.id)) {
    throw new StandardConnectError("The original Express ownership binding could not be verified.");
  }
  await registerStripeAccountCandidate(ctx.service, { photographerId: ctx.photographer.id, userId: ctx.user.id, account,
    livemode: ctx.livemode, ...(ctx.livemode ? { providerProof: providerProof(ctx, account.id) } : {}) });
  const result = await rollbackStandardAccount(ctx.service, {
    photographerId: ctx.photographer.id, userId: ctx.user.id, accountId: target.stripe_account_id,
    expectedCurrentAccountId: current, livemode: ctx.livemode, ...(ctx.livemode ? { providerProof: providerProof(ctx, account.id) } : {}),
  });
  return { ok: true, testOnly: !ctx.livemode, ...result };
}

export function standardConnectErrorResponse(error: unknown) {
  return {
    body: { ok: false, enabled: standardConnectFeatureEnabled() && !(error instanceof StandardConnectError && error.hideFeature), testOnly: process.env.STRIPE_STANDARD_LIVE_MIGRATION_ENABLED !== "true",
      message: error instanceof StandardConnectError ? error.message : "The payment connection could not be verified. The current account has not been switched." },
    status: error instanceof StandardConnectError ? error.status : 409,
  };
}

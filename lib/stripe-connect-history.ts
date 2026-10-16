import type { SupabaseClient } from "@supabase/supabase-js";

type Service = Pick<SupabaseClient, "from" | "rpc">;
export type StripeHistoryAccount = {
  id: string; type?: string; country?: string | null;
  metadata?: Record<string, string>; future_requirements?: Record<string, unknown> | null;
  details_submitted?: boolean; charges_enabled?: boolean; payouts_enabled?: boolean;
  controller?: Record<string, unknown> | null; capabilities?: Record<string, unknown> | null; requirements?: Record<string, unknown> | null;
};
export type StripeAccountHistoryRow = {
  id: string; photographer_id: string; stripe_account_id: string; livemode: boolean;
  account_type: "express" | "standard"; status: "pending" | "ready" | "active" | "legacy" | "blocked";
  country: string; controller: Record<string, unknown>; capabilities: Record<string, unknown>;
  requirements: Record<string, unknown>; future_requirements?: Record<string, unknown>; details_submitted: boolean; charges_enabled: boolean;
  payouts_enabled: boolean; verified_at: string; activated_at: string | null; deauthorized_at: string | null;
};
export type StripeAccountOwner = {
  photographerId: string; accountId: string; status: StripeAccountHistoryRow["status"];
  livemode: boolean | null; migratedAt: string | null; historyRequired?: boolean;
};
export type CheckoutRouting = {
  accountId: string; routeVersion: number; feeRateCents: number | null;
  connectionType: "express" | "standard"; livemode: boolean | null;
  origin?: "standard_signup"; signupIntentId?: string; platformAccountId?: string; historyRequired?: boolean;
};
export type PaymentAccountReservation = {
  attemptId: string | null; accountId: string; idempotencyKey: string; routeVersion: number;
  checkoutSessionId?: string | null; paymentIntentId?: string | null;
};

// A live pilot is restricted to the merchant Harout explicitly authorized.
// These identifiers are public routing identity, never credentials.
export const WHITEPHOTO_STANDARD_LIVE_SCOPE = {
  platformAccountId: "acct_1TBlT4PxlnWeytFA",
  projectRef: "bwqhzczxoevouiondjak",
  photographerId: "ed6b8a99-1f38-48f3-a198-447c49b5ac34",
  userId: "4a9f37fe-d217-4edd-bcf9-3a561da2e2f0",
  expressAccountId: "acct_1TIHTrLqg5vdCgpU",
  standardAccountId: "acct_1UQHR5LZhEC2SlmP",
} as const;
export type FreshStripeProviderProof = {
  platformAccountId: string; accountId: string; livemode: true; verifiedAt: string;
};

export function assertStandardLiveEnvironment(environment: NodeJS.ProcessEnv = process.env, mutation = true) {
  const scope = WHITEPHOTO_STANDARD_LIVE_SCOPE;
  if (!/^sk_live_[A-Za-z0-9]+$/.test(environment.STRIPE_SECRET_KEY || "") ||
      environment.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== `https://${scope.projectRef}.supabase.co` ||
      environment.STUDIO_STANDARD_EXPECTED_PLATFORM_ACCOUNT_ID !== scope.platformAccountId ||
      environment.STRIPE_STANDARD_LIVE_CHECKOUT_ENABLED !== "true" ||
      (mutation && (environment.STRIPE_STANDARD_MIGRATION_ENABLED !== "true" ||
        environment.STRIPE_STANDARD_LIVE_MIGRATION_ENABLED !== "true"))) {
    throw new Error("Live payment migration is disabled or its exact production environment is unverified.");
  }
}

export function assertStandardLiveScope(input: {
  photographerId: string; userId?: string; accountId: string; expectedCurrentAccountId?: string | null;
  providerProof?: FreshStripeProviderProof;
}, environment: NodeJS.ProcessEnv = process.env) {
  assertStandardLiveEnvironment(environment);
  const scope = WHITEPHOTO_STANDARD_LIVE_SCOPE;
  if (input.photographerId !== scope.photographerId || input.userId !== scope.userId ||
      ![scope.expressAccountId, scope.standardAccountId].includes(input.accountId as typeof scope.expressAccountId) ||
      (input.expectedCurrentAccountId != null &&
        ![scope.expressAccountId, scope.standardAccountId].includes(input.expectedCurrentAccountId as typeof scope.expressAccountId))) {
    throw new Error("Live payment migration is restricted to the authorized WhitePhoto account pair.");
  }
  const proof = input.providerProof;
  const age = proof ? Date.now() - new Date(proof.verifiedAt).getTime() : Number.NaN;
  if (!proof || proof.platformAccountId !== scope.platformAccountId || proof.accountId !== input.accountId ||
      proof.livemode !== true || !Number.isFinite(age) || age < 0 || age > 5 * 60 * 1000) {
    throw new Error("Fresh original Stripe account and platform GET proof is required for live migration.");
  }
}

// Only a missing history schema can take the compatibility path. Timeouts,
// permission errors and provider mismatches must never silently change routing.
export function isStripeHistorySchemaMissing(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return Boolean(code && ["42883", "42P01", "42703", "PGRST202", "PGRST205", "PGRST204"].includes(code));
}
export function standardSwitchEnabled() {
  return process.env.STRIPE_STANDARD_MIGRATION_ENABLED === "true";
}
export function assertStandardCheckoutTestMode() {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  let hostname = "";
  try { hostname = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").hostname; }
  catch { /* No verified local database address. */ }
  const sandboxKey = /^sk_test_[A-Za-z0-9]+$/.test(key) ||
    (/^rkcs_test_[A-Za-z0-9]+$/.test(key) && process.env.STUDIO_STANDARD_SANDBOX_PLATFORM_VERIFIED === "true" &&
      /^acct_[A-Za-z0-9]+$/.test(process.env.STUDIO_STANDARD_SANDBOX_EXPECTED_PLATFORM_ACCOUNT_ID || ""));
  if (!sandboxKey || !["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname)) {
    throw new Error("Standard checkout is restricted to Stripe sandbox and a local database.");
  }
}

function assertStandardCheckoutScope(photographerId: string, accountId: string, livemode: boolean | null, route?: CheckoutRouting) {
  if (route?.origin === "standard_signup") {
    const scope = WHITEPHOTO_STANDARD_LIVE_SCOPE;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(route.signupIntentId || "") ||
        route.historyRequired !== true || !/^acct_[A-Za-z0-9]+$/.test(route.platformAccountId || "") ||
        route.platformAccountId === accountId) throw new Error("The saved Standard signup origin cannot be verified.");
    if (livemode === true) {
      // A creation flag must never disable servicing an already owned account.
      if (!/^sk_live_[A-Za-z0-9]+$/.test(process.env.STRIPE_SECRET_KEY || "") ||
          process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== `https://${scope.projectRef}.supabase.co` ||
          process.env.STUDIO_STANDARD_EXPECTED_PLATFORM_ACCOUNT_ID !== scope.platformAccountId ||
          route.platformAccountId !== scope.platformAccountId || process.env.VERCEL_ENV === "preview" ||
          !["https://studiooscloud.com", "https://www.studiooscloud.com"].includes(process.env.STUDIO_PAYMENT_EXPECTED_APP_URL?.replace(/\/$/, "") || "")) {
        throw new Error("The exact live Standard signup checkout environment is unverified.");
      }
    } else {
      assertStandardCheckoutTestMode();
      if (livemode !== false || route.platformAccountId !== process.env.STUDIO_STANDARD_SANDBOX_EXPECTED_PLATFORM_ACCOUNT_ID ||
          route.platformAccountId === scope.platformAccountId) throw new Error("The exact Standard signup sandbox origin is unverified.");
    }
    return;
  }
  if (livemode === true) {
    assertStandardLiveEnvironment(process.env, false);
    if (photographerId !== WHITEPHOTO_STANDARD_LIVE_SCOPE.photographerId ||
        accountId !== WHITEPHOTO_STANDARD_LIVE_SCOPE.standardAccountId) {
      throw new Error("Live Standard checkout is restricted to the authorized WhitePhoto account.");
    }
  } else {
    assertStandardCheckoutTestMode();
  }
}

type LegacyPhotographer = {
  id: string; stripe_account_id: string | null; stripe_connected_account_id: string | null;
  stripe_standard_migrated_at?: string | null; stripe_connect_route_version?: number; stripe_account_history_required?: boolean;
};
async function legacyPhotographer(service: Service, photographerId: string) {
  let result = await service.from("photographers")
    .select("id,stripe_account_id,stripe_connected_account_id,stripe_standard_migrated_at,stripe_connect_route_version,stripe_account_history_required")
    .eq("id", photographerId).maybeSingle<LegacyPhotographer>();
  if (result.error && isStripeHistorySchemaMissing(result.error)) {
    // Before the additive signup schema, still check the original migration
    // marker. Never drop both markers merely because the newest column is absent.
    result = await service.from("photographers").select("id,stripe_account_id,stripe_connected_account_id,stripe_standard_migrated_at,stripe_connect_route_version")
      .eq("id", photographerId).maybeSingle<LegacyPhotographer>();
    if (result.error && isStripeHistorySchemaMissing(result.error)) {
      result = await service.from("photographers").select("id,stripe_account_id,stripe_connected_account_id")
        .eq("id", photographerId).maybeSingle<LegacyPhotographer>();
    }
  }
  if (result.error) throw result.error;
  if (!result.data || result.data.stripe_standard_migrated_at || result.data.stripe_account_history_required ||
      Number(result.data.stripe_connect_route_version ?? 0) > 0) {
    throw new Error("The original Stripe payment account is unavailable; review is required.");
  }
  return result.data;
}
function legacyAccount(photographer: LegacyPhotographer) {
  const account = photographer.stripe_connected_account_id || photographer.stripe_account_id;
  if (!account || !/^acct_[A-Za-z0-9_]+$/.test(account)) throw new Error("The studio payment account is unavailable.");
  return account;
}

export async function resolveOrderPaymentAccount(service: Service, input: {
  photographerId: string; orderId?: string | null; orderGroupId?: string | null;
  checkoutSessionId?: string | null; paymentIntentId?: string | null; expectedAccount?: string | null; livemode?: boolean;
}): Promise<string> {
  const { data, error } = await service.rpc("resolve_order_payment_account", {
    p_photographer_id: input.photographerId, p_order_id: input.orderId ?? null,
    p_order_group_id: input.orderGroupId ?? null, p_checkout_session_id: input.checkoutSessionId ?? null,
    p_payment_intent_id: input.paymentIntentId ?? null, p_expected_account: input.expectedAccount ?? null,
    p_livemode: input.livemode ?? null,
  });
  if (!error) {
    if (typeof data !== "string" || !/^acct_[A-Za-z0-9_]+$/.test(data)) throw new Error("The saved payment account is unavailable.");
    return data;
  }
  if (!isStripeHistorySchemaMissing(error)) throw error;
  const photographer = await legacyPhotographer(service, input.photographerId);
  const account = legacyAccount(photographer);
  if (input.expectedAccount && input.expectedAccount !== account) throw new Error("Stripe payment account mismatch.");
  // Existing consumers still verify saved order/group/provider references,
  // amount and currency. This fallback is limited to pre-migration schemas.
  return account;
}

export async function getCheckoutRouting(service: Service, input: {
  photographerId: string; currency?: string; orderId?: string | null; previousExpiredSessionId?: string | null;
}): Promise<CheckoutRouting> {
  const { data, error } = await service.rpc("get_photographer_checkout_routing", {
    p_photographer_id: input.photographerId, p_currency: input.currency ?? "cad",
    p_order_id: input.orderId ?? null, p_previous_expired_session_id: input.previousExpiredSessionId ?? null,
  });
  if (!error) {
    if (!/^acct_[A-Za-z0-9_]+$/.test(data?.accountId ?? "") || !Number.isSafeInteger(Number(data.routeVersion)) ||
      Number(data.routeVersion) < 0 || !["express", "standard"].includes(data.connectionType)) throw new Error("Payment routing cannot be verified.");
    if (data.origin === "standard_signup" && !["cad", "usd", "aud", "gbp"].includes((input.currency ?? "cad").toLowerCase())) {
      throw new Error("The Standard signup sales currency is unsupported.");
    }
    if (data.connectionType === "standard") assertStandardCheckoutScope(input.photographerId, data.accountId, data.livemode, data);
    // Routing never sets commercial fees; only verified subscription policy and
    // immutable per-order snapshots determine the amount collected.
    return { ...data, feeRateCents: null, routeVersion: Number(data.routeVersion) } as CheckoutRouting;
  }
  if (!isStripeHistorySchemaMissing(error)) throw error;
  const photographer = await legacyPhotographer(service, input.photographerId);
  return { accountId: legacyAccount(photographer), routeVersion: Number(photographer.stripe_connect_route_version ?? 0),
    feeRateCents: null, connectionType: "express", livemode: null };
}

export async function reserveOrderPaymentAccount(service: Service, input: {
  photographerId: string; orderIds: string[]; anchorOrderId: string; expectedAccountId: string;
  expectedRouteVersion: number; amountCents: number; currency: string; idempotencyKey: string;
  requestHash?: string | null; previousExpiredSessionId?: string | null;
}): Promise<PaymentAccountReservation> {
  // Validate the provider/local-database boundary before any reservation write.
  // Historical payment reads and refunds deliberately do not use this guard.
  await getCheckoutRouting(service, { photographerId: input.photographerId, currency: input.currency,
    orderId: input.anchorOrderId, previousExpiredSessionId: input.previousExpiredSessionId });
  const { data, error } = await service.rpc("reserve_order_payment_account", {
    p_photographer_id: input.photographerId, p_order_ids: input.orderIds, p_anchor_order_id: input.anchorOrderId,
    p_expected_account_id: input.expectedAccountId, p_expected_route_version: input.expectedRouteVersion,
    p_amount_cents: input.amountCents, p_currency: input.currency, p_idempotency_key: input.idempotencyKey,
    p_request_hash: input.requestHash ?? null, p_previous_expired_session_id: input.previousExpiredSessionId ?? null,
  });
  if (!error) {
    if (!data?.attemptId || !data?.accountId || data.idempotencyKey !== input.idempotencyKey) throw new Error("Checkout reservation cannot be verified.");
    return { ...data, routeVersion: Number(data.routeVersion) } as PaymentAccountReservation;
  }
  if (!isStripeHistorySchemaMissing(error)) throw error;
  const photographer = await legacyPhotographer(service, input.photographerId);
  const accountId = legacyAccount(photographer);
  if (accountId !== input.expectedAccountId || Number(photographer.stripe_connect_route_version ?? 0) !== input.expectedRouteVersion) {
    throw new Error("The checkout account changed before reservation.");
  }
  return { attemptId: null, accountId, idempotencyKey: input.idempotencyKey, routeVersion: input.expectedRouteVersion };
}

export async function bindOrderPaymentReferences(service: Service, input: {
  attemptId: string | null; checkoutSessionId: string; paymentIntentId?: string | null;
  chargeId?: string | null; applicationFeeId?: string | null;
}) {
  // A null attempt exists only on the explicitly unmigrated compatibility path.
  if (!input.attemptId) return;
  const { error } = await service.rpc("bind_order_payment_references", {
    p_attempt_id: input.attemptId, p_checkout_session_id: input.checkoutSessionId,
    p_payment_intent_id: input.paymentIntentId ?? null, p_charge_id: input.chargeId ?? null,
    p_application_fee_id: input.applicationFeeId ?? null,
  });
  if (error) throw error;
}

export async function backfillOrderPaymentAccount(service: Service, input: {
  photographerId: string; orderIds: string[]; accountId: string; checkoutSessionId: string | null;
  paymentIntentId: string | null; amountCents: number; currency: string; evidence: Record<string, unknown>;
}): Promise<PaymentAccountReservation> {
  const { data, error } = await service.rpc("backfill_order_payment_account", {
    p_photographer_id: input.photographerId, p_order_ids: input.orderIds, p_account_id: input.accountId,
    p_checkout_session_id: input.checkoutSessionId, p_payment_intent_id: input.paymentIntentId,
    p_amount_cents: input.amountCents, p_currency: input.currency, p_evidence: input.evidence,
  });
  if (error) throw error;
  if (!data?.attemptId || data.accountId !== input.accountId) throw new Error("The original payment account could not be saved.");
  return data as PaymentAccountReservation;
}

export async function registerStripeAccountCandidate(service: Service, input: {
  photographerId: string; userId: string; account: StripeHistoryAccount; livemode: boolean;
  providerProof?: FreshStripeProviderProof;
}): Promise<StripeAccountHistoryRow> {
  if (input.livemode) {
    assertStandardLiveScope({ ...input, accountId: input.account.id });
  } else if (input.account.type === "standard") {
    assertStandardCheckoutTestMode();
  }
  const { data, error } = await service.rpc("register_photographer_stripe_account", {
    p_photographer_id: input.photographerId, p_actor_user_id: input.userId,
    p_account: input.account, p_livemode: input.livemode,
    ...(input.livemode ? { p_provider_proof: input.providerProof ?? null } : {}),
  });
  if (error) throw error;
  if (!data || data.photographer_id !== input.photographerId || data.stripe_account_id !== input.account.id) {
    throw new Error("The verified account candidate could not be saved.");
  }
  return data as StripeAccountHistoryRow;
}
export async function getStripeConnectionHistory(service: Service, photographerId: string): Promise<StripeAccountHistoryRow[]> {
  const { data, error } = await service.from("photographer_stripe_accounts").select("*")
    .eq("photographer_id", photographerId).order("created_at", { ascending: false });
  if (!error) return (data ?? []) as StripeAccountHistoryRow[];
  if (!isStripeHistorySchemaMissing(error)) throw error;
  await legacyPhotographer(service, photographerId);
  return [];
}
export async function getReusableStandardCandidate(service: Service, photographerId: string, livemode: boolean) {
  return (await getStripeConnectionHistory(service, photographerId)).find(row => row.account_type === "standard" &&
    row.livemode === livemode && ["pending", "ready"].includes(row.status) && !row.deauthorized_at) ?? null;
}
type ActivationInput = { photographerId: string; userId: string; accountId: string; expectedCurrentAccountId: string | null; livemode: boolean; providerProof?: FreshStripeProviderProof };
type ActivationResult = { accountId: string; previousAccountId: string | null; routeVersion: number };
async function changeRouting(service: Service, input: ActivationInput, operation: "activate" | "rollback"): Promise<ActivationResult> {
  if (input.livemode) {
    assertStandardLiveScope(input);
    const scope = WHITEPHOTO_STANDARD_LIVE_SCOPE;
    if (input.accountId !== (operation === "activate" ? scope.standardAccountId : scope.expressAccountId) ||
        input.expectedCurrentAccountId !== (operation === "activate" ? scope.expressAccountId : scope.standardAccountId)) {
      throw new Error("The authorized live routing direction does not match this migration operation.");
    }
  } else assertStandardCheckoutTestMode();
  const { data, error } = await service.rpc(`${operation}_photographer_standard_account`, {
    p_photographer_id: input.photographerId, p_actor_user_id: input.userId, p_account_id: input.accountId,
    p_expected_current_account_id: input.expectedCurrentAccountId, p_livemode: input.livemode,
    ...(input.livemode ? { p_provider_proof: input.providerProof ?? null } : {}),
  });
  if (error) throw error;
  if (!data || data.accountId !== input.accountId) throw new Error("The payment routing switch could not be verified.");
  return data as ActivationResult;
}
export const activateStandardAccount = (service: Service, input: ActivationInput) => changeRouting(service, input, "activate");
export const rollbackStandardAccount = (service: Service, input: ActivationInput) => changeRouting(service, input, "rollback");

export async function findStripeAccountOwner(service: Service, accountId: string, options: { livemode?: boolean } = {}): Promise<StripeAccountOwner | null> {
  const { data, error } = await service.rpc("find_photographer_stripe_account", { p_account_id: accountId, p_livemode: options.livemode ?? null });
  if (!error) {
    if (data == null) return null;
    if (!data.photographerId || data.accountId !== accountId ||
      (options.livemode != null && data.livemode != null && data.livemode !== options.livemode)) throw new Error("The account history owner cannot be verified.");
    return data as StripeAccountOwner;
  }
  if (!isStripeHistorySchemaMissing(error)) throw error;
  for (const field of ["stripe_connected_account_id", "stripe_account_id"]) {
    const found = await service.from("photographers").select("id").eq(field, accountId).maybeSingle();
    if (found.error) throw found.error;
    if (found.data?.id) {
      const photographer = await legacyPhotographer(service, found.data.id);
      if (legacyAccount(photographer) !== accountId) throw new Error("The historical account owner is ambiguous.");
      return { photographerId: photographer.id, accountId, status: "active", livemode: null, migratedAt: null };
    }
  }
  return null;
}

export async function syncStripeAccountHistory(service: Service, input: {
  photographerId?: string; accountId?: string; country?: string | null; detailsSubmitted?: boolean;
  chargesEnabled?: boolean; payoutsEnabled?: boolean; controller?: Record<string, unknown>;
  capabilities?: Record<string, unknown> | null; requirements?: Record<string, unknown> | null;
  account?: StripeHistoryAccount; livemode?: boolean;
}): Promise<boolean> {
  const account = input.account ?? { id: input.accountId!, country: input.country,
    details_submitted: input.detailsSubmitted, charges_enabled: input.chargesEnabled, payouts_enabled: input.payoutsEnabled,
    controller: input.controller, capabilities: input.capabilities, requirements: input.requirements };
  const { data, error } = await service.rpc("sync_photographer_stripe_account_history", { p_account: account, p_livemode: input.livemode ?? null });
  if (!error && data) {
    if (input.photographerId && data.photographerId !== input.photographerId) throw new Error("The connected account history belongs to another studio.");
    return true;
  }
  if (error && !isStripeHistorySchemaMissing(error)) throw error;
  if (input.photographerId) await legacyPhotographer(service, input.photographerId);
  else await findStripeAccountOwner(service, account.id, { livemode: input.livemode });
  return false;
}
export async function markStripeAccountDeauthorized(service: Service, input: { accountId: string; livemode: boolean }) {
  const { error } = await service.rpc("deauthorize_photographer_stripe_account", { p_account_id: input.accountId, p_livemode: input.livemode });
  if (error) throw error;
}

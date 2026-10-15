import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stripeRequest } from "@/lib/payments";
import { ConnectProfileError } from "@/lib/stripe-connect-country";
import { isStripeHistorySchemaMissing, WHITEPHOTO_STANDARD_LIVE_SCOPE } from "@/lib/stripe-connect-history";
import { standardAccountReadiness, assertStandardMutationOrigin, type StandardAccount } from "@/lib/stripe-standard-connect";

type Service = Pick<SupabaseClient, "from" | "rpc">;
type Photographer = { id: string; user_id: string; business_name?: string | null; billing_email?: string | null;
  business_country?: string | null; stripe_connect_country?: string | null; stripe_account_id?: string | null;
  stripe_connected_account_id?: string | null; stripe_account_history_required?: boolean };
type Signup = { id: string; photographer_id: string; actor_user_id: string; platform_account_id: string;
  country: string; livemode: boolean; status: string; stripe_account_id: string | null; attempted_at: string;
  creation_params: Record<string, string>; request_hash: string; provider_request_hash: string; idempotency_key: string };
type Context = { livemode: boolean; platformAccountId: string };

export function standardNewAccountsEnabled(environment: NodeJS.ProcessEnv = process.env) {
  return environment.STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED === "true";
}

/** Creation and continued servicing use the same exact platform boundary. Disabling creation never reroutes saved payments. */
export function assertStandardSignupEnvironment(environment: NodeJS.ProcessEnv = process.env): Context {
  const key = environment.STRIPE_SECRET_KEY || "";
  const live = /^sk_live_[A-Za-z0-9]+$/.test(key);
  const scope = WHITEPHOTO_STANDARD_LIVE_SCOPE;
  if (live) {
    if (environment.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== `https://${scope.projectRef}.supabase.co` ||
        environment.STUDIO_STANDARD_EXPECTED_PLATFORM_ACCOUNT_ID !== scope.platformAccountId ||
        !["https://studiooscloud.com", "https://www.studiooscloud.com"].includes(environment.STUDIO_PAYMENT_EXPECTED_APP_URL?.replace(/\/$/, "") || "") ||
        environment.VERCEL_ENV === "preview") throw new ConnectProfileError("The Standard payment environment could not be verified.", 503);
    return { livemode: true, platformAccountId: scope.platformAccountId };
  }
  let host = "";
  try { host = new URL(environment.NEXT_PUBLIC_SUPABASE_URL || "").hostname; } catch { /* fail closed */ }
  const platformAccountId = environment.STUDIO_STANDARD_SANDBOX_EXPECTED_PLATFORM_ACCOUNT_ID || "";
  const testKey = /^sk_test_[A-Za-z0-9]+$/.test(key) || /^rkcs_test_[A-Za-z0-9]+$/.test(key) && environment.STUDIO_STANDARD_SANDBOX_PLATFORM_VERIFIED === "true";
  if (!testKey || !["127.0.0.1", "localhost", "[::1]"].includes(host) ||
      !/^acct_[A-Za-z0-9]+$/.test(platformAccountId) || platformAccountId === scope.platformAccountId) {
    throw new ConnectProfileError("Standard test onboarding requires the verified sandbox and a local database.", 503);
  }
  return { livemode: false, platformAccountId };
}

export function standardSignupParamsHash(params: Record<string, string>) {
  return createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(params).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)))).digest("hex");
}
export function standardSignupRetryAllowed(intent: Pick<Signup, "attempted_at">, now = Date.now()) {
  const age = now - new Date(intent.attempted_at).getTime();
  // Database and app clocks can differ slightly even on the first reservation.
  // The SQL re-reservation still independently enforces controls and expiry.
  return Number.isFinite(age) && age >= -30_000 && age < 23 * 60 * 60 * 1000;
}
function unpack<T>(data: unknown): T { return (Array.isArray(data) ? data[0] : data) as T; }
async function platformProof(ctx: Context) {
  const [platform, balance] = await Promise.all([
    stripeRequest<{ id: string }>("account"), stripeRequest<{ object: string; livemode: boolean }>("balance"),
  ]);
  if (platform.id !== ctx.platformAccountId || balance.object !== "balance" || balance.livemode !== ctx.livemode) {
    throw new ConnectProfileError("Stripe did not verify the intended platform and payment environment.", 503);
  }
}
async function loadSignup(service: Service, photographerId: string, userId: string, ctx: Context) {
  const { data, error } = await service.from("photographer_stripe_standard_signups").select("*")
    .eq("photographer_id", photographerId).eq("livemode", ctx.livemode).maybeSingle();
  if (error) throw error;
  const intent = data as Signup | null;
  if (intent && (intent.actor_user_id !== userId || intent.platform_account_id !== ctx.platformAccountId)) {
    throw new ConnectProfileError("The saved Stripe connection belongs to another owner or platform.", 409);
  }
  return intent;
}
function validateIntent(intent: Signup, photographerId: string, userId: string, ctx: Context) {
  const params = intent.creation_params;
  if (!intent.id || intent.photographer_id !== photographerId || intent.actor_user_id !== userId ||
      intent.platform_account_id !== ctx.platformAccountId || intent.livemode !== ctx.livemode ||
      !["CA", "US"].includes(intent.country) || !params || Object.values(params).some(value => typeof value !== "string") ||
      params.type !== "standard" || params.country !== intent.country || params["metadata[photographer_id]"] !== photographerId ||
      params["metadata[user_id]"] !== userId || intent.request_hash !== standardSignupParamsHash(params) ||
      intent.provider_request_hash !== standardSignupParamsHash({ ...params, "metadata[standard_signup_id]": intent.id }) ||
      intent.idempotency_key !== `studio-os-standard-signup-${intent.id}`) {
    throw new ConnectProfileError("The original Stripe account request could not be verified.", 409);
  }
  if (intent.status === "blocked") throw new ConnectProfileError("This Stripe connection needs support review before it can be used.", 409);
}
async function readAccount(intent: Signup, ctx: Context) {
  if (!/^acct_[A-Za-z0-9]+$/.test(intent.stripe_account_id || "")) throw new ConnectProfileError("The saved Stripe account identity is unavailable.", 409);
  const account = await stripeRequest<StandardAccount>(`accounts/${intent.stripe_account_id}`);
  if (account.id !== intent.stripe_account_id || account.metadata?.photographer_id !== intent.photographer_id ||
      account.metadata?.user_id !== intent.actor_user_id || account.metadata?.standard_signup_id !== intent.id) {
    throw new ConnectProfileError("Stripe did not verify this photographer's account ownership.", 409);
  }
  standardAccountReadiness(account, intent.country, { livemode: ctx.livemode });
  return account;
}
async function recordAndActivate(service: Service, intent: Signup, account: StandardAccount, ctx: Context) {
  const args = { p_signup_id: intent.id, p_actor_user_id: intent.actor_user_id, p_account: account,
    p_platform_account_id: ctx.platformAccountId, p_livemode: ctx.livemode, p_provider_verified_at: new Date().toISOString() };
  const { error } = await service.rpc("record_photographer_standard_signup_account", args);
  if (error) throw error;
  const ready = standardAccountReadiness(account, intent.country, { livemode: ctx.livemode }).ready;
  if (ready) {
    const { error: activationError } = await service.rpc("activate_photographer_standard_signup", args);
    if (activationError) throw activationError;
  }
  return ready;
}
async function refreshedPhotographer(service: Service, photographerId: string, userId: string) {
  const { data, error } = await service.from("photographers").select("*").eq("id", photographerId).eq("user_id", userId).single();
  if (error || !data) throw error || new ConnectProfileError("The photographer profile could not be refreshed.", 409);
  return data as Photographer;
}

/** Reject revoked signups before profile writes or a GET of their deleted account. */
export async function assertStandardSignupConnectAllowed(service: Service, input: { photographer: Photographer; userId: string }) {
  if (input.photographer.user_id !== input.userId) {
    throw new ConnectProfileError("The saved Stripe connection belongs to another owner.", 409);
  }
  let query = service.from("photographer_stripe_standard_signups").select("*")
    .eq("photographer_id", input.photographer.id);
  // This only selects the row. A found signup still requires the complete
  // platform/environment proof below; legacy connections need no new pins.
  const key = process.env.STRIPE_SECRET_KEY || "";
  if (/^sk_live_/.test(key)) query = query.eq("livemode", true);
  else if (/^(?:sk_test_|rkcs_test_)/.test(key)) query = query.eq("livemode", false);
  const { data, error } = await query.maybeSingle();
  if (error) {
    if (!standardNewAccountsEnabled() && isStripeHistorySchemaMissing(error)) {
      const fresh = await refreshedPhotographer(service, input.photographer.id, input.userId);
      if (!fresh.stripe_account_history_required) return;
    }
    throw error;
  }
  if (!data) {
    // The regular billing projection predates this marker. Check the current
    // owner row rather than treating an omitted marker as a legacy connection.
    const fresh = await refreshedPhotographer(service, input.photographer.id, input.userId);
    if (fresh.stripe_account_history_required) {
      throw new ConnectProfileError("The saved Stripe connection needs support review.", 409);
    }
    return;
  }
  const intent = data as Signup;
  validateIntent(intent, input.photographer.id, input.userId, assertStandardSignupEnvironment());
  if ([input.photographer.stripe_account_id, input.photographer.stripe_connected_account_id]
    .some(id => id && id !== intent.stripe_account_id)) {
    throw new ConnectProfileError("The selected Stripe account does not match its saved signup. Contact Studio OS support.", 409);
  }
}

export async function refreshStandardSignupForPhotographer<T extends Photographer>(service: Service, input: { photographer: T; userId: string }) {
  const empty = { handled: false, account: null, photographer: input.photographer, pending: false, blocked: false, active: false };
  // On older deployments the additive table may be absent. This compatibility
  // path is valid only while new creation is off and no permanent marker exists.
  const { data, error } = await service.from("photographer_stripe_standard_signups").select("*")
    .eq("photographer_id", input.photographer.id).maybeSingle();
  if (error) {
    if (!standardNewAccountsEnabled() && isStripeHistorySchemaMissing(error)) {
      const fresh = await refreshedPhotographer(service, input.photographer.id, input.userId);
      if (!fresh.stripe_account_history_required) return empty;
    }
    throw error;
  }
  if (!data) return empty;
  const ctx = assertStandardSignupEnvironment();
  const intent = data as Signup;
  validateIntent(intent, input.photographer.id, input.userId, ctx);
  if (!intent.stripe_account_id) return { ...empty, handled: true, pending: true };
  await platformProof(ctx);
  const account = await readAccount(intent, ctx);
  const active = await recordAndActivate(service, intent, account, ctx);
  return { handled: true, account, photographer: await refreshedPhotographer(service, input.photographer.id, input.userId) as T, pending: !active, blocked: false, active };
}

export async function refreshStandardSignupFromAccount(service: Service, input: { account: { id: string }; livemode: boolean }) {
  const { data, error } = await service.from("photographer_stripe_standard_signups").select("*")
    .eq("stripe_account_id", input.account.id).eq("livemode", input.livemode).maybeSingle();
  if (error) {
    if (!standardNewAccountsEnabled() && isStripeHistorySchemaMissing(error)) return { handled: false, activated: false, account: null };
    throw error;
  }
  if (!data) return { handled: false, activated: false, account: null };
  const ctx = assertStandardSignupEnvironment();
  const intent = data as Signup;
  validateIntent(intent, intent.photographer_id, intent.actor_user_id, ctx);
  if (input.livemode !== ctx.livemode) throw new ConnectProfileError("The Stripe event payment environment does not match this connection.", 409);
  await platformProof(ctx);
  const account = await readAccount(intent, ctx);
  const activated = await recordAndActivate(service, intent, account, ctx);
  return { handled: true, activated, account };
}

/** Returns null only for a legacy connection. Never replaces an existing Express account. */
export async function startStandardSignup(service: Service, input: {
  request: { url: string; headers: Headers }; photographer: Photographer; userId: string; email?: string | null; country: string; salesCurrency?: string;
}) {
  const existingId = input.photographer.stripe_connected_account_id || input.photographer.stripe_account_id;
  if (existingId) {
    const refreshed = await refreshStandardSignupForPhotographer(service, input);
    if (refreshed.handled && (!refreshed.account || refreshed.account.id !== existingId)) {
      throw new ConnectProfileError("The selected Stripe account does not match its saved signup. Contact Studio OS support.", 409);
    }
    return refreshed.handled ? { ok: true, url: "https://dashboard.stripe.com/", stripeAccountId: existingId,
      stripeAccountType: "standard", stripeDashboardType: "full", onboardingComplete: refreshed.active,
      chargesEnabled: refreshed.active, payoutsEnabled: refreshed.active } : null;
  }
  assertStandardMutationOrigin(input.request);
  if (!standardNewAccountsEnabled()) {
    const { data, error } = await service.from("photographer_stripe_standard_signups").select("id")
      .eq("photographer_id", input.photographer.id).maybeSingle();
    if (error && !isStripeHistorySchemaMissing(error)) throw error;
    if (!data) {
      const fresh = await refreshedPhotographer(service, input.photographer.id, input.userId);
      if (fresh.stripe_account_history_required) throw new ConnectProfileError("The saved Stripe connection needs support review.", 409);
      return null;
    }
  }
  // Avoid interpreting a live key shared with Preview as sandbox permission.
  const ctx = assertStandardSignupEnvironment();
  let intent = await loadSignup(service, input.photographer.id, input.userId, ctx);
  if (!intent && !standardNewAccountsEnabled()) return null;
  if (!intent) {
    const { data: eligibilityData, error: eligibilityError } = await service.rpc("get_photographer_standard_signup_eligibility", {
      p_photographer_id: input.photographer.id, p_actor_user_id: input.userId, p_livemode: ctx.livemode, p_platform_account_id: ctx.platformAccountId,
    });
    if (eligibilityError) throw eligibilityError;
    const eligibility = unpack<{ eligible: boolean; reason: string }>(eligibilityData);
    if (!eligibility?.eligible) {
      if (["existing_account", "uncertain_legacy_creation", "existing_payment_history"].includes(eligibility?.reason)) return null;
      throw new ConnectProfileError("New Standard connections are not available for this profile yet. Contact Studio OS support.", 409);
    }
    if (input.salesCurrency && !["cad", "usd"].includes(input.salesCurrency.toLowerCase())) {
      throw new ConnectProfileError("Choose CAD or USD sales before connecting your new Standard Stripe account.", 409);
    }
    await platformProof(ctx);
    const params: Record<string, string> = { type: "standard", country: input.country,
      "metadata[photographer_id]": input.photographer.id, "metadata[user_id]": input.userId,
      "capabilities[card_payments][requested]": "true", "capabilities[transfers][requested]": "true" };
    if (input.email) params.email = input.email;
    if (input.photographer.business_name) params["business_profile[name]"] = input.photographer.business_name;
    const { data, error } = await service.rpc("reserve_photographer_standard_signup", {
      p_photographer_id: input.photographer.id, p_actor_user_id: input.userId, p_country: input.country,
      p_livemode: ctx.livemode, p_platform_account_id: ctx.platformAccountId, p_creation_params: params, p_request_hash: standardSignupParamsHash(params),
    });
    if (error) throw error;
    intent = unpack<Signup>(data);
  } else await platformProof(ctx);
  validateIntent(intent, input.photographer.id, input.userId, ctx);
  if (!intent.stripe_account_id) {
    if (!standardNewAccountsEnabled() || !standardSignupRetryAllowed(intent)) throw new ConnectProfileError("An earlier Stripe account creation needs reconciliation before another request can be made.", 409);
    // Recheck the durable SQL controls under the same photographer row lock on
    // every unknown-result retry, including after an operator disables creation.
    const { data: reserved, error: reserveError } = await service.rpc("reserve_photographer_standard_signup", {
      p_photographer_id: intent.photographer_id, p_actor_user_id: intent.actor_user_id, p_country: intent.country,
      p_livemode: ctx.livemode, p_platform_account_id: ctx.platformAccountId,
      p_creation_params: intent.creation_params, p_request_hash: intent.request_hash,
    });
    if (reserveError) throw reserveError;
    intent = unpack<Signup>(reserved);
    validateIntent(intent, input.photographer.id, input.userId, ctx);
    if (intent.stripe_account_id) {
      // A concurrent request registered the same result while this one waited.
      return startStandardSignup(service, input);
    }
    const params = { ...intent.creation_params, "metadata[standard_signup_id]": intent.id };
    const body = new URLSearchParams(Object.entries(params).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    const created = await stripeRequest<StandardAccount>("accounts", { method: "POST", body, idempotencyKey: intent.idempotency_key });
    // A lost create/save response repeats only this immutable idempotent request.
    // A fresh GET proves provider identity before the account is recorded or exposed.
    intent = { ...intent, stripe_account_id: created.id };
  }
  const account = await readAccount(intent, ctx);
  const ready = await recordAndActivate(service, intent, account, ctx);
  if (ready) return { ok: true, url: "https://dashboard.stripe.com/", stripeAccountId: account.id, stripeAccountType: "standard", stripeDashboardType: "full",
    businessCountry: intent.country, stripeAccountCountry: account.country, onboardingComplete: true, chargesEnabled: true, payoutsEnabled: true };
  const origin = new URL(input.request.url).origin;
  const link = await stripeRequest<{ url: string }>("account_links", { method: "POST", body: new URLSearchParams({ account: account.id,
    type: "account_onboarding", return_url: new URL("/dashboard/settings?connect=returned", origin).toString(),
    refresh_url: new URL("/dashboard/settings?connect=refresh", origin).toString() }) });
  const url = new URL(link.url);
  if (url.protocol !== "https:" || url.hostname !== "connect.stripe.com" || url.username || url.password) throw new ConnectProfileError("Stripe did not return a valid onboarding link.", 502);
  return { ok: true, url: link.url, stripeAccountId: null, stripePendingAccountId: account.id, stripeAccountType: "standard", stripeDashboardType: "full",
    businessCountry: intent.country, stripeAccountCountry: account.country, onboardingComplete: false, chargesEnabled: false, payoutsEnabled: false };
}

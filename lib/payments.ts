import type { ConfirmedRefund } from "@/lib/order-refund-notifications";
import { allocateRefundCents, orderCheckoutIdempotencyKey, type ApplicationFeeCharge, type PaymentOrder } from "@/lib/order-payment-policy";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { syncPhotographyKeysByPhotographerId } from "@/lib/studio-os-app";
import { creditMaintenanceActive } from "@/lib/credit-maintenance";
import { buildOrderNotificationEmail } from "@/lib/order-notification-email";
import { buildOrderReceiptEmail } from "@/lib/order-receipt-email";
import { sendNewOrderPush } from "@/lib/order-push";
import { notifyOwnerForSetting } from "@/lib/admin-notification-center";
import { ownerUrl } from "@/lib/owner-notifications";
import { resendConfigured, sendResendEmail, resolveReplyTo } from "@/lib/resend";
import {
  ANNUAL_DISCOUNT_PERCENT,
  CREDIT_PACK_DEFS,
  DEFAULT_ORDER_USAGE_RATE_CENTS,
  EXTRA_DESKTOP_KEY_ANNUAL_CENTS,
  EXTRA_DESKTOP_KEY_MONTHLY_CENTS,
  PLAN_DEFS,
  normalizeBillingInterval,
  normalizeCreditPackCode,
  normalizePlanCode,
  type BillingInterval,
  type CreditPackCode,
  type CreditPackDefinition,
  type PlanCode,
  type PlanDefinition,
} from "@/lib/studio-pricing";
import { FREE_TRIAL_DAYS } from "@/lib/trial-config";
import { resolveStripeBillingPeriod } from "@/lib/stripe-billing-period";
import { readAllBillingRows, reconcileOrderUsageFeeRefunds, syncOrderUsageFees } from "@/lib/order-usage-billing";
import { isStripeBillingActive } from "@/lib/subscription-access";
import { SUPPORTED_ORDER_CURRENCIES } from "@/lib/order-currency";
export {
  isStripeBillingActive, isTrialStatus, resolveFreeTrialEndsAt,
  getFreeTrialDaysRemaining, isFreeTrialActive, isFreeTrialExpired,
} from "@/lib/subscription-access";

export {
  ANNUAL_DISCOUNT_PERCENT,
  CREDIT_PACK_DEFS,
  EXTRA_DESKTOP_KEY_ANNUAL_CENTS,
  EXTRA_DESKTOP_KEY_MONTHLY_CENTS,
  PLAN_DEFS,
  normalizeBillingInterval,
  normalizeCreditPackCode,
  normalizePlanCode,
  FREE_TRIAL_DAYS,
};
export type {
  BillingInterval,
  CreditPackCode,
  CreditPackDefinition,
  PlanCode,
  PlanDefinition,
};

function clean(v: string | null | undefined) {
  return (v ?? "").trim();
}

type ServiceClient = ReturnType<typeof createDashboardServiceClient>;

type StripeList<T> = {
  object: "list";
  data: T[];
  has_more: boolean;
  url: string;
};

export type PhotographerBillingRow = {
  id: string;
  user_id: string;
  business_name: string | null;
  brand_color: string | null;
  watermark_enabled?: boolean | null;
  watermark_logo_url?: string | null;
  studio_address?: string | null;
  studio_phone?: string | null;
  stripe_account_id: string | null;
  stripe_connected_account_id: string | null;
  stripe_connect_onboarding_complete: boolean | null;
  stripe_connect_charges_enabled: boolean | null;
  stripe_connect_payouts_enabled: boolean | null;
  stripe_platform_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_subscription_item_base_id: string | null;
  stripe_subscription_item_extra_keys_id: string | null;
  stripe_subscription_item_usage_id: string | null;
  subscription_plan_code: string | null;
  subscription_billing_interval?: string | null;
  subscription_status: string | null;
  subscription_current_period_start: string | null;
  subscription_current_period_end: string | null;
  billing_email: string | null;
  billing_currency: string | null;
  order_usage_rate_cents: number | null;
  extra_desktop_keys: number | null;
  studio_id: string | null;
  studio_email: string | null;
  logo_url?: string | null;
  is_platform_admin?: boolean | null;
  created_at?: string | null;
  trial_starts_at?: string | null;
  trial_ends_at?: string | null;
};

type CreditPackageRow = {
  id: string;
  name: string;
  credits: number;
  price_cents: number;
  active: boolean;
  sort_order: number | null;
  package_code: string | null;
};

type StripeAccount = {
  id: string;
  object: "account";
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  default_currency?: string | null;
  email?: string | null;
  requirements?: {
    disabled_reason?: string | null;
    currently_due?: string[];
    past_due?: string[];
    errors?: Array<{ code?: string; reason?: string; requirement?: string }>;
  } | null;
  metadata?: Record<string, string>;
};

type StripeProduct = {
  id: string;
  name: string;
  active: boolean;
  metadata?: Record<string, string>;
};

type StripePrice = {
  id: string;
  active: boolean;
  currency: string;
  lookup_key?: string | null;
  unit_amount: number | null;
  product: string | StripeProduct;
  recurring?: {
    interval: string;
    usage_type?: string | null;
    meter?: string | null;
  } | null;
  type?: "one_time" | "recurring";
};

type StripeMeter = {
  id: string;
  object: "billing.meter";
  display_name: string;
  event_name: string;
  status: "active" | "inactive";
  default_aggregation: { formula: string };
  customer_mapping: { type: string; event_payload_key: string };
  value_settings: { event_payload_key: string };
  event_time_window: "hour" | "day" | null;
};

type StripeCustomer = {
  id: string;
  email?: string | null;
  name?: string | null;
};

type StripeInvoice = {
  id: string;
  status: string | null;
  amount_due: number;
  amount_paid: number;
  currency: string;
  created: number;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  subscription?: string | null;
  customer?: string | null;
};

type StripeSubscriptionItem = {
  id: string;
  quantity?: number | null;
  current_period_start?: number | null;
  current_period_end?: number | null;
  price: StripePrice;
};

export type StripeSubscription = {
  id: string;
  status: string;
  customer: string;
  current_period_start?: number | null;
  current_period_end?: number | null;
  items: { data: StripeSubscriptionItem[] };
  latest_invoice?: string | StripeInvoice | null;
  metadata?: Record<string, string> | null;
  billing_mode?: { type?: string | null } | "classic" | "flexible" | null;
};

export type StripeCheckoutSession = {
  id: string;
  url?: string | null;
  mode?: string | null;
  payment_status?: string | null;
  status?: string | null;
  customer?: string | null;
  subscription?: string | null;
  payment_intent?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
  customer_details?: { email?: string | null } | null;
};

type StripePaymentIntent = {
  id: string;
  status: string;
  metadata?: Record<string, string> | null;
  latest_charge?: string | null;
  amount?: number;
  amount_received?: number;
  currency?: string;
  application_fee_amount?: number | null;
};

type StripeCharge = {
  id: string;
  amount: number;
  amount_refunded: number;
  payment_intent?: string | null;
  metadata?: Record<string, string> | null;
};

type StripeEventEnvelope = {
  id: string;
  type: string;
  account?: string;
  livemode?: boolean;
  data: {
    object: Record<string, unknown>;
  };
};

type CatalogEntry = {
  code: string;
  name: string;
  description: string;
  currency: string;
  unitAmount: number;
  interval?: BillingInterval;
  usageType?: "metered";
  meterEventName?: string;
  lookupKey: string;
};

export type StripeCatalog = {
  planPrices: Record<PlanCode, Record<BillingInterval, string>>;
  extraDesktopKeyPriceIds: Record<BillingInterval, string>;
  usagePriceIds: Record<PlanCode, string>;
  creditPackPriceIds: Record<CreditPackCode, string>;
};

export type RecentInvoiceSummary = {
  id: string;
  status: string | null;
  amountDue: number;
  amountPaid: number;
  currency: string;
  created: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
};

function env(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export const DEFAULT_BILLING_CURRENCY = env("STRIPE_BILLING_CURRENCY", "cad").toLowerCase();
const DEFAULT_CONNECT_COUNTRY = env("STRIPE_CONNECT_DEFAULT_COUNTRY", "CA").toUpperCase();
const STRIPE_API_VERSION = env("STRIPE_API_VERSION", "2025-06-30.basil");

export const ORDER_USAGE_RATE_CENTS = DEFAULT_ORDER_USAGE_RATE_CENTS;

const PLAN_LOOKUP_KEYS: Record<PlanCode, Record<BillingInterval, string>> = {
  starter: {
    month: "studio-os-starter-monthly-v2",
    year: "studio-os-starter-annual-v2",
  },
  core: {
    month: "studio-os-core-monthly-v2",
    year: "studio-os-core-annual-v2",
  },
  studio: {
    month: "studio-os-studio-monthly-v2",
    year: "studio-os-studio-annual-v2",
  },
};


const ORDER_USAGE_METER_EVENT_NAMES: Record<PlanCode, string> = {
  starter: "studio_os_starter_order_usage",
  core: "studio_os_core_order_usage",
  studio: "studio_os_studio_order_usage",
};

const EXTRA_DESKTOP_KEY_LOOKUPS: Record<BillingInterval, string> = {
  month: "studio-os-extra-desktop-key-monthly-v2",
  year: "studio-os-extra-desktop-key-annual-v2",
};

const ORDER_USAGE_LOOKUP_KEYS: Record<PlanCode, string> = {
  starter: "studio-os-starter-order-usage-monthly-v2",
  core: "studio-os-core-order-usage-monthly-v2",
  studio: "studio-os-studio-order-usage-monthly-v2",
};

const CREDIT_PACK_LOOKUP_KEYS: Record<CreditPackCode, string> = {
  background_credits_250: "studio-os-background-credits-250-v2",
  background_credits_1000: "studio-os-background-credits-1000-v2",
  background_credits_2500: "studio-os-background-credits-2500-v2",
  background_credits_5000: "studio-os-background-credits-5000-v2",
  background_credits_10000: "studio-os-background-credits-10000-v2",
};

export function asIsoTimestamp(unixSeconds: number | null | undefined) {
  if (!unixSeconds || !Number.isFinite(unixSeconds)) return null;
  return new Date(unixSeconds * 1000).toISOString();
}

export function toBillingPeriodKey(
  periodStartIso: string | null | undefined,
  periodEndIso: string | null | undefined,
) {
  if (!periodStartIso || !periodEndIso) return null;
  return `${periodStartIso.slice(0, 10)}:${periodEndIso.slice(0, 10)}`;
}

export function getConnectedAccountId(photographer: Pick<PhotographerBillingRow, "stripe_account_id" | "stripe_connected_account_id">) {
  return photographer.stripe_connected_account_id || photographer.stripe_account_id || null;
}

export function describeConnectStatus(input: {
  accountId: string | null;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  disabledReason?: string | null;
}) {
  if (!input.accountId) {
    return {
      label: "Not connected",
      message: "Connect Stripe before parents can complete checkout.",
      readyForPayments: false,
    };
  }

  if (!input.detailsSubmitted) {
    return {
      label: "Onboarding incomplete",
      message: "Stripe still needs onboarding details before the account can take payments.",
      readyForPayments: false,
    };
  }

  if (!input.chargesEnabled) {
    return {
      label: "Charges disabled",
      message:
        input.disabledReason?.trim() ||
        "Stripe has not enabled customer charges on this account yet.",
      readyForPayments: false,
    };
  }

  if (!input.payoutsEnabled) {
    return {
      label: "Payouts disabled",
      message:
        input.disabledReason?.trim() ||
        "Stripe is blocking payouts until the account requirements are fully complete.",
      readyForPayments: false,
    };
  }

  return {
    label: "Fully active",
    message: "Customer checkout can route directly to the photographer’s connected Stripe account.",
    readyForPayments: true,
  };
}

type StripeRequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  body?: URLSearchParams;
  account?: string;
  idempotencyKey?: string;
  query?: URLSearchParams;
};

export async function stripeRequest<T>(
  path: string,
  options: StripeRequestOptions = {},
): Promise<T> {
  const queryString = options.query?.toString();
  const target = `https://api.stripe.com/v1/${path}${queryString ? `?${queryString}` : ""}`;
  const response = await fetch(target, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${env("STRIPE_SECRET_KEY")}`,
      "Stripe-Version": STRIPE_API_VERSION,
      ...(options.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(options.account ? { "Stripe-Account": options.account } : {}),
      ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
    },
    body: options.body?.toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  const text = await response.text();
  const json = text ? (JSON.parse(text) as T & { error?: { message?: string } }) : ({} as T);

  if (!response.ok) {
    const errorMessage =
      (json as { error?: { message?: string } })?.error?.message ||
      `Stripe request failed for ${path}`;
    throw new Error(errorMessage);
  }

  return json as T;
}

export async function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
  secrets: string[],
) {
  const parts = signatureHeader.split(",");
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));

  if (!timestamp || !signatures.length || !secrets.length) {
    return false;
  }

  const signedPayload = `${timestamp}.${payload}`;

  return secrets.some((secret) => {
    const digest = createHmac("sha256", secret).update(signedPayload).digest("hex");
    return signatures.some((value) => {
      try {
        return timingSafeEqual(Buffer.from(value), Buffer.from(digest));
      } catch {
        return false;
      }
    });
  });
}

export async function recordStripeEvent(
  service: ServiceClient,
  event: Pick<StripeEventEnvelope, "id" | "type" | "account" | "livemode">,
  payload: Record<string, unknown>,
) {
  const { error } = await service.from("stripe_events").insert({
    id: event.id,
    event_type: event.type,
    stripe_account: event.account ?? null,
    livemode: event.livemode === true,
    payload,
  });

  if (!error) return { inserted: true };
  if ((error as { code?: string }).code === "23505") {
    return { inserted: false };
  }
  throw error;
}

/** Core photographer columns (always present). */
const PHOTOGRAPHER_SELECT_BASE =
  "id,user_id,business_name,brand_color,watermark_enabled,watermark_logo_url,studio_address,studio_phone,stripe_account_id,stripe_connected_account_id,stripe_connect_onboarding_complete,stripe_connect_charges_enabled,stripe_connect_payouts_enabled,stripe_platform_customer_id,stripe_subscription_id,stripe_subscription_item_base_id,stripe_subscription_item_extra_keys_id,stripe_subscription_item_usage_id,subscription_plan_code,subscription_billing_interval,subscription_status,subscription_current_period_start,subscription_current_period_end,billing_email,billing_currency,order_usage_rate_cents,extra_desktop_keys,studio_id,studio_email,logo_url,is_platform_admin,created_at";

/** Full select including trial columns (requires migration). */
const PHOTOGRAPHER_SELECT_FULL = `${PHOTOGRAPHER_SELECT_BASE},trial_starts_at,trial_ends_at`;

export async function getPhotographerByUserId(service: ServiceClient, userId: string) {
  // Try with trial columns first; fall back to base columns if the
  // migration hasn't been run yet (column doesn't exist → 400 error).
  let { data, error } = await service
    .from("photographers")
    .select(PHOTOGRAPHER_SELECT_FULL)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    const msg = (error.message ?? "").toLowerCase();
    if (msg.includes("trial_starts_at") || msg.includes("trial_ends_at") || error.code === "PGRST204") {
      // Trial columns don't exist yet — retry without them.
      const fallback = await service
        .from("photographers")
        .select(PHOTOGRAPHER_SELECT_BASE)
        .eq("user_id", userId)
        .maybeSingle();
      data = fallback.data as typeof data;
      error = fallback.error;
    }
    if (error) throw error;
  }

  return (data as PhotographerBillingRow | null) ?? null;
}

export async function getOrCreatePhotographerByUser(
  service: ServiceClient,
  user: { id: string; email?: string | null },
) {
  const existing = await getPhotographerByUserId(service, user.id);
  const needsTrialInitialization = existing && !existing.is_platform_admin &&
    existing.subscription_status === "trial" && !existing.stripe_subscription_id &&
    (!existing.subscription_plan_code?.trim() || !existing.trial_starts_at || !existing.trial_ends_at);
  if (existing && !needsTrialInitialization) return existing;

  // The database verifies email confirmation and locks the profile. Repeated or
  // concurrent requests cannot reset a trial or overwrite a paid subscription.
  const { data: initialized, error } = await service
    .rpc("initialize_photographer_trial", { p_user_id: user.id })
    .single<{ photographer_id: string; trial_initialized: boolean }>();
  if (error) throw error;
  const photographer = await getPhotographerByUserId(service, user.id);
  if (!photographer) throw new Error("Unable to initialize photographer account.");

  if (initialized?.trial_initialized && !photographer.is_platform_admin) {
    await notifyOwnerForSetting("alertOnNewRegistration", {
      title: "New Studio OS photographer",
      message: [
        photographer.business_name || "Studio OS Photographer",
        photographer.billing_email || user.email || "No email captured",
        `Trial ends: ${new Date(photographer.trial_ends_at!).toLocaleDateString("en-CA")}`,
      ].join("\n"),
      url: ownerUrl("/dashboard/admin/users"),
      urlTitle: "Open admin users",
      priority: 0,
      sound: "pushover",
    }).catch((error) => console.warn("[trial] Owner notification failed:", error));
  }
  return photographer;
}

export async function ensurePlatformCustomer(
  service: ServiceClient,
  photographer: PhotographerBillingRow,
  user: { id: string; email?: string | null },
) {
  if (photographer.stripe_platform_customer_id) {
    return photographer.stripe_platform_customer_id;
  }

  const params = new URLSearchParams();
  params.set("email", photographer.billing_email || photographer.studio_email || user.email || "");
  params.set("name", photographer.business_name || "Studio OS Photographer");
  params.set("metadata[photographer_id]", photographer.id);
  params.set("metadata[user_id]", user.id);

  const customer = await stripeRequest<StripeCustomer>("customers", {
    method: "POST",
    body: params,
    idempotencyKey: `studio-os-customer-${photographer.id}`,
  });

  const { error } = await service
    .from("photographers")
    .update({
      stripe_platform_customer_id: customer.id,
      billing_email: photographer.billing_email || photographer.studio_email || user.email || null,
      billing_currency: photographer.billing_currency || DEFAULT_BILLING_CURRENCY,
    })
    .eq("id", photographer.id);

  if (error) throw error;
  return customer.id;
}

export async function ensureCreditPackageCatalog(service: ServiceClient) {
  const expected = Object.values(CREDIT_PACK_DEFS);

  const { data, error } = await service
    .from("credit_packages")
    .select("id,name,credits,price_cents,active,sort_order,package_code")
    .not("package_code", "is", null)
    .order("sort_order", { ascending: true });

  if (error) throw error;

  const existing = new Map(
    ((data as CreditPackageRow[] | null) ?? []).map((row) => [row.package_code || "", row]),
  );

  for (const [index, pack] of expected.entries()) {
    const row = existing.get(pack.code);
    if (!row) {
      const { error: insertError } = await service.from("credit_packages").upsert({
        name: pack.label,
        credits: pack.credits,
        price_cents: pack.priceCents,
        active: true,
        sort_order: index + 1,
        package_code: pack.code,
      }, { onConflict: "package_code", ignoreDuplicates: true });
      if (insertError) throw insertError;
      continue;
    }

    const { error: updateError } = await service
      .from("credit_packages")
      .update({
        name: pack.label,
        credits: pack.credits,
        price_cents: pack.priceCents,
        active: true,
        sort_order: index + 1,
      })
      .eq("id", row.id);
    if (updateError) throw updateError;
  }

  const { data: refreshed, error: refreshedError } = await service
    .from("credit_packages")
    .select("id,name,credits,price_cents,active,sort_order,package_code")
    .not("package_code", "is", null)
    .order("sort_order", { ascending: true });

  if (refreshedError) throw refreshedError;
  return ((refreshed as CreditPackageRow[] | null) ?? [])
    .filter((row) => row.active)
    .map((row) => ({
      id: row.id,
      code: normalizeCreditPackCode(row.package_code) as CreditPackCode,
      name: row.name,
      credits: row.credits,
      priceCents: row.price_cents,
    }));
}

async function readBillingMeters() {
  const meters: StripeMeter[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  // Include inactive meters: an existing event name with an incompatible
  // definition must not be silently replaced by creating a second meter.
  for (let page = 0; page < 10; page += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("starting_after", cursor);
    const result = await stripeRequest<StripeList<StripeMeter>>("billing/meters", { query });
    if (!Array.isArray(result.data) || typeof result.has_more !== "boolean" || result.data.some((meter) =>
      !meter || typeof meter.id !== "string" || !meter.id || typeof meter.event_name !== "string" || !meter.event_name)) {
      throw new Error("Stripe billing meter list could not be verified.");
    }
    meters.push(...result.data);
    if (!result.has_more) return meters;
    cursor = result.data.at(-1)?.id;
    if (!cursor || cursors.has(cursor)) {
      throw new Error("Stripe billing meter pagination could not be verified.");
    }
    cursors.add(cursor);
  }
  throw new Error("Stripe billing meter list exceeds the safe verification limit.");
}

function selectBillingMeter(meters: StripeMeter[], eventName: string) {
  const matches = meters.filter((meter) => meter?.event_name === eventName);
  if (matches.length > 1) {
    throw new Error(`Stripe billing meter event name is ambiguous: ${eventName}.`);
  }
  const existing = matches[0];
  if (existing && (
    typeof existing.id !== "string" || !existing.id || existing.object !== "billing.meter" || existing.status !== "active" ||
    existing.default_aggregation?.formula !== "sum" || existing.customer_mapping?.type !== "by_id" ||
    existing.customer_mapping?.event_payload_key !== "stripe_customer_id" || existing.value_settings?.event_payload_key !== "value" ||
    existing.event_time_window !== null
  )) {
    throw new Error(`Stripe billing meter has incompatible order usage settings: ${eventName}.`);
  }
  return existing;
}

async function ensureBillingMeter(input: {
  eventName: string;
  displayName: string;
}) {
  const existing = selectBillingMeter(await readBillingMeters(), input.eventName);
  if (existing) {
    if (existing.display_name !== input.displayName) {
      await stripeRequest<StripeMeter>(`billing/meters/${existing.id}`, {
        method: "POST",
        body: new URLSearchParams({ display_name: input.displayName }),
      });
    }
    return existing.id;
  }

  const created = await stripeRequest<StripeMeter>("billing/meters", {
    method: "POST",
    body: new URLSearchParams({
      display_name: input.displayName,
      event_name: input.eventName,
      "default_aggregation[formula]": "sum",
      "value_settings[event_payload_key]": "value",
      "customer_mapping[type]": "by_id",
      "customer_mapping[event_payload_key]": "stripe_customer_id",
    }),
    idempotencyKey: `studio-os-meter-${input.eventName}`,
  });

  return created.id;
}

async function ensureCatalogEntry(entry: CatalogEntry) {
  const priceQuery = new URLSearchParams();
  priceQuery.append("active", "true");
  priceQuery.append("limit", "1");
  priceQuery.append("lookup_keys[]", entry.lookupKey);

  const meterId = entry.usageType === "metered" && entry.meterEventName
    ? await ensureBillingMeter({
        eventName: entry.meterEventName,
        displayName: entry.name,
      })
    : null;

  const existing = await stripeRequest<StripeList<StripePrice>>("prices", {
    query: priceQuery,
  });

  const existingPrice = existing.data[0];
  const recurringUsageType = existingPrice?.recurring?.usage_type ?? null;
  const recurringMeter = existingPrice?.recurring?.meter ?? null;

  if (
    existingPrice &&
    existingPrice.unit_amount === entry.unitAmount &&
    existingPrice.currency.toLowerCase() === entry.currency &&
    (existingPrice.recurring?.interval ?? null) === (entry.interval ?? null) &&
    recurringUsageType === (entry.usageType ?? null) &&
    recurringMeter === meterId
  ) {
    return existingPrice.id;
  }

  const product = await stripeRequest<StripeProduct>("products", {
    method: "POST",
    body: new URLSearchParams({
      name: entry.name,
      description: entry.description,
      "metadata[lookup_key]": entry.lookupKey,
    }),
    // A new metered rate has a new description. Keep the previous product and
    // avoid reusing its idempotency key with a different creation payload.
    idempotencyKey: `studio-os-product-${entry.lookupKey}${entry.usageType === "metered" ? `-${entry.unitAmount}` : ""}`,
  });

  const priceParams = new URLSearchParams();
  priceParams.set("currency", entry.currency);
  priceParams.set("unit_amount", String(entry.unitAmount));
  priceParams.set("product", product.id);
  priceParams.set("lookup_key", entry.lookupKey);
  priceParams.set("transfer_lookup_key", "true");
  if (entry.interval) {
    priceParams.set("recurring[interval]", entry.interval);
  }
  if (entry.usageType) {
    priceParams.set("recurring[usage_type]", entry.usageType);
  }
  if (meterId) {
    priceParams.set("recurring[meter]", meterId);
  }

  const created = await stripeRequest<StripePrice>("prices", {
    method: "POST",
    body: priceParams,
    idempotencyKey: `studio-os-price-${entry.lookupKey}-${entry.unitAmount}`,
  });

  return created.id;
}

let catalogPromise: Promise<StripeCatalog> | null = null;

function orderUsageDescription(rateCents: number) {
  const rate = new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: DEFAULT_BILLING_CURRENCY.toUpperCase(),
    currencyDisplay: "code",
  }).format(rateCents / 100);
  return `Completed paid order usage billed monthly at ${rate} per order`;
}

export async function ensureStripeCatalog() {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      // Verify every existing order meter before any product, price or meter
      // mutation, including the earlier base-plan catalog entries.
      const existingMeters = await readBillingMeters();
      for (const eventName of Object.values(ORDER_USAGE_METER_EVENT_NAMES)) {
        selectBillingMeter(existingMeters, eventName);
      }
      const planPrices = {
        starter: {
          month: await ensureCatalogEntry({
            code: "starter_month",
            name: "Starter Monthly",
            description: "Studio OS Starter monthly subscription",
            currency: DEFAULT_BILLING_CURRENCY,
            unitAmount: PLAN_DEFS.starter.priceCents,
            interval: "month",
            lookupKey: PLAN_LOOKUP_KEYS.starter.month,
          }),
          year: await ensureCatalogEntry({
            code: "starter_year",
            name: "Starter Annual",
            description: "Studio OS Starter annual subscription paid in advance",
            currency: DEFAULT_BILLING_CURRENCY,
            unitAmount: PLAN_DEFS.starter.annualPriceCents,
            interval: "year",
            lookupKey: PLAN_LOOKUP_KEYS.starter.year,
          }),
        },
        core: {
          month: await ensureCatalogEntry({
            code: "core_month",
            name: "Core Monthly",
            description: "Studio OS Core monthly subscription",
            currency: DEFAULT_BILLING_CURRENCY,
            unitAmount: PLAN_DEFS.core.priceCents,
            interval: "month",
            lookupKey: PLAN_LOOKUP_KEYS.core.month,
          }),
          year: await ensureCatalogEntry({
            code: "core_year",
            name: "Core Annual",
            description: "Studio OS Core annual subscription paid in advance",
            currency: DEFAULT_BILLING_CURRENCY,
            unitAmount: PLAN_DEFS.core.annualPriceCents,
            interval: "year",
            lookupKey: PLAN_LOOKUP_KEYS.core.year,
          }),
        },
        studio: {
          month: await ensureCatalogEntry({
            code: "studio_month",
            name: "Studio Monthly",
            description: "Studio OS Studio monthly subscription",
            currency: DEFAULT_BILLING_CURRENCY,
            unitAmount: PLAN_DEFS.studio.priceCents,
            interval: "month",
            lookupKey: PLAN_LOOKUP_KEYS.studio.month,
          }),
          year: await ensureCatalogEntry({
            code: "studio_year",
            name: "Studio Annual",
            description: "Studio OS Studio annual subscription paid in advance",
            currency: DEFAULT_BILLING_CURRENCY,
            unitAmount: PLAN_DEFS.studio.annualPriceCents,
            interval: "year",
            lookupKey: PLAN_LOOKUP_KEYS.studio.year,
          }),
        },
      } as Record<PlanCode, Record<BillingInterval, string>>;

      const extraDesktopKeyPriceIds = {
        month: await ensureCatalogEntry({
          code: "extra_desktop_keys_month",
          name: "Extra Desktop Key Monthly",
          description: "Additional Studio OS desktop key billed monthly",
          currency: DEFAULT_BILLING_CURRENCY,
          unitAmount: EXTRA_DESKTOP_KEY_MONTHLY_CENTS,
          interval: "month",
          lookupKey: EXTRA_DESKTOP_KEY_LOOKUPS.month,
        }),
        year: await ensureCatalogEntry({
          code: "extra_desktop_keys_year",
          name: "Extra Desktop Key Annual",
          description: "Additional Studio OS desktop key billed annually in advance",
          currency: DEFAULT_BILLING_CURRENCY,
          unitAmount: EXTRA_DESKTOP_KEY_ANNUAL_CENTS,
          interval: "year",
          lookupKey: EXTRA_DESKTOP_KEY_LOOKUPS.year,
        }),
      } satisfies Record<BillingInterval, string>;

      const usagePriceIds = {
        starter: await ensureCatalogEntry({
          code: "starter_usage",
          name: "Starter Order Usage",
          description: orderUsageDescription(PLAN_DEFS.starter.usageRateCents),
          currency: DEFAULT_BILLING_CURRENCY,
          unitAmount: PLAN_DEFS.starter.usageRateCents,
          interval: "month",
          usageType: "metered",
          meterEventName: ORDER_USAGE_METER_EVENT_NAMES.starter,
          lookupKey: ORDER_USAGE_LOOKUP_KEYS.starter,
        }),
        core: await ensureCatalogEntry({
          code: "core_usage",
          name: "Core Order Usage",
          description: orderUsageDescription(PLAN_DEFS.core.usageRateCents),
          currency: DEFAULT_BILLING_CURRENCY,
          unitAmount: PLAN_DEFS.core.usageRateCents,
          interval: "month",
          usageType: "metered",
          meterEventName: ORDER_USAGE_METER_EVENT_NAMES.core,
          lookupKey: ORDER_USAGE_LOOKUP_KEYS.core,
        }),
        studio: await ensureCatalogEntry({
          code: "studio_usage",
          name: "Studio Order Usage",
          description: orderUsageDescription(PLAN_DEFS.studio.usageRateCents),
          currency: DEFAULT_BILLING_CURRENCY,
          unitAmount: PLAN_DEFS.studio.usageRateCents,
          interval: "month",
          usageType: "metered",
          meterEventName: ORDER_USAGE_METER_EVENT_NAMES.studio,
          lookupKey: ORDER_USAGE_LOOKUP_KEYS.studio,
        }),
      } satisfies Record<PlanCode, string>;

      const creditPackPriceIds = {
        background_credits_250: await ensureCatalogEntry({
          code: "background_credits_250",
          name: "Background Credits 250",
          description: "Studio OS background credit pack",
          currency: DEFAULT_BILLING_CURRENCY,
          unitAmount: CREDIT_PACK_DEFS.background_credits_250.priceCents,
          lookupKey: CREDIT_PACK_LOOKUP_KEYS.background_credits_250,
        }),
        background_credits_1000: await ensureCatalogEntry({
          code: "background_credits_1000",
          name: "Background Credits 1000",
          description: "Studio OS background credit pack",
          currency: DEFAULT_BILLING_CURRENCY,
          unitAmount: CREDIT_PACK_DEFS.background_credits_1000.priceCents,
          lookupKey: CREDIT_PACK_LOOKUP_KEYS.background_credits_1000,
        }),
        background_credits_2500: await ensureCatalogEntry({
          code: "background_credits_2500",
          name: "Background Credits 2500",
          description: "Studio OS background credit pack",
          currency: DEFAULT_BILLING_CURRENCY,
          unitAmount: CREDIT_PACK_DEFS.background_credits_2500.priceCents,
          lookupKey: CREDIT_PACK_LOOKUP_KEYS.background_credits_2500,
        }),
        background_credits_5000: await ensureCatalogEntry({
          code: "background_credits_5000",
          name: "Background Credits 5000",
          description: "Studio OS background credit pack",
          currency: DEFAULT_BILLING_CURRENCY,
          unitAmount: CREDIT_PACK_DEFS.background_credits_5000.priceCents,
          lookupKey: CREDIT_PACK_LOOKUP_KEYS.background_credits_5000,
        }),
        background_credits_10000: await ensureCatalogEntry({
          code: "background_credits_10000",
          name: "Background Credits 10000",
          description: "Studio OS background credit pack",
          currency: DEFAULT_BILLING_CURRENCY,
          unitAmount: CREDIT_PACK_DEFS.background_credits_10000.priceCents,
          lookupKey: CREDIT_PACK_LOOKUP_KEYS.background_credits_10000,
        }),
      } as Record<CreditPackCode, string>;

      return {
        planPrices,
        extraDesktopKeyPriceIds,
        usagePriceIds,
        creditPackPriceIds,
      };
    })().catch((error) => {
      catalogPromise = null;
      throw error;
    });
  }

  return catalogPromise;
}

export async function retrieveStripeAccount(accountId: string) {
  return stripeRequest<StripeAccount>(`accounts/${accountId}`);
}

export async function createConnectedAccount(input: {
  photographerId: string;
  userId: string;
  email?: string | null;
  businessName?: string | null;
}) {
  const params = new URLSearchParams();
  params.set("type", "express");
  params.set("country", DEFAULT_CONNECT_COUNTRY);
  params.set("email", input.email || "");
  params.set("business_type", "individual");
  params.set("metadata[photographer_id]", input.photographerId);
  params.set("metadata[user_id]", input.userId);
  params.set("capabilities[card_payments][requested]", "true");
  params.set("capabilities[transfers][requested]", "true");
  if (input.businessName?.trim()) {
    params.set("business_profile[name]", input.businessName.trim());
  }
  return stripeRequest<StripeAccount>("accounts", {
    method: "POST",
    body: params,
    idempotencyKey: `studio-os-connect-account-${input.photographerId}`,
  });
}

export async function createConnectedAccountLink(accountId: string, urls: { returnUrl: string; refreshUrl: string }) {
  const params = new URLSearchParams();
  params.set("account", accountId);
  params.set("type", "account_onboarding");
  params.set("return_url", urls.returnUrl);
  params.set("refresh_url", urls.refreshUrl);
  return stripeRequest<{ object: "account_link"; url: string }>("account_links", {
    method: "POST",
    body: params,
  });
}

export async function retrieveStripeSubscription(subscriptionId: string) {
  const query = new URLSearchParams();
  query.append("expand[]", "items.data.price");
  query.append("expand[]", "latest_invoice");
  return stripeRequest<StripeSubscription>(`subscriptions/${subscriptionId}`, {
    query,
  });
}

async function deleteStripeSubscriptionItem(itemId: string) {
  return stripeRequest<{ id: string; deleted: boolean }>(`subscription_items/${itemId}`, {
    method: "DELETE",
  });
}

async function createStripeSubscriptionItem(subscriptionId: string, priceId: string, quantity?: number) {
  const params = new URLSearchParams();
  params.set("subscription", subscriptionId);
  params.set("price", priceId);
  if (typeof quantity === "number") {
    params.set("quantity", String(quantity));
  }
  return stripeRequest<{ id: string }>("subscription_items", {
    method: "POST",
    body: params,
    idempotencyKey: `studio-os-sub-item-${subscriptionId}-${priceId}-${quantity ?? "na"}`,
  });
}

async function ensureMixedIntervalBilling(subscription: StripeSubscription, interval: BillingInterval) {
  const mode = typeof subscription.billing_mode === "string"
    ? subscription.billing_mode : subscription.billing_mode?.type;
  if (interval !== "year" || mode === "flexible") return subscription;
  return stripeRequest<StripeSubscription>(`subscriptions/${subscription.id}/migrate`, {
    method: "POST",
    body: new URLSearchParams({ "billing_mode[type]": "flexible" }),
    idempotencyKey: `studio-os-flexible-billing-${subscription.id}`,
  });
}

function getLookupKey(price: StripePrice | null | undefined) {
  return (price?.lookup_key ?? "").trim();
}

function resolveBillingIntervalFromLookupKey(lookupKey: string) {
  for (const [planCode, intervals] of Object.entries(PLAN_LOOKUP_KEYS) as Array<
    [PlanCode, Record<BillingInterval, string>]
  >) {
    for (const [interval, value] of Object.entries(intervals) as Array<
      [BillingInterval, string]
    >) {
      if (lookupKey === value) {
        return { planCode, interval };
      }
    }
  }

  return null;
}

function resolveUsagePlanCodeFromLookupKey(lookupKey: string) {
  for (const [planCode, value] of Object.entries(ORDER_USAGE_LOOKUP_KEYS) as Array<
    [PlanCode, string]
  >) {
    if (lookupKey === value) {
      return planCode;
    }
  }
  return null;
}

function resolvePlanCodeFromSubscription(subscription: StripeSubscription) {
  for (const item of subscription.items.data) {
    const resolved = resolveBillingIntervalFromLookupKey(getLookupKey(item.price));
    if (resolved?.planCode) return resolved.planCode;
  }

  return normalizePlanCode(subscription.metadata?.plan_code ?? null);
}

function resolveSubscriptionBillingInterval(subscription: StripeSubscription) {
  for (const item of subscription.items.data) {
    const resolved = resolveBillingIntervalFromLookupKey(getLookupKey(item.price));
    if (resolved?.interval) return resolved.interval;
  }

  return normalizeBillingInterval(subscription.metadata?.billing_interval ?? null) ?? "month";
}

function findSubscriptionItems(subscription: StripeSubscription) {
  const baseItem =
    subscription.items.data.find((item) => {
      const lookupKey = getLookupKey(item.price);
      return Boolean(resolveBillingIntervalFromLookupKey(lookupKey));
    }) ?? null;

  const extraDesktopItem =
    subscription.items.data.find((item) =>
      Object.values(EXTRA_DESKTOP_KEY_LOOKUPS).includes(getLookupKey(item.price)),
    ) ?? null;

  const usageItem =
    subscription.items.data.find((item) =>
      Boolean(resolveUsagePlanCodeFromLookupKey(getLookupKey(item.price))),
    ) ?? null;

  return { baseItem, extraDesktopItem, usageItem };
}

export async function listRecentStripeInvoices(customerId: string, limit = 6) {
  const query = new URLSearchParams();
  query.set("customer", customerId);
  query.set("limit", String(limit));
  const invoices = await stripeRequest<StripeList<StripeInvoice>>("invoices", { query });
  return invoices.data.map<RecentInvoiceSummary>((invoice) => ({
    id: invoice.id,
    status: invoice.status,
    amountDue: invoice.amount_due,
    amountPaid: invoice.amount_paid,
    currency: invoice.currency,
    created: new Date(invoice.created * 1000).toISOString(),
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoicePdf: invoice.invoice_pdf ?? null,
  }));
}

export async function createPlanCheckoutSession(input: {
  customerId: string;
  photographerId: string;
  userId: string;
  planCode: PlanCode;
  billingInterval: BillingInterval;
  extraDesktopKeys: number;
  successUrl: string;
  cancelUrl: string;
}) {
  const catalog = await ensureStripeCatalog();
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("customer", input.customerId);
  params.set("success_url", input.successUrl);
  params.set("cancel_url", input.cancelUrl);
  params.set("metadata[billing_flow]", "plan_subscription");
  params.set("metadata[plan_code]", input.planCode);
  params.set("metadata[billing_interval]", input.billingInterval);
  params.set("metadata[photographer_id]", input.photographerId);
  params.set("metadata[user_id]", input.userId);
  params.set("subscription_data[metadata][plan_code]", input.planCode);
  params.set("subscription_data[metadata][billing_interval]", input.billingInterval);
  params.set("subscription_data[metadata][photographer_id]", input.photographerId);
  params.set("subscription_data[metadata][user_id]", input.userId);
  // Checkout cannot combine annual and monthly items. The monthly usage item
  // is attached after payment to this flexible annual subscription.
  if (input.billingInterval === "year") {
    params.set("subscription_data[billing_mode][type]", "flexible");
  }
  params.set("line_items[0][price]", catalog.planPrices[input.planCode][input.billingInterval]);
  params.set("line_items[0][quantity]", "1");

  if (input.extraDesktopKeys > 0) {
    params.set(
      "line_items[1][price]",
      catalog.extraDesktopKeyPriceIds[input.billingInterval],
    );
    params.set("line_items[1][quantity]", String(input.extraDesktopKeys));
    params.set("metadata[extra_desktop_keys]", String(input.extraDesktopKeys));
    params.set(
      "subscription_data[metadata][extra_desktop_keys]",
      String(input.extraDesktopKeys),
    );
  }

  return stripeRequest<StripeCheckoutSession>("checkout/sessions", {
    method: "POST",
    body: params,
  });
}

export async function createCreditsCheckoutSession(input: {
  customerId: string;
  photographerId: string;
  userId: string;
  packCode: CreditPackCode;
  creditPackageId: string;
  successUrl: string;
  cancelUrl: string;
}) {
  const catalog = await ensureStripeCatalog();
  const pack = CREDIT_PACK_DEFS[input.packCode];
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("customer", input.customerId);
  params.set("success_url", input.successUrl);
  params.set("cancel_url", input.cancelUrl);
  params.set("line_items[0][price]", catalog.creditPackPriceIds[input.packCode]);
  params.set("line_items[0][quantity]", "1");
  params.set("metadata[billing_flow]", "credit_pack");
  params.set("metadata[pack_code]", input.packCode);
  params.set("metadata[credit_package_id]", input.creditPackageId);
  params.set("metadata[photographer_id]", input.photographerId);
  params.set("metadata[user_id]", input.userId);
  params.set("payment_intent_data[metadata][billing_flow]", "credit_pack");
  params.set("payment_intent_data[metadata][pack_code]", input.packCode);
  params.set("payment_intent_data[metadata][credit_package_id]", input.creditPackageId);
  params.set("payment_intent_data[metadata][photographer_id]", input.photographerId);
  params.set("payment_intent_data[metadata][user_id]", input.userId);
  params.set("payment_intent_data[metadata][credits]", String(pack.credits));
  // Keep the exact paid offer on both objects, so a later pricing change
  // cannot change how many credits an in-flight Checkout purchase receives.
  for (const prefix of ["metadata", "payment_intent_data[metadata]"]) {
    params.set(`${prefix}[credits]`, String(pack.credits));
    params.set(`${prefix}[price_cents]`, String(pack.priceCents));
    params.set(`${prefix}[currency]`, DEFAULT_BILLING_CURRENCY);
  }

  return stripeRequest<StripeCheckoutSession>("checkout/sessions", {
    method: "POST",
    body: params,
  });
}

export async function createBillingPortalSession(customerId: string, returnUrl: string) {
  const params = new URLSearchParams();
  params.set("customer", customerId);
  params.set("return_url", returnUrl);
  return stripeRequest<{ id: string; url: string }>("billing_portal/sessions", {
    method: "POST",
    body: params,
  });
}

export async function updateStripeSubscriptionConfiguration(input: {
  subscriptionId: string;
  photographerId: string;
  planCode: PlanCode;
  billingInterval: BillingInterval;
  extraDesktopKeys: number;
}) {
  const [catalog, subscription] = await Promise.all([
    ensureStripeCatalog(),
    retrieveStripeSubscription(input.subscriptionId),
  ]);

  const { baseItem, extraDesktopItem, usageItem } = findSubscriptionItems(subscription);
  await ensureMixedIntervalBilling(subscription, input.billingInterval);
  const targetUsagePriceId = catalog.usagePriceIds[input.planCode];
  const params = new URLSearchParams();
  let itemIndex = 0;

  if (baseItem) {
    params.set(`items[${itemIndex}][id]`, baseItem.id);
    params.set(
      `items[${itemIndex}][price]`,
      catalog.planPrices[input.planCode][input.billingInterval],
    );
    itemIndex += 1;
  } else {
    params.set(
      `items[${itemIndex}][price]`,
      catalog.planPrices[input.planCode][input.billingInterval],
    );
    itemIndex += 1;
  }

  if (input.extraDesktopKeys > 0) {
    if (extraDesktopItem) {
      params.set(`items[${itemIndex}][id]`, extraDesktopItem.id);
      params.set(
        `items[${itemIndex}][price]`,
        catalog.extraDesktopKeyPriceIds[input.billingInterval],
      );
      params.set(`items[${itemIndex}][quantity]`, String(input.extraDesktopKeys));
    } else {
      params.set(
        `items[${itemIndex}][price]`,
        catalog.extraDesktopKeyPriceIds[input.billingInterval],
      );
      params.set(`items[${itemIndex}][quantity]`, String(input.extraDesktopKeys));
    }
    itemIndex += 1;
  } else if (extraDesktopItem) {
    await deleteStripeSubscriptionItem(extraDesktopItem.id);
  }

  if (usageItem) {
    params.set(`items[${itemIndex}][id]`, usageItem.id);
    params.set(`items[${itemIndex}][price]`, targetUsagePriceId);
    itemIndex += 1;
  }

  params.set("metadata[plan_code]", input.planCode);
  params.set("metadata[billing_interval]", input.billingInterval);
  params.set("metadata[photographer_id]", input.photographerId);
  params.set("metadata[extra_desktop_keys]", String(input.extraDesktopKeys));
  params.set("proration_behavior", "create_prorations");

  await stripeRequest<StripeSubscription>(`subscriptions/${subscription.id}`, {
    method: "POST",
    body: params,
  });

  if (!usageItem) {
    await createStripeSubscriptionItem(subscription.id, targetUsagePriceId);
  }

  return retrieveStripeSubscription(subscription.id);
}

export async function syncConnectState(
  service: ServiceClient,
  photographerId: string,
  account: StripeAccount,
) {
  const updates = {
    stripe_account_id: account.id,
    stripe_connected_account_id: account.id,
    stripe_connect_onboarding_complete:
      account.details_submitted && account.charges_enabled && account.payouts_enabled,
    stripe_connect_charges_enabled: account.charges_enabled,
    stripe_connect_payouts_enabled: account.payouts_enabled,
  };

  const { error } = await service.from("photographers").update(updates).eq("id", photographerId);
  if (error) throw error;

  return updates;
}

async function upsertSubscriptionMirror(
  service: ServiceClient,
  photographer: PhotographerBillingRow,
  input: {
    planCode: PlanCode | null;
    billingInterval: BillingInterval | null;
    stripeStatus: string | null;
    customerId: string | null;
    subscriptionId: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    billingEmail: string | null;
    billingCurrency: string | null;
    extraDesktopKeys: number;
  },
) {
  const gateStatus = isStripeBillingActive(input.stripeStatus)
    ? "active"
    : input.stripeStatus === "canceled"
      ? "cancelled"
      : "inactive";

  const { error } = await service.from("subscriptions").upsert(
    {
      user_id: photographer.user_id,
      photographer_id: photographer.id,
      status: gateStatus,
      plan: input.planCode,
      billing_interval: input.billingInterval || "month",
      stripe_customer_id: input.customerId,
      stripe_subscription_id: input.subscriptionId,
      stripe_connected_account_id: getConnectedAccountId(photographer),
      current_period_start: input.currentPeriodStart,
      current_period_end: input.currentPeriodEnd,
      billing_email: input.billingEmail,
      billing_currency: input.billingCurrency || DEFAULT_BILLING_CURRENCY,
      extra_desktop_keys: input.extraDesktopKeys,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) throw error;
}

export async function syncSubscriptionStateFromStripe(
  service: ServiceClient,
  photographer: PhotographerBillingRow,
  subscriptionInput: StripeSubscription,
) {
  let subscription = subscriptionInput;
  const planCode = resolvePlanCodeFromSubscription(subscription);
  const { usageItem } = findSubscriptionItems(subscription);

  if (planCode && !usageItem && isStripeBillingActive(subscription.status)) {
    const catalog = await ensureStripeCatalog();
    subscription = await ensureMixedIntervalBilling(subscription, resolveSubscriptionBillingInterval(subscription));
    await createStripeSubscriptionItem(subscription.id, catalog.usagePriceIds[planCode]);
    subscription = await retrieveStripeSubscription(subscription.id);
  }

  const refreshedItems = findSubscriptionItems(subscription);
  const refreshedPlanCode = resolvePlanCodeFromSubscription(subscription);
  const refreshedBillingInterval = resolveSubscriptionBillingInterval(subscription);
  const { start: currentPeriodStart, end: currentPeriodEnd } = resolveStripeBillingPeriod(subscription, refreshedItems.baseItem);
  const extraDesktopKeys = refreshedItems.extraDesktopItem?.quantity ?? 0;
  const nextBillingCurrency =
    refreshedItems.baseItem?.price.currency ||
    photographer.billing_currency ||
    DEFAULT_BILLING_CURRENCY;
  const existingUsageRate = refreshedItems.usageItem?.price.unit_amount;
  // Existing subscriptions retain their Stripe price until an explicit plan
  // change. Mirror that actual rate rather than a newer catalog default.
  const nextUsageRate =
    typeof existingUsageRate === "number" && Number.isInteger(existingUsageRate) && existingUsageRate >= 0
      ? existingUsageRate
      : refreshedPlanCode ? PLAN_DEFS[refreshedPlanCode].usageRateCents : ORDER_USAGE_RATE_CENTS;

  const updates = {
    stripe_platform_customer_id: subscription.customer,
    stripe_subscription_id: subscription.id,
    stripe_subscription_item_base_id: refreshedItems.baseItem?.id ?? null,
    stripe_subscription_item_extra_keys_id: refreshedItems.extraDesktopItem?.id ?? null,
    stripe_subscription_item_usage_id: refreshedItems.usageItem?.id ?? null,
    subscription_plan_code: refreshedPlanCode,
    subscription_billing_interval: refreshedBillingInterval,
    subscription_status: subscription.status,
    subscription_current_period_start: currentPeriodStart,
    subscription_current_period_end: currentPeriodEnd,
    order_usage_rate_cents: nextUsageRate,
    extra_desktop_keys: extraDesktopKeys,
  };

  const { error } = await service.from("photographers").update(updates).eq("id", photographer.id);
  if (error) throw error;

  const refreshedPhotographer = {
    ...photographer,
    ...updates,
  } as PhotographerBillingRow;

  await reconcileOrderUsageFeeRefunds(service, photographer.id, stripeRequest);

  await upsertSubscriptionMirror(service, refreshedPhotographer, {
    planCode: refreshedPlanCode,
    billingInterval: refreshedBillingInterval,
    stripeStatus: subscription.status,
    customerId: subscription.customer,
    subscriptionId: subscription.id,
    currentPeriodStart,
    currentPeriodEnd,
    billingEmail: photographer.billing_email || photographer.studio_email || null,
    billingCurrency: nextBillingCurrency,
    extraDesktopKeys,
  });

  if (refreshedPlanCode && isStripeBillingActive(subscription.status)) {
    await grantIncludedPlanCredits(service, refreshedPhotographer);
    await syncOutstandingStudioUsage(service, refreshedPhotographer,
      resolveStripeBillingPeriod(subscription, refreshedItems.usageItem), refreshedItems.usageItem);
  }

  await syncPhotographyKeysByPhotographerId(service, refreshedPhotographer.id);

  return {
    photographer: refreshedPhotographer,
    subscription,
    planCode: refreshedPlanCode,
    baseItemId: refreshedItems.baseItem?.id ?? null,
    extraDesktopItemId: refreshedItems.extraDesktopItem?.id ?? null,
    usageItemId: refreshedItems.usageItem?.id ?? null,
    extraDesktopKeys,
  };
}

async function appendOrderNote(orderNotes: string | null, note: string) {
  if ((orderNotes ?? "").includes(note)) return orderNotes;
  return [orderNotes || "", note].filter(Boolean).join("\n\n");
}

async function syncOutstandingStudioUsage(
  service: ServiceClient,
  photographer: PhotographerBillingRow,
  usagePeriod?: { start: string | null; end: string | null },
  usageItem?: StripeSubscriptionItem | null,
) {
  if (
    photographer.is_platform_admin ||
    !normalizePlanCode(photographer.subscription_plan_code) ||
    !isStripeBillingActive(photographer.subscription_status) ||
    !photographer.stripe_subscription_item_usage_id
  ) {
    return;
  }

  if (!usagePeriod && photographer.stripe_subscription_id) {
    const subscription = await retrieveStripeSubscription(photographer.stripe_subscription_id);
    usageItem = findSubscriptionItems(subscription).usageItem;
    usagePeriod = resolveStripeBillingPeriod(subscription, usageItem);
  }
  const periodStart = usagePeriod?.start ?? photographer.subscription_current_period_start;
  const periodEnd = usagePeriod?.end ?? photographer.subscription_current_period_end;
  const billingPeriodKey = toBillingPeriodKey(periodStart, periodEnd);
  if (!periodStart || !periodEnd || !billingPeriodKey) return;

  const planCode = normalizePlanCode(photographer.subscription_plan_code);
  const customerId = photographer.stripe_platform_customer_id;
  if (!planCode || !customerId) return;
  await syncOrderUsageFees(service, {
    photographerId: photographer.id,
    customerId,
    eventName: ORDER_USAGE_METER_EVENT_NAMES[planCode],
    amountCents: usageItem?.price.unit_amount ?? photographer.order_usage_rate_cents ?? PLAN_DEFS[planCode].usageRateCents,
    currency: usageItem?.price.currency ?? photographer.billing_currency ?? DEFAULT_BILLING_CURRENCY,
    periodStart, periodEnd, billingPeriod: billingPeriodKey,
  }, stripeRequest);
}

async function grantIncludedPlanCredits(
  service: ServiceClient,
  photographer: PhotographerBillingRow,
) {
  const planCode = normalizePlanCode(photographer.subscription_plan_code);
  if (!planCode || !photographer.user_id || !isStripeBillingActive(photographer.subscription_status)) {
    return;
  }

  const includedCredits = PLAN_DEFS[planCode].includedCredits;
  const billingPeriodKey = toBillingPeriodKey(
    photographer.subscription_current_period_start,
    photographer.subscription_current_period_end,
  );

  if (!includedCredits || !billingPeriodKey) return;

  const sourceReferenceId = `plan:${planCode}:${billingPeriodKey}`;
  const { data: existing, error: existingError } = await service
    .from("credit_transactions")
    .select("id")
    .eq("source", "monthly_included")
    .eq("source_reference_id", sourceReferenceId)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return;

  await adjustCreditBalance(service, {
    photographerId: photographer.id,
    userId: photographer.user_id,
    delta: includedCredits,
    type: "monthly_included",
    source: "monthly_included",
    description: `${PLAN_DEFS[planCode].label} monthly included credits`,
    sourceReferenceId,
  });
}

/**
 * Dashboard sentinel for the owner's free local processing. Paid cloud
 * provider jobs use the actual balance and reserve credits on the server.
 */
export const OWNER_UNLIMITED_CREDIT_BALANCE = 1_000_000_000;

export async function getCreditBalanceDetails(
  service: ServiceClient,
  userId: string,
  photographerId: string,
  options?: { isPlatformAdmin?: boolean | null },
) {
  // Report the local owner benefit without creating a purchase or changing
  // the credit balance just because the dashboard was opened.
  if (options?.isPlatformAdmin) {
    return { balance: OWNER_UNLIMITED_CREDIT_BALANCE, expiresAt: null, creditDebt: 0 };
  }
  const { data, error } = await service.rpc("get_studio_credit_balance", { p_studio_id: userId });
  if (error) throw error;
  const row = (data as Array<{ balance: number; expires_at: string | null; credit_debt: number }> | null)?.[0];
  if (!row) throw new Error("Credit balance returned no result.");
  return { balance: row.balance, expiresAt: row.expires_at, creditDebt: row.credit_debt };
}

export async function getCreditBalance(
  service: ServiceClient,
  userId: string,
  photographerId: string,
  options?: { isPlatformAdmin?: boolean | null },
) {
  return (await getCreditBalanceDetails(service, userId, photographerId, options)).balance;
}

async function adjustCreditBalance(
  service: ServiceClient,
  input: {
    photographerId: string;
    userId: string;
    delta: number;
    type: string;
    source: string;
    description: string;
    packageId?: string | null;
    sourceReferenceId?: string | null;
    checkoutSessionId?: string | null;
    paymentIntentId?: string | null;
  },
) {
  // The database locks the studio row, deduplicates the source and writes
  // balance + ledger together. Never fall back to separate REST mutations:
  // a failed ledger write or simultaneous checkout would lose/double credits.
  const { data, error } = await service.rpc("apply_credit_adjustment", {
    p_studio_id: input.userId,
    p_photographer_id: input.photographerId,
    p_delta: input.delta,
    p_type: input.type,
    p_source: input.source,
    p_description: input.description,
    p_package_id: input.packageId ?? null,
    p_source_reference_id: input.sourceReferenceId ?? null,
    p_checkout_session_id: input.checkoutSessionId ?? null,
    p_payment_intent_id: input.paymentIntentId ?? null,
  });
  if (error) throw error;
  const result = (data as Array<{ applied: boolean; balance: number; credits_delta: number }> | null)?.[0];
  if (!result) throw new Error("Credit adjustment returned no result.");
  return result;
}

export async function handleCreditPackCheckoutCompleted(
  service: ServiceClient,
  session: StripeCheckoutSession,
) {
  if ((session.payment_status ?? "").toLowerCase() !== "paid") {
    return null;
  }

  const packCode = normalizeCreditPackCode(session.metadata?.pack_code ?? null);
  const photographerId = session.metadata?.photographer_id ?? null;
  const creditPackageId = session.metadata?.credit_package_id ?? null;
  const sourceReferenceId = session.payment_intent;

  if (!packCode || !photographerId || !sourceReferenceId || session.mode !== "payment") {
    throw new Error("Paid credit checkout is missing its purchase identity.");
  }

  const pack = CREDIT_PACK_DEFS[packCode];
  const credits = Number(session.metadata?.credits ?? pack.credits);
  const priceCents = Number(session.metadata?.price_cents ?? pack.priceCents);
  const currency = session.metadata?.currency ?? DEFAULT_BILLING_CURRENCY;
  if (!Number.isSafeInteger(credits) || credits <= 0 ||
      !Number.isSafeInteger(priceCents) || priceCents <= 0 ||
      session.amount_total !== priceCents || session.currency !== currency ||
      currency !== DEFAULT_BILLING_CURRENCY) {
    throw new Error("Paid credit checkout does not match its credit offer.");
  }

  const { data: photographer, error: photographerError } = await service
    .from("photographers")
    .select("id,user_id,stripe_platform_customer_id")
    .eq("id", photographerId)
    .maybeSingle();

  if (photographerError) throw photographerError;
  if (!photographer?.user_id || session.customer !== photographer.stripe_platform_customer_id ||
      session.metadata?.user_id !== photographer.user_id) {
    throw new Error("Paid credit checkout does not match its studio owner.");
  }

  const result = await adjustCreditBalance(service, {
    photographerId,
    userId: photographer.user_id as string,
    delta: credits,
    type: "purchase",
    source: "purchase",
    description: `${pack.label} purchased`,
    packageId: creditPackageId,
    sourceReferenceId,
    checkoutSessionId: session.id,
    paymentIntentId: session.payment_intent ?? null,
  });

  // Webhooks can arrive out of order, or an already-refunded checkout can be
  // replayed. Re-read successful refunds even when the grant was a duplicate.
  await reconcileCreditRefundFromStripe(service, sourceReferenceId);
  return { photographerId, creditsGranted: result.applied ? credits : 0 };
}

export async function handleCreditChargeRefunded(
  service: ServiceClient,
  charge: StripeCharge,
) {
  const paymentIntentId = charge.payment_intent ?? null;
  if (!paymentIntentId || !Number.isSafeInteger(charge.amount) || charge.amount <= 0 ||
      !Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0 ||
      charge.amount_refunded > charge.amount) {
    throw new Error("Invalid credit purchase refund amount.");
  }
  const { data, error } = await service.rpc("reverse_credit_purchase", {
    p_payment_intent_id: paymentIntentId,
    p_charge_amount_cents: charge.amount,
    p_refunded_amount_cents: charge.amount_refunded,
    p_description: "Credit pack refund confirmed by Stripe",
  });
  if (error) throw error;
  const result = (data as Array<{ photographer_id: string; credits_delta: number }> | null)?.[0];
  if (!result) throw new Error("Credit refund returned no result.");
  return { photographerId: result.photographer_id, creditsReversed: -result.credits_delta };
}

/** Only call for platform payments; connected customer-order payments are separate. */
export async function reconcileCreditRefundFromStripe(service: ServiceClient, paymentIntentId: string) {
  const intent = await stripeRequest<{ id: string; amount: number; metadata?: Record<string, string> }>(
    `payment_intents/${encodeURIComponent(paymentIntentId)}`,
  );
  if (intent.metadata?.billing_flow !== "credit_pack" ||
      !normalizeCreditPackCode(intent.metadata?.pack_code)) return null;

  let refundedCents = 0;
  let cursor: string | undefined;
  for (;;) {
    const query = new URLSearchParams({ payment_intent: paymentIntentId, limit: "100" });
    if (cursor) query.set("starting_after", cursor);
    const page = await stripeRequest<{ data: Array<{ id: string; amount: number; status: string }>; has_more: boolean }>("refunds", { query });
    refundedCents += page.data.filter((refund) => refund.status === "succeeded")
      .reduce((sum, refund) => sum + refund.amount, 0);
    if (!page.has_more) break;
    const nextCursor = page.data.at(-1)?.id;
    if (!nextCursor || nextCursor === cursor) throw new Error("Credit refund pagination did not advance.");
    cursor = nextCursor;
  }
  if (!refundedCents) return null;
  return handleCreditChargeRefunded(service, {
    id: paymentIntentId,
    amount: intent.amount,
    amount_refunded: refundedCents,
    payment_intent: paymentIntentId,
    metadata: intent.metadata,
  });
}

export async function finalizePaidOrder(
  service: ServiceClient,
  input: {
    orderId: string;
    checkoutSessionId?: string | null;
    paymentIntentId?: string | null;
    paymentStatus?: string | null;
    note: string;
    paidAt?: string | null;
  },
) {
  const { data: order, error: orderError } = await service
    .from("orders")
    .select(
      "id,package_name,status,notes,photographer_id,paid_at,payment_status,stripe_checkout_session_id,stripe_payment_intent_id,counted_for_monthly_usage,monthly_usage_billing_period",
    )
    .eq("id", input.orderId)
    .maybeSingle();

  if (orderError) throw orderError;
  if (!order) return null;

  const currentStatus = (order.status ?? "").toLowerCase();
  if (["refunded", "refund_pending", "cancelled", "canceled", "cancel_pending"].includes(currentStatus) ||
      (order.paid_at && ["paid", "succeeded", "no_payment_required", "partially_refunded", "refunded"].includes((order.payment_status ?? "").toLowerCase()))) {
    const references: Record<string, string> = {};
    if (!order.stripe_checkout_session_id && input.checkoutSessionId) references.stripe_checkout_session_id = input.checkoutSessionId;
    if (!order.stripe_payment_intent_id && input.paymentIntentId) references.stripe_payment_intent_id = input.paymentIntentId;
    if (Object.keys(references).length) {
      const { error } = await service.from("orders").update(references).eq("id", order.id);
      if (error) throw error;
    }
    return order;
  }

  const isDigital = (order.package_name ?? "").toLowerCase().includes("digital");
  const nextStatus = isDigital ? "digital_paid" : "paid";
  const mergedNotes = await appendOrderNote(order.notes ?? null, input.note);
  const paidAt = input.paidAt || new Date().toISOString();

  const { error: updateError } = await service
    .from("orders")
    .update({
      status: nextStatus,
      payment_status: (input.paymentStatus ?? "paid").toLowerCase(),
      paid_at: paidAt,
      ...(input.checkoutSessionId ? { stripe_checkout_session_id: input.checkoutSessionId } : {}),
      ...(input.paymentIntentId ? { stripe_payment_intent_id: input.paymentIntentId } : {}),
      notes: mergedNotes,
      seen_by_photographer: false,
    })
    .eq("id", input.orderId);

  if (updateError) throw updateError;

  const { data: photographer, error: photographerError } = await service
    .from("photographers")
    .select(
      "id,user_id,business_name,brand_color,watermark_enabled,watermark_logo_url,studio_address,studio_phone,stripe_account_id,stripe_connected_account_id,stripe_connect_onboarding_complete,stripe_connect_charges_enabled,stripe_connect_payouts_enabled,stripe_platform_customer_id,stripe_subscription_id,stripe_subscription_item_base_id,stripe_subscription_item_extra_keys_id,stripe_subscription_item_usage_id,subscription_plan_code,subscription_billing_interval,subscription_status,subscription_current_period_start,subscription_current_period_end,billing_email,billing_currency,order_usage_rate_cents,extra_desktop_keys,studio_id,studio_email,logo_url,is_platform_admin,trial_starts_at,trial_ends_at",
    )
    .eq("id", order.photographer_id)
    .maybeSingle();

  if (photographerError) throw photographerError;
  if (photographer && !creditMaintenanceActive()) {
    // Payment is already committed. A platform fee outage must not prevent the
    // customer receipt/photographer notification. The uncounted paid order stays
    // available to billing reconciliation after maintenance or provider recovery.
    try { await syncOutstandingStudioUsage(service, photographer as PhotographerBillingRow); }
    catch (error) { console.error("[order-usage] paid order fee sync will retry", error); }
  }

  // --- Send order notification email to photographer ---
  try {
    if (photographer && resendConfigured()) {
      const recipientEmail = clean(
        (photographer as Record<string, unknown>).billing_email as string
      ) || clean(
        (photographer as Record<string, unknown>).studio_email as string
      );

      // Fetch order items
      const { data: itemRows } = await service
        .from("order_items")
        .select("product_name,quantity,unit_price_cents,line_total_cents,sku")
        .eq("order_id", input.orderId);

      // Fetch context (project title, school name, student name)
      const fullOrder = await service
        .from("orders")
        .select(`
            id,package_name,total_cents,total_amount,subtotal_cents,tax_cents,currency,
            parent_name,parent_email,customer_email,special_notes,created_at,paid_at,status,
            school_id,project_id,student_id,
            project:projects(title,access_pin),
            school:schools(school_name),
            student:students(first_name,last_name,pin)
          `)
        .eq("id", input.orderId)
        .maybeSingle();

      const project = Array.isArray(fullOrder.data?.project)
        ? fullOrder.data.project[0]
        : fullOrder.data?.project;
      const school = Array.isArray(fullOrder.data?.school)
        ? fullOrder.data.school[0]
        : fullOrder.data?.school;
      const student = Array.isArray(fullOrder.data?.student)
        ? fullOrder.data.student[0]
        : fullOrder.data?.student;

      const studentName = [
        clean((student as Record<string, unknown>)?.first_name as string),
        clean((student as Record<string, unknown>)?.last_name as string),
      ].filter(Boolean).join(" ") || null;

      if (recipientEmail) {
        const email = buildOrderNotificationEmail({
          order: fullOrder.data ?? {
            ...order,
            paid_at: paidAt,
            status: nextStatus,
          },
          items: (itemRows ?? []) as Array<{
            product_name?: string | null;
            quantity?: number | null;
            unit_price_cents?: number | null;
            line_total_cents?: number | null;
            sku?: string | null;
          }>,
          photographer: {
            business_name: (photographer as Record<string, unknown>).business_name as string,
            studio_email: (photographer as Record<string, unknown>).studio_email as string,
            billing_email: (photographer as Record<string, unknown>).billing_email as string,
            logo_url: (photographer as Record<string, unknown>).logo_url as string,
          },
          context: {
            project_title: (project as Record<string, unknown>)?.title as string ?? null,
            school_name: (school as Record<string, unknown>)?.school_name as string ?? null,
            student_name: studentName,
          },
          dashboardUrl: `https://www.studiooscloud.com/dashboard/orders`,
        });

        try {
          await sendResendEmail({
            to: recipientEmail,
            subject: email.subject,
            html: email.html,
            text: email.text,
            fromName: "Studio OS Cloud",
            replyTo: resolveReplyTo(recipientEmail),
            tags: [{ name: "type", value: "order-notification" }],
            idempotencyKey: `order-notify-${input.orderId}`,
          });
        } catch (notificationEmailError) {
          console.error(
            "[order-notification] Photographer email failed:",
            notificationEmailError,
          );
        }
      }

      // 2026-04-25: Parent-facing receipt email.  Sent to the buyer's
      // email address (parent_email / customer_email) with order number,
      // line items + thumbnails, sizes, totals — acts as proof of purchase.
      const buyerEmailAddress = clean(
        (fullOrder.data as Record<string, unknown> | null)?.customer_email as string,
      ) ||
        clean(
          (fullOrder.data as Record<string, unknown> | null)?.parent_email as string,
        );
      if (buyerEmailAddress) {
        const studentFullName = [
          clean((student as Record<string, unknown> | null)?.first_name as string),
          clean((student as Record<string, unknown> | null)?.last_name as string),
        ].filter(Boolean).join(" ") || null;

          // Build a deep-link to the parent's Orders tab in the portal.
          // School mode: PIN comes from students.pin (per-student gate).
          // Event mode: PIN comes from projects.access_pin (project gate).
          let ordersHistoryUrl: string | null = null;
          const studentPin = clean(
            (student as Record<string, unknown> | null)?.pin as string,
          );
          const projectPin = clean(
            (project as Record<string, unknown> | null)?.access_pin as string,
          );
          const projectId = clean(
            (fullOrder.data as Record<string, unknown> | null)?.project_id as string,
          );
          if (studentPin) {
            const params = new URLSearchParams({
              email: buyerEmailAddress,
              tab: "orders",
            });
            ordersHistoryUrl = `https://www.studiooscloud.com/parents/${encodeURIComponent(studentPin)}?${params.toString()}`;
          } else if (projectPin && projectId) {
            const params = new URLSearchParams({
              mode: "event",
              project: projectId,
              email: buyerEmailAddress,
              tab: "orders",
            });
            ordersHistoryUrl = `https://www.studiooscloud.com/parents/${encodeURIComponent(projectPin)}?${params.toString()}`;
          }

          const receiptEmail = buildOrderReceiptEmail({
            order: fullOrder.data ?? {
              ...order,
              paid_at: paidAt,
              status: nextStatus,
            },
            items: (itemRows ?? []) as Array<{
              product_name?: string | null;
              quantity?: number | null;
              unit_price_cents?: number | null;
              line_total_cents?: number | null;
              sku?: string | null;
            }>,
            photographer: {
              business_name: (photographer as Record<string, unknown>).business_name as string,
              studio_email: (photographer as Record<string, unknown>).studio_email as string,
              studio_phone: (photographer as Record<string, unknown>).studio_phone as string,
              studio_address: (photographer as Record<string, unknown>).studio_address as string,
              logo_url: (photographer as Record<string, unknown>).logo_url as string,
            },
            context: {
              project_title: (project as Record<string, unknown>)?.title as string ?? null,
              school_name: (school as Record<string, unknown>)?.school_name as string ?? null,
              student_name: studentFullName,
            },
            ordersHistoryUrl,
          });

          try {
            await sendResendEmail({
              to: buyerEmailAddress,
              subject: receiptEmail.subject,
              html: receiptEmail.html,
              text: receiptEmail.text,
              fromName: clean(
                (photographer as Record<string, unknown>).business_name as string,
              ) || "Studio OS Cloud",
              replyTo: clean(
                (photographer as Record<string, unknown>).studio_email as string,
              ) || resolveReplyTo(buyerEmailAddress),
              tags: [{ name: "type", value: "order-receipt" }],
              idempotencyKey: `order-receipt-${input.orderId}`,
            });
          } catch (receiptEmailError) {
            console.error("[order-notification] Buyer receipt failed:", receiptEmailError);
          }

          // Alert the photographer's iPhone(s) that a new order came in. Generic
          // "New order received" banner unless they opted into showing details.
          try {
            const orderForPush = (fullOrder.data ?? order) as Record<string, unknown>;
            const photographerId = clean(
              (photographer as Record<string, unknown>).id as string,
            );
            const customerName =
              clean(orderForPush.parent_name as string) ||
              clean(orderForPush.customer_name as string) ||
              studentFullName;
            const totalCents =
              Number(orderForPush.total_cents) ||
              Math.round(Number(orderForPush.total_amount ?? 0) * 100) ||
              0;
            const currency =
              (clean(orderForPush.currency as string) || "cad").toUpperCase();
            const amountLabel =
              totalCents > 0
                ? new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency,
                  }).format(totalCents / 100)
                : "";
            await sendNewOrderPush(service, photographerId, {
              customerName,
              amountLabel,
            });
          } catch (pushError) {
            console.error("[order-notification] push failed:", pushError);
          }

          const hasDigitalDeliveryItem =
            nextStatus === "digital_paid" ||
            ((itemRows ?? []) as Array<{ product_name?: string | null }>).some((item) => {
              const name = (item.product_name ?? "").toLowerCase();
              if (name.includes("retouch")) return false;
              return (
                name.includes("digital") ||
                name.includes("download") ||
                name.includes("file") ||
                name.includes("jpg") ||
                name.includes("jpeg") ||
                name.includes("png") ||
                name.includes("usb")
              );
            });

          if (hasDigitalDeliveryItem) {
            try {
              const { sendDigitalDeliveryEmailForOrder } = await import("@/lib/digital-delivery");
              await sendDigitalDeliveryEmailForOrder(service, input.orderId, {
                recipientEmail: buyerEmailAddress,
                force: false,
              });
            } catch (digitalDeliveryError) {
              console.error(
                "[digital-delivery] Failed to send buyer ZIP link:",
                digitalDeliveryError,
              );
            }
          }
        }
    }
  } catch (emailError) {
    // Never let email failure break the payment flow
    console.error("[order-notification] Failed to send email:", emailError);
  }

  return {
    ...order,
    status: nextStatus,
    payment_status: (input.paymentStatus ?? "paid").toLowerCase(),
    paid_at: paidAt,
  };
}

export async function markOrderPaymentFailure(
  service: ServiceClient,
  input: {
    paymentIntentId?: string | null;
    orderId?: string | null;
    note: string;
  },
) {
  let query = service
    .from("orders")
    .select("id,notes")
    .limit(1);

  if (input.paymentIntentId) {
    query = query.eq("stripe_payment_intent_id", input.paymentIntentId);
  } else if (input.orderId) {
    query = query.eq("id", input.orderId);
  } else {
    return null;
  }

  const { data: order, error } = await query.maybeSingle();
  if (error) throw error;
  if (!order) return null;

  const mergedNotes = await appendOrderNote(order.notes ?? null, input.note);

  const { error: updateError } = await service
    .from("orders")
    .update({
      payment_status: "failed",
      notes: mergedNotes,
    })
    .eq("id", order.id).is("paid_at", null).not("status", "in", "(cancelled,canceled,refunded,refund_pending)");

  if (updateError) throw updateError;
  return order.id;
}

export type MarkOrderRefundedResult = {
  orderId: string;
  photographerId: string | null;
  fullyRefunded: boolean;
  partial: boolean;
  before: {
    status: string | null;
    payment_status: string | null;
    refund_status: string | null;
    refund_amount_cents: number | null;
  };
  after: {
    status: string | null;
    payment_status: string;
    refund_status: string;
    refund_amount_cents: number;
    refunded_at: string;
  };
};

export async function markOrderRefunded(
  service: ServiceClient,
  input: {
    paymentIntentId?: string | null;
    orderId?: string | null;
    partial: boolean;
    note: string;
    /** Total dollars refunded across all refund events for this order (cents). */
    refundAmountCents?: number | null;
  },
): Promise<MarkOrderRefundedResult | null> {
  let query = service
    .from("orders")
    .select(
      "id,notes,photographer_id,status,payment_status,refund_status,refund_amount_cents,platform_fee_collection_method",
    )
    .limit(1);

  if (input.paymentIntentId) {
    query = query.eq("stripe_payment_intent_id", input.paymentIntentId);
  } else if (input.orderId) {
    query = query.eq("id", input.orderId);
  } else {
    return null;
  }

  const { data: order, error } = await query.maybeSingle();
  if (error) throw error;
  if (!order) return null;

  const mergedNotes = await appendOrderNote(order.notes ?? null, input.note);

  const refundedAt = new Date().toISOString();
  const fullyRefunded = !input.partial || order.refund_status === "refunded";
  const nextPaymentStatus = fullyRefunded ? "refunded" : "partially_refunded";
  const nextRefundStatus = fullyRefunded ? "refunded" : "partially_refunded";
  // On a full refund, flip the order status so the Flutter print queue and the
  // dashboard "new orders" view drop the row.  On a partial refund, leave the
  // status alone — the photographer may still need to fulfill part of it.
  const nextStatus = fullyRefunded ? "refunded" : (order.status ?? null);
  const nextRefundAmountCents = Math.max(
    Number(input.refundAmountCents ?? 0) || 0,
    Number(order.refund_amount_cents ?? 0) || 0,
  );

  const { error: updateError } = await service
    .from("orders")
    .update({
      status: nextStatus,
      payment_status: nextPaymentStatus,
      refund_status: nextRefundStatus,
      refund_amount_cents: nextRefundAmountCents,
      refunded_at: refundedAt,
      seen_by_photographer: false,
      notes: mergedNotes,
    })
    .eq("id", order.id);

  if (updateError) throw updateError;

  if (fullyRefunded && order.photographer_id && order.platform_fee_collection_method == null) {
    // The database trigger durably queues this waiver. Customer refunds remain
    // successful during a platform billing outage; the daily worker retries it.
    try { await reconcileOrderUsageFeeRefunds(service, order.photographer_id as string, stripeRequest); }
    catch (error) { console.error("[order-usage] queued service-fee waiver will retry", error); }
  }

  return {
    orderId: order.id as string,
    photographerId: (order.photographer_id as string | null) ?? null,
    fullyRefunded,
    partial: input.partial,
    before: {
      status: (order.status as string | null) ?? null,
      payment_status: (order.payment_status as string | null) ?? null,
      refund_status: (order.refund_status as string | null) ?? null,
      refund_amount_cents:
        (order.refund_amount_cents as number | null) ?? null,
    },
    after: {
      status: nextStatus,
      payment_status: nextPaymentStatus,
      refund_status: nextRefundStatus,
      refund_amount_cents: nextRefundAmountCents,
      refunded_at: refundedAt,
    },
  };
}

export async function retrieveCheckoutSession(
  sessionId: string,
  account?: string | null,
) {
  return stripeRequest<StripeCheckoutSession>(`checkout/sessions/${sessionId}`, {
    account: account ?? undefined,
  });
}

export async function retrievePaymentIntent(
  paymentIntentId: string,
  account?: string | null,
) {
  return stripeRequest<StripePaymentIntent>(`payment_intents/${paymentIntentId}`, {
    account: account ?? undefined,
  });
}

export type DirectOrderPlatformFee = {
  collectionMethod: "connect_application_fee" | "waived";
  amountCents: number;
  currency: string;
  snapshotKey: string;
  billableOrderCount: number;
  rateCents: number;
};

// The studio currency selector supports these Stripe two-decimal currencies.
// A nominal 40-cent fee must not become 40 whole units in a zero-decimal currency.
export const DIRECT_ORDER_FEE_CURRENCIES = SUPPORTED_ORDER_CURRENCIES;
const directOrderFeeCurrencies = new Set<string>(DIRECT_ORDER_FEE_CURRENCIES);

/** Quote new checkout fees from trusted persisted orders and the studio plan. */
export async function quoteDirectOrderPlatformFees(input: {
  planCode: string | null;
  subscriptionStatus: string | null;
  isPlatformAdmin: boolean;
  freeTrialActive?: boolean;
  currency: string;
  orders: Array<{ id: string; totalCents: number; isTest?: boolean | null }>;
}) {
  const currency = input.currency.trim().toLowerCase();
  if (!directOrderFeeCurrencies.has(currency)) throw new Error("This checkout currency does not support the configured order service fee.");
  if (!input.orders.length ||
      new Set(input.orders.map((order) => order.id)).size !== input.orders.length ||
      input.orders.some((order) => !order.id || !Number.isSafeInteger(order.totalCents) || order.totalCents < 0)) {
    throw new Error("Could not verify the order service fee.");
  }
  const planCode = input.freeTrialActive ? "studio" : normalizePlanCode(input.planCode);
  if (!input.isPlatformAdmin && (!planCode || (!isStripeBillingActive(input.subscriptionStatus) && !input.freeTrialActive))) {
    throw new Error("This studio needs an active subscription before accepting payment.");
  }
  const billableOrders = input.orders.filter((order) => !input.isPlatformAdmin && order.isTest !== true && order.totalCents > 0);
  const rateCents = billableOrders.length && planCode ? PLAN_DEFS[planCode].usageRateCents : 0;
  if (!Number.isSafeInteger(rateCents) || rateCents < 0) throw new Error("Could not verify the order service fee.");
  const amountCents = rateCents * billableOrders.length;
  const totalCents = input.orders.reduce((sum, order) => sum + order.totalCents, 0);
  if (!Number.isSafeInteger(amountCents) || !Number.isSafeInteger(totalCents) || amountCents > totalCents) {
    throw new Error("This order total is too small for its service fee.");
  }
  const billableIds = new Set(billableOrders.map((order) => order.id));
  return {
    collectionMethod: amountCents > 0 ? "connect_application_fee" as const : "waived" as const,
    amountCents, currency, rateCents,
    billableOrderCount: amountCents > 0 ? billableOrders.length : 0,
    orders: input.orders.map((order) => ({
      id: order.id,
      collectionMethod: billableIds.has(order.id) && rateCents > 0 ? "connect_application_fee" as const : "waived" as const,
      amountCents: billableIds.has(order.id) ? rateCents : 0,
    })),
  };
}

export type DirectOrderFeeSnapshotRow = {
  id: string;
  order_group_id?: string | null;
  photographer_id?: string | null;
  total_cents?: number | null;
  currency?: string | null;
  platform_fee_collection_method: string | null;
  platform_fee_amount_cents: number | null;
  platform_fee_currency: string | null;
  platform_fee_rate_cents: number | null;
  stripe_application_fee_id?: string | null;
  stripe_payment_intent_id?: string | null;
};

function canonicalDirectOrderFeeRows(rows: DirectOrderFeeSnapshotRow[]) {
  if (!rows.length || new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error("The saved order service-fee snapshot is incomplete.");
  return rows.map((row) => {
    if (!row.id || !["connect_application_fee", "waived"].includes(row.platform_fee_collection_method ?? "") ||
        !Number.isSafeInteger(row.platform_fee_amount_cents) || Number(row.platform_fee_amount_cents) < 0 ||
        !Number.isSafeInteger(row.platform_fee_rate_cents) || Number(row.platform_fee_rate_cents) < 0 ||
        !directOrderFeeCurrencies.has(row.platform_fee_currency ?? "")) {
      throw new Error("The saved order service-fee snapshot could not be verified.");
    }
    const normalized = {
      id: row.id,
      platform_fee_collection_method: row.platform_fee_collection_method!,
      platform_fee_amount_cents: row.platform_fee_amount_cents!,
      platform_fee_currency: row.platform_fee_currency!,
      platform_fee_rate_cents: row.platform_fee_rate_cents!,
    };
    if ((normalized.platform_fee_collection_method === "waived" && normalized.platform_fee_amount_cents !== 0) ||
        (normalized.platform_fee_collection_method === "connect_application_fee" && (normalized.platform_fee_amount_cents <= 0 || normalized.platform_fee_rate_cents <= 0 ||
          normalized.platform_fee_rate_cents !== normalized.platform_fee_amount_cents))) {
      throw new Error("The saved order service fee does not match its frozen rate.");
    }
    return normalized;
  }).sort((a, b) => a.id.localeCompare(b.id));
}

export function directOrderPlatformFeeSnapshotKey(rows: DirectOrderFeeSnapshotRow[]) {
  return createHash("sha256").update(JSON.stringify(canonicalDirectOrderFeeRows(rows))).digest("hex");
}

export function directOrderPlatformFeePayload(rows: DirectOrderFeeSnapshotRow[], rawCurrency: string): DirectOrderPlatformFee {
  const currency = rawCurrency.trim().toLowerCase();
  const saved = canonicalDirectOrderFeeRows(rows);
  const first = saved[0];
  if (!directOrderFeeCurrencies.has(currency) || saved.some((row) => row.platform_fee_currency !== currency ||
      row.platform_fee_rate_cents !== first.platform_fee_rate_cents)) {
    throw new Error("The combined order service-fee snapshots do not agree.");
  }
  const amountCents = saved.reduce((sum, row) => sum + row.platform_fee_amount_cents, 0);
  if (!Number.isSafeInteger(amountCents)) throw new Error("The combined order service-fee amount could not be verified.");
  return {
    collectionMethod: amountCents > 0 ? "connect_application_fee" : "waived",
    amountCents, currency, rateCents: first.platform_fee_rate_cents,
    billableOrderCount: saved.filter((row) => row.platform_fee_collection_method === "connect_application_fee").length,
    snapshotKey: createHash("sha256").update(JSON.stringify(saved)).digest("hex"),
  };
}

export function directOrderPlatformFeeMetadata(fee: DirectOrderPlatformFee): Record<string, string> {
  return {
    platform_fee_collection_method: fee.collectionMethod,
    platform_fee_amount_cents: String(fee.amountCents),
    platform_fee_currency: fee.currency.toLowerCase(),
    platform_fee_snapshot_key: fee.snapshotKey,
    platform_fee_billable_order_count: String(fee.billableOrderCount),
    platform_fee_rate_cents: String(fee.rateCents),
  };
}

export async function createDirectOrderCheckoutSession(input: {
  accountId: string;
  orderId: string;
  photographerId: string;
  schoolId?: string | null;
  projectId?: string | null;
  studentId?: string | null;
  customerEmail?: string | null;
  currency: string;
  totalCents: number;
  productName: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  /**
   * When this checkout represents a combined sibling/cross-year order, this
   * carries the shared group id so the webhook can fan out the "paid" status
   * to every member order. Single-order checkouts leave it null/undefined.
   */
  orderGroupId?: string | null;
  previousExpiredSessionId?: string | null;
  /** Frozen in the database before creating this session; omit for legacy checkout retries. */
  platformFee?: DirectOrderPlatformFee;
}) {
  const fee = input.platformFee;
  if (fee && (!input.accountId.startsWith("acct_") || !Number.isSafeInteger(input.totalCents) || input.totalCents <= 0 ||
      !Number.isSafeInteger(fee.amountCents) || fee.amountCents < 0 ||
      fee.currency.toLowerCase() !== input.currency.toLowerCase() ||
      !fee.snapshotKey.trim() || fee.snapshotKey.length > 500 ||
      !Number.isSafeInteger(fee.billableOrderCount) || fee.billableOrderCount < 0 ||
      !Number.isSafeInteger(fee.rateCents) || fee.rateCents < 0 || !directOrderFeeCurrencies.has(fee.currency.toLowerCase()) ||
      (fee.collectionMethod === "connect_application_fee" && (fee.amountCents <= 0 || fee.amountCents > input.totalCents || fee.billableOrderCount <= 0)) ||
      (fee.collectionMethod === "waived" && (fee.amountCents !== 0 || fee.billableOrderCount !== 0)) ||
      !["connect_application_fee", "waived"].includes(fee.collectionMethod))) {
    throw new Error("Could not verify the saved order service fee. No payment was created.");
  }
  if (fee && fee.collectionMethod === "connect_application_fee" && (fee.rateCents <= 0 || fee.rateCents * fee.billableOrderCount !== fee.amountCents)) {
    throw new Error("The saved service fee does not match its frozen rate. No payment was created.");
  }
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("success_url", input.successUrl);
  params.set("cancel_url", input.cancelUrl);
  params.set("client_reference_id", input.orderId);
  params.set("submit_type", "pay");
  params.set("payment_method_types[0]", "card");
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", input.currency);
  params.set("line_items[0][price_data][unit_amount]", String(input.totalCents));
  params.set("line_items[0][price_data][product_data][name]", input.productName);
  params.set("line_items[0][price_data][product_data][description]", input.description);
  params.set("metadata[billing_flow]", "customer_order");
  params.set("metadata[order_id]", input.orderId);
  params.set("metadata[photographer_id]", input.photographerId);
  if (input.schoolId) params.set("metadata[school_id]", input.schoolId);
  if (input.projectId) params.set("metadata[project_id]", input.projectId);
  if (input.studentId) params.set("metadata[student_id]", input.studentId);
  if (input.customerEmail) params.set("customer_email", input.customerEmail);
  params.set("payment_intent_data[metadata][billing_flow]", "customer_order");
  params.set("payment_intent_data[metadata][order_id]", input.orderId);
  params.set("payment_intent_data[metadata][photographer_id]", input.photographerId);
  if (fee) {
    if (fee.collectionMethod === "connect_application_fee") {
      params.set("payment_intent_data[application_fee_amount]", String(fee.amountCents));
    }
    const feeMetadata = directOrderPlatformFeeMetadata(fee);
    for (const [key, value] of Object.entries(feeMetadata)) {
      params.set(`metadata[${key}]`, value);
      params.set(`payment_intent_data[metadata][${key}]`, value);
    }
  }
  if (input.schoolId) params.set("payment_intent_data[metadata][school_id]", input.schoolId);
  if (input.projectId) params.set("payment_intent_data[metadata][project_id]", input.projectId);
  if (input.studentId) params.set("payment_intent_data[metadata][student_id]", input.studentId);
  // Combined-order grouping: when present, the webhook can flip every order
  // in the group to paid in one shot.  The `order_id` above is just the
  // primary (first) order in the group; downstream lookups will fan out.
  if (input.orderGroupId) {
    params.set("metadata[order_group_id]", input.orderGroupId);
    params.set("payment_intent_data[metadata][order_group_id]", input.orderGroupId);
  }

  return stripeRequest<StripeCheckoutSession>("checkout/sessions", {
    method: "POST",
    body: params,
    account: input.accountId,
    idempotencyKey: orderCheckoutIdempotencyKey(input.orderId, input.previousExpiredSessionId),
  });
}

export async function getUsageSummaryForCurrentPeriod(
  service: ServiceClient,
  photographer: PhotographerBillingRow,
) {
  const planCode = normalizePlanCode(photographer.subscription_plan_code);
  let periodStart = photographer.subscription_current_period_start;
  let periodEnd = photographer.subscription_current_period_end;
  if (photographer.stripe_subscription_id && photographer.stripe_subscription_item_usage_id) {
    const subscription = await retrieveStripeSubscription(photographer.stripe_subscription_id);
    const period = resolveStripeBillingPeriod(subscription, findSubscriptionItems(subscription).usageItem);
    periodStart = period.start;
    periodEnd = period.end;
  }
  const billingPeriodKey = toBillingPeriodKey(
    periodStart,
    periodEnd,
  );
  const readFeeAttention = async () => {
    // A prior-period pending credit or uncertain fee must remain visible after
    // renewal or subscription cancellation, without counting its charge again.
    const outstanding = await readAllBillingRows((from, to) => service.from("order_usage_fees").select("order_id,report_status,refund_status,refund_strategy")
      .eq("photographer_id", photographer.id)
      .or("report_status.eq.review_required,refund_status.in.(pending,processing,review_required),and(refund_status.eq.completed,refund_strategy.eq.cancel_meter_event)")
      .order("order_id", { ascending: true }).range(from, to)) as Array<{
        report_status: string; refund_status: string; refund_strategy: string | null;
      }>;
    return {
      pendingFeeWaivers: outstanding.filter((fee) => ["pending", "processing"].includes(fee.refund_status)).length,
      feeReviewRequired: outstanding.filter((fee) => fee.report_status === "review_required" || fee.refund_status === "review_required" ||
        (fee.refund_status === "completed" && fee.refund_strategy === "cancel_meter_event")).length,
    };
  };

  if (
    !planCode ||
    !periodStart ||
    !periodEnd ||
    !billingPeriodKey
  ) {
    return {
      countedOrders: 0,
      billableOrders: 0,
      unreportedOrders: 0,
      estimatedChargeCents: 0,
      refundCreditCents: 0,
      ...await readFeeAttention(),
      billingPeriodKey: null,
    };
  }

  const data = await readAllBillingRows((from, to) => service
    .from("orders")
    .select("id,total_cents,counted_for_monthly_usage,is_test,refund_status")
    .eq("photographer_id", photographer.id)
    .in("payment_status", ["paid", "succeeded", "partially_refunded"])
    .gte("paid_at", periodStart)
    .lt("paid_at", periodEnd)
    .or("is_test.is.false,is_test.is.null")
    .is("platform_fee_collection_method", null)
    .order("id", { ascending: true }).range(from, to));

  const rows =
    ((data as Array<{
      id: string;
      total_cents: number | null;
      counted_for_monthly_usage: boolean | null;
      is_test: boolean | null;
      refund_status: string | null;
    }> | null) ?? []).filter((row) => {
      const refundStatus = (row.refund_status ?? "").toLowerCase();
      return refundStatus !== "refunded" && Number(row.total_cents ?? 0) > 0;
    });

  const [feeData, creditData, feeAttention] = await Promise.all([
    readAllBillingRows((from, to) => service.from("order_usage_fees").select("order_id,amount_cents,report_status,refund_status,refund_strategy")
      .eq("photographer_id", photographer.id).gte("usage_timestamp", Math.floor(Date.parse(periodStart) / 1000))
      .lt("usage_timestamp", Math.floor(Date.parse(periodEnd) / 1000))
      .order("order_id", { ascending: true }).range(from, to)),
    readAllBillingRows((from, to) => service.from("order_usage_fees").select("amount_cents")
      .eq("photographer_id", photographer.id).eq("refund_status", "completed").eq("refund_strategy", "invoice_credit")
      .gte("refund_completed_at", periodStart).lt("refund_completed_at", periodEnd)
      .order("order_id", { ascending: true }).range(from, to)),
    readFeeAttention(),
  ]);
  const fees = feeData as Array<{
    order_id: string; amount_cents: number; report_status: string; refund_status: string; refund_strategy: string | null;
  }>;
  const feeByOrder = new Map(fees.map((fee) => [fee.order_id, fee]));
  const liveRate = photographer.order_usage_rate_cents ?? PLAN_DEFS[planCode].usageRateCents;
  // Reported fees remain charges. An older accepted meter cancellation did not
  // prove that a finalized invoice was corrected; show those records for review.
  const reportedChargeCents = fees.reduce((total, fee) => total + (
    fee.report_status === "reported" ? fee.amount_cents : 0
  ), 0);
  const unreportedOrLegacyChargeCents = rows.reduce((total, row) => {
    const fee = feeByOrder.get(row.id);
    if (!fee) return total + liveRate;
    return total + (["pending", "processing", "review_required"].includes(fee.report_status) ? fee.amount_cents : 0);
  }, 0);
  const refundCreditCents = (creditData as Array<{ amount_cents: number }>).reduce((total, fee) => total + fee.amount_cents, 0);
  const billableOrders = rows.length;
  const countedOrders = rows.filter((row) => row.counted_for_monthly_usage === true).length;
  const unreportedOrders = Math.max(0, billableOrders - countedOrders);

  return {
    countedOrders,
    billableOrders,
    unreportedOrders,
    // Queueing time does not establish which invoice receives a pending item.
    // Show gross usage and separately disclose credits queued this cycle.
    estimatedChargeCents: reportedChargeCents + unreportedOrLegacyChargeCents,
    refundCreditCents,
    ...feeAttention,
    billingPeriodKey,
  };
}

export function billingReturnUrl(origin: string, marker: string) {
  const url = new URL("/dashboard/settings", origin);
  url.searchParams.set("billing", marker);
  return url.toString();
}

export function connectReturnUrl(origin: string, marker: string) {
  const url = new URL("/dashboard/settings", origin);
  url.searchParams.set("stripe", marker);
  return url.toString();
}

/**
 * Retrieve the default payment method for a Stripe platform customer.
 * Returns { brand, last4, expMonth, expYear } for cards, or null if none.
 */
export async function getDefaultPaymentMethod(
  customerId: string,
): Promise<{ brand: string; last4: string; expMonth: number; expYear: number } | null> {
  try {
    const customer = await stripeRequest<{
      invoice_settings?: { default_payment_method?: string | null };
      default_source?: string | null;
    }>(`customers/${customerId}`);

    const pmId = customer.invoice_settings?.default_payment_method ?? customer.default_source;
    if (!pmId || typeof pmId !== "string") return null;

    // Try as a PaymentMethod first (pm_…)
    if (pmId.startsWith("pm_")) {
      const pm = await stripeRequest<{
        card?: { brand: string; last4: string; exp_month: number; exp_year: number };
      }>(`payment_methods/${pmId}`);
      if (pm.card) {
        return { brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year };
      }
    }

    // Fallback: retrieve as a Source/Card (card_… or src_…)
    const card = await stripeRequest<{
      brand?: string; last4?: string; exp_month?: number; exp_year?: number;
      card?: { brand: string; last4: string; exp_month: number; exp_year: number };
    }>(`customers/${customerId}/sources/${pmId}`);

    if (card.last4) {
      return { brand: card.brand || "card", last4: card.last4, expMonth: card.exp_month || 0, expYear: card.exp_year || 0 };
    }
    if (card.card?.last4) {
      return { brand: card.card.brand, last4: card.card.last4, expMonth: card.card.exp_month, expYear: card.card.exp_year };
    }

    return null;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Group-aware webhook helpers
// ──────────────────────────────────────────────────────────────────────────
//
// A combined sibling / cross-year checkout creates N orders that share one
// `order_group_id`. Stripe metadata carries the FIRST order's id (so
// pre-existing single-order webhook code paths still work), plus the
// `order_group_id` so we can fan out the paid/refunded/failed event to
// every member of the group.
//
// These three wrappers each:
//   1. Look up the order referenced by `orderId` (or by `paymentIntentId`).
//   2. Read its `order_group_id`.
//   3. If non-null, fetch every sibling order's id and apply the per-order
//      function to all of them. Otherwise, just apply it once.
//
// Failures of individual member updates do NOT abort the group — we collect
// errors and re-throw the first one only after every member has been
// attempted, so a single transient failure can be retried by Stripe without
// leaving half a group stuck. (Stripe retries the same webhook, and our
// per-order finalizer is idempotent.)

async function expandOrderIdsForGroup(
  service: ServiceClient,
  args: { orderId?: string | null; paymentIntentId?: string | null },
): Promise<string[]> {
  // Resolve the seed order from either the orderId metadata or the payment
  // intent id (refund flows often only have the latter).
  let seedOrderId: string | null = null;
  let groupId: string | null = null;

  if (args.orderId) {
    const { data, error } = await service
      .from("orders")
      .select("id, order_group_id")
      .eq("id", args.orderId)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      seedOrderId = data.id as string;
      groupId = (data.order_group_id as string | null) ?? null;
    }
  } else if (args.paymentIntentId) {
    const { data, error } = await service
      .from("orders")
      .select("id, order_group_id")
      .eq("stripe_payment_intent_id", args.paymentIntentId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      seedOrderId = data.id as string;
      groupId = (data.order_group_id as string | null) ?? null;
    }
  }

  if (!seedOrderId) return [];
  if (!groupId) return [seedOrderId];

  // Fan out to every member of the group.
  const { data: groupMembers, error: groupError, count: groupCount } = await service
    .from("orders")
    .select("id", { count: "exact" })
    .eq("order_group_id", groupId);
  if (groupError) throw groupError;
  const ids = (groupMembers ?? []).map((row) => row.id as string);
  if (groupCount == null || ids.length !== groupCount || !ids.includes(seedOrderId) ||
      ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new Error("The complete payment order group could not be verified. Please retry.");
  }
  return ids;
}

/** Verify the actual connected payment against the complete saved fee scope. */
export async function verifyDirectOrderPlatformFeePayment(service: ServiceClient, input: {
  orderIds: string[];
  paymentIntentId?: string | null;
}) {
  if (!input.orderIds.length || new Set(input.orderIds).size !== input.orderIds.length) throw new Error("Payment order scope could not be verified.");
  const { data, error } = await service.from("orders")
    .select("id,photographer_id,order_group_id,total_cents,currency,stripe_payment_intent_id,platform_fee_collection_method,platform_fee_amount_cents,platform_fee_currency,platform_fee_rate_cents,stripe_application_fee_id")
    .in("id", input.orderIds);
  if (error) throw error;
  const rows = (data ?? []) as DirectOrderFeeSnapshotRow[];
  if (rows.length !== input.orderIds.length || rows.some((row) => !input.orderIds.includes(row.id))) throw new Error("Payment order scope could not be verified.");
  if (rows.every((row) => row.platform_fee_collection_method == null)) return null;
  const savedPaymentIds = [...new Set(rows.map((row) => row.stripe_payment_intent_id).filter((id): id is string => Boolean(id)))];
  const paymentIntentId = input.paymentIntentId || (savedPaymentIds.length === 1 ? savedPaymentIds[0] : null);
  if (!paymentIntentId || savedPaymentIds.some((id) => id !== paymentIntentId) || !rows[0]?.photographer_id || rows.some((row) => row.photographer_id !== rows[0].photographer_id ||
      row.order_group_id !== rows[0].order_group_id || row.currency?.toLowerCase() !== rows[0].currency?.toLowerCase())) {
    throw new Error("The order service fee is waiting for a verified payment.");
  }
  const fee = directOrderPlatformFeePayload(rows, rows[0].currency || "cad");
  const { data: photographer, error: ownerError } = await service.from("photographers")
    .select("stripe_account_id,stripe_connected_account_id,is_platform_admin")
    .eq("id", rows[0].photographer_id).maybeSingle();
  if (ownerError) throw ownerError;
  const accountId = photographer ? getConnectedAccountId(photographer) : null;
  if (!accountId || (photographer?.is_platform_admin && fee.amountCents !== 0)) throw new Error("Payment account could not be verified.");
  const intent = await retrievePaymentIntent(paymentIntentId, accountId);
  const gross = rows.reduce((sum, row) => sum + Number(row.total_cents ?? 0), 0);
  const expectedMetadata = directOrderPlatformFeeMetadata(fee);
  if (!Number.isSafeInteger(gross) || gross <= 0 || rows.some((row) => !Number.isSafeInteger(row.total_cents) || Number(row.total_cents) < 0) ||
      intent.id !== paymentIntentId || intent.status !== "succeeded" || intent.amount !== gross || intent.amount_received !== gross ||
      intent.currency?.toLowerCase() !== fee.currency || intent.metadata?.billing_flow !== "customer_order" ||
      intent.metadata?.photographer_id !== rows[0].photographer_id || !rows.some((row) => row.id === intent.metadata?.order_id) ||
      (rows[0].order_group_id && intent.metadata?.order_group_id !== rows[0].order_group_id) ||
      (intent.application_fee_amount ?? 0) !== fee.amountCents ||
      Object.entries(expectedMetadata).some(([key, value]) => intent.metadata?.[key] !== value)) {
    throw new Error("The Stripe payment does not match the frozen order service fee.");
  }
  return fee;
}

/** Finalize every member of a verified combined checkout, or its single order. */
export async function finalizePaidOrderOrGroup(
  service: ServiceClient,
  input: {
    orderId: string;
    checkoutSessionId?: string | null;
    paymentIntentId?: string | null;
    paymentStatus?: string | null;
    note: string;
    paidAt?: string | null;
  },
) {
  const ids = await expandOrderIdsForGroup(service, {
    orderId: input.orderId,
    paymentIntentId: input.paymentIntentId,
  });
  if (ids.length === 0) {
    // Fall back to the single-order behavior — finalize will no-op on miss.
    return finalizePaidOrder(service, input);
  }

  // Connected merchants can alter intent metadata. Check both the immutable
  // application-fee amount and every persisted group snapshot before fulfillment.
  await verifyDirectOrderPlatformFeePayment(service, { orderIds: ids, paymentIntentId: input.paymentIntentId });

  let firstResult: Awaited<ReturnType<typeof finalizePaidOrder>> = null;
  let firstError: unknown = null;
  for (const id of ids) {
    try {
      const result = await finalizePaidOrder(service, {
        ...input,
        orderId: id,
      });
      if (id === input.orderId) firstResult = result;
    } catch (err) {
      if (!firstError) firstError = err;
    }
  }
  if (firstError) throw firstError;
  return firstResult;
}

/**
 * Group-aware wrapper around `markOrderPaymentFailure`.
 */
export async function markOrderOrGroupPaymentFailure(
  service: ServiceClient,
  input: {
    paymentIntentId?: string | null;
    orderId?: string | null;
    note: string;
  },
) {
  const ids = await expandOrderIdsForGroup(service, {
    orderId: input.orderId,
    paymentIntentId: input.paymentIntentId,
  });
  if (ids.length === 0) {
    return markOrderPaymentFailure(service, input);
  }

  let firstId: string | null = null;
  let firstError: unknown = null;
  for (const id of ids) {
    try {
      const result = await markOrderPaymentFailure(service, {
        orderId: id,
        // Don't pass paymentIntentId for the iteration — we already
        // scoped to orders sharing the same payment intent's group.
        paymentIntentId: null,
        note: input.note,
      });
      if (!firstId && result) firstId = result;
    } catch (err) {
      if (!firstError) firstError = err;
    }
  }
  if (firstError) throw firstError;
  return firstId;
}

/**
 * Group-aware wrapper around `markOrderRefunded`. Returns the result for the
 * primary (seed) order — refund-amount semantics for partial refunds across
 * a group are non-trivial; for v1 we simply mark every sibling refunded with
 * the same flag.  Phase 2 can split per-line.
 */
export async function markOrderOrGroupRefunded(
  service: ServiceClient,
  input: {
    paymentIntentId?: string | null;
    orderId?: string | null;
    partial: boolean;
    note: string;
    refundAmountCents?: number | null;
  },
): Promise<MarkOrderRefundedResult | null> {
  const ids = await expandOrderIdsForGroup(service, {
    orderId: input.orderId,
    paymentIntentId: input.paymentIntentId,
  });
  if (ids.length === 0) {
    return markOrderRefunded(service, input);
  }

  const { data: memberRows, error: memberError } = await service.from("orders").select("id,total_cents,total_amount").in("id", ids).order("id");
  if (memberError) throw memberError;
  const members = memberRows ?? [];
  const allocations = allocateRefundCents(input.refundAmountCents ?? 0, members.map((row) => Number(row.total_cents ?? Math.round(Number(row.total_amount ?? 0) * 100))));
  const amountById = new Map(members.map((row, index) => [row.id, allocations[index]]));

  let primaryResult: MarkOrderRefundedResult | null = null;
  let firstError: unknown = null;
  for (const id of ids) {
    try {
      const result = await markOrderRefunded(service, {
        orderId: id,
        paymentIntentId: null,
        partial: input.partial,
        note: input.note,
        refundAmountCents: amountById.get(id) ?? 0,
      });
      if (!primaryResult && result) primaryResult = result;
    } catch (err) {
      if (!firstError) firstError = err;
    }
  }
  if (firstError) throw firstError;
  return primaryResult;
}

/** Read current Stripe refund state instead of trusting webhook delivery order. */
export async function reconcileOrderRefundFromStripe(service: ServiceClient, account: string, paymentIntentId: string) {
  const intent = await stripeRequest<{ id: string; amount: number; currency: string; latest_charge?: string | { id: string } | null; metadata?: Record<string, string> }>(`payment_intents/${encodeURIComponent(paymentIntentId)}`, { account });
  if (!intent.metadata?.order_id) return null;
  const { data: owner, error: ownerError } = await service.from("orders").select("photographer_id").eq("id", intent.metadata.order_id).maybeSingle();
  if (ownerError) throw ownerError;
  if (!owner || owner.photographer_id !== intent.metadata.photographer_id) throw new Error("Refund order ownership mismatch");
  const { data: photographer, error: pe } = await service.from("photographers").select("stripe_account_id,stripe_connected_account_id").eq("id", owner.photographer_id).single();
  if (pe || !photographer || getConnectedAccountId(photographer) !== account) throw new Error("Refund account mismatch");
  const verifiedRefunds: ConfirmedRefund[] = [];
  let startingAfter = ""; let confirmedCents = 0; let pending = false;
  do {
    const query = new URLSearchParams({ payment_intent: paymentIntentId, limit: "100" });
    if (startingAfter) query.set("starting_after", startingAfter);
    const page = await stripeRequest<{ data: ConfirmedRefund[]; has_more: boolean }>("refunds", { account, query });
    verifiedRefunds.push(...page.data);
    confirmedCents += page.data.filter((r) => r.status === "succeeded").reduce((sum, r) => sum + r.amount, 0);
    pending ||= page.data.some((r) => r.status === "pending" || r.status === "requires_action");
    startingAfter = page.has_more ? page.data.at(-1)?.id || "" : "";
  } while (startingAfter);
  let result: MarkOrderRefundedResult | null = null;
  if (confirmedCents >= intent.amount && confirmedCents > 0) {
    const ids = await expandOrderIdsForGroup(service, { orderId: intent.metadata.order_id });
    const { data: rows, error: rowsError } = await service.from("orders")
      .select("id,photographer_id,order_group_id,status,payment_status,paid_at,stripe_payment_intent_id,stripe_checkout_session_id,total_cents,currency,platform_fee_collection_method,platform_fee_amount_cents,platform_fee_currency,platform_fee_rate_cents,stripe_application_fee_id")
      .in("id", ids);
    if (rowsError) throw rowsError;
    const orders = (rows ?? []) as PaymentOrder[];
    if (!ids.length || orders.length !== ids.length || new Set(orders.map((row) => row.id)).size !== ids.length || orders.some((row) => !ids.includes(row.id))) {
      throw new Error("The complete refund order group could not be verified.");
    }
    if (orders.some((row) => row.platform_fee_collection_method != null)) {
      // Customer and platform refunds are independent balances. Keep the
      // production hold through a pending fee or lost provider response.
      const { error: holdError } = await service.from("orders").update({ status: "refund_pending" }).in("id", ids).neq("status", "refunded");
      if (holdError) throw holdError;
      const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id;
      if (!chargeId) throw new Error("The refunded payment charge could not be verified.");
      const charge = await stripeRequest<ApplicationFeeCharge>(`charges/${encodeURIComponent(chargeId)}`, { account });
      // Load at call time to keep the provider refund helper's payments import
      // out of module initialization. This verifier only makes GET requests.
      const { verifyDirectOrderApplicationFeeRefund } = await import("@/lib/direct-order-fee-refund");
      const fee = await verifyDirectOrderApplicationFeeRefund({ orders, account, payment: intent, charge }, stripeRequest);
      if (charge.amount_refunded !== intent.amount || !fee.fullyRefunded) return null;
    }
  }
  if (confirmedCents > 0) result = await markOrderOrGroupRefunded(service, { orderId: intent.metadata.order_id, partial: confirmedCents < intent.amount,
    refundAmountCents: confirmedCents, note: `Stripe refund status verified for ${paymentIntentId}.` });
  if (pending) {
    const ids = await expandOrderIdsForGroup(service, { orderId: intent.metadata.order_id });
    const { error } = await service.from("orders").update({ status: "refund_pending" }).in("id", ids).neq("status", "refunded");
    if (error) throw error;
  }
  return result ? { ...result, verifiedRefunds } : null;
}

import { createHmac, timingSafeEqual } from "node:crypto";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { syncPhotographyKeysByPhotographerId } from "@/lib/studio-os-app";
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

export {
  ANNUAL_DISCOUNT_PERCENT,
  CREDIT_PACK_DEFS,
  EXTRA_DESKTOP_KEY_ANNUAL_CENTS,
  EXTRA_DESKTOP_KEY_MONTHLY_CENTS,
  PLAN_DEFS,
  normalizeBillingInterval,
  normalizeCreditPackCode,
  normalizePlanCode,
};
export type {
  BillingInterval,
  CreditPackCode,
  CreditPackDefinition,
  PlanCode,
  PlanDefinition,
};

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
  price: StripePrice;
};

export type StripeSubscription = {
  id: string;
  status: string;
  customer: string;
  current_period_start: number;
  current_period_end: number;
  items: { data: StripeSubscriptionItem[] };
  latest_invoice?: string | StripeInvoice | null;
  metadata?: Record<string, string> | null;
  billing_mode?: { type?: string | null } | null;
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
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
  customer_details?: { email?: string | null } | null;
};

type StripePaymentIntent = {
  id: string;
  status: string;
  metadata?: Record<string, string> | null;
  latest_charge?: string | null;
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

export function isStripeBillingActive(status: string | null | undefined) {
  const normalized = (status ?? "").trim().toLowerCase();
  return normalized === "active" || normalized === "trialing";
}

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

export async function getPhotographerByUserId(service: ServiceClient, userId: string) {
  const { data, error } = await service
    .from("photographers")
    .select(
      "id,user_id,business_name,brand_color,watermark_enabled,watermark_logo_url,studio_address,studio_phone,stripe_account_id,stripe_connected_account_id,stripe_connect_onboarding_complete,stripe_connect_charges_enabled,stripe_connect_payouts_enabled,stripe_platform_customer_id,stripe_subscription_id,stripe_subscription_item_base_id,stripe_subscription_item_extra_keys_id,stripe_subscription_item_usage_id,subscription_plan_code,subscription_billing_interval,subscription_status,subscription_current_period_start,subscription_current_period_end,billing_email,billing_currency,order_usage_rate_cents,extra_desktop_keys,studio_id,studio_email,logo_url,is_platform_admin",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data as PhotographerBillingRow | null) ?? null;
}

export async function getOrCreatePhotographerByUser(
  service: ServiceClient,
  user: { id: string; email?: string | null },
) {
  const existing = await getPhotographerByUserId(service, user.id);
  if (existing) return existing;

  const defaultName = user.email?.split("@")[0]?.trim() || "Studio OS Photographer";

  const { data, error } = await service
    .from("photographers")
    .insert({
      user_id: user.id,
      business_name: defaultName,
      brand_color: "#0f172a",
      billing_email: user.email ?? null,
      billing_currency: DEFAULT_BILLING_CURRENCY,
      order_usage_rate_cents: ORDER_USAGE_RATE_CENTS,
      extra_desktop_keys: 0,
      subscription_billing_interval: "month",
    })
    .select(
      "id,user_id,business_name,brand_color,watermark_enabled,watermark_logo_url,studio_address,studio_phone,stripe_account_id,stripe_connected_account_id,stripe_connect_onboarding_complete,stripe_connect_charges_enabled,stripe_connect_payouts_enabled,stripe_platform_customer_id,stripe_subscription_id,stripe_subscription_item_base_id,stripe_subscription_item_extra_keys_id,stripe_subscription_item_usage_id,subscription_plan_code,subscription_billing_interval,subscription_status,subscription_current_period_start,subscription_current_period_end,billing_email,billing_currency,order_usage_rate_cents,extra_desktop_keys,studio_id,studio_email,logo_url,is_platform_admin",
    )
    .single();

  if (error) throw error;
  return data as PhotographerBillingRow;
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
      const { error: insertError } = await service.from("credit_packages").insert({
        name: pack.label,
        credits: pack.credits,
        price_cents: pack.priceCents,
        active: true,
        sort_order: index + 1,
        package_code: pack.code,
      });
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

async function ensureBillingMeter(input: {
  eventName: string;
  displayName: string;
}) {
  const meters = await stripeRequest<StripeList<StripeMeter>>("billing/meters", {
    query: new URLSearchParams({ limit: "100", status: "active" }),
  });

  const existing = meters.data.find((meter) => meter.event_name === input.eventName);
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
    idempotencyKey: `studio-os-product-${entry.lookupKey}`,
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

export async function ensureStripeCatalog() {
  if (!catalogPromise) {
    catalogPromise = (async () => {
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
          description: "Completed paid order usage billed monthly at $0.55 per order",
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
          description: "Completed paid order usage billed monthly at $0.35 per order",
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
          description: "Completed paid order usage billed monthly at $0.25 per order",
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
    billing_currency: account.default_currency || DEFAULT_BILLING_CURRENCY,
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
  const subscriptionInterval = resolveSubscriptionBillingInterval(subscription);
  const { usageItem } = findSubscriptionItems(subscription);

  if (planCode && !usageItem) {
    const catalog = await ensureStripeCatalog();
    await createStripeSubscriptionItem(subscription.id, catalog.usagePriceIds[planCode]);
    subscription = await retrieveStripeSubscription(subscription.id);
  }

  const refreshedItems = findSubscriptionItems(subscription);
  const refreshedPlanCode = resolvePlanCodeFromSubscription(subscription);
  const refreshedBillingInterval = resolveSubscriptionBillingInterval(subscription);
  const currentPeriodStart = asIsoTimestamp(subscription.current_period_start);
  const currentPeriodEnd = asIsoTimestamp(subscription.current_period_end);
  const extraDesktopKeys = refreshedItems.extraDesktopItem?.quantity ?? 0;
  const nextBillingCurrency =
    refreshedItems.baseItem?.price.currency ||
    photographer.billing_currency ||
    DEFAULT_BILLING_CURRENCY;
  const nextUsageRate =
    refreshedPlanCode ? PLAN_DEFS[refreshedPlanCode].usageRateCents : ORDER_USAGE_RATE_CENTS;

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
    billing_currency: nextBillingCurrency,
    order_usage_rate_cents: nextUsageRate,
    extra_desktop_keys: extraDesktopKeys,
  };

  const { error } = await service.from("photographers").update(updates).eq("id", photographer.id);
  if (error) throw error;

  const refreshedPhotographer = {
    ...photographer,
    ...updates,
  } as PhotographerBillingRow;

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
    await syncOutstandingStudioUsage(service, refreshedPhotographer);
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
) {
  if (
    !normalizePlanCode(photographer.subscription_plan_code) ||
    !isStripeBillingActive(photographer.subscription_status) ||
    !photographer.stripe_subscription_item_usage_id
  ) {
    return;
  }

  const periodStart = photographer.subscription_current_period_start;
  const periodEnd = photographer.subscription_current_period_end;
  const billingPeriodKey = toBillingPeriodKey(periodStart, periodEnd);
  if (!periodStart || !periodEnd || !billingPeriodKey) return;

  const { data, error } = await service
    .from("orders")
    .select("id,paid_at,payment_status,is_test,counted_for_monthly_usage,refund_status")
    .eq("photographer_id", photographer.id)
    .in("payment_status", ["paid", "succeeded", "no_payment_required"])
    .eq("counted_for_monthly_usage", false)
    .gte("paid_at", periodStart)
    .lt("paid_at", periodEnd)
    .or("is_test.is.false,is_test.is.null")
    .order("paid_at", { ascending: true });

  if (error) throw error;

  for (const row of (data as Array<{
    id: string;
    paid_at: string | null;
    payment_status: string | null;
    is_test: boolean | null;
    counted_for_monthly_usage: boolean | null;
    refund_status: string | null;
  }> | null) ?? []) {
    if (
      (row.refund_status ?? "").toLowerCase() === "refunded" ||
      (row.refund_status ?? "").toLowerCase() === "partially_refunded"
    ) {
      continue;
    }

    const usageTimestamp = row.paid_at
      ? Math.max(1, Math.floor(new Date(row.paid_at).getTime() / 1000))
      : Math.floor(Date.now() / 1000);

    const planCode = normalizePlanCode(photographer.subscription_plan_code);
    const customerId = photographer.stripe_platform_customer_id;
    if (!planCode || !customerId) {
      continue;
    }

    const params = new URLSearchParams();
    params.set("event_name", ORDER_USAGE_METER_EVENT_NAMES[planCode]);
    params.set("payload[stripe_customer_id]", customerId);
    params.set("payload[value]", "1");
    params.set("timestamp", String(usageTimestamp));
    params.set("identifier", `studio-os-usage-order-${row.id}`);

    await stripeRequest<{ id: string }>("billing/meter_events", {
      method: "POST",
      body: params,
      idempotencyKey: `studio-os-usage-order-${row.id}`,
    });

    const { error: updateError } = await service
      .from("orders")
      .update({
        counted_for_monthly_usage: true,
        monthly_usage_billing_period: billingPeriodKey,
      })
      .eq("id", row.id)
      .eq("counted_for_monthly_usage", false);

    if (updateError) throw updateError;
  }
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

export async function getCreditBalance(service: ServiceClient, userId: string, photographerId: string) {
  const { data, error } = await service
    .from("studio_credits")
    .select("id,balance,total_purchased,total_used")
    .eq("studio_id", userId)
    .maybeSingle();

  if (error) throw error;

  if (data) {
    if (!(data as { photographer_id?: string | null }).photographer_id) {
      await service
        .from("studio_credits")
        .update({ photographer_id: photographerId })
        .eq("id", (data as { id: string }).id);
    }
    return (data as { balance?: number | null }).balance ?? 0;
  }

  return 0;
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
  const { data: existing, error: fetchError } = await service
    .from("studio_credits")
    .select("id,balance,total_purchased,total_used")
    .eq("studio_id", input.userId)
    .maybeSingle();

  if (fetchError) throw fetchError;

  const currentBalance = (existing as { balance?: number | null } | null)?.balance ?? 0;
  const nextBalance = currentBalance + input.delta;
  const purchaseIncrement = input.source === "purchase" && input.delta > 0 ? input.delta : 0;
  const usageIncrement = input.source === "usage" && input.delta < 0 ? Math.abs(input.delta) : 0;

  if (existing) {
    const row = existing as { id: string; total_purchased?: number | null; total_used?: number | null };
    const { error: updateError } = await service
      .from("studio_credits")
      .update({
        photographer_id: input.photographerId,
        balance: nextBalance,
        total_purchased: ((row.total_purchased ?? 0) as number) + purchaseIncrement,
        total_used: ((row.total_used ?? 0) as number) + usageIncrement,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (updateError) throw updateError;
  } else {
    const { error: insertError } = await service.from("studio_credits").insert({
      studio_id: input.userId,
      photographer_id: input.photographerId,
      balance: nextBalance,
      total_purchased: purchaseIncrement,
      total_used: usageIncrement,
    });
    if (insertError) throw insertError;
  }

  const { error: txnError } = await service.from("credit_transactions").insert({
    studio_id: input.userId,
    photographer_id: input.photographerId,
    type: input.type,
    amount: input.delta,
    credits_delta: input.delta,
    credit_transaction_type: input.type,
    balance_after: nextBalance,
    description: input.description,
    package_id: input.packageId ?? null,
    source: input.source,
    source_reference_id: input.sourceReferenceId ?? null,
    stripe_checkout_session_id: input.checkoutSessionId ?? null,
    stripe_payment_intent_id: input.paymentIntentId ?? null,
  });

  if (txnError) throw txnError;

  return nextBalance;
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
  const sourceReferenceId = session.payment_intent || session.id;

  if (!packCode || !photographerId || !sourceReferenceId) return null;

  const { data: existing, error: existingError } = await service
    .from("credit_transactions")
    .select("id")
    .eq("source_reference_id", sourceReferenceId)
    .eq("source", "purchase")
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return null;

  const { data: photographer, error: photographerError } = await service
    .from("photographers")
    .select("id,user_id")
    .eq("id", photographerId)
    .maybeSingle();

  if (photographerError) throw photographerError;
  if (!photographer?.user_id) return null;

  const pack = CREDIT_PACK_DEFS[packCode];

  await adjustCreditBalance(service, {
    photographerId,
    userId: photographer.user_id as string,
    delta: pack.credits,
    type: "purchase",
    source: "purchase",
    description: `${pack.label} purchased`,
    packageId: creditPackageId,
    sourceReferenceId,
    checkoutSessionId: session.id,
    paymentIntentId: session.payment_intent ?? null,
  });

  return { photographerId, creditsGranted: pack.credits };
}

export async function handleCreditChargeRefunded(
  service: ServiceClient,
  charge: StripeCharge,
) {
  const packCode = normalizeCreditPackCode(charge.metadata?.pack_code ?? null);
  const photographerId = charge.metadata?.photographer_id ?? null;
  const paymentIntentId = charge.payment_intent ?? null;

  if (!packCode || !photographerId || !paymentIntentId) return null;

  const { data: existingRefund, error: existingRefundError } = await service
    .from("credit_transactions")
    .select("id")
    .eq("source_reference_id", paymentIntentId)
    .eq("source", "refund")
    .maybeSingle();

  if (existingRefundError) throw existingRefundError;
  if (existingRefund) return null;

  const { data: creditRow, error: creditRowError } = await service
    .from("studio_credits")
    .select("id,studio_id,balance")
    .eq("photographer_id", photographerId)
    .maybeSingle();

  if (creditRowError) throw creditRowError;
  if (!creditRow?.studio_id) return null;

  const pack = CREDIT_PACK_DEFS[packCode];
  const availableBalance = (creditRow.balance as number | null) ?? 0;

  if (availableBalance < pack.credits) {
    const { error: txnError } = await service.from("credit_transactions").insert({
      studio_id: creditRow.studio_id,
      photographer_id: photographerId,
      type: "refund",
      amount: 0,
      credits_delta: 0,
      credit_transaction_type: "refund",
      balance_after: availableBalance,
      description:
        "Credit pack refund received after credits were already consumed. Automatic balance reversal skipped for safety.",
      source: "refund",
      source_reference_id: paymentIntentId,
      stripe_payment_intent_id: paymentIntentId,
    });

    if (txnError) throw txnError;
    return { photographerId, creditsReversed: 0 };
  }

  await adjustCreditBalance(service, {
    photographerId,
    userId: creditRow.studio_id as string,
    delta: -pack.credits,
    type: "refund",
    source: "refund",
    description: `${pack.label} refunded`,
    sourceReferenceId: paymentIntentId,
    paymentIntentId,
  });

  return { photographerId, creditsReversed: pack.credits };
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
      "id,package_name,status,notes,photographer_id,paid_at,payment_status,counted_for_monthly_usage,monthly_usage_billing_period",
    )
    .eq("id", input.orderId)
    .maybeSingle();

  if (orderError) throw orderError;
  if (!order) return null;

  const currentStatus = (order.status ?? "").toLowerCase();
  if ((currentStatus === "paid" || currentStatus === "digital_paid") && order.paid_at) {
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
      stripe_checkout_session_id: input.checkoutSessionId ?? null,
      stripe_payment_intent_id: input.paymentIntentId ?? null,
      notes: mergedNotes,
      seen_by_photographer: false,
    })
    .eq("id", input.orderId);

  if (updateError) throw updateError;

  const { data: photographer, error: photographerError } = await service
    .from("photographers")
    .select(
      "id,user_id,business_name,brand_color,watermark_enabled,watermark_logo_url,studio_address,studio_phone,stripe_account_id,stripe_connected_account_id,stripe_connect_onboarding_complete,stripe_connect_charges_enabled,stripe_connect_payouts_enabled,stripe_platform_customer_id,stripe_subscription_id,stripe_subscription_item_base_id,stripe_subscription_item_extra_keys_id,stripe_subscription_item_usage_id,subscription_plan_code,subscription_billing_interval,subscription_status,subscription_current_period_start,subscription_current_period_end,billing_email,billing_currency,order_usage_rate_cents,extra_desktop_keys,studio_id,studio_email,logo_url,is_platform_admin",
    )
    .eq("id", order.photographer_id)
    .maybeSingle();

  if (photographerError) throw photographerError;
  if (photographer) {
    await syncOutstandingStudioUsage(service, photographer as PhotographerBillingRow);
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
    .eq("id", order.id);

  if (updateError) throw updateError;
  return order.id;
}

export async function markOrderRefunded(
  service: ServiceClient,
  input: {
    paymentIntentId?: string | null;
    orderId?: string | null;
    partial: boolean;
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
      payment_status: input.partial ? "partially_refunded" : "refunded",
      refund_status: input.partial ? "partially_refunded" : "refunded",
      notes: mergedNotes,
    })
    .eq("id", order.id);

  if (updateError) throw updateError;
  return order.id;
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
}) {
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
  if (input.schoolId) params.set("payment_intent_data[metadata][school_id]", input.schoolId);
  if (input.projectId) params.set("payment_intent_data[metadata][project_id]", input.projectId);
  if (input.studentId) params.set("payment_intent_data[metadata][student_id]", input.studentId);

  return stripeRequest<StripeCheckoutSession>("checkout/sessions", {
    method: "POST",
    body: params,
    account: input.accountId,
    idempotencyKey: `studio-os-order-session-${input.orderId}`,
  });
}

export async function getUsageSummaryForCurrentPeriod(
  service: ServiceClient,
  photographer: PhotographerBillingRow,
) {
  const planCode = normalizePlanCode(photographer.subscription_plan_code);
  const billingPeriodKey = toBillingPeriodKey(
    photographer.subscription_current_period_start,
    photographer.subscription_current_period_end,
  );

  if (
    !planCode ||
    !photographer.subscription_current_period_start ||
    !photographer.subscription_current_period_end ||
    !billingPeriodKey
  ) {
    return {
      countedOrders: 0,
      billableOrders: 0,
      unreportedOrders: 0,
      estimatedChargeCents: 0,
      billingPeriodKey: null,
    };
  }

  const { data, error } = await service
    .from("orders")
    .select("id,counted_for_monthly_usage,is_test,refund_status")
    .eq("photographer_id", photographer.id)
    .in("payment_status", ["paid", "succeeded", "no_payment_required"])
    .gte("paid_at", photographer.subscription_current_period_start)
    .lt("paid_at", photographer.subscription_current_period_end)
    .or("is_test.is.false,is_test.is.null");

  if (error) throw error;

  const rows =
    ((data as Array<{
      id: string;
      counted_for_monthly_usage: boolean | null;
      is_test: boolean | null;
      refund_status: string | null;
    }> | null) ?? []).filter((row) => {
      const refundStatus = (row.refund_status ?? "").toLowerCase();
      return refundStatus !== "refunded" && refundStatus !== "partially_refunded";
    });

  const billableOrders = rows.length;
  const countedOrders = rows.filter((row) => row.counted_for_monthly_usage === true).length;
  const unreportedOrders = Math.max(0, billableOrders - countedOrders);

  return {
    countedOrders,
    billableOrders,
    unreportedOrders,
    estimatedChargeCents:
      billableOrders * (photographer.order_usage_rate_cents ?? ORDER_USAGE_RATE_CENTS),
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

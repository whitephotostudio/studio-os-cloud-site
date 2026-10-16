import type { SubscriptionCurrency } from "./subscription-currency";
export type { SubscriptionCurrency } from "./subscription-currency";

export const SUBSCRIPTION_PRICING_MARKETS = [
  { country: "CA", currency: "cad", label: "Canada", orderingAvailable: true },
  { country: "US", currency: "usd", label: "United States", orderingAvailable: true },
  { country: "AU", currency: "aud", label: "Australia", orderingAvailable: true },
  { country: "GB", currency: "gbp", label: "United Kingdom", orderingAvailable: true },
] as const;

/** Public display selection only; the server independently verifies billing country. */
export function subscriptionPricingMarket(value: unknown) {
  const selected = typeof value === "string" ? value.trim().toUpperCase() : "";
  return SUBSCRIPTION_PRICING_MARKETS.find(market => market.country === selected || market.currency.toUpperCase() === selected)
    ?? SUBSCRIPTION_PRICING_MARKETS[0];
}

export type PlanCode = "starter" | "core" | "studio";
export type BillingInterval = "month" | "year";
export type PricingProfile = "legacy" | "gallery_v2" | "gallery_v3";
export type GalleryStoragePolicy = "existing" | "unlimited_jpeg";
export type OrderFeeScope = "all_paid_orders" | "none" | "production_orders";
export type CreditPackCode =
  | "background_credits_250"
  | "background_credits_1000"
  | "background_credits_2500"
  | "background_credits_5000"
  | "background_credits_10000";

export type PlanDefinition = {
  code: PlanCode;
  label: string;
  publicName: string;
  priceCents: number;
  annualPriceCents: number;
  description: string;
  usageFeeApplies: boolean;
  usageRateCents: number;
  orderFeeScope: OrderFeeScope;
  galleryStoragePolicy: GalleryStoragePolicy;
  annualSavingsCents: number;
  annualSavingsPercent: number;
  includedDesktopKeys: number;
  includedCredits: number;
  websiteLogoIncluded: boolean;
  featured?: boolean;
};

export type CreditPackDefinition = {
  code: CreditPackCode;
  label: string;
  credits: number;
  priceCents: number;
  featured?: boolean;
};

function envInt(name: string, fallback: number) {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.round(raw);
}

function annualizedCents(monthlyCents: number, discountPercent: number) {
  const discountFactor = Math.max(0, 100 - discountPercent) / 100;
  return Math.round(monthlyCents * 12 * discountFactor);
}

export const ANNUAL_DISCOUNT_PERCENT = envInt("STRIPE_ANNUAL_DISCOUNT_PERCENT", 10);

// This is a private release switch. Public clients receive the resolved catalog
// from a server component/API instead of enabling a different offer themselves.
export function isGalleryPricingV2Enabled() {
  return process.env.STUDIO_GALLERY_PRICING_V2_ENABLED === "1";
}

export function isGalleryPricingV3Enabled() {
  return process.env.STUDIO_GALLERY_PRICING_V3_ENABLED === "1";
}

export function isGalleryPricingEnabled() {
  return isGalleryPricingV3Enabled() || isGalleryPricingV2Enabled();
}

// Storage is released independently after the capacity, retention and delivery
// policy is verified. Publishing new prices does not promise unlimited storage.
export function isUnlimitedGalleryStorageEnabled() {
  return isGalleryPricingEnabled()
    && process.env.STUDIO_GALLERY_UNLIMITED_STORAGE_ENABLED === "1";
}

const galleryStoragePolicy: GalleryStoragePolicy =
  isUnlimitedGalleryStorageEnabled() ? "unlimited_jpeg" : "existing";

export const PRICING_PROFILE: PricingProfile =
  isGalleryPricingV3Enabled() ? "gallery_v3"
    : isGalleryPricingV2Enabled() ? "gallery_v2" : "legacy";

function definePlan(
  plan: Omit<PlanDefinition, "annualSavingsCents" | "annualSavingsPercent">,
): PlanDefinition {
  const monthlyAnnualTotal = plan.priceCents * 12;
  const annualSavingsCents = monthlyAnnualTotal - plan.annualPriceCents;
  return {
    ...plan,
    annualSavingsCents,
    annualSavingsPercent: monthlyAnnualTotal > 0
      ? Math.round(annualSavingsCents / monthlyAnnualTotal * 1000) / 10
      : 0,
  };
}

const starterMonthly = envInt("STRIPE_STARTER_MONTHLY_CENTS", 4900);
const coreMonthly = envInt("STRIPE_CORE_MONTHLY_CENTS", 9900);
const studioMonthly = envInt("STRIPE_STUDIO_MONTHLY_CENTS", 19900);

const legacyPlanDefs: Record<PlanCode, PlanDefinition> = {
  starter: definePlan({
    code: "starter",
    label: "Starter",
    publicName: "Web Gallery Plan",
    priceCents: starterMonthly,
    annualPriceCents: envInt(
      "STRIPE_STARTER_ANNUAL_CENTS",
      annualizedCents(starterMonthly, ANNUAL_DISCOUNT_PERCENT),
    ),
    description:
      "Web gallery access for online photo viewing, delivery, and ordering without the Studio OS app.",
    usageFeeApplies: true,
    usageRateCents: envInt("STRIPE_STARTER_ORDER_USAGE_RATE_CENTS", 55),
    orderFeeScope: "all_paid_orders",
    galleryStoragePolicy: "existing",
    includedDesktopKeys: 0,
    includedCredits: 0,
    websiteLogoIncluded: false,
  }),
  core: definePlan({
    code: "core",
    label: "Core",
    publicName: "App Plan",
    priceCents: coreMonthly,
    annualPriceCents: envInt(
      "STRIPE_CORE_ANNUAL_CENTS",
      annualizedCents(coreMonthly, ANNUAL_DISCOUNT_PERCENT),
    ),
    description:
      "Unlock the Studio OS app with 1 photography key, direct camera tethering, school workflow tools, backdrop tools, collages, and roster conversion.",
    usageFeeApplies: true,
    usageRateCents: envInt("STRIPE_CORE_ORDER_USAGE_RATE_CENTS", 40),
    orderFeeScope: "all_paid_orders",
    galleryStoragePolicy: "existing",
    includedDesktopKeys: 1,
    includedCredits: 0,
    websiteLogoIncluded: true,
    featured: true,
  }),
  studio: definePlan({
    code: "studio",
    label: "Studio",
    publicName: "Studio Plan",
    priceCents: studioMonthly,
    annualPriceCents: envInt(
      "STRIPE_STUDIO_ANNUAL_CENTS",
      annualizedCents(studioMonthly, ANNUAL_DISCOUNT_PERCENT),
    ),
    description:
      "Everything in App Plan with 2 photography keys, direct camera tethering, advanced school tools, and the only plan that can add extra keys.",
    usageFeeApplies: true,
    usageRateCents: envInt("STRIPE_STUDIO_ORDER_USAGE_RATE_CENTS", 35),
    orderFeeScope: "all_paid_orders",
    galleryStoragePolicy: "existing",
    includedDesktopKeys: 2,
    includedCredits: 0,
    websiteLogoIncluded: true,
  }),
};

// The approved new offer has explicit prices. Legacy environment overrides do
// not silently change this profile or make its public price differ by runtime.
const galleryPlanDefs: Record<PlanCode, PlanDefinition> = {
  starter: definePlan({
    ...legacyPlanDefs.starter,
    label: "Gallery",
    publicName: "Gallery",
    priceCents: 5900,
    annualPriceCents: 59900,
    description: isUnlimitedGalleryStorageEnabled()
      ? "Unlimited JPEG photo galleries for online viewing, delivery, and gallery sales without desktop production tools."
      : "Photo gallery hosting for online viewing, delivery, and gallery sales without desktop production tools.",
    usageFeeApplies: false,
    usageRateCents: 0,
    orderFeeScope: "none",
    galleryStoragePolicy,
  }),
  core: definePlan({
    ...legacyPlanDefs.core,
    publicName: "Core",
    description: "Connected gallery hosting and the Studio OS app with 1 photography key, direct camera tethering, school workflow tools, backdrop tools, collages, and roster conversion.",
    priceCents: 9900,
    annualPriceCents: 106920,
    usageFeeApplies: true,
    usageRateCents: 45,
    orderFeeScope: "production_orders",
    galleryStoragePolicy,
  }),
  studio: definePlan({
    ...legacyPlanDefs.studio,
    publicName: "Studio",
    description: "Everything in Core with 2 photography keys, direct camera tethering, advanced school tools, and the option to add extra keys.",
    priceCents: 19900,
    annualPriceCents: 214920,
    usageFeeApplies: true,
    usageRateCents: 45,
    orderFeeScope: "production_orders",
    galleryStoragePolicy,
  }),
};

// Separate versioned subscriptions preserve the prior advertised fee policy.
// The corrected offer charges each paid customer order in every plan.
const allOrderPlanDefs: Record<PlanCode, PlanDefinition> = {
  starter: definePlan({ ...galleryPlanDefs.starter,
    usageFeeApplies: true, usageRateCents: 55, orderFeeScope: "all_paid_orders" }),
  core: definePlan({ ...galleryPlanDefs.core,
    usageFeeApplies: true, usageRateCents: 45, orderFeeScope: "all_paid_orders" }),
  studio: definePlan({ ...galleryPlanDefs.studio,
    usageFeeApplies: true, usageRateCents: 45, orderFeeScope: "all_paid_orders" }),
};

export const PLAN_DEFS: Record<PlanCode, PlanDefinition> =
  getPlanDefinitions(PRICING_PROFILE);

/** Server-selected fee policy may differ from the current offer for legacy subscribers. */
export function getPlanDefinitions(profile: PricingProfile): Record<PlanCode, PlanDefinition> {
  return profile === "gallery_v3" ? allOrderPlanDefs
    : profile === "gallery_v2" ? galleryPlanDefs : legacyPlanDefs;
}

const extraDesktopMonthly = envInt("STRIPE_EXTRA_DESKTOP_KEY_MONTHLY_CENTS", 5500);

export const EXTRA_DESKTOP_KEY_MONTHLY_CENTS = extraDesktopMonthly;
export const EXTRA_DESKTOP_KEY_ANNUAL_CENTS = envInt(
  "STRIPE_EXTRA_DESKTOP_KEY_ANNUAL_CENTS",
  annualizedCents(extraDesktopMonthly, ANNUAL_DISCOUNT_PERCENT),
);

export type PricingCatalogSnapshot = {
  pricingProfile: PricingProfile;
  currency: SubscriptionCurrency;
  localizedSubscriptionsEnabled: boolean;
  // A single annual discount is not accurate for Gallery v2: Gallery saves
  // 15.4%, while Core and Studio save 10%. Read each plan's exact savings.
  annualDiscountPercent: number | null;
  galleryStoragePolicy: GalleryStoragePolicy;
  plans: Record<PlanCode, PlanDefinition>;
  // Free trials retain the existing paid-order fee policy until the studio
  // purchases a versioned subscription. Never inherit the new paid-plan fee.
  trialPlan: PlanDefinition;
  extraDesktopKeyMonthlyCents: number;
  extraDesktopKeyAnnualCents: number;
};

/** Resolve on the server and pass this serializable snapshot across the client boundary. */
export function getPricingCatalogSnapshot(currency: SubscriptionCurrency = "cad"): PricingCatalogSnapshot {
  if (!["cad", "usd", "aud", "gbp"].includes(currency)) throw new Error("Unsupported subscription currency.");
  return {
    pricingProfile: PRICING_PROFILE,
    currency,
    localizedSubscriptionsEnabled: process.env.STUDIO_LOCAL_SUBSCRIPTIONS_ENABLED === "1" || process.env.STUDIO_LOCAL_SUBSCRIPTIONS_ENABLED === "true",
    annualDiscountPercent: PRICING_PROFILE === "legacy" ? ANNUAL_DISCOUNT_PERCENT : null,
    galleryStoragePolicy: PRICING_PROFILE !== "legacy" ? galleryStoragePolicy : "existing",
    plans: {
      starter: { ...PLAN_DEFS.starter },
      core: { ...PLAN_DEFS.core },
      studio: { ...PLAN_DEFS.studio },
    },
    trialPlan: { ...legacyPlanDefs.studio },
    extraDesktopKeyMonthlyCents: EXTRA_DESKTOP_KEY_MONTHLY_CENTS,
    extraDesktopKeyAnnualCents: EXTRA_DESKTOP_KEY_ANNUAL_CENTS,
  };
}

export const CREDIT_PACK_DEFS: Record<CreditPackCode, CreditPackDefinition> = {
  background_credits_250: {
    code: "background_credits_250",
    label: "250 Credits",
    credits: 250,
    priceCents: envInt("STRIPE_BACKGROUND_CREDITS_250_CENTS", 1500),
  },
  background_credits_1000: {
    code: "background_credits_1000",
    label: "1000 Credits",
    credits: 1000,
    priceCents: envInt("STRIPE_BACKGROUND_CREDITS_1000_CENTS", 5500),
  },
  background_credits_2500: {
    code: "background_credits_2500",
    label: "2500 Credits",
    credits: 2500,
    priceCents: envInt("STRIPE_BACKGROUND_CREDITS_2500_CENTS", 12900),
  },
  background_credits_5000: {
    code: "background_credits_5000",
    label: "5000 Credits",
    credits: 5000,
    priceCents: envInt("STRIPE_BACKGROUND_CREDITS_5000_CENTS", 23900),
    featured: true,
  },
  background_credits_10000: {
    code: "background_credits_10000",
    label: "10000 Credits",
    credits: 10000,
    priceCents: envInt("STRIPE_BACKGROUND_CREDITS_10000_CENTS", 44900),
  },
};

export const DEFAULT_ORDER_USAGE_RATE_CENTS = PLAN_DEFS.starter.usageRateCents;

export function normalizePlanCode(value: string | null | undefined): PlanCode | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "starter" || normalized === "core" || normalized === "studio") {
    return normalized;
  }
  return null;
}

export function normalizeBillingInterval(
  value: string | null | undefined,
): BillingInterval | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "month" || normalized === "year") {
    return normalized;
  }
  return null;
}

export function normalizeCreditPackCode(
  value: string | null | undefined,
): CreditPackCode | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (
    normalized === "background_credits_250" ||
    normalized === "background_credits_1000" ||
    normalized === "background_credits_2500" ||
    normalized === "background_credits_5000" ||
    normalized === "background_credits_10000"
  ) {
    return normalized;
  }
  return null;
}

export function getPlanPriceCents(planCode: PlanCode, interval: BillingInterval) {
  return interval === "year"
    ? PLAN_DEFS[planCode].annualPriceCents
    : PLAN_DEFS[planCode].priceCents;
}

export function getExtraDesktopKeyPriceCents(interval: BillingInterval) {
  return interval === "year"
    ? EXTRA_DESKTOP_KEY_ANNUAL_CENTS
    : EXTRA_DESKTOP_KEY_MONTHLY_CENTS;
}

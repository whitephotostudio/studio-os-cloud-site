export type PlanCode = "starter" | "core" | "studio";
export type BillingInterval = "month" | "year";
export type CreditPackCode =
  | "background_credits_250"
  | "background_credits_1000"
  | "background_credits_2500"
  | "background_credits_5000"
  | "background_credits_10000";

export type PlanDefinition = {
  code: PlanCode;
  label: string;
  priceCents: number;
  annualPriceCents: number;
  description: string;
  usageFeeApplies: boolean;
  usageRateCents: number;
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

const starterMonthly = envInt("STRIPE_STARTER_MONTHLY_CENTS", 4900);
const coreMonthly = envInt("STRIPE_CORE_MONTHLY_CENTS", 9900);
const studioMonthly = envInt("STRIPE_STUDIO_MONTHLY_CENTS", 19900);

export const PLAN_DEFS: Record<PlanCode, PlanDefinition> = {
  starter: {
    code: "starter",
    label: "Starter",
    priceCents: starterMonthly,
    annualPriceCents: envInt(
      "STRIPE_STARTER_ANNUAL_CENTS",
      annualizedCents(starterMonthly, ANNUAL_DISCOUNT_PERCENT),
    ),
    description:
      "Web gallery access for online photo viewing, delivery, and ordering without the Studio OS app.",
    usageFeeApplies: true,
    usageRateCents: envInt("STRIPE_STARTER_ORDER_USAGE_RATE_CENTS", 55),
    includedDesktopKeys: 0,
    includedCredits: envInt("STRIPE_STARTER_INCLUDED_CREDITS", 35),
    websiteLogoIncluded: false,
  },
  core: {
    code: "core",
    label: "Core",
    priceCents: coreMonthly,
    annualPriceCents: envInt(
      "STRIPE_CORE_ANNUAL_CENTS",
      annualizedCents(coreMonthly, ANNUAL_DISCOUNT_PERCENT),
    ),
    description:
      "Unlock the Studio OS app with 1 photography key, school workflow tools, backdrop tools, collages, and roster conversion.",
    usageFeeApplies: true,
    usageRateCents: envInt("STRIPE_CORE_ORDER_USAGE_RATE_CENTS", 35),
    includedDesktopKeys: 1,
    includedCredits: envInt("STRIPE_CORE_INCLUDED_CREDITS", 55),
    websiteLogoIncluded: true,
    featured: true,
  },
  studio: {
    code: "studio",
    label: "Studio",
    priceCents: studioMonthly,
    annualPriceCents: envInt(
      "STRIPE_STUDIO_ANNUAL_CENTS",
      annualizedCents(studioMonthly, ANNUAL_DISCOUNT_PERCENT),
    ),
    description:
      "Everything in App Plan with 2 photography keys, advanced school tools, and the only plan that can add extra keys.",
    usageFeeApplies: true,
    usageRateCents: envInt("STRIPE_STUDIO_ORDER_USAGE_RATE_CENTS", 25),
    includedDesktopKeys: 2,
    includedCredits: envInt("STRIPE_STUDIO_INCLUDED_CREDITS", 100),
    websiteLogoIncluded: true,
  },
};

const extraDesktopMonthly = envInt("STRIPE_EXTRA_DESKTOP_KEY_MONTHLY_CENTS", 5500);

export const EXTRA_DESKTOP_KEY_MONTHLY_CENTS = extraDesktopMonthly;
export const EXTRA_DESKTOP_KEY_ANNUAL_CENTS = envInt(
  "STRIPE_EXTRA_DESKTOP_KEY_ANNUAL_CENTS",
  annualizedCents(extraDesktopMonthly, ANNUAL_DISCOUNT_PERCENT),
);

export const CREDIT_PACK_DEFS: Record<CreditPackCode, CreditPackDefinition> = {
  background_credits_250: {
    code: "background_credits_250",
    label: "Background Credits 250",
    credits: 250,
    priceCents: envInt("STRIPE_BACKGROUND_CREDITS_250_CENTS", 1250),
  },
  background_credits_1000: {
    code: "background_credits_1000",
    label: "Background Credits 1000",
    credits: 1000,
    priceCents: envInt("STRIPE_BACKGROUND_CREDITS_1000_CENTS", 4500),
  },
  background_credits_2500: {
    code: "background_credits_2500",
    label: "Background Credits 2500",
    credits: 2500,
    priceCents: envInt("STRIPE_BACKGROUND_CREDITS_2500_CENTS", 10000),
  },
  background_credits_5000: {
    code: "background_credits_5000",
    label: "Background Credits 5000",
    credits: 5000,
    priceCents: envInt("STRIPE_BACKGROUND_CREDITS_5000_CENTS", 17500),
    featured: true,
  },
  background_credits_10000: {
    code: "background_credits_10000",
    label: "Background Credits 10000",
    credits: 10000,
    priceCents: envInt("STRIPE_BACKGROUND_CREDITS_10000_CENTS", 30000),
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

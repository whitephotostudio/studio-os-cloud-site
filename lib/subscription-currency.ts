import type { BillingInterval, PlanCode } from "./studio-pricing";

/** Subscription billing is independent of the photographer's customer-sales currency. */
export const SUBSCRIPTION_CURRENCIES = ["cad", "usd", "aud", "gbp"] as const;
export type SubscriptionCurrency = typeof SUBSCRIPTION_CURRENCIES[number];

export class SubscriptionCurrencyError extends Error {
  readonly status: 400 | 409;
  constructor(message: string, status: 400 | 409 = 400) {
    super(message);
    this.name = "SubscriptionCurrencyError";
    this.status = status;
  }
}

export function localSubscriptionBillingEnabled(environment: Record<string, string | undefined> = process.env) {
  return environment.STUDIO_LOCAL_SUBSCRIPTIONS_ENABLED === "1" || environment.STUDIO_LOCAL_SUBSCRIPTIONS_ENABLED === "true";
}

export function normalizeSubscriptionCurrency(value: unknown): SubscriptionCurrency | null {
  if (typeof value !== "string") return null;
  const currency = value.trim().toLowerCase();
  return (SUBSCRIPTION_CURRENCIES as readonly string[]).includes(currency) ? currency as SubscriptionCurrency : null;
}

export function subscriptionCurrencyForCountry(value: unknown): SubscriptionCurrency {
  const country = typeof value === "string" ? value.trim().toUpperCase() : "";
  const currency = ({ CA: "cad", US: "usd", AU: "aud", GB: "gbp" } as const)[country as "CA" | "US" | "AU" | "GB"];
  if (!currency) throw new SubscriptionCurrencyError("Choose your business country before starting a subscription.");
  return currency;
}

/** The existing CAD keys remain attached to every previously agreed price. */
export function subscriptionPlanLookupKey(planCode: PlanCode, interval: BillingInterval, currency: SubscriptionCurrency) {
  const key = `studio-os-${planCode}-${interval === "year" ? "annual" : "monthly"}-gallery-v3`;
  return currency === "cad" ? key : `${key}-${currency}`;
}

export function subscriptionExtraKeyLookupKey(interval: BillingInterval, currency: SubscriptionCurrency) {
  const cadence = interval === "year" ? "annual" : "monthly";
  return currency === "cad" ? `studio-os-extra-desktop-key-${cadence}-v2`
    : `studio-os-extra-desktop-key-${cadence}-gallery-v3-${currency}`;
}

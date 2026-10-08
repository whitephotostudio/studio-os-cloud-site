// All currencies offered in studio settings use two decimal minor units in Stripe.
// Keep order prices and flat order fees in the same selected sales currency.
export const SUPPORTED_ORDER_CURRENCIES = ["usd", "cad", "eur", "gbp", "aud", "aed", "sar", "amd"] as const;
export type OrderCurrency = typeof SUPPORTED_ORDER_CURRENCIES[number];

export function isSupportedOrderCurrency(value: unknown): value is OrderCurrency {
  return typeof value === "string" && (SUPPORTED_ORDER_CURRENCIES as readonly string[]).includes(value);
}

/** Older studios without a saved currency retain their existing CAD default. */
export function resolvePhotographerOrderCurrency(value: unknown): OrderCurrency | null {
  if (value == null || value === "") return "cad";
  if (typeof value !== "string") return null;
  const currency = value.trim().toLowerCase();
  if (!currency) return "cad";
  return isSupportedOrderCurrency(currency) ? currency : null;
}

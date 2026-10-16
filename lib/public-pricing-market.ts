import { SUBSCRIPTION_PRICING_MARKETS, subscriptionPricingMarket } from "./studio-pricing";

/** Display only. Checkout continues to use the studio's saved business country. */
export function publicPricingMarket(country: unknown, visitorCountry: unknown) {
  const selected = typeof country === "string" ? country.trim().toUpperCase() : "";
  const explicit = SUBSCRIPTION_PRICING_MARKETS.find(
    market => market.country === selected || market.currency.toUpperCase() === selected,
  );
  if (explicit) return explicit;

  const visitor = typeof visitorCountry === "string" ? visitorCountry.trim().toUpperCase() : "";
  return SUBSCRIPTION_PRICING_MARKETS.find(market => market.country === visitor)
    ?? subscriptionPricingMarket("US");
}

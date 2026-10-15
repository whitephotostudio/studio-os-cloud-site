import { PricingPageClient } from "@/components/pricing-page-client";
import { PricingJsonLd } from "@/components/json-ld";
import { getPricingCatalogSnapshot, normalizeBillingInterval, subscriptionPricingMarket } from "@/lib/studio-pricing";

export default async function PricingPage({ searchParams }: {
  searchParams: Promise<{ country?: string | string[]; interval?: string | string[] }>;
}) {
  const query = await searchParams;
  const initial = getPricingCatalogSnapshot();
  const market = subscriptionPricingMarket(typeof query.country === "string" ? query.country : undefined);
  const catalog = initial.localizedSubscriptionsEnabled ? getPricingCatalogSnapshot(market.currency) : initial;
  const interval = normalizeBillingInterval(typeof query.interval === "string" ? query.interval : undefined) ?? "month";
  return <>
    <PricingJsonLd catalog={catalog} />
    <PricingPageClient key={`${catalog.currency}:${interval}`} catalog={catalog} initialInterval={interval} />
  </>;
}

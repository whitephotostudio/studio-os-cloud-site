import SignUpClient from "@/components/sign-up-client";
import { getPricingCatalogSnapshot, subscriptionPricingMarket } from "@/lib/studio-pricing";

/** Country query selects a display preview; it never sets a saved billing country. */
export default async function SignUpPage({ searchParams }: {
  searchParams: Promise<{ country?: string | string[] }>;
}) {
  const query = await searchParams;
  const initial = getPricingCatalogSnapshot();
  const market = subscriptionPricingMarket(typeof query.country === "string" ? query.country : undefined);
  return <SignUpClient catalog={initial.localizedSubscriptionsEnabled ? getPricingCatalogSnapshot(market.currency) : initial} />;
}

import { PricingPageClient } from "@/components/pricing-page-client";
import { PricingJsonLd } from "@/components/json-ld";
import { getPricingCatalogSnapshot } from "@/lib/studio-pricing";

export default function PricingPage() {
  const catalog = getPricingCatalogSnapshot();
  return (
    <>
      <PricingJsonLd catalog={catalog} />
      <PricingPageClient catalog={catalog} />
    </>
  );
}

import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { PricingShowcase } from "@/components/pricing-showcase";
import { TrialExpiredBanner } from "@/components/trial-expired-banner";
import { PricingJsonLd } from "@/components/json-ld";

export const metadata: Metadata = {
  title: "Pricing — Plans from $49/mo",
  description:
    "Studio OS Cloud pricing: Starter ($49/mo) for galleries and ordering, Core ($99/mo) with desktop app and tethering, Studio ($199/mo) for multi-photographer studios. Free trial included. Save 10% with annual billing.",
  alternates: {
    canonical: "https://studiooscloud.com/pricing",
  },
  openGraph: {
    title: "Studio OS Cloud Pricing — Plans from $49/mo",
    description:
      "Choose the plan that fits your photography business. From galleries-only to full capture-to-delivery workflows. Free trial included.",
    url: "https://studiooscloud.com/pricing",
  },
};

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ trial_expired?: string }>;
}) {
  const params = await searchParams;
  const trialExpired = params.trial_expired === "1";

  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <PricingJsonLd />
      <SiteHeader />
      <main className="pb-12 pt-10 sm:pb-16 sm:pt-14">
        {trialExpired ? <TrialExpiredBanner /> : null}
        <PricingShowcase variant="page" />
      </main>
      <SiteFooter />
    </div>
  );
}

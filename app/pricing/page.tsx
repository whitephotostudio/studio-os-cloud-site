import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { PricingShowcase } from "@/components/pricing-showcase";
import { TrialExpiredBanner } from "@/components/trial-expired-banner";

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ trial_expired?: string }>;
}) {
  const params = await searchParams;
  const trialExpired = params.trial_expired === "1";

  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <SiteHeader />
      <main className="pb-12 pt-10 sm:pb-16 sm:pt-14">
        {trialExpired ? <TrialExpiredBanner /> : null}
        <PricingShowcase variant="page" />
      </main>
      <SiteFooter />
    </div>
  );
}

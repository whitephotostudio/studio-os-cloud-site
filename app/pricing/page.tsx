import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { PricingShowcase } from "@/components/pricing-showcase";

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <SiteHeader />
      <main className="pb-12 pt-10 sm:pb-16 sm:pt-14">
        <PricingShowcase variant="page" />
      </main>
      <SiteFooter />
    </div>
  );
}

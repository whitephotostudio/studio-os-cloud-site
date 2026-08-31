import { SiteHeader } from "../components/site-header";
import { SiteFooter } from "../components/site-footer";
import { AiRevenueSection } from "../components/marketing/AiRevenueSection";
import { AppCloudSection } from "../components/marketing/AppCloudSection";
import { ComparisonSection } from "../components/marketing/ComparisonSection";
import { ConnectedGalleriesSection } from "../components/marketing/ConnectedGalleriesSection";
import { FinalCta } from "../components/marketing/FinalCta";
import { FaqSection } from "../components/marketing/FaqSection";
import { Founding100Banner } from "../components/marketing/Founding100Banner";
import { GalleryExperienceSection } from "../components/marketing/GalleryExperienceSection";
import { HeroSection } from "../components/marketing/HeroSection";
import { OrdersSection } from "../components/marketing/OrdersSection";
import { OnlineBookingSection } from "../components/marketing/OnlineBookingSection";
import { SchoolParentSection } from "../components/marketing/SchoolParentSection";
import { UseCasesSection } from "../components/marketing/UseCasesSection";
import { WorkflowStrip } from "../components/marketing/WorkflowStrip";
import { TrustSection } from "../components/marketing/TrustSection";
import { FaqJsonLd, SoftwareApplicationJsonLd } from "@/components/json-ld";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-neutral-950">
      <SoftwareApplicationJsonLd />
      <FaqJsonLd />
      <SiteHeader />
      <main className="flex-1 overflow-hidden">
        <HeroSection />
        <Founding100Banner />
        <WorkflowStrip />
        <AppCloudSection />
        <GalleryExperienceSection />
        <ConnectedGalleriesSection />
        <SchoolParentSection />
        <OnlineBookingSection />
        <OrdersSection />
        <AiRevenueSection />
        <UseCasesSection />
        <TrustSection />
        <ComparisonSection />
        <FaqSection />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}

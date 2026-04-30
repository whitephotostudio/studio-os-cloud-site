import { SiteHeader } from "../components/site-header";
import { SiteFooter } from "../components/site-footer";
import { AiRevenueSection } from "../components/marketing/AiRevenueSection";
import { AppCloudSection } from "../components/marketing/AppCloudSection";
import { ComparisonSection } from "../components/marketing/ComparisonSection";
import { ConnectedGalleriesSection } from "../components/marketing/ConnectedGalleriesSection";
import { FinalCta } from "../components/marketing/FinalCta";
import { GalleryExperienceSection } from "../components/marketing/GalleryExperienceSection";
import { HeroSection } from "../components/marketing/HeroSection";
import { OrdersSection } from "../components/marketing/OrdersSection";
import { SchoolParentSection } from "../components/marketing/SchoolParentSection";
import { UseCasesSection } from "../components/marketing/UseCasesSection";
import { WorkflowStrip } from "../components/marketing/WorkflowStrip";
import { FaqJsonLd, SoftwareApplicationJsonLd } from "@/components/json-ld";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-neutral-950">
      <SoftwareApplicationJsonLd />
      <FaqJsonLd />
      <SiteHeader />
      <main className="flex-1 overflow-hidden">
        <HeroSection />
        <WorkflowStrip />
        <AppCloudSection />
        <GalleryExperienceSection />
        <ConnectedGalleriesSection />
        <SchoolParentSection />
        <OrdersSection />
        <AiRevenueSection />
        <UseCasesSection />
        <ComparisonSection />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}

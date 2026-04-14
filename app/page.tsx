import type { ReactNode } from "react";
import { SiteHeader } from "../components/site-header";
import { Hero } from "../components/hero";
import { GalleryBrandingShowcase } from "../components/gallery-branding-showcase";
import { BeyondWorkflowSection } from "../components/beyond-workflow-section";
import { PlatformComparisonSection } from "../components/platform-comparison-section";
import { UseCaseVisualStrip } from "../components/use-case-visual-strip";
import { PricingShowcase } from "../components/pricing-showcase";
import { SiteFooter } from "../components/site-footer";

function SectionTransition({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 py-2 sm:px-6 sm:py-3 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <p className="max-w-3xl text-sm font-medium leading-7 text-neutral-500 sm:text-base">
          {children}
        </p>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white text-neutral-900 flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <SectionTransition>
          Everything you need to run your photography workflow — in one place.
        </SectionTransition>
        <UseCaseVisualStrip />
        <SectionTransition>
          But a smooth workflow is only part of the story.
        </SectionTransition>
        <BeyondWorkflowSection />
        <SectionTransition>
          Here&apos;s where Studio OS goes further than most platforms.
        </SectionTransition>
        <PlatformComparisonSection />
        <GalleryBrandingShowcase />
        <PricingShowcase variant="home" />
      </main>
      <SiteFooter />
    </div>
  );
}

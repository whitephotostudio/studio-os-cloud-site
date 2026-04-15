import type { ReactNode } from "react";
import type { Metadata } from "next";
import { SiteHeader } from "../components/site-header";
import { Hero } from "../components/hero";
import { GalleryBrandingShowcase } from "../components/gallery-branding-showcase";
import { BeyondWorkflowSection } from "../components/beyond-workflow-section";
import { PlatformComparisonSection } from "../components/platform-comparison-section";
import { UseCaseVisualStrip } from "../components/use-case-visual-strip";
import { PricingShowcase } from "../components/pricing-showcase";
import { SiteFooter } from "../components/site-footer";
import { SoftwareApplicationJsonLd, FaqJsonLd } from "@/components/json-ld";

export const metadata: Metadata = {
  title: "Studio OS Cloud — Run Your Photography Business From One Connected System",
  description:
    "The only photography platform that connects camera tethering, roster management, online galleries, client ordering, AI backgrounds, and print fulfillment. Built for school, event, and high-volume photographers. Plans from $49/mo.",
  alternates: {
    canonical: "https://studiooscloud.com",
  },
  openGraph: {
    title: "Studio OS Cloud — Run Your Photography Business From One Connected System",
    description:
      "Stop juggling multiple tools. Studio OS connects your entire photography workflow from capture to delivery.",
    url: "https://studiooscloud.com",
  },
};

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
      <SoftwareApplicationJsonLd />
      <FaqJsonLd />
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <div className="px-4 py-6 sm:px-6 lg:px-8">
          <p className="mx-auto max-w-3xl text-center text-base leading-7 text-neutral-600">
            Studio OS Cloud is photography workflow software for school, event, and high-volume
            photographers who need galleries, ordering, rosters, and connected desktop + cloud
            workflow.
          </p>
        </div>
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

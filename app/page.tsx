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
  title: "Studio OS Cloud | Premium Online Galleries and Connected Photography Workflow",
  description:
    "Premium online galleries, client ordering, digital delivery, and connected desktop + cloud workflow for photographers. Organize Projects, fulfill orders, and scale from one system.",
  alternates: {
    canonical: "https://studiooscloud.com",
  },
  openGraph: {
    title: "Studio OS Cloud | Premium Online Galleries and Connected Workflow",
    description:
      "Great galleries for all photographers. Deeper workflow power for photographers who need more.",
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
            Studio OS Cloud is a premium gallery and workflow platform for photographers. Use it
            for beautiful online galleries, client ordering, and delivery, then go deeper with
            Projects, production control, and connected desktop + cloud workflow when your business
            needs more.
          </p>
        </div>
        <SectionTransition>
          Great galleries are only the beginning. Studio OS starts before the gallery and stays
          connected after delivery.
        </SectionTransition>
        <UseCaseVisualStrip />
        <SectionTransition>
          From portraits and weddings to schools, sports, and structured events, the workflow
          stays organized.
        </SectionTransition>
        <BeyondWorkflowSection />
        <SectionTransition>
          That is where Projects, production control, and desktop + cloud workflow start to matter.
        </SectionTransition>
        <PlatformComparisonSection />
        <GalleryBrandingShowcase />
        <PricingShowcase variant="home" />
      </main>
      <SiteFooter />
    </div>
  );
}

"use client";

/**
 * JSON-LD Structured Data Components
 *
 * These embed schema.org markup in pages so Google and AI models
 * can understand what Studio OS Cloud is, what it costs, and how it compares.
 */

import { homeFaqItems } from "@/lib/marketing-faq";
import { useCspNonce } from "@/components/csp-nonce";
import { subscriptionPricingMarket, type PricingCatalogSnapshot, type PlanCode } from "@/lib/studio-pricing";
import { getOrderFeeDisclosure } from "@/lib/order-fee-display";

const planCodes: PlanCode[] = ["starter", "core", "studio"];
const legacyOfferDescriptions = {
  starter: "Premium online galleries, client ordering, digital delivery, and private client access in the cloud.",
  core: "Connected desktop and cloud workflow with capture control, Projects, AI background tools, and online galleries.",
  studio: "Multi-photographer plan with advanced structured workflow tools for studios and high-volume teams.",
};

function catalogOffers(catalog: PricingCatalogSnapshot, application = false) {
  return planCodes.map((code) => {
    const plan = catalog.plans[code];
    const price = (plan.priceCents / 100).toFixed(2);
    const fee = getOrderFeeDisclosure(plan, catalog.pricingProfile);
    return {
      "@type": "Offer",
      name: plan.publicName,
      price,
      priceCurrency: catalog.currency.toUpperCase(),
      ...(catalog.pricingProfile === "legacy" && application ? { priceValidUntil: "2027-12-31" } : {}),
      description: catalog.pricingProfile !== "legacy"
        ? `${plan.description} ${fee.fee}. Stripe processing fees are additional. ${catalog.galleryStoragePolicy === "unlimited_jpeg"
          ? "Unlimited finished JPEG client gallery hosting while subscribed, up to 50 MB per photo; RAW files, videos and general-purpose backups are excluded."
          : "Photo gallery hosting included."}`
        : legacyOfferDescriptions[code],
      url: "https://www.studiooscloud.com/pricing",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price,
        priceCurrency: catalog.currency.toUpperCase(),
        billingDuration: "P1M",
      },
    };
  });
}

type JsonLdProps = {
  data: Record<string, unknown>;
};

export function JsonLd({ data }: JsonLdProps) {
  const nonce = useCspNonce();
  return (
    <script
      nonce={nonce}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

/** Organization schema - used in the root layout (every page) */
export function OrganizationJsonLd() {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "Organization",
        "@id": "https://www.studiooscloud.com/#organization",
        name: "Studio OS Cloud",
        url: "https://www.studiooscloud.com",
        logo: "https://www.studiooscloud.com/studio_os_logo.png",
        description:
          "Premium photography gallery and workflow platform connecting Projects, client galleries, ordering, and delivery in one system.",
        sameAs: [
          "https://www.youtube.com/channel/UC2Ou4lxHAD9BrYq9qa303_Q",
        ],
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer support",
          email: "galleries@studiooscloud.com",
        },
      }}
    />
  );
}

/** SoftwareApplication schema - used on the homepage and Studio OS page */
export function SoftwareApplicationJsonLd({ catalog }: { catalog: PricingCatalogSnapshot }) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "@id": "https://www.studiooscloud.com/#software-application",
        name: "Studio OS Cloud",
        applicationCategory: "PhotographyApplication",
        operatingSystem: "Web, macOS",
        description:
          "Premium photography gallery and workflow platform for portrait, wedding, event, school, sports, and volume photographers. Includes online galleries, client ordering, digital delivery, Projects, connected desktop and cloud workflow, AI background tools, and production control.",
        url: "https://www.studiooscloud.com",
        inLanguage: "en",
        provider: {
          "@id": "https://www.studiooscloud.com/#organization",
        },
        offers: catalogOffers(catalog, true),
        featureList: [
          "Online school and event booking",
          "Automatic booking-to-student-roster workflow",
          "Stripe-powered appointment payments",
          "Online photo galleries",
          "Client ordering system",
          "Digital delivery",
          "Projects and job organization",
          "Connected desktop and cloud workflow",
          "Direct camera tethering",
          "Order review before print",
          "AI background replacement",
          "Student roster management",
          "Multi-photographer capture support",
          "Automated email campaigns",
          "Gallery analytics",
          "Sports team photo organization",
          "Graduation ceremony workflow",
          "Corporate headshot batch delivery",
          "Barcode and QR code matching",
          "PIN-based gallery access",
          "Abandoned cart recovery",
        ],
      }}
    />
  );
}

/** Product pricing schema - used on the pricing page */
export function PricingJsonLd({ catalog }: { catalog: PricingCatalogSnapshot }) {
  if (catalog.localizedSubscriptionsEnabled && !subscriptionPricingMarket(catalog.currency).orderingAvailable) return null;
  const prices = planCodes.map((code) => catalog.plans[code].priceCents);
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "Product",
        "@id": "https://www.studiooscloud.com/pricing#product",
        name: "Studio OS Cloud",
        description:
          "Professional photography workflow platform with capture, galleries, ordering, and delivery.",
        brand: {
          "@type": "Brand",
          name: "Studio OS",
        },
        url: "https://www.studiooscloud.com/pricing",
        seller: {
          "@id": "https://www.studiooscloud.com/#organization",
        },
        offers: {
          "@type": "AggregateOffer",
          lowPrice: (Math.min(...prices) / 100).toFixed(2),
          highPrice: (Math.max(...prices) / 100).toFixed(2),
          priceCurrency: catalog.currency.toUpperCase(),
          offerCount: planCodes.length,
          offers: catalogOffers(catalog),
        },
      }}
    />
  );
}

/** FAQ schema - used on the homepage or a dedicated FAQ section */
export function FaqJsonLd() {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: homeFaqItems.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: item.answer,
          },
        })),
      }}
    />
  );
}

/** Reusable FAQ schema for focused public feature pages. */
export function FaqListJsonLd({
  items,
}: {
  items: Array<{ question: string; answer: string }>;
}) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: items.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: item.answer,
          },
        })),
      }}
    />
  );
}

/** WebSite schema - connects the public site to the Studio OS Cloud organization */
export function WebSiteJsonLd() {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "WebSite",
        "@id": "https://www.studiooscloud.com/#website",
        name: "Studio OS Cloud",
        url: "https://www.studiooscloud.com",
        inLanguage: "en",
        publisher: {
          "@id": "https://www.studiooscloud.com/#organization",
        },
        description:
          "Premium photography gallery and workflow platform for photographers who need more than a standalone gallery.",
      }}
    />
  );
}

export function BreadcrumbJsonLd({
  items,
}: {
  items: Array<{ name: string; item: string }>;
}) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: items.map((entry, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: entry.name,
          item: entry.item,
        })),
      }}
    />
  );
}

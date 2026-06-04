/**
 * JSON-LD Structured Data Components
 *
 * These embed schema.org markup in pages so Google and AI models
 * can understand what Studio OS Cloud is, what it costs, and how it compares.
 */

import { homeFaqItems } from "@/lib/marketing-faq";

type JsonLdProps = {
  data: Record<string, unknown>;
};

function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
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
        name: "Studio OS Cloud",
        url: "https://www.studiooscloud.com",
        logo: "https://www.studiooscloud.com/studio_os_logo.png",
        description:
          "Premium photography gallery and workflow platform connecting Projects, client galleries, ordering, and delivery in one system.",
        sameAs: [],
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
export function SoftwareApplicationJsonLd() {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "Studio OS Cloud",
        applicationCategory: "PhotographyApplication",
        operatingSystem: "Web, macOS, Windows",
        description:
          "Premium photography gallery and workflow platform for portrait, wedding, event, school, sports, and volume photographers. Includes online galleries, client ordering, digital delivery, Projects, connected desktop and cloud workflow, AI background tools, and production control.",
        url: "https://www.studiooscloud.com",
        offers: [
          {
            "@type": "Offer",
            name: "Starter Plan",
            price: "49.00",
            priceCurrency: "USD",
            priceValidUntil: "2027-12-31",
            description:
              "Premium online galleries, client ordering, digital delivery, and private client access in the cloud.",
            url: "https://www.studiooscloud.com/pricing",
          },
          {
            "@type": "Offer",
            name: "Core Plan",
            price: "99.00",
            priceCurrency: "USD",
            priceValidUntil: "2027-12-31",
            description:
              "Connected desktop and cloud workflow with capture control, Projects, AI background tools, and online galleries.",
            url: "https://www.studiooscloud.com/pricing",
          },
          {
            "@type": "Offer",
            name: "Studio Plan",
            price: "199.00",
            priceCurrency: "USD",
            priceValidUntil: "2027-12-31",
            description:
              "Multi-photographer plan with advanced structured workflow tools for studios and high-volume teams.",
            url: "https://www.studiooscloud.com/pricing",
          },
        ],
        featureList: [
          "Online photo galleries",
          "Client ordering system",
          "Digital delivery",
          "Projects and job organization",
          "Connected desktop and cloud workflow",
          "Direct camera tethering",
          "Order review before print",
          "AI background replacement",
          "School roster management",
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
export function PricingJsonLd() {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Studio OS Cloud",
        description:
          "Professional photography workflow platform with capture, galleries, ordering, and delivery.",
        brand: {
          "@type": "Brand",
          name: "Studio OS",
        },
        url: "https://www.studiooscloud.com/pricing",
        offers: {
          "@type": "AggregateOffer",
          lowPrice: "49.00",
          highPrice: "199.00",
          priceCurrency: "USD",
          offerCount: 3,
          offers: [
            {
              "@type": "Offer",
              name: "Starter",
              price: "49.00",
              priceCurrency: "USD",
              priceSpecification: {
                "@type": "UnitPriceSpecification",
                price: "49.00",
                priceCurrency: "USD",
                billingDuration: "P1M",
              },
            },
            {
              "@type": "Offer",
              name: "Core",
              price: "99.00",
              priceCurrency: "USD",
              priceSpecification: {
                "@type": "UnitPriceSpecification",
                price: "99.00",
                priceCurrency: "USD",
                billingDuration: "P1M",
              },
            },
            {
              "@type": "Offer",
              name: "Studio",
              price: "199.00",
              priceCurrency: "USD",
              priceSpecification: {
                "@type": "UnitPriceSpecification",
                price: "199.00",
                priceCurrency: "USD",
                billingDuration: "P1M",
              },
            },
          ],
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

/** WebSite schema with search action - helps Google show a sitelinks search box */
export function WebSiteJsonLd() {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "Studio OS Cloud",
        url: "https://www.studiooscloud.com",
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

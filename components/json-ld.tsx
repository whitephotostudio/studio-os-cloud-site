/**
 * JSON-LD Structured Data Components
 *
 * These embed schema.org markup in pages so Google and AI models
 * can understand what Studio OS Cloud is, what it costs, and how it compares.
 */

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

/** Organization schema — used in the root layout (every page) */
export function OrganizationJsonLd() {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "Studio OS Cloud",
        url: "https://studiooscloud.com",
        logo: "https://studiooscloud.com/studio_os_logo.png",
        description:
          "Professional photography workflow platform connecting capture, organization, galleries, ordering, and delivery in one system.",
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

/** SoftwareApplication schema — used on the homepage and Studio OS page */
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
          "End-to-end photography workflow software for school, event, and high-volume photographers. Includes camera tethering, roster management, online galleries, client ordering, AI backgrounds, and print fulfillment.",
        url: "https://studiooscloud.com",
        offers: [
          {
            "@type": "Offer",
            name: "Starter Plan",
            price: "49.00",
            priceCurrency: "USD",
            priceValidUntil: "2027-12-31",
            description:
              "Web gallery access for online photo viewing, delivery, and ordering.",
            url: "https://studiooscloud.com/pricing",
          },
          {
            "@type": "Offer",
            name: "Core Plan",
            price: "99.00",
            priceCurrency: "USD",
            priceValidUntil: "2027-12-31",
            description:
              "Desktop app with camera tethering, school workflow tools, AI backgrounds, and cloud galleries.",
            url: "https://studiooscloud.com/pricing",
          },
          {
            "@type": "Offer",
            name: "Studio Plan",
            price: "199.00",
            priceCurrency: "USD",
            priceValidUntil: "2027-12-31",
            description:
              "Multi-photographer studio plan with 2 photography keys, advanced school tools, and extra key add-ons.",
            url: "https://studiooscloud.com/pricing",
          },
        ],
        featureList: [
          "Direct camera tethering",
          "School roster management",
          "Online photo galleries",
          "Client ordering system",
          "AI background replacement",
          "Multi-photographer capture support",
          "Order review before print",
          "Automated email campaigns",
          "Digital download delivery",
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

/** Product pricing schema — used on the pricing page */
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
        url: "https://studiooscloud.com/pricing",
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

/** FAQ schema — used on the homepage or a dedicated FAQ section */
export function FaqJsonLd() {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "What types of photographers is Studio OS designed for?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Studio OS is designed for school photographers, event photographers, portrait photographers, and any high-volume photography operation that needs an end-to-end workflow from capture to delivery.",
            },
          },
          {
            "@type": "Question",
            name: "How is Studio OS different from ShootProof or Pixieset?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Studio OS includes a desktop capture app with camera tethering, school roster management, AI background replacement, and multi-photographer support — features that gallery-only platforms like ShootProof and Pixieset don't offer. It covers the full workflow from capture to delivery, not just the gallery and ordering part.",
            },
          },
          {
            "@type": "Question",
            name: "Do I need the desktop app to use Studio OS Cloud?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "No. The Starter plan at $49/month gives you online galleries, client ordering, and delivery without the desktop app. The Core and Studio plans include the desktop app for tethering, roster management, and AI background tools.",
            },
          },
          {
            "@type": "Question",
            name: "Is there a free trial?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Yes, all Studio OS Cloud plans include a free trial period so you can test the full platform before committing.",
            },
          },
          {
            "@type": "Question",
            name: "How does AI background replacement work?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Photographers purchase credit packs starting at $15 for 250 credits. When parents view a gallery, they can select AI-generated background options as paid upgrades. Each swap uses one credit, turning standard portraits into premium upsell opportunities. No other school or volume photography platform offers this natively.",
            },
          },
          {
            "@type": "Question",
            name: "How is Studio OS different from GotPhoto?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Both offer school roster management and ordering workflows. However, Studio OS includes a built-in desktop tethering app (GotPhoto requires third-party Smart Shooter), AI background replacement as a revenue stream, and a combined capture-to-delivery experience in one platform.",
            },
          },
          {
            "@type": "Question",
            name: "Can Studio OS handle sports photography and team photos?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Yes. Multi-photographer capture lets you shoot from multiple positions simultaneously. The roster system handles team and league organization. AI background replacement creates instant composite variations like memory mates without reshooting.",
            },
          },
          {
            "@type": "Question",
            name: "Is Studio OS good for corporate headshot sessions?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Yes. Camera tethering provides live preview during sessions. The roster system imports employee lists for automatic matching. AI background replacement offers multiple corporate background options per person. Batch delivery handles large sessions efficiently.",
            },
          },
          {
            "@type": "Question",
            name: "Can Studio OS handle graduation ceremonies?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Yes. Multi-photographer sync captures multiple stage angles simultaneously. The roster system matches stage shots to graduates automatically. Parents order through individual graduate galleries with print fulfillment built in.",
            },
          },
        ],
      }}
    />
  );
}

/** WebSite schema with search action — helps Google show a sitelinks search box */
export function WebSiteJsonLd() {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "Studio OS Cloud",
        url: "https://studiooscloud.com",
        description:
          "Professional photography workflow platform for school, event, and high-volume photographers.",
      }}
    />
  );
}

import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/seo-landing-page";

export const metadata: Metadata = {
  title: "Online Photo Gallery and Ordering Software for Photographers",
  description:
    "Online photo gallery and ordering software that connects to your full photography workflow. Deliver branded galleries, accept orders, process payments, and fulfill prints — all from one platform.",
  alternates: {
    canonical: "https://studiooscloud.com/online-photo-gallery-ordering-software",
  },
  openGraph: {
    title: "Online Photo Gallery and Ordering Software | Studio OS Cloud",
    description:
      "Branded galleries with built-in ordering, Stripe payments, and print fulfillment. Connected to your capture workflow.",
    url: "https://studiooscloud.com/online-photo-gallery-ordering-software",
  },
};

export default function OnlinePhotoGalleryOrderingSoftwarePage() {
  return (
    <SeoLandingPage
      badge="Galleries & Ordering"
      headline="Online Galleries and Ordering Software That Connects to Your Workflow"
      subheadline="Deliver branded photo galleries, accept print and digital orders, process payments, and fulfill — all connected to your capture and production workflow."
      introduction="Studio OS Cloud is online photo gallery and ordering software built for professional photographers who need more than a standalone gallery host. Your galleries connect directly to your capture workflow, your ordering system, your fulfillment pipeline, and your client communication. Instead of uploading finished images to a separate gallery platform, Studio OS lets your photos flow from camera to gallery to order to delivery in one connected system."
      whoItsFor={{
        description:
          "Studio OS Cloud galleries and ordering are built for photographers who sell prints, packages, and digital downloads to their clients.",
        personas: [
          "School photographers delivering parent galleries with ordering",
          "Event photographers selling prints from corporate and social events",
          "Portrait photographers offering gallery proofing and ordering",
          "Sports photographers selling team and individual packages",
          "Wedding photographers delivering galleries with print ordering",
          "Any photographer who wants galleries and ordering in one place instead of two",
        ],
      }}
      differentiators={{
        description:
          "Gallery-only platforms handle delivery and ordering, but they are disconnected from capture and production. Studio OS connects everything.",
        points: [
          {
            title: "Galleries Connected to Capture",
            detail:
              "Photos flow from tethered capture to galleries without manual exports or uploads. Your desktop workflow and cloud galleries are one system.",
          },
          {
            title: "AI Background Upsells in Galleries",
            detail:
              "Clients can choose alternative backgrounds when ordering. The AI swap happens automatically — turning backgrounds into revenue.",
          },
          {
            title: "Order Review Before Print",
            detail:
              "Every order passes through a review step before going to the lab. You approve crops, packages, and selections before printing.",
          },
          {
            title: "Private Access with PINs",
            detail:
              "Each client or family gets their own gallery access code. No one sees photos that are not theirs.",
          },
          {
            title: "Stripe-Powered Payments",
            detail:
              "Secure payment processing through Stripe. Clients pay directly in the gallery — no redirects to third-party checkouts.",
          },
          {
            title: "Automated Email Campaigns",
            detail:
              "Send gallery links, order reminders, abandoned cart follow-ups, and delivery notifications automatically.",
          },
        ],
      }}
      features={[
        {
          name: "Branded Online Galleries",
          description:
            "Custom-branded galleries with your logo, colors, and domain. Professional presentation for every client.",
        },
        {
          name: "Print and Package Ordering",
          description:
            "Clients choose prints, packages, and add-ons from your price list. Built-in cart and checkout.",
        },
        {
          name: "Digital Download Sales",
          description:
            "Sell individual digital files or full gallery downloads alongside print orders.",
        },
        {
          name: "AI Background Options",
          description:
            "Offer background replacement as a paid add-on in the gallery ordering flow.",
        },
        {
          name: "PIN-Protected Access",
          description:
            "Private galleries with unique PINs for each family, student, or subject.",
        },
        {
          name: "Order Review Dashboard",
          description:
            "Review and approve every order before sending to the lab. Catch issues early.",
        },
        {
          name: "Lab Fulfillment Integration",
          description:
            "Route approved orders to your print lab. Track production and delivery status.",
        },
        {
          name: "Abandoned Cart Recovery",
          description:
            "Automatically email clients who started ordering but did not complete checkout.",
        },
      ]}
      comparisonIntro="Photographers often compare Studio OS Cloud to gallery-only platforms like Pixieset, ShootProof, SmugMug, and Zenfolio. Here is the key difference."
      comparisonPoints={[
        {
          label: "Connected to capture workflow",
          studioOs: "Yes, desktop + cloud",
          others: "No (upload-only)",
        },
        {
          label: "AI background upsells",
          studioOs: "Built in",
          others: "Not available",
        },
        {
          label: "Order review before print",
          studioOs: "Yes",
          others: "Varies",
        },
        {
          label: "Roster-based galleries",
          studioOs: "Yes",
          others: "Limited",
        },
        {
          label: "Multi-photographer support",
          studioOs: "Yes",
          others: "No",
        },
        {
          label: "Branded galleries with ordering",
          studioOs: "Yes",
          others: "Yes",
        },
      ]}
      ctaHeading="Galleries That Do More Than Display Photos"
      ctaDescription="Start your free trial and deliver galleries connected to your full photography workflow."
    />
  );
}

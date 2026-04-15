import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/seo-landing-page";

export const metadata: Metadata = {
  title: "Photography Workflow Software",
  description:
    "Photography workflow software that connects capture, organization, galleries, ordering, and delivery in one platform. Stop juggling separate tools for tethering, editing, gallery hosting, and fulfillment.",
  alternates: {
    canonical: "https://studiooscloud.com/photography-workflow-software",
  },
  openGraph: {
    title: "Photography Workflow Software | Studio OS Cloud",
    description:
      "One connected system for capture, galleries, orders, and delivery. Built for photographers who need more than a gallery platform.",
    url: "https://studiooscloud.com/photography-workflow-software",
  },
};

export default function PhotographyWorkflowSoftwarePage() {
  return (
    <SeoLandingPage
      badge="Photography Workflow"
      headline="Photography Workflow Software for Capture, Galleries, Orders, and Delivery"
      subheadline="Stop switching between tethering software, gallery platforms, ordering systems, and fulfillment tools. Studio OS connects your entire workflow."
      introduction="Studio OS Cloud is photography workflow software that brings capture, organization, online galleries, client ordering, and print fulfillment into one connected system. Instead of juggling a tethering app, a gallery platform, an ordering plugin, and a separate fulfillment pipeline, Studio OS gives you a desktop application paired with a cloud platform that handles everything from the moment you press the shutter to when prints arrive at your client's door."
      whoItsFor={{
        description:
          "Studio OS Cloud is for photographers who want one system instead of five, whether you shoot schools, events, portraits, sports, or corporate work.",
        personas: [
          "School and volume photographers running complex workflows",
          "Event photographers delivering galleries and taking orders",
          "Portrait photographers offering AI background upsells",
          "Sports photographers managing team and individual sessions",
          "Corporate headshot photographers with batch delivery needs",
          "Any photographer tired of disconnected tools and manual file transfers",
        ],
      }}
      differentiators={{
        description:
          "Most photography platforms solve one piece of the workflow. Studio OS connects the entire chain so nothing falls through the cracks.",
        points: [
          {
            title: "Capture to Cloud in One System",
            detail:
              "Tether your camera through the desktop app and your photos flow directly into the cloud workflow. No exporting, no uploading, no syncing.",
          },
          {
            title: "Not Just Galleries — Full Ordering",
            detail:
              "Clients browse galleries, select photos, choose packages, pick backgrounds, and pay — all in one branded experience.",
          },
          {
            title: "Order Review Before Fulfillment",
            detail:
              "Review every order before it goes to the lab. Approve, adjust, or flag issues before anything gets printed.",
          },
          {
            title: "AI-Powered Background Tools",
            detail:
              "Offer background replacement as a paid upsell built into the ordering flow. No manual editing at scale.",
          },
          {
            title: "Multi-Photographer Collaboration",
            detail:
              "Multiple photographers capture to the same job simultaneously. Ideal for events, schools, and sports.",
          },
          {
            title: "Automated Client Communication",
            detail:
              "Gallery links, order confirmations, delivery updates, and abandoned cart reminders — all automated.",
          },
        ],
      }}
      features={[
        {
          name: "Desktop Camera Tethering",
          description:
            "Shoot tethered with live preview, auto-naming, and instant organization through the Studio OS desktop app.",
        },
        {
          name: "Cloud-Based Galleries",
          description:
            "Deliver branded online galleries with private access, PIN protection, and built-in ordering.",
        },
        {
          name: "Client Ordering System",
          description:
            "Clients choose prints, packages, and digital downloads. Stripe-powered checkout with automatic order tracking.",
        },
        {
          name: "AI Background Replacement",
          description:
            "Offer multiple background options as paid upgrades directly inside the gallery experience.",
        },
        {
          name: "Roster and Subject Management",
          description:
            "Import rosters, match subjects to photos, and organize by group, class, team, or department.",
        },
        {
          name: "Print Fulfillment",
          description:
            "Route reviewed orders to your lab. Track production and automate shipping notifications.",
        },
        {
          name: "Multi-Photographer Support",
          description:
            "Multiple shooters feed into the same job in real time. No manual merging after the session.",
        },
        {
          name: "Analytics and Reporting",
          description:
            "Track gallery views, order rates, revenue per job, and email engagement across your business.",
        },
      ]}
      comparisonIntro="Photographers looking for workflow software often compare standalone gallery platforms, tethering apps, and all-in-one tools. Here is where Studio OS fits."
      comparisonPoints={[
        {
          label: "Camera tethering",
          studioOs: "Built-in desktop app",
          others: "Separate software (Capture One, Smart Shooter)",
        },
        {
          label: "Online galleries",
          studioOs: "Yes, with ordering",
          others: "Yes (gallery-only platforms)",
        },
        {
          label: "Print fulfillment",
          studioOs: "Built-in with order review",
          others: "Manual or third-party",
        },
        {
          label: "AI background tools",
          studioOs: "Built in",
          others: "Not available",
        },
        {
          label: "Roster management",
          studioOs: "Yes",
          others: "School platforms only",
        },
        {
          label: "Desktop + cloud connected",
          studioOs: "One platform",
          others: "Requires multiple tools",
        },
      ]}
      ctaHeading="One Workflow. One Platform."
      ctaDescription="Start your free trial and connect your entire photography workflow from capture to delivery."
    />
  );
}

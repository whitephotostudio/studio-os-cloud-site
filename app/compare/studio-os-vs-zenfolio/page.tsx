import type { Metadata } from "next";
import { ComparisonPage } from "@/components/comparison-page";

export const metadata: Metadata = {
  title: "Studio OS vs Zenfolio — Photography Platform Comparison (2026)",
  description:
    "Compare Studio OS Cloud and Zenfolio for photography. Feature comparison covering galleries, sports workflows, tethering, AI backgrounds, Face Finder, and print fulfillment.",
  alternates: { canonical: "https://studiooscloud.com/compare/studio-os-vs-zenfolio" },
  openGraph: {
    title: "Studio OS vs Zenfolio — Full Workflow vs Multi-Purpose Platform",
    description: "Side-by-side comparison for photographers choosing between Studio OS Cloud and Zenfolio.",
    url: "https://studiooscloud.com/compare/studio-os-vs-zenfolio",
  },
};

export default function StudioOsVsZenfolio() {
  return (
    <ComparisonPage
      competitorName="Zenfolio"
      competitorUrl="https://zenfolio.com"
      headline="Studio OS vs Zenfolio"
      subheadline="Zenfolio covers weddings, portraits, sports, and events. Studio OS Cloud specializes in the full capture-to-delivery workflow for volume photography."
      introduction="Zenfolio is a versatile photography platform that serves wedding, portrait, sports, and event photographers with galleries, QR code workflows, Face Finder selfie-based matching, and print fulfillment. Studio OS Cloud takes a more specialized approach — building camera tethering, roster management, and AI background tools into a single connected workflow. If you're deciding between the two, the key question is whether you need a broad multi-purpose platform or a deep volume photography workflow."
      features={[
        { feature: "Online Client Galleries", studioOs: "yes", competitor: "yes" },
        { feature: "Print Sales & Ordering", studioOs: "yes", competitor: "yes" },
        { feature: "Camera Tethering", studioOs: "yes", competitor: "no" },
        { feature: "School Roster System", studioOs: "yes", competitor: "partial" },
        { feature: "AI Background Replacement", studioOs: "yes", competitor: "no" },
        { feature: "Multi-Photographer Capture", studioOs: "yes", competitor: "no" },
        { feature: "Order Review Before Print", studioOs: "yes", competitor: "no" },
        { feature: "Desktop Workflow App", studioOs: "yes", competitor: "no" },
        { feature: "Face Finder / Selfie Search", studioOs: "partial", competitor: "yes" },
        { feature: "QR Code Matching", studioOs: "yes", competitor: "yes" },
        { feature: "Portfolio Website", studioOs: "no", competitor: "yes" },
        { feature: "Pre-Registration System", studioOs: "no", competitor: "yes" },
        { feature: "Gallery Branding", studioOs: "yes", competitor: "yes" },
        { feature: "Digital Downloads", studioOs: "yes", competitor: "yes" },
        { feature: "Lab Integrations", studioOs: "yes", competitor: "yes" },
      ]}
      studioOsAdvantages={[
        "Built-in desktop tethering app — no need for separate capture software",
        "AI background replacement creates premium upsell opportunities",
        "Full desktop-to-cloud connected workflow with offline capability",
        "Multi-photographer capture feeds multiple cameras into one project",
        "Order review before print gives complete quality control",
        "Purpose-built for high-volume school and sports workflows",
      ]}
      competitorAdvantages={[
        "Face Finder lets attendees find their photos using a selfie — no codes needed",
        "Portfolio website builder with custom domain support",
        "Serves a broader range of photography types (wedding, portrait, sports, events)",
        "Pre-registration system for events and picture days",
        "Lower starting price at $7.50/month",
        "Longer market presence with established photographer community",
      ]}
      targetAudience="Choose Studio OS if you're a school, sports, or volume photographer who wants one connected system from camera to delivery — especially if tethering, AI backgrounds, and roster management are core to your workflow. Choose Zenfolio if you need a versatile platform that handles multiple photography types (weddings, portraits, sports, events) with a portfolio website, Face Finder selfie matching, and pre-registration tools."
      verdict="Zenfolio is a strong multi-purpose platform that works across wedding, portrait, and sports photography with features like Face Finder and portfolio hosting. Studio OS is a specialized platform that goes deeper on the volume photography workflow — built-in tethering, roster management, AI backgrounds, and multi-photographer capture. If you primarily shoot schools, sports, and high-volume events, Studio OS gives you a more complete production pipeline. If you need one platform for multiple photography types, Zenfolio offers more breadth."
    />
  );
}

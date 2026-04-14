import type { Metadata } from "next";
import { ComparisonPage } from "@/components/comparison-page";

export const metadata: Metadata = {
  title: "Studio OS vs Pixieset — Photography Platform Comparison (2026)",
  description:
    "Compare Studio OS Cloud and Pixieset for photography workflows. See which platform is better for galleries, ordering, tethering, school photography, AI backgrounds, and business management.",
  alternates: { canonical: "https://studiooscloud.com/compare/studio-os-vs-pixieset" },
  openGraph: {
    title: "Studio OS vs Pixieset — Full Workflow vs Gallery Platform",
    description: "Head-to-head comparison for photographers choosing between Studio OS Cloud and Pixieset.",
    url: "https://studiooscloud.com/compare/studio-os-vs-pixieset",
  },
};

export default function StudioOsVsPixieset() {
  return (
    <ComparisonPage
      competitorName="Pixieset"
      competitorUrl="https://pixieset.com"
      headline="Studio OS vs Pixieset"
      subheadline="Pixieset is a popular gallery and business management platform. Studio OS Cloud is a full capture-to-delivery workflow. Here's how they compare."
      introduction="Pixieset has become one of the most popular photography platforms, especially among wedding and portrait photographers, thanks to its clean gallery design, website builder, and Studio Manager CRM. Studio OS Cloud takes a different approach — it starts at the capture stage with camera tethering and roster management, then connects all the way through to galleries, ordering, and print fulfillment. If you're choosing between the two, the right pick depends on what kind of photography you do."
      features={[
        { feature: "Online Client Galleries", studioOs: "yes", competitor: "yes" },
        { feature: "Client Ordering & Print Sales", studioOs: "yes", competitor: "yes" },
        { feature: "Camera Tethering", studioOs: "yes", competitor: "no" },
        { feature: "School Roster System", studioOs: "yes", competitor: "no" },
        { feature: "AI Background Replacement", studioOs: "yes", competitor: "no" },
        { feature: "Multi-Photographer Capture", studioOs: "yes", competitor: "no" },
        { feature: "Order Review Before Print", studioOs: "yes", competitor: "no" },
        { feature: "Desktop Workflow App", studioOs: "yes", competitor: "no" },
        { feature: "Website Builder", studioOs: "no", competitor: "yes" },
        { feature: "CRM / Studio Manager", studioOs: "no", competitor: "yes" },
        { feature: "Contracts & Invoicing", studioOs: "no", competitor: "yes" },
        { feature: "Booking Calendar", studioOs: "no", competitor: "yes" },
        { feature: "Gallery Branding", studioOs: "yes", competitor: "yes" },
        { feature: "Digital Downloads", studioOs: "yes", competitor: "yes" },
        { feature: "Mobile App", studioOs: "no", competitor: "yes" },
        { feature: "Free Plan Available", studioOs: "no", competitor: "yes" },
      ]}
      studioOsAdvantages={[
        "Full capture-to-delivery workflow in one platform — tethering, rosters, galleries, ordering, fulfillment",
        "Built-in camera tethering eliminates the need for separate capture software",
        "School roster system designed for picture day, sports, and high-volume workflows",
        "AI background replacement generates additional revenue per photo",
        "Multi-photographer support for team shoots and events",
        "Order review before print gives full quality control",
      ]}
      competitorAdvantages={[
        "Beautiful website builder with drag-and-drop editor and SEO tools",
        "Studio Manager with CRM, contracts, invoicing, and booking calendar",
        "Free tier available with 3GB storage (15% commission on sales)",
        "Mobile app for gallery management and business operations on the go",
        "Stronger for wedding and portrait photographers who need client-facing tools",
        "More mature ecosystem with Lightroom plugin and third-party integrations",
      ]}
      targetAudience="Choose Studio OS if you're a school, sports, event, or high-volume photographer who needs the full workflow from camera capture to print delivery — especially if tethering, rosters, and AI backgrounds matter to your business. Choose Pixieset if you're a wedding or portrait photographer who values a polished client experience with website, booking, contracts, and CRM built in. Pixieset excels at the post-shoot client experience; Studio OS excels at the full production pipeline."
      verdict="Pixieset and Studio OS serve different types of photographers. Pixieset is the better choice for wedding and portrait photographers who need a beautiful client-facing experience with CRM, contracts, and a website builder. Studio OS is the better choice for school, sports, event, and high-volume photographers who need the full capture-to-delivery workflow — camera tethering, roster management, AI backgrounds, multi-photographer support, and print fulfillment — in one connected system. If you're juggling separate tools for tethering, editing, and delivery, Studio OS eliminates that complexity."
    />
  );
}

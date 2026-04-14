import type { Metadata } from "next";
import { ComparisonPage } from "@/components/comparison-page";

export const metadata: Metadata = {
  title: "Studio OS vs SmugMug — Photography Platform Comparison (2026)",
  description:
    "Compare Studio OS Cloud and SmugMug for photography. Feature comparison covering galleries, storage, tethering, AI backgrounds, ordering, and print fulfillment.",
  alternates: { canonical: "https://studiooscloud.com/compare/studio-os-vs-smugmug" },
  openGraph: {
    title: "Studio OS vs SmugMug — Modern Workflow vs Legacy Platform",
    description: "Side-by-side comparison for photographers choosing between Studio OS Cloud and SmugMug.",
    url: "https://studiooscloud.com/compare/studio-os-vs-smugmug",
  },
};

export default function StudioOsVsSmugMug() {
  return (
    <ComparisonPage
      competitorName="SmugMug"
      competitorUrl="https://smugmug.com"
      headline="Studio OS vs SmugMug"
      subheadline="SmugMug offers unlimited storage and portfolio hosting. Studio OS Cloud offers a complete capture-to-delivery workflow."
      introduction="SmugMug has been a fixture in the photography world for over two decades, known for unlimited storage, beautiful portfolio sites, RAW file support, and Lightroom integration. Studio OS Cloud is a newer platform that focuses on the full production workflow — from camera tethering and roster management to galleries, ordering, AI backgrounds, and print fulfillment. They serve different needs, and the right choice depends on your photography business model."
      features={[
        { feature: "Online Galleries", studioOs: "yes", competitor: "yes" },
        { feature: "Print Sales & Ordering", studioOs: "yes", competitor: "yes" },
        { feature: "Camera Tethering", studioOs: "yes", competitor: "no" },
        { feature: "School Roster System", studioOs: "yes", competitor: "no" },
        { feature: "AI Background Replacement", studioOs: "yes", competitor: "no" },
        { feature: "Multi-Photographer Capture", studioOs: "yes", competitor: "no" },
        { feature: "Order Review Before Print", studioOs: "yes", competitor: "no" },
        { feature: "Desktop Workflow App", studioOs: "yes", competitor: "no" },
        { feature: "Unlimited Storage", studioOs: "no", competitor: "yes" },
        { feature: "Portfolio Website", studioOs: "no", competitor: "yes" },
        { feature: "RAW File Support", studioOs: "no", competitor: "yes" },
        { feature: "Lightroom Integration", studioOs: "no", competitor: "yes" },
        { feature: "Custom Domain", studioOs: "no", competitor: "yes" },
        { feature: "Gallery Branding", studioOs: "yes", competitor: "yes" },
        { feature: "Digital Downloads", studioOs: "yes", competitor: "yes" },
      ]}
      studioOsAdvantages={[
        "Full capture-to-delivery workflow with built-in camera tethering",
        "School roster system for organized picture day and volume workflows",
        "AI background replacement as a revenue-generating upsell",
        "Multi-photographer capture into a single unified project",
        "Order review before print ensures quality control",
        "Purpose-built for high-volume school, sports, and event photography",
      ]}
      competitorAdvantages={[
        "Unlimited photo and video storage across all plans",
        "Beautiful portfolio website builder with custom domains",
        "RAW file storage and delivery support",
        "Native Lightroom Classic integration for upload and management",
        "Two decades of reliability and brand recognition",
        "Broader use case — works for enthusiasts, fine art, and commercial photographers too",
      ]}
      targetAudience="Choose Studio OS if you're a school, sports, or event photographer who needs the full production pipeline — tethering, rosters, AI backgrounds, and fulfillment in one system. Choose SmugMug if you need unlimited storage, a portfolio website, RAW file hosting, or a platform that serves both professional and enthusiast photography needs."
      verdict="SmugMug and Studio OS serve fundamentally different needs. SmugMug is a gallery and portfolio platform with unlimited storage, ideal for photographers who need a professional web presence and print sales. Studio OS is a production platform that handles the entire workflow from camera to delivery, ideal for school, sports, and high-volume photographers who need tethering, roster management, and AI background tools. If you shoot volume work, Studio OS solves problems SmugMug wasn't designed for."
    />
  );
}

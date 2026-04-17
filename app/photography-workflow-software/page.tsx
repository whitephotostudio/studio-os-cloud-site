import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/seo-landing-page";
import { BreadcrumbJsonLd } from "@/components/json-ld";

export const metadata: Metadata = {
  title: "Photography Workflow Software with Projects, Galleries, and Ordering",
  description:
    "Photography workflow software that connects capture, Projects, galleries, ordering, and delivery in one platform. Replace disconnected tools with one connected desktop and cloud workflow.",
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
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", item: "https://studiooscloud.com" },
          {
            name: "Photography Workflow Software",
            item: "https://studiooscloud.com/photography-workflow-software",
          },
        ]}
      />
      <SeoLandingPage
        badge="Photography Workflow"
        headline="Photography Workflow Software That Starts Before the Gallery"
        subheadline="Connect capture, Projects, online galleries, client ordering, print workflow, and delivery in one system."
        introduction="Studio OS Cloud is photography workflow software for photographers who need more than a gallery platform and more than a simple upload step. It combines a desktop application with a cloud platform so your job can move from capture and organization into branded galleries, ordering, fulfillment, and delivery without being rebuilt in separate tools. Projects give you a real operating layer for the job, not just a place to store final images."
        whoItsFor={{
          description:
            "Studio OS Cloud is for photographers who want one system instead of five, whether they shoot portraits, weddings, events, schools, sports, or structured commercial work.",
          personas: [
            "Portrait photographers who want premium galleries with stronger job control",
            "Wedding photographers who need polished delivery plus a clearer operating layer behind it",
            "Event photographers managing albums, access, and delivery across real jobs",
            "School, sports, and volume photographers running structured workflows at scale",
            "Corporate and headshot photographers handling batch delivery and private access",
            "Studios tired of moving work between tethering apps, folders, gallery hosts, and fulfillment tools",
          ],
        }}
        differentiators={{
          heading: "Projects That Organize Real Jobs",
          description:
            "Most platforms solve one part of the process. Studio OS connects the whole chain so the job stays intact from capture through delivery.",
          points: [
            {
              title: "Projects as an Operating Layer",
              detail:
                "Keep albums, galleries, access, orders, and delivery tied to the same project instead of scattered across folders and separate services.",
            },
            {
              title: "Premium Galleries Built In",
              detail:
                "Deliver branded online galleries with ordering and downloads without making presentation feel secondary.",
            },
            {
              title: "Desktop + Cloud Connected Workflow",
              detail:
                "Tether and organize locally, then let the cloud handle galleries, orders, and delivery in the same system.",
            },
            {
              title: "Production Control Before Fulfillment",
              detail:
                "Review orders before they go to print so quality control stays with you.",
            },
            {
              title: "AI Tools Inside the Workflow",
              detail:
                "Offer AI background options as part of the ordering flow instead of a separate editing process.",
            },
            {
              title: "Built for Structured Jobs",
              detail:
                "Handle multi-photographer, roster-based, and workflow-heavy jobs without losing the polish needed for premium client delivery.",
            },
          ],
        }}
        features={[
          {
            name: "Projects and Job Organization",
            description:
              "Organize albums, galleries, access, and delivery around real jobs instead of a loose collection of folders.",
          },
          {
            name: "Desktop Camera Tethering",
            description:
              "Capture with live preview, auto-naming, and instant organization through the Studio OS desktop app.",
          },
          {
            name: "Cloud-Based Galleries",
            description:
              "Deliver branded online galleries with private access and built-in ordering.",
          },
          {
            name: "Client Ordering System",
            description:
              "Sell prints, packages, and digital downloads with Stripe-powered checkout.",
          },
          {
            name: "AI Background Replacement",
            description:
              "Offer multiple background options as paid upgrades directly inside the gallery experience.",
          },
          {
            name: "Roster and Subject Management",
            description:
              "Import rosters, match subjects to photos, and organize by class, team, or group when the workflow needs structure.",
          },
          {
            name: "Print Fulfillment and Review",
            description:
              "Route reviewed orders into production while keeping approval and quality control in your hands.",
          },
          {
            name: "Analytics and Reporting",
            description:
              "Track gallery activity, order performance, and business visibility across the workflow.",
          },
        ]}
        comparisonIntro="Photographers looking for workflow software often compare gallery platforms, tethering tools, and production apps. Studio OS is designed to replace the gaps between them."
        comparisonPoints={[
          {
            label: "Projects and job structure",
            studioOs: "Built in",
            others: "Limited or separate tools",
          },
          {
            label: "Premium online galleries",
            studioOs: "Yes",
            others: "Often separate platform",
          },
          {
            label: "Camera tethering",
            studioOs: "Built-in desktop app",
            others: "Separate software",
          },
          {
            label: "Client ordering",
            studioOs: "Built in",
            others: "Varies by stack",
          },
          {
            label: "Order review before fulfillment",
            studioOs: "Yes",
            others: "Often manual",
          },
          {
            label: "Desktop + cloud connected",
            studioOs: "One platform",
            others: "Requires multiple tools",
          },
        ]}
        ctaHeading="One Workflow. One Operating Layer."
        ctaDescription="Start your free trial and connect the work before the gallery to the delivery that happens after it."
      />
    </>
  );
}

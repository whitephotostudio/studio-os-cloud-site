import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/seo-landing-page";

export const metadata: Metadata = {
  title: "Pixieset Alternative for Photographers",
  description:
    "Looking for a Pixieset alternative that does more than gallery delivery? Studio OS Cloud connects camera tethering, roster management, AI backgrounds, online ordering, and print fulfillment in one platform.",
  alternates: {
    canonical: "https://studiooscloud.com/pixieset-alternative",
  },
  openGraph: {
    title: "Pixieset Alternative for Photographers | Studio OS Cloud",
    description:
      "More than galleries. Studio OS Cloud connects capture, organization, ordering, and delivery in one workflow.",
    url: "https://studiooscloud.com/pixieset-alternative",
  },
};

export default function PixiesetAlternativePage() {
  return (
    <SeoLandingPage
      badge="Pixieset Alternative"
      headline="A Pixieset Alternative for Photographers Who Need More Than Galleries"
      subheadline="Pixieset is a great gallery platform. But if you need tethered capture, roster management, AI backgrounds, and a connected workflow, Studio OS Cloud picks up where Pixieset stops."
      introduction="Pixieset is one of the most popular gallery delivery platforms for photographers. It does galleries, digital downloads, and basic print ordering well. But if your work involves tethered shooting, school rosters, multi-photographer sessions, AI background upsells, or order review before fulfillment, you will find yourself adding separate tools to fill those gaps. Studio OS Cloud is a Pixieset alternative that handles the full workflow — from the camera to the delivered print — in one connected system."
      whoItsFor={{
        description:
          "Studio OS Cloud is the right Pixieset alternative if you need more than gallery hosting and basic ordering.",
        personas: [
          "School photographers who need roster management and tethered capture",
          "Volume photographers who need multi-photographer support",
          "Photographers who want AI background upsells built into ordering",
          "Studios that need order review before sending to the lab",
          "Any photographer who wants capture and delivery in one platform",
          "Photographers outgrowing gallery-only platforms",
        ],
      }}
      differentiators={{
        heading: "What Studio OS Cloud Adds Beyond Pixieset",
        description:
          "Pixieset focuses on beautiful galleries and simple ordering. Studio OS Cloud does that too, plus connects your entire production workflow.",
        points: [
          {
            title: "Built-in Camera Tethering",
            detail:
              "Pixieset starts after you finish shooting. Studio OS starts at the camera — tether directly through the desktop app.",
          },
          {
            title: "School Roster Management",
            detail:
              "Import rosters, match students to photos, organize by class. Pixieset does not have roster tools.",
          },
          {
            title: "AI Background Replacement",
            detail:
              "Offer background swaps as a paid upsell inside the gallery. Pixieset does not offer AI background tools.",
          },
          {
            title: "Multi-Photographer Capture",
            detail:
              "Multiple cameras feed into the same job simultaneously. Pixieset does not handle multi-photographer capture.",
          },
          {
            title: "Order Review Before Print",
            detail:
              "Review every order before it goes to the lab. Pixieset sends orders directly without a review step.",
          },
          {
            title: "Connected Desktop + Cloud Workflow",
            detail:
              "Your capture app and gallery platform are one system. No exporting and re-uploading between separate tools.",
          },
        ],
      }}
      features={[
        {
          name: "Desktop Camera Tethering",
          description:
            "Shoot tethered with live preview and instant organization. Your photos flow into the cloud workflow automatically.",
        },
        {
          name: "Branded Online Galleries",
          description:
            "Deliver custom-branded galleries with private access, built-in ordering, and Stripe payments.",
        },
        {
          name: "AI Background Upsells",
          description:
            "Clients choose from multiple backgrounds when ordering. The swap is automatic and adds revenue to every order.",
        },
        {
          name: "Roster Import and Matching",
          description:
            "Import school or event rosters. Match subjects to photos during or after capture.",
        },
        {
          name: "Order Review Dashboard",
          description:
            "Approve every order before it goes to the lab. Catch issues before they become reprints.",
        },
        {
          name: "Print Fulfillment Pipeline",
          description:
            "Route reviewed orders to your lab and track fulfillment through delivery.",
        },
        {
          name: "Multi-Photographer Support",
          description:
            "Run multiple cameras at the same job. All photos sync to one organized workspace.",
        },
        {
          name: "Automated Email Workflows",
          description:
            "Gallery access, order reminders, abandoned cart recovery, and delivery notifications — all automated.",
        },
      ]}
      comparisonIntro="Here is a side-by-side look at what Pixieset and Studio OS Cloud each offer."
      comparisonPoints={[
        {
          label: "Online galleries",
          studioOs: "Yes",
          others: "Yes",
        },
        {
          label: "Print and digital ordering",
          studioOs: "Yes",
          others: "Yes",
        },
        {
          label: "Camera tethering",
          studioOs: "Built-in desktop app",
          others: "Not available",
        },
        {
          label: "School roster management",
          studioOs: "Yes",
          others: "Not available",
        },
        {
          label: "AI background replacement",
          studioOs: "Built in",
          others: "Not available",
        },
        {
          label: "Multi-photographer capture",
          studioOs: "Yes",
          others: "Not available",
        },
        {
          label: "Order review before print",
          studioOs: "Yes",
          others: "No",
        },
        {
          label: "Desktop + cloud connected",
          studioOs: "One platform",
          others: "Cloud only",
        },
      ]}
      ctaHeading="Ready for More Than Galleries?"
      ctaDescription="Start your free trial and see how Studio OS Cloud connects your full workflow — from camera to delivered print."
    />
  );
}

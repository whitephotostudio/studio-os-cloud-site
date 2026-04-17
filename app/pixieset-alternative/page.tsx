import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/seo-landing-page";
import { BreadcrumbJsonLd } from "@/components/json-ld";

export const metadata: Metadata = {
  title: "Pixieset Alternative for Photographers",
  description:
    "Looking for a Pixieset alternative with premium galleries and more workflow depth? Studio OS Cloud connects Projects, production control, online ordering, and desktop + cloud workflow in one platform.",
  alternates: {
    canonical: "https://studiooscloud.com/pixieset-alternative",
  },
  openGraph: {
    title: "Pixieset Alternative for Photographers | Studio OS Cloud",
    description:
      "Pixieset is strong for polished galleries and simplicity. Studio OS Cloud goes deeper on workflow, Projects, and production control.",
    url: "https://studiooscloud.com/pixieset-alternative",
  },
};

export default function PixiesetAlternativePage() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", item: "https://studiooscloud.com" },
          {
            name: "Pixieset Alternative",
            item: "https://studiooscloud.com/pixieset-alternative",
          },
        ]}
      />
      <SeoLandingPage
        badge="Pixieset Alternative"
        headline="A Pixieset Alternative for Photographers Who Need More Than a Gallery"
        subheadline="Pixieset is strong for polished galleries, websites, and simple client delivery. Studio OS Cloud is built for photographers who want premium galleries too, plus Projects, production control, and connected desktop + cloud workflow."
        introduction="Pixieset is one of the most popular gallery platforms in photography, and for good reason: it offers polished presentation, websites, and a simple cloud workflow. Studio OS Cloud takes a different path. It keeps galleries and ordering as a core part of the product, then goes deeper for photographers who need the work behind the gallery to stay connected too. If your business needs Projects, stronger production control, desktop + cloud workflow, or structured jobs that are hard to manage in a gallery-only stack, Studio OS gives you more operating depth without giving up client presentation."
        whoItsFor={{
          description:
            "Studio OS Cloud is the right Pixieset alternative when the gallery is only one part of the job.",
          personas: [
            "Photographers who want branded galleries and stronger job organization behind them",
            "Studios managing portraits, events, schools, sports, or other structured jobs",
            "Teams that want Projects, albums, access, and delivery tied together",
            "Photographers who need order review before print or fulfillment",
            "Businesses that have outgrown upload-only gallery workflows",
            "Photographers who still want polished client presentation, not just workflow tools",
          ],
        }}
        differentiators={{
          heading: "Where Studio OS Cloud Goes Deeper",
          description:
            "Pixieset is strong for presentation and simplicity. Studio OS goes deeper on the workflow around the gallery.",
          points: [
            {
              title: "Premium Galleries Are Still Core",
              detail:
                "Studio OS Cloud is not asking you to trade presentation for workflow. You still get branded galleries, client ordering, downloads, and private access as part of the platform.",
            },
            {
              title: "Projects That Organize Real Jobs",
              detail:
                "Keep albums, access, orders, and delivery connected to the same job instead of managing them across separate steps.",
            },
            {
              title: "Desktop + Cloud Workflow",
              detail:
                "When your business needs capture and production control before the gallery, Studio OS connects that work to the cloud instead of starting after the upload.",
            },
            {
              title: "Order Review Before Print",
              detail:
                "Review orders before they go into production so quality control stays with you.",
            },
            {
              title: "AI Background Upsells",
              detail:
                "Offer AI background options inside the ordering flow when that kind of upsell fits your business.",
            },
            {
              title: "Especially Strong for Structured Jobs",
              detail:
                "Schools, sports, events, and volume workflows benefit from rosters, multi-photographer support, and connected production steps.",
            },
          ],
        }}
        features={[
          {
            name: "Branded Online Galleries",
            description:
              "Deliver polished galleries with ordering, downloads, and private access in a client-ready experience.",
          },
          {
            name: "Projects and Job Structure",
            description:
              "Keep albums, orders, access, and delivery connected to a real job structure instead of a loose gallery list.",
          },
          {
            name: "Desktop Camera Tethering",
            description:
              "Capture and organize through the desktop app when the workflow needs more control before images reach the gallery.",
          },
          {
            name: "Order Review Dashboard",
            description:
              "Approve and review orders before they move into production.",
          },
          {
            name: "AI Background Upsells",
            description:
              "Offer additional background choices inside the ordering flow when portrait upgrades are part of the sale.",
          },
          {
            name: "Structured Subject Management",
            description:
              "Import rosters, match subjects, and keep organized jobs intact when the workflow is more complex than a simple gallery upload.",
          },
          {
            name: "Print Fulfillment Pipeline",
            description:
              "Move from reviewed orders to production and delivery in the same connected system.",
          },
          {
            name: "Automated Gallery Communication",
            description:
              "Send gallery access, reminders, and delivery updates automatically.",
          },
        ]}
        comparisonIntro="Both platforms handle polished client galleries well. The bigger difference is how much of the job happens before and after the gallery."
        comparisonPoints={[
          {
            label: "Premium branded galleries",
            studioOs: "Yes",
            others: "Yes",
          },
          {
            label: "Print and digital ordering",
            studioOs: "Yes",
            others: "Yes",
          },
          {
            label: "Projects and job structure",
            studioOs: "Yes",
            others: "Limited",
          },
          {
            label: "Order review before print",
            studioOs: "Yes",
            others: "No",
          },
          {
            label: "Desktop + cloud connected workflow",
            studioOs: "Yes",
            others: "No",
          },
          {
            label: "Website builder and CRM tools",
            studioOs: "Not the core focus",
            others: "Yes",
          },
        ]}
        ctaHeading="Choose Studio OS If Workflow Matters as Much as Presentation"
        ctaDescription="Start your free trial and see how premium galleries, Projects, and production control can live in one connected system."
      />
    </>
  );
}

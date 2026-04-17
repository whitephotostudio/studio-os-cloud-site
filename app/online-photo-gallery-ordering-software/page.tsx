import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/seo-landing-page";
import { BreadcrumbJsonLd } from "@/components/json-ld";

export const metadata: Metadata = {
  title: "Premium Online Photo Gallery and Ordering Software for Photographers",
  description:
    "Deliver premium online galleries, private client access, print and digital ordering, and connected workflow visibility from one photography platform.",
  alternates: {
    canonical: "https://studiooscloud.com/online-photo-gallery-ordering-software",
  },
  openGraph: {
    title: "Premium Online Photo Gallery and Ordering Software | Studio OS Cloud",
    description:
      "Premium galleries with ordering, private access, digital delivery, and deeper workflow connection when you need it.",
    url: "https://studiooscloud.com/online-photo-gallery-ordering-software",
  },
};

export default function OnlinePhotoGalleryOrderingSoftwarePage() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", item: "https://studiooscloud.com" },
          {
            name: "Online Galleries & Ordering",
            item: "https://studiooscloud.com/online-photo-gallery-ordering-software",
          },
        ]}
      />
      <SeoLandingPage
        badge="Galleries & Ordering"
        headline="Premium Online Galleries and Ordering Software for Photographers"
        subheadline="Deliver branded galleries, accept print and digital orders, and keep client delivery connected to Projects, production, and fulfillment."
        introduction="Studio OS Cloud is online photo gallery and ordering software for photographers who care about presentation as much as operations. Use it for premium client galleries, private access, print sales, and digital delivery on its own, or connect it to a deeper desktop + cloud workflow that starts before the gallery. Instead of treating delivery as a separate upload step, Studio OS keeps galleries tied to the job, the order, and the work that follows."
        whoItsFor={{
          description:
            "Built for photographers who want polished client galleries today and room to grow into a more connected workflow tomorrow.",
          personas: [
            "Portrait photographers delivering proofing, print sales, and digital downloads",
            "Wedding photographers who want polished galleries with ordering and favorites",
            "Event photographers handling selections, access, and delivery in one place",
            "School and sports photographers delivering private galleries with ordering",
            "Studios that need branded presentation without losing control behind the scenes",
            "Photographers who want galleries alone or galleries connected to a deeper workflow",
          ],
        }}
        differentiators={{
          heading: "Online Galleries Connected to Production",
          description:
            "Studio OS Cloud makes galleries a core product, then connects them to the work around them.",
          points: [
            {
              title: "Premium Client Presentation",
              detail:
                "Deliver branded galleries with a polished look, client favorites, ordering, and digital delivery built in.",
            },
            {
              title: "Projects and Albums Stay Connected",
              detail:
                "Keep galleries tied to the same job structure, albums, access settings, and delivery workflow instead of splitting them into separate systems.",
            },
            {
              title: "Private Access When Needed",
              detail:
                "Use PINs and controlled access for schools, events, or any client work that needs privacy.",
            },
            {
              title: "Order Review Before Print",
              detail:
                "Review orders before they go to production so fulfillment stays under your control.",
            },
            {
              title: "Digital Delivery and Print Workflow",
              detail:
                "Sell downloads, prints, and packages from the same gallery experience clients already use.",
            },
            {
              title: "Desktop + Cloud Connection",
              detail:
                "When you use Studio OS App, galleries connect directly to capture and production instead of waiting for a manual upload step.",
            },
          ],
        }}
        features={[
          {
            name: "Branded Online Galleries",
            description:
              "Deliver a premium client experience with your logo, styling, and a gallery flow that feels built for photography.",
          },
          {
            name: "Print and Package Ordering",
            description:
              "Sell prints, packages, and add-ons directly inside the gallery with a built-in cart and checkout.",
          },
          {
            name: "Digital Download Sales",
            description:
              "Offer individual files or full-gallery downloads without sending clients to another system.",
          },
          {
            name: "Private Access and PIN Control",
            description:
              "Protect galleries when privacy matters, whether you are delivering to families, schools, teams, or private event clients.",
          },
          {
            name: "Favorites and Selection Flow",
            description:
              "Let clients mark favorites and work from a clearer selection process before they order.",
          },
          {
            name: "Order Review Dashboard",
            description:
              "Approve and review orders before they move into print production.",
          },
          {
            name: "Lab Fulfillment Integration",
            description:
              "Route approved orders into your print workflow and keep delivery moving without extra admin.",
          },
          {
            name: "Automated Gallery Communication",
            description:
              "Send access links, reminders, and delivery updates automatically.",
          },
        ]}
        comparisonIntro="Many gallery platforms handle presentation well. The bigger difference is whether the gallery stays connected to the rest of the job."
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
            label: "Private access and PIN control",
            studioOs: "Yes",
            others: "Varies",
          },
          {
            label: "Projects and job structure",
            studioOs: "Yes",
            others: "Limited",
          },
          {
            label: "Order review before print",
            studioOs: "Yes",
            others: "Varies",
          },
          {
            label: "Desktop + cloud connected workflow",
            studioOs: "Yes",
            others: "No",
          },
        ]}
        ctaHeading="Great Galleries. More Workflow When You Need It."
        ctaDescription="Start your free trial and deliver galleries that feel premium while staying connected to the work behind them."
      />
    </>
  );
}

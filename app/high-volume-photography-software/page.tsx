import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/seo-landing-page";
import { BreadcrumbJsonLd } from "@/components/json-ld";

export const metadata: Metadata = {
  title: "High Volume Photography Software",
  description:
    "High-volume photography software for online booking, automatic rosters, faster capture, ordering, and delivery across school and event workflows.",
  alternates: {
    canonical: "https://www.studiooscloud.com/high-volume-photography-software",
  },
  openGraph: {
    title: "High Volume Photography Software | Studio OS Cloud",
    description:
      "Capture, organize, sell, and deliver at scale. The connected workflow platform for high-volume photographers.",
    url: "https://www.studiooscloud.com/high-volume-photography-software",
  },
};

export default function HighVolumePhotographySoftwarePage() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", item: "https://www.studiooscloud.com" },
          {
            name: "High Volume Photography Software",
            item: "https://www.studiooscloud.com/high-volume-photography-software",
          },
        ]}
      />
      <SeoLandingPage
      badge="High Volume Photography"
      headline="High-Volume Photography Software for Faster Capture, Ordering, and Delivery"
      subheadline="Shoot hundreds of subjects, organize instantly, deliver galleries, take orders, and fulfill prints — all from one connected platform."
      introduction="Studio OS Cloud is high-volume photography software designed for photographers who shoot large numbers of subjects in a single session. Open a booking link for scheduled school or event work, collect confirmed appointments into a roster, capture quickly, organize automatically, deliver galleries at scale, and process orders without switching between multiple platforms."
      whoItsFor={{
        description:
          "If you regularly shoot sessions with dozens, hundreds, or thousands of subjects, Studio OS Cloud is built for your workflow.",
        personas: [
          "School portrait photographers handling multiple schools",
          "Sports photographers covering leagues and tournaments",
          "Event photographers at corporate galas and conferences",
          "Graduation photographers capturing ceremony and stage shots",
          "Corporate headshot photographers doing batch sessions",
          "Any photographer who needs to capture, organize, and deliver at scale",
        ],
      }}
      differentiators={{
        description:
          "High-volume work breaks down when you are stitching together separate tools for tethering, editing, gallery delivery, and ordering. Studio OS connects the full workflow.",
        points: [
          {
            title: "Capture at Speed",
            detail:
              "Tethered shooting with live preview, auto-naming, and barcode or QR matching. Shoot fast without losing organization.",
          },
          {
            title: "Instant Organization",
            detail:
              "Photos are sorted by subject, group, or roster automatically during capture. No post-shoot sorting marathons.",
          },
          {
            title: "Multi-Photographer Sync",
            detail:
              "Run multiple camera stations feeding into the same job. All photographers stay synchronized in real time.",
          },
          {
            title: "Scalable Gallery Delivery",
            detail:
              "Deliver hundreds of private galleries at once. Each subject or family gets their own access link and PIN.",
          },
          {
            title: "AI Background Upsells",
            detail:
              "Turn background swaps into a revenue stream. AI handles replacement automatically — no manual Photoshop work at volume.",
          },
          {
            title: "Order Review at Scale",
            detail:
              "Review orders before they go to the lab. Catch cropping issues, wrong packages, or missing subjects before printing.",
          },
        ],
      }}
      features={[
        {
          name: "Online Booking and Automatic Rosters",
          description:
            "Share live appointment availability for school or event jobs and turn confirmed bookings into a time-ordered Studio OS roster.",
        },
        {
          name: "Tethered Capture with Live Preview",
          description:
            "Connect your camera to the Studio OS desktop app for instant preview, naming, and organization as you shoot.",
        },
        {
          name: "Barcode and QR Subject Matching",
          description:
            "Scan barcodes or QR codes during capture to instantly match photos to subjects in your roster.",
        },
        {
          name: "Roster-Based Organization",
          description:
            "Import subject lists before the shoot. Photos are filed by name, group, class, or team automatically.",
        },
        {
          name: "Bulk Gallery Delivery",
          description:
            "Generate and send hundreds of private gallery links in one batch. Parents, students, or employees get immediate access.",
        },
        {
          name: "Online Ordering with Stripe",
          description:
            "Clients order prints, packages, and digital downloads. Payments processed securely through Stripe.",
        },
        {
          name: "AI Background Replacement",
          description:
            "Offer multiple backgrounds as paid add-ons. The AI swap is automatic — no per-image editing required.",
        },
        {
          name: "Print Fulfillment Pipeline",
          description:
            "Send approved orders to your lab. Track production status and automate delivery notifications.",
        },
        {
          name: "Automated Email Workflows",
          description:
            "Trigger gallery access emails, order reminders, and abandoned cart recovery automatically.",
        },
      ]}
      comparisonIntro="High-volume photographers often compare Studio OS Cloud to GotPhoto, PhotoDay, and standalone gallery platforms. Here is how the workflows differ."
      comparisonPoints={[
        {
          label: "Online booking connected to rosters",
          studioOs: "Yes",
          others: "Varies or needs a separate scheduler",
        },
        {
          label: "Built-in camera tethering",
          studioOs: "Yes, included",
          others: "Requires separate software",
        },
        {
          label: "Multi-photographer capture",
          studioOs: "Yes, real-time sync",
          others: "Limited or manual merge",
        },
        {
          label: "AI background replacement",
          studioOs: "Built in as upsell",
          others: "Not available natively",
        },
        {
          label: "Roster-based organization",
          studioOs: "Yes",
          others: "Some platforms",
        },
        {
          label: "Order review before print",
          studioOs: "Yes",
          others: "Varies",
        },
        {
          label: "Desktop + cloud workflow",
          studioOs: "One connected platform",
          others: "Separate tools",
        },
      ]}
      ctaHeading="Built for Volume. Ready When You Are."
      ctaDescription="Start your free trial and see how Studio OS Cloud handles high-volume photography from capture to delivery."
      />
    </>
  );
}

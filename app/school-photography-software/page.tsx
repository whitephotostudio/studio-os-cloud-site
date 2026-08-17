import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/seo-landing-page";
import { BreadcrumbJsonLd } from "@/components/json-ld";

export const metadata: Metadata = {
  title: "School Photography Software | Student Rosters & Galleries",
  description:
    "School photography software for online booking, automatic student rosters, picture-day capture, private parent galleries, ordering, and connected production.",
  alternates: {
    canonical: "https://www.studiooscloud.com/school-photography-software",
  },
  openGraph: {
    title: "School Photography Software | Student Rosters & Ordering | Studio OS Cloud",
    description:
      "Run school picture day from one platform. Online booking, automatic student rosters, galleries, ordering, AI backgrounds, and print fulfillment.",
    url: "https://www.studiooscloud.com/school-photography-software",
  },
};

export default function SchoolPhotographySoftwarePage() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", item: "https://www.studiooscloud.com" },
          {
            name: "School Photography Software",
            item: "https://www.studiooscloud.com/school-photography-software",
          },
        ]}
      />
      <SeoLandingPage
        badge="School Photography"
        headline="School Photography Software Built for Real Photo Day Workflows"
        subheadline="Open online appointments, build the student roster automatically, organize picture day, deliver private galleries, and take orders in one connected workflow."
        introduction="Studio OS Cloud is school photography software built for photographers who need more than just online galleries. Create a school booking link, let students select an available time and pay online, and bring confirmed appointments into the Studio OS student roster—the organized working list of names, IDs, classes, appointment times, and booking status. Match students to photos, organize by class, deliver private parent galleries with PIN access, accept orders, and review before sending to the lab. Whether you shoot one school a month or fifty, Studio OS keeps picture day organized from the first booking to the final print."
        whoItsFor={{
          description:
            "Studio OS Cloud is designed for school and volume photographers who need a system that handles the full picture day workflow, not just gallery delivery.",
          personas: [
            "School portrait photographers running picture days",
            "Volume photographers shooting multiple schools per week",
            "Studios managing class photos, composites, and group shots",
            "Photographers who need organized student-list and roster workflows",
            "Teams with multiple photographers shooting the same school",
            "Anyone tired of juggling spreadsheets, separate tethering apps, and gallery platforms",
          ],
        }}
        differentiators={{
          description:
            "Most school photography platforms cover one part of the workflow. Studio OS connects student roster organization, premium parent galleries, ordering, and production control in one system.",
          points: [
            {
              title: "Online Booking + Automatic Student Rosters",
              detail:
                "Share a school booking link, accept optional sitting-fee payments, and bring confirmed students into a time-ordered Studio OS student roster.",
            },
            {
              title: "Built-in Desktop Tethering",
              detail:
                "Tether your camera directly through the Studio OS desktop app. No need for Capture One, Smart Shooter, or third-party tethering software.",
            },
            {
              title: "Student Roster Import and Matching",
              detail:
                "Import the school’s student name list as a roster and organize photos by student, class, and grade. Match students to their photos during or after capture.",
            },
            {
              title: "Private Parent Galleries",
              detail:
                "Deliver secure parent galleries with PIN access while keeping ordering and delivery connected to the same workflow.",
            },
            {
              title: "AI Background Replacement",
              detail:
                "Offer background changes as an upsell directly in the ordering workflow. No Photoshop batch work needed.",
            },
            {
              title: "Order Review Before Print",
              detail:
                "Review every order before it goes to the lab. Catch issues before they become reprints.",
            },
            {
              title: "Connected Desktop + Cloud",
              detail:
                "Your desktop capture app and cloud galleries are part of one platform. No exporting, uploading, or syncing between separate tools.",
            },
          ],
        }}
        features={[
          {
            name: "Online Picture-Day Booking",
            description:
              "Let students choose a live appointment time, submit class and contact details, and pay an optional sitting fee online.",
          },
          {
            name: "Automatic Student Rosters",
            description:
              "Confirmed appointments create cloud student entries that can be added to the Studio OS desktop student roster for picture day.",
          },
          {
            name: "School Roster Management",
            description:
              "Import a CSV student name list with names, grades, classes, and teacher information. Studio OS turns it into an organized student roster for picture day.",
          },
          {
            name: "Camera Tethering",
            description:
              "Shoot tethered directly from the Studio OS desktop app with live preview, auto-naming, and instant organization.",
          },
          {
            name: "Private Parent Galleries",
            description:
              "Each family gets a private gallery with PIN access. Parents view, select, and order without seeing other students.",
          },
          {
            name: "Online Ordering",
            description:
              "Parents order prints, packages, and digital downloads directly from their gallery. Stripe-powered payments.",
          },
          {
            name: "AI Background Swap",
            description:
              "Offer multiple background options as paid upgrades. AI handles the swap automatically during the ordering flow.",
          },
          {
            name: "Print Fulfillment Integration",
            description:
              "Send reviewed orders to your lab partner. Track fulfillment status and notify parents when prints ship.",
          },
          {
            name: "Multi-Photographer Support",
            description:
              "Multiple photographers capture to the same job simultaneously. Ideal for high-volume picture days with multiple stations.",
          },
          {
            name: "Automated Email Campaigns",
            description:
              "Send gallery access links, order reminders, and delivery notifications automatically.",
          },
        ]}
        comparisonIntro="School photographers often compare Studio OS Cloud to platforms like GotPhoto, PhotoDay, and gallery-only tools like Pixieset. Here is how they differ at a glance."
        comparisonPoints={[
          {
            label: "Online booking with automatic student rosters",
            studioOs: "Yes, connected to the desktop student roster",
            others: "Varies or requires a separate scheduler",
          },
          {
            label: "Built-in camera tethering",
            studioOs: "Yes, desktop app included",
            others: "No (requires Smart Shooter or Capture One)",
          },
          {
            label: "Student list / school roster import",
            studioOs: "Yes",
            others: "Some platforms",
          },
          {
            label: "Private parent galleries with ordering",
            studioOs: "Yes",
            others: "Yes",
          },
          {
            label: "AI background replacement",
            studioOs: "Yes, built in",
            others: "Not available natively",
          },
          {
            label: "Order review before print",
            studioOs: "Yes",
            others: "Varies",
          },
          {
            label: "Desktop + cloud connected",
            studioOs: "Yes, one platform",
            others: "Separate tools required",
          },
        ]}
        ctaHeading="Ready to Simplify Picture Day?"
        ctaDescription="Start your free trial and see how Studio OS Cloud connects your entire school photography workflow from capture to delivery."
      />
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SeoLandingPage } from "@/components/seo-landing-page";

export const metadata: Metadata = {
  title: "GotPhoto Alternative for School Photographers",
  description:
    "Looking for a GotPhoto alternative with built-in tethering and AI backgrounds? Studio OS Cloud connects desktop capture, roster management, galleries, ordering, and fulfillment in one platform — no separate tethering software required.",
  alternates: {
    canonical: "https://www.studiooscloud.com/gotphoto-alternative",
  },
  openGraph: {
    title: "GotPhoto Alternative for School Photographers | Studio OS Cloud",
    description:
      "Built-in tethering, AI backgrounds, rosters, galleries, and ordering. One connected platform instead of GotPhoto plus Smart Shooter.",
    url: "https://www.studiooscloud.com/gotphoto-alternative",
  },
};

export default function GotPhotoAlternativePage() {
  return (
    <>
      <SeoLandingPage
      badge="GotPhoto Alternative"
      headline="A GotPhoto Alternative with Connected Desktop and Cloud Workflow"
      subheadline="GotPhoto handles school photography well. But if you want built-in tethering, AI background upsells, and a truly connected desktop-to-cloud workflow, Studio OS Cloud does it without extra software."
      introduction="GotPhoto is a popular platform for school and volume photographers, handling galleries, ordering, and some workflow automation. But GotPhoto does not include camera tethering — you need Smart Shooter or another third-party app to shoot tethered. And GotPhoto does not offer AI background replacement as a built-in feature. Studio OS Cloud is a GotPhoto alternative that includes a desktop tethering application, AI background tools, roster management, galleries, ordering, and print fulfillment in one connected system. No extra software purchases required."
      whoItsFor={{
        description:
          "Studio OS Cloud is the right GotPhoto alternative if you want everything in one platform instead of stitching together multiple tools.",
        personas: [
          "School photographers who shoot tethered on picture day",
          "Volume photographers who want AI background upsells built in",
          "Studios running multiple camera stations at the same school",
          "Photographers who want order review before lab fulfillment",
          "Teams tired of paying for Smart Shooter on top of GotPhoto",
          "Photographers who want one vendor for capture through delivery",
        ],
      }}
      differentiators={{
        heading: "What Studio OS Cloud Adds Beyond GotPhoto",
        description:
          "GotPhoto handles the gallery-and-ordering side well. Studio OS Cloud does that plus gives you the capture and production tools that GotPhoto requires you to buy separately.",
        points: [
          {
            title: "Built-in Camera Tethering",
            detail:
              "GotPhoto requires Smart Shooter ($150+) for tethered capture. Studio OS includes a full desktop tethering app at no extra cost.",
          },
          {
            title: "AI Background Replacement",
            detail:
              "Offer background swaps as a paid upsell directly in the ordering flow. GotPhoto does not have native AI background tools.",
          },
          {
            title: "One Connected System",
            detail:
              "Your desktop capture app and cloud platform are one product. No integrations to configure, no exports to manage.",
          },
          {
            title: "Multi-Photographer Capture",
            detail:
              "Run multiple cameras feeding into the same job in real time. All stations stay synchronized automatically.",
          },
          {
            title: "Order Review Before Lab",
            detail:
              "Every order passes through your review dashboard before going to the lab. Catch problems before they become reprints.",
          },
          {
            title: "Simpler Pricing",
            detail:
              "One subscription covers your desktop app, cloud platform, galleries, and ordering. No separate tethering license.",
          },
        ],
      }}
      features={[
        {
          name: "Desktop Camera Tethering",
          description:
            "Shoot tethered with live preview, auto-naming, and barcode matching. Included with your subscription.",
        },
        {
          name: "School Roster Import",
          description:
            "Import student rosters with names, grades, and classes. Organize your shoot before picture day.",
        },
        {
          name: "AI Background Upsells",
          description:
            "Parents choose from multiple backgrounds when ordering. The AI swap is automatic and adds revenue per order.",
        },
        {
          name: "Private Parent Galleries",
          description:
            "Each family gets a PIN-protected gallery. Parents view only their student's photos.",
        },
        {
          name: "Online Ordering",
          description:
            "Parents order prints, packages, and digital downloads. Secure Stripe payments.",
        },
        {
          name: "Order Review Dashboard",
          description:
            "Review and approve orders before they go to the lab. Full control over what gets printed.",
        },
        {
          name: "Multi-Photographer Sync",
          description:
            "Multiple photographers capture to the same job simultaneously. No post-shoot merging.",
        },
        {
          name: "Automated Notifications",
          description:
            "Gallery access emails, order reminders, abandoned cart recovery, and delivery notifications.",
        },
      ]}
      comparisonIntro="Here is how Studio OS Cloud and GotPhoto compare across the full school photography workflow."
      comparisonPoints={[
        {
          label: "Built-in camera tethering",
          studioOs: "Yes, included",
          others: "No (requires Smart Shooter)",
        },
        {
          label: "AI background replacement",
          studioOs: "Built in",
          others: "Not available natively",
        },
        {
          label: "School roster import",
          studioOs: "Yes",
          others: "Yes",
        },
        {
          label: "Parent galleries with ordering",
          studioOs: "Yes",
          others: "Yes",
        },
        {
          label: "Multi-photographer capture",
          studioOs: "Yes, real-time sync",
          others: "Limited",
        },
        {
          label: "Order review before print",
          studioOs: "Yes",
          others: "Limited",
        },
        {
          label: "Desktop + cloud in one platform",
          studioOs: "Yes",
          others: "Separate tools needed",
        },
      ]}
      ctaHeading="One Platform. No Extra Software."
      ctaDescription="Start your free trial and see how Studio OS Cloud handles school photography from capture to delivery — with built-in tethering and AI backgrounds."
      />
      <section className="bg-neutral-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl rounded-[2rem] border border-neutral-200 bg-white p-8 sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-center">
            <div>
              <p className="marketing-caption text-xs font-semibold uppercase tracking-[0.18em] text-red-600">
                Keep Comparing
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-neutral-950 sm:text-3xl">
                See the side-by-side comparison.
              </h2>
              <p className="mt-4 text-base leading-7 text-neutral-600">
                Want the feature-by-feature breakdown of Studio OS Cloud versus
                GotPhoto? Read the full comparison, or explore alternatives to other
                photography platforms.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/compare/studio-os-vs-gotphoto"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-neutral-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-black"
              >
                Studio OS vs GotPhoto
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/pixieset-alternative"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-neutral-300 bg-white px-5 py-3 text-sm font-semibold text-neutral-900 transition hover:border-neutral-400"
              >
                Pixieset alternative
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/compare"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-neutral-300 bg-white px-5 py-3 text-sm font-semibold text-neutral-900 transition hover:border-neutral-400"
              >
                All comparisons
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

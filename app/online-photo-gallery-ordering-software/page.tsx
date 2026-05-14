import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Download,
  FolderKanban,
  LockKeyhole,
  ShoppingBag,
  Sparkles,
} from "lucide-react";
import { BreadcrumbJsonLd } from "@/components/json-ld";
import { Reveal } from "@/components/marketing/Reveal";

const baseUrl = "https://www.studiooscloud.com";

export const metadata: Metadata = {
  title: "Premium Online Photo Gallery and Ordering Software for Photographers",
  description:
    "Deliver premium online galleries, private client access, print and digital ordering, and connected workflow visibility from one photography platform.",
  alternates: {
    canonical: `${baseUrl}/online-photo-gallery-ordering-software`,
  },
  openGraph: {
    title: "Premium Online Photo Gallery and Ordering Software | Studio OS Cloud",
    description:
      "Premium galleries with ordering, private access, digital delivery, and deeper workflow connection when you need it.",
    url: `${baseUrl}/online-photo-gallery-ordering-software`,
    images: [
      {
        url: "/marketing/wedding-gallery-cover.jpg",
        width: 1693,
        height: 929,
        alt: "Premium Studio OS Cloud online gallery preview",
      },
    ],
  },
};

const galleryTypes = [
  {
    title: "Wedding Delivery",
    text: "Finished stories, favorites, downloads, and optional print ordering in a quiet branded gallery.",
    image: "/marketing/wedding-gallery-cover.jpg",
  },
  {
    title: "Portrait Proofing",
    text: "A polished review path for portraits, headshots, seniors, families, and studio sessions.",
    image: "/marketing/portrait-gallery-preview-v2.webp",
  },
  {
    title: "Private Parent Galleries",
    text: "PIN-based access, packages, downloads, and order review for school, dance, sports, and volume work.",
    image: "/marketing/school-gallery-cover.jpg",
  },
];

const galleryFeatures = [
  {
    title: "Branded Online Galleries",
    detail:
      "Deliver galleries that feel premium before the client reaches a cart, download, or login moment.",
    icon: Sparkles,
  },
  {
    title: "Private Access and PIN Control",
    detail:
      "Protect galleries when privacy matters for families, schools, teams, private events, or commercial clients.",
    icon: LockKeyhole,
  },
  {
    title: "Print and Package Ordering",
    detail:
      "Sell prints, packages, upgrades, and digital downloads from the gallery experience clients already use.",
    icon: ShoppingBag,
  },
  {
    title: "Projects Stay Connected",
    detail:
      "Keep albums, access, orders, and delivery tied to the same job instead of rebuilding work in separate tools.",
    icon: FolderKanban,
  },
  {
    title: "Digital Delivery",
    detail:
      "Offer individual files or full-gallery downloads with controlled delivery paths for large collections.",
    icon: Download,
  },
  {
    title: "Order Review Before Print",
    detail:
      "Review orders before fulfillment so production quality stays under photographer control.",
    icon: Check,
  },
];

const comparisonRows = [
  ["Premium branded galleries", "Built in", "Common"],
  ["Print and digital ordering", "Built in", "Common"],
  ["Private access and PIN control", "Built in", "Varies"],
  ["Projects and job structure", "Connected", "Limited"],
  ["Order review before print", "Connected", "Varies"],
  ["Desktop + cloud workflow", "Connected", "Usually separate"],
];

const workflowSteps = [
  "Create project",
  "Publish gallery",
  "Client orders",
  "Review production",
  "Deliver files",
];

export default function OnlinePhotoGalleryOrderingSoftwarePage() {
  return (
    <div className="-mt-2 min-h-screen bg-[#f7f7f5] text-neutral-950">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", item: baseUrl },
          {
            name: "Online Galleries & Ordering",
            item: `${baseUrl}/online-photo-gallery-ordering-software`,
          },
        ]}
      />

      <section className="gallery-luxe-hero relative isolate overflow-hidden bg-neutral-950 text-white">
          <Image
            src="/marketing/wedding-gallery-cover.jpg"
            alt="Premium online photo gallery presentation"
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-[0.42]"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.88)_0%,rgba(0,0,0,0.72)_42%,rgba(0,0,0,0.26)_100%)]" />
          <div className="relative z-10 mx-auto grid min-h-[760px] max-w-7xl items-center gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_0.92fr] lg:px-8">
            <Reveal className="max-w-3xl">
              <p className="marketing-kicker text-red-300">Online gallery software</p>
              <h1 className="marketing-display mt-5 max-w-4xl text-white">
                Luxury client galleries with ordering built in.
              </h1>
              <p className="marketing-body mt-7 max-w-2xl text-white/75">
                Deliver branded online galleries, private access, print and digital ordering,
                downloads, and workflow visibility from one connected photography platform.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/sign-up"
                  data-marketing-event="cta_start_trial"
                  data-marketing-label="Luxury gallery hero"
                  data-marketing-placement="online_gallery_hero"
                  className="premium-button inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-neutral-950"
                >
                  Build This Gallery
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/sample-galleries"
                  data-marketing-event="cta_sample_galleries"
                  data-marketing-label="Luxury gallery hero"
                  data-marketing-placement="online_gallery_hero"
                  className="premium-button inline-flex items-center justify-center gap-2 rounded-full border border-white/25 bg-white/[0.08] px-6 py-3 text-sm font-semibold text-white backdrop-blur"
                >
                  View Sample Galleries
                </Link>
              </div>
            </Reveal>

            <Reveal delay={180} className="hidden lg:block">
              <div className="gallery-luxe-device relative ml-auto w-full max-w-[520px] overflow-hidden rounded-[2rem] border border-white/15 bg-white/10 p-3 shadow-[0_42px_140px_rgba(0,0,0,0.58)] backdrop-blur-xl">
                <div className="relative aspect-[4/5] overflow-hidden rounded-[1.5rem] bg-neutral-900">
                  <Image
                    src="/marketing/portrait-gallery-preview-v2.webp"
                    alt="Portrait gallery preview"
                    fill
                    sizes="520px"
                    className="object-cover"
                  />
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_36%,rgba(0,0,0,0.82)_100%)]" />
                  <div className="absolute bottom-0 left-0 right-0 p-7">
                    <p className="text-xs font-semibold uppercase text-white/50">Client gallery</p>
                    <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
                      Portrait Collection
                    </h2>
                    <div className="mt-5 grid grid-cols-3 gap-2">
                      {["Favorites", "Prints", "Downloads"].map((label) => (
                        <span
                          key={label}
                          className="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-center text-xs font-semibold text-white/80"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="gallery-luxe-scan" />
                </div>
              </div>
            </Reveal>
          </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <Reveal className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
            <div>
              <p className="marketing-kicker text-red-600">Premium presentation</p>
              <h2 className="marketing-title mt-4 max-w-2xl">
                The gallery should feel like part of the photography, not just a delivery link.
              </h2>
            </div>
            <p className="marketing-body text-neutral-600">
              Studio OS Cloud is online photo gallery and ordering software for photographers
              who care about presentation as much as operations. Use it for galleries alone, or
              connect it to Projects, production, ordering, and fulfillment when the job needs
              more structure.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {galleryTypes.map((gallery, index) => (
              <Reveal key={gallery.title} delay={index * 90}>
                <article className="gallery-luxe-card group relative min-h-[460px] overflow-hidden rounded-[1.7rem] bg-neutral-950 shadow-[0_24px_80px_rgba(0,0,0,0.14)]">
                  <Image
                    src={gallery.image}
                    alt={`${gallery.title} gallery preview`}
                    fill
                    sizes="(min-width: 1024px) 33vw, 100vw"
                    className="object-cover transition duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.08)_0%,rgba(0,0,0,0.7)_72%,rgba(0,0,0,0.95)_100%)]" />
                  <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
                    <p className="text-xs font-semibold uppercase text-white/50">
                      0{index + 1}
                    </p>
                    <h3 className="mt-2 text-2xl font-semibold tracking-tight">
                      {gallery.title}
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-white/70">
                      {gallery.text}
                    </p>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
      </section>

      <section className="bg-white py-16 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <Reveal className="mx-auto max-w-3xl text-center">
              <p className="marketing-kicker text-red-600">Ordering without friction</p>
              <h2 className="marketing-title mt-4">
                Built for viewing, selecting, buying, and delivering.
              </h2>
              <p className="marketing-body mt-5 text-neutral-600">
                A premium gallery should stay simple for the client while keeping the order
                and production workflow clear for the photographer.
              </p>
            </Reveal>

            <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {galleryFeatures.map((feature, index) => {
                const Icon = feature.icon;
                return (
                  <Reveal key={feature.title} delay={index * 55}>
                    <article className="premium-card h-full rounded-[1.4rem] border border-neutral-200 bg-[#fbfbfa] p-6 shadow-[0_16px_50px_rgba(0,0,0,0.04)]">
                      <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-neutral-950 text-white">
                        <Icon className="h-5 w-5" />
                      </span>
                      <h3 className="mt-5 text-lg font-semibold tracking-tight text-neutral-950">
                        {feature.title}
                      </h3>
                      <p className="mt-3 text-sm leading-6 text-neutral-600">
                        {feature.detail}
                      </p>
                    </article>
                  </Reveal>
                );
              })}
            </div>
          </div>
      </section>

      <section className="bg-[#f7f7f5] py-16 lg:py-24">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <Reveal>
            <p className="marketing-kicker text-red-600">What makes a premium gallery</p>
            <h2 className="marketing-title mt-4 max-w-3xl">
              What photographers should expect from online gallery and ordering software in 2026.
            </h2>
          </Reveal>

          <div className="mt-10 space-y-6 text-base leading-8 text-neutral-700">
            <p>
              Premium online photo gallery software has to do more than host a folder of
              JPEGs behind a password. For working photographers, the gallery is the
              client-facing surface of an entire job — and it is where pricing, ordering,
              upgrades, downloads, and delivery decisions actually happen. A polished
              gallery that is disconnected from production creates the same friction a
              shoebox of prints used to. A connected gallery, by contrast, lets the
              business of selling and delivering photographs run on the same surface
              clients use to view them.
            </p>
            <p>
              Studio OS Cloud is built around that idea. Galleries are not bolted onto an
              upload tool. They are part of a platform that already understands what a
              Project is, who has access, what was ordered, what is in production, and
              what has been delivered. Photographers shooting weddings, portraits, school
              picture day, sports leagues, family sessions, and structured commercial work
              can all use the same gallery system, with the right ordering and access
              behaviors switched on per Project.
            </p>
            <p>
              The premium presentation matters too. Branded covers, typography that does
              not look like a stock template, smooth scrolling, fast image delivery, and
              clear ordering steps are not luxuries — they signal to a client that the
              photographer takes the work seriously. Studio OS Cloud is designed so
              every gallery looks like it came from the photographer, not a generic
              vendor. Clients see a refined experience. Photographers see Projects, orders,
              production status, and delivery progress on the same platform.
            </p>
            <p>
              Online ordering should be just as deliberate. Clients should be able to mark
              favorites, build a cart with prints, packages, upgrades, and digital
              downloads, and complete a secure checkout without leaving the gallery.
              Photographers should be able to review orders, hold or revise items before
              they reach the lab, send abandoned-cart reminders, and trigger delivery
              notifications automatically. Every order should sit inside the same Project
              as the photos themselves — not in a separate invoicing tool that the
              photographer has to reconcile later.
            </p>
            <p>
              Finally, online gallery software should adapt to the kind of photography
              being delivered. A wedding gallery, a school picture day, a portrait session,
              and a corporate headshot batch each have different access, organization, and
              ordering needs. Studio OS Cloud handles those modes inside the same product
              instead of forcing photographers to maintain separate workflows for separate
              job types. The gallery experience stays consistent for clients while the
              workflow underneath adjusts to fit the job.
            </p>
          </div>
        </div>
      </section>

      <section className="overflow-hidden bg-neutral-950 py-16 text-white lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <Reveal className="grid gap-12 lg:grid-cols-[0.88fr_1.12fr] lg:items-center">
              <div>
                <p className="marketing-kicker text-red-300">Connected workflow</p>
                <h2 className="marketing-title mt-4">
                  More than a beautiful upload page.
                </h2>
                <p className="marketing-body mt-6 text-white/70">
                  Many gallery platforms handle presentation well. Studio OS Cloud keeps the
                  gallery connected to the rest of the job: Projects, albums, access, orders,
                  downloads, and review before print.
                </p>
              </div>

              <div className="gallery-workflow-motion rounded-[2rem] border border-white/10 bg-white/[0.06] p-5 shadow-[0_36px_120px_rgba(0,0,0,0.42)]">
                <div className="grid gap-3">
                  {workflowSteps.map((step, index) => (
                    <div
                      key={step}
                      className="gallery-workflow-row flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.07] p-4"
                      style={{ animationDelay: `${index * 110}ms` }}
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-sm font-semibold text-neutral-950">
                        {index + 1}
                      </span>
                      <span className="text-sm font-semibold text-white">{step}</span>
                      <span className="ml-auto h-2 w-16 rounded-full bg-red-400/70" />
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
      </section>

      <section className="bg-[#f7f7f5] py-16 lg:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <Reveal className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
              <div>
                <p className="marketing-kicker text-red-600">Best fit</p>
                <h2 className="marketing-title mt-4">
                  Use it for galleries alone, or connect the full job.
                </h2>
                <p className="marketing-body mt-5 text-neutral-600">
                  Studio OS Cloud works for portrait, wedding, event, school, sports, and
                  studio photographers who want premium client presentation with more control
                  behind it.
                </p>
              </div>

              <div className="overflow-hidden rounded-[1.6rem] border border-neutral-200 bg-white shadow-[0_20px_70px_rgba(0,0,0,0.07)]">
                <div className="grid grid-cols-[1.2fr_0.7fr_0.7fr] border-b border-neutral-200 bg-neutral-950 px-5 py-4 text-sm font-semibold text-white">
                  <span>Capability</span>
                  <span>Studio OS</span>
                  <span>Others</span>
                </div>
                <div className="divide-y divide-neutral-100">
                  {comparisonRows.map(([label, studioOs, others]) => (
                    <div
                      key={label}
                      className="grid grid-cols-[1.2fr_0.7fr_0.7fr] gap-3 px-5 py-4 text-sm"
                    >
                      <span className="font-medium text-neutral-800">{label}</span>
                      <span className="font-semibold text-neutral-950">{studioOs}</span>
                      <span className="text-neutral-500">{others}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
      </section>

      <section className="px-4 pb-20 sm:px-6 lg:px-8">
          <Reveal className="cta-glow mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-[linear-gradient(135deg,#070707,#1b0505_54%,#050505)] px-6 py-14 text-center text-white shadow-[0_36px_120px_rgba(0,0,0,0.22)] sm:px-10 lg:px-14">
            <div className="relative z-10 mx-auto max-w-3xl">
              <p className="marketing-kicker text-red-300">Great galleries. Deeper control.</p>
              <h2 className="marketing-title mt-4">
                Deliver galleries that feel premium and stay connected to the work behind them.
              </h2>
              <p className="marketing-body mx-auto mt-5 max-w-2xl text-white/70">
                Start with client presentation. Add ordering, downloads, private access,
                Projects, and production review when your workflow needs more.
              </p>
              <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
                <Link
                  href="/sign-up"
                  data-marketing-event="cta_start_trial"
                  data-marketing-label="Online gallery luxury page final CTA"
                  data-marketing-placement="online_gallery_final"
                  className="premium-button inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-neutral-950"
                >
                  Start Free Trial
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/pricing"
                  data-marketing-event="cta_view_pricing"
                  data-marketing-label="Online gallery luxury page final CTA"
                  data-marketing-placement="online_gallery_final"
                  className="premium-button inline-flex items-center justify-center rounded-full border border-white/15 bg-white/[0.08] px-6 py-3 text-sm font-semibold text-white"
                >
                  View Pricing
                </Link>
              </div>
            </div>
          </Reveal>
      </section>
    </div>
  );
}

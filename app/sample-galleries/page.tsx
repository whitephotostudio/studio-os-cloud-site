import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  FolderKanban,
  LockKeyhole,
  ShoppingBag,
  Sparkles,
} from "lucide-react";
import { BreadcrumbJsonLd } from "@/components/json-ld";
import { Reveal } from "@/components/marketing/Reveal";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

const baseUrl = "https://www.studiooscloud.com";

export const metadata: Metadata = {
  title: "Sample Photo Galleries for Photographers",
  description:
    "Explore Studio OS Cloud sample galleries for weddings, portraits, schools, sports, and events. Premium client presentation connected to ordering, downloads, and workflow control.",
  alternates: {
    canonical: `${baseUrl}/sample-galleries`,
  },
  openGraph: {
    title: "Studio OS Cloud Sample Galleries",
    description:
      "See how Studio OS Cloud presents client galleries while keeping ordering, downloads, and production workflow connected.",
    url: `${baseUrl}/sample-galleries`,
    images: [
      {
        url: "/marketing/portrait-gallery-preview-v2.webp",
        width: 1200,
        height: 900,
        alt: "Studio OS Cloud sample photo gallery preview",
      },
    ],
  },
};

type GallerySample = {
  audience: string;
  clientExperience: string[];
  image: string;
  number: string;
  productionControl: string[];
  slug: string;
  summary: string;
  title: string;
};

const gallerySamples: GallerySample[] = [
  {
    number: "01",
    slug: "wedding-gallery",
    title: "Wedding Gallery",
    audience: "Weddings, engagements, elopements, and finished story delivery",
    summary:
      "A clean, emotional gallery presentation for finished stories, favorites, downloads, and optional ordering.",
    image: "/marketing/wedding-gallery-cover.jpg",
    clientExperience: [
      "Large visual lead image with simple navigation",
      "Favorites and digital delivery for finished collections",
      "Private client access without making the gallery feel locked down",
    ],
    productionControl: [
      "Albums stay connected to the project",
      "Download delivery can be split reliably for large galleries",
      "Ordering and fulfillment stay visible after delivery",
    ],
  },
  {
    number: "02",
    slug: "portrait-gallery",
    title: "Portrait Gallery",
    audience: "Portrait studios, headshots, families, seniors, and branding sessions",
    summary:
      "A polished proofing experience for sessions where clients need to review, select, order, and download confidently.",
    image: "/marketing/portrait-gallery-preview-v2.webp",
    clientExperience: [
      "Professional proofing with clear photo hierarchy",
      "Order-ready presentation for prints and digital products",
      "Mobile-friendly viewing for quick client review",
    ],
    productionControl: [
      "Selections remain tied to the same job",
      "Orders can be reviewed before production",
      "Repeatable workflow for everyday studio sessions",
    ],
  },
  {
    number: "03",
    slug: "school-gallery",
    title: "School Gallery",
    audience: "Schools, preschools, dance studios, and private parent galleries",
    summary:
      "A parent-friendly gallery flow with private access, ordering, and production organization behind the scenes.",
    image: "/marketing/school-gallery-cover.jpg",
    clientExperience: [
      "Private access for each family or subject",
      "Simple ordering path for packages, prints, and downloads",
      "Clear gallery experience on phones and desktop",
    ],
    productionControl: [
      "Projects, classes, roles, and albums stay organized",
      "Roster and capture workflow can connect to delivery",
      "High-volume jobs stay structured after launch",
    ],
  },
  {
    number: "04",
    slug: "sports-gallery",
    title: "Sports Gallery",
    audience: "Teams, leagues, athletes, media days, and deadline-driven jobs",
    summary:
      "A fast gallery experience for organized team delivery, individual access, package sales, and production deadlines.",
    image: "/marketing/sports-gallery-cover-generated.png",
    clientExperience: [
      "Team and athlete presentation that feels organized",
      "Ordering paths for packages and individual products",
      "Download and delivery controls for finished images",
    ],
    productionControl: [
      "Project structure supports teams, groups, and albums",
      "Sales and fulfillment stay connected to the gallery",
      "Designed for repeatable seasonal production",
    ],
  },
  {
    number: "05",
    slug: "event-gallery",
    title: "Event Gallery",
    audience: "Corporate events, galas, conferences, dances, and community work",
    summary:
      "A refined gallery format for event coverage where clients need a finished presentation without operational clutter.",
    image: "/marketing/event-gallery-preview-v2.webp",
    clientExperience: [
      "Editorial-style gallery preview with fast scanning",
      "Favorites, downloads, and ordering where needed",
      "Branded delivery for client-facing events",
    ],
    productionControl: [
      "Albums can separate moments, sponsors, or sessions",
      "Digital delivery stays attached to the job",
      "Workflow visibility continues after the gallery is shared",
    ],
  },
];

const galleryPrinciples = [
  {
    title: "Presentation first",
    text: "Gallery pages should feel premium before clients ever reach a cart, download, or login moment.",
    icon: Sparkles,
  },
  {
    title: "Private when needed",
    text: "PIN and access workflows support sensitive jobs without making everyday gallery delivery feel heavy.",
    icon: LockKeyhole,
  },
  {
    title: "Ordering ready",
    text: "Prints, packages, digital downloads, and order review stay connected to the same gallery workflow.",
    icon: ShoppingBag,
  },
  {
    title: "Built for real jobs",
    text: "Projects, albums, and production state keep the public gallery connected to the work behind it.",
    icon: FolderKanban,
  },
];

export default function SampleGalleriesPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", item: baseUrl },
          { name: "Sample Galleries", item: `${baseUrl}/sample-galleries` },
        ]}
      />
      <SiteHeader />

      <main className="overflow-hidden">
        <section className="relative bg-neutral-950 px-4 py-20 text-white sm:px-6 lg:px-8 lg:py-28">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_16%,rgba(239,68,68,0.28),transparent_33%),radial-gradient(circle_at_78%_8%,rgba(255,255,255,0.08),transparent_28%),linear-gradient(135deg,#050505,#1a0607_54%,#050505)]" />
          <div className="relative mx-auto max-w-7xl">
            <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
              <Reveal className="max-w-3xl">
                <p className="marketing-kicker text-red-300">
                  Sample Galleries
                </p>
                <h1 className="marketing-display mt-5">
                  The full Studio OS gallery showroom.
                </h1>
                <p className="marketing-body mt-6 max-w-2xl text-white/68">
                  Explore how Studio OS Cloud can present weddings, portraits,
                  schools, sports, and events with polished client delivery,
                  ordering, downloads, private access, and workflow control
                  behind the scenes.
                </p>
                <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                  <Link
                    href="#gallery-showroom"
                    data-marketing-event="cta_browse_gallery_types"
                    data-marketing-label="Sample galleries hero"
                    data-marketing-placement="sample_galleries_hero"
                    className="marketing-button premium-button inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-neutral-950 transition hover:bg-neutral-100"
                  >
                    Browse Gallery Types
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href="/sample-galleries/demo"
                    data-marketing-event="sample_gallery_card"
                    data-marketing-label="Interactive gallery demo"
                    data-marketing-placement="sample_galleries_hero"
                    className="marketing-button premium-button inline-flex items-center justify-center rounded-full border border-white/20 bg-white/10 px-5 py-3 text-white transition hover:bg-white/20"
                  >
                    Try Interactive Demo
                  </Link>
                </div>
              </Reveal>

              <Reveal delay={140} className="grid gap-3 sm:grid-cols-2">
                {galleryPrinciples.map((principle) => (
                  <article
                    key={principle.title}
                    className="rounded-[1.25rem] border border-white/10 bg-white/[0.06] p-5 backdrop-blur"
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-red-200">
                      <principle.icon className="h-5 w-5" />
                    </div>
                    <h2 className="marketing-card-title mt-5 text-[1.1rem] text-white">
                      {principle.title}
                    </h2>
                    <p className="marketing-caption mt-3 text-white/58">
                      {principle.text}
                    </p>
                  </article>
                ))}
              </Reveal>
            </div>
          </div>
        </section>

        <section
          id="gallery-showroom"
          className="scroll-mt-28 bg-white px-4 py-16 sm:px-6 lg:px-8 lg:py-24"
        >
          <div className="mx-auto max-w-7xl">
            <Reveal className="max-w-3xl">
              <p className="marketing-kicker text-red-600">
                Gallery Showroom
              </p>
              <h2 className="marketing-title mt-4">
                Five client-facing gallery paths to explore.
              </h2>
              <p className="marketing-body mt-5 text-neutral-600">
                The homepage gives a quick preview. This page shows the
                complete gallery menu by job type, client experience, and
                studio control.
              </p>
            </Reveal>

            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
              {gallerySamples.map((gallery, index) => (
                <Reveal key={gallery.slug} delay={index * 70}>
                  <Link
                    href={`#${gallery.slug}`}
                    data-marketing-event="sample_gallery_card"
                    data-marketing-label={gallery.title}
                    data-marketing-placement="sample_galleries_grid"
                    className="premium-card group block h-full overflow-hidden rounded-[1.5rem] border border-neutral-200 bg-white shadow-sm"
                  >
                    <div className="relative aspect-[4/5] overflow-hidden bg-neutral-100">
                      <Image
                        src={gallery.image}
                        alt={`${gallery.title} preview`}
                        fill
                        sizes="(max-width: 639px) 92vw, (max-width: 1023px) 45vw, 240px"
                        className="object-cover transition duration-700 group-hover:scale-105"
                        priority={index < 2}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/76 via-black/12 to-transparent" />
                      <div className="absolute bottom-4 left-4 right-4 text-white">
                        <p className="marketing-kicker text-white/58">
                          {gallery.number}
                        </p>
                        <h3 className="marketing-card-title mt-2">
                          {gallery.title}
                        </h3>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="marketing-caption text-neutral-600">
                        {gallery.summary}
                      </p>
                    </div>
                  </Link>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-neutral-50 px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="mx-auto grid max-w-7xl gap-8">
            {gallerySamples.map((gallery, index) => (
              <Reveal key={gallery.slug} delay={index * 80}>
                <article
                  id={gallery.slug}
                  className="grid scroll-mt-28 overflow-hidden rounded-[2rem] border border-neutral-200 bg-white shadow-[0_18px_70px_rgba(0,0,0,0.07)] lg:grid-cols-[1.03fr_.97fr]"
                >
                  <div className="relative min-h-[360px] bg-neutral-100 sm:min-h-[460px]">
                    <Image
                      src={gallery.image}
                      alt={`${gallery.title} full-width sample preview`}
                      fill
                      sizes="(max-width: 1023px) 100vw, 640px"
                      className="object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/72 via-black/12 to-transparent lg:bg-gradient-to-r lg:from-black/20 lg:via-transparent lg:to-transparent" />
                    <div className="absolute bottom-6 left-6 right-6 text-white">
                      <p className="marketing-kicker text-white/62">
                        {gallery.number}
                      </p>
                      <h2 className="marketing-title mt-2 text-white">
                        {gallery.title}
                      </h2>
                    </div>
                  </div>

                  <div className="p-6 sm:p-8 lg:p-10">
                    <p className="marketing-kicker text-red-600">
                      {gallery.audience}
                    </p>
                    <p className="marketing-body mt-5 text-neutral-600">
                      {gallery.summary}
                    </p>

                    <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                      <FeatureColumn
                        title="Client experience"
                        items={gallery.clientExperience}
                      />
                      <FeatureColumn
                        title="Studio control"
                        items={gallery.productionControl}
                      />
                    </div>

                    <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                      <Link
                        href="/sign-up"
                        data-marketing-event="cta_start_trial"
                        data-marketing-label={gallery.title}
                        data-marketing-placement="sample_gallery_detail"
                        className="marketing-button premium-button inline-flex items-center justify-center gap-2 rounded-full bg-neutral-950 px-5 py-3 text-white transition hover:bg-black"
                      >
                        Build This Workflow
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                      <Link
                        href="/online-photo-gallery-ordering-software"
                        className="marketing-button premium-button inline-flex items-center justify-center gap-2 rounded-full border border-neutral-200 bg-white px-5 py-3 text-neutral-950 transition hover:border-neutral-300"
                      >
                        Online Gallery Software
                      </Link>
                    </div>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="bg-white px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <Reveal className="mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-neutral-950 p-6 text-white shadow-2xl sm:p-8 lg:p-10">
            <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <p className="marketing-kicker text-red-300">
                  Delivery + Workflow
                </p>
                <h2 className="marketing-title mt-4">
                  The gallery should look premium. The job behind it should stay organized.
                </h2>
                <p className="marketing-body mt-5 max-w-3xl text-white/62">
                  Studio OS Cloud keeps gallery presentation connected to
                  Projects, access, ordering, downloads, and fulfillment control.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:w-[420px]">
                {[
                  { href: "/studio-os", label: "Explore Studio OS" },
                  { href: "/pricing", label: "View Pricing" },
                  { href: "/pixieset-alternative", label: "Pixieset Alternative" },
                  {
                    href: "/photography-workflow-software",
                    label: "Workflow Software",
                  },
                ].map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="marketing-button premium-button inline-flex items-center justify-between rounded-2xl border border-white/12 bg-white/[0.06] px-4 py-3 text-white transition hover:bg-white/[0.1]"
                  >
                    {link.label}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ))}
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function FeatureColumn({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-[1.25rem] border border-neutral-200 bg-neutral-50 p-5">
      <h3 className="marketing-kicker text-neutral-500">{title}</h3>
      <ul className="mt-5 space-y-4">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-sm leading-6 text-neutral-700">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
              <Check className="h-3.5 w-3.5" />
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

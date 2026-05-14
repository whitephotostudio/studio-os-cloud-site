import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  FolderKanban,
  LockKeyhole,
  MonitorUp,
  PanelsTopLeft,
  ShieldCheck,
  ShoppingBag,
} from "lucide-react";
import { BreadcrumbJsonLd } from "@/components/json-ld";
import { Reveal } from "@/components/marketing/Reveal";

const baseUrl = "https://www.studiooscloud.com";

export const metadata: Metadata = {
  title: "Pixieset Alternative for Premium Galleries and Workflow Depth",
  description:
    "A refined Pixieset alternative for photographers who want premium online galleries plus Projects, production control, ordering, and connected desktop + cloud workflow.",
  alternates: {
    canonical: `${baseUrl}/pixieset-alternative`,
  },
  openGraph: {
    title: "Pixieset Alternative for Premium Galleries | Studio OS Cloud",
    description:
      "Pixieset is strong for polished galleries, websites, and simple business tools. Studio OS Cloud goes deeper on Projects, production control, and connected workflow.",
    url: `${baseUrl}/pixieset-alternative`,
    images: [
      {
        url: "/marketing/portrait-gallery-preview-v2.webp",
        width: 1200,
        height: 900,
        alt: "Studio OS Cloud premium gallery workflow preview",
      },
    ],
  },
};

const studioAdds = [
  {
    title: "Projects Before Galleries",
    detail:
      "Keep albums, access, orders, delivery, and production tied to a real job instead of only a gallery list.",
    icon: FolderKanban,
  },
  {
    title: "Desktop + Cloud Workflow",
    detail:
      "Connect capture and production work to cloud galleries when the job needs more control before upload.",
    icon: MonitorUp,
  },
  {
    title: "Premium Gallery Delivery",
    detail:
      "Deliver branded galleries, favorites, ordering, downloads, and private access in a polished client experience.",
    icon: PanelsTopLeft,
  },
  {
    title: "Order Review Control",
    detail:
      "Review orders before print or fulfillment so production quality stays with the photographer.",
    icon: ShieldCheck,
  },
  {
    title: "Private Access",
    detail:
      "Use PIN-based and controlled access when privacy matters for families, events, teams, or commercial clients.",
    icon: LockKeyhole,
  },
  {
    title: "Print + Digital Ordering",
    detail:
      "Sell prints, packages, upgrades, and digital downloads from the same gallery experience.",
    icon: ShoppingBag,
  },
];

const workflowSteps = [
  "Create project",
  "Organize albums",
  "Publish gallery",
  "Client orders",
  "Review production",
  "Deliver files",
];

const comparisonRows = [
  {
    label: "Polished client galleries",
    pixieset: "Strong",
    studio: "Strong",
  },
  {
    label: "Website and broad business tools",
    pixieset: "Strong",
    studio: "Not the core focus",
  },
  {
    label: "Projects and job structure",
    pixieset: "Gallery-centered",
    studio: "Connected operating layer",
  },
  {
    label: "Desktop + cloud workflow",
    pixieset: "Usually separate",
    studio: "Connected",
  },
  {
    label: "Order review before print",
    pixieset: "Workflow dependent",
    studio: "Built for production control",
  },
  {
    label: "Structured jobs and volume work",
    pixieset: "General-purpose",
    studio: "Designed for deeper workflow",
  },
];

const bestFitCards = [
  {
    title: "Choose Pixieset if",
    points: [
      "You want an established gallery-first cloud suite.",
      "Website, store, booking, and simple business tools are the center of your workflow.",
      "Most of the work starts after the shoot and stays client-facing.",
    ],
  },
  {
    title: "Choose Studio OS Cloud if",
    points: [
      "The gallery is only one part of a larger production job.",
      "You need Projects, order review, private access, and delivery tied together.",
      "Desktop capture, cloud publishing, and workflow control matter as much as presentation.",
    ],
  },
];

export default function PixiesetAlternativePage() {
  return (
    <div className="-mt-2 min-h-screen bg-[#f7f7f5] text-neutral-950">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", item: baseUrl },
          {
            name: "Pixieset Alternative",
            item: `${baseUrl}/pixieset-alternative`,
          },
        ]}
      />

      <section className="gallery-luxe-hero relative isolate overflow-hidden bg-neutral-950 text-white">
        <Image
          src="/marketing/portrait-gallery-preview-v2.webp"
          alt="Premium gallery and workflow preview"
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-[0.32]"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.93)_0%,rgba(0,0,0,0.78)_48%,rgba(0,0,0,0.42)_100%)]" />
        <div className="relative z-10 mx-auto grid min-h-[760px] max-w-7xl items-center gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_0.9fr] lg:px-8">
          <Reveal className="max-w-3xl">
            <p className="marketing-kicker text-red-300">Pixieset alternative</p>
            <h1 className="marketing-display mt-5 max-w-4xl text-white">
              A luxury gallery experience with deeper workflow behind it.
            </h1>
            <p className="marketing-body mt-7 max-w-2xl text-white/75">
              Pixieset is strong for polished galleries, websites, and simple client delivery.
              Studio OS Cloud is built for photographers who want premium galleries too, plus
              Projects, order control, and connected desktop + cloud workflow.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/sign-up"
                data-marketing-event="cta_start_trial"
                data-marketing-label="Pixieset alternative hero"
                data-marketing-placement="pixieset_alternative_hero"
                className="premium-button inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-neutral-950"
              >
                Build This Workflow
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/online-photo-gallery-ordering-software"
                data-marketing-event="cta_gallery_software"
                data-marketing-label="Pixieset alternative hero"
                data-marketing-placement="pixieset_alternative_hero"
                className="premium-button inline-flex items-center justify-center rounded-full border border-white/25 bg-white/[0.08] px-6 py-3 text-sm font-semibold text-white backdrop-blur"
              >
                Online Gallery Software
              </Link>
            </div>
          </Reveal>

          <Reveal delay={180} className="hidden lg:block">
            <div className="gallery-luxe-device relative ml-auto w-full max-w-[540px] overflow-hidden rounded-[2rem] border border-white/15 bg-white/10 p-3 shadow-[0_42px_140px_rgba(0,0,0,0.58)] backdrop-blur-xl">
              <div className="relative aspect-[1.04/1] overflow-hidden rounded-[1.5rem] bg-neutral-900">
                <Image
                  src="/marketing/wedding-gallery-cover.jpg"
                  alt="Premium online gallery preview"
                  fill
                  sizes="540px"
                  className="object-cover"
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.08)_0%,rgba(0,0,0,0.86)_100%)]" />
                <div className="absolute inset-x-5 bottom-5 rounded-[1.2rem] border border-white/15 bg-black/42 p-5 backdrop-blur-md">
                  <p className="text-xs font-semibold uppercase text-white/50">Connected job</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
                    Gallery + orders + production
                  </h2>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {["Project", "Gallery", "Review"].map((label) => (
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
        <Reveal className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
          <div>
            <p className="marketing-kicker text-red-600">Different center of gravity</p>
            <h2 className="marketing-title mt-4 max-w-2xl">
              Both can present work well. Studio OS is built around the job behind the gallery.
            </h2>
          </div>
          <p className="marketing-body text-neutral-600">
            The choice is not about whether galleries should look polished. They should.
            The question is whether your business also needs Projects, capture-to-delivery
            structure, production review, and workflow visibility after the client starts ordering.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          {bestFitCards.map((card, index) => (
            <Reveal key={card.title} delay={index * 90}>
              <article className="gallery-luxe-card h-full rounded-[1.6rem] border border-neutral-200 bg-white p-7 shadow-[0_20px_70px_rgba(0,0,0,0.07)]">
                <h3 className="text-2xl font-semibold tracking-tight text-neutral-950">
                  {card.title}
                </h3>
                <div className="mt-6 grid gap-4">
                  {card.points.map((point) => (
                    <div key={point} className="flex gap-3">
                      <span className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                      <p className="text-sm leading-6 text-neutral-600">{point}</p>
                    </div>
                  ))}
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="bg-white py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal className="mx-auto max-w-3xl text-center">
            <p className="marketing-kicker text-red-600">What Studio OS adds</p>
            <h2 className="marketing-title mt-4">
              Premium galleries, connected to real production workflow.
            </h2>
            <p className="marketing-body mt-5 text-neutral-600">
              Studio OS Cloud keeps client presentation strong while giving the studio a more
              structured operating layer for work that does not fit neatly inside a gallery-only flow.
            </p>
          </Reveal>

          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {studioAdds.map((feature, index) => {
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

      <section className="overflow-hidden bg-neutral-950 py-16 text-white lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Reveal className="grid gap-12 lg:grid-cols-[0.88fr_1.12fr] lg:items-center">
            <div>
              <p className="marketing-kicker text-red-300">Motion through the workflow</p>
              <h2 className="marketing-title mt-4">
                From project to gallery to production review.
              </h2>
              <p className="marketing-body mt-6 text-white/70">
                Studio OS is designed for the full path: organize the job, publish the gallery,
                collect orders, review production, and deliver files without losing the context
                that started the work.
              </p>
            </div>

            <div className="gallery-workflow-motion rounded-[2rem] border border-white/10 bg-white/[0.06] p-5 shadow-[0_36px_120px_rgba(0,0,0,0.42)]">
              <div className="grid gap-3">
                {workflowSteps.map((step, index) => (
                  <div
                    key={step}
                    className="gallery-workflow-row flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.07] p-4"
                    style={{ animationDelay: `${index * 105}ms` }}
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
          <Reveal className="grid gap-10 lg:grid-cols-[0.88fr_1.12fr] lg:items-start">
            <div>
              <p className="marketing-kicker text-red-600">Respectful comparison</p>
              <h2 className="marketing-title mt-4">
                Pixieset is strong for client-facing simplicity. Studio OS goes deeper behind it.
              </h2>
              <p className="marketing-body mt-5 text-neutral-600">
                This page should not make Pixieset sound weak. It should make the tradeoff clear:
                Pixieset is a polished cloud suite, while Studio OS Cloud is a gallery and
                workflow platform for photographers who need more operational depth.
              </p>
            </div>

            <div className="overflow-hidden rounded-[1.6rem] border border-neutral-200 bg-white shadow-[0_20px_70px_rgba(0,0,0,0.07)]">
              <div className="grid grid-cols-[1fr_0.82fr_0.95fr] border-b border-neutral-200 bg-neutral-950 px-5 py-4 text-sm font-semibold text-white">
                <span>Capability</span>
                <span>Pixieset</span>
                <span>Studio OS</span>
              </div>
              <div className="divide-y divide-neutral-100">
                {comparisonRows.map((row) => (
                  <div
                    key={row.label}
                    className="grid grid-cols-[1fr_0.82fr_0.95fr] gap-3 px-5 py-4 text-sm"
                  >
                    <span className="font-medium text-neutral-800">{row.label}</span>
                    <span className="text-neutral-500">{row.pixieset}</span>
                    <span className="font-semibold text-neutral-950">{row.studio}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="px-4 pb-12 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-7xl rounded-[2rem] border border-neutral-200 bg-neutral-50 p-8 sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-center">
            <div>
              <p className="marketing-kicker text-red-600">Keep Comparing</p>
              <h2 className="marketing-title mt-3 text-neutral-950">
                See the side-by-side comparison.
              </h2>
              <p className="marketing-body mt-4 text-neutral-600">
                Want a feature-by-feature breakdown of Studio OS Cloud versus Pixieset?
                Read the full comparison, or explore alternatives to other photography
                platforms.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/compare/studio-os-vs-pixieset"
                className="premium-button inline-flex items-center justify-center gap-2 rounded-full bg-neutral-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-black"
              >
                Studio OS vs Pixieset
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/gotphoto-alternative"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-neutral-300 bg-white px-5 py-3 text-sm font-semibold text-neutral-900 transition hover:border-neutral-400"
              >
                GotPhoto alternative
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
        </Reveal>
      </section>

      <section className="px-4 pb-20 sm:px-6 lg:px-8">
        <Reveal className="cta-glow mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-[linear-gradient(135deg,#070707,#1b0505_54%,#050505)] px-6 py-14 text-center text-white shadow-[0_36px_120px_rgba(0,0,0,0.22)] sm:px-10 lg:px-14">
          <div className="relative z-10 mx-auto max-w-3xl">
            <p className="marketing-kicker text-red-300">Galleries plus operating depth</p>
            <h2 className="marketing-title mt-4">
              Choose Studio OS when the work behind the gallery matters.
            </h2>
            <p className="marketing-body mx-auto mt-5 max-w-2xl text-white/70">
              Start with premium presentation. Add Projects, private access, ordering,
              production review, and desktop + cloud workflow when your studio needs more.
            </p>
            <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href="/sign-up"
                data-marketing-event="cta_start_trial"
                data-marketing-label="Pixieset alternative final CTA"
                data-marketing-placement="pixieset_alternative_final"
                className="premium-button inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-neutral-950"
              >
                Start Free Trial
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/sample-galleries"
                data-marketing-event="cta_sample_galleries"
                data-marketing-label="Pixieset alternative final CTA"
                data-marketing-placement="pixieset_alternative_final"
                className="premium-button inline-flex items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.08] px-6 py-3 text-sm font-semibold text-white"
              >
                View Sample Galleries
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
}

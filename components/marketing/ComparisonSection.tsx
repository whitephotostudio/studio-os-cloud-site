import Link from "next/link";
import {
  ArrowRight,
  Camera,
  FolderKanban,
  Monitor,
  PackageCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { Reveal } from "./Reveal";

const competitorLinks = [
  { slug: "pixieset", label: "Pixieset" },
  { slug: "gotphoto", label: "GotPhoto" },
  { slug: "photoday", label: "PhotoDay" },
  { slug: "shootproof", label: "ShootProof" },
  { slug: "smugmug", label: "SmugMug" },
  { slug: "zenfolio", label: "Zenfolio" },
  { slug: "zno", label: "Zno" },
];

const featureCards = [
  {
    title: "Premium Online Galleries",
    text: "Deliver branded galleries, client ordering, downloads, and private access as a core part of the platform.",
    icon: Camera,
  },
  {
    title: "Projects That Organize Real Jobs",
    text: "Keep albums, access, orders, and delivery tied to the same job instead of scattered across folders and extra tools.",
    icon: FolderKanban,
  },
  {
    title: "Desktop + Cloud Connected Workflow",
    text: "Capture locally, publish to the cloud, and keep the work moving without an export-and-upload gap.",
    icon: Monitor,
  },
  {
    title: "Structured Workflows at Scale",
    text: "Stay organized across school, sports, event, and multi-photographer jobs without losing polish for portrait and client delivery.",
    icon: Users,
  },
  {
    title: "AI Background Revenue",
    text: "Offer AI background upgrades and enhancements while keeping pricing and production under your control.",
    icon: Sparkles,
  },
  {
    title: "Full Order Control",
    text: "Review and verify orders before print so fulfillment stays under your control.",
    icon: PackageCheck,
  },
];

export function ComparisonSection() {
  return (
    <section className="bg-white px-4 py-20 text-neutral-950 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-7xl rounded-[2rem] border border-neutral-200 bg-white p-5 shadow-sm sm:p-8 lg:p-10">
        <Reveal className="max-w-4xl">
          <p className="marketing-kicker text-red-600">
            Why It Stands Apart
          </p>
          <h2 className="marketing-title mt-4">
            Built for Workflow, Not Just Delivery
          </h2>
          <p className="marketing-body mt-5 text-neutral-600">
            Studio OS gives photographers premium galleries as a core product,
            then goes deeper with Projects, production control, and connected
            desktop + cloud workflow.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {featureCards.map((card, index) => (
            <Reveal key={card.title} delay={80 + index * 45}>
              <article className="premium-card group flex h-full min-h-[280px] flex-col rounded-[1.5rem] border border-neutral-200 bg-white p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-red-200 hover:shadow-xl">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-red-200 bg-red-50 text-red-600 transition duration-300 group-hover:scale-105 group-hover:bg-red-600 group-hover:text-white">
                  <card.icon className="h-5 w-5" />
                </span>
                <h3 className="marketing-card-title mt-7 text-neutral-950">
                  {card.title}
                </h3>
                <p className="marketing-body mt-5 text-[1rem] leading-7 text-neutral-600">
                  {card.text}
                </p>
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal delay={120}>
          <div className="mt-10 flex flex-col items-start justify-between gap-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-5 sm:flex-row sm:items-center sm:p-6">
            <div>
              <p className="marketing-caption text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Already evaluating an alternative?
              </p>
              <p className="mt-1 text-base font-medium text-neutral-900">
                See how Studio OS Cloud compares to the platform you are considering.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {competitorLinks.map((entry) => (
                <Link
                  key={entry.slug}
                  href={`/compare/studio-os-vs-${entry.slug}`}
                  className="marketing-caption inline-flex items-center rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:border-neutral-300 hover:text-neutral-950"
                >
                  vs {entry.label}
                </Link>
              ))}
              <Link
                href="/compare"
                className="marketing-caption inline-flex items-center gap-1 rounded-full bg-neutral-950 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-black"
              >
                All comparisons
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

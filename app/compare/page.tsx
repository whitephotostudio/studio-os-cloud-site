import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BreadcrumbJsonLd } from "@/components/json-ld";

const baseUrl = "https://www.studiooscloud.com";

export const metadata: Metadata = {
  title: "Compare Studio OS Cloud to Other Photography Platforms (2026)",
  description:
    "Side-by-side comparisons of Studio OS Cloud vs Pixieset, GotPhoto, PhotoDay, ShootProof, SmugMug, Zenfolio, and Zno. Find the right photography gallery and workflow platform for your business.",
  alternates: { canonical: `${baseUrl}/compare` },
  openGraph: {
    title: "Compare Studio OS Cloud vs Other Photography Platforms",
    description:
      "Detailed comparisons of Studio OS Cloud against the leading photography gallery, ordering, and workflow platforms.",
    url: `${baseUrl}/compare`,
  },
};

type CompareCard = {
  slug: string;
  competitor: string;
  tagline: string;
  bestFor: string;
};

const comparisons: CompareCard[] = [
  {
    slug: "studio-os-vs-pixieset",
    competitor: "Pixieset",
    tagline:
      "Galleries vs workflow depth. Pixieset leads on polished websites and CRM. Studio OS Cloud goes deeper on Projects, production control, and connected desktop + cloud workflow.",
    bestFor: "Photographers outgrowing a gallery-only stack who want Projects and capture control",
  },
  {
    slug: "studio-os-vs-gotphoto",
    competitor: "GotPhoto",
    tagline:
      "School-photography platforms compared. GotPhoto is a mature end-to-end school workflow. Studio OS Cloud adds connected desktop tethering, AI backgrounds, and Projects without separate tools.",
    bestFor: "School and volume photographers who want capture and gallery in one platform",
  },
  {
    slug: "studio-os-vs-photoday",
    competitor: "PhotoDay",
    tagline:
      "PhotoDay is an AI-forward school and sports platform. Studio OS Cloud matches with AI backgrounds plus connected tethering, order review, and tighter project structure.",
    bestFor: "School and sports photographers who want FaceFind plus deeper workflow control",
  },
  {
    slug: "studio-os-vs-shootproof",
    competitor: "ShootProof",
    tagline:
      "ShootProof is a flexible gallery-and-contract platform. Studio OS Cloud adds connected desktop workflow, Projects, and AI tooling for photographers who need more than client-facing tools.",
    bestFor: "Established photographers ready to consolidate gallery, capture, and production",
  },
  {
    slug: "studio-os-vs-smugmug",
    competitor: "SmugMug",
    tagline:
      "SmugMug is best known for unlimited storage and websites. Studio OS Cloud is built around photography Projects, ordering, and connected production rather than archive-style hosting.",
    bestFor: "Photographers shifting from a portfolio-host model to a workflow platform",
  },
  {
    slug: "studio-os-vs-zenfolio",
    competitor: "Zenfolio",
    tagline:
      "Zenfolio bundles galleries, websites, and CRM in one suite. Studio OS Cloud trades the site builder for deeper Projects, tethering, AI backgrounds, and order review.",
    bestFor: "Photographers who already have a website and want workflow depth instead of bundled CRM",
  },
  {
    slug: "studio-os-vs-zno",
    competitor: "Zno",
    tagline:
      "Zno leans into print products and album design. Studio OS Cloud focuses on the gallery, ordering, and production workflow that delivers those orders to a lab.",
    bestFor: "Photographers who want the gallery and ordering layer Zno does not provide",
  },
];

const itemListJsonLd = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  itemListElement: comparisons.map((entry, index) => ({
    "@type": "ListItem",
    position: index + 1,
    url: `${baseUrl}/compare/${entry.slug}`,
    name: `Studio OS Cloud vs ${entry.competitor}`,
  })),
};

export default function ComparePage() {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: "Home", item: baseUrl },
          { name: "Compare", item: `${baseUrl}/compare` },
        ]}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />

      <section className="mx-auto max-w-5xl px-4 pb-10 pt-16 sm:px-6 lg:px-8">
        <p className="marketing-caption text-xs font-semibold uppercase tracking-[0.18em] text-red-600">
          Platform Comparisons
        </p>
        <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight text-neutral-950 sm:text-5xl">
          Compare Studio OS Cloud to other photography platforms
        </h1>
        <p className="mt-5 max-w-3xl text-lg leading-relaxed text-neutral-600">
          Photography platforms look similar on the surface — galleries, ordering, delivery.
          The real differences show up in capture, Projects, production control, and how
          desktop and cloud connect. Use the comparisons below to see where Studio OS Cloud
          fits relative to the platform you are evaluating or already using.
        </p>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {comparisons.map((entry) => (
            <li key={entry.slug}>
              <Link
                href={`/compare/${entry.slug}`}
                className="group flex h-full flex-col justify-between rounded-3xl border border-neutral-200 bg-white p-6 transition hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-[0_18px_45px_rgba(0,0,0,0.08)]"
              >
                <div>
                  <p className="marketing-caption text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
                    Studio OS Cloud vs
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">
                    {entry.competitor}
                  </h2>
                  <p className="mt-4 text-sm leading-relaxed text-neutral-600">
                    {entry.tagline}
                  </p>
                </div>
                <div className="mt-6 border-t border-neutral-100 pt-4">
                  <p className="marketing-caption text-xs font-medium uppercase tracking-wider text-neutral-500">
                    Best for
                  </p>
                  <p className="mt-1 text-sm text-neutral-700">{entry.bestFor}</p>
                  <span className="marketing-caption mt-4 inline-flex items-center gap-1 text-sm font-semibold text-red-600 transition group-hover:gap-2">
                    Read the full comparison
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-24 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-neutral-200 bg-neutral-50 p-8 sm:p-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-950 sm:text-3xl">
            Not sure which alternative to read first?
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-neutral-600">
            If you are searching for a Pixieset or GotPhoto alternative specifically, start
            with the dedicated alternative pages — they go deeper on why photographers
            switch and what changes when they move to Studio OS Cloud.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/pixieset-alternative"
              className="marketing-button inline-flex items-center gap-2 rounded-full bg-neutral-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-black"
            >
              Pixieset alternative
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/gotphoto-alternative"
              className="marketing-button inline-flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-5 py-3 text-sm font-semibold text-neutral-900 transition hover:border-neutral-400"
            >
              GotPhoto alternative
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/pricing"
              className="marketing-button inline-flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-5 py-3 text-sm font-semibold text-neutral-900 transition hover:border-neutral-400"
            >
              See pricing
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

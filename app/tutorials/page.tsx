import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Download, ListVideo, PlayCircle } from "lucide-react";

import { BreadcrumbJsonLd } from "@/components/json-ld";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { TutorialLibrary } from "@/components/tutorial-library";
import {
  formatIsoDuration,
  tutorialGroups,
  tutorials,
  tutorialsChannelUrl,
  tutorialsPlaylistId,
  tutorialThumbnailUrl,
  tutorialWatchUrl,
} from "@/lib/tutorials";

const pageUrl = "https://www.studiooscloud.com/tutorials";
const publishedOn = "2026-09-29";

export const metadata: Metadata = {
  title: "Studio OS Tutorials | Video Guides for Every Panel",
  description:
    "Sixteen short video tutorials covering the Studio OS desktop app and Studio OS Cloud: rosters, QR capture on picture day, sorting, editing, composites, orders, galleries and online booking.",
  alternates: { canonical: pageUrl },
  openGraph: {
    title: "Studio OS Tutorials | Video Guides for Every Panel",
    description:
      "Learn Studio OS in about 35 minutes: one short video per panel, from roster import to delivered prints.",
    url: pageUrl,
  },
};

const totalMinutes = Math.round(tutorials.reduce((sum, t) => sum + t.seconds, 0) / 60);
const playlistUrl = tutorialsPlaylistId
  ? `https://www.youtube.com/playlist?list=${tutorialsPlaylistId}`
  : tutorialsChannelUrl;

function TutorialSeriesJsonLd() {
  const published = tutorials.filter((t) => t.youtubeId);
  if (published.length === 0) return null;
  const data = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Studio OS Tutorials",
    url: pageUrl,
    numberOfItems: published.length,
    itemListElement: published.map((tutorial, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "VideoObject",
        name: `Studio OS Tutorial ${tutorial.number}: ${tutorial.title}`,
        description: tutorial.blurb,
        thumbnailUrl: [tutorialThumbnailUrl(tutorial)],
        uploadDate: publishedOn,
        duration: formatIsoDuration(tutorial.seconds),
        embedUrl: `https://www.youtube-nocookie.com/embed/${tutorial.youtubeId}`,
        contentUrl: tutorialWatchUrl(tutorial),
        publisher: { "@id": "https://www.studiooscloud.com/#organization" },
      },
    })),
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export default function TutorialsPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", item: "https://www.studiooscloud.com" },
          { name: "Tutorials", item: pageUrl },
        ]}
      />
      <TutorialSeriesJsonLd />
      <SiteHeader />
      <main>
        <section className="bg-neutral-950 px-4 py-20 text-white sm:px-6 lg:px-8 lg:py-28">
          <div className="mx-auto max-w-7xl">
            <p className="marketing-kicker text-red-300">Tutorials</p>
            <h1 className="marketing-display mt-5 max-w-4xl">
              Learn Studio OS in an afternoon.
            </h1>
            <p className="marketing-body mt-6 max-w-3xl text-white/68">
              {`${tutorials.length} short videos, one per panel — about ${totalMinutes} minutes in all. `}
              Every step is shown on a demo studio, from importing the school&apos;s roster and
              scanning QR labels on picture day to composites, orders and what parents see
              online. Start with Welcome, then follow the series in order, or jump to the panel
              you need.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <a
                href="#watch"
                className="marketing-button premium-button inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-neutral-950 shadow-[0_16px_38px_rgba(0,0,0,0.3)] transition hover:bg-neutral-100"
              >
                <PlayCircle className="h-4 w-4" />
                Start watching
              </a>
              <a
                href={playlistUrl}
                target="_blank"
                rel="noreferrer"
                data-marketing-event="cta_tutorials_youtube"
                data-marketing-label="Tutorials YouTube playlist"
                data-marketing-placement="tutorials_hero"
                className="marketing-button inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-3 text-white transition hover:bg-white/10"
              >
                <ListVideo className="h-4 w-4" />
                Open on YouTube
              </a>
              <Link
                href="/studio-os/download"
                data-marketing-event="cta_download_app"
                data-marketing-label="Tutorials download app"
                data-marketing-placement="tutorials_hero"
                className="marketing-button inline-flex items-center gap-2 rounded-full px-4 py-3 text-white/80 transition hover:text-white"
              >
                <Download className="h-4 w-4" />
                Download the app
              </Link>
            </div>
          </div>
        </section>

        <section id="watch" className="scroll-mt-24 px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-7xl">
            <TutorialLibrary groups={tutorialGroups} playlistId={tutorialsPlaylistId} />
          </div>
        </section>

        <section className="px-4 pb-20 sm:px-6 lg:px-8 lg:pb-28">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-6 rounded-[1.75rem] bg-neutral-950 p-7 text-white sm:p-9 lg:grid-cols-[1.4fr_1fr] lg:items-center">
              <div>
                <h2 className="marketing-title">Ready to try it on your own school?</h2>
                <p className="marketing-body mt-4 max-w-2xl text-white/65">
                  Studio OS Cloud comes with a 30-day free trial and no card required. Sign up,
                  download the desktop app, and pick up from Tutorial 2.
                </p>
              </div>
              <div className="flex flex-wrap gap-3 lg:justify-end">
                <Link
                  href="/sign-up"
                  data-marketing-event="cta_start_trial"
                  data-marketing-label="Tutorials start trial"
                  data-marketing-placement="tutorials_footer_cta"
                  className="marketing-button inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-neutral-950 transition hover:bg-neutral-100"
                >
                  Start free trial <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/contact"
                  className="marketing-button inline-flex items-center gap-2 rounded-full border border-white/20 px-5 py-3 text-white transition hover:bg-white/10"
                >
                  Book a demo
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

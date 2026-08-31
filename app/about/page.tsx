import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Camera, Cloud, Workflow } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "About Studio OS Cloud",
  description:
    "Studio OS Cloud is photography workflow software built around real school, portrait, event, ordering, and delivery work.",
  alternates: { canonical: "https://www.studiooscloud.com/about" },
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <SiteHeader />
      <main>
        <section className="bg-neutral-950 px-4 py-20 text-white sm:px-6 lg:px-8 lg:py-28">
          <div className="mx-auto max-w-6xl">
            <p className="marketing-kicker text-red-300">About Studio OS Cloud</p>
            <h1
              className="marketing-display mt-5 max-w-5xl"
              style={{ fontSize: "clamp(2.2rem, 9.5vw, 5.4rem)" }}
            >
              Built from the work photographers actually do.
            </h1>
            <p className="marketing-body mt-6 max-w-3xl text-white/68">
              Studio OS Cloud grew from a simple idea: booking, rosters, capture,
              galleries, ordering, production, and delivery should behave like one
              workflow—not a collection of disconnected tools.
            </p>
          </div>
        </section>
        <section className="px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-5 md:grid-cols-3">
              {[
                { title: "Photographer first", text: "Decisions begin with speed, clarity, and control on a real production day.", icon: Camera },
                { title: "One connected flow", text: "The same job moves from online booking to capture, ordering, print, and delivery.", icon: Workflow },
                { title: "Local and cloud", text: "Desktop production and cloud client experiences stay connected without forcing every task into a browser.", icon: Cloud },
              ].map((item) => (
                <article key={item.title} className="rounded-[1.5rem] border border-neutral-200 p-7 shadow-sm">
                  <item.icon className="h-6 w-6 text-red-600" />
                  <h2 className="marketing-card-title mt-5">{item.title}</h2>
                  <p className="marketing-caption mt-3 text-neutral-600">{item.text}</p>
                </article>
              ))}
            </div>
            <div className="mt-12 rounded-[2rem] bg-neutral-50 p-7 sm:p-10">
              <p className="marketing-kicker text-red-600">The Product Principle</p>
              <h2 className="marketing-title mt-4">Useful beats impressive.</h2>
              <p className="marketing-body mt-5 max-w-4xl text-neutral-600">
                Every feature should remove a real handoff, reduce a real mistake, make
                a client experience clearer, or help a photographer produce and deliver
                better work. That is the standard Studio OS Cloud is built around.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/online-school-photography-booking" className="marketing-button inline-flex items-center justify-center gap-2 rounded-full bg-neutral-950 px-5 py-3 text-white">
                  See the Booking Workflow <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/contact" className="marketing-button inline-flex items-center justify-center rounded-full border border-neutral-300 bg-white px-5 py-3">
                  Talk to Studio OS Cloud
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

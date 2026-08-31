import Link from "next/link";
import { ArrowRight, Target } from "lucide-react";
import { Reveal } from "./Reveal";

export function Founding100Banner() {
  return (
    <section className="border-b border-neutral-200 bg-white px-4 py-6 sm:px-6 lg:px-8">
      <Reveal className="mx-auto flex max-w-7xl flex-col gap-5 overflow-hidden rounded-[1.5rem] border border-red-200 bg-[linear-gradient(120deg,#fff5f5_0%,#fff_52%,#f7f7f7_100%)] px-5 py-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-600 text-white shadow-sm">
            <Target className="h-5 w-5" />
          </span>
          <div>
            <div className="marketing-kicker text-red-700">Now Inviting the Founding 100</div>
            <p className="marketing-caption mt-2 max-w-3xl text-neutral-650">
              Put one complete Studio OS workflow to work during a 30-day trial
              with priority onboarding and no credit card required.
            </p>
          </div>
        </div>
        <Link
          href="/founding-100"
          data-marketing-event="cta_founding_100"
          data-marketing-label="Homepage Founding 100 banner"
          data-marketing-placement="founding_100_home_banner"
          className="marketing-button premium-button inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-neutral-950 px-5 py-3 text-white transition hover:bg-black"
        >
          Explore Founding 100
          <ArrowRight className="h-4 w-4" />
        </Link>
      </Reveal>
    </section>
  );
}

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Reveal } from "./Reveal";

export function FinalCta() {
  return (
    <section className="bg-white px-4 pb-20 text-neutral-950 sm:px-6 lg:px-8 lg:pb-28">
      <Reveal className="cta-glow mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-[linear-gradient(135deg,#111111,#2f0b0b)] px-6 py-14 text-white shadow-2xl sm:px-10 lg:px-14">
        <div className="grid items-center gap-8 lg:grid-cols-[1fr_auto]">
          <div className="relative z-10">
            <h2 className="marketing-title max-w-3xl">
              Build your photography business on one connected system.
            </h2>
            <p className="marketing-body mt-5 max-w-2xl text-white/60">
              Bring galleries, ordering, school workflows, production review, and
              cloud delivery into one Studio OS experience.
            </p>
          </div>
          <div className="relative z-10 flex flex-col gap-3 sm:flex-row lg:flex-col">
            <Link
              href="/sign-up"
              className="marketing-button premium-button inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-neutral-950 transition hover:bg-neutral-100"
            >
              Start Free Trial
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/pricing"
              className="marketing-button premium-button inline-flex items-center justify-center rounded-full border border-white/20 bg-white/10 px-5 py-3 text-white transition hover:bg-white/20"
            >
              See Pricing
            </Link>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

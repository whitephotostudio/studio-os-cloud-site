// Refined visual treatment of the homepage hero. Preserves every string of
// copy, every href, every CTA, and the right-column dashboard preview card from
// the original `components/hero.tsx`. Visual changes only:
//   - Editorial serif (Fraunces, via --font-serif) on the H1 with selective italics
//   - Eyebrow chip with red pulse above the headline
//   - Warmer cream background gradient
//   - Tighter button pill styling
//   - CSS-only fade-in on first paint (still a server component)
//
// Old `Hero` component is left in place untouched — flip back any time by
// reverting the import in `app/page.tsx`.

import Link from "next/link";

export function HeroRefined() {
  return (
    <section className="relative overflow-hidden">
      {/* Warm cream backdrop with soft radial accents (replaces the cooler white
          gradient in the original hero). Pure CSS, no client JS. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 22% -8%, rgba(223,43,47,0.08), transparent 30%), radial-gradient(circle at 84% 12%, rgba(20,18,14,0.06), transparent 26%), linear-gradient(180deg, #f7f1e7 0%, #faf6ee 38%, #ffffff 78%)",
        }}
      />

      <div className="relative mx-auto max-w-7xl px-4 pt-14 pb-10 sm:px-6 lg:px-8 lg:pt-28 lg:pb-16">
        <div className="grid items-start gap-10 lg:grid-cols-2">
          <div className="hero-fade-in">
            {/* Editorial confidence marker above the headline — small,
                clean, no logo (the SiteHeader already carries the brand). */}
            <div className="mb-6 inline-flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.22em] text-neutral-700 sm:mb-8 sm:text-[11px]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#df2b2f] opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#df2b2f]" />
              </span>
              Studio OS Cloud · 2026 Edition
            </div>

            {/* H1 — preserves the original three-line copy verbatim. Sizes
                tuned for mobile-first: matches the original 36/48/60 mobile
                progression but adds editorial serif treatment. The third line
                drops to a clearly subordinate scale so it reads as a
                supporting tagline, not a co-equal headline. */}
            <h1
              className="font-serif text-[36px] font-light leading-[1.02] tracking-[-0.022em] text-neutral-950 sm:text-[52px] lg:text-[68px]"
              style={{ fontFamily: "var(--font-serif), 'Times New Roman', serif" }}
            >
              Great Galleries for
              <span className="block italic text-neutral-900">Every Photographer</span>
              <span className="mt-3 block text-[20px] font-light leading-[1.18] text-neutral-600 sm:mt-4 sm:text-[26px] lg:text-[32px]">
                Deeper Workflow When You Need More
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-8 text-neutral-600">
              Studio OS Cloud gives photographers premium online galleries,
              client ordering, and digital delivery, then goes deeper with
              Projects, production control, and connected desktop + cloud
              workflow.
            </p>

            {/* All four original CTAs preserved verbatim — same order, same
                hrefs, same button text. Visual treatment only is refined. */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link
                href="/studio-os/download"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-[#050505] bg-[linear-gradient(180deg,#181818_0%,#080808_52%,#000000_100%)] px-6 py-3 text-center text-[15px] font-semibold text-white shadow-[0_14px_32px_rgba(0,0,0,0.22)] transition hover:-translate-y-[1px] hover:brightness-[1.04]"
              >
                Download App
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-[#d7d3cc] bg-[linear-gradient(180deg,#ffffff_0%,#faf8f4_52%,#f1ede5_100%)] px-6 py-3 text-center text-[15px] font-semibold text-neutral-950 shadow-[0_10px_22px_rgba(24,24,24,0.07)] transition hover:-translate-y-[1px] hover:brightness-[0.99]"
              >
                See Pricing
              </Link>
              <Link
                href="/studio-os"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-neutral-200 bg-white px-6 py-3 text-center text-[15px] font-semibold text-neutral-950 shadow-[0_10px_22px_rgba(24,24,24,0.07)] transition hover:-translate-y-[1px] hover:bg-neutral-50"
              >
                Platform Demo
              </Link>
              <Link
                href="/sign-up"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-[#a9191d] bg-[linear-gradient(180deg,#f03a3e_0%,#da262b_46%,#b81c21_100%)] px-6 py-3 text-center text-[15px] font-semibold text-white shadow-[0_14px_30px_rgba(146,15,23,0.22)] transition hover:-translate-y-[1px] hover:brightness-[0.98]"
              >
                Create Account
              </Link>
            </div>

            <div className="mt-8 text-sm text-neutral-500">
              Built for portraits, weddings, events, schools, sports, and
              workflow-heavy studios.
            </div>
          </div>

          {/* RIGHT COLUMN — dashboard preview card preserved verbatim from the
              original. Same headlines, same body, same status pills, same
              stats, same checklist. Only visual deltas: serif on the
              section titles inside the card; tighter shadow stack so it
              floats nicely against the new cream background. */}
          <div className="relative hero-fade-in-delayed">
            <div className="overflow-hidden rounded-[28px] border border-neutral-200/80 bg-white shadow-[0_30px_70px_rgba(20,18,14,0.10),0_8px_18px_rgba(20,18,14,0.06)]">
              <div className="border-b border-neutral-200 bg-neutral-50/70 px-5 py-4">
                <div className="grid items-start gap-5 lg:grid-cols-[1fr_1fr_auto]">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">
                      Studio OS
                    </div>
                    <div
                      className="mt-1 whitespace-nowrap text-[17px] font-medium text-neutral-900"
                      style={{ fontFamily: "var(--font-serif), 'Times New Roman', serif" }}
                    >
                      Capture + Projects
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      Organize real jobs before the gallery with faster capture
                      and cleaner structure.
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">
                      Studio OS Cloud
                    </div>
                    <div
                      className="mt-1 whitespace-nowrap text-[17px] font-medium text-neutral-900"
                      style={{ fontFamily: "var(--font-serif), 'Times New Roman', serif" }}
                    >
                      Galleries + ordering
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      Premium client galleries, orders, downloads, and access
                      in the same connected system.
                    </div>
                  </div>

                  <div className="flex flex-wrap items-start gap-2 xl:flex-row xl:items-center">
                    <div className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs text-neutral-700">
                      Projects synced
                    </div>
                    <div className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs text-neutral-700">
                      <div className="h-2 w-2 rounded-full bg-green-500" />
                      Cloud connected
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4 p-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
                    <div className="text-xs text-neutral-500">Live galleries</div>
                    <div
                      className="mt-2 text-3xl font-light text-neutral-950"
                      style={{ fontFamily: "var(--font-serif), 'Times New Roman', serif" }}
                    >
                      84
                    </div>
                  </div>

                  <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
                    <div className="text-xs text-neutral-500">Active projects</div>
                    <div
                      className="mt-2 text-3xl font-light text-neutral-950"
                      style={{ fontFamily: "var(--font-serif), 'Times New Roman', serif" }}
                    >
                      27
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-white p-5">
                  <div
                    className="text-[15px] font-medium text-neutral-900"
                    style={{ fontFamily: "var(--font-serif), 'Times New Roman', serif" }}
                  >
                    What Studio OS connects
                  </div>

                  <div className="mt-4 space-y-3 text-sm text-neutral-700">
                    {[
                      "Projects and job organization",
                      "Online galleries and client ordering",
                      "Print workflow and delivery",
                    ].map((line) => (
                      <div key={line} className="flex items-center gap-3">
                        <div className="h-2 w-2 rounded-full bg-[#df2b2f]" />
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* BOTTOM TWO-COLUMN — preserved verbatim from original. Both column
            titles get a serif lift to match the editorial type system. */}
        <div className="mt-14 border-t border-neutral-200/80 pt-10">
          <div className="grid gap-10 md:grid-cols-2 md:gap-16">
            <div>
              <div
                className="text-[26px] font-medium tracking-tight text-neutral-950"
                style={{ fontFamily: "var(--font-serif), 'Times New Roman', serif" }}
              >
                Studio OS App
              </div>
              <p className="mt-2 text-base leading-8 text-neutral-600">
                Capture faster, manage Projects, and keep production organized
                before the gallery.
              </p>
              <div className="mt-1 text-sm leading-7 text-neutral-500">
                Tethering • Projects • Sorting • AI Tools • Production Control
              </div>
            </div>

            <div>
              <div
                className="text-[26px] font-medium tracking-tight text-neutral-950"
                style={{ fontFamily: "var(--font-serif), 'Times New Roman', serif" }}
              >
                Studio OS Cloud
              </div>
              <p className="mt-1 text-base leading-8 text-neutral-600">
                Deliver branded galleries, ordering, downloads, and private
                client access.
              </p>
              <div className="mt-1 text-sm leading-7 text-neutral-500">
                Galleries • Orders • Downloads • Client Access
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Local CSS-only fade-in keyframes (no client JS, server component
          stays a server component). Scoped to this section via class names. */}
      <style>{`
        @keyframes hero-rise {
          0%   { opacity: 0; transform: translateY(14px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .hero-fade-in {
          animation: hero-rise 800ms cubic-bezier(.2,.7,.3,1) both;
        }
        .hero-fade-in-delayed {
          animation: hero-rise 900ms cubic-bezier(.2,.7,.3,1) 180ms both;
        }
      `}</style>
    </section>
  );
}

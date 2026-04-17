import Link from "next/link";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 0%, rgba(98,46,59,0.05), transparent 26%), radial-gradient(circle at 78% 18%, rgba(41,37,36,0.045), transparent 20%), linear-gradient(180deg, rgba(247,243,239,0.7) 0%, rgba(255,255,255,0.14) 34%, rgba(255,255,255,0) 52%)",
        }}
      />

      <div className="relative mx-auto max-w-7xl px-4 pt-14 pb-10 sm:px-6 lg:px-8 lg:pt-24 lg:pb-14">
        <div className="grid items-start gap-10 lg:grid-cols-2">
          <div>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight text-neutral-950 sm:text-5xl lg:text-6xl">
              Great Galleries for
              <span className="block">Every Photographer</span>
              <span className="block">Deeper Workflow When You Need More</span>
            </h1>

            <p className="mt-5 max-w-xl text-lg leading-8 text-neutral-600">
              Studio OS Cloud gives photographers premium online galleries,
              client ordering, and digital delivery, then goes deeper with
              Projects, production control, and connected desktop + cloud
              workflow.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/studio-os/download"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#050505] bg-[linear-gradient(180deg,#181818_0%,#080808_52%,#000000_100%)] px-5 py-3 text-center font-medium text-white shadow-[0_16px_30px_rgba(0,0,0,0.22)] transition hover:brightness-[1.03]"
              >
                Download App
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#d7d3cc] bg-[linear-gradient(180deg,#ffffff_0%,#faf8f4_52%,#f1ede5_100%)] px-5 py-3 text-center font-medium text-neutral-950 shadow-[0_12px_24px_rgba(24,24,24,0.08)] transition hover:brightness-[0.99]"
              >
                See Pricing
              </Link>
              <Link
                href="/studio-os"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white px-5 py-3 text-center font-medium text-neutral-950 shadow-[0_12px_24px_rgba(24,24,24,0.08)] transition hover:bg-neutral-50"
              >
                Platform Demo
              </Link>
              <Link
                href="/sign-up"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#a9191d] bg-[linear-gradient(180deg,#f03a3e_0%,#da262b_46%,#b81c21_100%)] px-5 py-3 text-center font-medium text-white shadow-[0_14px_28px_rgba(146,15,23,0.18)] transition hover:brightness-[0.98]"
              >
                Create Account
              </Link>
            </div>

            <div className="mt-8 text-sm text-neutral-500">
              Built for portraits, weddings, events, schools, sports, and
              workflow-heavy studios.
            </div>
          </div>

          <div className="relative">
            <div className="overflow-hidden rounded-[28px] border border-neutral-200 bg-white shadow-2xl">
              <div className="border-b border-neutral-200 bg-neutral-50 px-5 py-4">
                <div className="grid items-start gap-5 lg:grid-cols-[1fr_1fr_auto]">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">
                      Studio OS
                    </div>
                    <div className="mt-1 whitespace-nowrap text-sm font-semibold text-neutral-900">
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
                    <div className="mt-1 whitespace-nowrap text-sm font-semibold text-neutral-900">
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
                    <div className="mt-2 text-3xl font-semibold text-neutral-950">84</div>
                  </div>

                  <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
                    <div className="text-xs text-neutral-500">Active projects</div>
                    <div className="mt-2 text-3xl font-semibold text-neutral-950">27</div>
                  </div>
                </div>

                  <div className="rounded-2xl border border-neutral-200 bg-white p-5">
                    <div className="text-sm font-semibold text-neutral-900">
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

        <div className="mt-14 border-t border-neutral-200 pt-10">
          <div className="grid gap-10 md:grid-cols-2 md:gap-16">
            <div>
              <div className="text-2xl font-semibold tracking-tight text-neutral-950">
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
              <div className="text-2xl font-semibold tracking-tight text-neutral-950">
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
    </section>
  );
}

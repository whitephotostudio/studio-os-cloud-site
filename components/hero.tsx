import Link from "next/link";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(239,68,68,0.08),transparent_28%),radial-gradient(circle_at_80%_20%,rgba(0,0,0,0.05),transparent_22%)]" />

      <div className="relative mx-auto max-w-7xl px-4 pt-14 pb-10 sm:px-6 lg:px-8 lg:pt-24 lg:pb-14">
        <div className="grid items-start gap-10 lg:grid-cols-2">
          <div>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight text-neutral-950 sm:text-5xl lg:text-6xl">
              Professional tools for photographers,
              <span className="block">built to simplify workflows.</span>
            </h1>

            <p className="mt-5 max-w-xl text-lg leading-8 text-neutral-600">
              Studio OS Cloud and the Studio OS App work together to give photographers a premium connected workflow for roster-based organization, galleries, ordering, printing, and lab fulfillment.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/preview"
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-black px-5 py-3 font-medium text-white shadow-md transition hover:opacity-90"
              >
                Platform Demo
              </Link>
            </div>

            <div className="mt-8 text-sm text-neutral-500">
              Studio OS App + Studio OS Cloud in one connected platform.
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
                      Desktop workflow
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      Capture, organize, and manage production.
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">
                      Studio OS Cloud
                    </div>
                    <div className="mt-1 whitespace-nowrap text-sm font-semibold text-neutral-900">
                      Online delivery
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">
                      Galleries, orders, and cloud-connected access.
                    </div>
                  </div>

                  <div className="flex flex-wrap items-start gap-2 xl:flex-row xl:items-center">
                    <div className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs text-neutral-700">
                      Free 7 days trial
                    </div>
                    <div className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs text-neutral-700">
                      <div className="h-2 w-2 rounded-full bg-green-500" />
                      Cloud synced
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
                    <div className="text-xs text-neutral-500">New orders</div>
                    <div className="mt-2 text-3xl font-semibold text-neutral-950">27</div>
                  </div>
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-white p-5">
                  <div className="text-sm font-semibold text-neutral-900">
                    What photographers manage here
                  </div>

                  <div className="mt-4 space-y-3 text-sm text-neutral-700">
                    {[
                      "Private client galleries",
                      "Online ordering",
                      "Account and workflow management",
                    ].map((line) => (
                      <div key={line} className="flex items-center gap-3">
                        <div className="h-2 w-2 rounded-full bg-red-500" />
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
                Desktop workflow for photographers.
              </p>
              <div className="mt-1 text-sm leading-7 text-neutral-500">
                Roster • Capture • Sorting • Printing
              </div>
            </div>

            <div>
              <div className="text-2xl font-semibold tracking-tight text-neutral-950">
                Studio OS Cloud
              </div>
              <p className="mt-1 text-base leading-8 text-neutral-600">
                Online delivery and ordering.
              </p>
              <div className="mt-1 text-sm leading-7 text-neutral-500">
                Private Access • Organized Galleries • Easy Parent Ordering
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
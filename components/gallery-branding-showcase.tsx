import Link from "next/link";
import { CalendarDays, Download, ShieldCheck, ShoppingBag } from "lucide-react";

const galleryHighlights = [
  {
    icon: CalendarDays,
    title: "Capture",
    detail: "Shoot faster and keep every job organized from the start.",
  },
  {
    icon: ShieldCheck,
    title: "Organize",
    detail: "No more folder chaos — everything stays structured automatically.",
  },
  {
    icon: ShoppingBag,
    title: "Sell",
    detail: "Parents and clients order directly through your system.",
  },
  {
    icon: Download,
    title: "Deliver",
    detail: "Get images and products out without confusion or delays.",
  },
];

export function GalleryBrandingShowcase() {
  return (
    <section className="pb-2 pt-3 sm:pb-4 sm:pt-6">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-[32px] border border-neutral-200 bg-[linear-gradient(180deg,#fcfbf8_0%,#f6f1ea_54%,#ffffff_100%)] px-6 py-8 text-neutral-950 shadow-[0_28px_80px_rgba(20,20,20,0.08)] sm:px-8 sm:py-10 lg:px-12 lg:py-12">
          <div
            className="absolute inset-0 opacity-80"
            style={{
              background:
                "radial-gradient(circle at 16% 18%, rgba(220,38,38,0.09), transparent 24%), radial-gradient(circle at 82% 14%, rgba(25,25,25,0.06), transparent 22%), linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0) 100%)",
            }}
          />

          <div className="relative grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12">
            <div className="max-w-xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#ead9da] bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#8a4a53] shadow-sm">
                Studio OS Cloud
              </div>
              <h2 className="mt-5 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
                Built for Real Photography Workflows.
              </h2>
              <p className="mt-5 text-lg leading-8 text-neutral-600">
                Studio OS is designed around how photographers actually work —
                not generic software.
              </p>

              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {galleryHighlights.map((item) => {
                  const Icon = item.icon;

                  return (
                    <div
                      key={item.title}
                      className="rounded-[22px] border border-neutral-200 bg-white/90 p-4 shadow-[0_12px_30px_rgba(20,20,20,0.05)]"
                    >
                      <div className="flex items-center gap-3">
                        <div className="rounded-2xl border border-[#f4c7c9] bg-[#fff2f3] p-2.5">
                          <Icon className="h-4 w-4 text-[#d3252b]" />
                        </div>
                        <div className="text-sm font-semibold text-neutral-950">
                          {item.title}
                        </div>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-neutral-600">
                        {item.detail}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/studio-os"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(180deg,#f03a3e_0%,#da262b_46%,#b81c21_100%)] px-5 py-3 font-semibold text-white shadow-[0_16px_34px_rgba(184,28,33,0.22)] transition hover:brightness-[0.99]"
                >
                  Explore Studio OS
                </Link>
                <Link
                  href="/parents"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white px-5 py-3 font-semibold text-neutral-900 shadow-sm transition hover:bg-neutral-50"
                >
                  See gallery flow
                </Link>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-[28px] border border-neutral-800 bg-[linear-gradient(180deg,#151515_0%,#0d0d0d_100%)] p-6 text-white shadow-[0_26px_70px_rgba(10,10,10,0.24)]">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">
                  One connected system
                </div>
                <h3 className="mt-3 text-3xl font-semibold tracking-tight text-white">
                  Capture, organize, sell, and deliver.
                </h3>
                <p className="mt-4 max-w-xl text-base leading-8 text-white/68">
                  Stop switching between platforms. Studio OS connects your
                  entire process — from photo day to final delivery.
                </p>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  {[
                    "Direct camera tethering",
                    "Structured jobs and rosters",
                    "Online galleries and ordering",
                    "Private links and access",
                    "Downloads and delivery",
                    "School, event, and studio workflows",
                  ].map((feature) => (
                    <div
                      key={feature}
                      className="rounded-2xl border border-white/10 bg-[#1b1b1b] px-4 py-3 text-sm font-medium text-white/88"
                    >
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-[#df2b2f]" />
                        {feature}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  {
                    title: "School photographers",
                    detail: "Move faster on photo day and keep every student job structured from the start.",
                  },
                  {
                    title: "Event photographers",
                    detail: "Deliver galleries, selections, and orders without sending clients to another tool.",
                  },
                  {
                    title: "High-volume studios",
                    detail: "Reduce admin work, keep teams aligned, and move more jobs through one connected system.",
                  },
                ].map((card) => (
                  <div
                    key={card.title}
                    className="rounded-[24px] border border-neutral-200 bg-white p-5 shadow-[0_12px_30px_rgba(20,20,20,0.05)]"
                  >
                    <div className="text-sm font-semibold text-neutral-950">
                      {card.title}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-neutral-600">
                      {card.detail}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

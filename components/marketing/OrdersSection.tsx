import { Check, ShoppingBag } from "lucide-react";
import { Reveal } from "./Reveal";

const fulfillment = [
  "Order review",
  "Digital delivery",
  "Print-ready workflow",
  "Export-ready fulfillment",
  "Lab workflow ready",
];

const orderCards = [
  ["New Order", "Northview School", "Classic Package"],
  ["Digital Download Pending", "Harbor View Wedding", "Digital Collection"],
  ["Print-Ready Export", "Cityside Sports League", "Team Memory Pack"],
  ["Parent Package Selected", "Northview School", "Keepsake Package"],
];

export function OrdersSection() {
  return (
    <section className="bg-neutral-100 px-4 py-20 text-neutral-950 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
        <Reveal className="rounded-[2rem] border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="rounded-[1.45rem] border border-neutral-200">
            <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
              <div>
                <div className="marketing-caption font-semibold">Order review</div>
                <div className="marketing-caption text-neutral-500">Photographer-controlled fulfillment</div>
              </div>
              <div className="marketing-caption rounded-full bg-red-50 px-3 py-1 font-semibold text-red-600">
                12 new
              </div>
            </div>

            <div className="space-y-3 p-5">
              {orderCards.map(([status, job, pkg], index) => (
                <Reveal
                  key={`${status}-${job}`}
                  delay={index * 110}
                  className="premium-card grid gap-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-[1fr_auto]"
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-2xl bg-neutral-950 p-3 text-white">
                      <ShoppingBag className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="marketing-caption font-semibold">{job}</div>
                      <div className="marketing-caption mt-1 text-neutral-500">{pkg}</div>
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <div className="marketing-caption rounded-full bg-red-50 px-3 py-1 font-semibold text-red-600">
                      {status}
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </Reveal>

        <Reveal delay={160}>
          <p className="marketing-kicker text-red-600">
            Orders + Fulfillment
          </p>
          <h2 className="marketing-title mt-4">
            Where galleries become orders.
          </h2>
          <p className="marketing-body mt-5 text-neutral-600">
            Accept package, print, and digital orders online, then review and
            prepare them for delivery or print export with full photographer control.
          </p>

          <div className="mt-8 grid gap-3">
            {fulfillment.map((item, index) => (
              <Reveal
                key={item}
                delay={index * 70}
                className="marketing-caption flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3 font-semibold text-neutral-800"
              >
                <span className="rounded-full bg-red-50 p-1 text-red-600">
                  <Check className="h-3.5 w-3.5" />
                </span>
                {item}
              </Reveal>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

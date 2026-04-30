import { Sparkles } from "lucide-react";
import { Reveal } from "./Reveal";

const cards = [
  "AI background cleanup",
  "Premium backdrop preview",
  "Parent/client upgrade choice",
  "Photographer keeps the revenue",
];

export function AiRevenueSection() {
  return (
    <section className="bg-white px-4 py-20 text-neutral-950 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr]">
          <Reveal>
            <p className="marketing-kicker text-red-600">
              AI Revenue
            </p>
            <h2 className="marketing-title mt-4">
              Turn every photo into more value.
            </h2>
            <p className="marketing-body mt-5 text-neutral-600">
              Offer AI background upgrades and enhancements while keeping control
              of pricing and production.
            </p>
          </Reveal>

          <div className="grid gap-4 sm:grid-cols-2">
            {cards.map((card, index) => (
              <Reveal
                as="article"
                key={card}
                delay={index * 90}
                className="premium-card min-h-[210px] rounded-[1.5rem] border border-neutral-200 bg-neutral-50 p-5 transition hover:bg-white hover:shadow-xl"
              >
                <div className="mb-8 inline-flex rounded-2xl bg-white p-3 text-red-600">
                  <Sparkles className="h-5 w-5" />
                </div>
                <p className="marketing-kicker text-neutral-400">
                  Upsell 0{index + 1}
                </p>
                <h3 className="marketing-card-title mt-2">{card}</h3>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

import Link from "next/link";
import {
  CalendarDays,
  Download,
  ShieldCheck,
  ShoppingBag,
} from "lucide-react";
import { Reveal } from "./Reveal";

const gallerySteps = [
  {
    title: "Present",
    text: "Deliver branded galleries that feel premium for every client.",
    icon: CalendarDays,
  },
  {
    title: "Organize",
    text: "Projects, albums, and access stay tied to the same job.",
    icon: ShieldCheck,
  },
  {
    title: "Sell",
    text: "Accept prints, packages, and digital orders without extra tools.",
    icon: ShoppingBag,
  },
  {
    title: "Deliver",
    text: "Move from selection to delivery and fulfillment in one system.",
    icon: Download,
  },
];

const connectedPoints = [
  "Projects, albums, and access control",
  "Branded galleries and client ordering",
  "Private delivery and digital downloads",
  "Print workflow and order review",
  "Desktop + cloud sync",
  "Especially strong for structured jobs",
];

const audienceCards = [
  {
    title: "Portrait and wedding photographers",
    text: "Deliver polished galleries and ordering without treating workflow as an afterthought.",
  },
  {
    title: "Event photographers and studios",
    text: "Keep albums, selections, access, and delivery tied to the same project from start to finish.",
  },
  {
    title: "School, sports, and volume teams",
    text: "Scale structured jobs with private access, ordering, and production control in one connected workflow.",
  },
];

export function ConnectedGalleriesSection() {
  return (
    <section className="bg-white px-4 py-20 text-neutral-950 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-7xl overflow-hidden rounded-[2rem] border border-neutral-200 bg-[radial-gradient(circle_at_10%_10%,rgba(239,68,68,0.09),transparent_34%),linear-gradient(135deg,#fff,#fafafa_45%,#f4f1ec)] p-5 shadow-sm sm:p-8 lg:p-10">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <Reveal>
            <span className="marketing-kicker inline-flex rounded-full border border-red-200 bg-white px-4 py-2 text-red-700 shadow-sm">
              Studio OS Cloud
            </span>
            <h2 className="marketing-title mt-8">
              Premium Online Galleries, Connected to the Rest of the Job.
            </h2>
            <p className="marketing-body mt-6 text-neutral-600">
              Studio OS Cloud treats galleries as a core product, then connects
              them to capture, Projects, ordering, and delivery.
            </p>

            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {gallerySteps.map((step, index) => (
                <Reveal key={step.title} delay={80 + index * 55}>
                  <article className="premium-card h-full rounded-[1.5rem] border border-neutral-200 bg-white p-5 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-red-200 hover:shadow-lg">
                    <div className="mb-5 flex items-center gap-4">
                      <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-red-200 bg-red-50 text-red-600">
                        <step.icon className="h-5 w-5" />
                      </span>
                      <h3 className="marketing-card-title text-neutral-950">
                        {step.title}
                      </h3>
                    </div>
                    <p className="marketing-body text-[1rem] leading-7 text-neutral-600">
                      {step.text}
                    </p>
                  </article>
                </Reveal>
              ))}
            </div>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Link
                href="#gallery-experience"
                className="marketing-button premium-button inline-flex items-center justify-center rounded-full bg-red-600 px-6 py-3 text-white shadow-lg shadow-red-600/20 transition hover:-translate-y-0.5 hover:bg-red-700 hover:shadow-red-600/30"
              >
                Explore Online Galleries
              </Link>
              <Link
                href="#parent-gallery-flow"
                className="marketing-button premium-button inline-flex items-center justify-center rounded-full border border-neutral-200 bg-white px-6 py-3 text-neutral-950 shadow-sm transition hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md"
              >
                See gallery flow
              </Link>
            </div>
          </Reveal>

          <div className="space-y-5">
            <Reveal delay={120}>
              <article className="premium-card rounded-[2rem] bg-neutral-950 p-6 text-white shadow-2xl sm:p-8 lg:p-10">
                <p className="marketing-kicker text-white/45">
                  One Connected System
                </p>
                <h3 className="marketing-title mt-5 text-[2rem] leading-tight text-white sm:text-[2.5rem]">
                  More than a gallery link.
                </h3>
                <p className="marketing-body mt-6 text-white/60">
                  Give clients a polished gallery experience while keeping the
                  work around it connected to the same platform.
                </p>

                <div className="mt-8 grid gap-3 sm:grid-cols-2">
                  {connectedPoints.map((point) => (
                    <div
                      key={point}
                      className="marketing-caption flex min-h-[76px] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white/78"
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 shadow-[0_0_18px_rgba(239,68,68,0.7)]" />
                      <span>{point}</span>
                    </div>
                  ))}
                </div>
              </article>
            </Reveal>

            <div className="grid gap-4 sm:grid-cols-3">
              {audienceCards.map((card, index) => (
                <Reveal key={card.title} delay={220 + index * 70}>
                  <article className="premium-card h-full rounded-[1.5rem] border border-neutral-200 bg-white p-5 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-red-200 hover:shadow-lg">
                    <h3 className="marketing-card-title text-[1.1rem] leading-snug text-neutral-950">
                      {card.title}
                    </h3>
                    <p className="marketing-body mt-4 text-[1rem] leading-7 text-neutral-600">
                      {card.text}
                    </p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

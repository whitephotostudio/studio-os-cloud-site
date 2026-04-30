import {
  Camera,
  FolderKanban,
  Monitor,
  PackageCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { Reveal } from "./Reveal";

const featureCards = [
  {
    title: "Premium Online Galleries",
    text: "Deliver branded galleries, client ordering, downloads, and private access as a core part of the platform.",
    icon: Camera,
  },
  {
    title: "Projects That Organize Real Jobs",
    text: "Keep albums, access, orders, and delivery tied to the same job instead of scattered across folders and extra tools.",
    icon: FolderKanban,
  },
  {
    title: "Desktop + Cloud Connected Workflow",
    text: "Capture locally, publish to the cloud, and keep the work moving without an export-and-upload gap.",
    icon: Monitor,
  },
  {
    title: "Structured Workflows at Scale",
    text: "Stay organized across school, sports, event, and multi-photographer jobs without losing polish for portrait and client delivery.",
    icon: Users,
  },
  {
    title: "AI Background Revenue",
    text: "Offer AI background upgrades and enhancements while keeping pricing and production under your control.",
    icon: Sparkles,
  },
  {
    title: "Full Order Control",
    text: "Review and verify orders before print so fulfillment stays under your control.",
    icon: PackageCheck,
  },
];

export function ComparisonSection() {
  return (
    <section className="bg-white px-4 py-20 text-neutral-950 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-7xl rounded-[2rem] border border-neutral-200 bg-white p-5 shadow-sm sm:p-8 lg:p-10">
        <Reveal className="max-w-4xl">
          <p className="marketing-kicker text-red-600">
            Why It Stands Apart
          </p>
          <h2 className="marketing-title mt-4">
            Built for Workflow, Not Just Delivery
          </h2>
          <p className="marketing-body mt-5 text-neutral-600">
            Studio OS gives photographers premium galleries as a core product,
            then goes deeper with Projects, production control, and connected
            desktop + cloud workflow.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {featureCards.map((card, index) => (
            <Reveal key={card.title} delay={80 + index * 45}>
              <article className="premium-card group flex h-full min-h-[280px] flex-col rounded-[1.5rem] border border-neutral-200 bg-white p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-red-200 hover:shadow-xl">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-red-200 bg-red-50 text-red-600 transition duration-300 group-hover:scale-105 group-hover:bg-red-600 group-hover:text-white">
                  <card.icon className="h-5 w-5" />
                </span>
                <h3 className="marketing-card-title mt-7 text-neutral-950">
                  {card.title}
                </h3>
                <p className="marketing-body mt-5 text-[1rem] leading-7 text-neutral-600">
                  {card.text}
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Reveal } from "./Reveal";

const useCases = [
  {
    title: "Schools & Volume",
    text: "Private PIN galleries, parent ordering, package control, and production visibility.",
    href: "/school-photography-software",
    cta: "School photography software",
  },
  {
    title: "Weddings & Events",
    text: "Premium delivery, downloads, favorites, and a polished client experience.",
    href: "/online-photo-gallery-ordering-software",
    cta: "Online galleries & ordering",
  },
  {
    title: "Portrait Studios",
    text: "Proofing, ordering, upgrades, and repeatable delivery for sessions.",
    href: "/photography-workflow-software",
    cta: "Photography workflow software",
  },
  {
    title: "Sports & Teams",
    text: "Organized team jobs, deadline-driven ordering, and export-ready production.",
    href: "/high-volume-photography-software",
    cta: "High volume photography software",
  },
];

export function UseCasesSection() {
  return (
    <section className="bg-neutral-950 px-4 py-20 text-white sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-7xl">
        <Reveal className="max-w-3xl">
          <p className="marketing-kicker text-red-400">
            Use Cases
          </p>
          <h2 className="marketing-title mt-4">
            Made for every kind of photography business.
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {useCases.map((useCase, index) => (
            <Reveal
              key={useCase.title}
              delay={index * 90}
            >
              <Link
                href={useCase.href}
                className="premium-card group flex min-h-[240px] flex-col rounded-[1.5rem] border border-white/10 bg-white/[0.06] p-5 transition hover:bg-white/[0.09]"
              >
                <div className="mb-12 h-16 rounded-2xl bg-[linear-gradient(135deg,rgba(255,255,255,0.18),rgba(239,68,68,0.22))]" />
                <h3 className="marketing-card-title">{useCase.title}</h3>
                <p className="marketing-caption mt-3 text-white/60">{useCase.text}</p>
                <span className="marketing-caption mt-auto inline-flex items-center gap-1 pt-5 text-sm font-medium text-white/80 transition group-hover:gap-2 group-hover:text-white">
                  {useCase.cta}
                  <ArrowUpRight className="h-4 w-4" />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

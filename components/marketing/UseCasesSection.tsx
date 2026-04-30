import { Reveal } from "./Reveal";

const useCases = [
  {
    title: "Schools & Volume",
    text: "Private PIN galleries, parent ordering, package control, and production visibility.",
  },
  {
    title: "Weddings & Events",
    text: "Premium delivery, downloads, favorites, and a polished client experience.",
  },
  {
    title: "Portrait Studios",
    text: "Proofing, ordering, upgrades, and repeatable delivery for sessions.",
  },
  {
    title: "Sports & Teams",
    text: "Organized team jobs, deadline-driven ordering, and export-ready production.",
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
              as="article"
              key={useCase.title}
              delay={index * 90}
              className="premium-card min-h-[240px] rounded-[1.5rem] border border-white/10 bg-white/[0.06] p-5 transition hover:bg-white/[0.09]"
            >
              <div className="mb-12 h-16 rounded-2xl bg-[linear-gradient(135deg,rgba(255,255,255,0.18),rgba(239,68,68,0.22))]" />
              <h3 className="marketing-card-title">{useCase.title}</h3>
              <p className="marketing-caption mt-3 text-white/60">{useCase.text}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

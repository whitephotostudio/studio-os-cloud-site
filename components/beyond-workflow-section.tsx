import {
  ClipboardCheck,
  FolderKanban,
  Images,
  MonitorSmartphone,
  Sparkles,
  Users,
} from "lucide-react";

const featureCards = [
  {
    title: "Premium Online Galleries",
    detail:
      "Deliver branded galleries, client ordering, downloads, and private access as a core part of the platform.",
    icon: Images,
  },
  {
    title: "Projects That Organize Real Jobs",
    detail:
      "Keep albums, access, orders, and delivery tied to the same job instead of scattered across folders and extra tools.",
    icon: FolderKanban,
  },
  {
    title: "Desktop + Cloud Connected Workflow",
    detail:
      "Capture locally, sync to the cloud, and keep the work moving without an export-and-upload gap.",
    icon: MonitorSmartphone,
  },
  {
    title: "Structured Workflows at Scale",
    detail:
      "Stay organized across school, sports, event, and multi-photographer jobs without losing polish for portrait and client delivery.",
    icon: Users,
  },
  {
    title: "AI Background Revenue",
    detail:
      "Turn simple portraits into premium paid upgrades instantly.",
    icon: Sparkles,
  },
  {
    title: "Full Order Control",
    detail:
      "Review and verify orders before print so fulfillment stays under your control.",
    icon: ClipboardCheck,
  },
];

export function BeyondWorkflowSection() {
  return (
    <section className="pb-2 pt-3 sm:pb-4 sm:pt-6">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-[28px] border border-neutral-200 bg-neutral-50/85 p-6 shadow-[0_18px_50px_rgba(20,20,20,0.05)] sm:p-8 lg:p-10">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">
              Why it stands apart
            </div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-950 sm:text-4xl">
              Built for Workflow, Not Just Delivery
            </h2>
            <p className="mt-4 text-base leading-8 text-neutral-600">
              Studio OS gives photographers premium galleries as a core product,
              then goes deeper with Projects, production control, and connected
              desktop + cloud workflow.
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {featureCards.map((card) => {
              const Icon = card.icon;

              return (
                <article
                  key={card.title}
                  className="rounded-[24px] border border-neutral-200 bg-white p-5 shadow-[0_10px_30px_rgba(20,20,20,0.04)]"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#f4c7c9] bg-[#fff4f4]">
                    <Icon className="h-5 w-5 text-[#d3252b]" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold leading-7 text-neutral-950">
                    {card.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-neutral-600">
                    {card.detail}
                  </p>
                </article>
              );
            })}
          </div>

          <div className="mt-8 rounded-[24px] border border-neutral-200 bg-[linear-gradient(180deg,#171717_0%,#0f0f0f_100%)] px-6 py-5 text-white shadow-[0_18px_40px_rgba(20,20,20,0.12)]">
            <p className="text-lg font-medium leading-8 text-white/90 sm:text-xl">
              Most platforms help you share finished photos.
              <br className="hidden sm:block" /> Studio OS helps you run the
              job behind them.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

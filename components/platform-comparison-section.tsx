import { Check, X } from "lucide-react";

type ComparisonValue = "check" | "x" | "limited";

const comparisonRows = [
  {
    label: "Online Galleries",
    typical: "check" as const,
    studioOs: "check" as const,
  },
  {
    label: "Client Ordering",
    typical: "check" as const,
    studioOs: "check" as const,
  },
  {
    label: "Desktop Workflow",
    typical: "x" as const,
    studioOs: "check" as const,
  },
  {
    label: "Multi-Photographer Support",
    typical: "x" as const,
    studioOs: "check" as const,
  },
  {
    label: "School Roster System",
    typical: "x" as const,
    studioOs: "check" as const,
  },
  {
    label: "AI Background Upsells",
    typical: "limited" as const,
    studioOs: "check" as const,
  },
  {
    label: "Order Review Before Print",
    typical: "x" as const,
    studioOs: "check" as const,
  },
  {
    label: "Full Capture to Delivery Workflow",
    typical: "x" as const,
    studioOs: "check" as const,
  },
];

function ComparisonBadge({
  value,
  variant,
}: {
  value: ComparisonValue;
  variant: "typical" | "studio";
}) {
  if (value === "limited") {
    return (
      <span className="inline-flex items-center rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
        Limited
      </span>
    );
  }

  if (value === "check") {
    return (
      <span
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full border ${
          variant === "studio"
            ? "border-[#f4c7c9] bg-[#fff4f4] text-[#d3252b]"
            : "border-neutral-200 bg-white text-neutral-900"
        }`}
      >
        <Check className="h-4 w-4" />
      </span>
    );
  }

  return (
    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-neutral-100 text-neutral-400">
      <X className="h-4 w-4" />
    </span>
  );
}

export function PlatformComparisonSection() {
  return (
    <section className="pb-2 pt-3 sm:pb-4 sm:pt-6">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-[28px] border border-neutral-200 bg-white p-6 shadow-[0_18px_50px_rgba(20,20,20,0.05)] sm:p-8 lg:p-10">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">
              Comparison
            </div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-950 sm:text-4xl">
              More Than a Gallery Platform
            </h2>
            <p className="mt-4 text-base leading-8 text-neutral-600">
              Most photography platforms focus on delivery. Studio OS goes
              further by connecting your entire workflow.
            </p>
          </div>

          <div className="mt-8 overflow-hidden rounded-[24px] border border-neutral-200 bg-neutral-50/75">
            <div className="hidden md:block">
              <div className="grid grid-cols-[1.5fr_0.75fr_0.75fr] border-b border-neutral-200 bg-white/90">
                <div className="px-6 py-4 text-sm font-semibold uppercase tracking-[0.16em] text-neutral-500">
                  Workflow capability
                </div>
                <div className="px-6 py-4 text-center text-sm font-semibold uppercase tracking-[0.16em] text-neutral-500">
                  Typical Platforms
                </div>
                <div className="bg-[linear-gradient(180deg,#171717_0%,#101010_100%)] px-6 py-4 text-center text-sm font-semibold uppercase tracking-[0.16em] text-white">
                  Studio OS
                </div>
              </div>

              {comparisonRows.map((row, index) => (
                <div
                  key={row.label}
                  className={`grid grid-cols-[1.5fr_0.75fr_0.75fr] items-center ${
                    index !== comparisonRows.length - 1
                      ? "border-b border-neutral-200"
                      : ""
                  }`}
                >
                  <div className="px-6 py-5 text-base font-medium text-neutral-950">
                    {row.label}
                  </div>
                  <div className="flex justify-center px-6 py-5">
                    <ComparisonBadge value={row.typical} variant="typical" />
                  </div>
                  <div className="flex justify-center bg-[#fff8f8] px-6 py-5">
                    <ComparisonBadge value={row.studioOs} variant="studio" />
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-3 p-4 md:hidden">
              {comparisonRows.map((row) => (
                <div
                  key={row.label}
                  className="rounded-[20px] border border-neutral-200 bg-white p-4 shadow-[0_8px_24px_rgba(20,20,20,0.04)]"
                >
                  <div className="text-base font-semibold text-neutral-950">
                    {row.label}
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                        Typical Platforms
                      </div>
                      <div className="mt-3">
                        <ComparisonBadge value={row.typical} variant="typical" />
                      </div>
                    </div>
                    <div className="rounded-2xl border border-[#f4c7c9] bg-[#fff8f8] px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8a4a53]">
                        Studio OS
                      </div>
                      <div className="mt-3">
                        <ComparisonBadge value={row.studioOs} variant="studio" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-8 rounded-[24px] border border-neutral-200 bg-[linear-gradient(180deg,#fcfbf8_0%,#f6f1ea_100%)] px-6 py-5 shadow-[0_12px_30px_rgba(20,20,20,0.04)]">
            <p className="text-lg font-medium leading-8 text-neutral-950 sm:text-xl">
              If you&apos;re only using a gallery platform, you&apos;re only
              using part of what&apos;s possible.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

import Link from "next/link";
import { Check, X, Minus } from "lucide-react";

export type FeatureValue = "yes" | "no" | "partial" | string;

export type ComparisonFeature = {
  feature: string;
  studioOs: FeatureValue;
  competitor: FeatureValue;
};

export type ComparisonPageProps = {
  competitorName: string;
  competitorUrl: string;
  headline: string;
  subheadline: string;
  introduction: string;
  features: ComparisonFeature[];
  studioOsAdvantages: string[];
  competitorAdvantages: string[];
  verdict: string;
  targetAudience: string;
};

function CellValue({ value }: { value: FeatureValue }) {
  if (value === "yes") {
    return (
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-green-200 bg-green-50 text-green-600">
        <Check className="h-4 w-4" />
      </span>
    );
  }
  if (value === "no") {
    return (
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 bg-neutral-100 text-neutral-400">
        <X className="h-4 w-4" />
      </span>
    );
  }
  if (value === "partial") {
    return (
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-500">
        <Minus className="h-4 w-4" />
      </span>
    );
  }
  return <span className="text-sm text-neutral-700">{value}</span>;
}

export function ComparisonPage({
  competitorName,
  competitorUrl,
  headline,
  subheadline,
  introduction,
  features,
  studioOsAdvantages,
  competitorAdvantages,
  verdict,
  targetAudience,
}: ComparisonPageProps) {
  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
      {/* Hero */}
      <div className="pb-10 pt-12 sm:pt-16">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">
          Comparison
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-950 sm:text-4xl lg:text-5xl">
          {headline}
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-neutral-600">
          {subheadline}
        </p>
      </div>

      {/* Introduction */}
      <div className="pb-10">
        <p className="text-base leading-8 text-neutral-700">{introduction}</p>
      </div>

      {/* Feature Comparison Table */}
      <div className="pb-12">
        <h2 className="text-2xl font-semibold tracking-tight text-neutral-950">
          Feature-by-Feature Comparison
        </h2>
        <div className="mt-6 overflow-hidden rounded-2xl border border-neutral-200">
          {/* Header */}
          <div className="grid grid-cols-[1.5fr_0.75fr_0.75fr] border-b border-neutral-200 bg-neutral-50">
            <div className="px-5 py-3.5 text-sm font-semibold text-neutral-700">
              Feature
            </div>
            <div className="px-5 py-3.5 text-center text-sm font-semibold text-neutral-950">
              Studio OS
            </div>
            <div className="px-5 py-3.5 text-center text-sm font-semibold text-neutral-700">
              {competitorName}
            </div>
          </div>

          {/* Rows */}
          {features.map((row, i) => (
            <div
              key={row.feature}
              className={`grid grid-cols-[1.5fr_0.75fr_0.75fr] items-center ${
                i !== features.length - 1 ? "border-b border-neutral-200" : ""
              }`}
            >
              <div className="px-5 py-4 text-sm font-medium text-neutral-900">
                {row.feature}
              </div>
              <div className="flex justify-center px-5 py-4">
                <CellValue value={row.studioOs} />
              </div>
              <div className="flex justify-center px-5 py-4">
                <CellValue value={row.competitor} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Advantages */}
      <div className="grid gap-6 pb-12 md:grid-cols-2">
        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-6">
          <h3 className="text-lg font-semibold text-neutral-950">
            Where Studio OS Wins
          </h3>
          <ul className="mt-4 space-y-3">
            {studioOsAdvantages.map((adv) => (
              <li key={adv} className="flex items-start gap-3 text-sm leading-6 text-neutral-700">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                {adv}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white p-6">
          <h3 className="text-lg font-semibold text-neutral-950">
            Where {competitorName} Wins
          </h3>
          <ul className="mt-4 space-y-3">
            {competitorAdvantages.map((adv) => (
              <li key={adv} className="flex items-start gap-3 text-sm leading-6 text-neutral-700">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" />
                {adv}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Who Should Choose What */}
      <div className="pb-12">
        <h2 className="text-2xl font-semibold tracking-tight text-neutral-950">
          Who Is Each Platform Best For?
        </h2>
        <p className="mt-4 text-base leading-8 text-neutral-700">
          {targetAudience}
        </p>
      </div>

      {/* Verdict */}
      <div className="pb-12">
        <div className="rounded-2xl border border-neutral-200 bg-[linear-gradient(180deg,#fcfbf8_0%,#f6f1ea_100%)] p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-neutral-950">
            The Bottom Line
          </h2>
          <p className="mt-3 text-base leading-8 text-neutral-700">
            {verdict}
          </p>
        </div>
      </div>

      {/* CTA */}
      <div className="pb-16">
        <div className="rounded-2xl border border-neutral-200 bg-[linear-gradient(180deg,#171717_0%,#0f0f0f_100%)] p-6 text-center sm:p-8">
          <h2 className="text-xl font-semibold text-white">
            Ready to Try Studio OS Cloud?
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-7 text-white/70">
            Start your free trial and see the full capture-to-delivery workflow in action. No credit card required.
          </p>
          <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/sign-up"
              className="inline-flex items-center justify-center rounded-2xl border border-[#a9191d] bg-[linear-gradient(180deg,#f03a3e_0%,#da262b_46%,#b81c21_100%)] px-6 py-3 text-sm font-medium text-white shadow-[0_14px_28px_rgba(146,15,23,0.18)] transition hover:brightness-[0.98]"
            >
              Start Free Trial
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center rounded-2xl border border-white/20 bg-white/10 px-6 py-3 text-sm font-medium text-white transition hover:bg-white/15"
            >
              See Pricing
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

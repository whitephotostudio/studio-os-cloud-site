import Link from "next/link";
import { Check } from "lucide-react";

export type SeoLandingPageProps = {
  badge: string;
  headline: string;
  subheadline: string;
  introduction: string;
  whoItsFor: {
    heading?: string;
    description: string;
    personas: string[];
  };
  differentiators: {
    heading?: string;
    description: string;
    points: { title: string; detail: string }[];
  };
  features: { name: string; description: string }[];
  comparisonIntro?: string;
  comparisonPoints?: { label: string; studioOs: string; others: string }[];
  ctaHeading: string;
  ctaDescription: string;
};

export function SeoLandingPage({
  badge,
  headline,
  subheadline,
  introduction,
  whoItsFor,
  differentiators,
  features,
  comparisonIntro,
  comparisonPoints,
  ctaHeading,
  ctaDescription,
}: SeoLandingPageProps) {
  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
      {/* Hero */}
      <div className="pb-8 pt-12 sm:pt-16">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">
          {badge}
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-950 sm:text-4xl lg:text-5xl">
          {headline}
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-neutral-600">
          {subheadline}
        </p>
      </div>

      {/* Introduction */}
      <div className="pb-12">
        <p className="text-base leading-8 text-neutral-700">{introduction}</p>
      </div>

      {/* Who It's For */}
      <div className="pb-12">
        <h2 className="text-2xl font-semibold tracking-tight text-neutral-950">
          {whoItsFor.heading ?? "Who It\u2019s For"}
        </h2>
        <p className="mt-3 text-base leading-8 text-neutral-600">
          {whoItsFor.description}
        </p>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {whoItsFor.personas.map((p) => (
            <li key={p} className="flex items-start gap-3">
              <span className="mt-1 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-neutral-950 text-white">
                <Check className="h-3 w-3" />
              </span>
              <span className="text-sm leading-6 text-neutral-700">{p}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* What Makes Studio OS Different */}
      <div className="pb-12">
        <h2 className="text-2xl font-semibold tracking-tight text-neutral-950">
          {differentiators.heading ?? "Where Studio OS Goes Deeper"}
        </h2>
        <p className="mt-3 text-base leading-8 text-neutral-600">
          {differentiators.description}
        </p>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {differentiators.points.map((pt) => (
            <div
              key={pt.title}
              className="rounded-2xl border border-neutral-200 bg-white p-6"
            >
              <h3 className="text-sm font-semibold text-neutral-950">
                {pt.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-neutral-600">
                {pt.detail}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Features */}
      <div className="pb-12">
        <h2 className="text-2xl font-semibold tracking-tight text-neutral-950">
          Key Features
        </h2>
        <div className="mt-6 divide-y divide-neutral-100">
          {features.map((f) => (
            <div key={f.name} className="flex gap-4 py-4">
              <span className="mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-green-200 bg-green-50 text-green-600">
                <Check className="h-3.5 w-3.5" />
              </span>
              <div>
                <div className="text-sm font-semibold text-neutral-950">
                  {f.name}
                </div>
                <div className="mt-0.5 text-sm leading-6 text-neutral-600">
                  {f.description}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Comparison */}
      {comparisonPoints && comparisonPoints.length > 0 && (
        <div className="pb-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-950">
            How Studio OS Cloud Compares
          </h2>
          {comparisonIntro && (
            <p className="mt-3 text-base leading-8 text-neutral-600">
              {comparisonIntro}
            </p>
          )}
          <div className="mt-6 overflow-hidden rounded-2xl border border-neutral-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 text-left">
                  <th className="px-4 py-3 font-semibold text-neutral-500">
                    Capability
                  </th>
                  <th className="px-4 py-3 font-semibold text-neutral-950">
                    Studio OS Cloud
                  </th>
                  <th className="px-4 py-3 font-semibold text-neutral-500">
                    Others
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {comparisonPoints.map((cp) => (
                  <tr key={cp.label}>
                    <td className="px-4 py-3 text-neutral-700">{cp.label}</td>
                    <td className="px-4 py-3 font-medium text-neutral-950">
                      {cp.studioOs}
                    </td>
                    <td className="px-4 py-3 text-neutral-500">{cp.others}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="pb-16 pt-4">
        <div className="rounded-2xl border border-neutral-200 bg-neutral-950 px-8 py-10 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-white">
            {ctaHeading}
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-base leading-7 text-neutral-400">
            {ctaDescription}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/sign-up"
              className="inline-flex items-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-neutral-100"
            >
              Start Free Trial
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center rounded-full border border-neutral-700 px-6 py-3 text-sm font-semibold text-white transition hover:border-neutral-500"
            >
              View Pricing
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

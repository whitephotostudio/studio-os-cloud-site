"use client";

import { useState, type ComponentType } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Camera,
  Check,
  DollarSign,
  Globe,
  Layers3,
  MonitorSmartphone,
  Sparkles,
  TableProperties,
  Wand2,
  X,
} from "lucide-react";
import {
  ANNUAL_DISCOUNT_PERCENT,
  getPlanPriceCents,
  type BillingInterval,
  type PlanCode,
} from "@/lib/studio-pricing";

type PricingShowcaseProps = {
  variant?: "home" | "page";
};

type PlanCard = {
  code: PlanCode;
  icon: IconType;
  name: string;
  eyebrow: string;
  badge?: string;
  summary: string;
  usageFee: string;
  ctaLabel: string;
  heroNote: string;
  included: string[];
  excluded?: string[];
  footerNote: string;
};

type IconType = ComponentType<{ className?: string }>;

type ComparisonValue =
  | boolean
  | string
  | {
      label: string;
      note?: string;
    };

type ComparisonRow = {
  label: string;
  values: Record<PlanCode, ComparisonValue>;
};

const homePlans: PlanCard[] = [
  {
    code: "starter",
    icon: Globe,
    name: "Web Gallery Plan",
    eyebrow: "For online delivery",
    summary:
      "A clean web-only plan for photographers who want polished galleries, online viewing, delivery, and ordering without the Studio OS app.",
    usageFee: "$0.55 per paid order",
    ctaLabel: "Get Started",
    heroNote: "Online gallery tools only",
    included: [
      "Web gallery access",
      "Online photo viewing",
      "Photo delivery",
      "Ordering workflow",
    ],
    excluded: [
      "Studio OS app access",
      "School shooting tools",
      "Photography keys",
      "Backdrop upsell tools",
    ],
    footerNote: "Best if you only need client-facing gallery delivery and ordering.",
  },
  {
    code: "core",
    icon: MonitorSmartphone,
    name: "App Plan",
    eyebrow: "Unlock the Studio OS app",
    badge: "Most Popular",
    summary:
      "Built for school and studio photographers who want the Studio OS app, faster production, and new upsell opportunities without jumping to the largest plan.",
    usageFee: "$0.35 per paid order",
    ctaLabel: "Choose Plan",
    heroNote: "1 Photography Key included",
    included: [
      "Everything in Web Gallery",
      "Studio OS app access",
      "1 Photography Key",
      "Direct camera tethering",
      "School photography workflow tools",
      "AI backdrop cleanup and replacement in the app",
      "Client backdrop preview gallery online",
      "Set free and premium backdrop prices",
      "Premium backdrop choices for parents",
      "Print-ready stitched background workflow",
      "One-click AI composites with separate pricing",
      "Roster converter",
    ],
    footerNote:
      "Includes 1 key only. If you need a second key, you must upgrade to Studio.",
  },
  {
    code: "studio",
    icon: Camera,
    name: "Studio Plan",
    eyebrow: "For growing production teams",
    badge: "Best for Growing Studios",
    summary:
      "Full Studio OS workflow with more room to scale, advanced school-day tools, and the only plan that can grow beyond the included keys.",
    usageFee: "$0.25 per paid order",
    ctaLabel: "Upgrade to Studio",
    heroNote: "2 Photography Keys included",
    included: [
      "Everything in the App Plan",
      "2 Photography Keys",
      "Full Studio OS workflow",
      "Direct camera tethering",
      "Advanced school shooting tools",
      "AI backdrop cleanup and replacement in the app",
      "Client backdrop preview gallery online",
      "Set free and premium backdrop prices",
      "Premium backdrop choices for parents",
      "Print-ready stitched background workflow",
      "One-click AI composites with separate pricing",
      "Roster converter",
      "Extra keys for $55 each",
    ],
    footerNote:
      "Studio includes 2 keys and is the only plan that can add extra keys for $55 each.",
  },
];

const pagePlans: PlanCard[] = [
  {
    code: "starter",
    icon: Globe,
    name: "Starter Plan",
    eyebrow: "For photographers getting started",
    summary:
      "For photographers getting started or using basic galleries.",
    usageFee: "$0.55 per paid order",
    ctaLabel: "Start Free Trial",
    heroNote: "Basic gallery delivery",
    included: [
      "Deliver and sell photos through your own gallery",
      "Let clients order prints and digital products directly",
      "Share polished online galleries with clean client access",
      "Send downloads and finished images without extra tools",
    ],
    excluded: [
      "Desktop workflow tools",
      "School roster workflows",
      "Multi-photographer production tools",
      "AI background upgrade tools",
    ],
    footerNote:
      "A simple way to start selling and delivering online.",
  },
  {
    code: "core",
    icon: MonitorSmartphone,
    name: "Core Plan",
    eyebrow: "For full workflow and ordering",
    badge: "Most Popular",
    summary:
      "For photographers who want full workflow, client ordering, and production tools in one system.",
    usageFee: "$0.35 per paid order",
    ctaLabel: "Start Free Trial",
    heroNote: "1 Photography Key included",
    included: [
      "Everything in Starter",
      "Run desktop capture and production inside Studio OS",
      "Shoot faster with direct camera tethering",
      "Keep school and event jobs organized from the start",
      "Offer premium background upgrades and keep the revenue",
      "Move from capture to delivery without switching tools",
    ],
    footerNote:
      "Best fit for photographers replacing multiple tools with one connected system.",
  },
  {
    code: "studio",
    icon: Camera,
    name: "Pro Plan",
    eyebrow: "For scaling teams and advanced workflows",
    summary:
      "For studios scaling volume, teams, and advanced workflows.",
    usageFee: "$0.25 per paid order",
    ctaLabel: "Start Free Trial",
    heroNote: "2 Photography Keys included",
    included: [
      "Everything in Core",
      "Run multiple photographers inside one connected workflow",
      "Scale school and event production with more team capacity",
      "Add extra photography keys as your workflow grows",
      "Keep capture, review, ordering, and delivery aligned at higher volume",
    ],
    footerNote:
      "Built for studios ready to scale production volume without adding more disconnected software.",
  },
];

const businessBenefits = [
  {
    title: "Direct camera tethering built in",
    text: "No third-party tethering app required. Connect your camera in Studio OS, shoot directly, and keep the roster-confirmed workflow moving.",
    icon: Camera,
  },
  {
    title: "AI background removal in seconds",
    text: "AI handles the heavy lifting so photographers can clean up and replace backgrounds faster across high-volume jobs.",
    icon: Wand2,
  },
  {
    title: "Convert rosters faster",
    text: "Use roster conversion and school workflow tools to keep photo day organized from the start.",
    icon: TableProperties,
  },
  {
    title: "No green screen required",
    text: "AI backdrop tools are designed to work even when the image was not shot on green screen.",
    icon: Sparkles,
  },
  {
    title: "Build AI class composites in one click",
    text: "Generate class composites fast with AI head sizing, crop alignment, logo placement, class auto-assignment, separate composite pricing, and full manual control when needed.",
    icon: Layers3,
  },
  {
    title: "Let parents preview online",
    text: "Parents can see beautiful backdrop options in a live gallery-style preview and approve the one they want.",
    icon: Camera,
  },
  {
    title: "Keep 100% of the upsell",
    text: "The premium backdrop fee belongs to the photographer. Studio OS does not take a cut.",
    icon: DollarSign,
  },
];

const pageValueBullets = [
  "Run your full workflow from capture to delivery",
  "Keep your production organized",
  "Offer upgrades and increase revenue",
  "Replace multiple tools with one system",
];

const comparisonRows: ComparisonRow[] = [
  {
    label: "Web Gallery Access",
    values: { starter: true, core: true, studio: true },
  },
  {
    label: "Studio OS App",
    values: { starter: false, core: true, studio: true },
  },
  {
    label: "Photography Keys",
    values: {
      starter: "0",
      core: { label: "1", note: "Second key requires Studio" },
      studio: "2",
    },
  },
  {
    label: "School Shoot Features",
    values: { starter: false, core: true, studio: true },
  },
  {
    label: "Direct Camera Tethering",
    values: { starter: false, core: true, studio: true },
  },
  {
    label: "AI Backdrop Removal in App",
    values: { starter: false, core: true, studio: true },
  },
  {
    label: "Client Backdrop Preview Gallery",
    values: { starter: false, core: true, studio: true },
  },
  {
    label: "Free & Premium Backdrop Pricing",
    values: { starter: false, core: true, studio: true },
  },
  {
    label: "Premium Backdrops for Parents",
    values: { starter: false, core: true, studio: true },
  },
  {
    label: "Photographer Keeps 100% of Backdrop Upsell Revenue",
    values: { starter: false, core: true, studio: true },
  },
  {
    label: "Collage Builder",
    values: { starter: false, core: true, studio: true },
  },
  {
    label: "Roster Converter",
    values: { starter: false, core: true, studio: true },
  },
  {
    label: "Extra Keys for $55",
    values: {
      starter: false,
      core: { label: "No", note: "Upgrade to Studio for more keys" },
      studio: true,
    },
  },
  {
    label: "Background Removal Credits",
    values: {
      starter: { label: "Sold separately", note: "Purchase monthly credit packs as needed" },
      core: { label: "Sold separately", note: "Purchase monthly credit packs as needed" },
      studio: { label: "Sold separately", note: "Purchase monthly credit packs as needed" },
    },
  },
  {
    label: "Platform Usage Billing",
    values: {
      starter: { label: "$0.55 per paid order" },
      core: { label: "$0.35 per paid order" },
      studio: { label: "$0.25 per paid order" },
    },
  },
];

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatMonthlyEquivalent(cents: number) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 1200);
}

function renderComparisonValue(value: ComparisonValue) {
  if (typeof value === "boolean") {
    return value ? (
      <span className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">
        <Check className="h-4 w-4" />
        Yes
      </span>
    ) : (
      <span className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-400">
        <X className="h-4 w-4" />
        No
      </span>
    );
  }

  if (typeof value === "string") {
    return <span className="text-sm font-semibold text-neutral-950">{value}</span>;
  }

  return (
    <div>
      <div className="text-sm font-semibold text-neutral-950">{value.label}</div>
      {value.note ? <div className="mt-1 text-xs leading-5 text-neutral-500">{value.note}</div> : null}
    </div>
  );
}

export function PricingShowcase({ variant = "home" }: PricingShowcaseProps) {
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("month");
  const showFullPage = variant === "page";
  const pricingPlans = showFullPage ? pagePlans : homePlans;
  const previewHref = "/studio-os";
  const introEyebrow = showFullPage
    ? "Pricing"
    : "Keep more of what you earn";
  const introHeading = showFullPage
    ? "Simple Pricing. Built to Grow With You."
    : "No hidden fees. No complicated workflows.";
  const introText = showFullPage
    ? "Start with what you need and scale as your photography business grows."
    : "Just a clean system that helps you run your business better.";
  const introSupportLine = showFullPage
    ? "Most photographers replace multiple tools with Studio OS."
    : null;
  const introHighlights = showFullPage
    ? [
        "Starter for basic galleries",
        "Core for full workflow and ordering",
        "Pro for scaling teams and advanced production",
      ]
    : [
        "Faster capture and organization",
        "AI tools that reduce manual work",
        "Client ordering inside your system",
        "No green screen required",
        "Print-ready delivery",
        "Class composites and roster tools",
        "Built for high-volume jobs",
        "Keep 100% of premium upgrade revenue",
      ];
  const revenueEyebrow = showFullPage
    ? "Built to earn more"
    : "Revenue opportunity";
  const revenueHeading = showFullPage
    ? "Turn simple add-ons into real revenue."
    : "Turn Every Photo Into More Value";
  const revenueText = showFullPage
    ? "Offer premium upgrades like background enhancements without adding extra manual work or handing away the profit."
    : "Offer upgrades like background enhancements without adding extra work.";
  const revenueItems = showFullPage
    ? [
        {
          title: "Choose what is included",
          text: "Set which options are standard and which become paid upgrades.",
        },
        {
          title: "Sell inside your workflow",
          text: "Parents and clients see upgrades in the same system used for delivery and ordering.",
        },
        {
          title: "Keep the upside",
          text: "Premium upgrade revenue stays with your studio, not the platform.",
        },
      ]
    : [
        {
          title: "Set your pricing",
          text: "Choose what is included and what becomes a paid upgrade.",
        },
        {
          title: "Clients order directly",
          text: "Parents and clients choose enhancements inside your own system.",
        },
        {
          title: "More value per job",
          text: "Upsells happen without slowing down production or adding extra admin.",
        },
      ];
  const revenueNote = showFullPage
    ? "No hidden fees. Premium upgrade revenue stays with the photographer."
    : "No hidden fees. Premium upgrade revenue stays with the photographer.";
  const businessEyebrow = showFullPage ? "Business outcomes" : "Built for real photography workflows";
  const businessHeading = showFullPage
    ? "Faster production, better delivery, and new photographer revenue."
    : "Built for Real Photography Workflows";
  const businessText = showFullPage
    ? "The Studio OS app plans do more than host galleries. They let photographers tether a camera directly without a third-party tethering app, move faster on school photo day, clean up backgrounds with AI without a green screen, let parents preview new backdrops online, build AI class composites, convert rosters, and deliver beautiful print-ready images with almost no manual effort."
    : "Studio OS is designed around how photographers actually work — not generic software.";

  return (
    <section className="relative overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 14% 4%, rgba(98,46,59,0.045), transparent 25%), radial-gradient(circle at 78% 12%, rgba(41,37,36,0.045), transparent 22%), linear-gradient(180deg, rgba(247,243,239,0.72) 0%, rgba(255,255,255,0.2) 34%, rgba(255,255,255,0) 58%)",
        }}
      />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className={showFullPage ? "pb-8 pt-6 sm:pb-10 sm:pt-8" : "pb-16 pt-10 sm:pb-20 sm:pt-14"}>
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-neutral-500">
                {introEyebrow}
              </div>
              <h2 className="mt-4 text-4xl font-semibold tracking-tight text-neutral-950 sm:text-5xl">
                {introHeading}
              </h2>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-neutral-600">
                {introText}
              </p>
              {introSupportLine ? (
                <p className="mt-3 text-sm font-medium leading-7 text-neutral-500">
                  {introSupportLine}
                </p>
              ) : null}

              <div className="mt-6 flex flex-wrap gap-3 text-sm text-neutral-700">
                {introHighlights.map((item) => (
                  <span
                    key={item}
                    className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2 shadow-sm"
                  >
                    <span className="h-2 w-2 rounded-full bg-[#5f1f2d]" />
                    {item}
                  </span>
                ))}
              </div>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href={showFullPage ? "#pricing-options" : "/sign-up"}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-black px-5 py-3 font-medium text-white shadow-md transition hover:opacity-90"
                >
                  {showFullPage ? "Start Free Trial" : "Get Started"}
                </Link>
                <Link
                  href={previewHref}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white px-5 py-3 font-medium text-neutral-950 shadow-sm transition hover:bg-neutral-50"
                >
                  Platform Demo
                </Link>
              </div>
            </div>

            <div className="rounded-[28px] border border-neutral-200 bg-white p-6 shadow-xl sm:p-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#d9c2c8] bg-[#fcf7f8] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#7a2f3f]">
                {revenueEyebrow}
              </div>
              <h3 className="mt-5 text-2xl font-semibold tracking-tight text-neutral-950">
                {revenueHeading}
              </h3>
              <p className="mt-3 text-base leading-8 text-neutral-600">
                {revenueText}
              </p>

              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                {revenueItems.map((item) => (
                  <div key={item.title} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                    <div className="text-sm font-semibold text-neutral-950">{item.title}</div>
                    <div className="mt-2 text-sm leading-6 text-neutral-600">{item.text}</div>
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm font-semibold leading-7 text-emerald-800">
                {revenueNote}
              </div>
            </div>
          </div>

          <div className="mt-10 rounded-[30px] border border-neutral-200 bg-white p-6 shadow-lg sm:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="text-sm font-semibold uppercase tracking-[0.16em] text-neutral-500">
                  {businessEyebrow}
                </div>
                <h3 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-950">
                  {businessHeading}
                </h3>
                <p className="mt-4 text-base leading-8 text-neutral-600">
                  {businessText}
                </p>
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-semibold leading-7 text-emerald-800">
                Charge your own premium backdrop fee and keep 100% of that revenue.
              </div>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {businessBenefits.map((benefit) => {
                const Icon = benefit.icon;
                return (
                  <div key={benefit.title} className="rounded-[24px] border border-neutral-200 bg-neutral-50 p-5">
                    <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-neutral-200 bg-white text-neutral-950">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="mt-4 text-lg font-semibold text-neutral-950">{benefit.title}</div>
                    <p className="mt-2 text-sm leading-7 text-neutral-600">{benefit.text}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div
            id="pricing-options"
            className="mt-10 flex flex-col items-start justify-between gap-5 rounded-[24px] border border-neutral-200 bg-white px-5 py-5 shadow-sm sm:flex-row sm:items-center sm:px-6"
          >
            <div>
              <div className="text-sm font-semibold text-neutral-950">Choose monthly or annual billing</div>
              <div className="mt-1 text-sm leading-6 text-neutral-500">
                Annual billing is paid in advance and saves {ANNUAL_DISCOUNT_PERCENT}% on the base
                subscription.
              </div>
            </div>

            <div className="inline-flex gap-2 rounded-2xl border border-neutral-200 bg-neutral-100 p-1.5">
              {(["month", "year"] as BillingInterval[]).map((interval) => {
                const active = billingInterval === interval;
                return (
                  <button
                    key={interval}
                    type="button"
                    onClick={() => setBillingInterval(interval)}
                    className={
                      active
                        ? "rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
                        : "rounded-xl px-4 py-2 text-sm font-semibold text-neutral-600 transition hover:text-neutral-950"
                    }
                  >
                    {interval === "year" ? "Annual" : "Monthly"}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            {pricingPlans.map((plan) => {
              const activePrice = getPlanPriceCents(plan.code, billingInterval);
              const isFeatured = plan.code === "core";
              const annual = billingInterval === "year";
              const Icon = plan.icon;

              return (
                <article
                  key={plan.code}
                  className={
                    isFeatured
                      ? "relative overflow-hidden rounded-[30px] border border-neutral-950 bg-neutral-950 p-6 text-white shadow-2xl sm:p-7"
                      : "relative overflow-hidden rounded-[30px] border border-neutral-200 bg-white p-6 shadow-lg sm:p-7"
                  }
                >
                  <div
                    className="absolute right-0 top-0 h-32 w-32 translate-x-10 -translate-y-10 rounded-full"
                    style={{
                      background: isFeatured
                        ? "radial-gradient(circle, rgba(95,31,45,0.18), transparent 68%)"
                        : "radial-gradient(circle, rgba(15,23,42,0.06), transparent 70%)",
                    }}
                  />

                  <div className="relative">
                    <div className="flex items-center justify-between gap-4">
                      <div className={isFeatured ? "inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white" : "inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-neutral-200 bg-neutral-50 text-neutral-950"}>
                        <Icon className="h-5 w-5" />
                      </div>

                      {plan.badge ? (
                        <span
                          className={
                            isFeatured
                              ? "rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white text-center leading-tight"
                              : "rounded-full border border-[#d9c2c8] bg-[#fcf7f8] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7a2f3f] text-center leading-tight"
                          }
                        >
                          {plan.badge}
                        </span>
                      ) : null}
                    </div>

                    <div>
                      <div className={isFeatured ? "mt-4 text-sm font-semibold uppercase tracking-[0.16em] text-neutral-400" : "mt-4 text-sm font-semibold uppercase tracking-[0.16em] text-neutral-500"}>
                        {plan.eyebrow}
                      </div>
                      <h3 className="mt-3 text-3xl font-semibold tracking-tight">{plan.name}</h3>
                    </div>

                    <div className="mt-6 flex items-end gap-2">
                      <div className="text-5xl font-semibold tracking-tight">
                        {formatMoney(activePrice)}
                      </div>
                      <div className={isFeatured ? "pb-2 text-sm font-medium text-neutral-300" : "pb-2 text-sm font-medium text-neutral-500"}>
                        /{annual ? "year" : "month"}
                      </div>
                    </div>

                    <div className={isFeatured ? "mt-3 text-sm text-neutral-300" : "mt-3 text-sm text-neutral-500"}>
                      {annual
                        ? `Paid in advance · equivalent to ${formatMonthlyEquivalent(activePrice)}/month`
                        : "Billed monthly"}
                    </div>

                    {showFullPage ? (
                      <div
                        className={
                          isFeatured
                            ? "mt-2 text-sm text-neutral-300"
                            : "mt-2 text-sm text-neutral-500"
                        }
                      >
                        Usage billing: {plan.usageFee}
                      </div>
                    ) : null}

                    <div className={isFeatured ? "mt-4 inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-white" : "mt-4 inline-flex rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-neutral-700"}>
                      {plan.heroNote}
                    </div>

                    <p className={isFeatured ? "mt-5 text-base leading-8 text-neutral-300" : "mt-5 text-base leading-8 text-neutral-600"}>
                      {plan.summary}
                    </p>

                    <div className="mt-6">
                      <div className={isFeatured ? "text-sm font-semibold uppercase tracking-[0.14em] text-neutral-400" : "text-sm font-semibold uppercase tracking-[0.14em] text-neutral-500"}>
                        Included
                      </div>
                      <ul className="mt-4 space-y-3">
                        {plan.included.map((item) => (
                          <li key={item} className="flex items-start gap-3">
                            <span className={isFeatured ? "mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300" : "mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"}>
                              <Check className="h-3.5 w-3.5" />
                            </span>
                            <span className={isFeatured ? "text-sm leading-6 text-neutral-200" : "text-sm leading-6 text-neutral-700"}>
                              {item}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {plan.excluded?.length ? (
                      <div className="mt-6">
                        <div className={isFeatured ? "text-sm font-semibold uppercase tracking-[0.14em] text-neutral-400" : "text-sm font-semibold uppercase tracking-[0.14em] text-neutral-500"}>
                          Not included
                        </div>
                        <ul className="mt-4 space-y-3">
                          {plan.excluded.map((item) => (
                            <li key={item} className="flex items-start gap-3">
                              <span className={isFeatured ? "mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-neutral-300" : "mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-neutral-100 text-neutral-500"}>
                                <X className="h-3.5 w-3.5" />
                              </span>
                              <span className={isFeatured ? "text-sm leading-6 text-neutral-300" : "text-sm leading-6 text-neutral-500"}>
                                {item}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <div className={isFeatured ? "mt-6 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm leading-6 text-neutral-200" : "mt-6 rounded-2xl border border-neutral-200 bg-white px-4 py-4 text-sm leading-6 text-neutral-600"}>
                      {plan.footerNote}
                    </div>

                    <Link
                      href={`/sign-up?plan=${plan.code}&interval=${billingInterval}`}
                      className={
                        isFeatured
                          ? "mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 font-semibold text-neutral-950 transition hover:bg-neutral-100"
                          : "mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-black px-5 py-3 font-semibold text-white transition hover:opacity-90"
                      }
                    >
                      {plan.ctaLabel}
                      <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>

          {showFullPage ? (
            <p className="mt-6 text-sm font-medium leading-7 text-neutral-500">
              Start simple. Upgrade when your workflow grows.
            </p>
          ) : null}

          {showFullPage ? (
            <>
              <div className="mt-10 rounded-[30px] border border-neutral-200 bg-white p-6 shadow-lg sm:p-8">
                <div className="max-w-3xl">
                  <div className="text-sm font-semibold uppercase tracking-[0.16em] text-neutral-500">
                    Why studios choose it
                  </div>
                  <h3 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-950">
                    More Than Just a Gallery Platform
                  </h3>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {pageValueBullets.map((item) => (
                    <div
                      key={item}
                      className="rounded-[24px] border border-neutral-200 bg-neutral-50 p-5"
                    >
                      <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#fff4f4] text-[#d3252b]">
                        <Check className="h-4 w-4" />
                      </div>
                      <p className="mt-4 text-sm font-medium leading-7 text-neutral-800">
                        {item}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-10 rounded-[30px] border border-neutral-200 bg-neutral-950 p-6 text-white shadow-2xl sm:p-8">
                <div className="grid gap-8 lg:grid-cols-[1fr_0.95fr] lg:items-center">
                  <div>
                  <div className="text-sm font-semibold uppercase tracking-[0.16em] text-neutral-400">
                      Backdrop upsell benefit
                    </div>
                    <h3 className="mt-3 text-3xl font-semibold tracking-tight">
                      Offer free and premium backdrops with your own pricing.
                    </h3>
                    <p className="mt-4 max-w-2xl text-base leading-8 text-neutral-300">
                      This is not a Studio OS fee. Photographers decide which backdrop options are
                      free and which are premium, parents preview and choose online, and the
                      approved background is stitched for print while the photographer keeps 100% of
                      the premium backdrop revenue.
                    </p>
                  </div>

                  <div className="rounded-[28px] border border-white/10 bg-white/5 p-6">
                    <div className="text-sm font-semibold uppercase tracking-[0.16em] text-neutral-400">
                      Example
                    </div>
                    <div className="mt-4 space-y-3">
                      {[
                        "Prepare the image inside the Studio OS app.",
                        "Choose which backdrop options are free and which are premium.",
                        "Set your own premium prices, for example free standard options and $2 upgrades.",
                        "Parent previews the backdrop choices online and approves one.",
                        "The photographer keeps 100% of any premium backdrop revenue.",
                      ].map((item) => (
                        <div key={item} className="flex items-start gap-3">
                          <span className="mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
                            <Check className="h-3.5 w-3.5" />
                          </span>
                          <span className="text-sm leading-6 text-neutral-200">{item}</span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-4 text-sm font-semibold leading-7 text-emerald-200">
                      Free and premium backdrop pricing stays in the photographer&apos;s control.
                      Studio OS does not take the premium upgrade fee.
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-10 rounded-[30px] border border-neutral-200 bg-white p-6 shadow-lg sm:p-8">
                <div className="max-w-3xl">
                  <div className="text-sm font-semibold uppercase tracking-[0.16em] text-neutral-500">
                    Compare plans
                  </div>
                  <h3 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-950">
                    See exactly what unlocks at each level.
                  </h3>
                  <p className="mt-4 text-base leading-8 text-neutral-600">
                    Start with gallery delivery or move up to the Studio OS app when you need school
                    workflow tools, backdrop revenue opportunities, AI class composites, and more keys.
                  </p>
                </div>

                <div className="mt-8 overflow-x-auto">
                  <table className="min-w-[880px] w-full border-separate border-spacing-0 overflow-hidden rounded-[24px] border border-neutral-200">
                    <thead>
                      <tr className="bg-neutral-50">
                        <th className="border-b border-neutral-200 px-5 py-4 text-left text-sm font-semibold text-neutral-500">
                          Feature
                        </th>
                        {pricingPlans.map((plan) => (
                          <th
                            key={plan.code}
                            className="border-b border-neutral-200 px-5 py-4 text-left"
                          >
                            <div className="text-sm font-semibold text-neutral-950">{plan.name}</div>
                            <div className="mt-1 text-sm text-neutral-500">
                              {formatMoney(getPlanPriceCents(plan.code, "month"))}/month
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {comparisonRows.map((row, rowIndex) => (
                        <tr key={row.label} className={rowIndex % 2 === 0 ? "bg-white" : "bg-neutral-50/60"}>
                          <td className="border-b border-neutral-200 px-5 py-4 align-top text-sm font-medium text-neutral-950">
                            {row.label}
                          </td>
                          {(["starter", "core", "studio"] as PlanCode[]).map((planCode) => (
                            <td
                              key={planCode}
                              className="border-b border-neutral-200 px-5 py-4 align-top"
                            >
                              {renderComparisonValue(row.values[planCode])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-10 rounded-[30px] border border-neutral-200 bg-white p-6 shadow-lg sm:p-8">
                <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
                  <div>
                    <div className="text-sm font-semibold uppercase tracking-[0.16em] text-neutral-500">
                      Ready to start
                    </div>
                    <h3 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-950">
                      Choose the plan that fits your workflow today.
                    </h3>
                  <p className="mt-4 max-w-2xl text-base leading-8 text-neutral-600">
                    Start with what you need today, then grow into more workflow power as your business expands.
                  </p>
                  <p className="mt-3 text-sm font-medium text-neutral-500">
                    No long-term commitment. Cancel anytime.
                  </p>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Link
                      href="#pricing-options"
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-black px-5 py-3 font-medium text-white shadow-md transition hover:opacity-90"
                    >
                      Start Free Trial
                    </Link>
                    <Link
                      href={previewHref}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white px-5 py-3 font-medium text-neutral-950 shadow-sm transition hover:bg-neutral-50"
                    >
                      Preview Platform
                    </Link>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="mt-10 max-w-3xl text-sm font-medium leading-7 text-neutral-500 sm:text-base">
                Once everything is connected, the way you run your business changes.
              </p>

              <div className="mt-5 flex flex-col items-start justify-between gap-5 rounded-[28px] border border-neutral-200 bg-white p-6 shadow-lg sm:flex-row sm:items-center">
                <div className="max-w-2xl">
                  <div className="text-sm font-semibold uppercase tracking-[0.16em] text-neutral-500">
                    Take control
                  </div>
                  <div className="mt-2 text-2xl font-semibold tracking-tight text-neutral-950">
                    Take Control of Your Workflow
                  </div>
                  <p className="mt-3 text-sm leading-7 text-neutral-600">
                    Stop juggling tools and start running your photography business with one connected system.
                  </p>
                </div>

                <Link
                  href="/sign-up"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-black px-5 py-3 font-medium text-white shadow-md transition hover:opacity-90"
                >
                  Start Free Trial
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

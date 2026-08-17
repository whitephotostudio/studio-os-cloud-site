"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowUpRight,
  CalendarCheck2,
  Camera,
  Check,
  Globe2,
  Monitor,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { Reveal } from "@/components/marketing/Reveal";
import { PricingJsonLd } from "@/components/json-ld";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import {
  ANNUAL_DISCOUNT_PERCENT,
  PLAN_DEFS,
  type BillingInterval,
  type PlanCode,
} from "@/lib/studio-pricing";
import { FREE_TRIAL_DAYS } from "@/lib/trial-config";

type PricingPlan = {
  eyebrow: string;
  name: string;
  price: string;
  priceSuffix?: string;
  billing: string;
  badge: string;
  description: string;
  included: string[];
  notIncluded?: string[];
  note: string;
  cta: string;
  href: string;
  icon: LucideIcon;
  featured?: boolean;
  ribbon?: string;
};

type PricingMotion = "left" | "drop" | "right";

type ComparisonStatus = "yes" | "no" | "limited";

const pricingComparisonRows: {
  label: string;
  galleryOnly: ComparisonStatus;
  studioOs: ComparisonStatus;
}[] = [
  {
    label: "Premium Online Galleries",
    galleryOnly: "yes",
    studioOs: "yes",
  },
  {
    label: "Client Ordering and Downloads",
    galleryOnly: "yes",
    studioOs: "yes",
  },
  {
    label: "Projects and Job Structure",
    galleryOnly: "limited",
    studioOs: "yes",
  },
  {
    label: "Online Booking + Student Rosters",
    galleryOnly: "no",
    studioOs: "yes",
  },
  {
    label: "Desktop + Cloud Workflow",
    galleryOnly: "no",
    studioOs: "yes",
  },
  {
    label: "Order Review Before Print",
    galleryOnly: "limited",
    studioOs: "yes",
  },
  {
    label: "Multi-Photographer or Structured Jobs",
    galleryOnly: "limited",
    studioOs: "yes",
  },
  {
    label: "AI Upsells Inside the Workflow",
    galleryOnly: "limited",
    studioOs: "yes",
  },
  {
    label: "Connected Capture-to-Delivery Workflow",
    galleryOnly: "no",
    studioOs: "yes",
  },
];

const studioPlanFeatures = [
  "Everything in the App Plan",
  "2 Photography Keys",
  "Full Studio OS workflow",
  "Online school and event booking links",
  "Automatic booking-to-student-roster workflow",
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
];

const plans: PricingPlan[] = [
  {
    eyebrow: "Try Studio OS First",
    name: "Free Trial",
    price: "$0",
    priceSuffix: `for ${FREE_TRIAL_DAYS} days`,
    billing: `Free ${FREE_TRIAL_DAYS}-day access`,
    badge: "Everything in Studio Plan",
    description:
      "Try the full Studio OS workflow before choosing a paid plan. Use the same Studio Plan tools for galleries, production, school workflows, and ordering.",
    included: studioPlanFeatures,
    note: `Includes everything in the Studio Plan for ${FREE_TRIAL_DAYS} days. After the trial, choose the plan that fits your studio.`,
    cta: "Start Free Trial",
    href: "/sign-up",
    icon: Sparkles,
    ribbon: `Free ${FREE_TRIAL_DAYS} Days`,
  },
  {
    eyebrow: "For Online Delivery",
    name: "Web Gallery Plan",
    price: "$49",
    billing: "Billed monthly",
    badge: "Online Gallery Tools Only",
    description:
      "A clean web-only plan for photographers who want polished galleries, online viewing, delivery, and ordering without the Studio OS app.",
    included: [
      "Web gallery access",
      "Online photo viewing",
      "Photo delivery",
      "Ordering workflow",
    ],
    notIncluded: [
      "Studio OS app access",
      "School shooting tools",
      "Online booking with automatic student rosters",
      "Photography keys",
      "Backdrop upsell tools",
    ],
    note: "Best if you only need client-facing gallery delivery and ordering.",
    cta: "Get Started",
    href: "/sign-up",
    icon: Globe2,
  },
  {
    eyebrow: "Unlock the Studio OS App",
    name: "App Plan",
    price: "$99",
    billing: "Billed monthly",
    badge: "1 Photography Key Included",
    description:
      "Built for school and studio photographers who want the Studio OS app, faster production, and new upsell opportunities without jumping to the largest plan.",
    included: [
      "Everything in Web Gallery",
      "Studio OS app access",
      "1 Photography Key",
      "Online school and event booking links",
      "Automatic booking-to-student-roster workflow",
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
    note: "Includes 1 key only. If you need a second key, you must upgrade to Studio.",
    cta: "Choose Plan",
    href: "/sign-up",
    icon: Monitor,
    featured: true,
    ribbon: "Most Popular",
  },
  {
    eyebrow: "For Growing Production Teams",
    name: "Studio Plan",
    price: "$199",
    billing: "Billed monthly",
    badge: "2 Photography Keys Included",
    description:
      "Full Studio OS workflow with more room to scale, advanced school-day tools, and the only plan that can grow beyond the included keys.",
    included: studioPlanFeatures,
    note: "Studio includes 2 keys and is the only plan that can add extra keys for $55 each.",
    cta: "Upgrade to Studio",
    href: "/sign-up",
    icon: Camera,
    ribbon: "Best for Growing Studios",
  },
];

export default function PricingPage() {
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("month");

  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <PricingJsonLd />
      <SiteHeader />
      <main className="overflow-x-hidden px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <section className="mx-auto max-w-7xl">
          <Reveal className="pricing-cinematic-hero overflow-hidden rounded-[2rem] border border-white/10 bg-neutral-950 px-6 py-16 text-center text-white shadow-[0_38px_120px_rgba(0,0,0,0.28)] sm:px-10 lg:px-16 lg:py-20">
            <div className="pricing-hero-glow" />
            <div className="relative z-10 mx-auto max-w-4xl">
              <p className="marketing-kicker text-red-300">
                Pricing
              </p>
              <h1
                className="marketing-display mt-4"
                style={{ fontSize: "clamp(2.2rem, 9.5vw, 5.4rem)" }}
              >
                Simple pricing for connected photography workflows.
              </h1>
              <p className="marketing-body mx-auto mt-5 max-w-3xl text-white/70">
                Choose the level of Studio OS Cloud that matches how your studio
                takes bookings, builds student rosters, delivers galleries, captures
                locally, and manages production.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                {[`${FREE_TRIAL_DAYS}-day launch trial`, "Studio workflow included", "Prices in CAD"].map((label) => (
                  <span
                    key={label}
                    className="marketing-kicker rounded-full border border-white/15 bg-white/10 px-4 py-2 text-white/75 backdrop-blur"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </Reveal>

          <Reveal delay={80} className="mt-6 rounded-[1.5rem] border border-red-200 bg-gradient-to-r from-red-50 via-white to-red-50 p-5 sm:p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-600 text-white">
                  <CalendarCheck2 className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="marketing-card-title text-[1.15rem]">Online booking is included with the Studio OS app workflow.</h2>
                  <p className="marketing-body mt-2 text-[1rem] leading-7 text-neutral-600">
                    App and Studio plans let you create school booking links that build a student roster, or event links that build an attendee booking list.
                  </p>
                </div>
              </div>
              <Link
                href="/online-school-photography-booking"
                className="marketing-button inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-neutral-300 bg-white px-5 py-3 text-neutral-950 transition hover:border-neutral-950"
              >
                See Online Booking
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>

          <Reveal delay={120} className="mt-12 rounded-[1.75rem] border border-neutral-200 bg-white p-5 shadow-[0_18px_60px_rgba(0,0,0,0.08)] sm:p-6">
            <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="marketing-card-title text-[1.15rem]">
                  Choose monthly or annual billing
                </h2>
                <p className="marketing-body mt-2 text-[1rem] leading-7 text-neutral-600">
                  Annual billing is paid in advance and saves 10% on the base
                  subscription.
                </p>
              </div>
              <div
                aria-label="Billing cadence"
                className="grid w-full max-w-[260px] grid-cols-2 rounded-2xl border border-neutral-200 bg-neutral-100 p-1.5"
              >
                <button
                  type="button"
                  aria-pressed={billingInterval === "month"}
                  onClick={() => setBillingInterval("month")}
                  className={`marketing-button rounded-xl px-4 py-3 text-center transition ${
                    billingInterval === "month"
                      ? "bg-neutral-950 text-white shadow-sm"
                      : "text-neutral-600 hover:bg-white"
                  }`}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  aria-pressed={billingInterval === "year"}
                  onClick={() => setBillingInterval("year")}
                  className={`marketing-button rounded-xl px-4 py-3 text-center transition ${
                    billingInterval === "year"
                      ? "bg-neutral-950 text-white shadow-sm"
                      : "text-neutral-600 hover:bg-white"
                  }`}
                >
                  Annual
                </button>
              </div>
            </div>
            <p className="marketing-caption mt-4 text-neutral-500">
              All prices are in Canadian dollars (CAD). Annual billing saves {ANNUAL_DISCOUNT_PERCENT}%.
            </p>
          </Reveal>

          <div className="mt-10 grid gap-6 lg:grid-cols-2 lg:items-stretch xl:grid-cols-4">
            {plans.map((plan, index) => {
              const motion: PricingMotion =
                index === 0 ? "left" : index === plans.length - 1 ? "right" : "drop";

              return (
                <Reveal
                  key={plan.name}
                  delay={index * 260}
                  repeat
                  className={`pricing-plan-reveal pricing-plan-${motion} h-full`}
                >
                  <PricingCard plan={plan} billingInterval={billingInterval} />
                </Reveal>
              );
            })}
          </div>
        </section>

        <PricingComparisonSection />

        <Reveal delay={260} className="mx-auto mt-16 max-w-7xl rounded-[1.75rem] border border-neutral-200 bg-white p-6 shadow-[0_18px_60px_rgba(0,0,0,0.08)] sm:p-8 lg:mt-20">
          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="marketing-kicker text-neutral-500">
                Take Control
              </p>
              <h2 className="marketing-title mt-4 text-[2rem]">
                Take Control of Your Workflow
              </h2>
              <p className="marketing-body mt-5 text-neutral-600">
                Stop juggling tools and start running your photography business
                with one connected system.
              </p>
            </div>
            <Link
              href="/sign-up"
              data-marketing-event="cta_start_trial"
              data-marketing-label="Pricing final CTA"
              data-marketing-placement="pricing_page"
              className="marketing-button premium-button inline-flex items-center justify-center gap-2 rounded-2xl bg-neutral-950 px-7 py-4 text-white shadow-[0_16px_38px_rgba(0,0,0,0.18)] transition hover:bg-black"
            >
              Start Free Trial
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </Reveal>
      </main>
      <SiteFooter />
    </div>
  );
}

function PricingCard({
  plan,
  billingInterval,
}: {
  plan: PricingPlan;
  billingInterval: BillingInterval;
}) {
  const Icon = plan.icon;
  const isFeatured = plan.featured;
  const planCode: PlanCode | null =
    plan.name === "Web Gallery Plan"
      ? "starter"
      : plan.name === "App Plan"
        ? "core"
        : plan.name === "Studio Plan"
          ? "studio"
          : null;
  const priceCents = planCode
    ? billingInterval === "year"
      ? PLAN_DEFS[planCode].annualPriceCents
      : PLAN_DEFS[planCode].priceCents
    : 0;
  const formattedPrice = planCode
    ? new Intl.NumberFormat("en-CA", {
        style: "currency",
        currency: "CAD",
        minimumFractionDigits: billingInterval === "year" ? 2 : 0,
        maximumFractionDigits: 2,
      }).format(priceCents / 100)
    : plan.price;
  const monthlyEquivalent = planCode
    ? new Intl.NumberFormat("en-CA", {
        style: "currency",
        currency: "CAD",
      }).format(priceCents / (billingInterval === "year" ? 1200 : 100))
    : null;
  const href = planCode
    ? `/sign-up?plan=${planCode}&interval=${billingInterval}`
    : plan.href;
  const isAnnualPlan = Boolean(planCode && billingInterval === "year");

  return (
    <article
      className={`premium-card flex h-full min-w-0 flex-col overflow-hidden rounded-[2rem] border p-6 shadow-[0_20px_70px_rgba(0,0,0,0.08)] sm:p-7 ${
        isFeatured
          ? "pricing-featured-card border-neutral-900 text-white shadow-[0_28px_95px_rgba(0,0,0,0.26)]"
          : "border-neutral-200 bg-white text-neutral-950"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <span
          className={`flex h-14 w-14 items-center justify-center rounded-2xl border ${
            isFeatured
              ? "border-white/15 bg-white/5 text-white"
              : "border-neutral-200 bg-neutral-50 text-neutral-950"
          }`}
        >
          <Icon className="h-6 w-6" />
        </span>
        {plan.ribbon ? (
          <span
            className={`marketing-kicker rounded-full border px-4 py-2 ${
              isFeatured
                ? "border-white/20 bg-white/10 text-white/80"
                : "border-red-200 bg-red-50 text-red-900"
            }`}
          >
            {plan.ribbon}
          </span>
        ) : null}
      </div>

      <p className={`marketing-kicker mt-8 ${isFeatured ? "text-white/45" : "text-neutral-500"}`}>
        {plan.eyebrow}
      </p>
      <h2 className="marketing-title mt-4 text-[2.45rem]">
        {plan.name}
      </h2>

      <div className={isAnnualPlan ? "mt-7" : "mt-7 flex items-end gap-2"}>
        <span
          className={`block whitespace-nowrap font-[700] leading-none tabular-nums ${
            isAnnualPlan ? "text-[2.5rem] tracking-[-0.035em]" : "text-6xl tracking-normal"
          }`}
        >
          {formattedPrice}
        </span>
        <span
          className={`marketing-body block text-[1rem] ${
            isAnnualPlan ? "mt-2" : "pb-1"
          } ${isFeatured ? "text-white/60" : "text-neutral-600"}`}
        >
          {planCode
            ? billingInterval === "year"
              ? "/year"
              : "/month"
            : plan.priceSuffix}
        </span>
      </div>
      <p className={`marketing-body mt-5 text-[1rem] leading-7 ${isFeatured ? "text-white/55" : "text-neutral-500"}`}>
        {planCode
          ? billingInterval === "year"
            ? `Paid annually · ${monthlyEquivalent}/month equivalent`
            : "Billed monthly · CAD"
          : plan.billing}
      </p>

      <div
        className={`marketing-kicker mt-5 inline-flex w-fit rounded-full border px-4 py-2 ${
          isFeatured
            ? "border-white/20 bg-white/10 text-white/85"
            : "border-neutral-200 bg-white text-neutral-700"
        }`}
      >
        {plan.badge}
      </div>

      <p className={`marketing-body mt-7 text-[1rem] leading-8 ${isFeatured ? "text-white/70" : "text-neutral-600"}`}>
        {plan.description}
      </p>

      <FeatureList title="Included" items={plan.included} featured={isFeatured} />

      {plan.notIncluded ? (
        <FeatureList
          title="Not Included"
          items={plan.notIncluded}
          featured={isFeatured}
          muted
        />
      ) : null}

      <div
        className={`marketing-body mt-8 rounded-2xl border px-4 py-4 text-[1rem] leading-7 ${
          isFeatured
            ? "border-white/12 bg-white/[0.04] text-white/70"
            : "border-neutral-200 bg-white text-neutral-600"
        }`}
      >
        {plan.note}
      </div>

      <Link
        href={href}
        data-marketing-event="cta_start_trial"
        data-marketing-label={`Pricing plan: ${plan.name}`}
        data-marketing-placement="pricing_plan_card"
        className={`marketing-button premium-button mt-7 inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-4 ${
          isFeatured
            ? "bg-white text-neutral-950 hover:bg-neutral-100"
            : "bg-neutral-950 text-white hover:bg-black"
        }`}
      >
        {plan.cta}
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    </article>
  );
}

function PricingComparisonSection() {
  return (
    <Reveal delay={220} className="mx-auto mt-16 max-w-7xl rounded-[2rem] border border-neutral-200 bg-white p-6 shadow-[0_18px_70px_rgba(0,0,0,0.07)] sm:p-8 lg:mt-20">
      <div className="max-w-4xl">
        <p className="marketing-kicker text-neutral-500">
          Comparison
        </p>
        <h2 className="marketing-title mt-4">
          Why photographers outgrow gallery-only platforms.
        </h2>
        <p className="marketing-body mt-5 text-neutral-600">
          Beautiful galleries are essential. The difference is whether your
          platform also handles the work before and after the gallery.
        </p>
      </div>

      <div className="-mx-3 mt-10 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        <div className="min-w-[720px] overflow-hidden rounded-[1.75rem] border border-neutral-200">
          <div className="grid grid-cols-[1.35fr_.82fr_.82fr] bg-white text-[0.72rem] font-bold uppercase leading-tight tracking-normal text-neutral-500">
          <div className="px-4 py-5 sm:px-6">Workflow capability</div>
          <div className="px-3 py-5 text-center sm:px-6">Gallery-only stack</div>
          <div className="bg-neutral-950 px-3 py-5 text-center text-white sm:px-6">
            Studio OS Cloud
          </div>
          </div>

          {pricingComparisonRows.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[1.35fr_.82fr_.82fr] border-t border-neutral-200 text-[0.92rem] text-neutral-900 sm:text-[1rem]"
            >
              <div className="px-4 py-5 font-medium sm:px-6">
                {row.label}
              </div>
              <div className="flex items-center justify-center px-3 py-5 sm:px-6">
                <ComparisonMark status={row.galleryOnly} />
              </div>
              <div className="flex items-center justify-center bg-red-50/55 px-3 py-5 sm:px-6">
                <ComparisonMark status={row.studioOs} accent />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="marketing-body mt-8 rounded-[1.5rem] border border-neutral-200 bg-gradient-to-r from-white via-red-50/40 to-white px-5 py-5 text-[1.2rem] font-medium leading-8 text-neutral-900">
        If presentation matters as much as workflow, you eventually need more
        than a gallery alone.
      </div>
    </Reveal>
  );
}

function ComparisonMark({
  status,
  accent = false,
}: {
  status: ComparisonStatus;
  accent?: boolean;
}) {
  if (status === "limited") {
    return (
      <span className="marketing-kicker rounded-full border border-neutral-200 bg-white px-4 py-2 text-neutral-500">
        Limited
      </span>
    );
  }

  if (status === "no") {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 bg-neutral-50 text-neutral-400">
        <X className="h-5 w-5" />
      </span>
    );
  }

  return (
    <span
      className={`flex h-10 w-10 items-center justify-center rounded-full border ${
        accent
          ? "border-red-200 bg-red-50 text-red-600"
          : "border-neutral-200 bg-white text-neutral-800"
      }`}
    >
      <Check className="h-5 w-5" />
    </span>
  );
}

function FeatureList({
  title,
  items,
  featured,
  muted = false,
}: {
  title: string;
  items: string[];
  featured?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="mt-9">
      <h3 className={`marketing-kicker ${featured ? "text-white/45" : "text-neutral-500"}`}>
        {title}
      </h3>
      <ul className="mt-5 space-y-4">
        {items.map((item) => (
          <li
            key={item}
            className={`marketing-body flex gap-3 text-[1rem] leading-7 ${
              muted
                ? "text-neutral-500"
                : featured
                  ? "text-white/75"
                  : "text-neutral-700"
            }`}
          >
            <span
              className={`mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                muted
                  ? "bg-neutral-100 text-neutral-400"
                  : featured
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-emerald-50 text-emerald-600"
              }`}
            >
              {muted ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

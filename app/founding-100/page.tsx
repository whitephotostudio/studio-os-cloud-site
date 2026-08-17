import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck2,
  Camera,
  Check,
  CheckCircle2,
  Cloud,
  GalleryHorizontalEnd,
  GraduationCap,
  Headphones,
  Images,
  ListChecks,
  MonitorCheck,
  MousePointerClick,
  ShieldCheck,
  Sparkles,
  Target,
  UsersRound,
} from "lucide-react";
import { BreadcrumbJsonLd, FaqListJsonLd } from "@/components/json-ld";
import { Reveal } from "@/components/marketing/Reveal";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { FREE_TRIAL_DAYS } from "@/lib/trial-config";

const canonicalUrl = "https://www.studiooscloud.com/founding-100";
const trialHref = "/sign-up?source=founding-100";
const demoHref =
  "mailto:galleries@studiooscloud.com?subject=Studio%20OS%20Founding%20100%20Demo&body=I%20would%20like%20a%20short%20Studio%20OS%20Founding%20100%20demo.%0A%0ABusiness%20name%3A%0APhotography%20type%3A%0AMain%20workflow%20challenge%3A";

export const metadata: Metadata = {
  title: "Founding 100 Photographer Program",
  description:
    "Join the Studio OS Cloud Founding 100. Test the complete connected photography workflow for 30 days with onboarding support and no credit card required.",
  alternates: { canonical: canonicalUrl },
  openGraph: {
    type: "website",
    url: canonicalUrl,
    title: "Studio OS Cloud Founding 100",
    description:
      "A 30-day invitation for photographers ready to connect booking, capture, galleries, ordering, and delivery.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Studio OS Cloud Founding 100",
    description:
      "Join the first 100 photographers testing the complete Studio OS connected workflow.",
  },
};

const workflowFeatures = [
  {
    title: "Premium galleries",
    text: "Create branded client galleries with private access, ordering, downloads, and delivery.",
    icon: Images,
  },
  {
    title: "Online booking",
    text: "Share school or event booking links and organize confirmed appointments automatically.",
    icon: CalendarCheck2,
  },
  {
    title: "Desktop capture",
    text: "Connect the Studio OS app to tethered capture, QR workflows, sorting, and production.",
    icon: Camera,
  },
  {
    title: "Student rosters",
    text: "Turn school appointments into a time-organized student roster for picture day.",
    icon: ListChecks,
  },
  {
    title: "AI-assisted production",
    text: "Prepare backgrounds and composites while keeping the photographer in control of the final result.",
    icon: Sparkles,
  },
  {
    title: "Connected cloud workflow",
    text: "Keep projects, client access, orders, downloads, and production evidence connected.",
    icon: Cloud,
  },
];

const activationSteps = [
  {
    number: "01",
    title: "Create your account",
    text: `Start the complete ${FREE_TRIAL_DAYS}-day trial without entering a credit card.`,
    icon: MousePointerClick,
  },
  {
    number: "02",
    title: "Build one real workflow",
    text: "Create a school, event, portrait job, or gallery that matches the work your studio already does.",
    icon: MonitorCheck,
  },
  {
    number: "03",
    title: "Reach your first result",
    text: "Publish a booking link, import a roster, capture a subject, deliver a gallery, or receive an order.",
    icon: CheckCircle2,
  },
];

const faqItems = [
  {
    question: "What is the Studio OS Founding 100?",
    answer:
      "It is an invitation for the first 100 participating photographers to test the complete Studio OS Cloud workflow for 30 days and receive priority onboarding guidance.",
  },
  {
    question: "Do I need a credit card to begin?",
    answer:
      "No. The 30-day trial starts after account verification and does not require a credit card.",
  },
  {
    question: "Is this only for school photographers?",
    answer:
      "No. Studio OS Cloud supports premium galleries and connected workflows for portrait, wedding, event, sports, school, volume, commercial, and studio photographers. School and high-volume photographers can also use deeper roster, booking, and picture-day tools.",
  },
  {
    question: "What counts as getting started?",
    answer:
      "The goal is to complete one useful workflow: create a job, publish a booking link, import a roster, capture a subject, deliver a gallery, or receive an order.",
  },
  {
    question: "What happens after 30 days?",
    answer:
      "You can choose the paid plan that fits your studio. Nothing is charged automatically when the free trial ends.",
  },
];

export default function Founding100Page() {
  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", item: "https://www.studiooscloud.com" },
          { name: "Founding 100", item: canonicalUrl },
        ]}
      />
      <FaqListJsonLd items={faqItems} />
      <SiteHeader />

      <main>
        <section className="relative isolate overflow-hidden bg-neutral-950 px-4 py-20 text-white sm:px-6 lg:px-8 lg:py-28">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_24%,rgba(239,68,68,0.3),transparent_28%),radial-gradient(circle_at_82%_22%,rgba(255,255,255,0.08),transparent_25%),linear-gradient(130deg,#050505_0%,#1d0708_50%,#060606_100%)]" />
          <div className="absolute left-0 top-0 h-2 w-full bg-red-600" />

          <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
            <Reveal>
              <div className="marketing-kicker inline-flex items-center gap-2 rounded-full border border-red-300/30 bg-red-500/10 px-4 py-2 text-red-200">
                <Target className="h-4 w-4" />
                Founding 100 Photographer Program
              </div>
              <h1 className="marketing-display mt-6 text-[3.1rem] sm:text-[4.2rem] lg:text-[5.2rem]">
                Your first complete workflow starts here.
              </h1>
              <p className="marketing-body mt-6 max-w-3xl text-white/70">
                We are inviting the first 100 photographers to put Studio OS
                Cloud through real work. Connect booking, capture, galleries,
                ordering, and delivery during a full {FREE_TRIAL_DAYS}-day trial—with
                priority setup guidance and no credit card required.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  href={trialHref}
                  data-marketing-event="cta_start_trial"
                  data-marketing-label="Founding 100 hero trial"
                  data-marketing-placement="founding_100_hero"
                  className="marketing-button premium-button inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3.5 text-neutral-950 transition hover:bg-neutral-100"
                >
                  Join the Founding 100
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <a
                  href={demoHref}
                  data-marketing-event="cta_book_demo"
                  data-marketing-label="Founding 100 hero demo"
                  data-marketing-placement="founding_100_hero"
                  className="marketing-button inline-flex items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-6 py-3.5 text-white transition hover:bg-white/15"
                >
                  Request a Short Demo
                  <Headphones className="h-4 w-4" />
                </a>
              </div>

              <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-sm text-white/62">
                {["30 days free", "No credit card", "Priority onboarding"].map((item) => (
                  <span key={item} className="inline-flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-400" />
                    {item}
                  </span>
                ))}
              </div>
            </Reveal>

            <Reveal delay={150}>
              <Founding100Preview />
            </Reveal>
          </div>
        </section>

        <section className="border-b border-neutral-200 bg-white px-4 py-10 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-7xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Galleries", "Premium client delivery"],
              ["Booking", "Appointments into workflow"],
              ["Studio OS", "Desktop capture + production"],
              ["Cloud Flow", "Visible operating evidence"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-neutral-200 bg-neutral-50 px-5 py-4">
                <div className="marketing-kicker text-red-600">{label}</div>
                <div className="marketing-caption mt-2 font-semibold text-neutral-800">{value}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-neutral-50 px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="mx-auto max-w-7xl">
            <Reveal className="max-w-3xl">
              <p className="marketing-kicker text-red-600">The Complete Platform</p>
              <h2 className="marketing-title mt-4">Use the workflow your photography business actually needs.</h2>
              <p className="marketing-body mt-5 text-neutral-600">
                Start with premium galleries or go deeper into structured jobs,
                appointment booking, desktop capture, school workflows, ordering,
                and production control.
              </p>
            </Reveal>

            <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {workflowFeatures.map((feature, index) => (
                <Reveal key={feature.title} delay={index * 65} className="rounded-[1.6rem] border border-neutral-200 bg-white p-7 shadow-sm">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-950 text-white">
                    <feature.icon className="h-5 w-5" />
                  </span>
                  <h3 className="marketing-card-title mt-6">{feature.title}</h3>
                  <p className="marketing-caption mt-3 text-neutral-600">{feature.text}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="mx-auto max-w-7xl">
            <Reveal className="mx-auto max-w-3xl text-center">
              <p className="marketing-kicker text-red-600">Activation, Not Just Registration</p>
              <h2 className="marketing-title mt-4">Three steps to a useful first result.</h2>
              <p className="marketing-body mt-5 text-neutral-600">
                The Founding 100 is designed to help photographers reach a real
                workflow outcome—not simply create an unused account.
              </p>
            </Reveal>

            <div className="mt-12 grid gap-5 lg:grid-cols-3">
              {activationSteps.map((step, index) => (
                <Reveal key={step.number} delay={index * 90} className="relative overflow-hidden rounded-[1.75rem] border border-neutral-200 bg-white p-8 shadow-[0_18px_60px_rgba(0,0,0,0.07)]">
                  <div className="absolute right-5 top-4 text-6xl font-bold tracking-[-0.08em] text-neutral-100">{step.number}</div>
                  <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                    <step.icon className="h-5 w-5" />
                  </span>
                  <h3 className="marketing-card-title relative mt-6">{step.title}</h3>
                  <p className="marketing-caption relative mt-3 text-neutral-600">{step.text}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-neutral-950 px-4 py-20 text-white sm:px-6 lg:px-8 lg:py-24">
          <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
            <Reveal>
              <div className="marketing-kicker text-red-300">Built for Real Photography Work</div>
              <h2 className="marketing-title mt-4 text-white">Broad gallery power. Deeper tools when the job demands them.</h2>
              <p className="marketing-body mt-5 text-white/65">
                Studio OS Cloud is useful for portrait, wedding, commercial,
                sports, event, school, and volume studios. You choose how deeply
                the desktop and cloud workflows need to connect.
              </p>
            </Reveal>

            <Reveal delay={110} className="grid gap-4 sm:grid-cols-2">
              {[
                { icon: GalleryHorizontalEnd, title: "Gallery-first studios", text: "Present, sell, and deliver through polished client galleries." },
                { icon: GraduationCap, title: "School + volume teams", text: "Connect booking, rosters, capture, ordering, and picture-day operations." },
                { icon: UsersRound, title: "Multi-photographer work", text: "Keep structured jobs and production steps visible across the team." },
                { icon: ShieldCheck, title: "Privacy-conscious workflows", text: "Use private access patterns and avoid real student data in demonstrations." },
              ].map((item) => (
                <article key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.06] p-6">
                  <item.icon className="h-5 w-5 text-red-300" />
                  <h3 className="marketing-card-title mt-4 text-white">{item.title}</h3>
                  <p className="marketing-caption mt-2 text-white/60">{item.text}</p>
                </article>
              ))}
            </Reveal>
          </div>
        </section>

        <section className="bg-neutral-50 px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-4xl">
            <Reveal className="text-center">
              <p className="marketing-kicker text-red-600">Questions</p>
              <h2 className="marketing-title mt-4">Before you join.</h2>
            </Reveal>
            <div className="mt-10 space-y-4">
              {faqItems.map((item, index) => (
                <Reveal key={item.question} delay={index * 45}>
                  <details className="group rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
                    <summary className="marketing-card-title flex cursor-pointer list-none items-center justify-between gap-4">
                      {item.question}
                      <span className="text-red-600 transition group-open:rotate-45">+</span>
                    </summary>
                    <p className="marketing-caption mt-4 max-w-3xl text-neutral-600">{item.answer}</p>
                  </details>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <Reveal className="mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-[linear-gradient(130deg,#111_0%,#2f090b_52%,#111_100%)] px-6 py-14 text-center text-white shadow-[0_30px_100px_rgba(0,0,0,0.22)] sm:px-10 lg:px-16">
            <div className="marketing-kicker text-red-300">Founding 100</div>
            <h2 className="marketing-title mx-auto mt-4 max-w-4xl text-white">Put one real Studio OS workflow to work for your business.</h2>
            <p className="marketing-body mx-auto mt-5 max-w-3xl text-white/65">
              Start free for {FREE_TRIAL_DAYS} days. No credit card. If you prefer,
              request a short guided demonstration first.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href={trialHref}
                data-marketing-event="cta_start_trial"
                data-marketing-label="Founding 100 final trial"
                data-marketing-placement="founding_100_final"
                className="marketing-button premium-button inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3.5 text-neutral-950 hover:bg-neutral-100"
              >
                Start the Founding 100 Trial
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href={demoHref}
                data-marketing-event="cta_book_demo"
                data-marketing-label="Founding 100 final demo"
                data-marketing-placement="founding_100_final"
                className="marketing-button inline-flex items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-6 py-3.5 text-white hover:bg-white/15"
              >
                Request a Demo
                <Headphones className="h-4 w-4" />
              </a>
            </div>
          </Reveal>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function Founding100Preview() {
  const rows = [
    ["Create", "School, event, portrait, or gallery"],
    ["Connect", "Booking, capture, ordering, delivery"],
    ["Activate", "Complete one real workflow"],
  ];

  return (
    <div className="rounded-[2rem] border border-white/15 bg-white/[0.08] p-3 shadow-[0_35px_100px_rgba(0,0,0,0.48)] backdrop-blur">
      <div className="overflow-hidden rounded-[1.55rem] border border-white/10 bg-neutral-950">
        <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.04] px-5 py-4">
          <div className="flex gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/30" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
          </div>
          <div className="marketing-kicker text-white/45">Studio OS Cloud</div>
        </div>

        <div className="p-6 sm:p-8">
          <div className="flex items-start justify-between gap-5">
            <div>
              <div className="marketing-kicker text-red-300">Founding 100</div>
              <h2 className="marketing-card-title mt-3 text-2xl text-white">Activation path</h2>
            </div>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-600 text-white shadow-lg">
              <Target className="h-5 w-5" />
            </span>
          </div>

          <div className="mt-7 space-y-3">
            {rows.map(([label, text], index) => (
              <div key={label} className="grid grid-cols-[auto_1fr] gap-4 rounded-2xl border border-white/10 bg-white/[0.05] p-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-sm font-bold text-neutral-950">{index + 1}</span>
                <div>
                  <div className="marketing-caption font-semibold text-white">{label}</div>
                  <div className="marketing-caption mt-1 text-white/50">{text}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
              <CheckCircle2 className="h-4 w-4" />
              Goal: useful workflow completed
            </div>
            <p className="marketing-caption mt-2 text-emerald-100/65">
              We measure success by activation, not an unused registration.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

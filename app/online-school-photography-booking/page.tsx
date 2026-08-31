import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CalendarCheck2,
  Check,
  CheckCircle2,
  Clock3,
  CreditCard,
  FileDown,
  Link2,
  ListChecks,
  LockKeyhole,
  MailCheck,
  RefreshCw,
  ShieldCheck,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import {
  BreadcrumbJsonLd,
  FaqListJsonLd,
} from "@/components/json-ld";
import { Reveal } from "@/components/marketing/Reveal";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

const canonicalUrl =
  "https://www.studiooscloud.com/online-school-photography-booking";

export const metadata: Metadata = {
  title: "Online School Photography Booking & Student Rosters",
  description:
    "Let students book picture-day times and pay online. Confirmed school bookings create an organized student roster; event bookings create an attendee list.",
  keywords: [
    "online school photography booking",
    "school picture day appointment booking",
    "photography booking software for schools",
    "automatic school photography roster",
    "student photo appointment scheduling",
    "picture day booking system",
  ],
  alternates: { canonical: canonicalUrl },
  openGraph: {
    type: "website",
    title: "Online School Photography Booking & Student Rosters",
    description:
      "Share a booking link, accept optional online payments, and turn confirmed appointments into an organized student roster or attendee list.",
    url: canonicalUrl,
  },
  twitter: {
    card: "summary_large_image",
    title: "Online School Photography Booking | Studio OS Cloud",
    description:
      "From student booking to a time-ordered student roster in one connected workflow.",
  },
};

const workflowSteps = [
  {
    number: "01",
    title: "Create the school or event",
    text: "Set the shoot date, appointment length, available times, capacity, and any protected breaks.",
    icon: CalendarCheck2,
  },
  {
    number: "02",
    title: "Share one booking link",
    text: "Send the branded link to the school, students, families, or event guests.",
    icon: Link2,
  },
  {
    number: "03",
    title: "Students choose a live time",
    text: "Open times stay selectable, full times show as booked, and locked periods cannot be reserved.",
    icon: Clock3,
  },
  {
    number: "04",
    title: "Confirm payment and details",
    text: "Collect the student, class, and contact details with optional Stripe-powered payment.",
    icon: CreditCard,
  },
  {
    number: "05",
    title: "The student roster builds itself",
    text: "Confirmed school bookings become student roster entries. Event bookings build an organized attendee list.",
    icon: UserRoundPlus,
  },
  {
    number: "06",
    title: "Photograph in appointment order",
    text: "Open the photographer view and move through the time-ordered list on picture day.",
    icon: ListChecks,
  },
];

const platformFeatures = [
  {
    title: "Live availability",
    text: "Students see open and booked times before submitting, with capacity tracked for every booking day.",
    icon: CalendarCheck2,
  },
  {
    title: "Online payments",
    text: "Make payment optional or required and collect the sitting fee through your connected Stripe account.",
    icon: CreditCard,
  },
  {
    title: "Automatic student roster creation",
    text: "Booking details create cloud student records so the organized student name list grows as appointments are confirmed.",
    icon: UsersRound,
  },
  {
    title: "Reschedule and cancellation",
    text: "Clients can manage their appointment while Studio OS retains the operational status and history.",
    icon: RefreshCw,
  },
  {
    title: "Owner booking overview",
    text: "See active links, confirmed and cancelled totals, remaining capacity, payments, and revenue by school or event.",
    icon: BarChart3,
  },
  {
    title: "Private PDF reports",
    text: "Export confirmed bookings, cancellations, or the complete booking history for a selected school or event.",
    icon: FileDown,
  },
];

const faqItems = [
  {
    question: "Does a confirmed booking create a student roster entry?",
    answer:
      "Yes. A student roster is the organized working list of student names, IDs, classes, appointment times, and booking status. Confirmed school bookings create cloud student records, and Studio OS can add them to the desktop student roster without replacing existing entries. Event bookings use an attendee booking list instead.",
  },
  {
    question: "Can students pay when they book?",
    answer:
      "Yes. A studio can require a sitting fee, accept payment through its connected Stripe account, or run a booking link without payment when appropriate.",
  },
  {
    question: "Can clients reschedule or cancel their appointment?",
    answer:
      "Yes. Confirmation messages include a secure management link for changing the appointment or cancelling it, subject to the studio's booking policy.",
  },
  {
    question: "Can I block lunch or another unavailable period?",
    answer:
      "Yes. Protected periods can remain unavailable in the schedule, and Studio OS clearly identifies the lunch break in the public booking and picture-day views.",
  },
  {
    question: "Can I export booking and cancellation reports?",
    answer:
      "Yes. The owner booking area can generate private PDF reports for confirmed bookings, cancelled bookings, or all booking records for a selected school or event.",
  },
];

const previewRows = [
  ["9:20 AM", "Student 018", "Health Sciences", "Paid · Confirmed"],
  ["9:40 AM", "Student 024", "Business", "Paid · Confirmed"],
  ["10:00 AM", "Student 031", "Technology", "Confirmed"],
  ["10:20 AM", "Student 037", "Business", "Paid · Confirmed"],
];

export default function OnlineSchoolPhotographyBookingPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", item: "https://www.studiooscloud.com" },
          { name: "Online School Photography Booking", item: canonicalUrl },
        ]}
      />
      <FaqListJsonLd items={faqItems} />
      <SiteHeader />

      <main>
        <section className="relative isolate overflow-hidden bg-neutral-950 px-4 py-20 text-white sm:px-6 lg:px-8 lg:py-28">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_16%_18%,rgba(239,68,68,0.28),transparent_28%),radial-gradient(circle_at_82%_28%,rgba(255,255,255,0.08),transparent_26%),linear-gradient(135deg,#090909_0%,#170505_50%,#090909_100%)]" />
          <div className="absolute left-0 top-0 h-1.5 w-full bg-red-600" />

          <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[0.92fr_1.08fr]">
            <Reveal>
              <div className="marketing-kicker inline-flex items-center gap-2 rounded-full border border-red-300/25 bg-red-500/10 px-4 py-2 text-red-200">
                <span className="h-2 w-2 rounded-full bg-red-400" />
                School + Event Booking
              </div>
              <h1 className="marketing-display mt-6 text-[3.05rem] sm:text-[4rem] lg:text-[4.85rem]">
                Online booking that builds your student roster.
              </h1>
              <p className="marketing-body mt-6 max-w-2xl text-white/68">
                Let students choose an available picture-day time, submit their
                details, and pay online. Confirmed bookings flow into Studio OS
                as a student roster—the organized name and appointment list the
                photographer uses on picture day. Events use an attendee booking list.
              </p>

              <div className="mt-9 flex flex-wrap gap-3">
                <Link
                  href="/sign-up"
                  data-marketing-event="cta_start_trial"
                  data-marketing-label="Online booking hero"
                  data-marketing-placement="online_booking_page"
                  className="marketing-button premium-button inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-neutral-950 hover:bg-neutral-100"
                >
                  Start Free Trial
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/pricing"
                  data-marketing-event="cta_view_pricing"
                  data-marketing-label="Online booking hero"
                  data-marketing-placement="online_booking_page"
                  className="marketing-button inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 py-3.5 text-white transition hover:bg-white/10"
                >
                  View Plans
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-sm text-white/60">
                {[
                  "No manual student-list typing",
                  "Optional Stripe payment",
                  "Confirmed + cancelled reports",
                ].map((item) => (
                  <span key={item} className="inline-flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    {item}
                  </span>
                ))}
              </div>
            </Reveal>

            <Reveal delay={160}>
              <BookingPreview />
            </Reveal>
          </div>
        </section>

        <section className="border-b border-neutral-200 bg-white px-4 py-10 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-7xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Share", "One branded booking link"],
              ["Collect", "Details + optional payment"],
              ["Organize", "Automatic student roster"],
              ["Photograph", "Time-ordered picture day"],
            ].map(([label, text], index) => (
              <Reveal key={label} delay={index * 70} className="flex items-center gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-sm font-bold text-white">
                  {index + 1}
                </span>
                <div>
                  <div className="marketing-kicker text-red-600">{label}</div>
                  <div className="marketing-caption mt-1 font-semibold text-neutral-800">{text}</div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="bg-neutral-50 px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="mx-auto max-w-7xl">
            <Reveal className="max-w-3xl">
              <p className="marketing-kicker text-red-600">One Connected Flow</p>
              <h2 className="marketing-title mt-4">
                From booking link to camera-ready student roster.
              </h2>
              <p className="marketing-body mt-5 text-neutral-600">
                Studio OS removes the handoff between appointment software,
                payment records, spreadsheets, and the photographer’s working
                student list.
              </p>
            </Reveal>

            <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {workflowSteps.map((step, index) => {
                const Icon = step.icon;
                return (
                  <Reveal
                    key={step.number}
                    delay={index * 75}
                    className="premium-card rounded-[1.75rem] border border-neutral-200 bg-white p-6 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-950 text-white">
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="text-sm font-bold text-neutral-300">{step.number}</span>
                    </div>
                    <h3 className="marketing-card-title mt-7 text-[1.25rem]">{step.title}</h3>
                    <p className="marketing-body mt-3 text-[1rem] leading-7 text-neutral-600">{step.text}</p>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        <section className="bg-white px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[1.12fr_0.88fr]">
            <Reveal className="overflow-hidden rounded-[2rem] border border-neutral-200 bg-neutral-50 p-3 shadow-[0_30px_100px_rgba(0,0,0,0.1)] sm:p-5">
              <RosterPreview />
            </Reveal>

            <Reveal delay={130}>
              <p className="marketing-kicker text-red-600">Picture-Day View</p>
              <h2 className="marketing-title mt-4">Know who is next—without chasing a spreadsheet.</h2>
              <p className="marketing-body mt-5 text-neutral-600">
                The Studio OS student roster can be ordered by booked appointment time.
                Photographers select the next student, scan a QR code when needed,
                and keep the capture workflow moving.
              </p>
              <ul className="mt-8 space-y-4">
                {[
                  "Appointment time beside every confirmed student",
                  "Payment and confirmation status at a glance",
                  "A visible, locked lunch row in the schedule",
                  "Class and PIN details kept with the student roster entry",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm font-medium text-neutral-700">
                    <span className="mt-0.5 rounded-full bg-emerald-100 p-1 text-emerald-700">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </section>

        <section className="bg-neutral-950 px-4 py-20 text-white sm:px-6 lg:px-8 lg:py-28">
          <div className="mx-auto max-w-7xl">
            <Reveal className="max-w-3xl">
              <p className="marketing-kicker text-red-300">Built for Real Operations</p>
              <h2 className="marketing-title mt-4">More control before, during, and after booking.</h2>
            </Reveal>

            <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {platformFeatures.map((feature, index) => {
                const Icon = feature.icon;
                return (
                  <Reveal
                    key={feature.title}
                    delay={index * 70}
                    className="rounded-[1.75rem] border border-white/10 bg-white/[0.055] p-6"
                  >
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-red-300/15 bg-red-500/10 text-red-300">
                      <Icon className="h-5 w-5" />
                    </span>
                    <h3 className="marketing-card-title mt-6 text-[1.25rem]">{feature.title}</h3>
                    <p className="marketing-body mt-3 text-[1rem] leading-7 text-white/60">{feature.text}</p>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        <section className="bg-white px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-2">
            <Reveal className="rounded-[2rem] border border-neutral-200 bg-neutral-50 p-7 sm:p-9">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-950 text-white">
                <ShieldCheck className="h-6 w-6" />
              </span>
              <p className="marketing-kicker mt-8 text-red-600">Private by Design</p>
              <h2 className="marketing-title mt-4 text-[2.2rem]">Operational detail stays in the owner workflow.</h2>
              <p className="marketing-body mt-5 text-neutral-600">
                The public availability response exposes appointment times—not
                student names. Detailed booking views and PDF exports are restricted
                to the authorized Studio OS Cloud owner area.
              </p>
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {["No student names in public availability", "Owner-only booking reports", "Private, no-store admin responses", "No PINs in exported reports"].map((item) => (
                  <div key={item} className="marketing-caption flex items-start gap-2 rounded-2xl border border-neutral-200 bg-white px-4 py-3 font-semibold text-neutral-700">
                    <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                    {item}
                  </div>
                ))}
              </div>
            </Reveal>

            <Reveal delay={130} className="rounded-[2rem] border border-neutral-200 bg-white p-7 shadow-[0_28px_90px_rgba(0,0,0,0.08)] sm:p-9">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="marketing-kicker text-neutral-500">Owner Overview</p>
                  <h2 className="marketing-card-title mt-3">Riverside College</h2>
                </div>
                <span className="marketing-caption rounded-full bg-emerald-100 px-3 py-2 font-bold text-emerald-800">Active</span>
              </div>
              <div className="mt-7 grid grid-cols-2 gap-3">
                {[["24", "Confirmed"], ["3", "Cancelled"], ["16", "Remaining"], ["$720", "Collected"]].map(([value, label]) => (
                  <div key={label} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                    <div className="text-2xl font-bold">{value}</div>
                    <div className="marketing-caption mt-1 text-neutral-500">{label}</div>
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-2xl border border-neutral-200 p-4">
                <div className="flex items-center gap-3">
                  <span className="rounded-xl bg-blue-50 p-2 text-blue-700"><FileDown className="h-4 w-4" /></span>
                  <div>
                    <div className="marketing-caption font-bold">Export PDF</div>
                    <div className="marketing-caption text-neutral-500">Confirmed · Cancelled · All records</div>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
                <MailCheck className="h-5 w-5 shrink-0" />
                <span className="marketing-caption font-semibold">Confirmation and management links are sent after booking.</span>
              </div>
              <p className="marketing-caption mt-4 text-neutral-400">Sample product preview. No live student data is shown.</p>
            </Reveal>
          </div>
        </section>

        <section className="border-y border-neutral-200 bg-neutral-50 px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl">
            <Reveal className="text-center">
              <p className="marketing-kicker text-red-600">Questions</p>
              <h2 className="marketing-title mt-4">Online booking, clearly explained.</h2>
            </Reveal>
            <div className="mt-10 divide-y divide-neutral-200 overflow-hidden rounded-[1.75rem] border border-neutral-200 bg-white px-5 sm:px-7">
              {faqItems.map((item, index) => (
                <Reveal key={item.question} delay={index * 55} className="py-6">
                  <h3 className="text-base font-bold text-neutral-950">{item.question}</h3>
                  <p className="marketing-body mt-3 text-[1rem] leading-7 text-neutral-600">{item.answer}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <Reveal className="cta-glow relative mx-auto max-w-6xl overflow-hidden rounded-[2.25rem] bg-neutral-950 px-6 py-16 text-center text-white shadow-[0_35px_120px_rgba(0,0,0,0.28)] sm:px-10 lg:py-20">
            <div className="relative z-10 mx-auto max-w-3xl">
              <p className="marketing-kicker text-red-300">Ready for Your Next Picture Day?</p>
              <h2 className="marketing-title mt-4">Stop rebuilding the student list after students book.</h2>
              <p className="marketing-body mx-auto mt-5 max-w-2xl text-white/65">
                Give students a professional booking experience and give your
                photographers the organized list they need on shoot day.
              </p>
              <div className="mt-9 flex flex-wrap justify-center gap-3">
                <Link href="/sign-up" className="marketing-button premium-button inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-neutral-950 hover:bg-neutral-100">
                  Start Free Trial
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
                <Link href="/pricing" className="marketing-button inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3.5 text-white transition hover:bg-white/10">
                  Compare Plans
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function BookingPreview() {
  return (
    <div className="relative rounded-[2rem] border border-white/10 bg-white/[0.06] p-3 shadow-[0_45px_140px_rgba(0,0,0,0.55)] sm:p-5">
      <div className="absolute -right-16 -top-16 h-52 w-52 rounded-full bg-red-600/20 blur-3xl" />
      <div className="relative overflow-hidden rounded-[1.45rem] bg-white text-neutral-950">
        <div className="border-b border-neutral-200 bg-neutral-50 px-5 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="marketing-kicker text-neutral-500">Book your photo session</div>
              <h2 className="marketing-card-title mt-2 text-[1.3rem]">Riverside College</h2>
              <p className="marketing-caption mt-1 text-neutral-500">Tuesday, September 15 · 10-minute appointments</p>
            </div>
            <span className="marketing-caption hidden rounded-full bg-emerald-100 px-3 py-2 font-bold text-emerald-800 sm:inline-flex">18 spots left</span>
          </div>
        </div>

        <div className="p-5">
          <div className="marketing-caption mb-3 font-bold">Choose an available time</div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {["9:00", "9:10", "9:20", "9:30", "9:40", "9:50", "10:00", "10:10"].map((time, index) => (
              <div
                key={time}
                className={`marketing-caption rounded-xl border px-2 py-3 text-center font-bold ${
                  index === 2 || index === 5
                    ? "border-red-200 bg-red-50 text-red-600 line-through"
                    : index === 6
                      ? "border-neutral-950 bg-neutral-950 text-white"
                      : "border-neutral-200 bg-white text-neutral-700"
                }`}
              >
                {time}
              </div>
            ))}
          </div>
          <div className="marketing-caption mt-3 flex flex-wrap gap-4 text-neutral-500">
            <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-white ring-1 ring-neutral-300" />Available</span>
            <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-red-100 ring-1 ring-red-200" />Booked</span>
            <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-neutral-950" />Selected</span>
          </div>
          <div className="mt-5 rounded-2xl border border-red-200 border-l-4 border-l-red-600 bg-red-50 px-4 py-3 text-red-800">
            <div className="marketing-caption font-extrabold">LUNCH · 12:30 PM–1:00 PM</div>
            <div className="marketing-caption mt-1 text-red-600">Not available for appointments</div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-neutral-200 px-4 py-3 text-sm text-neutral-400">Student name</div>
            <div className="rounded-xl border border-neutral-200 px-4 py-3 text-sm text-neutral-400">Class or program</div>
          </div>
          <div className="marketing-button mt-4 flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3.5 text-white">
            Continue to payment
            <ArrowRight className="h-4 w-4" />
          </div>
          <p className="marketing-caption mt-3 text-center text-neutral-400">Sample booking preview. No live student data is shown.</p>
        </div>
      </div>
    </div>
  );
}

function RosterPreview() {
  return (
    <div className="overflow-hidden rounded-[1.5rem] border border-neutral-200 bg-white">
      <div className="flex flex-col gap-4 border-b border-neutral-200 bg-neutral-950 px-5 py-5 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="marketing-kicker text-white/45">Studio OS Photographer</div>
          <div className="marketing-card-title mt-2 text-[1.2rem]">Student appointment roster</div>
        </div>
        <span className="marketing-caption inline-flex w-fit items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-2 font-bold text-emerald-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          24 online bookings
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-4">
        <span className="marketing-caption font-bold">Sorted by appointment time</span>
        <span className="marketing-kicker rounded-full bg-blue-50 px-3 py-2 text-blue-700">Next · 9:20 AM</span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[620px]">
          <div className="grid grid-cols-[90px_1fr_1fr_145px] bg-neutral-50 px-5 py-3 text-xs font-bold uppercase text-neutral-500">
            <span>Time</span><span>Student</span><span>Class</span><span>Booking</span>
          </div>
          {previewRows.map(([time, student, className, status]) => (
            <div key={time} className="grid grid-cols-[90px_1fr_1fr_145px] items-center border-t border-neutral-100 px-5 py-4 text-sm">
              <span className="font-bold text-blue-700">{time}</span>
              <span className="font-semibold">{student}</span>
              <span className="text-neutral-600">{className}</span>
              <span className="marketing-caption w-fit rounded-full bg-emerald-100 px-3 py-1.5 font-bold text-emerald-800">{status}</span>
            </div>
          ))}
          <div className="grid grid-cols-[90px_1fr_1fr_145px] items-center border-y border-red-200 bg-red-50 px-5 py-4 text-sm font-bold text-red-700">
            <span>12:30–1:00</span><span>LUNCH</span><span>No appointments</span><span className="marketing-kicker w-fit rounded-full bg-red-100 px-3 py-1.5">Locked</span>
          </div>
        </div>
      </div>
      <p className="marketing-caption px-5 py-4 text-neutral-400">Sample product preview. Names are replaced with anonymous student numbers.</p>
    </div>
  );
}

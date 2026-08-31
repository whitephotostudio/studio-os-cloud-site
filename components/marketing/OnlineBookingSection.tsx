import Link from "next/link";
import {
  ArrowUpRight,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  CreditCard,
  UsersRound,
} from "lucide-react";
import { Reveal } from "./Reveal";

const scheduleRows = [
  { time: "9:20 AM", subject: "Student 018", status: "Paid · Confirmed" },
  { time: "9:40 AM", subject: "Student 024", status: "Paid · Confirmed" },
  { time: "10:00 AM", subject: "Student 031", status: "Confirmed" },
];

const bookingBenefits = [
  { icon: CalendarCheck2, label: "Live availability" },
  { icon: CreditCard, label: "Optional online payment" },
  { icon: UsersRound, label: "Automatic student roster" },
  { icon: Clock3, label: "Picture-day time order" },
];

export function OnlineBookingSection() {
  return (
    <section className="overflow-hidden bg-neutral-950 px-4 py-20 text-white sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[0.88fr_1.12fr]">
        <Reveal>
          <p className="marketing-kicker text-red-300">Online Booking + Student Rosters</p>
          <h2 className="marketing-title mt-4">
            The booking becomes the picture-day student roster.
          </h2>
          <p className="marketing-body mt-5 max-w-xl text-white/65">
            Create a school or event booking link, let students choose an open
            time and pay online, then bring confirmed bookings into Studio OS as
            an organized, time-based student roster. For events, Studio OS creates
            an attendee booking list instead.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {bookingBenefits.map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="marketing-caption flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-3 font-semibold text-white/85"
              >
                <span className="rounded-xl bg-red-500/15 p-2 text-red-300">
                  <Icon className="h-4 w-4" />
                </span>
                {label}
              </div>
            ))}
          </div>

          <Link
            href="/online-school-photography-booking"
            data-marketing-event="cta_learn_booking"
            data-marketing-label="Homepage online booking"
            data-marketing-placement="homepage_booking_section"
            className="marketing-button premium-button mt-9 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-neutral-950 hover:bg-neutral-100"
          >
            Explore Online Booking
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </Reveal>

        <Reveal
          delay={160}
          className="relative rounded-[2rem] border border-white/10 bg-white/[0.055] p-3 shadow-[0_42px_120px_rgba(0,0,0,0.45)] sm:p-5"
        >
          <div className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-red-600/20 blur-3xl" />
          <div className="relative overflow-hidden rounded-[1.5rem] bg-white text-neutral-950">
            <div className="flex flex-col gap-4 border-b border-neutral-200 bg-neutral-50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="marketing-kicker text-neutral-500">Picture day</div>
                <div className="marketing-card-title mt-2 text-[1.2rem]">Riverside College</div>
              </div>
              <div className="marketing-caption inline-flex w-fit items-center gap-2 rounded-full bg-emerald-100 px-3 py-2 font-bold text-emerald-800">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Booking active
              </div>
            </div>

            <div className="grid grid-cols-3 gap-px bg-neutral-200">
              {[
                ["24", "Confirmed"],
                ["16", "Times left"],
                ["$720", "Collected"],
              ].map(([value, label]) => (
                <div key={label} className="bg-white px-3 py-5 text-center sm:px-5">
                  <div className="text-xl font-bold sm:text-2xl">{value}</div>
                  <div className="marketing-caption mt-1 text-neutral-500">{label}</div>
                </div>
              ))}
            </div>

            <div className="p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="marketing-caption font-bold">Student appointment roster</span>
                <span className="marketing-caption text-neutral-500">Sample product preview</span>
              </div>
              <div className="overflow-hidden rounded-2xl border border-neutral-200">
                {scheduleRows.map((row) => (
                  <div
                    key={row.time}
                    className="grid grid-cols-[78px_1fr] gap-3 border-b border-neutral-100 px-4 py-3 last:border-b-0 sm:grid-cols-[95px_1fr_auto]"
                  >
                    <span className="marketing-caption font-bold text-blue-700">{row.time}</span>
                    <span className="marketing-caption font-semibold">{row.subject}</span>
                    <span className="marketing-caption col-start-2 inline-flex items-center gap-1.5 text-emerald-700 sm:col-start-auto">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {row.status}
                    </span>
                  </div>
                ))}
                <div className="grid grid-cols-[78px_1fr] gap-3 border-y border-red-200 bg-red-50 px-4 py-3 text-red-700 sm:grid-cols-[95px_1fr_auto]">
                  <span className="marketing-caption font-extrabold">12:30–1:00</span>
                  <span className="marketing-caption font-extrabold">LUNCH · NO APPOINTMENTS</span>
                  <span className="marketing-kicker col-start-2 w-fit rounded-full bg-red-100 px-2 py-1 sm:col-start-auto">Locked</span>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

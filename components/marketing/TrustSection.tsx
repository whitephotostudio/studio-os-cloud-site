import Link from "next/link";
import { ArrowRight, CalendarCheck2, Eye, LockKeyhole, ShieldCheck } from "lucide-react";
import { Reveal } from "./Reveal";

const proofPoints = [
  {
    title: "Booking becomes the working list",
    text: "Confirmed school appointments build the student roster; event appointments build an attendee list, with every booked time attached.",
    icon: CalendarCheck2,
  },
  {
    title: "Private client access",
    text: "PIN and access controls help photographers deliver student and client galleries to the intended audience.",
    icon: LockKeyhole,
  },
  {
    title: "Security you can understand",
    text: "Encrypted connections, account separation, MFA, controlled media access, and documented data responsibilities.",
    icon: ShieldCheck,
  },
  {
    title: "A demo you can inspect",
    text: "Explore the client experience before creating an account—without exposing a real customer gallery.",
    icon: Eye,
  },
];

export function TrustSection() {
  return (
    <section className="bg-neutral-950 px-4 py-16 text-white sm:px-6 lg:px-8 lg:py-24">
      <div className="mx-auto max-w-7xl">
        <Reveal className="grid gap-10 lg:grid-cols-[0.78fr_1.22fr] lg:items-end">
          <div>
            <p className="marketing-kicker text-red-300">Product Proof</p>
            <h2 className="marketing-title mt-4">
              Trust the workflow because you can see how it works.
            </h2>
            <p className="marketing-body mt-5 text-white/62">
              Studio OS Cloud explains what is live, how access is protected, and
              what photographers and clients experience at every step.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/sample-galleries/demo"
                className="marketing-button premium-button inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-neutral-950 transition hover:bg-neutral-100"
              >
                Try Gallery Demo
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/security"
                className="marketing-button premium-button inline-flex items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-3 text-white transition hover:bg-white/20"
              >
                Review Security
              </Link>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {proofPoints.map((item) => (
              <article
                key={item.title}
                className="rounded-[1.5rem] border border-white/10 bg-white/[0.06] p-6 backdrop-blur"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-red-200">
                  <item.icon className="h-5 w-5" />
                </span>
                <h3 className="marketing-card-title mt-5 text-white">{item.title}</h3>
                <p className="marketing-caption mt-3 text-white/58">{item.text}</p>
              </article>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

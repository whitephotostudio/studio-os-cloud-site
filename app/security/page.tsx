import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  DatabaseBackup,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Security & Student Data Protection",
  description:
    "How Studio OS Cloud protects photographer, student, parent, gallery, and order data with controlled access, encryption, MFA, backups, and documented responsibilities.",
  alternates: { canonical: "https://www.studiooscloud.com/security" },
};

const protections = [
  {
    title: "Account separation",
    text: "Database access rules are designed so one photographer cannot read another photographer’s records.",
    icon: LockKeyhole,
  },
  {
    title: "Protected media access",
    text: "Private gallery and download routes validate access before protected photos or files are delivered.",
    icon: KeyRound,
  },
  {
    title: "Encryption",
    text: "The service uses encrypted HTTPS connections in transit and encrypted storage for hosted objects.",
    icon: ShieldCheck,
  },
  {
    title: "Two-factor authentication",
    text: "Photographer accounts can add authenticator-based MFA for an additional sign-in check.",
    icon: Fingerprint,
  },
  {
    title: "Backup and recovery",
    text: "Documented backup and recovery procedures protect operational data while respecting deletion and retention rules.",
    icon: DatabaseBackup,
  },
];

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <SiteHeader />
      <main>
        <section className="bg-neutral-950 px-4 py-20 text-white sm:px-6 lg:px-8 lg:py-28">
          <div className="mx-auto max-w-5xl">
            <p className="marketing-kicker text-red-300">Security & Privacy</p>
            <h1 className="marketing-display mt-5 max-w-4xl">
              Student and client data deserve deliberate protection.
            </h1>
            <p className="marketing-body mt-6 max-w-3xl text-white/68">
              Studio OS Cloud combines technical safeguards with clear photographer
              responsibilities. This page explains the protections without claiming
              certifications the service has not earned.
            </p>
          </div>
        </section>

        <section className="px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {protections.map((item) => (
                <article key={item.title} className="rounded-[1.5rem] border border-neutral-200 bg-white p-6 shadow-sm">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                    <item.icon className="h-5 w-5" />
                  </span>
                  <h2 className="marketing-card-title mt-5">{item.title}</h2>
                  <p className="marketing-caption mt-3 text-neutral-600">{item.text}</p>
                </article>
              ))}
            </div>

            <div className="mt-12 grid gap-6 lg:grid-cols-2">
              <section className="rounded-[1.75rem] border border-neutral-200 bg-neutral-50 p-7 sm:p-8">
                <h2 className="marketing-title text-[2rem]">Responsible student-data workflow</h2>
                <p className="marketing-body mt-5 text-neutral-600">
                  Photographers control the rosters, photos, galleries, and access they
                  create. The Data Responsibility Agreement documents consent,
                  authorized use, retention, deletion, and incident responsibilities.
                </p>
                <Link href="/data-responsibility-agreement" className="marketing-button mt-6 inline-flex items-center gap-2 font-semibold text-red-700">
                  Read the agreement <ArrowRight className="h-4 w-4" />
                </Link>
              </section>
              <section className="rounded-[1.75rem] border border-neutral-200 bg-neutral-50 p-7 sm:p-8">
                <h2 className="marketing-title text-[2rem]">Payments and account data</h2>
                <p className="marketing-body mt-5 text-neutral-600">
                  Stripe processes card details; Studio OS Cloud does not receive the
                  full card number. Supabase provides authentication and database
                  services, Cloudflare stores media, and Vercel hosts the application.
                </p>
                <Link href="/privacy" className="marketing-button mt-6 inline-flex items-center gap-2 font-semibold text-red-700">
                  Read the privacy policy <ArrowRight className="h-4 w-4" />
                </Link>
              </section>
            </div>

            <div className="mt-12 rounded-[1.75rem] bg-neutral-950 p-7 text-white sm:p-9">
              <h2 className="marketing-title">Report a security or privacy concern.</h2>
              <p className="marketing-body mt-4 max-w-3xl text-white/65">
                Do not include passwords, authenticator codes, student photos, or other
                sensitive material in your first message. We will reply with a safe way
                to continue the investigation.
              </p>
              <a href="mailto:galleries@studiooscloud.com?subject=Studio%20OS%20Security%20Concern" className="marketing-button mt-7 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-neutral-950">
                Contact Security <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

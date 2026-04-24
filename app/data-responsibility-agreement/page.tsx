import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Data Responsibility Agreement — Studio OS Cloud",
  description:
    "Your responsibilities as a photographer when uploading photos, rosters, student information, and client data through Studio OS Cloud.",
  alternates: {
    canonical: "https://studiooscloud.com/data-responsibility-agreement",
  },
};

export default function DataResponsibilityPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <SiteHeader />

      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-red-100 bg-red-50 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.22em] text-red-600">
          Legal · Last updated April 2026
        </div>
        <h1 className="mt-6 text-4xl font-black tracking-tight text-neutral-950 sm:text-5xl">
          Data Responsibility Agreement
        </h1>
        <p className="mt-4 text-sm font-bold uppercase tracking-[0.14em] text-neutral-500">
          Version 2026-04-v1
        </p>

        <div className="mt-8 space-y-8 text-base leading-7 text-neutral-700">
          <section>
            <p>
              Studio OS Cloud hosts photos, rosters, student information,
              parent contact details, orders, and other personal data on
              behalf of photographers. Because the platform stores sensitive
              information — including data about minors in school contexts —
              this agreement spells out what you, the photographer, are
              responsible for when you use the service.
            </p>
            <p className="mt-3">
              When you accept this agreement, you confirm that you understand
              and will comply with everything below.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">1. You have the right to upload</h2>
            <p className="mt-2">
              You confirm that you have the legal right, permission, or
              client/school authorization to upload and manage each photo,
              roster, name, email, phone number, or other piece of client or
              student data that you place in Studio OS Cloud. This includes
              written contracts with schools, venue permissions, or model
              releases where applicable in your jurisdiction.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">2. Data involving minors</h2>
            <p className="mt-2">
              If you upload images or information about children under 18
              (school portraits, event photos of minors, etc.), you confirm
              that you have the appropriate authorization from the school,
              event organizer, or guardian to do so, consistent with the
              laws that apply in your region (e.g. FERPA, PIPEDA, GDPR,
              COPPA, state/provincial privacy legislation).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">3. Accurate parent/client contact information</h2>
            <p className="mt-2">
              When you add or import parent/client emails and phone numbers
              into Studio OS Cloud, you confirm those contacts have agreed to
              receive gallery notifications, order confirmations, and related
              communications from you through the platform.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">4. Access control is your job</h2>
            <p className="mt-2">
              Gallery PINs, share links, and access modes are under your
              control. You&rsquo;re responsible for setting appropriate
              privacy on each school, event, and student gallery. If you
              share a link with the wrong person, Studio OS Cloud cannot
              recall it after the fact.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">5. Take-down requests</h2>
            <p className="mt-2">
              If a parent, school, or client asks you to remove images,
              rosters, or personal data, you will act on that request within
              a reasonable timeframe (and in any case within the period
              required by applicable law). Studio OS Cloud provides the
              delete tools in your dashboard; executing the delete is your
              responsibility.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">6. Data breaches</h2>
            <p className="mt-2">
              If you discover that your photographer account has been
              compromised, notify us at harout@me.com right
              away. If an incident affects multiple studios or the platform
              itself, we&rsquo;ll notify affected photographers without
              undue delay.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">7. Retention</h2>
            <p className="mt-2">
              You can delete individual photos, rosters, schools, events,
              students, and orders at any time through your dashboard. On
              deletion we remove the records from the active database
              immediately; backups are purged within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">8. No misuse</h2>
            <p className="mt-2">
              You will not use Studio OS Cloud to upload data you do not have
              permission to store, to impersonate another studio or school,
              to scrape or bulk-export data belonging to other photographers,
              or to distribute content that violates the law.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">9. Changes to this agreement</h2>
            <p className="mt-2">
              If we materially update this agreement, we&rsquo;ll bump the
              version at the top of this page and require you to re-accept
              via the in-app prompt on your next dashboard load. You will
              be unable to use Studio OS Cloud until you do.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">10. Contact</h2>
            <p className="mt-2">
              Questions about this agreement? Reach us at{" "}
              <a
                href="mailto:harout@me.com"
                className="font-bold text-red-600 underline"
              >
                harout@me.com
              </a>
              .
            </p>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

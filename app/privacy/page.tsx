import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Privacy Policy — Studio OS Cloud",
  description:
    "How Studio OS Cloud collects, stores, and protects photographer and client data.",
  alternates: {
    canonical: "https://studiooscloud.com/privacy",
  },
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <SiteHeader />

      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-red-100 bg-red-50 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.22em] text-red-600">
          Legal · Last updated April 2026
        </div>
        <h1 className="mt-6 text-4xl font-black tracking-tight text-neutral-950 sm:text-5xl">
          Privacy Policy
        </h1>
        <p className="mt-4 text-sm font-bold uppercase tracking-[0.14em] text-neutral-500">
          Version 2026-04-v1
        </p>

        <div className="mt-8 space-y-8 text-base leading-7 text-neutral-700">
          <section>
            <h2 className="text-xl font-black text-neutral-950">1. Who we are</h2>
            <p className="mt-2">
              Studio OS Cloud is operated by White Photo Studios. This policy
              explains what information we collect when you use the service
              and how we handle it. If you&rsquo;re a parent using a gallery,
              we handle your data on behalf of the photographer who invited
              you — see &ldquo;Role 2&rdquo; below.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">2. Role 1 — when you are the photographer</h2>
            <p className="mt-2">
              When you sign up as a photographer, we collect: your name,
              business name, email, a hashed password, billing information
              (processed by our payment provider — we never see your full
              card number), the photos and rosters you upload, student and
              parent information you import or create, order data, and usage
              logs (IP address, browser user-agent, event timestamps). We use
              this information to run your account, process payments, send
              service emails, and improve the product.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">3. Role 2 — when you are a parent or client</h2>
            <p className="mt-2">
              If you received an invitation to view a gallery, the
              photographer who invited you is the data controller of that
              gallery&rsquo;s content. Studio OS Cloud acts as a data
              processor on their behalf. We collect your email (to email-gate
              access), your gallery PIN (if used), and logs of your visits,
              favorites, and orders. Contact the photographer directly for
              deletion or access requests involving their gallery.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">4. Where we store data</h2>
            <p className="mt-2">
              Account data, rosters, and order metadata are stored in
              Supabase (hosted on AWS). Photos and derived thumbnails are
              stored in Cloudflare R2. Backups are retained for up to 30 days
              after a photo or record is deleted by the photographer.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">5. Who we share data with</h2>
            <p className="mt-2">
              We share data only with the service providers we need to run
              Studio OS Cloud: Supabase (auth + database), Cloudflare
              (storage + CDN), Vercel (web hosting), Stripe (payments), and
              transactional email providers. We do not sell your data, and
              we do not share it with advertisers. We will disclose data if
              required by valid legal process.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">6. Security</h2>
            <p className="mt-2">
              We use industry-standard protections: TLS in transit, encryption
              at rest for stored objects, row-level security in our database
              so one photographer cannot read another&rsquo;s data, and
              optional two-factor authentication on your account. No system
              is perfectly secure — if you suspect unauthorized access, email
              us at harout@me.com so we can investigate.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">7. Your rights</h2>
            <p className="mt-2">
              You can request a copy of the data we hold about you, correct
              it, or ask us to delete it. Email harout@me.com.
              For parent/client data in a gallery, contact the photographer
              who invited you — they control that gallery.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">8. Cookies</h2>
            <p className="mt-2">
              We use only functional cookies necessary for the service
              (keeping you signed in, remembering your UI preferences). We do
              not use third-party advertising or tracking cookies.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">9. Changes to this policy</h2>
            <p className="mt-2">
              If we materially change this policy, we&rsquo;ll bump the
              version at the top of this page and require you to re-accept
              via the in-app agreement prompt.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">10. Contact</h2>
            <p className="mt-2">
              Privacy questions or deletion requests:{" "}
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

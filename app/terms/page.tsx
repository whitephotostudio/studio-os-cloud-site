import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Terms of Service — Studio OS Cloud",
  description:
    "Studio OS Cloud Terms of Service for professional photographers using the platform.",
  alternates: {
    canonical: "https://studiooscloud.com/terms",
  },
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <SiteHeader />

      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-red-100 bg-red-50 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.22em] text-red-600">
          Legal · Last updated April 2026
        </div>
        <h1 className="mt-6 text-4xl font-black tracking-tight text-neutral-950 sm:text-5xl">
          Studio OS Cloud Terms of Service
        </h1>
        <p className="mt-4 text-sm font-bold uppercase tracking-[0.14em] text-neutral-500">
          Version 2026-04-v1
        </p>

        <div className="mt-8 space-y-8 text-base leading-7 text-neutral-700">
          <section>
            <h2 className="text-xl font-black text-neutral-950">1. Who this applies to</h2>
            <p className="mt-2">
              These Terms of Service (&ldquo;Terms&rdquo;) govern your use of
              Studio OS Cloud (&ldquo;Studio OS,&rdquo; &ldquo;we,&rdquo;
              &ldquo;us&rdquo;), including the website, the Studio OS desktop
              application, the parent gallery experience, and any related
              services. By creating an account or continuing to use the
              platform after the acceptance prompt, you agree to these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">2. Who can use the service</h2>
            <p className="mt-2">
              Studio OS Cloud is intended for professional photographers and
              photography studios. You must be at least 18 years old to open
              an account. If you create an account on behalf of an organization
              or studio, you represent that you have authority to bind that
              organization to these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">3. Your account</h2>
            <p className="mt-2">
              You are responsible for keeping your email and password
              confidential. You are responsible for everything that happens
              under your account. Notify us immediately at
              harout@me.com if you suspect unauthorized access.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">4. Your content</h2>
            <p className="mt-2">
              You retain ownership of the photos, rosters, student and parent
              information, orders, and other content you upload or generate
              through the service (&ldquo;Your Content&rdquo;). You grant
              Studio OS Cloud a worldwide, non-exclusive, royalty-free license
              to host, copy, transmit, process, display, and back up Your
              Content solely to provide the service to you and to your
              authorized parents/clients.
            </p>
            <p className="mt-2">
              You are solely responsible for obtaining all permissions,
              releases, and client/school authorizations necessary to upload
              and process Your Content through the platform. See the separate
              Data Responsibility Agreement for detail.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">5. Acceptable use</h2>
            <p className="mt-2">
              You may not use Studio OS Cloud to upload, store, or distribute
              content that you do not have the right to distribute; content
              that is unlawful, harassing, or sexually explicit involving
              minors; malware; or any material that violates the rights of
              any third party. We may suspend or terminate accounts that
              violate these Terms without notice.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">6. Subscription and payment</h2>
            <p className="mt-2">
              Paid plans are billed on a recurring basis in the currency shown
              at checkout. You can cancel anytime from your account settings;
              cancellation takes effect at the end of the current billing
              period. We do not provide refunds for partial billing periods
              except where required by law.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">7. Termination</h2>
            <p className="mt-2">
              You may delete your account at any time. We may suspend or
              terminate your access if you materially breach these Terms. On
              termination, we will retain backups of Your Content for a
              limited period consistent with our Privacy Policy, after which
              the content will be permanently deleted.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">8. Warranty disclaimer</h2>
            <p className="mt-2">
              Studio OS Cloud is provided &ldquo;as is.&rdquo; We do not
              warrant that the service will be uninterrupted or error-free. To
              the maximum extent permitted by law, we disclaim all implied
              warranties of merchantability, fitness for a particular purpose,
              and non-infringement.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">9. Limitation of liability</h2>
            <p className="mt-2">
              To the maximum extent permitted by law, Studio OS Cloud and its
              affiliates will not be liable for indirect, incidental, special,
              consequential, or punitive damages arising out of your use of
              the service. Our aggregate liability for any claims arising from
              your use of the service is limited to the amount you paid us in
              the twelve months preceding the event giving rise to the claim.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">10. Changes to these Terms</h2>
            <p className="mt-2">
              We may update these Terms from time to time. When we do, we&rsquo;ll
              bump the version number at the top of this page and require you
              to re-accept via the in-app agreement prompt on your next
              dashboard load. Your continued use after acceptance means
              you agree to the revised Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-black text-neutral-950">11. Contact</h2>
            <p className="mt-2">
              Questions? Reach us at{" "}
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

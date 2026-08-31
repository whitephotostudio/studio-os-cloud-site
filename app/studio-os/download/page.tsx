import type { Metadata } from "next";
import { Download } from "lucide-react";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Reveal } from "@/components/reveal";

export const metadata: Metadata = {
  title: "Download Studio OS for Mac — Windows Coming Soon",
  description:
    "Download the Studio OS desktop app for Mac. Windows is coming soon. Camera tethering, roster management, AI backgrounds, and cloud sync for professional photographers.",
  alternates: {
    canonical: "https://www.studiooscloud.com/studio-os/download",
  },
};
import { AgreementGate } from "@/components/agreement-gate";
import { StudioOSDownloadAccess } from "@/components/studio-os-download-access";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import {
  ensureStudioAppReleaseConfig,
  isPublicStudioAppRelease,
} from "@/lib/studio-os-app";

export const dynamic = "force-dynamic";

export default async function StudioOSDownloadPage() {
  const service = createDashboardServiceClient();
  const release = await ensureStudioAppReleaseConfig(service);
  const publicRelease = isPublicStudioAppRelease(release.release_state);
  const macReady = Boolean(release.mac_download_url);
  const windowsReady = Boolean(release.windows_download_url);

  return (
    <AgreementGate>
    <div className="download-motion-page min-h-screen bg-neutral-950 text-neutral-950">
      <SiteHeader />

      <main className="download-page-main px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-6xl">
        <Reveal repeat className="download-reveal-strong">
        <div className="download-hero-shell rounded-[36px] border border-neutral-200 bg-[radial-gradient(circle_at_top,rgba(220,38,38,0.08),transparent_34%),linear-gradient(180deg,#fff_0%,#fafafa_100%)] p-8 shadow-[0_24px_80px_rgba(15,23,42,0.08)] sm:p-12">
          <div className="mx-auto max-w-3xl text-center">
            <Reveal repeat delay={120} className="download-reveal-strong">
            <div className="download-hero-kicker inline-flex items-center gap-2 rounded-full border border-red-100 bg-red-50 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.22em] text-red-600">
              <Download className="h-4 w-4" />
              Studio OS App Download
            </div>
            </Reveal>
            <Reveal repeat delay={240} className="download-reveal-strong">
            <h1 className="download-hero-title mt-6 text-4xl font-black tracking-tight text-neutral-950 sm:text-6xl">
              Download the Studio OS app.
            </h1>
            </Reveal>
            <Reveal repeat delay={360} className="download-reveal-strong">
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-neutral-600">
              Install the app first, then sign in inside the app with your photographer account.
              If your plan includes Studio OS access, you can start using it right away. If not,
              the app will guide you to subscribe first.
            </p>
            </Reveal>
          </div>

          <Reveal repeat delay={520} className="download-reveal-strong">
            <StudioOSDownloadAccess
              publicRelease={publicRelease}
              macReady={macReady}
              windowsReady={windowsReady}
            />
          </Reveal>
        </div>
        </Reveal>

        <div className="mx-auto mt-16 grid max-w-5xl gap-12 px-1 text-neutral-950 sm:mt-20 sm:gap-16">
          <section className="rounded-3xl border border-neutral-200 bg-white p-8 sm:p-10">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              A desktop app built for the work behind the gallery
            </h2>
            <p className="mt-4 text-base leading-7 text-neutral-700">
              The Studio OS app is the desktop side of Studio OS Cloud. It handles the
              parts of a photography job that the cloud cannot do on its own: camera
              tethering, structured Projects, large file organization, AI background
              edits at scale, multi-photographer capture, and order preparation before
              files leave your studio. Once a Project is ready, the app syncs to Studio
              OS Cloud where galleries, ordering, parent access, and delivery take over.
              You can run capture and production locally and still keep the entire job
              tied to the same Project end-to-end.
            </p>
            <p className="mt-4 text-base leading-7 text-neutral-700">
              The app is included with every Studio OS Cloud plan that supports desktop
              workflow. There is no separate license for tethering, no third-party
              plug-in to keep up to date, and no manual export step between capture and
              cloud. Sign in inside the app with the same account you use on
              studiooscloud.com and your Projects appear automatically.
            </p>
          </section>

          <section className="rounded-3xl border border-neutral-200 bg-white p-8 sm:p-10">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              What is included in the desktop app
            </h2>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2">
              {[
                {
                  title: "Camera tethering",
                  detail:
                    "Shoot directly to the app with live preview, automatic file naming, and instant Project assignment.",
                },
                {
                  title: "Projects and albums",
                  detail:
                    "Organize a real job into Projects, albums, and groups. Everything stays tied together from capture through delivery.",
                },
                {
                  title: "AI background tools",
                  detail:
                    "Replace or refine backgrounds at the studio level before publishing. Designed for school, sports, and high-volume production.",
                },
                {
                  title: "Roster matching",
                  detail:
                    "Match captures to students, athletes, or session subjects using rosters, barcodes, or QR codes — without leaving the app.",
                },
                {
                  title: "Multi-photographer capture",
                  detail:
                    "Run multiple capture stations on the same Project. Every station stays in sync with shared organization and access.",
                },
                {
                  title: "Order review",
                  detail:
                    "Inspect orders, holds, and production flags locally before sending to the lab or releasing for delivery.",
                },
              ].map((item) => (
                <li
                  key={item.title}
                  className="rounded-2xl border border-neutral-100 bg-neutral-50/60 p-5"
                >
                  <h3 className="text-base font-semibold text-neutral-950">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-neutral-700">
                    {item.detail}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-3xl border border-neutral-200 bg-white p-8 sm:p-10">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              On your iPhone &amp; iPad
            </h2>
            <p className="mt-3 text-sm leading-7 text-neutral-700">
              Studio OS Mobile lets you run Picture Day from your phone — scan a
              student&apos;s QR code, capture, sort, delete, and share galleries on
              the go. There&apos;s no App Store download yet: open it in Safari and
              add it to your Home Screen, and it behaves just like an app.
            </p>
            <ol className="mt-6 space-y-3 text-sm leading-7 text-neutral-700">
              <li>
                <span className="font-semibold text-neutral-950">1.</span> On your
                iPhone or iPad, open{" "}
                <a
                  href="https://www.studiooscloud.com/m"
                  className="font-semibold text-black underline underline-offset-4"
                >
                  studiooscloud.com/m
                </a>{" "}
                in <span className="font-semibold text-neutral-950">Safari</span>.
              </li>
              <li>
                <span className="font-semibold text-neutral-950">2.</span> Tap the{" "}
                <span className="font-semibold text-neutral-950">Share</span> icon
                (the square with an up arrow).
              </li>
              <li>
                <span className="font-semibold text-neutral-950">3.</span> Choose{" "}
                <span className="font-semibold text-neutral-950">
                  &ldquo;Add to Home Screen.&rdquo;
                </span>{" "}
                The Studio OS icon lands on your Home Screen and opens full-screen.
              </li>
            </ol>
            <p className="mt-4 text-xs leading-6 text-neutral-500">
              It stays up to date automatically — nothing to reinstall when we ship
              updates. A full App Store version is on the way.
            </p>
          </section>

          <section className="rounded-3xl border border-neutral-200 bg-white p-8 sm:p-10">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              System requirements
            </h2>
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <div>
                <h3 className="text-base font-semibold text-neutral-950">macOS</h3>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-neutral-700">
                  <li>• macOS 12 Monterey or later</li>
                  <li>• Apple Silicon or Intel processor</li>
                  <li>• 8 GB RAM minimum (16 GB recommended for tethering)</li>
                  <li>• 10 GB free disk space, more for active Projects</li>
                  <li>• USB-C or USB-A camera connection for tethering</li>
                </ul>
              </div>
              <div>
                <h3 className="text-base font-semibold text-neutral-950">Windows</h3>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-neutral-700">
                  <li>• Windows 10 (build 1909) or Windows 11</li>
                  <li>• 64-bit processor</li>
                  <li>• 8 GB RAM minimum (16 GB recommended for tethering)</li>
                  <li>• 10 GB free disk space, more for active Projects</li>
                  <li>• USB camera connection compatible with your manufacturer&apos;s drivers</li>
                </ul>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-neutral-200 bg-white p-8 sm:p-10">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Getting started after install
            </h2>
            <ol className="mt-6 space-y-4 text-sm leading-7 text-neutral-700">
              <li>
                <span className="font-semibold text-neutral-950">1. Install and open the app.</span>{" "}
                Download the build for your operating system, run the installer, and
                launch Studio OS.
              </li>
              <li>
                <span className="font-semibold text-neutral-950">2. Sign in with your photographer account.</span>{" "}
                Use the same email and password you use at studiooscloud.com. The app
                will mirror your Projects and access automatically.
              </li>
              <li>
                <span className="font-semibold text-neutral-950">3. Create or open a Project.</span>{" "}
                Start a fresh Project from inside the app, or open one synced from the
                cloud. Tethered capture and AI tools work the same way either direction.
              </li>
              <li>
                <span className="font-semibold text-neutral-950">4. Publish to Studio OS Cloud.</span>{" "}
                When the work is ready, publish the gallery and ordering will go live in
                Studio OS Cloud — no manual export, no third-party uploader.
              </li>
            </ol>
            <p className="mt-6 text-sm leading-6 text-neutral-500">
              If your plan does not yet include desktop access, the app will guide you
              to subscribe before you can open a Project.
            </p>
          </section>
        </div>
        </div>
      </main>

      <SiteFooter />
    </div>
    </AgreementGate>
  );
}

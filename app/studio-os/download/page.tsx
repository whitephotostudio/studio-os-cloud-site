import { Download } from "lucide-react";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
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
    <div className="min-h-screen bg-white text-neutral-950">
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="rounded-[36px] border border-neutral-200 bg-[radial-gradient(circle_at_top,rgba(220,38,38,0.08),transparent_34%),linear-gradient(180deg,#fff_0%,#fafafa_100%)] p-8 shadow-[0_24px_80px_rgba(15,23,42,0.08)] sm:p-12">
          <div className="mx-auto max-w-3xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-red-100 bg-red-50 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.22em] text-red-600">
              <Download className="h-4 w-4" />
              Studio OS App Download
            </div>
            <h1 className="mt-6 text-4xl font-black tracking-tight text-neutral-950 sm:text-6xl">
              Download the Studio OS app.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-neutral-600">
              Install the app first, then sign in inside the app with your photographer account.
              If your plan includes Studio OS access, you can start using it right away. If not,
              the app will guide you to subscribe first.
            </p>
          </div>

          <StudioOSDownloadAccess
            publicRelease={publicRelease}
            macReady={macReady}
            windowsReady={windowsReady}
          />
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

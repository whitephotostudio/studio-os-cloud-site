import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { getOrCreatePhotographerByUser } from "@/lib/payments";
import {
  buildStudioAppDashboardState,
  createStudioAppSignedDownloadUrl,
  getProtectedStudioAppDownloadHref,
  type StudioAppReleaseAssetPlatform,
} from "@/lib/studio-os-app";

export const dynamic = "force-dynamic";

function normalizePlatform(value: string | null): StudioAppReleaseAssetPlatform | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "mac" || normalized === "windows") return normalized;
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const platform = normalizePlatform(request.nextUrl.searchParams.get("platform"));
    if (!platform) {
      return NextResponse.json(
        { ok: false, message: "Choose a valid download platform." },
        { status: 400 },
      );
    }

    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      const signInUrl = new URL("/sign-in", request.url);
      signInUrl.searchParams.set("next", getProtectedStudioAppDownloadHref(platform));
      return NextResponse.redirect(signInUrl);
    }

    const service = createDashboardServiceClient();
    const photographer = await getOrCreatePhotographerByUser(service, user);
    const studioApp = await buildStudioAppDashboardState(service, photographer.id);

    if (!studioApp.entitlement.canDownload) {
      return NextResponse.json(
        {
          ok: false,
          message: "This account does not have Studio OS App download access right now.",
        },
        { status: 403 },
      );
    }

    const redirectUrl = await createStudioAppSignedDownloadUrl(
      service,
      {
        mac_download_url: studioApp.release.macDownloadUrl,
        windows_download_url: studioApp.release.windowsDownloadUrl,
      },
      platform,
    );
    if (!redirectUrl) {
      return NextResponse.json(
        {
          ok: false,
          message: `The ${platform === "mac" ? "Mac" : "Windows"} download is not configured yet.`,
        },
        { status: 404 },
      );
    }

    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to prepare the Studio OS App download.",
      },
      { status: 500 },
    );
  }
}

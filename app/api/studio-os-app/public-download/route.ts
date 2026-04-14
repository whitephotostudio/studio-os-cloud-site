import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import {
  createStudioAppSignedDownloadUrl,
  ensureStudioAppReleaseConfig,
  isPublicStudioAppRelease,
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

    const service = createDashboardServiceClient();
    const release = await ensureStudioAppReleaseConfig(service);

    if (!isPublicStudioAppRelease(release.release_state)) {
      return NextResponse.json(
        { ok: false, message: "The Studio OS public download is not available right now." },
        { status: 404 },
      );
    }

    const redirectUrl = await createStudioAppSignedDownloadUrl(service, release, platform);
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
            : "Unable to prepare the Studio OS app download.",
      },
      { status: 500 },
    );
  }
}

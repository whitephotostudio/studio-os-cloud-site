import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { getOrCreatePhotographerByUser } from "@/lib/payments";
import {
  buildStudioAppDashboardState,
  setStudioAppBetaAccess,
  updateStudioAppReleaseConfig,
  type StudioAppReleaseState,
} from "@/lib/studio-os-app";

export const dynamic = "force-dynamic";

type AdminAction = "update_release" | "set_beta_access";

type AdminBody = {
  action?: AdminAction;
  releaseState?: StudioAppReleaseState | null;
  version?: string | null;
  releaseNotes?: string | null;
  betaWarning?: string | null;
  macDownloadUrl?: string | null;
  windowsDownloadUrl?: string | null;
  targetEmail?: string | null;
  photographerId?: string | null;
  betaAccess?: boolean | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function normalizeReleaseState(value: string | null | undefined): StudioAppReleaseState | null {
  const normalized = clean(value).toLowerCase();
  if (normalized === "hidden" || normalized === "beta" || normalized === "public") {
    return normalized;
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again before updating Studio OS App rollout." },
        { status: 401 },
      );
    }

    const service = createDashboardServiceClient();
    const photographer = await getOrCreatePhotographerByUser(service, user);
    if (!photographer.is_platform_admin) {
      return NextResponse.json(
        { ok: false, message: "Only platform admins can update Studio OS App rollout settings." },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as AdminBody;
    if (body.action === "update_release") {
      const releaseState = normalizeReleaseState(body.releaseState);
      if (!releaseState) {
        return NextResponse.json(
          { ok: false, message: "Choose a valid release state: hidden, beta, or public." },
          { status: 400 },
        );
      }

      await updateStudioAppReleaseConfig(service, {
        releaseState,
        version: clean(body.version) || "Beta 0.1.0",
        releaseNotes: clean(body.releaseNotes),
        betaWarning: clean(body.betaWarning),
        macDownloadUrl: clean(body.macDownloadUrl) || null,
        windowsDownloadUrl: clean(body.windowsDownloadUrl) || null,
      });

      const studioApp = await buildStudioAppDashboardState(service, photographer.id);
      return NextResponse.json({
        ok: true,
        studioApp: {
          ok: true,
          signedIn: true,
          ...studioApp,
        },
      });
    }

    if (body.action === "set_beta_access") {
      const enabled = Boolean(body.betaAccess);
      const target = await setStudioAppBetaAccess(service, {
        enabled,
        photographerId: clean(body.photographerId) || null,
        email: clean(body.targetEmail) || null,
      });

      const studioApp = await buildStudioAppDashboardState(service, photographer.id);
      return NextResponse.json({
        ok: true,
        studioApp: {
          ok: true,
          signedIn: true,
          ...studioApp,
        },
        updatedTarget: {
          photographerId: target.id,
          billingEmail: target.billing_email,
          studioEmail: target.studio_email,
          betaAccess: Boolean(target.studio_app_beta_access),
        },
      });
    }

    return NextResponse.json(
      { ok: false, message: "A valid admin action is required." },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to update Studio OS App rollout settings.",
      },
      { status: 500 },
    );
  }
}

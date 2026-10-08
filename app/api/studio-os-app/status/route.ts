import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { getOrCreatePhotographerByUser } from "@/lib/payments";
import {
  getFreeTrialDaysRemaining,
  isFreeTrialActive,
  resolveFreeTrialEndsAt,
} from "@/lib/payments";
import { buildStudioAppDashboardState } from "@/lib/studio-os-app";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let user: { id: string; email?: string | null } | null = null;
  let photographerId: string | null = null;
  try {
    const auth = await resolveDashboardAuth(request);
    user = auth.user;
    if (!user) {
      return NextResponse.json(
        {
          ok: false,
          signedIn: false,
          message: "Please sign in again before opening Studio OS App access.",
        },
        { status: 401 },
      );
    }
    if (auth.mfaSatisfied === false) {
      return NextResponse.json({
        ok: false,
        signedIn: true,
        mfaRequired: true,
        message: "Complete two-step verification to view your photographer keys and app access.",
      }, { status: 403 });
    }

    const service = createDashboardServiceClient();
    const photographer = await getOrCreatePhotographerByUser(service, user);
    photographerId = photographer.id;
    const studioApp = await buildStudioAppDashboardState(service, photographer.id);
    const trialEndsAt = resolveFreeTrialEndsAt(photographer);
    const trialActive = isFreeTrialActive(photographer);
    const trialDaysRemaining = trialActive
      ? Math.max(1, getFreeTrialDaysRemaining(photographer))
      : 0;

    return NextResponse.json({
      ok: true,
      signedIn: true,
      userEmail: user.email ?? null,
      trialActive,
      trialEndsAt,
      trialDaysRemaining,
      ...studioApp,
    });
  } catch (error) {
    if (user) {
      await recordAudit({
        request,
        actorUserId: user.id,
        actorPhotographerId: photographerId,
        targetPhotographerId: photographerId,
        action: "onboarding.access_check",
        entityType: "photographer",
        entityId: photographerId,
        result: "error",
        errorMessage: error instanceof Error ? error.message : "App access check failed.",
      });
    }
    return NextResponse.json(
      {
        ok: false,
        ...(user ? { signedIn: true } : {}),
        message: "We could not check your app access right now. Please try again.",
      },
      { status: 500 },
    );
  }
}

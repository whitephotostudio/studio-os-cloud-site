import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { getOrCreatePhotographerByUser } from "@/lib/payments";
import { buildStudioAppDashboardState } from "@/lib/studio-os-app";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
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

    const service = createDashboardServiceClient();
    const photographer = await getOrCreatePhotographerByUser(service, user);
    const studioApp = await buildStudioAppDashboardState(service, photographer.id);

    return NextResponse.json({
      ok: true,
      signedIn: true,
      ...studioApp,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        signedIn: true,
        message:
          error instanceof Error
            ? error.message
            : "Unable to load Studio OS App beta access.",
      },
      { status: 500 },
    );
  }
}

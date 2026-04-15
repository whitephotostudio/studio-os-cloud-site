import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";
import { toggleVote } from "@/lib/feature-requests";

export const dynamic = "force-dynamic";

/** POST — toggle vote on a feature request. */
export async function POST(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json({ ok: false, message: "Sign in required." }, { status: 401 });
    }

    const service = createDashboardServiceClient();
    const body = await request.json();
    const featureRequestId = body.feature_request_id;

    if (!featureRequestId) {
      return NextResponse.json({ ok: false, message: "feature_request_id is required." }, { status: 400 });
    }

    // Get photographer
    const { data: pg } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!pg) {
      return NextResponse.json({ ok: false, message: "Photographer not found." }, { status: 404 });
    }

    const voted = await toggleVote(service, featureRequestId, pg.id);
    return NextResponse.json({ ok: true, voted });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Failed to toggle vote." },
      { status: 500 },
    );
  }
}

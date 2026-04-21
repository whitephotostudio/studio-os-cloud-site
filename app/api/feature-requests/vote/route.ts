import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";
import { rateLimit } from "@/lib/rate-limit";
import { toggleVote } from "@/lib/feature-requests";

export const dynamic = "force-dynamic";

/** POST — toggle vote on a feature request. */
export async function POST(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json({ ok: false, message: "Sign in required." }, { status: 401 });
    }

    // Cap toggle rate so a misbehaving client can't hammer the DB with
    // rapid vote flips (each call does a read + write). 30 toggles/minute
    // is well above any plausible human rate.
    const limitResult = rateLimit(user.id, {
      namespace: "feature-request-vote",
      limit: 30,
      windowSeconds: 60,
    });
    if (!limitResult.allowed) {
      return NextResponse.json(
        { ok: false, message: "Too many votes. Please wait a moment." },
        {
          status: 429,
          headers: {
            "Retry-After": Math.max(
              1,
              Math.ceil((limitResult.resetAt - Date.now()) / 1000),
            ).toString(),
          },
        },
      );
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

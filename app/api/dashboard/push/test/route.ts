import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { hasApnsConfig, sendApnsPush } from "@/lib/apns";

export const dynamic = "force-dynamic";

// Sends a test push to the signed-in photographer's own device(s) and reports
// back exactly what APNs said for each one, so we can confirm delivery (or see
// the precise rejection reason) without waiting for a real order.
export async function POST(request: NextRequest) {
  const auth = await resolveDashboardAuth(request);
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createDashboardServiceClient();

  const { data: photographer } = await service
    .from("photographers")
    .select("id")
    .eq("user_id", auth.user.id)
    .maybeSingle<{ id: string }>();
  if (!photographer?.id) {
    return NextResponse.json(
      { error: "Photographer profile not found." },
      { status: 403 },
    );
  }

  if (!hasApnsConfig()) {
    return NextResponse.json({
      ok: false,
      message:
        "Push isn't configured on the server yet (missing APNs environment variables).",
    });
  }

  const { data: tokenRows } = await service
    .from("device_push_tokens")
    .select("token")
    .eq("photographer_id", photographer.id);
  const tokens = (tokenRows ?? []) as Array<{ token: string }>;

  if (tokens.length === 0) {
    return NextResponse.json({
      ok: false,
      deviceCount: 0,
      message:
        "No devices registered yet. Open the Studio OS app on your iPhone (and allow notifications) first.",
    });
  }

  const payload = {
    aps: {
      alert: {
        title: "Studio OS",
        body: "Test notification — your order alerts are working.",
      },
      sound: "default",
      "thread-id": "new-order",
    },
    url: "/m/orders",
  };

  const results = await Promise.all(
    tokens.map((row) => sendApnsPush(row.token, payload)),
  );

  const anyOk = results.some((r) => r.ok);
  const summary = results
    .map((r) =>
      r.ok
        ? `accepted (${r.status})`
        : `failed ${r.status || ""}${r.reason ? " " + r.reason : ""}`.trim(),
    )
    .join("; ");

  return NextResponse.json({
    ok: anyOk,
    deviceCount: tokens.length,
    summary,
  });
}

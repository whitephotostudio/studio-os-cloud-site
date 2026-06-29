import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

// Register / refresh the APNs device token for the signed-in photographer so we
// can push "new order" alerts to their iPhone. The mobile app calls this once
// it has a push token from iOS.
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

  let body: { token?: string; platform?: string };
  try {
    body = (await request.json()) as { token?: string; platform?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const token = clean(body.token);
  const platform = clean(body.platform) || "ios";
  if (!token) {
    return NextResponse.json({ error: "token is required." }, { status: 400 });
  }

  // Upsert by token. If this device previously belonged to a different
  // photographer (someone signed out and a new photographer signed in), the
  // token re-points to the current account so the old one stops receiving it.
  const { error } = await service.from("device_push_tokens").upsert(
    {
      token,
      photographer_id: photographer.id,
      platform,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "token" },
  );
  if (error) {
    console.error("[push/register] upsert failed", error);
    return NextResponse.json(
      { error: "Could not register this device." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}

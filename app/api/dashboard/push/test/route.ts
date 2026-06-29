import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { sendNewOrderPush } from "@/lib/order-push";

export const dynamic = "force-dynamic";

// Sends a test "new order" push to the signed-in photographer's own device(s),
// so they can confirm notifications are working without waiting for a real
// order. Goes through the exact same path a real order uses (and respects the
// "show order details" preference).
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

  const { count } = await service
    .from("device_push_tokens")
    .select("id", { count: "exact", head: true })
    .eq("photographer_id", photographer.id);
  const deviceCount = count ?? 0;

  if (deviceCount === 0) {
    return NextResponse.json({
      ok: false,
      deviceCount: 0,
      message:
        "No devices registered yet. Open the Studio OS app on your iPhone (and allow notifications) first.",
    });
  }

  await sendNewOrderPush(service, photographer.id, {
    customerName: "Test Client",
    amountLabel: "$25.00",
  });

  return NextResponse.json({ ok: true, deviceCount });
}

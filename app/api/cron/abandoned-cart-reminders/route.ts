import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { deliverAbandonedCartReminders } from "@/lib/abandoned-cart-reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected || request.headers.get("authorization")?.trim() !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
  }
  try {
    const result = await deliverAbandonedCartReminders(createDashboardServiceClient(), {
      origin: new URL(request.url).origin,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch {
    console.error("[cron:abandoned-cart-reminders] Delivery could not be started.");
    return NextResponse.json({ ok: false, message: "Failed to send abandoned cart reminders." }, { status: 500 });
  }
}

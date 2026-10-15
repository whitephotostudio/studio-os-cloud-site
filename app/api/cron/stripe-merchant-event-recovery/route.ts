import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { recoverStripeMerchantEvents } from "@/lib/stripe-merchant-webhook";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    // Recovery must continue after onboarding/cutover is disabled. These
    // handlers verify provider state with GETs and never move Stripe money.
    const result = await recoverStripeMerchantEvents(createDashboardServiceClient(), 25);
    return NextResponse.json({ ok: result.retry === 0, ...result }, { status: result.retry ? 503 : 200 });
  } catch {
    return NextResponse.json({ ok: false, message: "Merchant event recovery needs retry." }, { status: 503 });
  }
}

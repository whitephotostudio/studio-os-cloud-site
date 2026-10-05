import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { recoverCustomerOrderWebhooks, reconcilePendingCustomerOrderPayments } from "@/lib/customer-order-webhook";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false }, { status: 401 });
  try {
    const service = createDashboardServiceClient();
    const webhooks = await recoverCustomerOrderWebhooks(service, 50);
    const pending = await reconcilePendingCustomerOrderPayments(service, 10);
    return NextResponse.json({ ok: webhooks.retry === 0 && pending.retry === 0, webhooks, pending }, {
      status: webhooks.retry || pending.retry ? 503 : 200,
    });
  } catch {
    return NextResponse.json({ ok: false, message: "Customer payment recovery needs retry." }, { status: 503 });
  }
}

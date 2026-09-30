import { NextRequest, NextResponse } from "next/server";
import { creditMaintenanceActive } from "@/lib/credit-maintenance";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { recoverInterruptedCloudCredits } from "@/lib/cloud-credit-recovery";

export const dynamic = "force-dynamic";
export const maxDuration = 180;
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false }, { status: 401 });
  if (creditMaintenanceActive()) return NextResponse.json({ ok: false, message: "Credit recovery is briefly paused for an upgrade." },
    { status: 503, headers: { "Retry-After": "120", "Cache-Control": "no-store" } });
  try {
    const service = createDashboardServiceClient();
    const expired = await service.rpc("expire_due_credit_accounts", { p_limit: 100 });
    if (expired.error) throw expired.error;
    const recovery = await recoverInterruptedCloudCredits(service);
    return NextResponse.json({ ok: recovery.failed === 0, expiredAccounts: expired.data, ...recovery }, { status: recovery.failed ? 503 : 200 });
  } catch { return NextResponse.json({ ok: false, message: "Credit recovery is unavailable." }, { status: 503 }); }
}

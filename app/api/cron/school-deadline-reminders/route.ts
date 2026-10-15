import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { deliverSchoolDeadlineReminders } from "@/lib/school-deadline-reminders";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false }, { status: 401 });
  try { return NextResponse.json({ ok: true, ...await deliverSchoolDeadlineReminders(createDashboardServiceClient()) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return NextResponse.json({ ok: false, message: "School deadline reminders could not be processed." }, { status: 503 }); }
}

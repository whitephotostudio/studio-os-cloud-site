import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { createCalendarFeedToken } from "@/lib/calendar-feed-token";
import { listScheduleItems } from "@/lib/dashboard-schedule";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const service = createDashboardServiceClient();
    const { data: photographerRow, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (photographerError) throw photographerError;
    if (!photographerRow?.id) {
      return NextResponse.json(
        { ok: false, message: "Photographer profile not found." },
        { status: 404 },
      );
    }

    const origin = new URL(request.url).origin;
    const token = createCalendarFeedToken(photographerRow.id);
    const httpUrl = `${origin}/api/dashboard/calendar/ics?token=${encodeURIComponent(token)}`;
    const webcalUrl = httpUrl.replace(/^https?:\/\//, "webcal://");

    const items = await listScheduleItems(service, photographerRow.id);
    return NextResponse.json({
      ok: true,
      items,
      feed: {
        httpUrl,
        webcalUrl,
      },
    });
  } catch (error) {
    console.error("[dashboard:calendar:GET]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to load schedule." },
      { status: 500 },
    );
  }
}

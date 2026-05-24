import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { verifyCalendarFeedToken } from "@/lib/calendar-feed-token";
import { listScheduleItems } from "@/lib/dashboard-schedule";
import { buildIcsCalendar } from "@/lib/schedule-calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const photographerId = verifyCalendarFeedToken(url.searchParams.get("token"));
    if (!photographerId) {
      return new NextResponse("Invalid calendar feed token.", { status: 401 });
    }

    const service = createDashboardServiceClient();
    const items = await listScheduleItems(service, photographerId);
    const ics = buildIcsCalendar(items, {
      calendarName: "Studio OS Bookings",
      origin: url.origin,
    });

    return new NextResponse(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="studio-os-bookings.ics"',
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("[dashboard:calendar:ics]", error);
    return new NextResponse("Failed to build calendar feed.", { status: 500 });
  }
}

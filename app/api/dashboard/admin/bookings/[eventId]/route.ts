import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { getOrCreatePhotographerByUser } from "@/lib/payments";
import { loadStudioBookingDetail } from "@/lib/studio-bookings-detail-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function privateJson(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  try {
    const { eventId } = await context.params;
    if (!UUID_RE.test(eventId)) {
      return privateJson({ ok: false, message: "That booking event is not valid." }, { status: 400 });
    }

    const { user } = await resolveDashboardAuth(request);
    if (!user) return privateJson({ ok: false, message: "Please sign in again." }, { status: 401 });

    const service = createDashboardServiceClient();
    const photographer = await getOrCreatePhotographerByUser(service, user);
    if (!photographer.is_platform_admin) {
      return privateJson(
        { ok: false, message: "Only the Studio OS Cloud owner can view booking details." },
        { status: 403 },
      );
    }

    const detail = await loadStudioBookingDetail(service, photographer.id, eventId);
    if (!detail) {
      return privateJson({ ok: false, message: "Booking event not found." }, { status: 404 });
    }
    return privateJson(detail);
  } catch (error) {
    console.error("[studio-bookings:detail]", error);
    return privateJson(
      { ok: false, message: "Booking details could not load. No booking data was changed." },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { getOrCreatePhotographerByUser } from "@/lib/payments";
import type { StudioBookingsOverview } from "@/lib/studio-bookings";
import {
  buildBookingEventSummary,
  cleanBookingValue,
  type BookingDataRow,
} from "@/lib/studio-bookings-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function privateJson(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, {
    status: init?.status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) return privateJson({ ok: false, message: "Please sign in again." }, { status: 401 });

    const service = createDashboardServiceClient();
    const photographer = await getOrCreatePhotographerByUser(service, user);
    if (!photographer.is_platform_admin) {
      return privateJson(
        { ok: false, message: "Only the Studio OS Cloud owner can view Studio Bookings." },
        { status: 403 },
      );
    }

    const [eventResult, slotResult, bookingResult, paymentResult] = await Promise.all([
      service
        .from("booking_events")
        .select("id,school_id,enabled,timezone,slot_duration_minutes,require_payment,sitting_fee_cents,currency,includes_digital_images,created_at,updated_at")
        .eq("photographer_id", photographer.id),
      service
        .from("booking_slots")
        .select("id,event_id,start_at,end_at,status,capacity,booked_count")
        .eq("photographer_id", photographer.id),
      service
        .from("bookings")
        .select("id,event_id,slot_id,status,created_at,updated_at")
        .eq("photographer_id", photographer.id),
      service
        .from("booking_payments")
        .select("booking_id,status,amount_cents,currency,created_at")
        .eq("photographer_id", photographer.id),
    ]);
    for (const result of [eventResult, slotResult, bookingResult, paymentResult]) {
      if (result.error) throw result.error;
    }

    const events = (eventResult.data ?? []) as BookingDataRow[];
    const slots = (slotResult.data ?? []) as BookingDataRow[];
    const bookings = (bookingResult.data ?? []) as BookingDataRow[];
    const payments = (paymentResult.data ?? []) as BookingDataRow[];
    const sourceIds = events.map((row) => cleanBookingValue(row.school_id)).filter(Boolean);

    const [schoolResult, projectResult] = sourceIds.length
      ? await Promise.all([
          service
            .from("schools")
            .select("id,school_name,status,shoot_date,event_date")
            .eq("photographer_id", photographer.id)
            .in("id", sourceIds),
          service
            .from("projects")
            .select("id,title,client_name,status,shoot_date,event_date")
            .eq("photographer_id", photographer.id)
            .in("id", sourceIds),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];
    if (schoolResult.error) throw schoolResult.error;
    if (projectResult.error) throw projectResult.error;

    const schools = new Map(
      ((schoolResult.data ?? []) as BookingDataRow[]).map((row) => [cleanBookingValue(row.id), row]),
    );
    const projects = new Map(
      ((projectResult.data ?? []) as BookingDataRow[]).map((row) => [cleanBookingValue(row.id), row]),
    );
    const bookingIdsByEvent = new Map<string, Set<string>>();
    for (const booking of bookings) {
      const eventId = cleanBookingValue(booking.event_id);
      const ids = bookingIdsByEvent.get(eventId) ?? new Set<string>();
      ids.add(cleanBookingValue(booking.id));
      bookingIdsByEvent.set(eventId, ids);
    }

    const summaries = events
      .map((event) => {
        const eventId = cleanBookingValue(event.id);
        const sourceId = cleanBookingValue(event.school_id);
        const school = schools.get(sourceId) ?? null;
        const project = projects.get(sourceId) ?? null;
        const bookingIds = bookingIdsByEvent.get(eventId) ?? new Set<string>();
        return buildBookingEventSummary({
          event,
          slots: slots.filter((row) => cleanBookingValue(row.event_id) === eventId),
          bookings: bookings.filter((row) => cleanBookingValue(row.event_id) === eventId),
          payments: payments.filter((row) => bookingIds.has(cleanBookingValue(row.booking_id))),
          source: school ?? project,
          kind: school ? "school" : "event",
        });
      })
      .sort((a, b) => {
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
        const aTime = a.firstSlotAt ? new Date(a.firstSlotAt).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.firstSlotAt ? new Date(b.firstSlotAt).getTime() : Number.MAX_SAFE_INTEGER;
        return aTime - bTime;
      });

    const currency = summaries.find((row) => row.currency)?.currency ?? "CAD";
    const payload: StudioBookingsOverview = {
      ok: true,
      checkedAt: new Date().toISOString(),
      totals: {
        bookingLinks: summaries.length,
        activeLinks: summaries.filter((row) => row.enabled).length,
        inactiveLinks: summaries.filter((row) => !row.enabled).length,
        capacity: summaries.reduce((total, row) => total + row.capacity, 0),
        booked: summaries.reduce((total, row) => total + row.booked, 0),
        remaining: summaries.reduce((total, row) => total + row.remaining, 0),
        cancelled: summaries.reduce((total, row) => total + row.cancelled, 0),
        paidBookings: summaries.reduce((total, row) => total + row.paidBookings, 0),
        revenueCents: summaries.reduce((total, row) => total + row.revenueCents, 0),
        currency,
      },
      events: summaries,
    };

    return privateJson(payload);
  } catch (error) {
    console.error("[studio-bookings:overview]", error);
    return privateJson(
      { ok: false, message: "Studio Bookings could not load. No booking data was changed." },
      { status: 500 },
    );
  }
}

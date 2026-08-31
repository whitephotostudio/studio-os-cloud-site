import { NextRequest, NextResponse } from "next/server";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import {
  callPublicBookingFunction,
  loadPublicBookingMetadataByEvent,
  PUBLIC_BOOKING_UUID_RE,
} from "@/lib/public-booking";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function publicJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "public, no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function errorStatus(upstreamStatus: number) {
  if (upstreamStatus === 429) return 429;
  if (upstreamStatus >= 500) return 502;
  return 404;
}

function errorName(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}

export async function GET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get("event")?.trim() ?? "";
  if (!PUBLIC_BOOKING_UUID_RE.test(eventId)) {
    return publicJson({ error: "Booking unavailable." }, 400);
  }

  const limit = await rateLimit(getClientIp(request), {
    namespace: "public-booking-availability",
    limit: 60,
    windowSeconds: 60,
  });
  if (!limit.allowed) return publicJson({ error: "Please wait a moment and try again." }, 429);

  try {
    const upstream = await callPublicBookingFunction(
      "booking-availability",
      new URLSearchParams({ event: eventId }),
    );
    const data = await upstream.json().catch(() => null);
    if (!data || typeof data !== "object") {
      return publicJson({ error: "Booking unavailable." }, 502);
    }
    if (!upstream.ok) {
      return publicJson({ error: "Booking unavailable." }, errorStatus(upstream.status));
    }
    if (!("event" in data) || !data.event || typeof data.event !== "object") {
      return publicJson({ error: "Booking unavailable." }, 502);
    }

    const metadata = await loadPublicBookingMetadataByEvent(eventId).catch(() => null);
    return publicJson({
      ...data,
      event: {
        ...data.event,
        location: metadata?.location ?? null,
        address: metadata?.address ?? null,
      },
    });
  } catch (error) {
    console.error("[public-booking-availability]", errorName(error));
    return publicJson({ error: "Could not load. Please try again." }, 502);
  }
}

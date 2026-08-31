import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import {
  callPublicBookingFunction,
  loadPublicBookingMetadataByToken,
  loadPublicRebookEvents,
  PUBLIC_BOOKING_UUID_RE,
} from "@/lib/public-booking";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_MUTATION_BODY_CHARS = 4_096;

function publicJson(body: unknown, status = 200, retryAfter?: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
    },
  });
}

function tokenKey(token: string) {
  return createHash("sha256").update(token).digest("hex").slice(0, 24);
}

function validToken(value: string) {
  return PUBLIC_BOOKING_UUID_RE.test(value);
}

function errorName(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}

async function manageLimit(
  request: NextRequest,
  token: string,
  kind: "read" | "write",
) {
  const ip = getClientIp(request);
  const isWrite = kind === "write";
  const windowSeconds = isWrite ? 300 : 60;
  const [ipLimit, tokenLimit] = await Promise.all([
    rateLimit(ip, {
      namespace: `public-booking-manage-${kind}-ip`,
      limit: isWrite ? 30 : 90,
      windowSeconds,
    }),
    rateLimit(tokenKey(token), {
      namespace: `public-booking-manage-${kind}-token`,
      limit: isWrite ? 8 : 30,
      windowSeconds,
    }),
  ]);
  return {
    allowed: ipLimit.allowed && tokenLimit.allowed,
    resetAt: Math.max(ipLimit.resetAt, tokenLimit.resetAt),
  };
}

async function readMutationBody(request: NextRequest) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return { ok: false as const, status: 415, value: null };
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MUTATION_BODY_CHARS) {
    return { ok: false as const, status: 413, value: null };
  }

  const text = await request.text().catch(() => "");
  if (!text || text.length > MAX_MUTATION_BODY_CHARS) {
    return { ok: false as const, status: text ? 413 : 400, value: null };
  }
  try {
    return { ok: true as const, status: 200, value: JSON.parse(text) };
  } catch {
    return { ok: false as const, status: 400, value: null };
  }
}

function upstreamReadStatus(status: number) {
  if (status === 429) return 429;
  if (status >= 500) return 502;
  return 404;
}

function upstreamWriteStatus(status: number) {
  if (status === 409 || status === 429) return status;
  if (status === 404) return 404;
  if (status >= 500) return 502;
  return 400;
}

function upstreamWriteMessage(action: "reschedule" | "cancel", status: number) {
  if (status === 429) return "Too many attempts. Please wait before trying again.";
  if (status === 404) return "Booking not found.";
  if (status === 409 && action === "reschedule") return "That time was just taken. Please pick another.";
  return action === "reschedule"
    ? "Could not reschedule this booking."
    : "Could not cancel this booking.";
}

async function readUpstream(response: Response) {
  const body = await response.json().catch(() => null);
  return body && typeof body === "object" ? body as Record<string, unknown> : null;
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim() ?? "";
  if (!validToken(token)) return publicJson({ ok: false, error: "Booking not found." }, 404);

  const limit = await manageLimit(request, token, "read");
  if (!limit.allowed) {
    return publicJson(
      { ok: false, error: "Too many requests. Please wait a moment." },
      429,
      Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000)),
    );
  }

  try {
    const upstream = await callPublicBookingFunction(
      "booking-manage",
      new URLSearchParams({ token }),
    );
    const data = await readUpstream(upstream);
    if (!upstream.ok || !data?.ok || !data.booking || typeof data.booking !== "object") {
      return publicJson(
        { ok: false, error: upstream.status >= 500 ? "Could not load this booking." : "Booking not found." },
        upstreamReadStatus(upstream.status),
      );
    }

    const metadata = await loadPublicBookingMetadataByToken(token).catch(() => null);
    const booking = data.booking as Record<string, unknown>;
    const slots = Array.isArray(data.slots) ? data.slots : [];
    const currentRebookEvent = metadata ? {
      eventId: metadata.eventId,
      schoolName: typeof booking.schoolName === "string" ? booking.schoolName : "Photo session",
      timezone: typeof booking.timezone === "string" ? booking.timezone : "America/Toronto",
      location: metadata.location,
      address: metadata.address,
      bookingUrl: metadata.bookingUrl,
      slots: slots.map((slot) => ({
        ...(slot && typeof slot === "object" ? slot : {}),
        location: metadata.location,
        address: metadata.address,
      })),
    } : null;
    const relatedRebookEvents = metadata && booking.status === "cancelled"
      ? await loadPublicRebookEvents(metadata).catch(() => [])
      : [];
    return publicJson({
      ok: true,
      booking: {
        ...booking,
        location: metadata?.location ?? null,
        address: metadata?.address ?? null,
        bookingUrl: metadata?.bookingUrl ?? null,
      },
      slots: slots.map((slot) => ({
        ...(slot && typeof slot === "object" ? slot : {}),
        location: metadata?.location ?? null,
        address: metadata?.address ?? null,
      })),
      rebookEvents: currentRebookEvent
        ? [currentRebookEvent, ...relatedRebookEvents]
        : [],
    });
  } catch (error) {
    // Tokens are bearer credentials. Log only the error class so a fetch error
    // can never serialize the upstream URL (which contains the token).
    console.error("[public-booking-manage:get]", errorName(error));
    return publicJson({ ok: false, error: "Could not load this booking. Please try again." }, 502);
  }
}

export async function POST(request: NextRequest) {
  const parsed = await readMutationBody(request);
  if (!parsed.ok) {
    return publicJson({ ok: false, error: "That request is not valid." }, parsed.status);
  }
  const raw = parsed.value;
  const token = typeof raw?.token === "string" ? raw.token.trim() : "";
  const action = raw?.action === "reschedule" || raw?.action === "cancel" ? raw.action : "";
  const newSlotId = typeof raw?.newSlotId === "string" ? raw.newSlotId.trim() : "";
  if (!validToken(token) || !action || (action === "reschedule" && !PUBLIC_BOOKING_UUID_RE.test(newSlotId))) {
    return publicJson({ ok: false, error: "That request is not valid." }, 400);
  }

  const limit = await manageLimit(request, token, "write");
  if (!limit.allowed) {
    return publicJson(
      { ok: false, error: "Too many attempts. Please wait before trying again." },
      429,
      Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000)),
    );
  }

  try {
    const payload = action === "reschedule"
      ? { token, action, newSlotId }
      : { token, action };
    const upstream = await callPublicBookingFunction("booking-manage", null, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const data = await readUpstream(upstream);
    if (!upstream.ok || !data?.ok) {
      const status = upstreamWriteStatus(upstream.status);
      return publicJson({ ok: false, error: upstreamWriteMessage(action, status) }, status);
    }

    if (action === "reschedule") {
      return publicJson({
        ok: true,
        newStart: typeof data.newStart === "string" ? data.newStart : null,
      });
    }
    return publicJson({ ok: true, creditIssued: data.creditIssued === true });
  } catch (error) {
    console.error("[public-booking-manage:post]", errorName(error));
    return publicJson({ ok: false, error: "Could not update this booking. Please try again." }, 502);
  }
}

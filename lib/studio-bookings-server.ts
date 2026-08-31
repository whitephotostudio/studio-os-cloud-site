import type {
  StudioBookingDaySummary,
  StudioBookingEventSummary,
} from "@/lib/studio-bookings";

export type BookingDataRow = Record<string, unknown>;

export function cleanBookingValue(value: unknown) {
  return String(value ?? "").trim();
}

export function bookingNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function bookingIsoTime(value: unknown): string | null {
  const text = cleanBookingValue(value);
  if (!text || Number.isNaN(new Date(text).getTime())) return null;
  return new Date(text).toISOString();
}

function newest(values: Array<unknown>): string | null {
  return values
    .map(bookingIsoTime)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
}

function oldest(values: Array<unknown>): string | null {
  return values
    .map(bookingIsoTime)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] ?? null;
}

function localDateKey(value: unknown, timezone: string) {
  const time = bookingIsoTime(value);
  if (!time) return "Unscheduled";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(time));
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    return year && month && day ? `${year}-${month}-${day}` : time.slice(0, 10);
  } catch {
    return time.slice(0, 10);
  }
}

export function isCancelledBooking(row: BookingDataRow) {
  return cleanBookingValue(row.status).toLowerCase() === "cancelled";
}

export function buildBookingEventSummary(input: {
  event: BookingDataRow;
  slots: BookingDataRow[];
  bookings: BookingDataRow[];
  payments: BookingDataRow[];
  source: BookingDataRow | null;
  kind: "school" | "event";
}): StudioBookingEventSummary {
  const { event, slots, bookings, payments, source, kind } = input;
  const timezone = cleanBookingValue(event.timezone) || "America/Toronto";
  const activeBookings = bookings.filter((row) => !isCancelledBooking(row));
  const cancelled = bookings.length - activeBookings.length;
  const capacity = slots.reduce(
    (total, row) => total + Math.max(1, bookingNumber(row.capacity, 1)),
    0,
  );
  const booked = activeBookings.length;
  const remaining = Math.max(0, capacity - booked);
  const successfulPayments = payments.filter(
    (row) => cleanBookingValue(row.status).toLowerCase() === "succeeded",
  );
  const paidBookingIds = new Set(
    successfulPayments.map((row) => cleanBookingValue(row.booking_id)),
  );
  const failedPayments = payments.filter((row) => {
    const status = cleanBookingValue(row.status).toLowerCase();
    return status === "failed" || status === "cancelled" || status === "canceled";
  }).length;

  const byDay = new Map<string, BookingDataRow[]>();
  for (const slot of slots) {
    const key = localDateKey(slot.start_at, timezone);
    byDay.set(key, [...(byDay.get(key) ?? []), slot]);
  }

  const days: StudioBookingDaySummary[] = Array.from(byDay.entries())
    .map(([date, daySlots]) => {
      const slotIds = new Set(daySlots.map((row) => cleanBookingValue(row.id)));
      const dayBooked = activeBookings.filter((row) =>
        slotIds.has(cleanBookingValue(row.slot_id)),
      ).length;
      const dayCapacity = daySlots.reduce(
        (total, row) => total + Math.max(1, bookingNumber(row.capacity, 1)),
        0,
      );
      return {
        date,
        startAt: oldest(daySlots.map((row) => row.start_at)),
        endAt: newest(daySlots.map((row) => row.end_at)),
        capacity: dayCapacity,
        booked: dayBooked,
        remaining: Math.max(0, dayCapacity - dayBooked),
        slotCount: daySlots.length,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const name =
    cleanBookingValue(source?.school_name) ||
    cleanBookingValue(source?.title) ||
    cleanBookingValue(source?.client_name) ||
    "Untitled booking event";
  const currency = cleanBookingValue(event.currency).toUpperCase() || "CAD";

  return {
    id: cleanBookingValue(event.id),
    name,
    kind,
    enabled: event.enabled === true,
    sourceStatus: cleanBookingValue(source?.status) || null,
    timezone,
    slotMinutes: Math.max(1, bookingNumber(event.slot_duration_minutes, 5)),
    requirePayment: event.require_payment === true,
    sittingFeeCents: Math.max(0, bookingNumber(event.sitting_fee_cents)),
    currency,
    includesDigitalImages: event.includes_digital_images === true,
    capacity,
    booked,
    remaining,
    cancelled,
    totalRecords: bookings.length,
    percentFilled: capacity > 0 ? Math.min(100, Math.round((booked / capacity) * 100)) : 0,
    paidBookings: paidBookingIds.size,
    failedPayments,
    revenueCents: successfulPayments.reduce(
      (total, row) => total + Math.max(0, bookingNumber(row.amount_cents)),
      0,
    ),
    firstSlotAt: oldest(slots.map((row) => row.start_at)),
    lastSlotAt: newest(slots.map((row) => row.end_at)),
    lastBookingAt: newest(activeBookings.map((row) => row.created_at)),
    createdAt: bookingIsoTime(event.created_at),
    updatedAt: bookingIsoTime(event.updated_at),
    days,
    publicUrl: `/book?event=${encodeURIComponent(cleanBookingValue(event.id))}`,
  };
}

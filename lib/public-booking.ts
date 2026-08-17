import type { SupabaseClient } from "@supabase/supabase-js";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";

export const PUBLIC_BOOKING_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PublicBookingMetadata = {
  eventId: string;
  photographerId: string;
  schoolId: string;
  location: string | null;
  address: string | null;
  bookingUrl: string;
};

export type PublicRebookEvent = {
  eventId: string;
  schoolName: string;
  timezone: string;
  location: string | null;
  address: string | null;
  bookingUrl: string;
  slots: Array<{ id: string; start_at: string; location: string | null; address: string | null }>;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function functionsBase(): string {
  const value = clean(process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/$/, "");
  if (!value) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  return `${value}/functions/v1`;
}

function edgeHeaders(): HeadersInit {
  const anonKey = clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return anonKey
    ? { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
    : {};
}

export async function callPublicBookingFunction(
  name: "booking-availability" | "booking-manage",
  query: URLSearchParams | null,
  init?: { method?: "GET" | "POST"; body?: string },
) {
  const suffix = query && query.size ? `?${query.toString()}` : "";
  return fetch(`${functionsBase()}/${name}${suffix}`, {
    method: init?.method ?? "GET",
    headers: {
      ...edgeHeaders(),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
}

async function sourceSchedule(
  service: SupabaseClient,
  photographerId: string,
  sourceId: string,
) {
  const [schoolResult, projectResult] = await Promise.all([
    service
      .from("schools")
      .select("gallery_settings")
      .eq("photographer_id", photographerId)
      .eq("id", sourceId)
      .maybeSingle(),
    service
      .from("projects")
      .select("gallery_settings")
      .eq("photographer_id", photographerId)
      .eq("id", sourceId)
      .maybeSingle(),
  ]);

  const source = schoolResult.data ?? projectResult.data ?? null;
  const schedule = normalizeEventGallerySettings(source?.gallery_settings).schedule;
  return {
    location: clean(schedule.location) || null,
    address: clean(schedule.address) || null,
  };
}

async function metadataForEvent(
  service: SupabaseClient,
  eventId: string,
  expected?: { photographerId?: string; schoolId?: string },
): Promise<PublicBookingMetadata | null> {
  if (!PUBLIC_BOOKING_UUID_RE.test(eventId)) return null;
  const eventResult = await service
    .from("booking_events")
    .select("id,photographer_id,school_id")
    .eq("id", eventId)
    .maybeSingle();
  if (eventResult.error || !eventResult.data) return null;

  const photographerId = clean(eventResult.data.photographer_id);
  const schoolId = clean(eventResult.data.school_id);
  if (!photographerId || !schoolId) return null;
  if (expected?.photographerId && expected.photographerId !== photographerId) return null;
  if (expected?.schoolId && expected.schoolId !== schoolId) return null;

  const schedule = await sourceSchedule(service, photographerId, schoolId);
  return {
    eventId,
    photographerId,
    schoolId,
    ...schedule,
    bookingUrl: `/book?event=${encodeURIComponent(eventId)}`,
  };
}

export async function loadPublicBookingMetadataByEvent(
  eventId: string,
): Promise<PublicBookingMetadata | null> {
  if (!PUBLIC_BOOKING_UUID_RE.test(eventId)) return null;
  return metadataForEvent(createDashboardServiceClient(), eventId);
}

export async function loadPublicBookingMetadataByToken(
  token: string,
): Promise<PublicBookingMetadata | null> {
  if (!PUBLIC_BOOKING_UUID_RE.test(token)) return null;
  const service = createDashboardServiceClient();
  const bookingResult = await service
    .from("bookings")
    .select("event_id,photographer_id,school_id")
    .eq("public_token", token)
    .maybeSingle();
  if (bookingResult.error || !bookingResult.data) return null;

  const eventId = clean(bookingResult.data.event_id);
  const photographerId = clean(bookingResult.data.photographer_id);
  const schoolId = clean(bookingResult.data.school_id);
  if (!PUBLIC_BOOKING_UUID_RE.test(eventId) || !photographerId || !schoolId) return null;

  return metadataForEvent(service, eventId, { photographerId, schoolId });
}

function nameTokens(value: unknown): Set<string> {
  return new Set(
    clean(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2),
  );
}

function likelySameSchoolName(left: unknown, right: unknown) {
  const a = nameTokens(left);
  const b = nameTokens(right);
  if (a.size < 3 || b.size < 3) return false;
  const shared = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union > 0 && shared / union >= 0.8;
}

/**
 * Finds relevant studio-wide credit rebooking suggestions. Name similarity is
 * used only to rank public booking links; it never authorizes a cross-event
 * booking move or changes payment/credit state.
 */
export async function loadPublicRebookEvents(
  current: PublicBookingMetadata,
): Promise<PublicRebookEvent[]> {
  const service = createDashboardServiceClient();
  const currentEventResult = await service
    .from("booking_events")
    .select("id,sitting_fee_cents,currency")
    .eq("id", current.eventId)
    .eq("photographer_id", current.photographerId)
    .maybeSingle();
  if (currentEventResult.error || !currentEventResult.data) return [];

  const currentSchoolResult = await service
    .from("schools")
    .select("id,school_name")
    .eq("id", current.schoolId)
    .eq("photographer_id", current.photographerId)
    .maybeSingle();
  if (currentSchoolResult.error || !currentSchoolResult.data) return [];

  const eventsResult = await service
    .from("booking_events")
    .select("id,school_id,sitting_fee_cents,currency")
    .eq("photographer_id", current.photographerId)
    .eq("enabled", true)
    .neq("id", current.eventId)
    .limit(30);
  if (eventsResult.error || !eventsResult.data?.length) return [];

  const schoolIds = [...new Set(eventsResult.data.map((event) => clean(event.school_id)).filter(Boolean))];
  const schoolsResult = await service
    .from("schools")
    .select("id,school_name,gallery_settings")
    .eq("photographer_id", current.photographerId)
    .in("id", schoolIds);
  if (schoolsResult.error) return [];
  const schools = new Map((schoolsResult.data ?? []).map((school) => [clean(school.id), school]));

  const currentFee = Number(currentEventResult.data.sitting_fee_cents ?? 0);
  const currentCurrency = clean(currentEventResult.data.currency).toLowerCase();
  const currentSchoolName = clean(currentSchoolResult.data.school_name);
  const candidates = eventsResult.data
    .filter((event) => {
      const school = schools.get(clean(event.school_id));
      return Boolean(
        school &&
        Number(event.sitting_fee_cents ?? 0) === currentFee &&
        clean(event.currency).toLowerCase() === currentCurrency &&
        likelySameSchoolName(currentSchoolName, school.school_name),
      );
    })
    .slice(0, 5);

  const results = await Promise.all(candidates.map(async (event) => {
    const eventId = clean(event.id);
    const school = schools.get(clean(event.school_id));
    if (!PUBLIC_BOOKING_UUID_RE.test(eventId) || !school) return null;

    const availability = await callPublicBookingFunction(
      "booking-availability",
      new URLSearchParams({ event: eventId }),
    ).then((response) => response.ok ? response.json() : null).catch(() => null);
    const slots = Array.isArray(availability?.slots) ? availability.slots : [];
    if (!slots.length) return null;

    const schedule = normalizeEventGallerySettings(school.gallery_settings).schedule;
    const location = clean(schedule.location) || clean(school.school_name) || null;
    const address = clean(schedule.address) || null;
    return {
      eventId,
      schoolName: clean(availability?.event?.schoolName) || clean(school.school_name),
      timezone: clean(availability?.event?.timezone) || "America/Toronto",
      location,
      address,
      bookingUrl: `/book?event=${encodeURIComponent(eventId)}`,
      slots: slots
        .map((slot: Record<string, unknown>) => ({
          id: clean(slot?.id),
          start_at: clean(slot?.start_at),
          location,
          address,
        }))
        .filter((slot: { id: string; start_at: string }) =>
          PUBLIC_BOOKING_UUID_RE.test(slot.id) && Boolean(slot.start_at))
        .slice(0, 200),
    } satisfies PublicRebookEvent;
  }));

  return results.filter((event): event is PublicRebookEvent => Boolean(event));
}

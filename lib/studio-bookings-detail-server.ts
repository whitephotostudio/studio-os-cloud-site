import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  StudioBookingDetail,
  StudioBookingLocationProfile,
  StudioBookingRecord,
  StudioBookingSlot,
} from "@/lib/studio-bookings";
import {
  bookingIsoTime,
  bookingNumber,
  buildBookingEventSummary,
  cleanBookingValue,
  type BookingDataRow,
} from "@/lib/studio-bookings-server";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";
import { crmLocationPhotoPublicRow } from "@/lib/crm-location-photos";

function paymentForBooking(payments: BookingDataRow[]) {
  const ordered = [...payments].sort((a, b) => {
    const aTime = bookingIsoTime(a.created_at);
    const bTime = bookingIsoTime(b.created_at);
    return (bTime ? new Date(bTime).getTime() : 0) - (aTime ? new Date(aTime).getTime() : 0);
  });
  const successful = ordered.find(
    (row) => cleanBookingValue(row.status).toLowerCase() === "succeeded",
  );
  const selected = successful ?? ordered[0] ?? null;
  return {
    status: selected
      ? cleanBookingValue(selected.status).toLowerCase() || "unknown"
      : "not required",
    amountCents: selected ? Math.max(0, bookingNumber(selected.amount_cents)) : 0,
    currency: selected
      ? cleanBookingValue(selected.currency).toUpperCase() || "CAD"
      : "CAD",
  };
}

function crmLocationAddress(location: BookingDataRow) {
  const locality = [
    cleanBookingValue(location.city),
    cleanBookingValue(location.region),
    cleanBookingValue(location.postal_code),
  ].filter(Boolean).join(" ");
  const parts = [
    cleanBookingValue(location.address_line1),
    cleanBookingValue(location.address_line2),
    locality,
    cleanBookingValue(location.country_code),
  ].filter(Boolean);
  return parts.join(", ") || null;
}

async function loadLinkedLocationProfile(input: {
  service: SupabaseClient;
  photographerId: string;
  bookingJob: BookingDataRow | null;
}): Promise<StudioBookingLocationProfile | null> {
  const locationId = cleanBookingValue(input.bookingJob?.location_id);
  const clientId = cleanBookingValue(input.bookingJob?.client_id);
  if (!locationId || !clientId) return null;

  const [locationResult, photoResult, contactResult] = await Promise.all([
    input.service
      .from("crm_locations")
      .select("id,client_id,label,address_line1,address_line2,city,region,postal_code,country_code,arrival_instructions,parking_instructions")
      .eq("id", locationId)
      .eq("client_id", clientId)
      .eq("photographer_id", input.photographerId)
      .is("archived_at", null)
      .maybeSingle(),
    input.service
      .from("crm_location_photos")
      .select("id,photographer_id,client_id,location_id,object_key,filename,content_type,byte_size,width,height,audience,category,caption,alt_text,sort_order,created_at,updated_at")
      .eq("location_id", locationId)
      .eq("client_id", clientId)
      .eq("photographer_id", input.photographerId)
      .eq("audience", "client")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    input.service
      .from("crm_contacts")
      .select("id,client_id,location_id,full_name,email,is_primary,created_at")
      .eq("client_id", clientId)
      .eq("photographer_id", input.photographerId)
      .is("archived_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);
  if (locationResult.error) throw locationResult.error;
  if (photoResult.error) throw photoResult.error;
  if (contactResult.error) throw contactResult.error;
  if (!locationResult.data) return null;

  const contacts = (contactResult.data ?? []) as BookingDataRow[];
  const assignedContacts = contacts
    .filter((contact) => cleanBookingValue(contact.location_id) === locationId)
    .sort((a, b) => Number(b.is_primary === true) - Number(a.is_primary === true));
  const primaryFallback = contacts.filter((contact) => contact.is_primary === true);
  const selectedContact = assignedContacts[0]
    ?? (primaryFallback.length === 1 ? primaryFallback[0] : null);
  const photos = ((photoResult.data ?? []) as Record<string, unknown>[])
    .map((row) => crmLocationPhotoPublicRow(row))
    .map((photo) => ({
      id: photo.id,
      filename: photo.filename,
      previewUrl: photo.previewUrl,
      audience: "client" as const,
      category: photo.category,
      caption: photo.caption,
    }));
  const location = locationResult.data as BookingDataRow;
  return {
    id: cleanBookingValue(location.id),
    label: cleanBookingValue(location.label) || "Location",
    address: crmLocationAddress(location),
    arrivalInstructions: cleanBookingValue(location.arrival_instructions) || null,
    parkingInstructions: cleanBookingValue(location.parking_instructions) || null,
    contactName: cleanBookingValue(selectedContact?.full_name) || null,
    contactEmail: cleanBookingValue(selectedContact?.email) || null,
    photos,
  };
}

export async function loadStudioBookingDetail(
  service: SupabaseClient,
  photographerId: string,
  eventId: string,
): Promise<StudioBookingDetail | null> {
  const eventResult = await service
    .from("booking_events")
    .select("id,school_id,enabled,timezone,slot_duration_minutes,require_payment,sitting_fee_cents,currency,includes_digital_images,created_at,updated_at")
    .eq("photographer_id", photographerId)
    .eq("id", eventId)
    .maybeSingle();
  if (eventResult.error) throw eventResult.error;
  if (!eventResult.data) return null;

  const [slotResult, bookingResult, bookingJobResult] = await Promise.all([
    service
      .from("booking_slots")
      .select("id,event_id,start_at,end_at,status,capacity,booked_count")
      .eq("photographer_id", photographerId)
      .eq("event_id", eventId)
      .order("start_at", { ascending: true }),
    service
      .from("bookings")
      .select("id,event_id,slot_id,status,student_first_name,student_last_name,class_name,parent_name,parent_email,parent_phone,notes,consent_recorded_at,created_at,updated_at")
      .eq("photographer_id", photographerId)
      .eq("event_id", eventId)
      .order("created_at", { ascending: false }),
    service
      .from("crm_booking_jobs")
      .select("id,client_id,location_id,booking_event_id")
      .eq("photographer_id", photographerId)
      .eq("booking_event_id", eventId)
      .not("location_id", "is", null)
      .maybeSingle(),
  ]);
  if (slotResult.error) throw slotResult.error;
  if (bookingResult.error) throw bookingResult.error;
  if (bookingJobResult.error) throw bookingJobResult.error;

  const event = eventResult.data as BookingDataRow;
  const slots = (slotResult.data ?? []) as BookingDataRow[];
  const bookings = (bookingResult.data ?? []) as BookingDataRow[];
  const bookingIds = bookings.map((row) => cleanBookingValue(row.id)).filter(Boolean);
  const sourceId = cleanBookingValue(event.school_id);

  const [paymentResult, schoolResult, projectResult, studioResult] = await Promise.all([
    bookingIds.length
      ? service
          .from("booking_payments")
          .select("booking_id,status,amount_cents,currency,created_at")
          .eq("photographer_id", photographerId)
          .in("booking_id", bookingIds)
      : Promise.resolve({ data: [], error: null }),
    service
      .from("schools")
      .select("id,school_name,status,shoot_date,event_date,gallery_settings")
      .eq("photographer_id", photographerId)
      .eq("id", sourceId)
      .maybeSingle(),
    service
      .from("projects")
      .select("id,title,client_name,status,shoot_date,event_date,gallery_settings")
      .eq("photographer_id", photographerId)
      .eq("id", sourceId)
      .maybeSingle(),
    service
      .from("photographers")
      .select("id,business_name,brand_color,logo_url,watermark_logo_url,studio_email,studio_phone,studio_address")
      .eq("id", photographerId)
      .maybeSingle(),
  ]);
  if (paymentResult.error) throw paymentResult.error;
  if (schoolResult.error) throw schoolResult.error;
  if (projectResult.error) throw projectResult.error;
  if (studioResult.error) throw studioResult.error;

  const payments = (paymentResult.data ?? []) as BookingDataRow[];
  const paymentRowsByBooking = new Map<string, BookingDataRow[]>();
  for (const payment of payments) {
    const bookingId = cleanBookingValue(payment.booking_id);
    paymentRowsByBooking.set(bookingId, [
      ...(paymentRowsByBooking.get(bookingId) ?? []),
      payment,
    ]);
  }

  const bookingRecords: StudioBookingRecord[] = bookings.map((row) => {
    const bookingId = cleanBookingValue(row.id);
    const payment = paymentForBooking(paymentRowsByBooking.get(bookingId) ?? []);
    const studentName = [
      cleanBookingValue(row.student_first_name),
      cleanBookingValue(row.student_last_name),
    ]
      .filter(Boolean)
      .join(" ");
    return {
      id: bookingId,
      slotId: cleanBookingValue(row.slot_id) || null,
      status: cleanBookingValue(row.status).toLowerCase() || "unknown",
      studentName: studentName || "Name not recorded",
      className: cleanBookingValue(row.class_name) || null,
      parentName: cleanBookingValue(row.parent_name) || null,
      parentEmail: cleanBookingValue(row.parent_email) || null,
      parentPhone: cleanBookingValue(row.parent_phone) || null,
      notes: cleanBookingValue(row.notes) || null,
      consentRecordedAt: bookingIsoTime(row.consent_recorded_at),
      createdAt: bookingIsoTime(row.created_at),
      updatedAt: bookingIsoTime(row.updated_at),
      paymentStatus: payment.status,
      paymentAmountCents: payment.amountCents,
      paymentCurrency: payment.currency,
    };
  });

  const slotRecords: StudioBookingSlot[] = slots.map((row) => ({
    id: cleanBookingValue(row.id),
    startAt: bookingIsoTime(row.start_at) ?? cleanBookingValue(row.start_at),
    endAt: bookingIsoTime(row.end_at) ?? cleanBookingValue(row.end_at),
    status: cleanBookingValue(row.status).toLowerCase() || "available",
    capacity: Math.max(1, bookingNumber(row.capacity, 1)),
    bookedCount: Math.max(0, bookingNumber(row.booked_count)),
  }));

  const source = (schoolResult.data ?? projectResult.data ?? null) as BookingDataRow | null;
  const studio = (studioResult.data ?? null) as BookingDataRow | null;
  const schedule = normalizeEventGallerySettings(source?.gallery_settings).schedule;
  const locationProfile = await loadLinkedLocationProfile({
    service,
    photographerId,
    bookingJob: (bookingJobResult.data ?? null) as BookingDataRow | null,
  });
  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    event: buildBookingEventSummary({
      event,
      slots,
      bookings,
      payments,
      source,
      kind: schoolResult.data ? "school" : "event",
    }),
    studio: {
      businessName: cleanBookingValue(studio?.business_name) || "Studio OS",
      logoUrl:
        cleanBookingValue(studio?.logo_url) ||
        cleanBookingValue(studio?.watermark_logo_url) ||
        null,
      brandColor: cleanBookingValue(studio?.brand_color) || "#17213f",
      email: cleanBookingValue(studio?.studio_email) || null,
      phone: cleanBookingValue(studio?.studio_phone) || null,
      address: cleanBookingValue(studio?.studio_address) || null,
    },
    schedule: {
      location: cleanBookingValue(schedule.location) || null,
      address: cleanBookingValue(schedule.address) || null,
      notes: cleanBookingValue(schedule.notes) || null,
    },
    locationProfile,
    slots: slotRecords,
    bookings: bookingRecords,
  };
}

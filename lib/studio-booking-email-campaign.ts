import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordProjectEmailDelivery } from "@/lib/project-email-deliveries";
import { r2DeletePrefix, r2Download, r2Upload } from "@/lib/r2";
import type { StudioBookingEmailRecipient } from "@/lib/studio-booking-email";

const TEMPLATE_EMAIL_TYPE = "booking_campaign_template";
const BOOKING_EMAIL_TYPE = "booking_campaign_booking";
const CAMPAIGN_VERSION = 1;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StudioBookingCampaignAttachment = {
  filename: string;
  content: string;
  contentId: string;
};

export type StudioBookingEmailCampaignCopy = {
  subject: string;
  headline: string;
  message: string;
  location: string;
  address: string;
  directions: string;
};

export type StudioBookingEmailCampaign = StudioBookingEmailCampaignCopy & {
  id: string;
  eventId: string;
  photographerId: string;
  photoKeys: string[];
  savedAt: string | null;
};

type DeliveryRow = {
  status?: string | null;
  payload?: unknown;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boundedString(value: unknown, maximum: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length <= maximum ? text : "";
}

function templateDedupeKey(eventId: string) {
  return `booking-campaign-template:${eventId}`;
}

function bookingDedupePrefix(eventId: string, campaignId: string) {
  return `booking-campaign-booking:${eventId}:${campaignId}:`;
}

function bookingDedupeKey(eventId: string, campaignId: string, bookingId: string) {
  return `${bookingDedupePrefix(eventId, campaignId)}${bookingId}`;
}

function campaignAssetPrefix(
  photographerId: string,
  eventId: string,
  campaignId: string,
) {
  return `booking-email-campaigns/${photographerId}/${eventId}/${campaignId}`;
}

function internalRecipient(photographerId: string, studioEmail: string | null | undefined) {
  const email = clean(studioEmail).toLowerCase();
  return email || `campaign-${photographerId}@internal.studioos.invalid`;
}

function parseCampaignRow(
  row: Record<string, unknown> | null,
  photographerId: string,
  eventId: string,
): StudioBookingEmailCampaign | null {
  if (!row || clean(row.status as string) !== "template") return null;
  const payload = objectValue(row.payload);
  const id = boundedString(payload.campaign_id, 64);
  if (!UUID_RE.test(id)) return null;
  if (boundedString(payload.event_id, 64) !== eventId) return null;
  const prefix = `${campaignAssetPrefix(photographerId, eventId, id)}/`;
  const photoKeys = Array.isArray(payload.photo_keys)
    ? payload.photo_keys
        .map((value) => boundedString(value, 500))
        .filter((value) => value.startsWith(prefix) && value.endsWith(".jpg"))
        .slice(0, 4)
    : [];

  const subject = boundedString(row.subject, 200);
  const headline = boundedString(payload.headline, 200);
  const message = boundedString(payload.message, 10_000);
  if (!subject || !headline || !message) return null;

  return {
    id,
    eventId,
    photographerId,
    subject,
    headline,
    message,
    location: boundedString(payload.location, 500),
    address: boundedString(payload.address, 1_000),
    directions: boundedString(payload.directions, 3_000),
    photoKeys,
    savedAt: boundedString(row.sent_at, 64) || null,
  };
}

export async function loadStudioBookingEmailCampaign(
  service: SupabaseClient,
  photographerId: string,
  eventId: string,
) {
  const { data, error } = await service
    .from("project_email_deliveries")
    .select("subject,status,payload,sent_at")
    .eq("photographer_id", photographerId)
    .eq("email_type", TEMPLATE_EMAIL_TYPE)
    .eq("dedupe_key", templateDedupeKey(eventId))
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return parseCampaignRow(
    (data as Record<string, unknown> | null) ?? null,
    photographerId,
    eventId,
  );
}

export async function pauseStudioBookingEmailCampaign(
  service: SupabaseClient,
  photographerId: string,
  eventId: string,
) {
  const { error } = await service
    .from("project_email_deliveries")
    .update({ status: "tracking_error", sent_at: new Date().toISOString() })
    .eq("photographer_id", photographerId)
    .eq("email_type", TEMPLATE_EMAIL_TYPE)
    .eq("dedupe_key", templateDedupeKey(eventId));
  if (error) throw error;
}

export async function saveStudioBookingEmailCampaign(input: {
  service: SupabaseClient;
  photographerId: string;
  eventId: string;
  studioEmail?: string | null;
  campaignId?: string | null;
  copy: StudioBookingEmailCampaignCopy;
  attachments: StudioBookingCampaignAttachment[];
}) {
  const existing = await loadStudioBookingEmailCampaign(
    input.service,
    input.photographerId,
    input.eventId,
  );
  const campaignId = UUID_RE.test(clean(input.campaignId))
    ? clean(input.campaignId)
    : randomUUID();
  const prefix = campaignAssetPrefix(
    input.photographerId,
    input.eventId,
    campaignId,
  );
  const photoKeys: string[] = [];

  try {
    for (let index = 0; index < input.attachments.length; index += 1) {
      const attachment = input.attachments[index];
      const bytes = Buffer.from(attachment.content, "base64");
      const key = `${prefix}/direction-${index + 1}.jpg`;
      await r2Upload(key, bytes, "image/jpeg", "private, no-store");
      photoKeys.push(key);
    }

    await recordProjectEmailDelivery(input.service, {
      photographerId: input.photographerId,
      recipientEmail: internalRecipient(input.photographerId, input.studioEmail),
      emailType: TEMPLATE_EMAIL_TYPE,
      dedupeKey: templateDedupeKey(input.eventId),
      subject: clean(input.copy.subject),
      status: "template",
      payload: {
        version: CAMPAIGN_VERSION,
        campaign_id: campaignId,
        event_id: input.eventId,
        headline: clean(input.copy.headline),
        message: clean(input.copy.message),
        location: clean(input.copy.location),
        address: clean(input.copy.address),
        directions: clean(input.copy.directions),
        photo_keys: photoKeys,
      },
    });
  } catch (error) {
    if (photoKeys.length) {
      await r2DeletePrefix(`${prefix}/`).catch(() => undefined);
    }
    throw error;
  }

  if (existing?.photoKeys.length && existing.id !== campaignId) {
    const oldPrefix = campaignAssetPrefix(
      input.photographerId,
      input.eventId,
      existing.id,
    );
    await r2DeletePrefix(`${oldPrefix}/`).catch(() => undefined);
  }

  const saved = await loadStudioBookingEmailCampaign(
    input.service,
    input.photographerId,
    input.eventId,
  );
  if (!saved) throw new Error("The booking email campaign could not be saved.");
  return saved;
}

export async function loadStudioBookingCampaignAttachments(
  campaign: StudioBookingEmailCampaign,
): Promise<StudioBookingCampaignAttachment[]> {
  const attachments: StudioBookingCampaignAttachment[] = [];
  for (let index = 0; index < campaign.photoKeys.length; index += 1) {
    const key = campaign.photoKeys[index];
    const bytes = await r2Download(key);
    attachments.push({
      filename: `direction-photo-${index + 1}.jpg`,
      content: bytes.toString("base64"),
      contentId: `booking-direction-${index + 1}`,
    });
  }
  return attachments;
}

export async function loadHandledStudioBookingIds(
  service: SupabaseClient,
  photographerId: string,
  eventId: string,
  campaignId: string,
) {
  const bookingIds = new Set<string>();
  const pageSize = 1_000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await service
      .from("project_email_deliveries")
      .select("status,payload")
      .eq("photographer_id", photographerId)
      .eq("email_type", BOOKING_EMAIL_TYPE)
      .like("dedupe_key", `${bookingDedupePrefix(eventId, campaignId)}%`)
      .in("status", ["sent", "baseline"])
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;

    const rows = (data ?? []) as DeliveryRow[];
    for (const row of rows) {
      const payload = objectValue(row.payload);
      const bookingId = boundedString(payload.booking_id, 64);
      if (UUID_RE.test(bookingId)) bookingIds.add(bookingId);
    }
    if (rows.length < pageSize) break;
  }
  return bookingIds;
}

export function filterNewStudioBookingRecipients(
  recipients: StudioBookingEmailRecipient[],
  handledBookingIds: ReadonlySet<string>,
) {
  return recipients
    .map((recipient) => ({
      email: recipient.email,
      bookings: recipient.bookings.filter(
        (booking) => !handledBookingIds.has(booking.id),
      ),
    }))
    .filter((recipient) => recipient.bookings.length > 0);
}

export async function recordHandledStudioBookings(input: {
  service: SupabaseClient;
  photographerId: string;
  eventId: string;
  campaign: StudioBookingEmailCampaign;
  recipient: StudioBookingEmailRecipient;
  status: "sent" | "baseline";
  resendEmailId?: string | null;
}) {
  return recordHandledStudioBookingRecipients({
    service: input.service,
    photographerId: input.photographerId,
    eventId: input.eventId,
    campaign: input.campaign,
    status: input.status,
    recipients: [
      {
        recipient: input.recipient,
        resendEmailId: input.resendEmailId,
      },
    ],
  });
}

export async function recordHandledStudioBookingRecipients(input: {
  service: SupabaseClient;
  photographerId: string;
  eventId: string;
  campaign: StudioBookingEmailCampaign;
  status: "sent" | "baseline";
  recipients: Array<{
    recipient: StudioBookingEmailRecipient;
    resendEmailId?: string | null;
  }>;
}) {
  const rows = input.recipients.flatMap(({ recipient, resendEmailId }) => {
    const recipientHash = createHash("sha256")
      .update(recipient.email.toLowerCase())
      .digest("hex")
      .slice(0, 24);
    return recipient.bookings.map((booking) => ({
      project_id: null,
      order_id: null,
      photographer_id: input.photographerId,
      recipient_email: recipient.email.toLowerCase(),
      email_type: BOOKING_EMAIL_TYPE,
      dedupe_key: bookingDedupeKey(
        input.eventId,
        input.campaign.id,
        booking.id,
      ),
      resend_email_id: clean(resendEmailId) || null,
      subject: input.campaign.subject,
      status: input.status,
      payload: {
        version: CAMPAIGN_VERSION,
        campaign_id: input.campaign.id,
        event_id: input.eventId,
        booking_id: booking.id,
        recipient_hash: recipientHash,
      },
      error_message: null,
    }));
  });
  if (!rows.length) return;

  const existingKeys = new Set<string>();
  for (let offset = 0; offset < rows.length; offset += 100) {
    const keys = rows.slice(offset, offset + 100).map((row) => row.dedupe_key);
    const { data, error } = await input.service
      .from("project_email_deliveries")
      .select("dedupe_key")
      .eq("photographer_id", input.photographerId)
      .eq("email_type", BOOKING_EMAIL_TYPE)
      .in("dedupe_key", keys);
    if (error) throw error;
    for (const row of data ?? []) {
      existingKeys.add(clean((row as { dedupe_key?: string }).dedupe_key));
    }
  }
  const missing = rows.filter((row) => !existingKeys.has(row.dedupe_key));
  for (let offset = 0; offset < missing.length; offset += 100) {
    const chunk = missing.slice(offset, offset + 100);
    const { error } = await input.service
      .from("project_email_deliveries")
      .insert(chunk);
    if (!error) continue;

    // A concurrent retry may have inserted the same unique booking coverage.
    // Treat that as success only after verifying every deterministic key exists.
    const { data: concurrentRows, error: verifyError } = await input.service
      .from("project_email_deliveries")
      .select("dedupe_key")
      .eq("photographer_id", input.photographerId)
      .eq("email_type", BOOKING_EMAIL_TYPE)
      .in("dedupe_key", chunk.map((row) => row.dedupe_key));
    if (verifyError) throw error;
    const concurrentKeys = new Set(
      (concurrentRows ?? []).map((row) =>
        clean((row as { dedupe_key?: string }).dedupe_key),
      ),
    );
    if (!chunk.every((row) => concurrentKeys.has(row.dedupe_key))) throw error;
  }
}

export function studioBookingCampaignDeliveryKey(
  campaign: StudioBookingEmailCampaign,
  recipient: StudioBookingEmailRecipient,
) {
  const recipientHash = createHash("sha256")
    .update(recipient.email.toLowerCase())
    .digest("hex")
    .slice(0, 20);
  const bookingHash = createHash("sha256")
    .update(recipient.bookings.map((booking) => booking.id).sort().join("|"))
    .digest("hex")
    .slice(0, 20);
  return `booking-campaign-${campaign.eventId}-${campaign.id}-${recipientHash}-${bookingHash}`;
}

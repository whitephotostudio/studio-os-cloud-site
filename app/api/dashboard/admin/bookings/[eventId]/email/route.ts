import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { parseJson } from "@/lib/api-validation";
import { recordAudit } from "@/lib/audit";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { guardAgreement } from "@/lib/require-agreement";
import { getOrCreatePhotographerByUser } from "@/lib/payments";
import { rateLimit } from "@/lib/rate-limit";
import {
  ResendRequestError,
  resendConfigured,
  sendResendEmail,
  type SendResendEmailInput,
} from "@/lib/resend";
import {
  buildStudioBookingEmailDocument,
  buildStudioBookingStaffCopyDocument,
  collectStudioBookingEmailRecipients,
  STUDIO_BOOKING_EMAIL_MAX_RECIPIENTS,
  studioBookingRecipientFingerprint,
} from "@/lib/studio-booking-email";
import { loadStudioBookingDetail } from "@/lib/studio-bookings-detail-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_PHOTO_BASE64 = 1_000_000;
const MAX_TOTAL_PHOTO_BASE64 = 3_200_000;
const MAX_OUTPUT_PHOTO_BYTES = 900_000;
const MAX_INPUT_PIXELS = 40_000_000;
const SEND_CONCURRENCY = 4;

const DirectionPhotoSchema = z.object({
  filename: z.string().trim().min(1).max(120),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  content: z.string().min(1).max(MAX_PHOTO_BASE64),
});

const StaffCopySchema = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(false) }).strict(),
  z.object({
    enabled: z.literal(true),
    email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  }).strict(),
]);

const BookingEmailBodySchema = z
  .object({
    sendId: z.string().uuid(),
    recipientFingerprint: z.string().regex(/^[0-9a-f]{16}$/),
    subject: z.string().trim().min(1).max(200),
    headline: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(10_000),
    location: z.string().trim().max(500).default(""),
    address: z.string().trim().max(1_000).default(""),
    directions: z.string().trim().max(3_000).default(""),
    staffCopy: StaffCopySchema.default({ enabled: false }),
    photos: z.array(DirectionPhotoSchema).max(4).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    const total = value.photos.reduce((sum, photo) => sum + photo.content.length, 0);
    if (total > MAX_TOTAL_PHOTO_BASE64) {
      context.addIssue({
        code: "custom",
        path: ["photos"],
        message: "Direction photos are too large. Remove a photo or choose smaller files.",
      });
    }
  });

class InvalidDirectionPhotoError extends Error {}

function privateJson(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
) {
  return NextResponse.json(body, {
    status: init?.status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      ...init?.headers,
    },
  });
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function prepareDirectionPhoto(
  photo: z.infer<typeof DirectionPhotoSchema>,
  index: number,
) {
  if (!BASE64_RE.test(photo.content)) {
    throw new InvalidDirectionPhotoError(`Direction photo ${index + 1} is not a valid image.`);
  }

  const source = Buffer.from(photo.content, "base64");
  if (!source.length || source.length > MAX_OUTPUT_PHOTO_BYTES * 2) {
    throw new InvalidDirectionPhotoError(`Direction photo ${index + 1} is too large.`);
  }

  try {
    const image = sharp(source, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    });
    const metadata = await image.metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
      throw new InvalidDirectionPhotoError(
        `Direction photo ${index + 1} must be a JPEG, PNG, or WebP image.`,
      );
    }
    if (
      metadata.width &&
      metadata.height &&
      metadata.width * metadata.height > MAX_INPUT_PIXELS
    ) {
      throw new InvalidDirectionPhotoError(
        `Direction photo ${index + 1} has too many pixels. Choose a smaller image.`,
      );
    }

    const output = await image
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82, progressive: true, mozjpeg: true })
      .toBuffer();

    if (output.length > MAX_OUTPUT_PHOTO_BYTES) {
      throw new InvalidDirectionPhotoError(
        `Direction photo ${index + 1} is still too large after optimization.`,
      );
    }

    return {
      filename: `direction-photo-${index + 1}.jpg`,
      content: output.toString("base64"),
      contentId: `booking-direction-${index + 1}`,
    };
  } catch (error) {
    if (error instanceof InvalidDirectionPhotoError) throw error;
    throw new InvalidDirectionPhotoError(`Direction photo ${index + 1} could not be read.`);
  }
}

async function sendResendEmailWithRetry(input: SendResendEmailInput) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await sendResendEmail(input);
    } catch (error) {
      const retryable =
        error instanceof ResendRequestError &&
        (error.status === 429 || error.status >= 500);
      if (!retryable || attempt === 2) throw error;
      const delay = Math.min(
        10_000,
        Math.max(750 * 2 ** attempt, error.retryAfterMs ?? 0),
      );
      await wait(delay);
    }
  }
  throw new Error("Booking email delivery could not be completed.");
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  try {
    const { eventId } = await context.params;
    if (!UUID_RE.test(eventId)) {
      return privateJson({ ok: false, message: "That booking event is not valid." }, { status: 400 });
    }

    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return privateJson({ ok: false, message: "Please sign in again." }, { status: 401 });
    }

    const service = createDashboardServiceClient();
    const photographer = await getOrCreatePhotographerByUser(service, user);
    if (!photographer.is_platform_admin) {
      return privateJson(
        { ok: false, message: "Only the Studio OS Cloud owner can email booking clients." },
        { status: 403 },
      );
    }

    const parsed = await parseJson(request, BookingEmailBodySchema);
    if (!parsed.ok) return parsed.response;

    const agreement = await guardAgreement({ service, userId: user.id });
    if (!agreement.ok) return privateJson(agreement.body, { status: agreement.status });

    if (!resendConfigured()) {
      return privateJson(
        { ok: false, message: "Branded email sending is not configured." },
        { status: 503 },
      );
    }

    const detail = await loadStudioBookingDetail(service, photographer.id, eventId);
    if (!detail) {
      return privateJson({ ok: false, message: "Booking event not found." }, { status: 404 });
    }

    const validSlotIds = new Set(detail.slots.map((slot) => slot.id));
    const recipientSummary = collectStudioBookingEmailRecipients(
      detail.bookings,
      "confirmed",
      validSlotIds,
    );
    if (!recipientSummary.recipients.length) {
      return privateJson(
        { ok: false, message: "There are no valid email addresses for confirmed bookings." },
        { status: 400 },
      );
    }
    if (
      studioBookingRecipientFingerprint(recipientSummary.recipients) !==
      parsed.data.recipientFingerprint
    ) {
      return privateJson(
        {
          ok: false,
          message:
            "The confirmed booking list changed. Refresh the event and review the recipients before sending.",
          currentRecipients: recipientSummary.recipients.length,
        },
        { status: 409 },
      );
    }
    if (
      recipientSummary.recipients.length + (parsed.data.staffCopy.enabled ? 1 : 0) >
      STUDIO_BOOKING_EMAIL_MAX_RECIPIENTS
    ) {
      return privateJson(
        {
          ok: false,
          message: `Branded delivery supports up to ${STUDIO_BOOKING_EMAIL_MAX_RECIPIENTS} recipients at a time. Copy the BCC list and split this event into smaller messages.`,
        },
        { status: 413 },
      );
    }

    const parentEmailKeys = new Set(
      recipientSummary.recipients.map((recipient) => recipient.email.toLowerCase()),
    );
    const staffCopyEmail = parsed.data.staffCopy.enabled
      ? parsed.data.staffCopy.email
      : null;
    const staffCopyHash = staffCopyEmail
      ? createHash("sha256").update(staffCopyEmail).digest("hex").slice(0, 24)
      : null;
    if (staffCopyEmail && parentEmailKeys.has(staffCopyEmail)) {
      return privateJson(
        {
          ok: false,
          message:
            "That school/staff address is already included as a confirmed parent recipient. Use a different address or turn off the staff copy.",
        },
        { status: 400 },
      );
    }

    const attachments: Awaited<ReturnType<typeof prepareDirectionPhoto>>[] = [];
    try {
      for (let index = 0; index < parsed.data.photos.length; index += 1) {
        attachments.push(await prepareDirectionPhoto(parsed.data.photos[index], index));
      }
    } catch (error) {
      if (error instanceof InvalidDirectionPhotoError) {
        return privateJson({ ok: false, message: error.message }, { status: 400 });
      }
      throw error;
    }

    if (staffCopyEmail && staffCopyHash) {
      const staffGlobalLimit = await rateLimit(photographer.id, {
        namespace: "studio-booking-email-staff-global",
        limit: 12,
        windowSeconds: 3_600,
      });
      const staffTargetLimit = await rateLimit(`${photographer.id}:${staffCopyHash}`, {
        namespace: "studio-booking-email-staff-target",
        limit: 4,
        windowSeconds: 3_600,
      });
      const deniedStaffLimits = [staffGlobalLimit, staffTargetLimit].filter(
        (limit) => !limit.allowed,
      );
      if (deniedStaffLimits.length) {
        const resetAt = Math.max(...deniedStaffLimits.map((limit) => limit.resetAt));
        const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1_000));
        return privateJson(
          {
            ok: false,
            message:
              "The school/staff copy limit has been reached. Try again later, or turn off the staff copy and send only to booking clients.",
          },
          { status: 429, headers: { "Retry-After": String(retryAfter) } },
        );
      }
    }

    const campaignLimit = await rateLimit(`${photographer.id}:${eventId}`, {
      namespace: "studio-booking-email-campaign",
      limit: 1,
      windowSeconds: 60,
    });
    if (!campaignLimit.allowed) {
      const retryAfter = Math.max(
        1,
        Math.ceil((campaignLimit.resetAt - Date.now()) / 1_000),
      );
      return privateJson(
        {
          ok: false,
          message: `An email campaign for this event was just started. Wait ${retryAfter} seconds before trying again.`,
        },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }

    const emailDetail = {
      event: detail.event,
      studio: detail.studio,
      schedule: detail.schedule,
      slots: detail.slots,
    };
    const deliveryTargets: Array<
      | {
          kind: "parent";
          email: string;
          recipient: (typeof recipientSummary.recipients)[number];
        }
      | { kind: "staff-copy"; email: string }
    > = [
      ...recipientSummary.recipients.map((recipient) => ({
        kind: "parent" as const,
        email: recipient.email,
        recipient,
      })),
      ...(staffCopyEmail
        ? [{ kind: "staff-copy" as const, email: staffCopyEmail }]
        : []),
    ];

    let parentSent = 0;
    let parentFailed = 0;
    let staffCopySent = 0;
    let staffCopyFailed = 0;
    for (
      let offset = 0;
      offset < deliveryTargets.length;
      offset += SEND_CONCURRENCY
    ) {
      const group = deliveryTargets.slice(offset, offset + SEND_CONCURRENCY);
      const results = await Promise.allSettled(
        group.map((target) => {
          const sharedDocumentInput = {
            detail: emailDetail,
            headline: parsed.data.headline,
            message: parsed.data.message,
            location: parsed.data.location,
            address: parsed.data.address,
            directions: parsed.data.directions,
            directionPhotoContentIds: attachments.map((attachment) => attachment.contentId),
          };
          const document =
            target.kind === "parent"
              ? buildStudioBookingEmailDocument({
                  ...sharedDocumentInput,
                  recipient: target.recipient,
                })
              : buildStudioBookingStaffCopyDocument(sharedDocumentInput);
          const recipientKey = createHash("sha256")
            .update(target.email.toLowerCase())
            .digest("hex")
            .slice(0, 20);
          return sendResendEmailWithRetry({
            to: target.email,
            subject: parsed.data.subject,
            html: document.html,
            text: document.text,
            fromName: detail.studio.businessName,
            replyTo: detail.studio.email,
            attachments,
            tags: [
              { name: "type", value: "booking-update" },
              { name: "event_id", value: eventId },
              { name: "audience", value: target.kind },
            ],
            idempotencyKey:
              target.kind === "parent"
                ? `booking-update-${eventId}-${parsed.data.sendId}-${recipientKey}`
                : `booking-update-${eventId}-${parsed.data.sendId}-staff-${recipientKey}`,
          });
        }),
      );

      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        const target = group[index];
        if (target.kind === "staff-copy") {
          if (result.status === "fulfilled") staffCopySent += 1;
          else staffCopyFailed += 1;
        } else if (result.status === "fulfilled") {
          parentSent += 1;
        } else {
          parentFailed += 1;
        }
      }

      if (offset + SEND_CONCURRENCY < deliveryTargets.length) {
        await wait(1_050);
      }
    }

    const sent = parentSent + staffCopySent;
    const failed = parentFailed + staffCopyFailed;

    await recordAudit({
      request,
      actorUserId: user.id,
      actorPhotographerId: photographer.id,
      action: "studio_booking.email_campaign",
      entityType: "booking_event",
      entityId: eventId,
      targetPhotographerId: photographer.id,
      metadata: {
        send_id: parsed.data.sendId,
        parent_sent: parentSent,
        parent_failed: parentFailed,
        staff_copy_requested: Boolean(staffCopyEmail),
        staff_copy_sent: staffCopySent === 1,
        staff_copy_failed: staffCopyFailed === 1,
        staff_email_hash: staffCopyHash,
        direction_photo_count: attachments.length,
      },
      result: failed === 0 ? "ok" : "error",
      errorMessage: failed ? `${failed} booking email deliveries failed.` : null,
    });

    return privateJson({
      ok: failed === 0,
      sent,
      failed,
      total: deliveryTargets.length,
      parentSent,
      parentFailed,
      retryAfterSeconds: failed
        ? Math.max(0, Math.ceil((campaignLimit.resetAt - Date.now()) / 1_000))
        : 0,
      staffCopy: {
        requested: Boolean(staffCopyEmail),
        sent: staffCopySent === 1,
        failed: staffCopyFailed === 1,
      },
      missingEmailBookings: recipientSummary.missingEmailBookings,
      invalidEmailBookings: recipientSummary.invalidEmailBookings,
      duplicateEmailBookings: recipientSummary.duplicateEmailBookings,
      unusableSlotBookings: recipientSummary.unusableSlotBookings,
      message:
        failed === 0
          ? `Sent ${parentSent} private booking email${parentSent === 1 ? "" : "s"}${staffCopySent ? " and 1 school/staff copy" : ""}.`
          : `Sent to ${sent}; ${failed} could not be delivered${staffCopyFailed ? ", including the school/staff copy" : ""}.`,
    }, failed > 0 && sent === 0 ? { status: 502 } : undefined);
  } catch (error) {
    console.error("[studio-bookings:email]", error);
    return privateJson(
      { ok: false, message: "Booking emails could not be sent. No booking data was changed." },
      { status: 500 },
    );
  }
}

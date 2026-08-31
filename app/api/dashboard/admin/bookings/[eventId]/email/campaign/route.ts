import { NextRequest, NextResponse } from "next/server";
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
import { resendConfigured } from "@/lib/resend";
import {
  buildStudioBookingEmailDocument,
  collectStudioBookingEmailRecipients,
  STUDIO_BOOKING_EMAIL_MAX_RECIPIENTS,
  studioBookingRecipientFingerprint,
} from "@/lib/studio-booking-email";
import {
  filterNewStudioBookingRecipients,
  loadHandledStudioBookingIds,
  loadStudioBookingCampaignAttachments,
  loadStudioBookingEmailCampaign,
  pauseStudioBookingEmailCampaign,
  recordHandledStudioBookingRecipients,
  saveStudioBookingEmailCampaign,
  studioBookingCampaignDeliveryKey,
} from "@/lib/studio-booking-email-campaign";
import {
  InvalidStudioBookingDirectionPhotoError,
  prepareStudioBookingDirectionPhoto,
  STUDIO_BOOKING_EMAIL_MAX_PHOTO_BASE64,
  STUDIO_BOOKING_EMAIL_MAX_TOTAL_PHOTO_BASE64,
} from "@/lib/studio-booking-email-photos";
import {
  sendStudioBookingEmailWithRetry,
  waitForStudioBookingEmail,
} from "@/lib/studio-booking-email-send";
import { loadStudioBookingDetail } from "@/lib/studio-bookings-detail-server";
import type { StudioBookingDetail } from "@/lib/studio-bookings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEND_CONCURRENCY = 4;

const DirectionPhotoSchema = z
  .object({
    filename: z.string().trim().min(1).max(120),
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    content: z.string().min(1).max(STUDIO_BOOKING_EMAIL_MAX_PHOTO_BASE64),
  })
  .strict();

const CampaignActionSchema = z
  .discriminatedUnion("action", [
    z
      .object({
        action: z.literal("save-baseline"),
        saveId: z.string().uuid(),
        recipientFingerprint: z.string().regex(/^[0-9a-f]{16}$/),
        subject: z.string().trim().min(1).max(200),
        headline: z.string().trim().min(1).max(200),
        message: z.string().trim().min(1).max(10_000),
        location: z.string().trim().max(500).default(""),
        address: z.string().trim().max(1_000).default(""),
        directions: z.string().trim().max(3_000).default(""),
        photos: z.array(DirectionPhotoSchema).max(4).default([]),
      })
      .strict(),
    z
      .object({
        action: z.literal("send-new"),
        campaignId: z.string().uuid(),
        recipientFingerprint: z.string().regex(/^[0-9a-f]{16}$/),
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    if (value.action !== "save-baseline") return;
    const total = value.photos.reduce((sum, photo) => sum + photo.content.length, 0);
    if (total > STUDIO_BOOKING_EMAIL_MAX_TOTAL_PHOTO_BASE64) {
      context.addIssue({
        code: "custom",
        path: ["photos"],
        message: "Direction photos are too large. Remove a photo or choose smaller files.",
      });
    }
  });

type ServiceClient = ReturnType<typeof createDashboardServiceClient>;
type Campaign = NonNullable<
  Awaited<ReturnType<typeof loadStudioBookingEmailCampaign>>
>;

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

async function campaignState(input: {
  service: ServiceClient;
  photographerId: string;
  eventId: string;
  detail: StudioBookingDetail;
  campaign?: Campaign | null;
}) {
  const validSlotIds = new Set(input.detail.slots.map((slot) => slot.id));
  const recipientSummary = collectStudioBookingEmailRecipients(
    input.detail.bookings,
    "confirmed",
    validSlotIds,
  );
  const campaign =
    input.campaign === undefined
      ? await loadStudioBookingEmailCampaign(
          input.service,
          input.photographerId,
          input.eventId,
        )
      : input.campaign;
  const handledBookingIds = campaign
    ? await loadHandledStudioBookingIds(
        input.service,
        input.photographerId,
        input.eventId,
        campaign.id,
      )
    : new Set<string>();
  const newRecipients = filterNewStudioBookingRecipients(
    recipientSummary.recipients,
    handledBookingIds,
  );
  const confirmedBookings = recipientSummary.recipients.reduce(
    (sum, recipient) => sum + recipient.bookings.length,
    0,
  );
  const newBookings = newRecipients.reduce(
    (sum, recipient) => sum + recipient.bookings.length,
    0,
  );

  return {
    campaign,
    recipientSummary,
    newRecipients,
    publicSummary: {
      saved: Boolean(campaign),
      id: campaign?.id ?? null,
      subject: campaign?.subject ?? null,
      savedAt: campaign?.savedAt ?? null,
      photoCount: campaign?.photoKeys.length ?? 0,
      newRecipients: newRecipients.length,
      newBookings,
      handledBookings: Math.max(0, confirmedBookings - newBookings),
      confirmedRecipients: recipientSummary.recipients.length,
      confirmedBookings,
      currentFingerprint: studioBookingRecipientFingerprint(
        recipientSummary.recipients,
      ),
      newFingerprint: studioBookingRecipientFingerprint(newRecipients),
    },
  };
}

async function loadAuthorizedContext(request: NextRequest, eventId: string) {
  if (!UUID_RE.test(eventId)) {
    return {
      ok: false as const,
      response: privateJson(
        { ok: false, message: "That booking event is not valid." },
        { status: 400 },
      ),
    };
  }

  const { user } = await resolveDashboardAuth(request);
  if (!user) {
    return {
      ok: false as const,
      response: privateJson(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      ),
    };
  }

  const service = createDashboardServiceClient();
  const photographer = await getOrCreatePhotographerByUser(service, user);
  if (!photographer.is_platform_admin) {
    return {
      ok: false as const,
      response: privateJson(
        {
          ok: false,
          message: "Only the Studio OS Cloud owner can manage booking email campaigns.",
        },
        { status: 403 },
      ),
    };
  }

  const detail = await loadStudioBookingDetail(service, photographer.id, eventId);
  if (!detail) {
    return {
      ok: false as const,
      response: privateJson(
        { ok: false, message: "Booking event not found." },
        { status: 404 },
      ),
    };
  }

  return { ok: true as const, user, service, photographer, detail };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  try {
    const { eventId } = await context.params;
    const authorized = await loadAuthorizedContext(request, eventId);
    if (!authorized.ok) return authorized.response;

    const state = await campaignState({
      service: authorized.service,
      photographerId: authorized.photographer.id,
      eventId,
      detail: authorized.detail,
    });
    return privateJson({ ok: true, campaign: state.publicSummary });
  } catch (error) {
    console.error("[studio-bookings:email-campaign:get]", error);
    return privateJson(
      { ok: false, message: "The saved booking email campaign could not be loaded." },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  try {
    const { eventId } = await context.params;
    const authorized = await loadAuthorizedContext(request, eventId);
    if (!authorized.ok) return authorized.response;

    const parsed = await parseJson(request, CampaignActionSchema);
    if (!parsed.ok) return parsed.response;

    const agreement = await guardAgreement({
      service: authorized.service,
      userId: authorized.user.id,
    });
    if (!agreement.ok) {
      return privateJson(agreement.body, { status: agreement.status });
    }

    const currentState = await campaignState({
      service: authorized.service,
      photographerId: authorized.photographer.id,
      eventId,
      detail: authorized.detail,
    });

    if (parsed.data.action === "save-baseline") {
      if (
        parsed.data.recipientFingerprint !==
        currentState.publicSummary.currentFingerprint
      ) {
        return privateJson(
          {
            ok: false,
            message:
              "The confirmed booking list changed. Refresh the event before saving the baseline.",
            campaign: currentState.publicSummary,
          },
          { status: 409 },
        );
      }

      const attachments: Awaited<
        ReturnType<typeof prepareStudioBookingDirectionPhoto>
      >[] = [];
      try {
        for (let index = 0; index < parsed.data.photos.length; index += 1) {
          attachments.push(
            await prepareStudioBookingDirectionPhoto(parsed.data.photos[index], index),
          );
        }
      } catch (error) {
        if (error instanceof InvalidStudioBookingDirectionPhotoError) {
          return privateJson(
            { ok: false, message: error.message },
            { status: 400 },
          );
        }
        throw error;
      }

      const baselineLimit = await rateLimit(
        `${authorized.photographer.id}:${eventId}`,
        {
          namespace: "studio-booking-email-campaign-baseline",
          limit: 6,
          windowSeconds: 3_600,
        },
      );
      if (!baselineLimit.allowed) {
        const retryAfter = Math.max(
          1,
          Math.ceil((baselineLimit.resetAt - Date.now()) / 1_000),
        );
        return privateJson(
          {
            ok: false,
            message:
              "The reusable message was saved too many times recently. Try again later.",
            campaign: currentState.publicSummary,
          },
          { status: 429, headers: { "Retry-After": String(retryAfter) } },
        );
      }

      let savedCampaign: Campaign;
      try {
        savedCampaign = await saveStudioBookingEmailCampaign({
          service: authorized.service,
          photographerId: authorized.photographer.id,
          eventId,
          studioEmail: authorized.detail.studio.email,
          campaignId: parsed.data.saveId,
          copy: {
            subject: parsed.data.subject,
            headline: parsed.data.headline,
            message: parsed.data.message,
            location: parsed.data.location,
            address: parsed.data.address,
            directions: parsed.data.directions,
          },
          attachments,
        });
        await recordHandledStudioBookingRecipients({
          service: authorized.service,
          photographerId: authorized.photographer.id,
          eventId,
          campaign: savedCampaign,
          status: "baseline",
          recipients: currentState.recipientSummary.recipients.map((recipient) => ({
            recipient,
          })),
        });
      } catch (error) {
        console.error("[studio-bookings:email-campaign:baseline]", error);
        await pauseStudioBookingEmailCampaign(
          authorized.service,
          authorized.photographer.id,
          eventId,
        ).catch(() => undefined);
        return privateJson(
          {
            ok: false,
            message:
              "The reusable message or its booking baseline could not be saved. No emails were sent.",
          },
          { status: 503 },
        );
      }

      await recordAudit({
        request,
        actorUserId: authorized.user.id,
        actorPhotographerId: authorized.photographer.id,
        action: "studio_booking.email_campaign_baseline",
        entityType: "booking_event",
        entityId: eventId,
        targetPhotographerId: authorized.photographer.id,
        metadata: {
          campaign_id: savedCampaign.id,
          baseline_recipients: currentState.recipientSummary.recipients.length,
          baseline_bookings: currentState.publicSummary.confirmedBookings,
          direction_photo_count: attachments.length,
        },
        result: "ok",
      });

      const refreshedDetail =
        (await loadStudioBookingDetail(
          authorized.service,
          authorized.photographer.id,
          eventId,
        )) ?? authorized.detail;
      const refreshedState = await campaignState({
        service: authorized.service,
        photographerId: authorized.photographer.id,
        eventId,
        detail: refreshedDetail,
        campaign: savedCampaign,
      });
      return privateJson({
        ok: true,
        campaign: refreshedState.publicSummary,
        sent: 0,
        failed: 0,
        total: 0,
        message: "Saved the reusable message. Current confirmed bookings were recorded as the baseline; no emails were sent.",
      });
    }

    const campaign = currentState.campaign;
    if (!campaign || campaign.id !== parsed.data.campaignId) {
      return privateJson(
        {
          ok: false,
          message:
            "The saved campaign changed or is unavailable. Refresh before sending new bookings.",
          campaign: currentState.publicSummary,
        },
        { status: 409 },
      );
    }
    if (
      parsed.data.recipientFingerprint !== currentState.publicSummary.newFingerprint
    ) {
      return privateJson(
        {
          ok: false,
          message:
            "The new confirmed booking list changed. Refresh and review the updated count before sending.",
          campaign: currentState.publicSummary,
        },
        { status: 409 },
      );
    }
    if (!currentState.newRecipients.length) {
      return privateJson({
        ok: true,
        campaign: currentState.publicSummary,
        sent: 0,
        failed: 0,
        total: 0,
        message: "There are no new confirmed booking emails to send.",
      });
    }
    if (currentState.newRecipients.length > STUDIO_BOOKING_EMAIL_MAX_RECIPIENTS) {
      return privateJson(
        {
          ok: false,
          message: `New-bookings delivery supports up to ${STUDIO_BOOKING_EMAIL_MAX_RECIPIENTS} recipients at a time.`,
          campaign: currentState.publicSummary,
        },
        { status: 413 },
      );
    }
    if (!resendConfigured()) {
      return privateJson(
        { ok: false, message: "Branded email sending is not configured." },
        { status: 503 },
      );
    }

    let attachments: Awaited<
      ReturnType<typeof loadStudioBookingCampaignAttachments>
    >;
    try {
      attachments = await loadStudioBookingCampaignAttachments(campaign);
    } catch (error) {
      console.error("[studio-bookings:email-campaign:attachments]", error);
      return privateJson(
        {
          ok: false,
          message:
            "The saved direction photos could not be loaded. No emails were sent.",
          campaign: currentState.publicSummary,
        },
        { status: 503 },
      );
    }

    const sendDetail = await loadStudioBookingDetail(
      authorized.service,
      authorized.photographer.id,
      eventId,
    );
    if (!sendDetail) {
      return privateJson(
        { ok: false, message: "Booking event not found." },
        { status: 404 },
      );
    }
    const sendState = await campaignState({
      service: authorized.service,
      photographerId: authorized.photographer.id,
      eventId,
      detail: sendDetail,
    });
    const sendCampaign = sendState.campaign;
    if (
      !sendCampaign ||
      sendCampaign.id !== campaign.id ||
      sendCampaign.savedAt !== campaign.savedAt ||
      sendState.publicSummary.newFingerprint !== parsed.data.recipientFingerprint
    ) {
      return privateJson(
        {
          ok: false,
          message:
            "The saved campaign or new confirmed booking list changed while the message was prepared. Refresh and try again.",
          campaign: sendState.publicSummary,
        },
        { status: 409 },
      );
    }
    if (sendState.newRecipients.length > STUDIO_BOOKING_EMAIL_MAX_RECIPIENTS) {
      return privateJson(
        {
          ok: false,
          message: `New-bookings delivery supports up to ${STUDIO_BOOKING_EMAIL_MAX_RECIPIENTS} recipients at a time.`,
          campaign: sendState.publicSummary,
        },
        { status: 413 },
      );
    }

    const campaignLimit = await rateLimit(
      `${authorized.photographer.id}:${eventId}`,
      {
        namespace: "studio-booking-email-campaign",
        limit: 1,
        windowSeconds: 60,
      },
    );
    if (!campaignLimit.allowed) {
      const retryAfter = Math.max(
        1,
        Math.ceil((campaignLimit.resetAt - Date.now()) / 1_000),
      );
      return privateJson(
        {
          ok: false,
          message: `An email campaign for this event was just started. Wait ${retryAfter} seconds before trying again.`,
          campaign: sendState.publicSummary,
        },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }

    const emailDetail = {
      event: sendDetail.event,
      studio: sendDetail.studio,
      schedule: sendDetail.schedule,
      slots: sendDetail.slots,
    };
    let sent = 0;
    let failed = 0;
    let attempted = 0;
    let trackingFailed = false;

    for (
      let offset = 0;
      offset < sendState.newRecipients.length;
      offset += SEND_CONCURRENCY
    ) {
      const group = sendState.newRecipients.slice(
        offset,
        offset + SEND_CONCURRENCY,
      );
      attempted += group.length;
      const results = await Promise.allSettled(
        group.map((recipient) => {
          const document = buildStudioBookingEmailDocument({
            detail: emailDetail,
            recipient,
            headline: sendCampaign.headline,
            message: sendCampaign.message,
            location: sendCampaign.location,
            address: sendCampaign.address,
            directions: sendCampaign.directions,
            directionPhotoContentIds: attachments.map(
              (attachment) => attachment.contentId,
            ),
          });
          return sendStudioBookingEmailWithRetry({
            to: recipient.email,
            subject: sendCampaign.subject,
            html: document.html,
            text: document.text,
            fromName: sendDetail.studio.businessName,
            replyTo: sendDetail.studio.email,
            attachments,
            tags: [
              { name: "type", value: "booking-campaign-new" },
              { name: "event_id", value: eventId },
              { name: "audience", value: "parent" },
            ],
            idempotencyKey: studioBookingCampaignDeliveryKey(
              sendCampaign,
              recipient,
            ),
          });
        }),
      );

      const handledRecipients: Array<{
        recipient: (typeof sendState.newRecipients)[number];
        resendEmailId?: string | null;
      }> = [];
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        if (result.status === "fulfilled") {
          sent += 1;
          handledRecipients.push({
            recipient: group[index],
            resendEmailId: result.value.id,
          });
        } else {
          failed += 1;
        }
      }

      if (handledRecipients.length) {
        try {
          await recordHandledStudioBookingRecipients({
            service: authorized.service,
            photographerId: authorized.photographer.id,
            eventId,
            campaign: sendCampaign,
            status: "sent",
            recipients: handledRecipients,
          });
        } catch (error) {
          trackingFailed = true;
          console.error("[studio-bookings:email-campaign:tracking]", error);
          break;
        }
      }

      if (offset + SEND_CONCURRENCY < sendState.newRecipients.length) {
        await waitForStudioBookingEmail(1_050);
      }
    }

    await recordAudit({
      request,
      actorUserId: authorized.user.id,
      actorPhotographerId: authorized.photographer.id,
      action: "studio_booking.email_campaign_send_new",
      entityType: "booking_event",
      entityId: eventId,
      targetPhotographerId: authorized.photographer.id,
      metadata: {
        campaign_id: sendCampaign.id,
        parent_sent: sent,
        parent_failed: failed,
        parent_unattempted: Math.max(
          0,
          sendState.newRecipients.length - attempted,
        ),
        booking_count: sendState.publicSummary.newBookings,
        direction_photo_count: attachments.length,
        campaign_tracking_failed: trackingFailed,
      },
      result: failed === 0 && !trackingFailed ? "ok" : "error",
      errorMessage: trackingFailed
        ? "Booking campaign delivery tracking failed."
        : failed
          ? `${failed} new-booking email deliveries failed.`
          : null,
    });

    const refreshedDetail =
      (await loadStudioBookingDetail(
        authorized.service,
        authorized.photographer.id,
        eventId,
      )) ?? sendDetail;
    const refreshedState = await campaignState({
      service: authorized.service,
      photographerId: authorized.photographer.id,
      eventId,
      detail: refreshedDetail,
    });
    const unattempted = Math.max(
      0,
      sendState.newRecipients.length - attempted,
    );
    const message = trackingFailed
      ? `Sent ${sent} new-booking email${sent === 1 ? "" : "s"}, but delivery tracking could not be saved. Retry the remaining new bookings with the same stable delivery keys.`
      : failed
        ? `Sent ${sent}; ${failed} could not be delivered and remain eligible to retry.`
        : `Sent ${sent} new-booking email${sent === 1 ? "" : "s"}.`;

    return privateJson(
      {
        ok: failed === 0 && !trackingFailed,
        campaign: refreshedState.publicSummary,
        sent,
        failed,
        total: sendState.newRecipients.length,
        unattempted,
        trackingFailed,
        message,
      },
      trackingFailed || (failed > 0 && sent === 0)
        ? { status: trackingFailed ? 503 : 502 }
        : undefined,
    );
  } catch (error) {
    console.error("[studio-bookings:email-campaign:post]", error);
    return privateJson(
      {
        ok: false,
        message:
          "The booking email campaign request could not be completed. No booking data was changed.",
      },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";
import {
  buildSchoolShareEmail,
  eventFromName,
  eventReplyTo,
} from "@/lib/event-gallery-email";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";
import { recordProjectEmailDelivery } from "@/lib/project-email-deliveries";
import { resendConfigured, sendResendEmail } from "@/lib/resend";
import { collectSchoolRecipientEmails } from "@/lib/school-email-recipients";
import { guardAgreement } from "@/lib/require-agreement";

export const dynamic = "force-dynamic";

const SendCampaignBodySchema = z.object({
  recipientMode: z.enum(["visitors", "others"]).optional(),
  recipients: z.union([z.array(z.string().max(320)), z.string().max(20_000)]).optional(),
  subject: z.string().max(500).optional(),
  headline: z.string().max(500).optional(),
  buttonLabel: z.string().max(200).optional(),
  message: z.string().max(10_000).optional(),
});

type SendCampaignBody = z.infer<typeof SendCampaignBodySchema>;

type SchoolRow = {
  id: string;
  school_name: string | null;
  access_mode?: string | null;
  access_pin?: string | null;
  email_required?: boolean | null;
  cover_photo_url?: string | null;
  gallery_settings?: unknown;
  photographer_id?: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function looksLikeEmail(value: string | null | undefined) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

function parseRecipients(value: string[] | string | undefined) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => clean(entry).toLowerCase())
      .filter(looksLikeEmail);
  }
  return clean(value)
    .split(",")
    .map((entry) => clean(entry).toLowerCase())
    .filter(looksLikeEmail);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ schoolId: string }> },
) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    if (!resendConfigured()) {
      return NextResponse.json(
        { ok: false, message: "Resend is not configured on the server yet." },
        { status: 500 },
      );
    }

    const { schoolId } = await context.params;
    const parsed = await parseJson(request, SendCampaignBodySchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const service = createDashboardServiceClient();

    // Agreement gate — refuse to act for users who haven't accepted the
    // Studio OS Cloud legal agreement. Defense in depth behind the client
    // modal. Same pattern as upload-to-r2 / generate-thumbnails.
    {
      const guard = await guardAgreement({ service, userId: user.id });
      if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });
    }

    const { data: photographerRow, error: photographerError } = await service
      .from("photographers")
      .select("id,business_name,studio_email")
      .eq("user_id", user.id)
      .maybeSingle();

    if (photographerError) throw photographerError;
    if (!photographerRow?.id) {
      return NextResponse.json(
        { ok: false, message: "Photographer profile not found." },
        { status: 404 },
      );
    }

    const { data: schoolRow, error: schoolError } = await service
      .from("schools")
      .select("id,school_name,access_mode,access_pin,email_required,cover_photo_url,gallery_settings,photographer_id")
      .eq("id", schoolId)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle<SchoolRow>();

    if (schoolError) throw schoolError;
    if (!schoolRow?.id) {
      return NextResponse.json(
        { ok: false, message: "School not found." },
        { status: 404 },
      );
    }

    const recipients =
      body.recipientMode === "others"
        ? parseRecipients(body.recipients)
        : await collectSchoolRecipientEmails(service, schoolId);

    if (!recipients.length) {
      return NextResponse.json(
        { ok: false, message: "No valid recipient emails were found." },
        { status: 400 },
      );
    }

    const gallerySettings = normalizeEventGallerySettings(schoolRow.gallery_settings);
    const email = buildSchoolShareEmail({
      school: schoolRow,
      photographer: photographerRow,
      share: {
        emailSubject: clean(body.subject) || gallerySettings.share.emailSubject,
        emailHeadline: clean(body.headline) || gallerySettings.share.emailHeadline,
        emailButtonLabel: clean(body.buttonLabel) || gallerySettings.share.emailButtonLabel,
        emailMessage: clean(body.message) || gallerySettings.share.emailMessage,
      },
      origin: new URL(request.url).origin,
    });

    let sent = 0;
    let failed = 0;
    const failedRecipients: string[] = [];

    for (const recipientEmail of recipients) {
      try {
        const sendResult = await sendResendEmail({
          to: recipientEmail,
          subject: email.subject,
          html: email.html,
          text: email.text,
          fromName: eventFromName(photographerRow),
          replyTo: eventReplyTo(photographerRow),
          idempotencyKey: `school-campaign:${schoolId}:${recipientEmail}:${crypto.randomUUID()}`,
          tags: [
            { name: "type", value: "campaign" },
            { name: "school_id", value: schoolId },
          ],
        });

        await recordProjectEmailDelivery(service, {
          photographerId: photographerRow.id,
          recipientEmail,
          emailType: "campaign",
          resendEmailId: sendResult.id,
          subject: email.subject,
          status: "sent",
          payload: {
            schoolId,
            recipientMode: body.recipientMode || "visitors",
          },
        });
        sent += 1;
      } catch (error) {
        failed += 1;
        failedRecipients.push(recipientEmail);
        await recordProjectEmailDelivery(service, {
          photographerId: photographerRow.id,
          recipientEmail,
          emailType: "campaign",
          subject: email.subject,
          status: "failed",
          payload: {
            schoolId,
            recipientMode: body.recipientMode || "visitors",
          },
          errorMessage:
            error instanceof Error ? error.message : "Failed to send school campaign email.",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      sent,
      failed,
      recipients: recipients.length,
      failedRecipients,
    });
  } catch (error) {
    console.error("[dashboard:schools:emails]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to send school campaign emails." },
      { status: 500 },
    );
  }
}

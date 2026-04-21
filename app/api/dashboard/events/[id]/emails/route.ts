import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import {
  buildGalleryShareEmail,
  eventFromName,
  eventReplyTo,
} from "@/lib/event-gallery-email";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";
import { recordProjectEmailDelivery } from "@/lib/project-email-deliveries";
import { resendConfigured, sendResendEmail } from "@/lib/resend";

export const dynamic = "force-dynamic";

type SendCampaignBody = {
  recipientMode?: "visitors" | "others";
  recipients?: string[] | string;
  subject?: string;
  headline?: string;
  buttonLabel?: string;
  message?: string;
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
  context: { params: Promise<{ id: string }> },
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

    const { id: projectId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as SendCampaignBody;
    const service = createDashboardServiceClient();

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

    const { data: projectRow, error: projectError } = await service
      .from("projects")
      .select("id,title,client_name,access_mode,access_pin,email_required,cover_photo_url,gallery_settings,photographer_id")
      .eq("id", projectId)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle();

    if (projectError) throw projectError;
    if (!projectRow?.id) {
      return NextResponse.json(
        { ok: false, message: "Project not found." },
        { status: 404 },
      );
    }

    let recipients: string[] = [];
    if (body.recipientMode === "others") {
      recipients = parseRecipients(body.recipients);
    } else {
      const [visitorsResult, preReleaseResult, favoritesResult] = await Promise.all([
        service
          .from("event_gallery_visitors")
          .select("viewer_email")
          .eq("project_id", projectId),
        service
          .from("pre_release_emails")
          .select("email")
          .eq("project_id", projectId),
        service
          .from("event_gallery_favorites")
          .select("viewer_email")
          .eq("project_id", projectId),
      ]);

      if (visitorsResult.error && visitorsResult.error.code !== "42P01") throw visitorsResult.error;
      if (preReleaseResult.error) throw preReleaseResult.error;
      if (favoritesResult.error && favoritesResult.error.code !== "42P01") throw favoritesResult.error;

      recipients = Array.from(
        new Set(
          [
            ...(visitorsResult.data ?? []).map((row) =>
              clean((row as { viewer_email?: string | null }).viewer_email).toLowerCase(),
            ),
            ...(preReleaseResult.data ?? []).map((row) =>
              clean((row as { email?: string | null }).email).toLowerCase(),
            ),
            ...(favoritesResult.data ?? []).map((row) =>
              clean((row as { viewer_email?: string | null }).viewer_email).toLowerCase(),
            ),
          ].filter(looksLikeEmail),
        ),
      );
    }

    if (!recipients.length) {
      return NextResponse.json(
        { ok: false, message: "No valid recipient emails were found." },
        { status: 400 },
      );
    }

    const gallerySettings = normalizeEventGallerySettings(projectRow.gallery_settings);
    const email = buildGalleryShareEmail({
      project: projectRow,
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
      const dedupeSeed = `campaign:${projectId}:${recipientEmail}:${crypto.randomUUID()}`;
      try {
        const sendResult = await sendResendEmail({
          to: recipientEmail,
          subject: email.subject,
          html: email.html,
          text: email.text,
          fromName: eventFromName(photographerRow),
          replyTo: eventReplyTo(photographerRow),
          idempotencyKey: dedupeSeed,
          tags: [
            { name: "type", value: "campaign" },
            { name: "project_id", value: projectId },
          ],
        });

        await recordProjectEmailDelivery(service, {
          projectId,
          photographerId: photographerRow.id,
          recipientEmail,
          emailType: "campaign",
          resendEmailId: sendResult.id,
          subject: email.subject,
          status: "sent",
          payload: {
            recipientMode: body.recipientMode || "visitors",
          },
        });
        sent += 1;
      } catch (error) {
        failed += 1;
        failedRecipients.push(recipientEmail);
        await recordProjectEmailDelivery(service, {
          projectId,
          photographerId: photographerRow.id,
          recipientEmail,
          emailType: "campaign",
          subject: email.subject,
          status: "failed",
          payload: {
            recipientMode: body.recipientMode || "visitors",
          },
          errorMessage:
            error instanceof Error ? error.message : "Failed to send campaign email.",
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
    console.error("[dashboard:events:emails]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to send campaign emails." },
      { status: 500 },
    );
  }
}

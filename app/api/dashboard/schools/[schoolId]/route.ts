import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import {
  buildSchoolShareEmail,
  eventFromName,
  eventReplyTo,
} from "@/lib/event-gallery-email";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";
import {
  hasProjectEmailDelivery,
  recordProjectEmailDelivery,
} from "@/lib/project-email-deliveries";
import { resendConfigured, sendResendEmail } from "@/lib/resend";
import { collectSchoolRecipientEmails } from "@/lib/school-email-recipients";
import { ensurePackageProfile } from "@/lib/ensure-package-profile";

export const dynamic = "force-dynamic";

type SchoolUpdateBody = {
  school_name?: string | null;
  name?: string | null;
  portal_status?: string | null;
  status?: string | null;
  shoot_date?: string | null;
  order_due_date?: string | null;
  expiration_date?: string | null;
  package_profile_id?: string | null;
  email_required?: boolean;
  checkout_contact_required?: boolean;
  internal_notes?: string | null;
  access_mode?: string | null;
  access_pin?: string | null;
  gallery_settings?: unknown;
};

type SchoolRow = {
  id: string;
  school_name: string | null;
  photographer_id: string | null;
  local_school_id?: string | null;
  status?: string | null;
  shoot_date?: string | null;
  order_due_date?: string | null;
  expiration_date?: string | null;
  package_profile_id?: string | null;
  email_required?: boolean | null;
  checkout_contact_required?: boolean | null;
  internal_notes?: string | null;
  access_mode?: string | null;
  access_pin?: string | null;
  cover_photo_url?: string | null;
  gallery_settings?: unknown;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function hasOwn<T extends object>(value: T, key: keyof SchoolUpdateBody) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isLivePortalStatus(value: string | null | undefined) {
  const normalized = clean(value).toLowerCase();
  return normalized === "active" || normalized === "public" || normalized === "live" || normalized === "open";
}

async function sendSchoolCampaignEmails(params: {
  service: ReturnType<typeof createDashboardServiceClient>;
  school: SchoolRow;
  photographer: {
    id: string;
    business_name?: string | null;
    studio_email?: string | null;
  };
  origin: string;
  emailType: "campaign" | "gallery_release";
}) {
  const recipients = await collectSchoolRecipientEmails(params.service, params.school.id);

  if (!recipients.length) {
    return {
      attempted: 0,
      sent: 0,
      failed: 0,
      warning: null as string | null,
    };
  }

  if (!resendConfigured()) {
    return {
      attempted: recipients.length,
      sent: 0,
      failed: 0,
      warning: "RESEND_API_KEY is not configured on the server.",
    };
  }

  const gallerySettings = normalizeEventGallerySettings(params.school.gallery_settings);
  const school = {
    id: params.school.id,
    school_name: params.school.school_name,
    access_mode: params.school.access_mode,
    access_pin: params.school.access_pin,
    email_required: params.school.email_required,
    cover_photo_url: params.school.cover_photo_url,
  };

  let sent = 0;
  let failed = 0;

  for (const recipientEmail of recipients) {
    const dedupeKey = `${params.emailType}:${params.school.id}:${recipientEmail}`;
    if (await hasProjectEmailDelivery(params.service, dedupeKey)) {
      continue;
    }

    const email = buildSchoolShareEmail({
      school,
      photographer: params.photographer,
      share: gallerySettings.share,
      origin: params.origin,
      previewText:
        params.emailType === "gallery_release"
          ? `${clean(params.school.school_name) || "Your gallery"} is now live.`
          : `A gallery update from ${clean(params.photographer.business_name) || "your photographer"}.`,
      overrideSubject:
        params.emailType === "gallery_release"
          ? clean(gallerySettings.share.emailSubject) ||
            `${clean(params.school.school_name) || "Your gallery"} is ready`
          : undefined,
    });

    try {
      const sendResult = await sendResendEmail({
        to: recipientEmail,
        subject: email.subject,
        html: email.html,
        text: email.text,
        fromName: eventFromName(params.photographer),
        replyTo: eventReplyTo(params.photographer),
        idempotencyKey: dedupeKey,
        tags: [
          { name: "type", value: params.emailType },
          { name: "school_id", value: params.school.id },
        ],
      });

      await recordProjectEmailDelivery(params.service, {
        photographerId: params.photographer.id,
        recipientEmail,
        emailType: params.emailType,
        dedupeKey,
        resendEmailId: sendResult.id,
        subject: email.subject,
        status: "sent",
        payload: {
          schoolId: params.school.id,
          source: "school_settings_save",
        },
      });

      sent += 1;
    } catch (error) {
      failed += 1;
      await recordProjectEmailDelivery(params.service, {
        photographerId: params.photographer.id,
        recipientEmail,
        emailType: params.emailType,
        dedupeKey,
        subject: email.subject,
        status: "failed",
        payload: {
          schoolId: params.school.id,
          source: "school_settings_save",
        },
        errorMessage:
          error instanceof Error ? error.message : "Failed to send school gallery email.",
      });
    }
  }

  return {
    attempted: recipients.length,
    sent,
    failed,
    warning: null as string | null,
  };
}

export async function PATCH(
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

    const { schoolId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as SchoolUpdateBody;
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

    const { data: schoolRow, error: schoolError } = await service
      .from("schools")
      .select("id,school_name,photographer_id,local_school_id,status,shoot_date,order_due_date,expiration_date,package_profile_id,email_required,checkout_contact_required,internal_notes,access_mode,access_pin,cover_photo_url,gallery_settings")
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

    const updates: Record<string, unknown> = {};

    if (hasOwn(body, "school_name") || hasOwn(body, "name")) {
      updates.school_name = clean(body.school_name || body.name) || null;
    }

    if (hasOwn(body, "portal_status") || hasOwn(body, "status")) {
      const nextStatus = clean(body.portal_status || body.status) || null;
      updates.status = nextStatus;
    }

    if (hasOwn(body, "shoot_date")) updates.shoot_date = clean(body.shoot_date) || null;
    if (hasOwn(body, "order_due_date")) updates.order_due_date = clean(body.order_due_date) || null;
    if (hasOwn(body, "expiration_date")) updates.expiration_date = clean(body.expiration_date) || null;
    if (hasOwn(body, "package_profile_id")) {
      updates.package_profile_id = await ensurePackageProfile({
        service,
        photographerId: photographerRow.id,
        packageProfileId: body.package_profile_id,
      });
    }
    updates.email_required = true;
    if (hasOwn(body, "checkout_contact_required")) updates.checkout_contact_required = body.checkout_contact_required === true;
    if (hasOwn(body, "internal_notes")) updates.internal_notes = clean(body.internal_notes) || null;
    if (hasOwn(body, "gallery_settings")) {
      updates.gallery_settings = normalizeEventGallerySettings(body.gallery_settings);
    }

    if (!Object.keys(updates).length) {
      return NextResponse.json({ ok: true, school: schoolRow });
    }

    const previousStatus = clean(schoolRow.status);
    const previousSettings = normalizeEventGallerySettings(schoolRow.gallery_settings);

    const { data: updatedSchoolRow, error: updateError } = await service
      .from("schools")
      .update(updates)
      .eq("id", schoolId)
      .eq("photographer_id", photographerRow.id)
      .select("id,school_name,photographer_id,local_school_id,status,shoot_date,order_due_date,expiration_date,package_profile_id,email_required,checkout_contact_required,internal_notes,access_mode,access_pin,cover_photo_url,gallery_settings")
      .maybeSingle<SchoolRow>();

    if (updateError) throw updateError;
    if (!updatedSchoolRow?.id) {
      return NextResponse.json(
        { ok: false, message: "School not found after save." },
        { status: 404 },
      );
    }

    const nextStatus = clean(updatedSchoolRow.status);
    const nextSettings = normalizeEventGallerySettings(updatedSchoolRow.gallery_settings);
    const becameLive = !isLivePortalStatus(previousStatus) && isLivePortalStatus(nextStatus);
    const campaignTurnedOn =
      !previousSettings.extras.sendEmailCampaign &&
      nextSettings.extras.sendEmailCampaign &&
      isLivePortalStatus(nextStatus);

    let emailSummary:
      | {
          attempted: number;
          sent: number;
          failed: number;
          warning: string | null;
          type: "campaign" | "gallery_release";
        }
      | null = null;

    if (becameLive || campaignTurnedOn) {
      const emailType: "campaign" | "gallery_release" = becameLive ? "gallery_release" : "campaign";
      const summary = await sendSchoolCampaignEmails({
        service,
        school: updatedSchoolRow,
        photographer: photographerRow,
        origin: new URL(request.url).origin,
        emailType,
      });
      emailSummary = {
        ...summary,
        type: emailType,
      };
    }

    return NextResponse.json({
      ok: true,
      school: updatedSchoolRow,
      emailSummary,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Failed to save school settings.",
      },
      { status: 500 },
    );
  }
}

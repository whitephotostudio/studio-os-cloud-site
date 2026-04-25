import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";
import { recordAudit, diffFields } from "@/lib/audit";
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
import { guardAgreement } from "@/lib/require-agreement";

export const dynamic = "force-dynamic";

const SchoolUpdateBodySchema = z.object({
  school_name: z.string().max(500).nullable().optional(),
  name: z.string().max(500).nullable().optional(),
  portal_status: z.string().max(64).nullable().optional(),
  status: z.string().max(64).nullable().optional(),
  shoot_date: z.string().max(64).nullable().optional(),
  order_due_date: z.string().max(64).nullable().optional(),
  expiration_date: z.string().max(64).nullable().optional(),
  archive_date: z.string().max(64).nullable().optional(),
  package_profile_id: z.string().max(128).nullable().optional(),
  email_required: z.boolean().optional(),
  checkout_contact_required: z.boolean().optional(),
  internal_notes: z.string().max(10_000).nullable().optional(),
  access_mode: z.string().max(64).nullable().optional(),
  access_pin: z.string().max(64).nullable().optional(),
  gallery_settings: z.unknown().optional(),
  gallery_slug: z.string().max(200).nullable().optional(),
  // Screenshot protection flags — all default false in the DB.
  screenshot_protection_desktop: z.boolean().optional(),
  screenshot_protection_mobile: z.boolean().optional(),
  screenshot_protection_watermark: z.boolean().optional(),
  // 2026-04-26: per-school configurable grouping label (Class / Faculty
  // / Grade / Department).  Defaults to Class / Classes — see migration
  // 20260425020000_add_schools_group_label.sql.
  group_label_singular: z.string().min(1).max(64).optional(),
  group_label_plural: z.string().min(1).max(64).optional(),
});

type SchoolUpdateBody = z.infer<typeof SchoolUpdateBodySchema>;

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
  gallery_slug?: string | null;
  screenshot_protection_desktop?: boolean | null;
  screenshot_protection_mobile?: boolean | null;
  screenshot_protection_watermark?: boolean | null;
  group_label_singular?: string | null;
  group_label_plural?: string | null;
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
    const parsed = await parseJson(request, SchoolUpdateBodySchema);
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
      .select("id,school_name,photographer_id,local_school_id,status,shoot_date,order_due_date,expiration_date,package_profile_id,email_required,checkout_contact_required,internal_notes,access_mode,access_pin,cover_photo_url,gallery_settings,gallery_slug,screenshot_protection_desktop,screenshot_protection_mobile,screenshot_protection_watermark,group_label_singular,group_label_plural")
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
      // schools.portal_status is a GENERATED column (always = status) — writing
      // to it directly throws "column portal_status can only be updated to
      // DEFAULT". Writing status alone keeps both columns in sync automatically.
      updates.status = nextStatus;
    }

    if (hasOwn(body, "shoot_date")) updates.shoot_date = clean(body.shoot_date) || null;
    if (hasOwn(body, "order_due_date")) updates.order_due_date = clean(body.order_due_date) || null;
    if (hasOwn(body, "archive_date")) updates.archive_date = clean(body.archive_date) || null;
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
    // Screenshot protection flags — coerce to strict booleans so any
    // truthy-string or null from a buggy client still stores as false.
    if (hasOwn(body, "screenshot_protection_desktop")) {
      updates.screenshot_protection_desktop = body.screenshot_protection_desktop === true;
    }
    if (hasOwn(body, "screenshot_protection_mobile")) {
      updates.screenshot_protection_mobile = body.screenshot_protection_mobile === true;
    }
    if (hasOwn(body, "screenshot_protection_watermark")) {
      updates.screenshot_protection_watermark = body.screenshot_protection_watermark === true;
    }
    // Per-school grouping label — trim, fall back to default if empty.
    if (hasOwn(body, "group_label_singular")) {
      const v = clean(body.group_label_singular);
      updates.group_label_singular = v || "Class";
    }
    if (hasOwn(body, "group_label_plural")) {
      const v = clean(body.group_label_plural);
      updates.group_label_plural = v || "Classes";
    }
    if (hasOwn(body, "gallery_slug")) {
      let rawSlug = clean(body.gallery_slug)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (rawSlug) {
        // Check uniqueness across projects and schools (excluding this school)
        let candidate = rawSlug;
        let suffix = 1;
        for (let attempts = 0; attempts < 10; attempts++) {
          const [{ data: pMatch }, { data: sMatch }] = await Promise.all([
            service.from("projects").select("id").eq("gallery_slug", candidate).maybeSingle(),
            service.from("schools").select("id").eq("gallery_slug", candidate).neq("id", schoolId).maybeSingle(),
          ]);
          if (!pMatch && !sMatch) break;
          suffix += 1;
          candidate = `${rawSlug}-${suffix}`;
        }
        updates.gallery_slug = candidate;
      } else {
        updates.gallery_slug = null;
      }
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
      .select("id,school_name,photographer_id,local_school_id,status,shoot_date,order_due_date,expiration_date,package_profile_id,email_required,checkout_contact_required,internal_notes,access_mode,access_pin,cover_photo_url,gallery_settings,gallery_slug,screenshot_protection_desktop,screenshot_protection_mobile,screenshot_protection_watermark,group_label_singular,group_label_plural")
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

    const auditDiff = diffFields(
      schoolRow as Record<string, unknown>,
      updatedSchoolRow as Record<string, unknown>,
      [
        "school_name",
        "status",
        "shoot_date",
        "order_due_date",
        "expiration_date",
        "package_profile_id",
        "email_required",
        "checkout_contact_required",
        "internal_notes",
        "gallery_slug",
        "screenshot_protection_desktop",
        "screenshot_protection_mobile",
        "screenshot_protection_watermark",
        "group_label_singular",
        "group_label_plural",
      ] as (keyof Record<string, unknown>)[],
    );
    await recordAudit({
      request,
      actorUserId: user.id,
      actorPhotographerId: photographerRow.id,
      action: "school.update",
      entityType: "school",
      entityId: schoolId,
      targetPhotographerId: photographerRow.id,
      before: auditDiff.before,
      after: auditDiff.after,
      metadata: {
        emailsSent: emailSummary?.sent ?? 0,
        emailType: emailSummary?.type ?? null,
      },
      result: "ok",
    });

    return NextResponse.json({
      ok: true,
      school: updatedSchoolRow,
      emailSummary,
    });
  } catch (error) {
    console.error("[dashboard:schools:PATCH]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to save school settings." },
      { status: 500 },
    );
  }
}

/* ------------------------------------------------------------------ */
/*  DELETE /api/dashboard/schools/[schoolId]                            */
/* ------------------------------------------------------------------ */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ schoolId: string }> },
) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json({ ok: false, message: "Please sign in again." }, { status: 401 });
    }

    const { schoolId } = await context.params;
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
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (photographerError) throw photographerError;
    if (!photographerRow?.id) {
      return NextResponse.json({ ok: false, message: "Photographer profile not found." }, { status: 404 });
    }

    // Verify the school belongs to the photographer
    const { data: schoolRow, error: schoolError } = await service
      .from("schools")
      .select("id,school_name")
      .eq("id", schoolId)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle();

    if (schoolError) throw schoolError;
    if (!schoolRow) {
      return NextResponse.json({ ok: false, message: "School not found." }, { status: 404 });
    }

    // Count students about to be cascade-deleted so the audit row captures scope.
    const { count: studentCount } = await service
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("school_id", schoolId);

    // Delete students first, then the school
    await service.from("students").delete().eq("school_id", schoolId);

    const { error: deleteError } = await service
      .from("schools")
      .delete()
      .eq("id", schoolId)
      .eq("photographer_id", photographerRow.id);

    if (deleteError) throw deleteError;

    await recordAudit({
      request,
      actorUserId: user.id,
      actorPhotographerId: photographerRow.id,
      action: "school.delete",
      entityType: "school",
      entityId: schoolId,
      targetPhotographerId: photographerRow.id,
      before: { school_name: schoolRow.school_name },
      metadata: { studentsDeleted: studentCount ?? 0 },
      result: "ok",
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/dashboard/schools/[schoolId]]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to delete school." },
      { status: 500 },
    );
  }
}

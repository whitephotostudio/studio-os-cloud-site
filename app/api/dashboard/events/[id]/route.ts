import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";
import {
  buildGalleryShareEmail,
  eventFromName,
  eventReplyTo,
} from "@/lib/event-gallery-email";
import {
  hasProjectEmailDelivery,
  recordProjectEmailDelivery,
} from "@/lib/project-email-deliveries";
import { resendConfigured, sendResendEmail } from "@/lib/resend";
import { ensurePackageProfile } from "@/lib/ensure-package-profile";
import { buildStoredMediaUrls } from "@/lib/storage-images";
import { r2DeletePrefix } from "@/lib/r2";

export const dynamic = "force-dynamic";

type StudentRow = {
  id: string;
  class_name: string | null;
  role: string | null;
};

type ProjectUpdateBody = {
  cover_photo_url?: string | null;
  cover_focal_x?: number;
  cover_focal_y?: number;
  project_name?: string | null;
  name?: string | null;
  title?: string | null;
  portal_status?: string | null;
  shoot_date?: string | null;
  order_due_date?: string | null;
  expiration_date?: string | null;
  package_profile_id?: string | null;
  email_required?: boolean;
  checkout_contact_required?: boolean;
  internal_notes?: string | null;
  access_mode?: string | null;
  access_pin?: string | null;
  access_updated_at?: string | null;
  access_updated_source?: string | null;
  gallery_settings?: unknown;
  gallery_slug?: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: unknown): boolean {
  return typeof value === "string" && UUID_RE.test(value);
}

function normalizeRole(rawRole: string | null | undefined): string {
  const role = clean(rawRole).toLowerCase();
  if (!role) return "Unassigned";
  if (role === "student" || role === "students") return "Student";
  if (role === "teacher" || role === "teachers") return "Teacher";
  if (role === "coach" || role === "coaches") return "Coach";
  if (["principal", "head principal", "school principal"].includes(role)) return "Principal";
  if (["office", "office staff", "admin", "administrator", "administration", "front office"].includes(role)) return "Office Staff";
  if (["staff", "faculty", "employee", "employees", "support staff", "school staff"].includes(role)) return "Staff";
  return clean(rawRole) || "Unassigned";
}

function hasOwn<T extends object>(value: T, key: keyof ProjectUpdateBody) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isLivePortalStatus(value: string | null | undefined) {
  const normalized = clean(value).toLowerCase();
  return normalized === "active" || normalized === "public" || normalized === "live" || normalized === "open";
}

function looksLikeEmail(value: string | null | undefined) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

function isMissingTable(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "42P01"
  );
}

async function collectEventRecipientEmails(
  service: ReturnType<typeof createDashboardServiceClient>,
  projectId: string,
) {
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

  if (visitorsResult.error && !isMissingTable(visitorsResult.error)) {
    throw visitorsResult.error;
  }
  if (preReleaseResult.error) throw preReleaseResult.error;
  if (favoritesResult.error && !isMissingTable(favoritesResult.error)) {
    throw favoritesResult.error;
  }

  return Array.from(
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

async function sendReleaseEmails(params: {
  service: ReturnType<typeof createDashboardServiceClient>;
  projectId: string;
  project: Record<string, unknown>;
  photographer: { id: string; business_name?: string | null; studio_email?: string | null };
  origin: string;
}) {
  const gallerySettings = normalizeEventGallerySettings(params.project.gallery_settings);
  const { data: preReleaseRows, error: preReleaseError } = await params.service
    .from("pre_release_emails")
    .select("email")
    .eq("project_id", params.projectId);

  if (preReleaseError) throw preReleaseError;

  const recipients = Array.from(
    new Set(
      (preReleaseRows ?? [])
        .map((row) => clean((row as { email?: string | null }).email).toLowerCase())
        .filter(Boolean),
    ),
  );

  if (!recipients.length) {
    return {
      attempted: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      warning: null as string | null,
    };
  }

  if (!resendConfigured()) {
    return {
      attempted: recipients.length,
      sent: 0,
      skipped: 0,
      failed: 0,
      warning: "RESEND_API_KEY is not configured on the server.",
    };
  }

  const baseProject = {
    id: params.projectId,
    title: typeof params.project.title === "string" ? params.project.title : null,
    client_name:
      typeof params.project.client_name === "string" ? params.project.client_name : null,
    access_mode:
      typeof params.project.access_mode === "string" ? params.project.access_mode : null,
    access_pin:
      typeof params.project.access_pin === "string" ? params.project.access_pin : null,
    email_required:
      typeof params.project.email_required === "boolean" ? params.project.email_required : null,
    cover_photo_url:
      typeof params.project.cover_photo_url === "string" ? params.project.cover_photo_url : null,
  };

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const recipientEmail of recipients) {
    const dedupeKey = `release:${params.projectId}:${recipientEmail}`;
    if (await hasProjectEmailDelivery(params.service, dedupeKey)) {
      skipped += 1;
      continue;
    }

    const email = buildGalleryShareEmail({
      project: baseProject,
      photographer: params.photographer,
      share: gallerySettings.share,
      origin: params.origin,
      previewText: `Your gallery for ${baseProject.title || baseProject.client_name || "this event"} is now live.`,
      overrideSubject:
        clean(gallerySettings.share.emailSubject) ||
        `${baseProject.title || baseProject.client_name || "Your gallery"} is ready`,
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
          { name: "type", value: "gallery_release" },
          { name: "project_id", value: params.projectId },
        ],
      });

      await recordProjectEmailDelivery(params.service, {
        projectId: params.projectId,
        photographerId: params.photographer.id,
        recipientEmail,
        emailType: "gallery_release",
        dedupeKey,
        resendEmailId: sendResult.id,
        subject: email.subject,
        status: "sent",
        payload: {
          source: "project_status_release",
        },
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      await recordProjectEmailDelivery(params.service, {
        projectId: params.projectId,
        photographerId: params.photographer.id,
        recipientEmail,
        emailType: "gallery_release",
        dedupeKey,
        subject: email.subject,
        status: "failed",
        payload: {
          source: "project_status_release",
        },
        errorMessage:
          error instanceof Error ? error.message : "Failed to send gallery release email.",
      });
    }
  }

  return {
    attempted: recipients.length,
    sent,
    skipped,
    failed,
    warning: null as string | null,
  };
}

async function sendCampaignEmails(params: {
  service: ReturnType<typeof createDashboardServiceClient>;
  projectId: string;
  project: Record<string, unknown>;
  photographer: { id: string; business_name?: string | null; studio_email?: string | null };
  origin: string;
}) {
  const gallerySettings = normalizeEventGallerySettings(params.project.gallery_settings);
  const recipients = await collectEventRecipientEmails(params.service, params.projectId);

  if (!recipients.length) {
    return {
      attempted: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      warning: null as string | null,
    };
  }

  if (!resendConfigured()) {
    return {
      attempted: recipients.length,
      sent: 0,
      skipped: 0,
      failed: 0,
      warning: "RESEND_API_KEY is not configured on the server.",
    };
  }

  const email = buildGalleryShareEmail({
    project: {
      id: params.projectId,
      title: typeof params.project.title === "string" ? params.project.title : null,
      client_name:
        typeof params.project.client_name === "string" ? params.project.client_name : null,
      access_mode:
        typeof params.project.access_mode === "string" ? params.project.access_mode : null,
      access_pin:
        typeof params.project.access_pin === "string" ? params.project.access_pin : null,
      email_required:
        typeof params.project.email_required === "boolean" ? params.project.email_required : null,
      cover_photo_url:
        typeof params.project.cover_photo_url === "string" ? params.project.cover_photo_url : null,
    },
    photographer: params.photographer,
    share: gallerySettings.share,
    origin: params.origin,
    previewText: `A gallery update from ${eventFromName(params.photographer)}.`,
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const recipientEmail of recipients) {
    const dedupeKey = `campaign:${params.projectId}:${recipientEmail}`;
    if (await hasProjectEmailDelivery(params.service, dedupeKey)) {
      skipped += 1;
      continue;
    }

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
          { name: "type", value: "campaign" },
          { name: "project_id", value: params.projectId },
        ],
      });

      await recordProjectEmailDelivery(params.service, {
        projectId: params.projectId,
        photographerId: params.photographer.id,
        recipientEmail,
        emailType: "campaign",
        dedupeKey,
        resendEmailId: sendResult.id,
        subject: email.subject,
        status: "sent",
        payload: {
          source: "project_settings_save",
        },
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      await recordProjectEmailDelivery(params.service, {
        projectId: params.projectId,
        photographerId: params.photographer.id,
        recipientEmail,
        emailType: "campaign",
        dedupeKey,
        subject: email.subject,
        status: "failed",
        payload: {
          source: "project_settings_save",
        },
        errorMessage:
          error instanceof Error ? error.message : "Failed to send event campaign email.",
      });
    }
  }

  return {
    attempted: recipients.length,
    sent,
    skipped,
    failed,
    warning: null as string | null,
  };
}

export async function GET(
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

    const { id: projectId } = await context.params;
    const service = createDashboardServiceClient();
    const origin = new URL(request.url).origin;

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
      .select("*")
      .eq("id", projectId)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle();

    if (projectError) throw projectError;
    if (!projectRow) {
      return NextResponse.json(
        { ok: false, message: "Project not found." },
        { status: 404 },
      );
    }

    let classesCount = 0;
    let rolesCount = 0;
    let peopleCount = 0;

    const schoolId = projectRow.linked_school_id || projectRow.school_id || null;

    if (schoolId) {
      const { data: studentRows, error: studentsError } = await service
        .from("students")
        .select("id,class_name,role")
        .eq("school_id", schoolId);

      if (studentsError) throw studentsError;

      const students = (studentRows ?? []) as StudentRow[];
      peopleCount = students.length;
      const classSet = new Set<string>();
      const roleSet = new Set<string>();

      for (const row of students) {
        const className = clean(row.class_name);
        const role = normalizeRole(row.role);
        if (className) classSet.add(className);
        else if (role !== "Student") roleSet.add(role);
      }

      classesCount = classSet.size;
      rolesCount = roleSet.size;
    }

    const { data: collectionRows, error: collectionsError } = await service
      .from("collections")
      .select(
        "id,title,kind,slug,cover_photo_url,sort_order,created_at,access_mode,access_pin",
      )
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (collectionsError) throw collectionsError;

    const collections = (collectionRows ?? []).filter((row) => {
      const kind = clean((row as { kind?: string | null }).kind).toLowerCase();
      return kind === "album" || kind === "class" || kind === "gallery" || !kind;
    });

    let galleriesCount = 0;
    let albumsCount = 0;
    for (const row of collections as Array<{ kind?: string | null }>) {
      const kind = clean(row.kind).toLowerCase();
      if (kind === "gallery") galleriesCount += 1;
      else albumsCount += 1;
    }

    // Pagination for media — defaults: page 1, 200 items per page
    const url = new URL(request.url);
    const mediaPage = Math.max(1, Number(url.searchParams.get("mediaPage")) || 1);
    const mediaLimit = Math.min(500, Math.max(1, Number(url.searchParams.get("mediaLimit")) || 200));
    const mediaFrom = (mediaPage - 1) * mediaLimit;
    const mediaTo = mediaFrom + mediaLimit - 1;

    const { data: mediaRows, error: mediaError, count: mediaTotalCount } = await service
      .from("media")
      .select("id,collection_id,storage_path,preview_url,thumbnail_url,filename,created_at,sort_order", { count: "exact" })
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .range(mediaFrom, mediaTo);

    if (mediaError) throw mediaError;

    const normalizedMediaRows = (mediaRows ?? []).map((row) => {
      const mediaUrls = buildStoredMediaUrls({
        storagePath: "storage_path" in row ? row.storage_path : null,
        previewUrl: "preview_url" in row ? row.preview_url : null,
        thumbnailUrl: "thumbnail_url" in row ? row.thumbnail_url : null,
      });

      return {
        ...row,
        download_url: mediaUrls.originalUrl || null,
        preview_url: mediaUrls.previewUrl || null,
        thumbnail_url: mediaUrls.thumbnailUrl || null,
      };
    });

    return NextResponse.json({
      ok: true,
      project: projectRow,
      collections,
      media: normalizedMediaRows,
      mediaCount: mediaTotalCount ?? normalizedMediaRows.length,
      mediaPage,
      mediaTotalCount: mediaTotalCount ?? normalizedMediaRows.length,
      classesCount,
      rolesCount,
      peopleCount,
      galleriesCount,
      albumsCount,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to load project.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(
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

    const { id: projectId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as ProjectUpdateBody;

    const service = createDashboardServiceClient();
    const origin = new URL(request.url).origin;

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

    const { data: currentProject, error: currentProjectError } = await service
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle();

    if (currentProjectError) throw currentProjectError;
    if (!currentProject) {
      return NextResponse.json(
        { ok: false, message: "Project not found." },
        { status: 404 },
      );
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    const previousPortalStatus = clean(currentProject.portal_status);
    const previousSettings = normalizeEventGallerySettings(currentProject.gallery_settings);

    if (hasOwn(body, "cover_photo_url")) {
      updatePayload.cover_photo_url = clean(body.cover_photo_url) || null;
    }
    if (hasOwn(body, "cover_focal_x")) {
      updatePayload.cover_focal_x = Math.max(0, Math.min(1, Number(body.cover_focal_x) || 0.5));
    }
    if (hasOwn(body, "cover_focal_y")) {
      updatePayload.cover_focal_y = Math.max(0, Math.min(1, Number(body.cover_focal_y) || 0.5));
    }

    if (hasOwn(body, "gallery_slug")) {
      let rawSlug = clean(body.gallery_slug)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (rawSlug) {
        // Check uniqueness across projects and schools (excluding this project)
        let candidate = rawSlug;
        let suffix = 1;
        for (let attempts = 0; attempts < 10; attempts++) {
          const [{ data: pMatch }, { data: sMatch }] = await Promise.all([
            service.from("projects").select("id").eq("gallery_slug", candidate).neq("id", projectId).maybeSingle(),
            service.from("schools").select("id").eq("gallery_slug", candidate).maybeSingle(),
          ]);
          if (!pMatch && !sMatch) break;
          suffix += 1;
          candidate = `${rawSlug}-${suffix}`;
        }
        updatePayload.gallery_slug = candidate;
      } else {
        updatePayload.gallery_slug = null;
      }
    }

    if (hasOwn(body, "portal_status")) {
      const nextStatus = clean(body.portal_status) || null;
      updatePayload.portal_status = nextStatus;
      updatePayload.status = nextStatus;
    }

    if (hasOwn(body, "shoot_date")) {
      updatePayload.shoot_date = clean(body.shoot_date) || null;
    }
    if (hasOwn(body, "order_due_date")) {
      updatePayload.order_due_date = clean(body.order_due_date) || null;
    }
    if (hasOwn(body, "expiration_date")) {
      updatePayload.expiration_date = clean(body.expiration_date) || null;
    }
    if (hasOwn(body, "package_profile_id")) {
      const resolvedProfileId = await ensurePackageProfile({
        service,
        photographerId: photographerRow.id,
        packageProfileId: body.package_profile_id,
      });
      updatePayload.package_profile_id = clean(resolvedProfileId) || null;
    }
    if (hasOwn(body, "email_required")) {
      updatePayload.email_required = body.email_required === true;
    }
    if (hasOwn(body, "checkout_contact_required")) {
      updatePayload.checkout_contact_required =
        body.checkout_contact_required === true;
    }
    if (hasOwn(body, "internal_notes")) {
      updatePayload.internal_notes = clean(body.internal_notes) || null;
    }
    if (hasOwn(body, "access_mode")) {
      const nextAccessMode = clean(body.access_mode).toLowerCase() === "pin" ? "pin" : "public";
      updatePayload.access_mode = nextAccessMode;
      updatePayload.access_pin =
        nextAccessMode === "pin" ? clean(body.access_pin) || null : null;
      updatePayload.access_updated_at =
        clean(body.access_updated_at) || new Date().toISOString();
      updatePayload.access_updated_source =
        clean(body.access_updated_source) || "cloud";
    }

    if (hasOwn(body, "gallery_settings")) {
      updatePayload.gallery_settings = normalizeEventGallerySettings(body.gallery_settings);
    }

    if (hasOwn(body, "project_name") && "project_name" in currentProject) {
      updatePayload.project_name = clean(body.project_name) || null;
    } else if (hasOwn(body, "name") && "name" in currentProject) {
      updatePayload.name = clean(body.name) || null;
    } else if (hasOwn(body, "title")) {
      updatePayload.title = clean(body.title) || null;
    }

    if (Object.keys(updatePayload).length === 1) {
      return NextResponse.json(
        { ok: false, message: "No project changes were provided." },
        { status: 400 },
      );
    }

    console.log("[PATCH /api/dashboard/events/[id]] updatePayload keys:", Object.keys(updatePayload));
    console.log("[PATCH /api/dashboard/events/[id]] updatePayload:", JSON.stringify(updatePayload, null, 2));

    const { data: projectData, error: projectError } = await service
      .from("projects")
      .update(updatePayload)
      .eq("id", projectId)
      .eq("photographer_id", photographerRow.id)
      .select("*")
      .maybeSingle();

    if (projectError) {
      console.error("[PATCH /api/dashboard/events/[id]] projectError:", projectError);
      throw projectError;
    }
    if (!projectData) {
      return NextResponse.json(
        { ok: false, message: "Project not found." },
        { status: 404 },
      );
    }

    let releaseEmailResult: {
      attempted: number;
      sent: number;
      skipped: number;
      failed: number;
      warning: string | null;
    } | null = null;
    let campaignEmailResult: {
      attempted: number;
      sent: number;
      skipped: number;
      failed: number;
      warning: string | null;
    } | null = null;

    const nextPortalStatus = clean(projectData.portal_status);
    const nextSettings = normalizeEventGallerySettings(projectData.gallery_settings);
    if (
      previousPortalStatus.toLowerCase() === "pre_release" &&
      isLivePortalStatus(nextPortalStatus)
    ) {
      releaseEmailResult = await sendReleaseEmails({
        service,
        projectId,
        project: projectData as Record<string, unknown>,
        photographer: photographerRow,
        origin,
      });
    }

    if (
      !previousSettings.extras.sendEmailCampaign &&
      nextSettings.extras.sendEmailCampaign &&
      isLivePortalStatus(nextPortalStatus)
    ) {
      campaignEmailResult = await sendCampaignEmails({
        service,
        projectId,
        project: projectData as Record<string, unknown>,
        photographer: photographerRow,
        origin,
      });
    }

    return NextResponse.json({
      ok: true,
      project: projectData,
      releaseEmailResult,
      campaignEmailResult,
    });
  } catch (error) {
    const errMsg =
      error instanceof Error ? error.message : "Failed to update project.";
    const errDetails =
      error && typeof error === "object" && "details" in error
        ? (error as Record<string, unknown>).details
        : undefined;
    const errCode =
      error && typeof error === "object" && "code" in error
        ? (error as Record<string, unknown>).code
        : undefined;
    console.error("[PATCH /api/dashboard/events/[id]]", { errMsg, errDetails, errCode, error });
    return NextResponse.json(
      {
        ok: false,
        message: errMsg,
        details: errDetails || null,
        code: errCode || null,
      },
      { status: 500 },
    );
  }
}

/* ------------------------------------------------------------------ */
/*  DELETE /api/dashboard/events/[id]                                  */
/* ------------------------------------------------------------------ */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json({ ok: false, message: "Please sign in again." }, { status: 401 });
    }

    const { id: projectId } = await context.params;
    const service = createDashboardServiceClient();

    const { data: photographerRow, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (photographerError) throw photographerError;
    if (!photographerRow?.id) {
      return NextResponse.json({ ok: false, message: "Photographer profile not found." }, { status: 404 });
    }

    // Verify the project belongs to the photographer before deleting
    const { data: projectRow, error: projectError } = await service
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle();

    if (projectError) throw projectError;
    if (!projectRow) {
      return NextResponse.json({ ok: false, message: "Project not found." }, { status: 404 });
    }

    // Collect all storage paths so we can delete from R2
    const { data: mediaRows } = await service
      .from("media")
      .select("storage_path")
      .eq("project_id", projectId);

    // Delete related data first, then the project
    await Promise.all([
      service.from("media").delete().eq("project_id", projectId),
      service.from("collections").delete().eq("project_id", projectId),
    ]);

    const { error: deleteError } = await service
      .from("projects")
      .delete()
      .eq("id", projectId)
      .eq("photographer_id", photographerRow.id);

    if (deleteError) throw deleteError;

    // Delete files from R2 in the background (don't block the response)
    // Each storage_path is the original; also delete _thumbnail and _preview variants.
    if (mediaRows && mediaRows.length > 0) {
      const prefixes = new Set<string>();
      for (const row of mediaRows) {
        if (row.storage_path) {
          // Derive the folder prefix from storage path (e.g. "projects/abc/albums/xyz/")
          const folder = row.storage_path.substring(0, row.storage_path.lastIndexOf("/") + 1);
          if (folder) prefixes.add(folder);
        }
      }
      // Delete each unique folder prefix from R2
      Promise.allSettled(
        Array.from(prefixes).map((prefix) => r2DeletePrefix(prefix)),
      ).catch((err) => console.error("R2 cleanup error:", err));
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/dashboard/events/[id]]", error);
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Failed to delete project." },
      { status: 500 },
    );
  }
}

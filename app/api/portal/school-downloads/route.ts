import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";
import { buildSchoolGalleryDownloadAccess } from "@/lib/school-gallery-downloads";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { validateIdentifierArray } from "@/lib/request-validation";
import {
  buildSchoolCandidateFolders,
  loadFolderMediaRows,
} from "@/lib/storage-folder";
import { hasCalendarBoundaryPassed } from "@/lib/calendar-dates";

export const dynamic = "force-dynamic";

type SchoolRow = {
  id: string;
  school_name: string | null;
  photographer_id: string | null;
  local_school_id?: string | null;
  status: string | null;
  expiration_date: string | null;
  gallery_settings: unknown;
};

type StudentAccessRow = {
  id: string;
  school_id: string;
  photo_url?: string | null;
  class_id?: string | null;
  class_name?: string | null;
  folder_name?: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function looksLikeEmail(value: string | null | undefined) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

function normalizedSchoolStatus(value: string | null | undefined) {
  return clean(value).toLowerCase().replaceAll("-", "_");
}

async function validateSchoolDownloadAccess(params: {
  schoolId: string;
  email: string;
  pin: string;
}) {
  const service = createDashboardServiceClient();
  const selectedSchoolId = clean(params.schoolId);
  const selectedPin = clean(params.pin);
  const selectedEmail = clean(params.email).toLowerCase();

  const { data: schoolRow, error: schoolError } = await service
    .from("schools")
    .select("id,school_name,photographer_id,local_school_id,status,expiration_date,gallery_settings")
    .eq("id", selectedSchoolId)
    .maybeSingle<SchoolRow>();

  if (schoolError) throw schoolError;
  if (!schoolRow) {
    return { ok: false as const, status: 404, message: "School gallery not found." };
  }

  if (hasCalendarBoundaryPassed(schoolRow.expiration_date)) {
    return { ok: false as const, status: 409, message: "This gallery has expired." };
  }

  if (normalizedSchoolStatus(schoolRow.status) === "pre_release") {
    return { ok: false as const, status: 409, message: "This gallery is not live yet." };
  }

  if (!looksLikeEmail(selectedEmail)) {
    return {
      ok: false as const,
      status: 400,
      message: "Please enter your email to open this gallery.",
    };
  }

  // Download authorization is exactly scoped to the immutable school chosen
  // by the visitor. A duplicate display name must never widen access.
  const pinResult = await service
    .from("students")
    .select("id,school_id,photo_url,class_id,class_name,folder_name")
    .eq("pin", selectedPin)
    .eq("school_id", selectedSchoolId);

  if (pinResult.error) throw pinResult.error;

  const matches = pinResult.data ?? [];

  if (!matches.length) {
    return {
      ok: false as const,
      status: 404,
      message: "No gallery was found for that school and PIN.",
    };
  }

  const studentCandidates = matches as StudentAccessRow[];
  const bestMatch =
    studentCandidates.find((row) => !!row.photo_url) ?? studentCandidates[0];

  return {
    ok: true as const,
    service,
    schoolId: selectedSchoolId,
    viewerEmail: selectedEmail,
    school: schoolRow,
    classId: bestMatch?.class_id ?? null,
    className: bestMatch?.class_name ?? null,
    studentCandidates,
  };
}

async function loadAllowedMediaIdsForPin(params: {
  studentCandidates: StudentAccessRow[];
  school: SchoolRow;
  schoolId: string;
  service: ReturnType<typeof createDashboardServiceClient>;
}) {
  const rows = await loadFolderMediaRows(
    buildSchoolCandidateFolders({
      studentCandidates: params.studentCandidates,
      activeSchool: params.school,
      selectedSchoolId: params.schoolId,
    }),
    { service: params.service, schoolId: params.schoolId },
  );
  return new Set(rows.map((row) => row.id));
}

export async function POST(request: NextRequest) {
  try {
    // Cap per-IP download prep rate. Each call validates access, checks
    // download eligibility, and writes a download row. 20/min is comfortably
    // above any plausible human interaction.
    const limitResult = await rateLimit(getClientIp(request), {
      namespace: "school-downloads",
      limit: 20,
      windowSeconds: 60,
    });
    if (!limitResult.allowed) {
      return NextResponse.json(
        { ok: false, message: "Too many download requests. Please slow down." },
        {
          status: 429,
          headers: {
            "Retry-After": Math.max(
              1,
              Math.ceil((limitResult.resetAt - Date.now()) / 1000),
            ).toString(),
          },
        },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      schoolId?: string;
      email?: string;
      pin?: string;
      downloadPin?: string;
      mediaIds?: string[];
      downloadType?: "gallery" | "favorites";
    };

    const access = await validateSchoolDownloadAccess({
      schoolId: body.schoolId ?? "",
      email: body.email ?? "",
      pin: body.pin ?? "",
    });

    if (!access.ok) {
      return NextResponse.json(
        { ok: false, message: access.message },
        { status: access.status },
      );
    }

    // Hard cap + storage-key format: school media IDs are R2 object keys.
    const mediaIdsResult = validateIdentifierArray(body.mediaIds, "mediaIds", {
      min: 1,
      max: 2000,
    });
    if (!mediaIdsResult.ok) {
      return NextResponse.json(
        { ok: false, message: mediaIdsResult.message },
        { status: 400 },
      );
    }
    const mediaIds = mediaIdsResult.value;
    const downloadType = body.downloadType === "favorites" ? "favorites" : "gallery";

    const downloadAccess = await buildSchoolGalleryDownloadAccess({
      service: access.service,
      schoolId: access.schoolId,
      viewerEmail: access.viewerEmail,
      gallerySettings: access.school.gallery_settings,
      classId: access.classId,
      className: access.className,
    });
    const settings = normalizeEventGallerySettings(access.school.gallery_settings);
    const providedDownloadPin = clean(body.downloadPin);
    const expectedDownloadPin = clean(settings.extras.downloadPin);

    if (!downloadAccess.enabled) {
      return NextResponse.json(
        { ok: false, message: downloadAccess.message || "Gallery downloads are turned off." },
        { status: 403 },
      );
    }

    if (settings.extras.downloadPinEnabled) {
      if (!expectedDownloadPin) {
        return NextResponse.json(
          {
            ok: false,
            message: 'A "Download All" PIN has not been configured for this gallery yet.',
          },
          { status: 403 },
        );
      }

      if (providedDownloadPin !== expectedDownloadPin) {
        return NextResponse.json(
          { ok: false, message: "The download PIN is incorrect." },
          { status: 403 },
        );
      }
    }

    if (!downloadAccess.canDownload) {
      return NextResponse.json(
        {
          ok: false,
          message:
            downloadAccess.message ||
            "There are no free downloads remaining for this gallery.",
          downloadsUsed: downloadAccess.downloadsUsed,
          downloadsRemaining: downloadAccess.downloadsRemaining,
        },
        { status: 403 },
      );
    }

    const allowedMediaIdSet = await loadAllowedMediaIdsForPin({
      studentCandidates: access.studentCandidates,
      school: access.school,
      schoolId: access.schoolId,
      service: access.service,
    });
    const downloadableMediaIds = mediaIds.filter((id) => allowedMediaIdSet.has(id));

    if (!downloadableMediaIds.length) {
      return NextResponse.json(
        {
          ok: false,
          message: "Those photos are not available for this PIN.",
          downloadsUsed: downloadAccess.downloadsUsed,
          downloadsRemaining: downloadAccess.downloadsRemaining,
        },
        { status: 403 },
      );
    }

    const allowedMediaIds =
      downloadAccess.downloadsRemaining === null
        ? downloadableMediaIds
        : downloadableMediaIds.slice(0, downloadAccess.downloadsRemaining);

    if (!allowedMediaIds.length) {
      return NextResponse.json(
        {
          ok: false,
          message: "There are no free downloads remaining for this gallery.",
          downloadsUsed: downloadAccess.downloadsUsed,
          downloadsRemaining: downloadAccess.downloadsRemaining,
        },
        { status: 403 },
      );
    }

    const { error: insertError } = await access.service
      .from("school_gallery_downloads")
      .insert({
        school_id: access.schoolId,
        viewer_email: access.viewerEmail,
        download_type: downloadType,
        download_count: allowedMediaIds.length,
        media_ids: allowedMediaIds,
      });

    if (
      insertError &&
      !(typeof insertError === "object" &&
        insertError &&
        "code" in insertError &&
        (insertError as { code?: string }).code === "42P01")
    ) {
      throw insertError;
    }

    return NextResponse.json({
      ok: true,
      allowedMediaIds,
      downloadsUsed: downloadAccess.downloadsUsed + allowedMediaIds.length,
      downloadsRemaining:
        downloadAccess.downloadsRemaining === null
          ? null
          : Math.max(0, downloadAccess.downloadsRemaining - allowedMediaIds.length),
    });
  } catch (error) {
    console.error("[school-downloads]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to prepare school downloads." },
      { status: 500 },
    );
  }
}

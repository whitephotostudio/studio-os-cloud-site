import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { validateEmail, validateIdentifierArray, validateUuid } from "@/lib/request-validation";
import {
  buildSchoolCandidateFolders,
  loadFolderMediaRows,
} from "@/lib/storage-folder";
import { hasCalendarBoundaryPassed } from "@/lib/calendar-dates";

export const dynamic = "force-dynamic";

type SchoolRow = {
  id: string;
  school_name: string | null;
  local_school_id?: string | null;
  status: string | null;
  expiration_date: string | null;
};

type StudentAccessRow = {
  id: string;
  school_id: string;
  photo_url?: string | null;
  class_name?: string | null;
  folder_name?: string | null;
};

type FavoriteRow = {
  media_id: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function normalizedSchoolStatus(value: string | null | undefined) {
  return clean(value).toLowerCase().replaceAll("-", "_");
}

function isMissingFavoritesTable(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "42P01"
  );
}

function viewerKey(schoolId: string, email: string, pin: string) {
  return createHash("sha256")
    .update(`${schoolId}::${email.toLowerCase()}::${pin}`)
    .digest("hex");
}

async function validateSchoolFavoriteAccess(params: {
  schoolId: string;
  email: string;
  pin: string;
}) {
  const schoolIdResult = validateUuid(params.schoolId, "schoolId");
  if (!schoolIdResult.ok) {
    return { ok: false as const, status: 400, message: schoolIdResult.message };
  }
  const emailResult = validateEmail(params.email);
  if (!emailResult.ok) {
    return { ok: false as const, status: 400, message: emailResult.message };
  }
  const pin = clean(params.pin);
  if (!pin) {
    return { ok: false as const, status: 400, message: "PIN is required." };
  }

  const service = createDashboardServiceClient();
  const { data: schoolRow, error: schoolError } = await service
    .from("schools")
    .select("id,school_name,local_school_id,status,expiration_date")
    .eq("id", schoolIdResult.value)
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

  const { data: studentRows, error: studentError } = await service
    .from("students")
    .select("id,school_id,photo_url,class_name,folder_name")
    .eq("school_id", schoolRow.id)
    .eq("pin", pin);

  if (studentError) throw studentError;
  const studentCandidates = (studentRows ?? []) as StudentAccessRow[];
  if (!studentCandidates.length) {
    return {
      ok: false as const,
      status: 404,
      message: "No gallery was found for that school and PIN.",
    };
  }

  return {
    ok: true as const,
    service,
    school: schoolRow,
    schoolId: schoolRow.id,
    email: emailResult.value,
    pin,
    key: viewerKey(schoolRow.id, emailResult.value, pin),
    studentCandidates,
  };
}

async function allowedSchoolFavoriteIds(params: {
  studentCandidates: StudentAccessRow[];
  school: SchoolRow;
  schoolId: string;
}) {
  const rows = await loadFolderMediaRows(
    buildSchoolCandidateFolders({
      studentCandidates: params.studentCandidates,
      activeSchool: params.school,
      selectedSchoolId: params.schoolId,
    }),
  );
  const allowed = new Set(rows.map((row) => row.id));
  return allowed;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const access = await validateSchoolFavoriteAccess({
      schoolId: searchParams.get("schoolId") ?? "",
      email: searchParams.get("email") ?? "",
      pin: searchParams.get("pin") ?? "",
    });

    if (!access.ok) {
      return NextResponse.json(
        { ok: false, message: access.message },
        { status: access.status },
      );
    }

    const { data, error } = await access.service
      .from("school_gallery_favorites")
      .select("media_id")
      .eq("school_id", access.schoolId)
      .eq("viewer_key", access.key)
      .order("created_at", { ascending: true });

    if (error) {
      if (isMissingFavoritesTable(error)) {
        return NextResponse.json({
          ok: true,
          mediaIds: [],
          unavailable: true,
          message: "School favorites are still local-only until the database update is applied.",
        });
      }
      throw error;
    }

    return NextResponse.json({
      ok: true,
      mediaIds: ((data ?? []) as FavoriteRow[])
        .map((row) => clean(row.media_id))
        .filter(Boolean),
    });
  } catch (error) {
    console.error("[school-favorites:GET]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to load school favorites." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const limitResult = await rateLimit(getClientIp(request), {
      namespace: "school-favorites",
      limit: 60,
      windowSeconds: 60,
    });
    if (!limitResult.allowed) {
      return NextResponse.json(
        { ok: false, message: "Too many updates. Please slow down." },
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
      mediaId?: string;
      favorited?: boolean;
    };

    const access = await validateSchoolFavoriteAccess({
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

    const mediaIdResult = validateIdentifierArray([body.mediaId], "mediaId", {
      min: 1,
      max: 1,
      maxLength: 1024,
    });
    if (!mediaIdResult.ok) {
      return NextResponse.json(
        { ok: false, message: mediaIdResult.message },
        { status: 400 },
      );
    }
    const mediaId = mediaIdResult.value[0];
    const allowedIds = await allowedSchoolFavoriteIds({
      studentCandidates: access.studentCandidates,
      school: access.school,
      schoolId: access.schoolId,
    });
    if (!allowedIds.has(mediaId) && !mediaId.startsWith("composite-")) {
      return NextResponse.json(
        { ok: false, message: "Photo not found in this school gallery." },
        { status: 404 },
      );
    }

    const shouldFavorite = body.favorited !== false;
    if (shouldFavorite) {
      const { error } = await access.service
        .from("school_gallery_favorites")
        .upsert(
          {
            school_id: access.schoolId,
            media_id: mediaId,
            viewer_email: access.email,
            viewer_key: access.key,
          },
          {
            onConflict: "school_id,media_id,viewer_key",
            ignoreDuplicates: false,
          },
        );

      if (error) {
        if (isMissingFavoritesTable(error)) {
          return NextResponse.json({
            ok: true,
            mediaId,
            favorited: shouldFavorite,
            unavailable: true,
            message: "School favorites are still local-only until the database update is applied.",
          });
        }
        throw error;
      }
    } else {
      const { error } = await access.service
        .from("school_gallery_favorites")
        .delete()
        .eq("school_id", access.schoolId)
        .eq("media_id", mediaId)
        .eq("viewer_key", access.key);

      if (error) {
        if (isMissingFavoritesTable(error)) {
          return NextResponse.json({
            ok: true,
            mediaId,
            favorited: shouldFavorite,
            unavailable: true,
            message: "School favorites are still local-only until the database update is applied.",
          });
        }
        throw error;
      }
    }

    return NextResponse.json({
      ok: true,
      mediaId,
      favorited: shouldFavorite,
    });
  } catch (error) {
    console.error("[school-favorites:POST]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to save school favorite." },
      { status: 500 },
    );
  }
}

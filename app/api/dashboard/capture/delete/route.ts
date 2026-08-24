import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { guardAgreement } from "@/lib/require-agreement";
import { listR2FolderImages } from "@/lib/r2";
import { recordAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import {
  buildStudentPhotoFolderPrefixes,
  canonicalOriginalSchoolPhotoKey,
  filterTombstonedSchoolPhotoAssets,
  invalidateSchoolPhotoTombstones,
  isMissingSchoolPhotoDeletionsTable,
  keyBelongsToStudentPhotoFolders,
  loadSchoolPhotoTombstones,
  safeLocalSchoolStorageId,
  schoolPhotoFamilyForKey,
  storageKeyFromSchoolPhotoReference,
  tombstoneFamilySet,
} from "@/lib/school-photo-deletions";

export const dynamic = "force-dynamic";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

type SchoolRow = { id: string; local_school_id: string | null };
type StudentRow = {
  id: string;
  photo_url: string | null;
  class_name: string | null;
  folder_name: string | null;
};

// Capture delete (mobile Picture Day panel).
//
// Soft-removes one photo from every gallery representation. The bytes stay in
// R2 during the staged desktop rollout; the durable tombstone prevents an old
// installed app from silently restoring the photo.
export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const auth = await resolveDashboardAuth(request);
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createDashboardServiceClient();

  const guard = await guardAgreement({ service, userId: auth.user.id });
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  const { data: photographer } = await service
    .from("photographers")
    .select("id")
    .eq("user_id", auth.user.id)
    .maybeSingle<{ id: string }>();
  if (!photographer?.id) {
    return NextResponse.json(
      { error: "Photographer profile not found." },
      { status: 403 },
    );
  }

  const limit = await rateLimit(photographer.id, {
    namespace: "school-photo-removal",
    limit: 30,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many photo changes. Please wait a moment." },
      { status: 429 },
    );
  }

  let body: { schoolId?: string; key?: string };
  try {
    body = (await request.json()) as { schoolId?: string; key?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const schoolId = clean(body.schoolId);
  const key = canonicalOriginalSchoolPhotoKey(body.key);
  if (!schoolId || !key) {
    return NextResponse.json(
      { error: "schoolId and an original photo key are required." },
      { status: 400 },
    );
  }

  const { data: school } = await service
    .from("schools")
    .select("id, local_school_id")
    .eq("id", schoolId)
    .eq("photographer_id", photographer.id)
    .maybeSingle<SchoolRow>();
  if (!school?.id) {
    return NextResponse.json(
      { error: "School not found for this account." },
      { status: 404 },
    );
  }

  let verifiedLocalSchoolId: string | null = null;
  const localSchoolId = safeLocalSchoolStorageId(school.local_school_id);
  if (localSchoolId) {
    const [idMatchesResult, localMatchesResult] = await Promise.all([
      service.from("schools").select("id").eq("id", localSchoolId).limit(2),
      service
        .from("schools")
        .select("id")
        .eq("local_school_id", localSchoolId)
        .limit(2),
    ]);
    if (idMatchesResult.error || localMatchesResult.error) {
      return NextResponse.json(
        { error: "Could not verify this school's storage namespace." },
        { status: 502 },
      );
    }
    const ids = new Set(
      [...(idMatchesResult.data ?? []), ...(localMatchesResult.data ?? [])].map(
        (row) => row.id,
      ),
    );
    if (ids.size === 1 && ids.has(school.id)) {
      verifiedLocalSchoolId = localSchoolId;
    }
  }
  const authorizedSchool = {
    ...school,
    local_school_id: verifiedLocalSchoolId,
  };

  const { data: studentRows, error: studentError } = await service
    .from("students")
    .select("id,photo_url,class_name,folder_name")
    .eq("school_id", school.id);
  if (studentError) {
    return NextResponse.json(
      { error: "Could not verify the photo owner." },
      { status: 502 },
    );
  }

  const matchingStudents = ((studentRows ?? []) as StudentRow[]).filter(
    (student) => {
      const folders = buildStudentPhotoFolderPrefixes({
        school: authorizedSchool,
        student,
      });
      return keyBelongsToStudentPhotoFolders(key, folders);
    },
  );
  if (matchingStudents.length !== 1) {
    return NextResponse.json(
      {
        error:
          matchingStudents.length > 1
            ? "This photo folder is ambiguous. Use the student gallery to remove it."
            : "That photo is not in an authorized student folder.",
      },
      { status: matchingStudents.length > 1 ? 409 : 403 },
    );
  }
  const student = matchingStudents[0];
  const family = schoolPhotoFamilyForKey(key);
  if (!family) {
    return NextResponse.json({ error: "Invalid photo key." }, { status: 400 });
  }

  const folder = key.slice(0, key.lastIndexOf("/"));
  let folderAssets;
  try {
    folderAssets = await listR2FolderImages(folder);
  } catch (error) {
    console.error("[capture/delete] folder verification failed", error);
    return NextResponse.json(
      { error: "Could not verify this photo. Please try again." },
      { status: 502 },
    );
  }

  const existingTombstones = await loadSchoolPhotoTombstones(
    service,
    school.id,
    { fresh: true },
  );
  const alreadyRemoved = tombstoneFamilySet(existingTombstones).has(family);
  if (!alreadyRemoved && !folderAssets.some((asset) => asset.key === key)) {
    return NextResponse.json(
      { error: "That photo no longer exists in this student's gallery." },
      { status: 404 },
    );
  }

  const { error: tombstoneError } = await service
    .from("school_photo_deletions")
    .upsert(
      {
        school_id: school.id,
        student_id: student.id,
        photographer_id: photographer.id,
        storage_key: key,
        storage_family: family,
        deleted_by_user_id: auth.user.id,
      },
      { onConflict: "school_id,storage_key", ignoreDuplicates: true },
    );
  if (tombstoneError) {
    console.error("[capture/delete] tombstone failed", tombstoneError);
    return NextResponse.json(
      {
        error: isMissingSchoolPhotoDeletionsTable(tombstoneError)
          ? "Photo removal is being enabled. Please try again shortly."
          : "Could not safely remove the photo. Nothing was deleted.",
      },
      { status: isMissingSchoolPhotoDeletionsTable(tombstoneError) ? 503 : 502 },
    );
  }

  invalidateSchoolPhotoTombstones(school.id);
  const currentTombstones = await loadSchoolPhotoTombstones(
    service,
    school.id,
    { fresh: true },
  );
  const remainingAssets = filterTombstonedSchoolPhotoAssets(
    folderAssets,
    tombstoneFamilySet(currentTombstones),
  );
  const representativeKey = storageKeyFromSchoolPhotoReference(student.photo_url);
  const representativeFamily = schoolPhotoFamilyForKey(representativeKey);
  const nextRepresentativeKey =
    representativeFamily && representativeFamily === family
      ? remainingAssets[0]?.key ?? null
      : representativeKey || remainingAssets[0]?.key || null;
  if (nextRepresentativeKey !== representativeKey) {
    const { error: updateError } = await service
      .from("students")
      .update({ photo_url: nextRepresentativeKey })
      .eq("id", student.id)
      .eq("school_id", school.id);
    if (updateError) {
      console.error("[capture/delete] representative repair failed", updateError);
      return NextResponse.json(
        { error: "Photo was removed, but its cover could not be refreshed." },
        { status: 502 },
      );
    }
  }

  await recordAudit({
    request,
    actorUserId: auth.user.id,
    actorPhotographerId: photographer.id,
    action: "school.capture_photo.remove_from_gallery",
    entityType: "student",
    entityId: student.id,
    targetPhotographerId: photographer.id,
    before: { representative_key: representativeKey },
    after: { representative_key: nextRepresentativeKey },
    metadata: {
      schoolId: school.id,
      storageKey: key,
      alreadyRemoved,
      bytesPreserved: true,
    },
    result: "ok",
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json({
    ok: true,
    key,
    disposition: "removed_from_gallery",
    bytesPreserved: true,
    photoUrl: nextRepresentativeKey,
  });
}

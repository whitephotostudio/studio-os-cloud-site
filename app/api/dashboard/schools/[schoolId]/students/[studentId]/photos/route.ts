import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { guardAgreement } from "@/lib/require-agreement";
import { recordAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { listR2FolderImages } from "@/lib/r2";
import { publicStorageUrl } from "@/lib/storage-images";
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
  schoolPhotoReferenceMatchesFamily,
  storageKeyFromSchoolPhotoReference,
  tombstoneFamilySet,
  type SchoolPhotoAsset,
} from "@/lib/school-photo-deletions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_KEYS = 50;
const MAX_BODY_CHARS = 60_000;

type SchoolRow = {
  id: string;
  local_school_id: string | null;
  photographer_id: string | null;
  cover_photo_url: string | null;
};

type StudentRow = {
  id: string;
  school_id: string;
  photo_url: string | null;
  class_name: string | null;
  folder_name: string | null;
};

type CoverRow = {
  id: string;
  cover_photo_url: string | null;
};

type ProjectCoverRow = CoverRow & {
  linked_school_id?: string | null;
  linked_local_school_id?: string | null;
};

type MediaCoverRow = {
  id: string;
  storage_path: string | null;
  preview_url: string | null;
  thumbnail_url: string | null;
  is_cover: boolean | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

function dedupeAssets(groups: SchoolPhotoAsset[][]) {
  const byKey = new Map<string, SchoolPhotoAsset>();
  for (const asset of groups.flat()) {
    if (!byKey.has(asset.key)) byKey.set(asset.key, asset);
  }
  return Array.from(byKey.values()).sort((a, b) =>
    a.key.localeCompare(b.key, undefined, { numeric: true, sensitivity: "base" }),
  );
}

async function loadSchoolProjectCovers(
  service: ReturnType<typeof createDashboardServiceClient>,
  school: SchoolRow,
) {
  const rows: ProjectCoverRow[] = [];
  const bySchool = await service
    .from("projects")
    .select("id,cover_photo_url,linked_school_id,linked_local_school_id")
    .eq("workflow_type", "school")
    .eq("photographer_id", school.photographer_id)
    .eq("linked_school_id", school.id);
  if (bySchool.error) throw bySchool.error;
  rows.push(...((bySchool.data ?? []) as ProjectCoverRow[]));

  if (clean(school.local_school_id)) {
    const byLocalSchool = await service
      .from("projects")
      .select("id,cover_photo_url,linked_school_id,linked_local_school_id")
      .eq("workflow_type", "school")
      .eq("photographer_id", school.photographer_id)
      .eq("linked_local_school_id", clean(school.local_school_id));
    if (byLocalSchool.error) throw byLocalSchool.error;
    rows.push(...((byLocalSchool.data ?? []) as ProjectCoverRow[]));
  }

  return Array.from(new Map(rows.map((row) => [row.id, row])).values());
}

async function repairCoverReferences(params: {
  service: ReturnType<typeof createDashboardServiceClient>;
  school: SchoolRow;
  removedFamilies: ReadonlySet<string>;
  fallbackKey: string | null;
}) {
  const repaired: Array<{ type: string; id: string }> = [];
  const nextCover = params.fallbackKey;

  if (
    schoolPhotoReferenceMatchesFamily(
      params.school.cover_photo_url,
      params.removedFamilies,
    )
  ) {
    const { error } = await params.service
      .from("schools")
      .update({ cover_photo_url: nextCover })
      .eq("id", params.school.id)
      .eq("photographer_id", params.school.photographer_id);
    if (error) throw error;
    repaired.push({ type: "school", id: params.school.id });
  }

  const projects = await loadSchoolProjectCovers(params.service, params.school);
  const projectIds = projects.map((project) => project.id);
  for (const project of projects) {
    if (
      !schoolPhotoReferenceMatchesFamily(
        project.cover_photo_url,
        params.removedFamilies,
      )
    ) {
      continue;
    }
    const { error } = await params.service
      .from("projects")
      .update({ cover_photo_url: nextCover })
      .eq("id", project.id)
      .eq("photographer_id", params.school.photographer_id);
    if (error) throw error;
    repaired.push({ type: "project", id: project.id });
  }

  if (!projectIds.length) return repaired;

  const { data: collections, error: collectionError } = await params.service
    .from("collections")
    .select("id,cover_photo_url")
    .in("project_id", projectIds);
  if (collectionError) throw collectionError;

  for (const collection of (collections ?? []) as CoverRow[]) {
    if (
      !schoolPhotoReferenceMatchesFamily(
        collection.cover_photo_url,
        params.removedFamilies,
      )
    ) {
      continue;
    }
    const { error } = await params.service
      .from("collections")
      .update({ cover_photo_url: nextCover })
      .eq("id", collection.id)
      .in("project_id", projectIds);
    if (error) throw error;
    repaired.push({ type: "collection", id: collection.id });
  }

  // Preserve the media rows for paid-order recovery, but make sure a hidden
  // photo is no longer the database's explicit cover candidate.
  const { data: mediaRows, error: mediaError } = await params.service
    .from("media")
    .select("id,storage_path,preview_url,thumbnail_url,is_cover")
    .in("project_id", projectIds)
    .eq("is_cover", true);
  if (mediaError) throw mediaError;

  for (const media of (mediaRows ?? []) as MediaCoverRow[]) {
    const reference =
      clean(media.storage_path) ||
      clean(media.preview_url) ||
      clean(media.thumbnail_url);
    if (!schoolPhotoReferenceMatchesFamily(reference, params.removedFamilies)) {
      continue;
    }
    const { error } = await params.service
      .from("media")
      .update({ is_cover: false })
      .eq("id", media.id)
      .in("project_id", projectIds);
    if (error) throw error;
    repaired.push({ type: "media_cover", id: media.id });
  }

  return repaired;
}

async function removeStudentPhotos(
  request: NextRequest,
  context: { params: Promise<{ schoolId: string; studentId: string }> },
) {
  const startedAt = Date.now();
  const { user } = await resolveDashboardAuth(request);
  if (!user) {
    return privateJson({ ok: false, message: "Please sign in again." }, 401);
  }

  const service = createDashboardServiceClient();
  const agreement = await guardAgreement({ service, userId: user.id });
  if (!agreement.ok) return privateJson(agreement.body, agreement.status);

  const { data: photographer, error: photographerError } = await service
    .from("photographers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle<{ id: string }>();
  if (photographerError || !photographer?.id) {
    return privateJson(
      { ok: false, message: "Photographer profile not found." },
      403,
    );
  }

  const limit = await rateLimit(photographer.id, {
    namespace: "school-photo-removal",
    limit: 30,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return privateJson(
      { ok: false, message: "Too many photo changes. Please wait a moment." },
      429,
    );
  }

  const { schoolId, studentId } = await context.params;
  const [schoolResult, studentResult] = await Promise.all([
    service
      .from("schools")
      .select("id,local_school_id,photographer_id,cover_photo_url")
      .eq("id", schoolId)
      .eq("photographer_id", photographer.id)
      .maybeSingle<SchoolRow>(),
    service
      .from("students")
      .select("id,school_id,photo_url,class_name,folder_name")
      .eq("id", studentId)
      .eq("school_id", schoolId)
      .maybeSingle<StudentRow>(),
  ]);

  if (schoolResult.error) throw schoolResult.error;
  if (studentResult.error) throw studentResult.error;
  if (!schoolResult.data) {
    return privateJson({ ok: false, message: "School not found." }, 404);
  }
  if (!studentResult.data) {
    return privateJson(
      { ok: false, message: "Student not found in this school." },
      404,
    );
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_CHARS) {
    return privateJson({ ok: false, message: "Request is too large." }, 413);
  }

  let body: { keys?: unknown };
  try {
    body = JSON.parse(rawBody) as { keys?: unknown };
  } catch {
    return privateJson({ ok: false, message: "Invalid request body." }, 400);
  }

  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    return privateJson(
      { ok: false, message: "Choose at least one photo to remove." },
      400,
    );
  }
  if (body.keys.length > MAX_KEYS) {
    return privateJson(
      { ok: false, message: `Choose no more than ${MAX_KEYS} photos at once.` },
      400,
    );
  }

  const requestedKeys = Array.from(
    new Set(
      body.keys.map((value) =>
        typeof value === "string"
          ? canonicalOriginalSchoolPhotoKey(value)
          : null,
      ),
    ),
  );
  if (requestedKeys.some((key) => !key)) {
    return privateJson(
      {
        ok: false,
        message:
          "Every photo must be identified by its original storage key, not a URL or derivative.",
      },
      400,
    );
  }
  const keys = requestedKeys.filter((key): key is string => Boolean(key));

  const school = schoolResult.data;
  const student = studentResult.data;
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
    if (idMatchesResult.error) throw idMatchesResult.error;
    if (localMatchesResult.error) throw localMatchesResult.error;
    const matchingSchoolIds = new Set(
      [...(idMatchesResult.data ?? []), ...(localMatchesResult.data ?? [])].map(
        (row) => row.id,
      ),
    );
    if (matchingSchoolIds.size === 1 && matchingSchoolIds.has(school.id)) {
      verifiedLocalSchoolId = localSchoolId;
    }
  }
  const authorizedSchool = {
    ...school,
    local_school_id: verifiedLocalSchoolId,
  };
  const folders = buildStudentPhotoFolderPrefixes({
    school: authorizedSchool,
    student,
  });
  if (!folders.length) {
    return privateJson(
      { ok: false, message: "This student's photo folder could not be verified." },
      409,
    );
  }
  if (keys.some((key) => !keyBelongsToStudentPhotoFolders(key, folders))) {
    return privateJson(
      { ok: false, message: "One or more photos do not belong to this student." },
      403,
    );
  }

  const existingTombstones = await loadSchoolPhotoTombstones(service, schoolId);
  const existingByKey = new Map(
    existingTombstones.map((row) => [clean(row.storage_key), row]),
  );

  const currentRepresentativeKey = storageKeyFromSchoolPhotoReference(
    student.photo_url,
  );
  const foldersToList = Array.from(
    new Set(
      [...keys, currentRepresentativeKey]
        .filter((key): key is string => Boolean(key && key.includes("/")))
        .map((key) => key.slice(0, key.lastIndexOf("/")))
        .filter((folder) => folders.includes(folder)),
    ),
  );
  if (!foldersToList.length) {
    return privateJson(
      { ok: false, message: "This student's active photo folder could not be verified." },
      409,
    );
  }

  let allAssets: SchoolPhotoAsset[];
  try {
    allAssets = dedupeAssets(
      await Promise.all(
        foldersToList.map((folder) => listR2FolderImages(folder)),
      ),
    );
  } catch (error) {
    console.error("[school-photo-removal] folder verification failed", error);
    return privateJson(
      { ok: false, message: "Could not verify the student's photos. Please retry." },
      502,
    );
  }

  const availableKeys = new Set(allAssets.map((asset) => asset.key));
  const unverified = keys.filter(
    (key) => !availableKeys.has(key) && !existingByKey.has(key),
  );
  if (unverified.length) {
    return privateJson(
      {
        ok: false,
        message: "One or more photos no longer exist in this student's gallery.",
        keys: unverified,
      },
      404,
    );
  }

  const newKeys = keys.filter((key) => !existingByKey.has(key));
  if (newKeys.length) {
    const rows = newKeys.map((key) => {
      const storageFamily = schoolPhotoFamilyForKey(key);
      if (!storageFamily) {
        throw new Error("Could not canonicalize a selected photo key.");
      }
      return {
        school_id: schoolId,
        student_id: studentId,
        photographer_id: photographer.id,
        storage_key: key,
        storage_family: storageFamily,
        deleted_by_user_id: user.id,
      };
    });
    const { error: tombstoneError } = await service
      .from("school_photo_deletions")
      .upsert(rows, {
        onConflict: "school_id,storage_key",
        ignoreDuplicates: true,
      });
    if (tombstoneError) {
      const migrationMissing = isMissingSchoolPhotoDeletionsTable(tombstoneError);
      console.error("[school-photo-removal] tombstone insert failed", tombstoneError);
      return privateJson(
        {
          ok: false,
          code: migrationMissing ? "photo_deletions_migration_required" : "tombstone_failed",
          message: migrationMissing
            ? "Photo removal is being enabled. Please try again shortly."
            : "Could not safely remove the photo. Nothing was deleted.",
        },
        migrationMissing ? 503 : 502,
      );
    }
    invalidateSchoolPhotoTombstones(schoolId);
  }

  const currentTombstones = await loadSchoolPhotoTombstones(service, schoolId, {
    fresh: true,
  });
  const deletedFamilies = tombstoneFamilySet(currentTombstones);
  const remainingAssets = filterTombstonedSchoolPhotoAssets(
    allAssets,
    deletedFamilies,
  );
  const removedFamilies = new Set(
    keys
      .map((key) => schoolPhotoFamilyForKey(key))
      .filter((family): family is string => Boolean(family)),
  );

  const currentRepresentativeFamily = schoolPhotoFamilyForKey(
    currentRepresentativeKey,
  );
  const remainingFamilies = new Set(
    remainingAssets
      .map((asset) => schoolPhotoFamilyForKey(asset.key))
      .filter((family): family is string => Boolean(family)),
  );
  const representativeNeedsRepair =
    !!currentRepresentativeFamily &&
    (!remainingFamilies.has(currentRepresentativeFamily) ||
      deletedFamilies.has(currentRepresentativeFamily));
  const fallbackAsset = remainingAssets[0] ?? null;
  const nextRepresentativeKey = representativeNeedsRepair
    ? fallbackAsset?.key ?? null
    : currentRepresentativeKey || fallbackAsset?.key || null;

  if (representativeNeedsRepair || (!student.photo_url && nextRepresentativeKey)) {
    const { error: representativeError } = await service
      .from("students")
      .update({ photo_url: nextRepresentativeKey })
      .eq("id", studentId)
      .eq("school_id", schoolId);
    if (representativeError) throw representativeError;
  }

  const repairedReferences = await repairCoverReferences({
    service,
    school,
    removedFamilies,
    fallbackKey: fallbackAsset?.key ?? null,
  });

  const representativeAsset = nextRepresentativeKey
    ? remainingAssets.find(
        (asset) =>
          schoolPhotoFamilyForKey(asset.key) ===
          schoolPhotoFamilyForKey(nextRepresentativeKey),
      ) ?? null
    : null;
  const representativeUrl = representativeAsset?.url ||
    (nextRepresentativeKey ? publicStorageUrl(nextRepresentativeKey) : null);

  await recordAudit({
    request,
    actorUserId: user.id,
    actorPhotographerId: photographer.id,
    action: "school.student_photos.remove_from_gallery",
    entityType: "student",
    entityId: studentId,
    targetPhotographerId: photographer.id,
    before: {
      representative_key: currentRepresentativeKey,
      photo_count: allAssets.length,
    },
    after: {
      representative_key: nextRepresentativeKey,
      photo_count: remainingAssets.length,
    },
    metadata: {
      schoolId,
      requestedKeys: keys,
      newlyTombstoned: newKeys.length,
      alreadyRemoved: keys.length - newKeys.length,
      repairedReferences: repairedReferences.length,
      bytesPreserved: true,
    },
    result: "ok",
    durationMs: Date.now() - startedAt,
  });

  return privateJson({
    ok: true,
    disposition: "removed_from_gallery",
    bytesPreserved: true,
    deletedKeys: keys,
    removedKeys: keys,
    newlyRemovedKeys: newKeys,
    alreadyRemovedKeys: keys.filter((key) => existingByKey.has(key)),
    remainingPhotoAssets: remainingAssets,
    remainingPhotos: remainingAssets,
    photos: remainingAssets,
    photoUrls: remainingAssets.map((asset) => asset.url),
    representativeKey: nextRepresentativeKey,
    representativeUrl,
    // Stored reference consumed by the dashboard state. Keep it durable; the
    // UI derives its authenticated proxy URL from this key.
    photoUrl: nextRepresentativeKey,
    updatedRepresentativeUrl: representativeUrl,
    student: {
      id: studentId,
      photo_url: nextRepresentativeKey,
    },
    repairedReferences,
  });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ schoolId: string; studentId: string }> },
) {
  try {
    return await removeStudentPhotos(request, context);
  } catch (error) {
    console.error("[school-photo-removal] unexpected failure", error);
    return privateJson(
      {
        ok: false,
        message: "Could not safely remove the photo. Please try again.",
      },
      500,
    );
  }
}

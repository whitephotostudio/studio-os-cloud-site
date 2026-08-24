import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { guardAgreement } from "@/lib/require-agreement";
import { r2Copy, r2DeleteWithVariants, r2VariantKeys } from "@/lib/r2";
import {
  buildStudentPhotoFolderPrefixes,
  canonicalOriginalSchoolPhotoKey,
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
export const maxDuration = 60;

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

// Mirror the capture-upload folder convention so the moved photo lands in a
// folder the gallery enumerates for the destination student.
function safeSegment(value: string, fallback: string) {
  const cleaned = clean(value)
    .replace(/[\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

function baseNameNoVariant(fileName: string) {
  return clean(fileName)
    .replace(/\.[^.]+$/i, "")
    .replace(/_(preview|thumbnail|cutout|nobg)$/i, "");
}

type StudentRow = {
  id: string;
  school_id: string | null;
  first_name: string | null;
  last_name: string | null;
  pin: string | null;
  class_name: string | null;
  folder_name: string | null;
  photo_url: string | null;
};

type SchoolRow = { id: string; local_school_id: string | null };

// Capture move / re-assign (mobile Sort panel).
//
// Moves a photo (and its thumbnail/preview variants) from one student's R2
// folder into another student's folder — the "wrong kid / wrong QR scan" fix.
// Mirrors the desktop `_reassignSelected` (disk move + rename) but done
// server-side in R2. Scoped so a photographer can only move within their own
// school's storage prefix.
export async function POST(request: NextRequest) {
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

  let body: {
    schoolId?: string;
    key?: string;
    fromStudentId?: string;
    toStudentId?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const schoolId = clean(body.schoolId);
  const key = canonicalOriginalSchoolPhotoKey(body.key);
  const fromStudentId = clean(body.fromStudentId);
  const toStudentId = clean(body.toStudentId);

  if (!schoolId || !key || !fromStudentId || !toStudentId) {
    return NextResponse.json(
      { error: "schoolId, key, fromStudentId and toStudentId are required." },
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

  const [sourceResult, destinationResult] = await Promise.all([
    service
      .from("students")
      .select("id, school_id, first_name, last_name, pin, class_name, folder_name, photo_url")
      .eq("id", fromStudentId)
      .eq("school_id", schoolId)
      .maybeSingle<StudentRow>(),
    service
      .from("students")
      .select("id, school_id, first_name, last_name, pin, class_name, folder_name, photo_url")
      .eq("id", toStudentId)
      .eq("school_id", schoolId)
      .maybeSingle<StudentRow>(),
  ]);
  if (sourceResult.error) throw sourceResult.error;
  if (destinationResult.error) throw destinationResult.error;
  const source = sourceResult.data;
  const dest = destinationResult.data;
  if (!source?.id) {
    return NextResponse.json(
      { error: "Source student not found in this school." },
      { status: 404 },
    );
  }
  if (!dest?.id) {
    return NextResponse.json(
      { error: "Destination student not found in this school." },
      { status: 404 },
    );
  }
  const sourceFolders = buildStudentPhotoFolderPrefixes({
    school: authorizedSchool,
    student: source,
  });
  if (!keyBelongsToStudentPhotoFolders(key, sourceFolders)) {
    return NextResponse.json(
      { error: "That photo is not in the source student's folder." },
      { status: 403 },
    );
  }
  const sourceFamily = schoolPhotoFamilyForKey(key);
  const deletedFamilies = tombstoneFamilySet(
    await loadSchoolPhotoTombstones(service, school.id),
  );
  if (sourceFamily && deletedFamilies.has(sourceFamily)) {
    return NextResponse.json(
      { error: "This photo has already been removed from the gallery." },
      { status: 410 },
    );
  }

  const schoolBaseId = verifiedLocalSchoolId || school.id;
  const destClass = safeSegment(dest.class_name ?? "", "Unassigned");
  const destFallback = safeSegment(
    [clean(dest.last_name), clean(dest.first_name), clean(dest.pin)]
      .filter(Boolean)
      .join(" "),
    `student ${dest.id.slice(0, 8)}`,
  );
  // Match the Flutter "Last First PIN" folder convention (not the
  // studentId_Last_First students.folder_name) so a re-assigned photo lands in
  // the same folder the Mac app uses for that student.
  const destFolderName = destFallback;
  const destFolder = `${schoolBaseId}/${destClass}/${destFolderName}`;

  const origBasename = key.split("/").pop() ?? "";
  if (!origBasename) {
    return NextResponse.json({ error: "Invalid key." }, { status: 400 });
  }
  const destKey = `${destFolder}/${origBasename}`;

  if (destKey === key) {
    return NextResponse.json({ ok: true, newKey: destKey, noop: true });
  }

  // Copy the original (must succeed), then variants best-effort, then remove source.
  try {
    await r2Copy(key, destKey);
  } catch (error) {
    console.error("[capture/move] copy failed", error);
    return NextResponse.json(
      { error: "Move failed. Please try again." },
      { status: 502 },
    );
  }
  for (const vKey of r2VariantKeys(key)) {
    if (vKey === key) continue;
    const vName = vKey.split("/").pop();
    if (!vName) continue;
    try {
      await r2Copy(vKey, `${destFolder}/${vName}`);
    } catch {
      /* variant may not exist — skip */
    }
  }
  if (!sourceFamily) {
    await r2DeleteWithVariants([destKey]).catch(() => undefined);
    return NextResponse.json({ error: "Invalid source photo." }, { status: 400 });
  }
  const { error: tombstoneError } = await service
    .from("school_photo_deletions")
    .upsert(
      {
        school_id: school.id,
        student_id: source.id,
        photographer_id: photographer.id,
        storage_key: key,
        storage_family: sourceFamily,
        deleted_by_user_id: auth.user.id,
      },
      { onConflict: "school_id,storage_key", ignoreDuplicates: true },
    );
  if (tombstoneError) {
    await r2DeleteWithVariants([destKey]).catch(() => undefined);
    return NextResponse.json(
      {
        error: isMissingSchoolPhotoDeletionsTable(tombstoneError)
          ? "Photo moves are being updated. Please try again shortly."
          : "Move could not be recorded safely. Please try again.",
      },
      { status: isMissingSchoolPhotoDeletionsTable(tombstoneError) ? 503 : 502 },
    );
  }
  // Preserve source bytes for older desktop builds and paid-order recovery.
  // The tombstone hides them, while the copied destination remains visible.
  invalidateSchoolPhotoTombstones(school.id);

  // Fix cover photos: clear the source student's cover if it was the moved
  // photo; set the destination's cover if it has none.
  const movedBase = baseNameNoVariant(origBasename);
  const movedFolder = key.slice(0, key.lastIndexOf("/"));

  if (fromStudentId) {
    const fromKey = source.photo_url
      ? storageKeyFromSchoolPhotoReference(source.photo_url) ?? ""
      : "";
    if (fromKey) {
      const fromFolder = fromKey.slice(0, fromKey.lastIndexOf("/"));
      const fromBase = baseNameNoVariant(fromKey.split("/").pop() ?? "");
      if (fromFolder === movedFolder && fromBase === movedBase) {
        await service
          .from("students")
          .update({ photo_url: null })
          .eq("id", fromStudentId);
      }
    }
  }

  if (!clean(dest.photo_url)) {
    await service
      .from("students")
      .update({ photo_url: destKey })
      .eq("id", dest.id);
  }

  return NextResponse.json({
    ok: true,
    newKey: destKey,
    sourceDisposition: "removed_from_gallery",
    sourceBytesPreserved: true,
  });
}

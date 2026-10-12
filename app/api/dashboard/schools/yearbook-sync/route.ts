import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";
import { isUuid } from "@/lib/r2-access-security";
import { getR2Client, R2_BUCKET } from "@/lib/r2";
import { buildSchoolCandidateFolders } from "@/lib/storage-folder";
import { canonicalOriginalSchoolPhotoKey, keyBelongsToStudentPhotoFolders, loadSchoolPhotoTombstones, schoolPhotoFamilyForKey, tombstoneFamilySet } from "@/lib/school-photo-deletions";
import { type YearbookSelection } from "@/lib/school-yearbook";
import { YearbookError, loadYearbookSettings, yearbookSchoolFields, type YearbookSchool, type YearbookStudent } from "@/lib/school-yearbook-server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const headers = { "Cache-Control": "private, no-store" };
const studentFields = "id,school_id,external_student_id,pin,class_name,folder_name,photo_url";
type SyncStudent = Pick<YearbookStudent, "id" | "school_id" | "pin" | "class_name" | "folder_name" | "photo_url"> & { external_student_id: string | null };

function objectMissing(error: unknown) {
  const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return value?.name === "NotFound" || value?.name === "NoSuchKey" || value?.$metadata?.httpStatusCode === 404;
}

/** Owner-only, read-only choices for desktop's per-school Best Photo opt-in.
 * Parent selection availability and subscription status do not restrict an
 * owner's access to their existing records. Read every page on each pull;
 * per-choice revisions make repeat pulls idempotent without a lossy timestamp.
 */
export async function GET(request: NextRequest) {
  try {
    const { user, mfaSatisfied } = await resolveDashboardAuth(request);
    if (!user) throw new YearbookError("Please sign in again.", 401);
    if (mfaSatisfied === false) throw new YearbookError("Complete two-factor sign-in first.", 403);

    const params = request.nextUrl.searchParams;
    const schoolId = params.get("schoolId") ?? "";
    const after = params.get("after");
    const limitValue = params.get("limit") ?? "50";
    if (!isUuid(schoolId) || (after !== null && !isUuid(after)) || !/^\d+$/.test(limitValue)) throw new YearbookError("Invalid yearbook sync request.", 400);
    const limit = Number(limitValue);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new YearbookError("Choose a page size between 1 and 100.", 400);

    const service = createDashboardServiceClient();
    const { data: photographer, error: photographerError } = await service.from("photographers").select("id").eq("user_id", user.id).maybeSingle();
    if (photographerError) throw photographerError;
    if (!photographer) throw new YearbookError("Photographer profile not found.", 404);
    const { data: school, error: schoolError } = await service.from("schools").select(yearbookSchoolFields).eq("id", schoolId).eq("photographer_id", photographer.id).maybeSingle<YearbookSchool>();
    if (schoolError) throw schoolError;
    if (!school) throw new YearbookError("School not found.", 404);

    const settings = await loadYearbookSettings(service, school.id);
    let query = service.from("school_yearbook_selections").select("student_id,media_key,filename,source,revision,updated_at").eq("school_id", school.id).order("student_id", { ascending: true }).limit(limit + 1);
    if (after) query = query.gt("student_id", after);
    const { data, error: selectionError } = await query;
    if (selectionError) throw selectionError;
    const selected = (data ?? []) as YearbookSelection[];
    const page = selected.slice(0, limit);
    const nextAfter = selected.length > limit ? page[page.length - 1].student_id : null;

    // A selection's independent student FK does not establish that the
    // student still belongs to this school. Query that scope explicitly.
    const students = new Map<string, SyncStudent>();
    let deleted: ReadonlySet<string> = new Set();
    if (page.length) {
      const { data: currentStudents, error: studentError } = await service.from("students").select(studentFields).eq("school_id", school.id).in("id", page.map(selection => selection.student_id));
      if (studentError) throw studentError;
      for (const student of (currentStudents ?? []) as SyncStudent[]) students.set(student.id, student);
      deleted = tombstoneFamilySet(await loadSchoolPhotoTombstones(service, school.id, { fresh: true }));
    }

    const selections: Array<Record<string, unknown>> = [];
    // Bound exact-object reads; never issue photo grants or list a roster.
    for (let offset = 0; offset < page.length; offset += 6) {
      const rows = await Promise.all(page.slice(offset, offset + 6).map(async selection => {
        const student = students.get(selection.student_id);
        if (!student) return null;
        const folders = buildSchoolCandidateFolders({ activeSchool: school, selectedSchoolId: school.id, studentCandidates: [student] });
        const original = canonicalOriginalSchoolPhotoKey(selection.media_key);
        const family = schoolPhotoFamilyForKey(selection.media_key);
        let available = false;
        if (original === selection.media_key && keyBelongsToStudentPhotoFolders(selection.media_key, folders) && family && !deleted.has(family)) {
          try {
            const object = await getR2Client().send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: selection.media_key }));
            available = (object.ContentLength ?? 0) > 0;
          } catch (error) {
            if (!objectMissing(error)) throw error;
          }
        }
        return {
          student_id: student.id, external_student_id: student.external_student_id ?? null, pin: student.pin ?? null,
          class_name: student.class_name ?? null, folder_name: student.folder_name ?? null, photo_folders: folders,
          media_key: selection.media_key, filename: selection.filename, source: selection.source,
          revision: selection.revision, updated_at: selection.updated_at, available,
        };
      }));
      selections.push(...rows.filter((row): row is NonNullable<typeof row> => row !== null));
    }

    return NextResponse.json({ ok: true, schemaVersion: 1, school: { id: school.id, local_school_id: school.local_school_id ?? null }, settings, selections, nextAfter }, { headers });
  } catch (error) {
    if (!(error instanceof YearbookError)) console.error("[yearbook:desktop-sync] read failed");
    return NextResponse.json({ ok: false, message: error instanceof YearbookError ? error.message : "Yearbook choices are temporarily unavailable. Please try again." }, { status: error instanceof YearbookError ? error.status : 503, headers });
  }
}

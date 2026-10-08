import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { hasCalendarBoundaryPassed } from "@/lib/calendar-dates";
import { hasActiveSubscription } from "@/lib/subscription-gate";
import { isUuid } from "@/lib/r2-access-security";
import { validateEmail } from "@/lib/request-validation";
import { buildSchoolCandidateFolders, loadFolderMediaRows } from "@/lib/storage-folder";
import { canonicalOriginalSchoolPhotoKey, keyBelongsToStudentPhotoFolders, loadSchoolPhotoTombstones, schoolPhotoFamilyForKey, tombstoneFamilySet } from "@/lib/school-photo-deletions";
import { defaultYearbookSettings, yearbookExportFilename, yearbookIsOpen, type YearbookSettings, type YearbookSelection, type YearbookExportRow } from "@/lib/school-yearbook";

type Service = ReturnType<typeof createDashboardServiceClient>;
export type YearbookSchool = { id: string; photographer_id: string; school_name?: string | null; local_school_id?: string | null; status?: string | null; portal_status?: string | null; expiration_date?: string | null };
export type YearbookStudent = { id: string; school_id: string; pin: string; first_name: string | null; last_name: string | null; class_name: string | null; folder_name: string | null; photo_url: string | null };
export class YearbookError extends Error { constructor(message: string, public status = 409) { super(message); } }
export const yearbookStudentFields = "id,school_id,pin,first_name,last_name,class_name,folder_name,photo_url";
export const yearbookSchoolFields = "id,photographer_id,school_name,local_school_id,status,portal_status,expiration_date";

export async function loadYearbookSettings(service: Service, schoolId: string): Promise<YearbookSettings> {
  const { data, error } = await service.from("school_yearbook_settings").select("enabled,deadline,revision").eq("school_id", schoolId).maybeSingle();
  if (error) throw error;
  return data ?? { ...defaultYearbookSettings };
}

export async function loadYearbookSelection(service: Service, schoolId: string, studentId: string): Promise<YearbookSelection | null> {
  const { data, error } = await service.from("school_yearbook_selections").select("student_id,media_key,filename,source,revision,updated_at").eq("school_id", schoolId).eq("student_id", studentId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function yearbookParentAccess(service: Service, input: { schoolId: unknown; pin: unknown; email: unknown }) {
  if (typeof input.schoolId !== "string" || !isUuid(input.schoolId) || typeof input.pin !== "string" || !input.pin.trim() || input.pin.length > 64) throw new YearbookError("School and student PIN are required.", 400);
  const email = validateEmail(typeof input.email === "string" ? input.email : "");
  if (!email.ok) throw new YearbookError(email.message, 400);
  const { data: school, error } = await service.from("schools").select(yearbookSchoolFields).eq("id", input.schoolId).maybeSingle<YearbookSchool>();
  if (error) throw error;
  if (!school) throw new YearbookError("Gallery not found.", 404);
  const status = (school.portal_status ?? school.status ?? "").trim().toLowerCase().replaceAll("-", "_");
  if (!["active", "public", "live", "open", "published", "released"].includes(status) || hasCalendarBoundaryPassed(school.expiration_date)) throw new YearbookError("This gallery is not available.", 403);
  const { data: owner, error: ownerError } = await service.from("photographers").select("id,is_platform_admin,subscription_status,trial_starts_at,trial_ends_at,created_at").eq("id", school.photographer_id).maybeSingle();
  if (ownerError) throw ownerError;
  if (!hasActiveSubscription(owner)) throw new YearbookError("This gallery is not available.", 403);
  const { data: students, error: studentError } = await service.from("students").select(yearbookStudentFields).eq("school_id", school.id).eq("pin", input.pin.trim()).limit(21);
  if (studentError) throw studentError;
  if (!students?.length || students.length > 20) throw new YearbookError("No unambiguous student gallery was found for that PIN.", 404);
  return { school, students: students as YearbookStudent[], email: email.value, pin: input.pin.trim() };
}

export async function yearbookPhotos(service: Service, school: YearbookSchool, student: YearbookStudent) {
  const folders = buildSchoolCandidateFolders({ activeSchool: school, selectedSchoolId: school.id, studentCandidates: [student] });
  const deleted = tombstoneFamilySet(await loadSchoolPhotoTombstones(service, school.id, { fresh: true }));
  const photos = await loadFolderMediaRows(folders, { service, photographerId: school.photographer_id, schoolId: school.id, tombstonedFamilies: deleted });
  return photos.filter(photo => canonicalOriginalSchoolPhotoKey(photo.storage_path) === photo.storage_path && keyBelongsToStudentPhotoFolders(photo.storage_path, folders));
}

export async function saveYearbookSelection(service: Service, options: { school: YearbookSchool; student: YearbookStudent; mediaKey: unknown; expectedRevision: unknown; source: "parent" | "photographer"; email?: string; pin?: string }) {
  if (typeof options.mediaKey !== "string" || !canonicalOriginalSchoolPhotoKey(options.mediaKey)) throw new YearbookError("Choose an original portrait from this student's gallery.", 400);
  if (!Number.isInteger(options.expectedRevision) || Number(options.expectedRevision) < 0) throw new YearbookError("Reload the current selection before saving.", 400);
  if (options.source === "parent" && !yearbookIsOpen(await loadYearbookSettings(service, options.school.id))) throw new YearbookError("Yearbook selections are closed.", 403);
  const photo = (await yearbookPhotos(service, options.school, options.student)).find(photo => photo.storage_path === options.mediaKey);
  if (!photo) throw new YearbookError("That portrait is no longer available in this student's gallery.", 404);
  const { data, error } = await service.rpc("save_school_yearbook_selection", {
    p_school_id: options.school.id, p_student_id: options.student.id, p_photographer_id: options.school.photographer_id,
    p_media_key: photo.storage_path, p_filename: photo.filename, p_storage_family: schoolPhotoFamilyForKey(photo.storage_path),
    p_source: options.source, p_viewer_email: options.email ?? null, p_pin: options.pin ?? null, p_expected_revision: options.expectedRevision,
    p_student_snapshot: { school_id: options.student.school_id, photo_url: options.student.photo_url, class_name: options.student.class_name, folder_name: options.student.folder_name },
    p_school_snapshot: { local_school_id: options.school.local_school_id ?? null, photographer_id: options.school.photographer_id },
  });
  if (error) {
    if (error.code === "40001") throw new YearbookError("This selection or gallery changed. Reload before saving again.", 409);
    if (error.code === "42501") throw new YearbookError("Yearbook selection is no longer permitted.", 403);
    throw error;
  }
  return data as YearbookSelection;
}

export async function yearbookRows<T>(service: Service, table: string, fields: string, schoolId: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < 20000; offset += 500) {
    const { data, error } = await service.from(table).select(fields).eq("school_id", schoolId).order(table === "students" ? "id" : "student_id").range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data ?? []) as T[]);
    if ((data?.length ?? 0) < 500) return rows;
  }
  throw new YearbookError("This school is too large for one yearbook export. Contact support.");
}

export async function yearbookExportRows(service: Service, school: YearbookSchool, students: YearbookStudent[], selections: YearbookSelection[]) {
  const selected = new Map(selections.map(row => [row.student_id, row]));
  const rows: YearbookExportRow[] = [];
  // Bound provider reads while revalidating every chosen original at export time.
  for (let offset = 0; offset < students.length; offset += 6) {
    rows.push(...await Promise.all(students.slice(offset, offset + 6).map(async student => {
      const selection = selected.get(student.id);
      const available = !!selection && (await yearbookPhotos(service, school, student)).some(photo => photo.storage_path === selection.media_key);
      return { studentId: student.id, firstName: student.first_name ?? "", lastName: student.last_name ?? "", className: student.class_name ?? "", filename: selection ? yearbookExportFilename(student, selection.filename) : "", mediaKey: selection?.media_key ?? "", source: selection?.source ?? "", updatedAt: selection?.updated_at ?? "", available };
    })));
  }
  return rows;
}

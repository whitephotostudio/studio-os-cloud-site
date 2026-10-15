import type { SupabaseClient } from "@supabase/supabase-js";
import { hasCalendarBoundaryPassed } from "@/lib/calendar-dates";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";
import { listR2FolderImages } from "@/lib/r2";
import { schoolCompositeClassMatches } from "@/lib/school-composite-scope";
import { findSyncedSchoolProjectId } from "@/lib/school-sync";
import {
  buildStudentPhotoFolderPrefixes,
  canonicalOriginalSchoolPhotoKey,
  filterTombstonedSchoolPhotoAssets,
  keyBelongsToSchoolStorage,
  keyBelongsToStudentPhotoFolders,
  loadSchoolPhotoTombstones,
  schoolStorageRoots,
  storageKeyFromSchoolPhotoReference,
  tombstoneFamilySet,
} from "@/lib/school-photo-deletions";

type Row = Record<string, unknown>;
type Student = {
  id: string; school_id: string; class_name: string | null; folder_name: string | null;
  photo_url: string | null; pin: string | null; role: string | null;
};
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const liveStatuses = new Set(["active", "public", "live", "open", "published", "released", "ready"]);

function visible(row: Row) {
  if (["hidden", "is_hidden", "archived", "is_archived", "deleted", "is_deleted", "is_private"].some(key => row[key] === true)) return false;
  if (row.published === false || row.is_published === false || row.visible === false || row.is_visible === false) return false;
  if (clean(row.archived_at) || clean(row.deleted_at)) return false;
  return [row.status, row.portal_status].every(value => !clean(value) || liveStatuses.has(clean(value).toLowerCase().replaceAll("-", "_")));
}

function usableOriginal(value: unknown) {
  const key = storageKeyFromSchoolPhotoReference(clean(value));
  if (!key || !canonicalOriginalSchoolPhotoKey(key)) return null;
  if (key.split("/").some(segment => /^(?:\.|(?:admin|private|archives?|archived|backdrops?|backgrounds?|probes|credits|credit-staging)$)/i.test(segment))) return null;
  return key;
}

async function pages(service: SupabaseClient, table: string, filters: Record<string, string>) {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = service.from(table).select("*");
    for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
    const { data, error } = await query.order("id").range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data ?? []) as Row[]);
    if ((data ?? []).length < 500) return rows;
  }
}

/** Confirm current original photos that a school's parent gallery can expose.
 * A representative URL or an unrelated project upload is not photo proof.
 * Reads and storage errors throw so automated senders can fail closed. */
export async function loadSchoolDeadlineReminderPhotoClasses(service: SupabaseClient, schoolId: string): Promise<Set<string>> {
  const { data: school, error } = await service.from("schools")
    .select("id,photographer_id,local_school_id,status,portal_status,expiration_date,gallery_settings")
    .eq("id", schoolId).maybeSingle();
  if (error) throw error;
  if (!school || !school.photographer_id || !visible(school) || hasCalendarBoundaryPassed(school.expiration_date) ||
    !normalizeEventGallerySettings(school.gallery_settings).extras.enableStore) return new Set();
  const [studentRows, tombstones] = await Promise.all([
    pages(service, "students", { school_id: schoolId }),
    loadSchoolPhotoTombstones(service, schoolId, { fresh: true }),
  ]);
  const students = studentRows.filter(row => visible(row) && (!clean(row.role) || clean(row.role).toLowerCase() === "student") &&
    !!clean(row.pin) && !!clean(row.class_name)).map(row => ({
      id: clean(row.id), school_id: clean(row.school_id), class_name: clean(row.class_name), folder_name: clean(row.folder_name),
      photo_url: clean(row.photo_url) || null, pin: clean(row.pin), role: clean(row.role),
    })) as Student[];
  if (!students.length) return new Set();
  const deleted = tombstoneFamilySet(tombstones);
  const knownClasses = [...new Set(students.map(student => student.class_name!))];
  const foldersByClass = new Map(knownClasses.map(className => [className, [...new Set(students.filter(student => student.class_name === className)
    .flatMap(student => buildStudentPhotoFolderPrefixes({ school, student })))] ]));
  const objectCache = new Map<string, Promise<Set<string>>>();
  const originals = (folder: string) => {
    let cached = objectCache.get(folder);
    if (!cached) {
      cached = listR2FolderImages(folder, { photographerId: school.photographer_id }).then(files => new Set(
        filterTombstonedSchoolPhotoAssets(files, deleted).map(file => usableOriginal(file.key)).filter((key): key is string => !!key),
      ));
      objectCache.set(folder, cached);
    }
    return cached;
  };
  const ready = new Set<string>();
  // List each authorized school root once, rather than doing one cloud scan
  // per student. Only exact authorized student folders can qualify a class.
  for (const root of schoolStorageRoots(school)) {
    const keys = await originals(root);
    for (const [className, folders] of foldersByClass) {
      if (!ready.has(className) && [...keys].some(key => keyBelongsToStudentPhotoFolders(key, folders))) ready.add(className);
    }
  }
  const projectId = await findSyncedSchoolProjectId(service, schoolId, {
    localSchoolId: school.local_school_id, photographerId: school.photographer_id,
  });
  if (!projectId) return ready;
  const { data: project, error: projectError } = await service.from("projects").select("*")
    .eq("id", projectId).eq("photographer_id", school.photographer_id).maybeSingle();
  if (projectError) throw projectError;
  if (!project || !visible(project)) return ready;
  const collections = (await pages(service, "collections", { project_id: projectId, kind: "composite" })).filter(row =>
    visible(row) && ["", "public", "inherit", "inherit_project", "project"].includes(clean(row.access_mode).toLowerCase()));
  if (!collections.length) return ready;
  const collectionMap = new Map(collections.map(row => [clean(row.id), row]));
  const matchingCollectionsByClass = new Map(knownClasses.map(className => [className, new Set(collections.filter(collection =>
    schoolCompositeClassMatches(clean(collection.title), [className]) || schoolCompositeClassMatches(clean(collection.slug), [className]))
    .map(collection => clean(collection.id)))]));
  const media = await pages(service, "media", { project_id: projectId });
  for (const row of media) {
    const collection = collectionMap.get(clean(row.collection_id));
    const key = usableOriginal(row.storage_path);
    if (!collection || !key || !visible(row) || (clean(row.mime_type) && !clean(row.mime_type).startsWith("image/")) ||
      (!keyBelongsToSchoolStorage(key, school) && !key.startsWith(`projects/${projectId}/`))) continue;
    const matchingClasses = knownClasses.filter(className => {
      const matching = matchingCollectionsByClass.get(className)!;
      return matching.size ? matching.has(clean(row.collection_id)) : schoolCompositeClassMatches(key, [className]) ||
        schoolCompositeClassMatches(clean(row.filename), [className]);
    });
    if (!matchingClasses.length) continue;
    const folder = key.slice(0, key.lastIndexOf("/"));
    if (folder && (await originals(folder)).has(key)) for (const className of matchingClasses) ready.add(className);
  }
  return ready;
}

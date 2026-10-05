import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSchoolCandidateFolders, loadFolderMediaRows } from "@/lib/storage-folder";
import { findSyncedSchoolProjectId } from "@/lib/school-sync";
import { schoolCompositeClassMatches } from "@/lib/school-composite-scope";
import { fetchEventGalleryMediaRows } from "@/lib/event-download-scope";
import { canonicalPortalOrderReference } from "@/lib/portal-order-media";
import { loadSchoolPhotoTombstones, tombstoneFamilySet } from "@/lib/school-photo-deletions";

type School = { id: string; photographer_id?: string | null; local_school_id?: string | null };
type Student = { id: string; school_id?: string | null; photo_url?: string | null; class_name?: string | null; folder_name?: string | null };
type Composite = { id: string; collection_id: string | null; storage_path: string | null; filename: string | null; created_at: string | null; sort_order: number | null; preview_url: string | null; thumbnail_url: string | null; collection_title?: string };

function classCandidates(values: Array<string | null | undefined>) {
  return [...new Set(values.flatMap(value => {
    const name = (value || "").trim();
    const kindergarten = name.match(/^(s|j)k\s*[- ]?([a-z0-9]+)$/i);
    if (!kindergarten) return name ? [name] : [];
    const level = kindergarten[1].toLowerCase() === "s" ? "Senior Kindergarten" : "Junior Kindergarten", section = kindergarten[2].toUpperCase();
    return [name, `${level} ${section}`, `${level} Class ${section}`, `${level} Class ${section} 2026`];
  }))];
}

export async function loadScopedSchoolCompositeMedia(service: SupabaseClient, school: School | null, classNames: string | null | undefined | Array<string | null | undefined>) {
  const candidates = classCandidates(Array.isArray(classNames) ? classNames : [classNames]);
  if (!school?.id || !school.photographer_id || !candidates.length) return [] as Composite[];
  const projectId = await findSyncedSchoolProjectId(service, school.id, { localSchoolId: school.local_school_id, photographerId: school.photographer_id });
  if (!projectId) return [] as Composite[];
  const collections: Array<{ id: string; title: string | null; slug: string | null }> = [];
  for (let offset = 0; offset < 5000; offset += 500) {
    const { data, error } = await service.from("collections").select("id,title,slug").eq("project_id", projectId).eq("kind", "composite").order("id", { ascending: true }).range(offset, offset + 499);
    if (error) throw error;
    collections.push(...(data ?? []));
    if ((data?.length ?? 0) < 500) break;
    if (offset === 4500) throw new Error("Too many class albums to load safely.");
  }
  const matching = collections.filter(row => schoolCompositeClassMatches(row.title, candidates) || schoolCompositeClassMatches(row.slug, candidates));
  const selected = matching.length ? matching : collections;
  if (!selected.length) return [] as Composite[];
  const media = await fetchEventGalleryMediaRows<Composite>(service, projectId, selected.map(row => row.id), "id,collection_id,storage_path,filename,preview_url,thumbnail_url,created_at,sort_order");
  const titles = new Map(selected.map(row => [row.id, row.title || candidates[0]]));
  return media.filter(row => !!row.storage_path && (matching.length || schoolCompositeClassMatches(row.storage_path, candidates) || schoolCompositeClassMatches(row.filename, candidates)))
    .map(row => ({ ...row, collection_title: titles.get(row.collection_id || "") || candidates[0] }));
}

// Preview tokens identify a choice only. Current student folders/class rows below
// authorize it, so neither an expired preview nor a forged token widens access.
export function schoolOrderPhotoReference(value: string | null | undefined) {
  const canonical = canonicalPortalOrderReference(value);
  if (canonical) return canonical;
  try {
    const url = new URL(value || "", "https://gallery.invalid");
    if (!/^\/api\/portal\/school-preview\/[a-f0-9]{64}\.jpg$/.test(url.pathname)) return null;
    const payload = JSON.parse(Buffer.from((url.searchParams.get("token") || "").split(".")[0], "base64url").toString("utf8"));
    return payload.kind === "school-gallery-preview" ? canonicalPortalOrderReference(payload.mediaKey) : null;
  } catch { return null; }
}

type Entry = { selectedImageUrl: string | null; slots: Array<{ assignedImageUrl: string | null }>; retouchSelections?: Array<{ imageUrl: string; notes: string }>; digitalSelections?: Array<{ mediaId: string; url: string | null }> };
export async function resolveSchoolOrderMediaReferences<T extends Entry>(service: SupabaseClient, schoolId: string, studentId: string, photographerId: string, entries: T[]) {
  if (!entries.some(entry => entry.selectedImageUrl || entry.slots.some(slot => slot.assignedImageUrl) || entry.retouchSelections?.length || entry.digitalSelections?.length)) return;
  const schoolResult = await service.from("schools").select("id,photographer_id,local_school_id").eq("id", schoolId).eq("photographer_id", photographerId).maybeSingle();
  const studentResult = await service.from("students").select("id,school_id,photo_url,class_name,folder_name").eq("school_id", schoolId).eq("id", studentId).maybeSingle();
  if (schoolResult.error) throw schoolResult.error;
  if (studentResult.error) throw studentResult.error;
  const school = schoolResult.data as School | null, student = studentResult.data as Student | null;
  if (!school || !student) throw new Error("School photo access changed. Reopen the gallery.");
  const folders = buildSchoolCandidateFolders({ activeSchool: school, selectedSchoolId: schoolId, studentCandidates: [student] });
  const media = await loadFolderMediaRows(folders, { service, schoolId, photographerId, tombstonedFamilies: tombstoneFamilySet(await loadSchoolPhotoTombstones(service, schoolId, { fresh: true })) });
  const composites = await loadScopedSchoolCompositeMedia(service, school, student.class_name);
  const allowed = new Set([...media, ...composites].map(row => row.storage_path).filter(Boolean));
  const resolve = (value: string | null, mediaId?: string) => {
    if (!value && !mediaId) return null;
    const key = schoolOrderPhotoReference(value || mediaId);
    if (!key || !allowed.has(key) || (mediaId && schoolOrderPhotoReference(mediaId) !== key)) throw new Error("A selected photo is outside this student or class gallery. Reopen the gallery and choose it again.");
    return key;
  };
  for (const entry of entries) {
    entry.selectedImageUrl = resolve(entry.selectedImageUrl);
    for (const slot of entry.slots) slot.assignedImageUrl = resolve(slot.assignedImageUrl);
    for (const selection of entry.retouchSelections ?? []) selection.imageUrl = resolve(selection.imageUrl)!;
    for (const selection of entry.digitalSelections ?? []) selection.url = resolve(selection.url, selection.mediaId);
  }
}

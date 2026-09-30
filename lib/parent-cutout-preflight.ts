import sharp from "sharp";
import type { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { firstPaidCutoutBytes } from "@/lib/credit-cutout-access";
import { privateMediaKeyFromReference } from "@/lib/private-media-references";
import { listR2FolderImages } from "@/lib/r2";
import { buildSignedMediaUrls } from "@/lib/storage-images";
import { buildStudentPhotoFolderPrefixes, filterTombstonedSchoolPhotoAssets, keyBelongsToStudentPhotoFolders, loadSchoolPhotoTombstones, tombstoneFamilySet } from "@/lib/school-photo-deletions";

type Service = ReturnType<typeof createDashboardServiceClient>;
type PhotoRow = { id: string; storage_path: string | null; preview_url?: string | null; thumbnail_url?: string | null; download_url?: string | null; displayReferences?: string[]; gallerySource?: boolean };
export type ParentBackdropEntry = {
  hasBackdrop: boolean;
  allPhotos?: boolean;
  selectedImageUrl?: string | null;
  slots?: Array<{ assignedImageUrl?: string | null }>;
  digitalSelections?: Array<{ mediaId: string; url?: string | null; thumbnailUrl?: string | null }>;
};
export type ParentBackdropContext =
  | { mode: "school"; photographerId: string; schoolId: string; studentId: string }
  | { mode: "event"; photographerId: string; projectId: string; pin: string };

export const PARENT_BACKDROP_UNAVAILABLE = "The selected background is not ready for every chosen photo. Choose Original Background or contact your photographer before checking out.";
export class ParentCutoutPreflightError extends Error {
  constructor() { super(PARENT_BACKDROP_UNAVAILABLE); }
}
const MAX_CUTOUT_PIXELS = 64 * 1024 * 1024;
const clean = (value: string | null | undefined) => (value ?? "").trim();

export function isAllDigitalBackdropPackage(pkg: { name?: string | null; category?: string | null; items?: unknown[] | null }) {
  const text = [pkg.name, pkg.category, ...(pkg.items ?? []).map(item => typeof item === "string" ? item :
    item && typeof item === "object" ? Object.values(item).join(" ") : "")].join(" ").toLowerCase();
  return /digital|download|file|jpeg|jpg|png/.test(text) &&
    (/(all|full|entire|complete)\s+(digital|digitals|downloads|files|gallery|album|collection|photos|images)/.test(text) ||
      /(digital|digitals|downloads|files)\s+(all|full|entire|complete)/.test(text) || /buy all|all photos|all images|all files/.test(text));
}

async function authorizedPhotos(service: Service, context: ParentBackdropContext): Promise<PhotoRow[]> {
  if (context.mode === "school") {
    const [{ data: school, error: schoolError }, { data: student, error: studentError }] = await Promise.all([
      service.from("schools").select("id,local_school_id,photographer_id").eq("id", context.schoolId).eq("photographer_id", context.photographerId).maybeSingle(),
      service.from("students").select("id,school_id,photo_url,class_name,folder_name").eq("id", context.studentId).eq("school_id", context.schoolId).maybeSingle(),
    ]);
    if (schoolError || studentError || !school || !student) throw new ParentCutoutPreflightError();
    const folders = buildStudentPhotoFolderPrefixes({ school, student });
    const deleted = tombstoneFamilySet(await loadSchoolPhotoTombstones(service, context.schoolId, { fresh: true }));
    const originals = new Map<string, PhotoRow>();
    const displayedFamilies = new Set<string>();
    for (const folder of folders) {
      const files = filterTombstonedSchoolPhotoAssets(await listR2FolderImages(folder), deleted);
      for (const file of files) if (keyBelongsToStudentPhotoFolders(file.key, folders)) {
        // Retain exact keys rather than gallery display-family deduplication:
        // photo.JPG and photo.PNG are distinct checkout sources.
        if (originals.has(file.key)) continue;
        // Match loadFolderMediaRows display order/family dedupe for all-photo
        // packages, retaining hidden exact keys only for ambiguity checks and
        // explicit source references. Never reuse another alias's proof.
        const parts = file.key.split("/");
        const name = parts.pop()!;
        const family = [...(parts.length >= 3 ? parts.slice(1) : parts), sourceStem(name)].join("/").toLowerCase();
        const gallerySource = !displayedFamilies.has(family);
        displayedFamilies.add(family);
        originals.set(file.key, { id: file.key, storage_path: file.key, download_url: file.url, gallerySource });
      }
    }
    return [...originals.values()];
  }
  // The route has already validated event access. Match the collection scope
  // exposed by event-gallery-context; a collection PIN must not select another
  // collection, and composite collections are not portrait checkout sources.
  const [projectResult, subjectResult, collectionResult] = await Promise.all([
    service.from("projects").select("id,photographer_id,workflow_type,status,access_mode,access_pin")
      .eq("id", context.projectId).eq("photographer_id", context.photographerId).maybeSingle(),
    service.from("subjects").select("id").eq("project_id", context.projectId).eq("external_ref", context.pin).limit(1).maybeSingle(),
    service.from("collections").select("id,slug,kind,access_mode,access_pin").eq("project_id", context.projectId),
  ]);
  const project = projectResult.data;
  if (projectResult.error || subjectResult.error || collectionResult.error || !project || clean(project.workflow_type).toLowerCase() !== "event" || clean(project.status).toLowerCase() === "inactive") throw new ParentCutoutPreflightError();
  const rows = collectionResult.data;
  const collections = rows ?? [];
  const matching = collections.find(row => clean(row.slug) === context.pin ||
    (["pin", "protected", "private"].includes(clean(row.access_mode).toLowerCase()) && clean(row.access_pin) === context.pin));
  const projectPinMatches = ["pin", "protected", "private"].includes(clean(project.access_mode).toLowerCase()) && clean(project.access_pin) === context.pin;
  if (!matching && !subjectResult.data && !projectPinMatches) throw new ParentCutoutPreflightError();
  const scoped = (matching ? collections.filter(row => row.id === matching.id) : collections)
    .filter(row => !clean(row.kind) || ["album", "gallery"].includes(clean(row.kind).toLowerCase()));
  if (!scoped.length) return [];
  const photos = new Map<string, PhotoRow>();
  let expectedCount: number | null = null;
  // Supabase caps rows per response; paginate rather than approving an
  // incomplete all-gallery package or adding a new package-size restriction.
  for (let from = 0; ;) {
    const result = await service.from("media").select("id,storage_path,preview_url,thumbnail_url", { count: "exact" })
      .eq("project_id", context.projectId).in("collection_id", scoped.map(row => row.id))
      .order("id", { ascending: true }).range(from, from + 999);
    if (result.error) throw new ParentCutoutPreflightError();
    if (!Number.isSafeInteger(result.count) || result.count === null || result.count < 0 || (expectedCount !== null && result.count !== expectedCount)) throw new ParentCutoutPreflightError();
    expectedCount = result.count;
    const page = result.data ?? [];
    for (const row of page) {
      if (!row.id || photos.has(row.id)) throw new ParentCutoutPreflightError();
      // Use exactly the server gallery resolver, retaining raw storage keys
      // for proof lookup and adding only its generated display/download refs.
      const display = buildSignedMediaUrls({ storagePath: row.storage_path, previewUrl: row.preview_url, thumbnailUrl: row.thumbnail_url });
      photos.set(row.id, { ...row, displayReferences: Object.values(display) });
    }
    if (photos.size === expectedCount) break;
    if (!page.length || photos.size > expectedCount) throw new ParentCutoutPreflightError();
    from += page.length;
  }
  return [...photos.values()];
}

function sourceStem(key: string) {
  let base = key;
  for (let i = 0; i < 3; i++) { base = base.replace(/\.[^./]+$/, "").replace(/_(preview|thumbnail|cutout|nobg)$/i, ""); }
  return base.toLowerCase();
}

function candidateCutoutKeys(key: string, allowStemFallback: boolean) {
  const slash = key.lastIndexOf("/");
  if (slash < 1 || key.startsWith("nobg-photos/") || key.startsWith("thumbs/")) return [];
  const folder = key.slice(0, slash);
  let base = key.slice(slash + 1);
  for (let i = 0; i < 3; i++) { base = base.replace(/\.[^.]+$/, "").replace(/_(preview|thumbnail|cutout|nobg)$/i, ""); }
  return [...new Set([`${key}.png`, `${key}_cutout.png`, `${key}_nobg.png`, ...(allowStemFallback ? [`${folder}/${base}_cutout.png`, `${folder}/${base}_nobg.png`, `${folder}/${base}.png`] : [])])]
    .map(path => `nobg-photos/${path}`);
}

async function usableCutout(bytes: Buffer) {
  const image = sharp(bytes, { animated: false, failOn: "error", limitInputPixels: MAX_CUTOUT_PIXELS });
  const meta = await image.metadata();
  if (meta.format !== "png" || !meta.hasAlpha || !meta.width || !meta.height || meta.width * meta.height > MAX_CUTOUT_PIXELS || (meta.pages ?? 1) > 1) return false;
  const alpha = (await image.stats()).channels[(meta.channels ?? 0) - 1];
  return !!alpha && Number.isFinite(alpha.min) && Number.isFinite(alpha.max) && alpha.min < 255 && alpha.max > 0 && alpha.max <= 255;
}

/** Read-only preflight, after gallery/package authorization and before writes.
 * References are resolved to server-owned rows before any cutout lookup. No
 * caller URL is fetched, no basename/source-hash alias grants authorization.
 * This cannot atomically lock R2/proof state through later payment/fulfillment;
 * those consumers must retain their own paid-byte checks.
 */
export async function assertParentBackdropCutouts(service: Service, context: ParentBackdropContext, entries: ParentBackdropEntry[]) {
  const chosen = entries.filter(entry => entry.hasBackdrop);
  if (!chosen.length) return;
  try {
    const photos = await authorizedPhotos(service, context);
    const stemSources = new Map<string, Set<string>>();
    for (const row of photos) {
      const key = privateMediaKeyFromReference(row.storage_path);
      if (key) { const stem = sourceStem(key); const keys = stemSources.get(stem) ?? new Set<string>(); keys.add(key); stemSources.set(stem, keys); }
    }
    const byId = new Map(photos.map(row => [row.id, row]));
    const byReference = new Map<string, PhotoRow | null>();
    for (const row of photos) for (const value of [row.storage_path, row.preview_url, row.thumbnail_url, row.download_url, ...(row.displayReferences ?? [])]) {
      const key = privateMediaKeyFromReference(value);
      if (key) byReference.set(key, byReference.has(key) && byReference.get(key)?.id !== row.id ? null : row);
    }
    const targets = new Map<string, PhotoRow>();
    const addReference = (value: string | null | undefined) => {
      const key = privateMediaKeyFromReference(value);
      const row = key ? byReference.get(key) : null;
      if (!row) throw new ParentCutoutPreflightError();
      targets.set(row.id, row);
    };
    for (const entry of chosen) {
      if (entry.allPhotos) {
        const galleryPhotos = photos.filter(row => row.gallerySource !== false);
        if (!galleryPhotos.length) throw new ParentCutoutPreflightError();
        for (const row of galleryPhotos) targets.set(row.id, row);
      }
      for (const slot of entry.slots ?? []) {
        if (entry.allPhotos && !slot.assignedImageUrl) continue;
        addReference(slot.assignedImageUrl);
      }
      if (entry.selectedImageUrl) addReference(entry.selectedImageUrl);
      for (const selection of entry.digitalSelections ?? []) {
        const row = byId.get(selection.mediaId);
        if (!row) throw new ParentCutoutPreflightError();
        // Stored snapshots/fulfillment use URL or thumbnail fallbacks. Check
        // every supplied reference, so a valid media ID cannot smuggle a
        // different person's image into the persisted order.
        const refs = [selection.url, selection.thumbnailUrl].filter((value): value is string => !!value);
        if (!refs.length || refs.some(value => byReference.get(privateMediaKeyFromReference(value))?.id !== row.id)) throw new ParentCutoutPreflightError();
        targets.set(row.id, row);
      }
      if (!entry.allPhotos && !(entry.slots?.length || entry.selectedImageUrl || entry.digitalSelections?.length)) throw new ParentCutoutPreflightError();
    }
    if (!targets.size) throw new ParentCutoutPreflightError();
    for (const row of targets.values()) {
      const originalKey = privateMediaKeyFromReference(row.storage_path);
      if (!originalKey) throw new ParentCutoutPreflightError();
      const bytes = await firstPaidCutoutBytes(candidateCutoutKeys(originalKey, stemSources.get(sourceStem(originalKey))?.size === 1), { service, photographerId: context.photographerId });
      if (!bytes || !(await usableCutout(bytes))) throw new ParentCutoutPreflightError();
    }
  } catch { throw new ParentCutoutPreflightError(); }
}

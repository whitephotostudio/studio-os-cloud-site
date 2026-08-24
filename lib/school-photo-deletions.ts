import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeR2Key } from "@/lib/r2-access-security";
import { r2KeyFromAnyUrl } from "@/lib/r2-signed-urls";
import { extractStoragePathFromSupabaseUrl } from "@/lib/storage-images";

type SupabaseClientLike = SupabaseClient;

export type SchoolPhotoDeletionRow = {
  id: string;
  storage_key: string;
  storage_family: string;
  student_id?: string | null;
  created_at?: string | null;
};

export type SchoolPhotoAsset = {
  key: string;
  name: string;
  url: string;
};

type SchoolIdentity = {
  id: string;
  local_school_id?: string | null;
};

type StudentFolderIdentity = {
  photo_url?: string | null;
  class_name?: string | null;
  folder_name?: string | null;
};

const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|avif|heic|heif|tiff?)$/i;
const DERIVED_SUFFIX = /_(preview|thumbnail|cutout|nobg)$/i;
const RESERVED_STORAGE_ROOTS = new Set([
  "schools",
  "photos",
  "projects",
  "nobg-photos",
  "thumbs",
  "backdrops",
  "probes",
]);
const TOMBSTONE_PAGE_SIZE = 1_000;
const TOMBSTONE_CACHE_TTL_MS = 3_000;
const TOMBSTONE_CACHE_MAX_ENTRIES = 128;

type TombstoneCacheEntry = {
  expiresAt: number;
  promise: Promise<SchoolPhotoDeletionRow[]>;
};

const tombstoneCache = new Map<string, TombstoneCacheEntry>();

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => clean(value)).filter(Boolean)));
}

function safeStorageSegment(value: string | null | undefined) {
  return clean(value)
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function safeLocalSchoolStorageId(
  value: string | null | undefined,
) {
  const raw = value ?? "";
  const candidate = raw.trim();
  if (!candidate || candidate !== raw) return null;
  if (candidate.includes("/")) return null;
  if (RESERVED_STORAGE_ROOTS.has(candidate.toLowerCase())) return null;
  return normalizeR2Key(candidate) === candidate ? candidate : null;
}

export function isMissingSchoolPhotoDeletionsTable(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "42P01"
  );
}

/**
 * Convert any original/preview/thumbnail/cutout representation into one stable
 * family id. Object-key case remains significant because R2 keys are
 * case-sensitive.
 */
export function schoolPhotoFamilyForKey(value: string | null | undefined) {
  let key = normalizeR2Key(value, { allowQueryCharacters: true });
  if (!key) return null;

  while (key.startsWith("nobg-photos/") || key.startsWith("thumbs/")) {
    if (key.startsWith("nobg-photos/")) {
      key = key.slice("nobg-photos/".length);
    } else {
      key = key.slice("thumbs/".length);
    }
  }

  // Tombstones are school-relative, not root-relative. Desktop generations
  // have used local-id/, database-id/, schools/<id>/, and photos/<id>/ for
  // the same logical photo. One tombstone must hide every alias.
  const keySegments = key.split("/");
  if (
    (keySegments[0] === "schools" || keySegments[0] === "photos") &&
    keySegments.length >= 3
  ) {
    key = keySegments.slice(2).join("/");
  } else if (keySegments.length >= 2) {
    key = keySegments.slice(1).join("/");
  }

  const slash = key.lastIndexOf("/");
  const folder = slash >= 0 ? key.slice(0, slash) : "";
  let filename = slash >= 0 ? key.slice(slash + 1) : key;

  // Some local background-removal builds emitted `photo.jpg.png`; remove a
  // second image extension only when it is itself a known image extension.
  filename = filename.replace(IMAGE_EXTENSION, "");
  filename = filename.replace(DERIVED_SUFFIX, "");
  filename = filename.replace(IMAGE_EXTENSION, "");
  if (!filename) return null;

  return folder ? `${folder}/${filename}` : filename;
}

export function canonicalOriginalSchoolPhotoKey(
  value: string | null | undefined,
) {
  const key = normalizeR2Key(value, { allowQueryCharacters: true });
  if (!key || !IMAGE_EXTENSION.test(key)) return null;
  if (key.startsWith("nobg-photos/") || key.startsWith("thumbs/")) return null;

  const baseWithNoExtension = key.replace(IMAGE_EXTENSION, "");
  if (DERIVED_SUFFIX.test(baseWithNoExtension)) return null;
  return key;
}

/** Full logical family, retained for the later permanent-cleanup phase. */
export function schoolPhotoVariantKeys(originalKey: string) {
  const canonical = canonicalOriginalSchoolPhotoKey(originalKey);
  if (!canonical) return [];
  const base = canonical.replace(IMAGE_EXTENSION, "");

  return unique([
    canonical,
    `${base}_preview.jpg`,
    `${base}_thumbnail.jpg`,
    `${base}_cutout.png`,
    `${base}_nobg.png`,
    `nobg-photos/${canonical}.png`,
    `nobg-photos/${canonical}_cutout.png`,
    `nobg-photos/${canonical}_nobg.png`,
    `nobg-photos/${base}.png`,
    `nobg-photos/${base}_cutout.png`,
    `nobg-photos/${base}_nobg.png`,
  ]);
}

export function storageKeyFromSchoolPhotoReference(
  value: string | null | undefined,
) {
  try {
    const raw = clean(value);
    const isEncodedReference =
      /^https?:\/\//i.test(raw) ||
      /^\/?api\/r2\/img\//i.test(raw) ||
      raw.includes("/storage/v1/");
    const r2Key = isEncodedReference ? r2KeyFromAnyUrl(raw) : raw;
    const extractedFromStorage = isEncodedReference
      ? extractStoragePathFromSupabaseUrl(raw)
      : null;
    // Supabase object URLs need their storage marker stripped by the storage
    // helper. R2 S3 URLs need their leading bucket stripped by r2KeyFromAnyUrl.
    const extracted = r2Key.startsWith("storage/v1/")
      ? extractedFromStorage || r2Key
      : r2Key || extractedFromStorage;
    return normalizeR2Key(extracted, { allowQueryCharacters: true });
  } catch {
    return null;
  }
}

export function schoolPhotoReferenceMatchesFamily(
  reference: string | null | undefined,
  families: ReadonlySet<string>,
) {
  const key = storageKeyFromSchoolPhotoReference(reference);
  const family = schoolPhotoFamilyForKey(key);
  return !!family && families.has(family);
}

export function clearTombstonedSchoolPhotoReferences<
  T extends { photo_url: string | null },
>(rows: T[], families: ReadonlySet<string>) {
  if (!families.size) return rows;
  return rows.map((row) =>
    schoolPhotoReferenceMatchesFamily(row.photo_url, families)
      ? { ...row, photo_url: null }
      : row,
  );
}

export function schoolStorageRoots(school: SchoolIdentity) {
  const identifiers = unique([
    school.id,
    safeLocalSchoolStorageId(school.local_school_id),
  ]);
  return unique([
    ...identifiers,
    ...identifiers.map((id) => `schools/${id}`),
    ...identifiers.map((id) => `photos/${id}`),
  ]).sort((a, b) => b.length - a.length);
}

export function keyBelongsToSchoolStorage(
  key: string,
  school: SchoolIdentity,
) {
  const normalized = normalizeR2Key(key, { allowQueryCharacters: true });
  if (!normalized) return false;
  return schoolStorageRoots(school).some(
    (root) => normalized === root || normalized.startsWith(`${root}/`),
  );
}

/**
 * Exact folder prefixes authorized for one student. The representative photo
 * is authoritative for legacy paths; generated candidates cover current
 * database-id/local-id and schools/photos namespaced roots.
 */
export function buildStudentPhotoFolderPrefixes(params: {
  school: SchoolIdentity;
  student: StudentFolderIdentity;
}) {
  const roots = schoolStorageRoots(params.school);
  const className = safeStorageSegment(params.student.class_name);
  const folderName = safeStorageSegment(params.student.folder_name);
  const fromRepresentative = storageKeyFromSchoolPhotoReference(
    params.student.photo_url,
  );
  const representativeFolder = fromRepresentative?.includes("/")
    ? fromRepresentative.slice(0, fromRepresentative.lastIndexOf("/"))
    : null;

  return unique([
    representativeFolder &&
    keyBelongsToSchoolStorage(representativeFolder, params.school)
      ? representativeFolder
      : null,
    ...(className && folderName
      ? roots.map((root) => `${root}/${className}/${folderName}`)
      : []),
  ]);
}

export function keyBelongsToStudentPhotoFolders(
  key: string,
  folderPrefixes: string[],
) {
  const normalized = canonicalOriginalSchoolPhotoKey(key);
  if (!normalized) return false;
  return folderPrefixes.some((folder) => {
    const prefix = normalizeR2Key(folder, { allowQueryCharacters: true });
    if (!prefix || !normalized.startsWith(`${prefix}/`)) return false;
    // Originals live directly inside the student's folder. This prevents a
    // crafted key from reaching an arbitrary nested folder.
    return !normalized.slice(prefix.length + 1).includes("/");
  });
}

export async function loadSchoolPhotoTombstones(
  service: SupabaseClientLike,
  schoolId: string,
  options?: { since?: string | null; fresh?: boolean },
): Promise<SchoolPhotoDeletionRow[]> {
  const normalizedSchoolId = clean(schoolId);
  const normalizedSince = clean(options?.since);
  const cacheable = Boolean(normalizedSchoolId && !normalizedSince);
  const now = Date.now();

  if (cacheable && !options?.fresh) {
    const cached = tombstoneCache.get(normalizedSchoolId);
    if (cached && cached.expiresAt > now) return cached.promise;
    if (cached) tombstoneCache.delete(normalizedSchoolId);
  }

  const loadPages = async () => {
    const rows: SchoolPhotoDeletionRow[] = [];
    for (let from = 0; ; from += TOMBSTONE_PAGE_SIZE) {
      let query = service
        .from("school_photo_deletions")
        .select("id,storage_key,storage_family,student_id,created_at")
        .eq("school_id", normalizedSchoolId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + TOMBSTONE_PAGE_SIZE - 1);
      if (normalizedSince) {
        query = query.gte("created_at", normalizedSince);
      }

      const { data, error } = await query;
      if (error) {
        // Read paths stay available during a migration-first deployment. The
        // DELETE route itself fails closed if its required insert cannot run.
        if (isMissingSchoolPhotoDeletionsTable(error)) return [];
        throw error;
      }

      const page = (data ?? []) as SchoolPhotoDeletionRow[];
      rows.push(...page);
      if (page.length < TOMBSTONE_PAGE_SIZE) break;
    }

    return rows;
  };

  const promise = loadPages();
  if (cacheable) {
    for (const [key, entry] of tombstoneCache) {
      if (entry.expiresAt <= now) tombstoneCache.delete(key);
    }
    while (tombstoneCache.size >= TOMBSTONE_CACHE_MAX_ENTRIES) {
      const oldestKey = tombstoneCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      tombstoneCache.delete(oldestKey);
    }
    tombstoneCache.set(normalizedSchoolId, {
      expiresAt: now + TOMBSTONE_CACHE_TTL_MS,
      promise,
    });
  }

  try {
    return await promise;
  } catch (error) {
    if (cacheable) tombstoneCache.delete(normalizedSchoolId);
    throw error;
  }
}

export function invalidateSchoolPhotoTombstones(schoolId: string) {
  tombstoneCache.delete(clean(schoolId));
}

export function tombstoneFamilySet(rows: SchoolPhotoDeletionRow[]) {
  return new Set(
    rows
      .map(
        (row) =>
          clean(row.storage_family) || schoolPhotoFamilyForKey(row.storage_key),
      )
      .filter((value): value is string => Boolean(value)),
  );
}

export function filterTombstonedSchoolPhotoAssets<T extends { key: string }>(
  assets: T[],
  families: ReadonlySet<string>,
) {
  if (!families.size) return assets;
  return assets.filter((asset) => {
    const family = schoolPhotoFamilyForKey(asset.key);
    return !family || !families.has(family);
  });
}

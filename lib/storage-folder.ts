import { listR2FolderImages } from "@/lib/r2";
import { r2PresignedGetUrl } from "@/lib/r2-signed-urls";
import { extractStoragePathFromSupabaseUrl } from "@/lib/storage-images";

type StudentFolderLike = {
  id: string;
  school_id?: string | null;
  photo_url?: string | null;
  class_name?: string | null;
  folder_name?: string | null;
};

type SchoolFolderLike = {
  id: string;
  local_school_id?: string | null;
};

export type FolderMediaRow = {
  id: string;
  storage_path: string;
  preview_url: string;
  thumbnail_url: string;
  download_url: string;
  filename: string;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function uniqueFolders(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => clean(value)).filter(Boolean)));
}

function folderFromPhotoUrl(photoUrl: string | null | undefined) {
  const storagePath = extractStoragePathFromSupabaseUrl(photoUrl);
  if (!storagePath) return null;
  const lastSlash = storagePath.lastIndexOf("/");
  if (lastSlash === -1) return null;
  return storagePath.slice(0, lastSlash);
}

function photoBaseNameFromFileName(name: string | null | undefined) {
  let base = clean(name).split(/[?#]/)[0].split("/").pop() ?? "";
  for (let index = 0; index < 3; index += 1) {
    base = base.replace(/\.[^.]+$/i, "");
    base = base.replace(/_(preview|thumbnail|cutout|nobg)$/i, "");
  }
  return base;
}

function folderFromStoragePath(storagePath: string | null | undefined) {
  const normalized = clean(storagePath)
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) return null;
  return normalized.slice(0, lastSlash);
}

function photoDedupeKey(storagePath: string | null | undefined, url: string) {
  const normalizedPath = clean(storagePath)
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
  if (!normalizedPath) return `url:${clean(url).split("?")[0].toLowerCase()}`;

  const parts = normalizedPath.split("/").filter(Boolean);
  const fileBase = photoBaseNameFromFileName(parts.pop());
  const folderParts = parts.length >= 3 ? parts.slice(1) : parts;
  return `photo:${[...folderParts, fileBase].join("/").toLowerCase()}`;
}

function nobgCandidatePathsForStoragePath(storagePath: string | null | undefined) {
  const normalizedStoragePath = clean(storagePath)
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
  const folder = folderFromStoragePath(storagePath);
  const baseName = photoBaseNameFromFileName(storagePath);
  if (!folder || !baseName) return [];

  return uniqueFolders([
    normalizedStoragePath ? `${normalizedStoragePath}.png` : null,
    normalizedStoragePath ? `${normalizedStoragePath}_cutout.png` : null,
    normalizedStoragePath ? `${normalizedStoragePath}_nobg.png` : null,
    `${folder}/${baseName}_cutout.png`,
    `${folder}/${baseName}_nobg.png`,
    `${folder}/${baseName}.png`,
  ]);
}

export function buildSchoolCandidateFolders(params: {
  studentCandidates: StudentFolderLike[];
  activeSchool: SchoolFolderLike | null | undefined;
  selectedSchoolId?: string | null;
}) {
  const schoolBaseId =
    clean(params.activeSchool?.local_school_id) ||
    clean(params.activeSchool?.id) ||
    clean(params.selectedSchoolId);

  return uniqueFolders([
    ...params.studentCandidates.map((student) => folderFromPhotoUrl(student.photo_url)),
    ...params.studentCandidates.map((student) => {
      const className = clean(student.class_name);
      const folderName = clean(student.folder_name);
      if (!schoolBaseId || !className || !folderName) return null;
      return `${schoolBaseId}/${className}/${folderName}`;
    }),
  ]);
}

export async function loadFolderMediaRows(folderPaths: string[]) {
  const mediaRows: FolderMediaRow[] = [];
  const seenPhotoKeys = new Set<string>();

  for (const folderPath of uniqueFolders(folderPaths)) {
    const files = await listR2FolderImages(folderPath);
    for (const file of files) {
      const dedupeKey = photoDedupeKey(file.key, file.url);
      if (seenPhotoKeys.has(dedupeKey)) continue;
      seenPhotoKeys.add(dedupeKey);
      mediaRows.push({
        id: file.key,
        storage_path: file.key,
        preview_url: file.url,
        thumbnail_url: file.url,
        download_url: file.url,
        filename: file.name,
      });
    }
  }

  return mediaRows;
}

export async function loadNoBgUrlMapForMediaRows(
  mediaRows: FolderMediaRow[],
  options?: { ttlSeconds?: number },
) {
  const noBgUrls: Record<string, string> = {};
  const expectedPathToMediaId = new Map<string, string>();

  for (const row of mediaRows) {
    for (const path of nobgCandidatePathsForStoragePath(row.storage_path)) {
      expectedPathToMediaId.set(path.toLowerCase(), row.id);
    }
  }

  if (!expectedPathToMediaId.size) return noBgUrls;

  const folders = uniqueFolders(
    mediaRows
      .map((row) => folderFromStoragePath(row.storage_path))
      .filter((folder): folder is string => Boolean(folder))
      .map((folder) => `nobg-photos/${folder}`),
  );

  for (const folder of folders) {
    const files = await listR2FolderImages(folder);
    for (const file of files) {
      const withoutPrefix = file.key.replace(/^nobg-photos\//i, "");
      const mediaId = expectedPathToMediaId.get(withoutPrefix.toLowerCase());
      if (!mediaId || noBgUrls[mediaId]) continue;
      noBgUrls[mediaId] = r2PresignedGetUrl(
        file.key,
        options?.ttlSeconds,
      );
    }
  }

  return noBgUrls;
}

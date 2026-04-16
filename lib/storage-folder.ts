import { listR2FolderImages } from "@/lib/r2";
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

  for (const folderPath of uniqueFolders(folderPaths)) {
    const files = await listR2FolderImages(folderPath);
    for (const file of files) {
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

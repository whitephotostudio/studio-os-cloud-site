import type { SupabaseClient } from "@supabase/supabase-js";
import {
  appendSchoolMediaRows,
  ensureSchoolCollectionId,
} from "@/lib/school-sync";
import {
  buildStoredMediaUrls,
  extractStoragePathFromSupabaseUrl,
} from "@/lib/storage-images";
import { listR2FolderImages, r2DeleteWithVariants, r2Upload } from "@/lib/r2";

type SupabaseClientLike = SupabaseClient;

export type DashboardSchoolRow = {
  id: string;
  school_name: string | null;
  local_school_id: string | null;
  photographer_id: string | null;
  portal_status?: string | null;
  status?: string | null;
};

export type DashboardStudentRow = {
  id: string;
  school_id?: string | null;
  first_name: string;
  last_name: string | null;
  pin: string;
  photo_url: string | null;
  class_id: string | null;
  class_name: string | null;
  folder_name: string | null;
  external_student_id: string | null;
};

export type UploadedStudentAsset = {
  storagePath: string;
  publicUrl: string;
  filename: string;
  mimeType: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

export function splitDisplayName(value: string) {
  const parts = clean(value).split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" ") || null,
  };
}

export function safeStorageSegment(value: string, fallback: string) {
  return (
    clean(value)
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || fallback
  );
}

function extractObjectPathFromPublicUrl(url: string) {
  return extractStoragePathFromSupabaseUrl(url);
}

export function extractFolderPathFromPublicUrl(url: string) {
  const objectPath = extractObjectPathFromPublicUrl(url);
  if (!objectPath) return null;
  const lastSlash = objectPath.lastIndexOf("/");
  if (lastSlash === -1) return null;
  return objectPath.substring(0, lastSlash);
}

/** Maximum file size per upload: 25 MB */
export const MAX_UPLOAD_FILE_SIZE = 25 * 1024 * 1024;

/** Maximum number of files per upload request */
export const MAX_UPLOAD_FILE_COUNT = 50;

export function collectImageFiles(formData: FormData, key = "photos") {
  const files = formData
    .getAll(key)
    .filter((value): value is File => value instanceof File && value.size > 0)
    .filter(
      (file) =>
        file.type.startsWith("image/") || /\.(png|jpg|jpeg|webp)$/i.test(file.name),
    );

  // Enforce per-file size limit
  const oversized = files.find((f) => f.size > MAX_UPLOAD_FILE_SIZE);
  if (oversized) {
    const sizeMB = (oversized.size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `File "${oversized.name}" is ${sizeMB} MB — exceeds the 25 MB limit.`,
    );
  }

  // Enforce file count limit
  if (files.length > MAX_UPLOAD_FILE_COUNT) {
    throw new Error(
      `Too many files (${files.length}). Please upload at most ${MAX_UPLOAD_FILE_COUNT} at a time.`,
    );
  }

  return files;
}

export async function loadOwnedSchool(params: {
  service: SupabaseClientLike;
  schoolId: string;
  photographerId: string;
}) {
  const { data, error } = await params.service
    .from("schools")
    .select("id,school_name,local_school_id,photographer_id,portal_status,status")
    .eq("id", params.schoolId)
    .eq("photographer_id", params.photographerId)
    .maybeSingle<DashboardSchoolRow>();

  if (error) throw error;
  return data;
}

export async function loadOwnedStudent(params: {
  service: SupabaseClientLike;
  schoolId: string;
  studentId: string;
}) {
  const { data, error } = await params.service
    .from("students")
    .select(
      "id,school_id,first_name,last_name,pin,photo_url,class_id,class_name,folder_name,external_student_id",
    )
    .eq("id", params.studentId)
    .eq("school_id", params.schoolId)
    .maybeSingle<DashboardStudentRow>();

  if (error) throw error;
  return data;
}

async function removeUploadedAssets(
  service: SupabaseClientLike,
  storagePaths: string[],
) {
  void service;
  if (!storagePaths.length) return;
  try {
    await r2DeleteWithVariants(storagePaths);
  } catch (error) {
    console.warn("Failed to remove uploaded student assets after rollback:", error);
  }
}

export async function uploadStudentAssets(params: {
  service: SupabaseClientLike;
  schoolId: string;
  school: DashboardSchoolRow;
  className: string;
  folderName: string;
  files: File[];
}) {
  const basePath = safeStorageSegment(
    clean(params.school.local_school_id) || params.schoolId,
    params.schoolId,
  );
  const classPath = safeStorageSegment(params.className, "Class");
  const storageFolderPath = `${basePath}/${classPath}/${params.folderName}`;
  const uploadedAssets: UploadedStudentAsset[] = [];

  try {
    for (const [index, file] of params.files.entries()) {
      const originalExt = file.name.includes(".")
        ? file.name.split(".").pop()
        : "jpg";
      const ext = clean(originalExt).toLowerCase() || "jpg";
      const storagePath = `${storageFolderPath}/${Date.now()}-${index}-${Math.random().toString(36).slice(2)}.${ext}`;
      const bytes = Buffer.from(await file.arrayBuffer());
      const publicUrl = await r2Upload(
        storagePath,
        bytes,
        file.type || "application/octet-stream",
      );

      if (clean(publicUrl)) {
        uploadedAssets.push({
          storagePath,
          publicUrl,
          filename: file.name,
          mimeType: file.type || null,
        });
      }
    }

    return {
      folderPath: storageFolderPath,
      uploadedAssets,
      uploadedUrls: uploadedAssets
        .map((asset) => asset.publicUrl)
        .filter(Boolean),
    };
  } catch (error) {
    await removeUploadedAssets(
      params.service,
      uploadedAssets.map((asset) => asset.storagePath),
    );
    throw error;
  }
}

export async function syncStudentAssets(params: {
  service: SupabaseClientLike;
  schoolId: string;
  school: DashboardSchoolRow;
  className: string;
  uploadedAssets: UploadedStudentAsset[];
}) {
  const syncTarget = await ensureSchoolCollectionId(params.service, {
    schoolId: params.schoolId,
    school: params.school,
    kind: "class",
    title: params.className,
    slugFallback: "class",
  });

  if (syncTarget.projectId && syncTarget.collectionId && params.uploadedAssets.length) {
    await appendSchoolMediaRows(params.service, {
      projectId: syncTarget.projectId,
      collectionId: syncTarget.collectionId,
      assets: params.uploadedAssets,
    });
  }

  return syncTarget;
}

export function listStorageFolderAssets(
  service: SupabaseClientLike,
  folderPath: string,
) {
  void service;
  return listR2FolderImages(folderPath)
    .then((files) => ({ data: files, error: null }))
    .catch((error) => ({
      data: null,
      error: error instanceof Error ? error : new Error("Failed to list storage folder."),
    }));
}

export function storageFilePublicUrl(
  service: SupabaseClientLike,
  folderPath: string,
  file: { name: string; url?: string },
) {
  void service;
  return clean(file.url) || buildStoredMediaUrls({
    storagePath: `${folderPath}/${file.name}`,
  }).previewUrl || "";
}

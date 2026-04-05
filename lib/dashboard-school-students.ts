import type { SupabaseClient } from "@supabase/supabase-js";
import {
  appendSchoolMediaRows,
  ensureSchoolCollectionId,
} from "@/lib/school-sync";

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
  try {
    const marker = "/storage/v1/object/public/thumbs/";
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    return decodeURIComponent(url.substring(idx + marker.length));
  } catch {
    return null;
  }
}

export function extractFolderPathFromPublicUrl(url: string) {
  const objectPath = extractObjectPathFromPublicUrl(url);
  if (!objectPath) return null;
  const lastSlash = objectPath.lastIndexOf("/");
  if (lastSlash === -1) return null;
  return objectPath.substring(0, lastSlash);
}

export function collectImageFiles(formData: FormData, key = "photos") {
  return formData
    .getAll(key)
    .filter((value): value is File => value instanceof File && value.size > 0)
    .filter(
      (file) =>
        file.type.startsWith("image/") || /\.(png|jpg|jpeg|webp)$/i.test(file.name),
    );
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
  if (!storagePaths.length) return;
  const { error } = await service.storage.from("thumbs").remove(storagePaths);
  if (error) {
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
      const bytes = new Uint8Array(await file.arrayBuffer());

      const { error: uploadError } = await params.service.storage
        .from("thumbs")
        .upload(storagePath, bytes, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || undefined,
        });

      if (uploadError) {
        throw new Error(uploadError.message || "Photo upload failed.");
      }

      const publicUrl = params.service.storage
        .from("thumbs")
        .getPublicUrl(storagePath).data.publicUrl;

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
  return service.storage.from("thumbs").list(folderPath, {
    limit: 1000,
    sortBy: { column: "name", order: "asc" },
  });
}

export function storageFilePublicUrl(
  service: SupabaseClientLike,
  folderPath: string,
  file: { name: string },
) {
  return service.storage
    .from("thumbs")
    .getPublicUrl(`${folderPath}/${file.name}`).data.publicUrl;
}

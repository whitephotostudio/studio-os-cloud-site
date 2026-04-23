"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  FolderPlus,
  KeyRound,
  Menu,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  appendSchoolMediaRows,
  ensureSchoolCollectionId,
  findSyncedSchoolProjectId,
} from "@/lib/school-sync";
import { generateThumbnails } from "@/lib/generate-thumbnails-client";
import { uploadToR2 } from "@/lib/upload-to-r2-client";
import {
  buildStoredMediaUrls,
  extractStoragePathFromSupabaseUrl,
} from "@/lib/storage-images";

type School = {
  id: string;
  school_name: string;
  local_school_id: string | null;
  photographer_id?: string | null;
  portal_status?: string | null;
  status?: string | null;
};

type ClassCollectionRow = {
  id: string;
  title: string | null;
  slug: string | null;
  kind: string | null;
};

type Student = {
  id: string;
  first_name: string;
  last_name: string | null;
  pin: string;
  photo_url: string | null;
  class_id: string | null;
  class_name: string | null;
  folder_name: string | null;
  external_student_id: string | null;
};

type UploadedStudentAsset = {
  storagePath: string;
  publicUrl: string;
  filename: string;
  mimeType: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function fullNameOf(student: Student) {
  return `${student.first_name} ${student.last_name ?? ""}`.trim();
}

function extractObjectPathFromPublicUrl(url: string): string | null {
  return extractStoragePathFromSupabaseUrl(url);
}

function extractFolderPathFromPublicUrl(url: string): string | null {
  const objectPath = extractObjectPathFromPublicUrl(url);
  if (!objectPath) return null;
  const lastSlash = objectPath.lastIndexOf("/");
  if (lastSlash === -1) return null;
  return objectPath.substring(0, lastSlash);
}

function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function slugify(value: string) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "class";
}

function safeStorageSegment(value: string, fallback: string) {
  return (
    clean(value)
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || fallback
  );
}

function assetFromPublicUrl(url: string): UploadedStudentAsset | null {
  const storagePath = extractObjectPathFromPublicUrl(url);
  if (!storagePath) return null;
  const filename = decodeURIComponent(
    storagePath.split("/").filter(Boolean).at(-1) || "photo.jpg",
  );
  return {
    storagePath,
    publicUrl:
      buildStoredMediaUrls({
        storagePath,
        previewUrl: url,
      }).previewUrl || url,
    filename,
    mimeType: null,
  };
}

function imageFilesOnly(files: File[]) {
  return files.filter(
    (file) => !!file && (file.type.startsWith("image/") || /\.(png|jpg|jpeg|webp)$/i.test(file.name))
  );
}

export default function SchoolsSchoolClassPage() {
  const supabase = useMemo(() => createClient(), []);
  const params = useParams();
  const searchParams = useSearchParams();
  // Spotlight search deep-links here with ?student=<id>. When that id
  // matches a loaded student, we scroll to the card and briefly flash
  // a highlight ring. Tracked as state (not just the URL param) so we
  // can clear the highlight after the flash without losing the param.
  const focusStudentIdFromUrl = searchParams?.get("student") ?? null;
  const focusAppliedRef = useRef(false);
  const [focusStudentId, setFocusStudentId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetStudentRef = useRef<Student | null>(null);
  const folderImagesCacheRef = useRef<Map<string, string[]>>(new Map());
  const schoolId = String(params?.schoolId ?? "");
  const className = decodeURIComponent(String(params?.classId ?? ""));

  const [loading, setLoading] = useState(true);
  const [school, setSchool] = useState<School | null>(null);
  const [classDisplayName, setClassDisplayName] = useState(className);
  const [students, setStudents] = useState<Student[]>([]);
  const [error, setError] = useState("");
  const [shareNotice, setShareNotice] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [visiblePinIds, setVisiblePinIds] = useState<string[]>([]);
  const [hoveredStudentId, setHoveredStudentId] = useState<string | null>(null);
  const [openStudentMenuId, setOpenStudentMenuId] = useState<string | null>(null);
  const [createStudentOpen, setCreateStudentOpen] = useState(false);
  const [newStudentFirstName, setNewStudentFirstName] = useState("");
  const [newStudentLastName, setNewStudentLastName] = useState("");
  const [newStudentPin, setNewStudentPin] = useState("");
  const [queuedStudentFiles, setQueuedStudentFiles] = useState<File[]>([]);
  const [creatingStudent, setCreatingStudent] = useState(false);
  const [uploadingStudentId, setUploadingStudentId] = useState<string | null>(null);
  const [settingsStudent, setSettingsStudent] = useState<Student | null>(null);
  const [settingsName, setSettingsName] = useState("");
  const [settingsPin, setSettingsPin] = useState("");
  const [showSettingsPin, setShowSettingsPin] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState("");
  const [lightbox, setLightbox] = useState<Student | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [photoUrlsMap, setPhotoUrlsMap] = useState<Record<string, string[]>>({});

  async function loadFolderImageUrls(folderPath: string) {
    const cached = folderImagesCacheRef.current.get(folderPath);
    if (cached) return cached;

    const response = await fetch(
      `/api/dashboard/storage-folder?path=${encodeURIComponent(folderPath)}`,
      { cache: "no-store" },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      files?: Array<{ name: string; url: string }>;
    };

    if (!response.ok || payload.ok === false || !payload.files) {
      folderImagesCacheRef.current.set(folderPath, []);
      return [];
    }

    const urls = payload.files
      .filter((file) => !!file.name && /\.(png|jpg|jpeg|webp)$/i.test(file.name))
      .sort((a, b) => naturalCompare(a.name, b.name))
      .map((file) => clean(file.url))
      .filter(Boolean);

    folderImagesCacheRef.current.set(folderPath, urls);
    return urls;
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const { data: schoolData, error: schoolError } = await supabase
          .from("schools")
          .select("*")
          .eq("id", schoolId)
          .maybeSingle();

        if (schoolError) throw schoolError;
        if (!schoolData) throw new Error("School not found.");

        const syncedProjectId = await findSyncedSchoolProjectId(supabase, schoolId, {
          localSchoolId: (schoolData as School).local_school_id,
        });
        let syncedClassTitle = className;

        if (syncedProjectId) {
          const { data: collectionRows, error: collectionError } = await supabase
            .from("collections")
            .select("id,title,slug,kind")
            .eq("project_id", syncedProjectId)
            .eq("kind", "class");

          if (collectionError) throw collectionError;

          const classSlug = slugify(className);
          const syncedClass = ((collectionRows ?? []) as ClassCollectionRow[]).find(
            (row) => clean(row.slug) === classSlug || clean(row.title).toLowerCase() === clean(className).toLowerCase()
          );

          syncedClassTitle = clean(syncedClass?.title) || className;
        }

        const { data: rows, error: err } = await supabase
          .from("students")
          .select("id,first_name,last_name,pin,photo_url,class_id,class_name,folder_name,external_student_id")
          .eq("school_id", schoolId)
          .eq("class_name", className)
          .order("last_name", { ascending: true })
          .order("first_name", { ascending: true });

        if (err) throw err;

        let loaded = ((rows ?? []) as Student[]).map((student) => {
          const storagePath = extractObjectPathFromPublicUrl(clean(student.photo_url));
          const previewUrl = storagePath
            ? buildStoredMediaUrls({
                storagePath,
                previewUrl: student.photo_url,
              }).previewUrl
            : clean(student.photo_url);

          return {
            ...student,
            photo_url: previewUrl || student.photo_url,
          };
        });
        const urlMap: Record<string, string[]> = {};

        const studentsByFolder = new Map<string, Student[]>();

        for (const student of loaded) {
          if (!student.photo_url) {
            urlMap[student.id] = [];
            continue;
          }

          const folderPath = extractFolderPathFromPublicUrl(student.photo_url);
          if (!folderPath) {
            urlMap[student.id] = [student.photo_url];
            continue;
          }

          const group = studentsByFolder.get(folderPath) ?? [];
          group.push(student);
          studentsByFolder.set(folderPath, group);
        }

        await Promise.all(
          Array.from(studentsByFolder.entries()).map(async ([folderPath, folderStudents]) => {
            try {
              const urls = await loadFolderImageUrls(folderPath);
              for (const student of folderStudents) {
                const mergedUrls = [student.photo_url, ...urls].filter(
                  (value): value is string => Boolean(value),
                );
                urlMap[student.id] = mergedUrls.length
                  ? Array.from(new Set(mergedUrls))
                  : [];
              }
            } catch {
              for (const student of folderStudents) {
                urlMap[student.id] = [student.photo_url!];
              }
            }
          })
        );

        const nextSchool = schoolData as School;

        try {
          const syncTarget = await ensureSchoolCollectionId(supabase, {
            schoolId,
            school: nextSchool,
            kind: "class",
            title: syncedClassTitle || className,
            slugFallback: "class",
          });

          if (syncTarget.projectId && syncTarget.collectionId) {
            const { data: mediaRows, error: mediaError } = await supabase
              .from("media")
              .select("storage_path")
              .eq("project_id", syncTarget.projectId)
              .eq("collection_id", syncTarget.collectionId);

            if (mediaError) throw mediaError;

            const existingPaths = new Set(
              ((mediaRows ?? []) as Array<{ storage_path: string | null }>).map((row) => clean(row.storage_path)).filter(Boolean)
            );
            const missingAssetsMap = new Map<string, UploadedStudentAsset>();

            for (const student of loaded) {
              const urls = urlMap[student.id] ?? (clean(student.photo_url) ? [clean(student.photo_url)] : []);
              for (const url of urls) {
                const asset = assetFromPublicUrl(url);
                if (!asset || existingPaths.has(asset.storagePath) || missingAssetsMap.has(asset.storagePath)) {
                  continue;
                }
                missingAssetsMap.set(asset.storagePath, asset);
              }
            }

            const missingAssets = Array.from(missingAssetsMap.values());
            if (missingAssets.length) {
              await appendSchoolMediaRows(supabase, {
                projectId: syncTarget.projectId,
                collectionId: syncTarget.collectionId,
                assets: missingAssets,
              });
            }
          }
        } catch (syncError) {
          console.error("CLASS SYNC BACKFILL ERROR:", syncError);
        }

        if (cancelled) return;

        setSchool(nextSchool);
        setClassDisplayName(syncedClassTitle);
        setStudents(loaded);
        setPhotoUrlsMap(urlMap);
        setSelectedStudentIds((prev) => prev.filter((id) => loaded.some((student) => student.id === id)));
        setVisiblePinIds((prev) => prev.filter((id) => loaded.some((student) => student.id === id)));
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load class.");
        setClassDisplayName(className);
        setStudents([]);
        setPhotoUrlsMap({});
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    if (schoolId && className) {
      void load();
    }

    return () => {
      cancelled = true;
    };
  }, [className, schoolId, supabase]);

  // Deep-link from Spotlight search: when ?student=<id> matches a loaded
  // student, scroll the card into view and flash a highlight ring.
  // Runs once per mount — clearing the highlight doesn't re-trigger
  // because of focusAppliedRef.
  useEffect(() => {
    if (!focusStudentIdFromUrl) return;
    if (focusAppliedRef.current) return;
    if (students.length === 0) return;
    if (!students.some((s) => s.id === focusStudentIdFromUrl)) return;
    focusAppliedRef.current = true;
    setFocusStudentId(focusStudentIdFromUrl);
    // If the student is hidden by the current search, clear it so they
    // actually see the card.
    setStudentSearch("");
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-student-id="${focusStudentIdFromUrl}"]`,
      );
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const clearTimer = window.setTimeout(() => setFocusStudentId(null), 2800);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(clearTimer);
    };
  }, [focusStudentIdFromUrl, students]);

  function getPhotoUrls(student: Student) {
    return photoUrlsMap[student.id] ?? (student.photo_url ? [student.photo_url] : []);
  }

  function openViewer(student: Student) {
    if (!getPhotoUrls(student).length) return;
    setOpenStudentMenuId(null);
    setLightbox(student);
    setLightboxIndex(0);
  }

  function openSettings(student: Student) {
    setOpenStudentMenuId(null);
    setSettingsStudent(student);
    setSettingsName(fullNameOf(student));
    setSettingsPin(clean(student.pin));
    setShowSettingsPin(false);
    setSettingsMsg("");
  }

  async function copyClassLink() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setShareNotice("Class link copied");
      window.setTimeout(() => setShareNotice(""), 2200);
    } catch {
      setShareNotice("Could not copy link");
      window.setTimeout(() => setShareNotice(""), 2200);
    }
  }

  function resetCreateStudentForm() {
    uploadTargetStudentRef.current = null;
    setCreateStudentOpen(false);
    setNewStudentFirstName("");
    setNewStudentLastName("");
    setNewStudentPin("");
    setQueuedStudentFiles([]);
  }

  function classStudentsApiPath() {
    return `/api/dashboard/schools/${schoolId}/classes/${encodeURIComponent(className)}/students`;
  }

  function studentPhotosApiPath(studentId: string) {
    return `${classStudentsApiPath()}/${studentId}/photos`;
  }

  async function uploadFilesToStudent(student: Student, files: File[]) {
    const filesToUpload = imageFilesOnly(files);
    if (!filesToUpload.length) return;

    const currentPhotoUrl = clean(student.photo_url);
    const currentFolderPath = currentPhotoUrl
      ? extractFolderPathFromPublicUrl(currentPhotoUrl)
      : null;
    const basePath = safeStorageSegment(
      clean(school?.local_school_id) || schoolId,
      schoolId,
    );
    const classPath = safeStorageSegment(classDisplayName || className, "Class");
    const derivedFolderName =
      clean(student.folder_name) ||
      (currentFolderPath
        ? currentFolderPath.split("/").filter(Boolean).at(-1) ?? ""
        : "") ||
      `${safeStorageSegment(fullNameOf(student), "Student")}-${Date.now()}`;
    const storageFolderPath =
      currentFolderPath || `${basePath}/${classPath}/${derivedFolderName}`;
    const existingUrls = getPhotoUrls(student);

    setUploadingStudentId(student.id);
    setError("");

    try {
      const uploadedAssets: UploadedStudentAsset[] = [];
      const syncTarget = await ensureSchoolCollectionId(supabase, {
        schoolId,
        school,
        kind: "class",
        title: classDisplayName || className,
        slugFallback: "class",
      });

      for (const [index, file] of filesToUpload.entries()) {
        const originalExt = file.name.includes(".")
          ? file.name.split(".").pop()
          : "jpg";
        const ext = clean(originalExt).toLowerCase() || "jpg";
        const storagePath = `${storageFolderPath}/${Date.now()}-${index}-${Math.random()
          .toString(36)
          .slice(2)}.${ext}`;

        // Upload to Cloudflare R2
        const accessToken = (await supabase.auth.getSession()).data.session?.access_token || "";
        const r2Result = await uploadToR2(file, storagePath, accessToken);
        if (!r2Result) {
          throw new Error("Photo upload failed.");
        }

        // Generate pre-sized thumbnails server-side on R2
        const generated = await generateThumbnails(storagePath, accessToken);
        const publicUrl = generated.previewUrl || r2Result.publicUrl;
        if (clean(publicUrl)) {
          uploadedAssets.push({
            storagePath,
            publicUrl,
            filename: file.name,
            mimeType: file.type || null,
          });
        }
      }

      const uploadedUrls = uploadedAssets
        .map((asset) => asset.publicUrl)
        .filter(Boolean);
      if (!uploadedUrls.length) return;

      let updatedStudent = student;
      const needsStudentUpdate =
        !clean(student.photo_url) ||
        clean(student.folder_name) !== derivedFolderName;

      if (needsStudentUpdate) {
        const { data: updatedRow, error: updateError } = await supabase
          .from("students")
          .update({
            photo_url: clean(student.photo_url) || uploadedUrls[0],
            folder_name: derivedFolderName,
          })
          .eq("id", student.id)
          .select(
            "id,first_name,last_name,pin,photo_url,class_id,class_name,folder_name,external_student_id",
          )
          .single();

        if (updateError) {
          throw new Error(
            updateError.message || "Photos uploaded, but student could not be updated.",
          );
        }

        updatedStudent = updatedRow as Student;
        setStudents((prev) =>
          prev.map((row) => (row.id === updatedStudent.id ? updatedStudent : row)),
        );
      }

      try {
        if (syncTarget.projectId && syncTarget.collectionId) {
          await appendSchoolMediaRows(supabase, {
            projectId: syncTarget.projectId,
            collectionId: syncTarget.collectionId,
            assets: uploadedAssets,
          });
        }
      } catch (syncError) {
        console.error("CLASS STUDENT CLIENT SYNC ERROR:", syncError);
      }

      setPhotoUrlsMap((prev) => ({
        ...prev,
        [student.id]: Array.from(
          new Set([
            ...(existingUrls.length
              ? existingUrls
              : clean(student.photo_url)
                ? [clean(student.photo_url)]
                : []),
            ...uploadedUrls,
          ]),
        ),
      }));
      setShareNotice(
        uploadedUrls.length === 1
          ? "1 photo added to student"
          : `${uploadedUrls.length} photos added to student`,
      );
      window.setTimeout(() => setShareNotice(""), 2200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to upload photos.");
    } finally {
      setUploadingStudentId(null);
    }
  }

  function queueStudentFiles(event: ChangeEvent<HTMLInputElement>) {
    const nextFiles = imageFilesOnly(Array.from(event.target.files ?? []));
    const targetStudent = uploadTargetStudentRef.current;
    uploadTargetStudentRef.current = null;
    event.target.value = "";

    if (nextFiles.length) {
      if (targetStudent) {
        void uploadFilesToStudent(targetStudent, nextFiles);
        return;
      }
      setQueuedStudentFiles((prev) => [...prev, ...nextFiles]);
    }
  }

  function openStudentUpload(student: Student, kind: "photos" | "folder") {
    uploadTargetStudentRef.current = student;
    setOpenStudentMenuId(null);
    setError("");

    if (kind === "folder") {
      folderInputRef.current?.click();
      return;
    }

    fileInputRef.current?.click();
  }

  async function createStudent() {
    const firstName = clean(newStudentFirstName);
    const lastName = clean(newStudentLastName);
    const fullName = [firstName, lastName].filter(Boolean).join(" ");
    if (!firstName) return;

    const filesToUpload = [...queuedStudentFiles];

    setCreatingStudent(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("studentName", fullName);
      formData.append("studentFirstName", firstName);
      formData.append("studentLastName", lastName);
      formData.append("studentPin", clean(newStudentPin));

      const response = await fetch(classStudentsApiPath(), {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        student?: Student;
        uploadedUrls?: string[];
        photoUrls?: string[];
      };

      if (!response.ok || payload.ok === false || !payload.student) {
        throw new Error(payload.message || "Failed to add student.");
      }

      const nextStudent = payload.student;
      setStudents((prev) => [...prev, nextStudent]);
      setPhotoUrlsMap((prev) => ({
        ...prev,
        [nextStudent.id]: nextStudent.photo_url ? [nextStudent.photo_url] : [],
      }));
      resetCreateStudentForm();

      if (filesToUpload.length) {
        setShareNotice("Student added. Uploading photos...");
        window.setTimeout(() => setShareNotice(""), 2200);
        await uploadFilesToStudent(nextStudent, filesToUpload);
      } else {
        setShareNotice("Student added");
        window.setTimeout(() => setShareNotice(""), 2200);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add student.");
    } finally {
      setCreatingStudent(false);
    }
  }

  async function handleSaveSettings() {
    if (!settingsStudent) return;

    setSettingsSaving(true);
    setSettingsMsg("");
    try {
      const response = await fetch(
        `${classStudentsApiPath()}/${settingsStudent.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            studentName: settingsName.trim(),
            studentPin: settingsPin.trim(),
          }),
        },
      );

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        student?: Student;
      };

      if (!response.ok || payload.ok === false || !payload.student) {
        throw new Error(payload.message || "Failed to save student settings.");
      }

      const updatedStudent = payload.student;
      setShareNotice("Student updated");
      window.setTimeout(() => setShareNotice(""), 2200);
      setStudents((prev) =>
        prev.map((student) =>
          student.id === updatedStudent.id ? updatedStudent : student,
        ),
      );
      if (lightbox?.id === updatedStudent.id) {
        setLightbox(updatedStudent);
      }
      setSettingsStudent(null);
    } catch (err: unknown) {
      setSettingsMsg(
        err instanceof Error ? err.message : "Failed to save student settings.",
      );
    } finally {
      setSettingsSaving(false);
    }
  }

  async function deleteStudents(ids: string[]) {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (!uniqueIds.length) return;

    const confirmed =
      typeof window !== "undefined"
        ? window.confirm(
            uniqueIds.length === 1 ? "Delete this student?" : `Delete ${uniqueIds.length} selected students?`
          )
        : false;

    if (!confirmed) return;

    try {
      for (const studentId of uniqueIds) {
        const response = await fetch(
          `${classStudentsApiPath()}/${studentId}`,
          { method: "DELETE" },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          message?: string;
        };
        if (!response.ok || payload.ok === false) {
          throw new Error(payload.message || "Failed to delete student.");
        }
      }

      setStudents((prev) => prev.filter((student) => !uniqueIds.includes(student.id)));
      setSelectedStudentIds((prev) => prev.filter((id) => !uniqueIds.includes(id)));
      setVisiblePinIds((prev) => prev.filter((id) => !uniqueIds.includes(id)));
      setOpenStudentMenuId((prev) => (prev && uniqueIds.includes(prev) ? null : prev));
      setPhotoUrlsMap((prev) => {
        const next = { ...prev };
        for (const id of uniqueIds) delete next[id];
        return next;
      });
      if (settingsStudent && uniqueIds.includes(settingsStudent.id)) {
        setSettingsStudent(null);
      }
      if (lightbox && uniqueIds.includes(lightbox.id)) {
        setLightbox(null);
        setLightboxIndex(0);
      }
      setShareNotice(uniqueIds.length === 1 ? "Student deleted" : "Students deleted");
      window.setTimeout(() => setShareNotice(""), 2200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete student.");
    }
  }

  function toggleSelectedStudent(studentId: string) {
    setSelectedStudentIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  }

  function toggleVisiblePin(studentId: string) {
    setVisiblePinIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  }

  const orderedStudents = useMemo(
    () =>
      [...students].sort((a, b) =>
        fullNameOf(a).localeCompare(fullNameOf(b), undefined, { numeric: true, sensitivity: "base" })
      ),
    [students]
  );

  const filteredStudents = useMemo(() => {
    const query = clean(studentSearch).toLowerCase();
    if (!query) return orderedStudents;

    return orderedStudents.filter((student) => {
      const fullName = fullNameOf(student).toLowerCase();
      const pin = clean(student.pin).toLowerCase();
      const folderName = clean(student.folder_name).toLowerCase();
      const externalId = clean(student.external_student_id).toLowerCase();
      return (
        fullName.includes(query) ||
        pin.includes(query) ||
        folderName.includes(query) ||
        externalId.includes(query)
      );
    });
  }, [orderedStudents, studentSearch]);

  const allSelected =
    filteredStudents.length > 0 && filteredStudents.every((student) => selectedStudentIds.includes(student.id));
  const searchCountLabel = `${filteredStudents.length} of ${orderedStudents.length}`;
  const studentsWithPhotos = useMemo(
    () =>
      students.filter((student) => {
        const urls = photoUrlsMap[student.id];
        if (urls) return urls.length > 0;
        return Boolean(clean(student.photo_url));
      }).length,
    [students, photoUrlsMap]
  );
  const totalPhotos = useMemo(
    () => Object.values(photoUrlsMap).reduce((sum, urls) => sum + urls.length, 0),
    [photoUrlsMap]
  );
  const lightboxPhotos = lightbox ? getPhotoUrls(lightbox) : [];
  const folderInputProps: Record<string, string> = { webkitdirectory: "", directory: "" };

  return (
    <div style={{ minHeight: "100vh", background: "#faf7f7", padding: 36 }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 22 }}>
          <div>
            <Link
              href={`/dashboard/projects/schools/${schoolId}`}
              style={{
                color: "#111111",
                textDecoration: "none",
                fontSize: 14,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <ArrowLeft size={16} /> Back to School
            </Link>
            <div style={{ color: "#6b7280", fontSize: 14, marginTop: 10 }}>
              {school?.school_name ?? "School"}
            </div>
            <h1 style={{ fontSize: 34, fontWeight: 900, color: "#111827", margin: "8px 0 0" }}>{classDisplayName}</h1>
            <div style={{ color: "#b91c1c", marginTop: 8, fontWeight: 700 }}>
              {students.length} student{students.length !== 1 ? "s" : ""}
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button
              onClick={() => {
                uploadTargetStudentRef.current = null;
                setError("");
                setCreateStudentOpen(true);
              }}
              style={{
                borderRadius: 12,
                border: "1px solid #111111",
                background: "#fff",
                color: "#111111",
                padding: "12px 16px",
                fontWeight: 800,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Plus size={16} /> Add Student
            </button>
            <button
              onClick={copyClassLink}
              style={{
                borderRadius: 12,
                border: "1px solid #111111",
                background: "#111111",
                color: "#fff",
                padding: "12px 16px",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Share Class
            </button>
            <Link
              href={`/dashboard/projects/schools/${schoolId}/classes/${encodeURIComponent(className)}/settings`}
              style={{
                borderRadius: 12,
                border: "1px solid #111111",
                background: "#fff",
                color: "#111111",
                padding: "12px 16px",
                fontWeight: 800,
                textDecoration: "none",
              }}
            >
              Class Settings
            </Link>
          </div>
        </div>

        {shareNotice ? <div style={{ marginBottom: 14, color: "#b91c1c", fontWeight: 700 }}>{shareNotice}</div> : null}

        {error ? (
          <div
            style={{
              marginBottom: 16,
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 10,
              padding: "14px 18px",
              color: "#b91c1c",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        ) : null}

        {loading ? <p style={{ color: "#667085", fontSize: 14 }}>Loading…</p> : null}

        {!loading ? (
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 20, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#111111", fontWeight: 700, flexWrap: "wrap", flex: "1 1 360px" }}>
                <button
                  onClick={() =>
                    setSelectedStudentIds((prev) =>
                      allSelected ? prev.filter((id) => !filteredStudents.some((student) => student.id === id)) : Array.from(new Set([...prev, ...filteredStudents.map((student) => student.id)]))
                    )
                  }
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    borderRadius: 10,
                    border: "1px solid #111111",
                    background: "#fff",
                    color: "#111111",
                    padding: "9px 12px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  <CheckSquare size={16} /> {allSelected ? "Clear Selection" : "Select Multiple"}
                </button>
                <button
                  onClick={() => void deleteStudents(selectedStudentIds)}
                  disabled={!selectedStudentIds.length}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    borderRadius: 10,
                    border: `1px solid ${selectedStudentIds.length ? "#fecaca" : "#d0d5dd"}`,
                    background: "#fff",
                    color: selectedStudentIds.length ? "#b42318" : "#98a2b3",
                    padding: "9px 12px",
                    fontWeight: 700,
                    cursor: selectedStudentIds.length ? "pointer" : "not-allowed",
                  }}
                >
                  <Trash2 size={16} /> Delete Selected{selectedStudentIds.length ? ` (${selectedStudentIds.length})` : ""}
                </button>
                <div style={{ flex: "1 1 280px", minWidth: 220, maxWidth: 420, position: "relative" }}>
                  <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#6b7280", pointerEvents: "none" }} />
                  <input
                    value={studentSearch}
                    onChange={(event) => setStudentSearch(event.target.value)}
                    placeholder="Search students, PIN, or folder..."
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      borderRadius: 10,
                      border: "1px solid #d0d5dd",
                      background: "#fff",
                      color: "#111111",
                      padding: "10px 12px 10px 38px",
                      fontWeight: 600,
                      outline: "none",
                    }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
                {studentSearch ? <div style={{ color: "#b91c1c", fontSize: 13, fontWeight: 700, minWidth: 72, textAlign: "right" }}>{searchCountLabel}</div> : null}
                <button style={{ borderRadius: 10, border: "1px solid #111111", background: "#fff", color: "#111111", padding: "9px 12px", fontWeight: 700, cursor: "pointer" }}>
                  Sort by: Name A-Z
                </button>
              </div>
            </div>

            <div style={{ color: "#111111", marginBottom: 16, fontWeight: 700 }}>
              {students.length} students • {studentsWithPhotos} with photos • {totalPhotos} photos
            </div>

            {filteredStudents.length === 0 ? (
              <div style={{ border: "1px dashed #d0d5dd", borderRadius: 18, padding: 24, color: "#4b5563" }}>
                {studentSearch ? "No students found." : "No students in this class yet."}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 18 }}>
                {filteredStudents.map((student) => {
                  const photoUrls = getPhotoUrls(student);
                  // Prefer the resolved folder URL (server-side R2 listing) over
                  // the DB photo_url, which may be stale or point to a missing
                  // variant. Fall back to DB value if the map hasn't populated yet.
                  const photoUrl = clean(photoUrls[0]) || clean(student.photo_url);
                  const selected =
                    selectedStudentIds.includes(student.id) ||
                    hoveredStudentId === student.id ||
                    openStudentMenuId === student.id;
                  const pinVisible = visiblePinIds.includes(student.id);

                  const isFocused = focusStudentId === student.id;
                  return (
                    <div
                      key={student.id}
                      data-student-id={student.id}
                      onMouseEnter={() => setHoveredStudentId(student.id)}
                      onMouseLeave={() => setHoveredStudentId((prev) => (prev === student.id ? null : prev))}
                      style={{
                        background: "#fff",
                        border: isFocused
                          ? "2px solid #2563eb"
                          : selected
                            ? "2px solid #b91c1c"
                            : "1px solid #e5e7eb",
                        borderRadius: 18,
                        overflow: "visible",
                        boxShadow: isFocused
                          ? "0 0 0 4px rgba(37,99,235,0.18), 0 8px 24px rgba(16,24,40,0.05)"
                          : "0 8px 24px rgba(16,24,40,0.05)",
                        position: "relative",
                        zIndex: openStudentMenuId === student.id ? 30 : 1,
                        transition: "box-shadow 0.25s ease, border-color 0.25s ease",
                      }}
                    >
                      <button
                        onClick={() => toggleSelectedStudent(student.id)}
                        style={{
                          position: "absolute",
                          top: 12,
                          left: 12,
                          zIndex: 3,
                          width: 30,
                          height: 30,
                          borderRadius: 8,
                          border: selected ? "1px solid #111111" : "1px solid rgba(17,24,39,0.16)",
                          background: selected ? "#111111" : "rgba(255,255,255,0.95)",
                          color: selected ? "#fff" : "#667085",
                          display: "grid",
                          placeItems: "center",
                          cursor: "pointer",
                        }}
                      >
                        <CheckSquare size={15} />
                      </button>

                      <button
                        onClick={() => openViewer(student)}
                        style={{
                          display: "block",
                          width: "100%",
                          border: 0,
                          padding: 0,
                          background: "#f8fafc",
                          cursor: photoUrls.length ? "zoom-in" : "default",
                          overflow: "hidden",
                          borderTopLeftRadius: 18,
                          borderTopRightRadius: 18,
                        }}
                      >
                        <div
                          style={{
                            position: "relative",
                            aspectRatio: "3 / 4",
                            background: "#e5e7eb",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexDirection: "column",
                            gap: 8,
                            overflow: "hidden",
                          }}
                        >
                          {photoUrl ? (
                            <img
                              src={photoUrl}
                              alt={fullNameOf(student)}
                              loading="lazy"
                              onError={(e) => {
                                // Hide broken images so the initials fallback shows through.
                                (e.currentTarget as HTMLImageElement).style.display = "none";
                              }}
                              style={{
                                position: "absolute",
                                inset: 0,
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                              }}
                            />
                          ) : null}
                          <div
                            style={{
                              width: 52,
                              height: 52,
                              borderRadius: "50%",
                              background: "#d0d5dd",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 20,
                              color: "#fff",
                              fontWeight: 700,
                              zIndex: 0,
                            }}
                          >
                            {student.first_name[0]}
                            {student.last_name?.[0] ?? ""}
                          </div>
                          {!photoUrl ? (
                            <span style={{ fontSize: 11, color: "#98a2b3", zIndex: 0 }}>
                              No photo synced
                            </span>
                          ) : null}
                        </div>
                      </button>

                      <div style={{ padding: 14 }}>
                        <div
                          style={{
                            color: "#111827",
                            fontWeight: 700,
                            fontSize: 14,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {fullNameOf(student)}
                        </div>

                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 10 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#667085", fontSize: 12, minWidth: 0 }}>
                            <KeyRound size={12} />
                            <span style={{ fontWeight: 700, color: "#111111" }}>PIN:</span>
                            <span
                              style={{
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {pinVisible ? clean(student.pin) || "No PIN" : clean(student.pin) ? "••••••" : "No PIN"}
                            </span>
                          </div>
                          <button
                            onClick={() => toggleVisiblePin(student.id)}
                            style={{
                              border: 0,
                              background: "transparent",
                              color: "#667085",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              padding: 0,
                            }}
                            title={pinVisible ? "Hide PIN" : "Show PIN"}
                          >
                            {pinVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>

                        <div style={{ color: "#667085", fontSize: 12, marginTop: 6 }}>
                          {photoUrls.length} photo{photoUrls.length !== 1 ? "s" : ""}
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 12, alignItems: "start" }}>
                          <button
                            onClick={() => openViewer(student)}
                            disabled={!photoUrls.length}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              borderRadius: 10,
                              border: "1px solid #d0d5dd",
                              background: "#fff",
                              color: photoUrls.length ? "#344054" : "#98a2b3",
                              padding: "8px 10px",
                              fontWeight: 700,
                              cursor: photoUrls.length ? "pointer" : "not-allowed",
                              fontSize: 13,
                            }}
                          >
                            <Eye size={14} /> View Photos
                          </button>
                          <div style={{ position: "relative" }}>
                            <button
                              disabled={uploadingStudentId === student.id}
                              onClick={() => setOpenStudentMenuId((prev) => (prev === student.id ? null : student.id))}
                              style={{
                                width: 40,
                                height: 40,
                                borderRadius: 10,
                                border: "1px solid #111111",
                                background: openStudentMenuId === student.id ? "#fff5f5" : "#fff",
                                color: "#111111",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: uploadingStudentId === student.id ? "wait" : "pointer",
                                opacity: uploadingStudentId === student.id ? 0.7 : 1,
                              }}
                              aria-label="Student actions"
                            >
                              {uploadingStudentId === student.id ? (
                                <span style={{ fontSize: 10, fontWeight: 800 }}>...</span>
                              ) : (
                                <Menu size={18} />
                              )}
                            </button>
                            {openStudentMenuId === student.id ? (
                              <div
                                style={{
                                  position: "absolute",
                                  right: 0,
                                  top: "calc(100% + 8px)",
                                  minWidth: 180,
                                  background: "#fff",
                                  border: "1px solid #e5e7eb",
                                  borderRadius: 14,
                                  boxShadow: "0 18px 36px rgba(17,17,17,0.12)",
                                  overflow: "hidden",
                                  zIndex: 20,
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() => openSettings(student)}
                                  style={{
                                    width: "100%",
                                    textAlign: "left",
                                    padding: "12px 14px",
                                    color: "#111111",
                                    background: "#fff",
                                    border: 0,
                                    fontWeight: 700,
                                    cursor: "pointer",
                                  }}
                                >
                                  Rename
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openSettings(student)}
                                  style={{
                                    width: "100%",
                                    textAlign: "left",
                                    padding: "12px 14px",
                                    color: "#111111",
                                    background: "#fff",
                                    border: 0,
                                    borderTop: "1px solid #f1f5f9",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                  }}
                                >
                                  Edit PIN
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openStudentUpload(student, "photos")}
                                  style={{
                                    width: "100%",
                                    textAlign: "left",
                                    padding: "12px 14px",
                                    color: "#111111",
                                    background: "#fff",
                                    border: 0,
                                    borderTop: "1px solid #f1f5f9",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                  }}
                                >
                                  Upload Photos
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openStudentUpload(student, "folder")}
                                  style={{
                                    width: "100%",
                                    textAlign: "left",
                                    padding: "12px 14px",
                                    color: "#111111",
                                    background: "#fff",
                                    border: 0,
                                    borderTop: "1px solid #f1f5f9",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                  }}
                                >
                                  Upload Folder
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void deleteStudents([student.id])}
                                  style={{
                                    width: "100%",
                                    textAlign: "left",
                                    padding: "12px 14px",
                                    color: "#b91c1c",
                                    background: "#fff",
                                    border: 0,
                                    borderTop: "1px solid #f1f5f9",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <input ref={fileInputRef} type="file" multiple accept="image/*" onChange={queueStudentFiles} style={{ display: "none" }} />
      <input ref={folderInputRef} type="file" multiple accept="image/*" onChange={queueStudentFiles} style={{ display: "none" }} {...folderInputProps} />

      {createStudentOpen ? (
        <>
          <div
            onClick={resetCreateStudentForm}
            style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 98 }}
          />
          <div
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: 520,
              maxWidth: "calc(100vw - 32px)",
              background: "#fff",
              borderRadius: 24,
              boxShadow: "0 30px 60px rgba(15,23,42,0.25)",
              zIndex: 99,
              overflow: "hidden",
              border: "1px solid #e5e7eb",
            }}
          >
            <div style={{ padding: "20px 22px", borderBottom: "1px solid #eef2f7", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#111827" }}>Add Student</div>
                <div style={{ color: "#667085", marginTop: 4 }}>Create a student first, then upload one photo or a whole folder into this class.</div>
              </div>
              <button type="button" onClick={resetCreateStudentForm} style={{ background: "none", border: "none", cursor: "pointer", color: "#667085" }}>
                <X size={22} />
              </button>
            </div>

            <div style={{ padding: 22, display: "grid", gap: 14 }}>
              <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                <div>
                  <label style={{ display: "block", fontWeight: 700, color: "#111111", marginBottom: 8 }}>First Name</label>
                  <input
                    value={newStudentFirstName}
                    onChange={(e) => setNewStudentFirstName(e.target.value)}
                    placeholder="Anabel"
                    autoFocus
                    style={{ width: "100%", boxSizing: "border-box", borderRadius: 14, border: "1px solid #d0d5dd", padding: "13px 14px", fontSize: 15, color: "#111111", outline: "none" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontWeight: 700, color: "#111111", marginBottom: 8 }}>Last Name</label>
                  <input
                    value={newStudentLastName}
                    onChange={(e) => setNewStudentLastName(e.target.value)}
                    placeholder="Mazakian"
                    style={{ width: "100%", boxSizing: "border-box", borderRadius: 14, border: "1px solid #d0d5dd", padding: "13px 14px", fontSize: 15, color: "#111111", outline: "none" }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontWeight: 700, color: "#111111", marginBottom: 8 }}>Student PIN / Password</label>
                <input
                  value={newStudentPin}
                  onChange={(e) => setNewStudentPin(e.target.value)}
                  placeholder="Optional PIN"
                  style={{ width: "100%", boxSizing: "border-box", borderRadius: 14, border: "1px solid #d0d5dd", padding: "13px 14px", fontSize: 15, color: "#111111", outline: "none" }}
                />
              </div>

              <div style={{ borderRadius: 16, border: "1px solid #e5e7eb", background: "#fafafa", padding: 14 }}>
                <div style={{ fontWeight: 700, color: "#111111", marginBottom: 10 }}>Photos</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button type="button" onClick={() => fileInputRef.current?.click()} style={{ display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 12, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "10px 12px", fontWeight: 700, cursor: "pointer" }}>
                    <Upload size={16} /> Upload Photos
                  </button>
                  <button type="button" onClick={() => folderInputRef.current?.click()} style={{ display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 12, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "10px 12px", fontWeight: 700, cursor: "pointer" }}>
                    <FolderPlus size={16} /> Upload Folder
                  </button>
                  {queuedStudentFiles.length ? (
                    <button type="button" onClick={() => setQueuedStudentFiles([])} style={{ borderRadius: 12, border: "1px solid #fecaca", background: "#fff", color: "#b91c1c", padding: "10px 12px", fontWeight: 700, cursor: "pointer" }}>
                      Clear Files
                    </button>
                  ) : null}
                </div>
                <div style={{ color: "#667085", fontSize: 13, marginTop: 10 }}>
                  {queuedStudentFiles.length ? `${queuedStudentFiles.length} photo${queuedStudentFiles.length !== 1 ? "s" : ""} ready to upload.` : "You can save without photos and add more later from the student's 3-line menu."}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, padding: "18px 22px", borderTop: "1px solid #eef2f7" }}>
              <button type="button" onClick={resetCreateStudentForm} style={{ borderRadius: 14, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "12px 16px", fontWeight: 800, cursor: "pointer" }}>
                Cancel
              </button>
              <button type="button" onClick={() => void createStudent()} disabled={!clean(newStudentFirstName) || creatingStudent} style={{ borderRadius: 14, border: 0, background: !clean(newStudentFirstName) || creatingStudent ? "#d1d5db" : "#111111", color: "#fff", padding: "12px 16px", fontWeight: 800, cursor: !clean(newStudentFirstName) || creatingStudent ? "not-allowed" : "pointer" }}>
                {creatingStudent ? "Saving..." : "Add Student"}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {settingsStudent ? (
        <>
          <div
            onClick={() => setSettingsStudent(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 100 }}
          />

          <div
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: 420,
              maxWidth: "calc(100vw - 32px)",
              background: "#fff",
              borderRadius: 24,
              boxShadow: "0 30px 60px rgba(15,23,42,0.25)",
              zIndex: 101,
              overflow: "hidden",
              border: "1px solid #e5e7eb",
            }}
          >
            <div
              style={{
                padding: "20px 22px",
                borderBottom: "1px solid #eef2f7",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#111827" }}>Student Details</div>
                <div style={{ color: "#667085", marginTop: 4 }}>Update the student name and PIN/password.</div>
              </div>

              <button
                type="button"
                onClick={() => setSettingsStudent(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#667085" }}
              >
                <X size={22} />
              </button>
            </div>

            <div style={{ padding: 22, display: "grid", gap: 14 }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#344054",
                    marginBottom: 8,
                  }}
                >
                  Student Name
                </label>
                <input
                  value={settingsName}
                  onChange={(event) => setSettingsName(event.target.value)}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #d0d5dd",
                    fontSize: 13,
                    background: "#fff",
                    color: "#344054",
                    fontWeight: 600,
                    WebkitTextFillColor: "#344054",
                    opacity: 1,
                    outline: "none",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#344054",
                    marginBottom: 8,
                  }}
                >
                  Student PIN / Password
                </label>

                <div style={{ position: "relative" }}>
                  <input
                    type={showSettingsPin ? "text" : "password"}
                    value={settingsPin}
                    onChange={(event) => setSettingsPin(event.target.value)}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "10px 40px 10px 12px",
                      borderRadius: 10,
                      border: "1px solid #d0d5dd",
                      fontSize: 13,
                      background: "#fff",
                      color: "#344054",
                      fontWeight: 600,
                      WebkitTextFillColor: "#344054",
                      opacity: 1,
                      outline: "none",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowSettingsPin((prev) => !prev)}
                    style={{
                      position: "absolute",
                      right: 10,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "#667085",
                    }}
                  >
                    {showSettingsPin ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {settingsMsg ? (
                <div
                  style={{
                    fontSize: 12,
                    color: "#b91c1c",
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    padding: "10px 12px",
                    borderRadius: 8,
                  }}
                >
                  {settingsMsg}
                </div>
              ) : null}
            </div>

            <div
              style={{
                padding: 18,
                borderTop: "1px solid #eef2f7",
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={() => void deleteStudents([settingsStudent.id])}
                style={{
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: "1px solid #fecaca",
                  background: "#fff",
                  fontSize: 13,
                  fontWeight: 800,
                  color: "#dc2626",
                  cursor: "pointer",
                }}
              >
                Delete Student
              </button>

              <div style={{ display: "flex", gap: 12 }}>
                <button
                  type="button"
                  onClick={() => setSettingsStudent(null)}
                  style={{
                    padding: "12px 16px",
                    borderRadius: 14,
                    border: "1px solid #d0d5dd",
                    background: "#fff",
                    fontSize: 13,
                    fontWeight: 800,
                    color: "#111827",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleSaveSettings}
                  disabled={settingsSaving}
                  style={{
                    padding: "12px 16px",
                    borderRadius: 14,
                    border: "none",
                    background: "#111827",
                    fontSize: 13,
                    fontWeight: 800,
                    color: "#fff",
                    cursor: settingsSaving ? "default" : "pointer",
                    opacity: settingsSaving ? 0.7 : 1,
                  }}
                >
                  {settingsSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {lightbox ? (
        <>
          <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.88)", zIndex: 200 }} />

          <div style={{ position: "fixed", inset: 0, zIndex: 201, display: "flex", flexDirection: "column" }}>
            <div
              style={{
                padding: "16px 18px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                color: "#fff",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 900 }}>{fullNameOf(lightbox)}</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 4 }}>
                  {lightboxIndex + 1} of {lightboxPhotos.length}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setLightbox(null)}
                style={{ background: "none", border: "none", color: "#fff", cursor: "pointer" }}
              >
                <X size={24} />
              </button>
            </div>

            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "16px 24px",
                gap: 16,
              }}
            >
              <button
                type="button"
                onClick={() => setLightboxIndex((prev) => Math.max(0, prev - 1))}
                disabled={lightboxIndex === 0}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(255,255,255,0.1)",
                  color: "#fff",
                  cursor: lightboxIndex === 0 ? "default" : "pointer",
                  opacity: lightboxIndex === 0 ? 0.3 : 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <ChevronLeft size={22} />
              </button>

              <div
                style={{
                  maxWidth: "min(1000px, 75vw)",
                  maxHeight: "70vh",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {lightboxPhotos[lightboxIndex] ? (
                  <img
                    src={lightboxPhotos[lightboxIndex]}
                    alt={fullNameOf(lightbox)}
                    style={{
                      maxWidth: "100%",
                      maxHeight: "70vh",
                      objectFit: "contain",
                      borderRadius: 18,
                      boxShadow: "0 30px 80px rgba(0,0,0,0.4)",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 400,
                      height: 500,
                      background: "rgba(255,255,255,0.06)",
                      border: "1px dashed rgba(255,255,255,0.25)",
                      borderRadius: 12,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "rgba(255,255,255,0.6)",
                    }}
                  >
                    No photo available
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setLightboxIndex((prev) => Math.min(lightboxPhotos.length - 1, prev + 1))}
                disabled={lightboxIndex >= lightboxPhotos.length - 1}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(255,255,255,0.1)",
                  color: "#fff",
                  cursor: lightboxIndex >= lightboxPhotos.length - 1 ? "default" : "pointer",
                  opacity: lightboxIndex >= lightboxPhotos.length - 1 ? 0.3 : 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <ChevronRight size={22} />
              </button>
            </div>

            <div style={{ padding: "16px 24px 24px", display: "flex", justifyContent: "center", gap: 10, overflowX: "auto" }}>
              {lightboxPhotos.map((url, index) => (
                <button
                  key={`${lightbox.id}-${index}`}
                  type="button"
                  onClick={() => setLightboxIndex(index)}
                  style={{
                    border: index === lightboxIndex ? "2px solid #fff" : "1px solid rgba(255,255,255,0.2)",
                    background: "none",
                    padding: 0,
                    borderRadius: 6,
                    overflow: "hidden",
                    width: 72,
                    height: 90,
                    flexShrink: 0,
                    cursor: "pointer",
                    opacity: index === lightboxIndex ? 1 : 0.75,
                  }}
                >
                  <img
                    src={url}
                    alt={`${fullNameOf(lightbox)} ${index + 1}`}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Briefcase,
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
  Shield,
  Star,
  Trash2,
  Upload,
  UserCog,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { appendSchoolMediaRows, ensureSchoolCollectionId } from "@/lib/school-sync";
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

type PersonRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  class_id?: string | null;
  class_name: string | null;
  role: string | null;
  pin: string;
  photo_url: string | null;
  folder_name: string | null;
  external_student_id: string | null;
};

type UploadedPersonAsset = {
  storagePath: string;
  publicUrl: string;
  filename: string;
  mimeType: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function fullNameOf(person: PersonRow) {
  return `${clean(person.first_name)} ${clean(person.last_name)}`.trim() || "Unnamed Person";
}

function normalizeRole(rawRole: string | null | undefined): string {
  const role = clean(rawRole).toLowerCase();

  if (!role) return "Unassigned";
  if (role === "student" || role === "students") return "Student";
  if (role === "teacher" || role === "teachers") return "Teacher";
  if (role === "coach" || role === "coaches") return "Coach";
  if (role === "principal" || role === "head principal" || role === "school principal") {
    return "Principal";
  }
  if (
    role === "office" ||
    role === "office staff" ||
    role === "admin" ||
    role === "administrator" ||
    role === "administration" ||
    role === "front office"
  ) {
    return "Office Staff";
  }
  if (
    role === "staff" ||
    role === "faculty" ||
    role === "employee" ||
    role === "employees" ||
    role === "support staff" ||
    role === "school staff"
  ) {
    return "Staff";
  }

  return clean(rawRole) || "Unassigned";
}

function getRoleIcon(role: string) {
  switch (role) {
    case "Teacher":
      return <UserRound size={22} color="#555" />;
    case "Coach":
      return <Shield size={22} color="#555" />;
    case "Principal":
      return <Star size={22} color="#555" />;
    case "Office Staff":
      return <UserCog size={22} color="#555" />;
    case "Staff":
      return <Briefcase size={22} color="#555" />;
    default:
      return <Users size={22} color="#555" />;
  }
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

function splitDisplayName(value: string) {
  const parts = clean(value).split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" ") || null,
  };
}

function safeStorageSegment(value: string, fallback: string) {
  return clean(value).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || fallback;
}

function imageFilesOnly(files: File[]) {
  return files.filter(
    (file) => !!file && (file.type.startsWith("image/") || /\.(png|jpg|jpeg|webp)$/i.test(file.name))
  );
}

function matchesRoleGallery(person: PersonRow, normalizedRouteRole: string) {
  const role = normalizeRole(person.role);
  const className = clean(person.class_name);

  if (normalizedRouteRole === "Unassigned") {
    return !className && (role === "Unassigned" || !clean(person.role));
  }

  return !className && role === normalizedRouteRole;
}

export default function SchoolsSchoolRoleGalleryPage() {
  const supabase = useMemo(() => createClient(), []);
  const params = useParams();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetPersonRef = useRef<PersonRow | null>(null);
  const folderImagesCacheRef = useRef<Map<string, string[]>>(new Map());
  const schoolId = String(params?.schoolId ?? "");
  const rawRoleParam = params?.role;
  const rawRole = Array.isArray(rawRoleParam) ? rawRoleParam[0] : String(rawRoleParam ?? "");

  const normalizedRouteRole = useMemo(
    () => normalizeRole(decodeURIComponent(rawRole || "")),
    [rawRole]
  );

  const [loading, setLoading] = useState(true);
  const [school, setSchool] = useState<School | null>(null);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [error, setError] = useState("");
  const [shareNotice, setShareNotice] = useState("");
  const [personSearch, setPersonSearch] = useState("");
  const [selectedPersonIds, setSelectedPersonIds] = useState<string[]>([]);
  const [visiblePinIds, setVisiblePinIds] = useState<string[]>([]);
  const [hoveredPersonId, setHoveredPersonId] = useState<string | null>(null);
  const [openPersonMenuId, setOpenPersonMenuId] = useState<string | null>(null);
  const [createPersonOpen, setCreatePersonOpen] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [newPersonPin, setNewPersonPin] = useState("");
  const [queuedPersonFiles, setQueuedPersonFiles] = useState<File[]>([]);
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [uploadingPersonId, setUploadingPersonId] = useState<string | null>(null);
  const [settingsPerson, setSettingsPerson] = useState<PersonRow | null>(null);
  const [settingsName, setSettingsName] = useState("");
  const [settingsPin, setSettingsPin] = useState("");
  const [showSettingsPin, setShowSettingsPin] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState("");
  const [lightbox, setLightbox] = useState<PersonRow | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [photoUrlsMap, setPhotoUrlsMap] = useState<Record<string, string[]>>({});

  async function loadFolderImageUrls(folderPath: string) {
    const cached = folderImagesCacheRef.current.get(folderPath);
    if (cached) return cached;

    const { data: files, error: listError } = await supabase.storage.from("thumbs").list(folderPath, {
      limit: 1000,
      sortBy: { column: "name", order: "asc" },
    });

    if (listError || !files) {
      folderImagesCacheRef.current.set(folderPath, []);
      return [];
    }

    const urls = files
      .filter((file) => !!file.name && /\.(png|jpg|jpeg|webp)$/i.test(file.name))
      .sort((a, b) => naturalCompare(a.name, b.name))
      .map((file) =>
        buildStoredMediaUrls({
          storagePath: `${folderPath}/${file.name}`,
        }).previewUrl,
      )
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
        if (!schoolId || !rawRole) {
          throw new Error("Missing school id or role.");
        }

        const { data: schoolRow, error: schoolError } = await supabase
          .from("schools")
          .select("*")
          .eq("id", schoolId)
          .maybeSingle();

        if (schoolError) throw schoolError;
        if (!schoolRow) throw new Error("School not found.");

        const { data, error: peopleError } = await supabase
          .from("students")
          .select("id,first_name,last_name,class_id,class_name,role,pin,photo_url,folder_name,external_student_id")
          .eq("school_id", schoolId)
          .order("last_name", { ascending: true })
          .order("first_name", { ascending: true });

        if (peopleError) throw peopleError;

        const filtered = ((data ?? []) as PersonRow[])
          .map((person) => {
            const storagePath = extractObjectPathFromPublicUrl(clean(person.photo_url));
            const previewUrl = storagePath
              ? buildStoredMediaUrls({
                  storagePath,
                  previewUrl: person.photo_url,
                }).previewUrl
              : clean(person.photo_url);

            return {
              ...person,
              photo_url: previewUrl || person.photo_url,
            };
          })
          .filter((person) => matchesRoleGallery(person, normalizedRouteRole));

        const urlMap: Record<string, string[]> = {};

        const peopleByFolder = new Map<string, PersonRow[]>();

        for (const person of filtered) {
          if (!person.photo_url) {
            urlMap[person.id] = [];
            continue;
          }

          const folderPath = extractFolderPathFromPublicUrl(person.photo_url);
          if (!folderPath) {
            urlMap[person.id] = [person.photo_url];
            continue;
          }

          const group = peopleByFolder.get(folderPath) ?? [];
          group.push(person);
          peopleByFolder.set(folderPath, group);
        }

        await Promise.all(
          Array.from(peopleByFolder.entries()).map(async ([folderPath, folderPeople]) => {
            try {
              const urls = await loadFolderImageUrls(folderPath);
              for (const person of folderPeople) {
                const mergedUrls = [person.photo_url, ...urls].filter(
                  (value): value is string => Boolean(value),
                );
                urlMap[person.id] = mergedUrls.length
                  ? Array.from(new Set(mergedUrls))
                  : [];
              }
            } catch {
              for (const person of folderPeople) {
                urlMap[person.id] = [person.photo_url!];
              }
            }
          })
        );

        if (!cancelled) {
          setSchool(schoolRow);
          setPeople(filtered);
          setPhotoUrlsMap(urlMap);
          setSelectedPersonIds((prev) => prev.filter((id) => filtered.some((person) => person.id === id)));
          setVisiblePinIds((prev) => prev.filter((id) => filtered.some((person) => person.id === id)));
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load role gallery.");
          setPeople([]);
          setPhotoUrlsMap({});
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [normalizedRouteRole, rawRole, schoolId, supabase]);

  function getPhotoUrls(person: PersonRow) {
    return photoUrlsMap[person.id] ?? (person.photo_url ? [person.photo_url] : []);
  }

  function openViewer(person: PersonRow) {
    if (!getPhotoUrls(person).length) return;
    setOpenPersonMenuId(null);
    setLightbox(person);
    setLightboxIndex(0);
  }

  function openSettings(person: PersonRow) {
    setOpenPersonMenuId(null);
    setSettingsPerson(person);
    setSettingsName(fullNameOf(person));
    setSettingsPin(clean(person.pin));
    setShowSettingsPin(false);
    setSettingsMsg("");
  }

  async function copyRoleLink() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setShareNotice("Role link copied");
      window.setTimeout(() => setShareNotice(""), 2200);
    } catch {
      setShareNotice("Could not copy link");
      window.setTimeout(() => setShareNotice(""), 2200);
    }
  }

  function resetCreatePersonForm() {
    uploadTargetPersonRef.current = null;
    setCreatePersonOpen(false);
    setNewPersonName("");
    setNewPersonPin("");
    setQueuedPersonFiles([]);
  }

  async function uploadFilesToPerson(person: PersonRow, files: File[]) {
    const filesToUpload = imageFilesOnly(files);
    if (!filesToUpload.length) return;

    const currentPhotoUrl = clean(person.photo_url);
    const currentFolderPath = currentPhotoUrl ? extractFolderPathFromPublicUrl(currentPhotoUrl) : null;
    const basePath = safeStorageSegment(clean(school?.local_school_id) || schoolId, schoolId);
    const rolePath = safeStorageSegment(normalizedRouteRole, "Role");
    const derivedFolderName =
      clean(person.folder_name) ||
      (currentFolderPath ? currentFolderPath.split("/").filter(Boolean).at(-1) ?? "" : "") ||
      `${safeStorageSegment(fullNameOf(person), "Person")}-${Date.now()}`;
    const storageFolderPath = currentFolderPath || `${basePath}/roles/${rolePath}/${derivedFolderName}`;
    const existingUrls = getPhotoUrls(person);

    setUploadingPersonId(person.id);
    setError("");

    try {
      const uploadedAssets: UploadedPersonAsset[] = [];
      const syncTarget = await ensureSchoolCollectionId(supabase, {
        schoolId,
        school,
        kind: "gallery",
        title: normalizedRouteRole,
        slugFallback: "gallery",
      });

      for (const [index, file] of filesToUpload.entries()) {
        const originalExt = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
        const ext = clean(originalExt).toLowerCase() || "jpg";
        const storagePath = `${storageFolderPath}/${Date.now()}-${index}-${Math.random().toString(36).slice(2)}.${ext}`;

        const { error: uploadError } = await supabase.storage.from("thumbs").upload(storagePath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || undefined,
        });

        if (uploadError) {
          throw new Error(uploadError.message || "Photo upload failed.");
        }

        const publicUrl = buildStoredMediaUrls({ storagePath }).previewUrl;
        if (clean(publicUrl)) {
          uploadedAssets.push({
            storagePath,
            publicUrl,
            filename: file.name,
            mimeType: file.type || null,
          });
        }
      }

      const uploadedUrls = uploadedAssets.map((asset) => asset.publicUrl).filter(Boolean);
      if (!uploadedUrls.length) return;

      let nextPerson = person;
      const needsPersonUpdate = !clean(person.photo_url) || clean(person.folder_name) !== derivedFolderName;

      if (needsPersonUpdate) {
        const { data: updatedRow, error: updateError } = await supabase
          .from("students")
          .update({
            photo_url: clean(person.photo_url) || uploadedUrls[0],
            folder_name: derivedFolderName,
          })
          .eq("id", person.id)
          .select("id,first_name,last_name,class_id,class_name,role,pin,photo_url,folder_name,external_student_id")
          .single();

        if (updateError) {
          throw new Error(updateError.message || "Photos uploaded, but person could not be updated.");
        }

        nextPerson = updatedRow as PersonRow;
        setPeople((prev) => prev.map((row) => (row.id === nextPerson.id ? nextPerson : row)));
      }

      if (syncTarget.projectId && syncTarget.collectionId) {
        await appendSchoolMediaRows(supabase, {
          projectId: syncTarget.projectId,
          collectionId: syncTarget.collectionId,
          assets: uploadedAssets,
        });
      }

      setPhotoUrlsMap((prev) => ({
        ...prev,
        [person.id]: Array.from(new Set([...(existingUrls.length ? existingUrls : clean(person.photo_url) ? [clean(person.photo_url)] : []), ...uploadedUrls])),
      }));
      setShareNotice(
        uploadedUrls.length === 1 ? "1 photo added to person" : `${uploadedUrls.length} photos added to person`
      );
      window.setTimeout(() => setShareNotice(""), 2200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to upload photos.");
    } finally {
      setUploadingPersonId(null);
    }
  }

  function queuePersonFiles(event: ChangeEvent<HTMLInputElement>) {
    const nextFiles = imageFilesOnly(Array.from(event.target.files ?? []));
    const targetPerson = uploadTargetPersonRef.current;
    uploadTargetPersonRef.current = null;
    event.target.value = "";

    if (nextFiles.length) {
      if (targetPerson) {
        void uploadFilesToPerson(targetPerson, nextFiles);
        return;
      }
      setQueuedPersonFiles((prev) => [...prev, ...nextFiles]);
    }
  }

  function openPersonUpload(person: PersonRow, kind: "photos" | "folder") {
    uploadTargetPersonRef.current = person;
    setOpenPersonMenuId(null);
    setError("");

    if (kind === "folder") {
      folderInputRef.current?.click();
      return;
    }

    fileInputRef.current?.click();
  }

  async function createPerson() {
    const fullName = clean(newPersonName);
    if (!fullName) return;

    const { firstName, lastName } = splitDisplayName(fullName);
    if (!firstName) return;

    const filesToUpload = [...queuedPersonFiles];
    const folderName = filesToUpload.length
      ? `${safeStorageSegment(fullName, "Person")}-${Date.now()}`
      : null;

    setCreatingPerson(true);
    setError("");

    try {
      const syncTarget = await ensureSchoolCollectionId(supabase, {
        schoolId,
        school,
        kind: "gallery",
        title: normalizedRouteRole,
        slugFallback: "gallery",
      });

      const { data: insertedRow, error: insertError } = await supabase
        .from("students")
        .insert({
          school_id: schoolId,
          class_id: null,
          class_name: null,
          role: normalizedRouteRole,
          first_name: firstName,
          last_name: lastName,
          pin: clean(newPersonPin),
          folder_name: folderName,
          photo_url: null,
          external_student_id: null,
        })
        .select("id,first_name,last_name,class_id,class_name,role,pin,photo_url,folder_name,external_student_id")
        .single();

      if (insertError) throw insertError;

      let nextPerson = insertedRow as PersonRow;
      setPeople((prev) => [...prev, nextPerson]);
      setPhotoUrlsMap((prev) => ({ ...prev, [nextPerson.id]: [] }));
      resetCreatePersonForm();

      if (filesToUpload.length) {
        const basePath = safeStorageSegment(clean(school?.local_school_id) || schoolId, schoolId);
        const rolePath = safeStorageSegment(normalizedRouteRole, "Role");
        const uploadedAssets: UploadedPersonAsset[] = [];

        for (const [index, file] of filesToUpload.entries()) {
          const originalExt = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
          const ext = clean(originalExt).toLowerCase() || "jpg";
          const storagePath = `${basePath}/roles/${rolePath}/${folderName}/${Date.now()}-${index}-${Math.random().toString(36).slice(2)}.${ext}`;

          const { error: uploadError } = await supabase.storage.from("thumbs").upload(storagePath, file, {
            cacheControl: "3600",
            upsert: false,
            contentType: file.type || undefined,
          });

          if (uploadError) {
            throw new Error(uploadError.message || "Person added, but photo upload failed.");
          }

          const publicUrl = buildStoredMediaUrls({ storagePath }).previewUrl;
          if (clean(publicUrl)) {
            uploadedAssets.push({
              storagePath,
              publicUrl,
              filename: file.name,
              mimeType: file.type || null,
            });
          }
        }

        const uploadedUrls = uploadedAssets.map((asset) => asset.publicUrl).filter(Boolean);
        if (uploadedUrls.length) {
          const { data: updatedRow, error: updateError } = await supabase
            .from("students")
            .update({
              photo_url: uploadedUrls[0],
              folder_name: folderName,
            })
            .eq("id", nextPerson.id)
            .select("id,first_name,last_name,class_id,class_name,role,pin,photo_url,folder_name,external_student_id")
            .single();

          if (updateError) {
            throw new Error(updateError.message || "Person added, but photo link could not be saved.");
          }

          nextPerson = updatedRow as PersonRow;
          setPeople((prev) => prev.map((person) => (person.id === nextPerson.id ? nextPerson : person)));
          setPhotoUrlsMap((prev) => ({ ...prev, [nextPerson.id]: uploadedUrls }));
        }

        if (syncTarget.projectId && syncTarget.collectionId) {
          await appendSchoolMediaRows(supabase, {
            projectId: syncTarget.projectId,
            collectionId: syncTarget.collectionId,
            assets: uploadedAssets,
          });
        }
      }

      setShareNotice(filesToUpload.length ? "Person added with photos" : "Person added");
      window.setTimeout(() => setShareNotice(""), 2200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add person.");
    } finally {
      setCreatingPerson(false);
    }
  }

  async function handleSaveSettings() {
    if (!settingsPerson) return;

    setSettingsSaving(true);
    setSettingsMsg("");

    const parts = settingsName.trim().split(" ").filter(Boolean);

    const { error: err } = await supabase
      .from("students")
      .update({
        first_name: parts[0] ?? settingsPerson.first_name,
        last_name: parts.slice(1).join(" ") || settingsPerson.last_name,
        pin: settingsPin.trim(),
      })
      .eq("id", settingsPerson.id);

    if (err) {
      setSettingsMsg(err.message);
      setSettingsSaving(false);
      return;
    }

    const updatedPerson: PersonRow = {
      ...settingsPerson,
      first_name: parts[0] ?? settingsPerson.first_name,
      last_name: parts.slice(1).join(" ") || settingsPerson.last_name,
      pin: settingsPin.trim(),
    };

    setShareNotice("Person updated");
    window.setTimeout(() => setShareNotice(""), 2200);
    setPeople((prev) => prev.map((person) => (person.id === updatedPerson.id ? updatedPerson : person)));
    if (lightbox?.id === updatedPerson.id) {
      setLightbox(updatedPerson);
    }
    setSettingsPerson(null);
    setSettingsSaving(false);
  }

  async function deletePeople(ids: string[]) {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (!uniqueIds.length) return;

    const confirmed =
      typeof window !== "undefined"
        ? window.confirm(
            uniqueIds.length === 1 ? "Delete this person?" : `Delete ${uniqueIds.length} selected people?`
          )
        : false;

    if (!confirmed) return;

    try {
      const { error: deleteError } = await supabase.from("students").delete().in("id", uniqueIds);
      if (deleteError) throw deleteError;

      setPeople((prev) => prev.filter((person) => !uniqueIds.includes(person.id)));
      setSelectedPersonIds((prev) => prev.filter((id) => !uniqueIds.includes(id)));
      setVisiblePinIds((prev) => prev.filter((id) => !uniqueIds.includes(id)));
      setOpenPersonMenuId((prev) => (prev && uniqueIds.includes(prev) ? null : prev));
      setPhotoUrlsMap((prev) => {
        const next = { ...prev };
        for (const id of uniqueIds) delete next[id];
        return next;
      });
      if (settingsPerson && uniqueIds.includes(settingsPerson.id)) {
        setSettingsPerson(null);
      }
      if (lightbox && uniqueIds.includes(lightbox.id)) {
        setLightbox(null);
        setLightboxIndex(0);
      }
      setShareNotice(uniqueIds.length === 1 ? "Person deleted" : "People deleted");
      window.setTimeout(() => setShareNotice(""), 2200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete person.");
    }
  }

  function toggleSelectedPerson(personId: string) {
    setSelectedPersonIds((prev) =>
      prev.includes(personId) ? prev.filter((id) => id !== personId) : [...prev, personId]
    );
  }

  function toggleVisiblePin(personId: string) {
    setVisiblePinIds((prev) =>
      prev.includes(personId) ? prev.filter((id) => id !== personId) : [...prev, personId]
    );
  }

  const orderedPeople = useMemo(
    () =>
      [...people].sort((a, b) =>
        fullNameOf(a).localeCompare(fullNameOf(b), undefined, { numeric: true, sensitivity: "base" })
      ),
    [people]
  );

  const filteredPeople = useMemo(() => {
    const query = clean(personSearch).toLowerCase();
    if (!query) return orderedPeople;

    return orderedPeople.filter((person) => {
      const fullName = fullNameOf(person).toLowerCase();
      const pin = clean(person.pin).toLowerCase();
      const folderName = clean(person.folder_name).toLowerCase();
      const externalId = clean(person.external_student_id).toLowerCase();
      return (
        fullName.includes(query) ||
        pin.includes(query) ||
        folderName.includes(query) ||
        externalId.includes(query)
      );
    });
  }, [orderedPeople, personSearch]);

  const allSelected =
    filteredPeople.length > 0 && filteredPeople.every((person) => selectedPersonIds.includes(person.id));
  const searchCountLabel = `${filteredPeople.length} of ${orderedPeople.length}`;
  const peopleWithPhotos = useMemo(
    () =>
      people.filter((person) => {
        const urls = photoUrlsMap[person.id];
        if (urls) return urls.length > 0;
        return Boolean(clean(person.photo_url));
      }).length,
    [people, photoUrlsMap]
  );
  const totalPhotos = useMemo(
    () => Object.values(photoUrlsMap).reduce((sum, urls) => sum + urls.length, 0),
    [photoUrlsMap]
  );
  const lightboxPhotos = lightbox ? getPhotoUrls(lightbox) : [];
  const folderInputProps: Record<string, string> = { webkitdirectory: "", directory: "" };
  const title = normalizedRouteRole || "Role Gallery";

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
            <h1
              style={{
                fontSize: 34,
                fontWeight: 900,
                color: "#111827",
                margin: "8px 0 0",
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              {getRoleIcon(title)}
              {title}
            </h1>
            <div style={{ color: "#b91c1c", marginTop: 8, fontWeight: 700 }}>
              {people.length} person{people.length !== 1 ? "s" : ""}
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button
              onClick={() => {
                uploadTargetPersonRef.current = null;
                setError("");
                setCreatePersonOpen(true);
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
              <Plus size={16} /> Add Person
            </button>
            <button
              onClick={copyRoleLink}
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
              Share Role
            </button>
            <Link
              href={`/dashboard/projects/schools/${schoolId}/settings`}
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
              School Settings
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
                    setSelectedPersonIds((prev) =>
                      allSelected ? prev.filter((id) => !filteredPeople.some((person) => person.id === id)) : Array.from(new Set([...prev, ...filteredPeople.map((person) => person.id)]))
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
                  onClick={() => void deletePeople(selectedPersonIds)}
                  disabled={!selectedPersonIds.length}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    borderRadius: 10,
                    border: `1px solid ${selectedPersonIds.length ? "#fecaca" : "#d0d5dd"}`,
                    background: "#fff",
                    color: selectedPersonIds.length ? "#b42318" : "#98a2b3",
                    padding: "9px 12px",
                    fontWeight: 700,
                    cursor: selectedPersonIds.length ? "pointer" : "not-allowed",
                  }}
                >
                  <Trash2 size={16} /> Delete Selected{selectedPersonIds.length ? ` (${selectedPersonIds.length})` : ""}
                </button>
                <div style={{ flex: "1 1 280px", minWidth: 220, maxWidth: 420, position: "relative" }}>
                  <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#6b7280", pointerEvents: "none" }} />
                  <input
                    value={personSearch}
                    onChange={(event) => setPersonSearch(event.target.value)}
                    placeholder="Search people, PIN, or folder..."
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
                {personSearch ? <div style={{ color: "#b91c1c", fontSize: 13, fontWeight: 700, minWidth: 72, textAlign: "right" }}>{searchCountLabel}</div> : null}
                <button style={{ borderRadius: 10, border: "1px solid #111111", background: "#fff", color: "#111111", padding: "9px 12px", fontWeight: 700, cursor: "pointer" }}>
                  Sort by: Name A-Z
                </button>
              </div>
            </div>

            <div style={{ color: "#111111", marginBottom: 16, fontWeight: 700 }}>
              {people.length} people • {peopleWithPhotos} with photos • {totalPhotos} photos
            </div>

            {filteredPeople.length === 0 ? (
              <div style={{ border: "1px dashed #d0d5dd", borderRadius: 18, padding: 24, color: "#4b5563" }}>
                {personSearch ? "No people found." : "No people in this role yet."}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 18 }}>
                {filteredPeople.map((person) => {
                  const photoUrl = clean(person.photo_url);
                  const photoUrls = getPhotoUrls(person);
                  const selected =
                    selectedPersonIds.includes(person.id) ||
                    hoveredPersonId === person.id ||
                    openPersonMenuId === person.id;
                  const pinVisible = visiblePinIds.includes(person.id);
                  const initials = `${clean(person.first_name).charAt(0)}${clean(person.last_name).charAt(0)}`;

                  return (
                    <div
                      key={person.id}
                      onMouseEnter={() => setHoveredPersonId(person.id)}
                      onMouseLeave={() => setHoveredPersonId((prev) => (prev === person.id ? null : prev))}
                      style={{
                        background: "#fff",
                        border: selected ? "2px solid #b91c1c" : "1px solid #e5e7eb",
                        borderRadius: 18,
                        overflow: "visible",
                        boxShadow: "0 8px 24px rgba(16,24,40,0.05)",
                        position: "relative",
                        zIndex: openPersonMenuId === person.id ? 30 : 1,
                      }}
                    >
                      <button
                        onClick={() => toggleSelectedPerson(person.id)}
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
                        onClick={() => openViewer(person)}
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
                            aspectRatio: "3 / 4",
                            background: photoUrl ? `url(${photoUrl}) center/cover no-repeat` : "#e5e7eb",
                            display: photoUrl ? "block" : "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexDirection: "column",
                            gap: 8,
                          }}
                        >
                          {!photoUrl ? (
                            <>
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
                                }}
                              >
                                {initials || "?"}
                              </div>
                              <span style={{ fontSize: 11, color: "#98a2b3" }}>No photo synced</span>
                            </>
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
                          {fullNameOf(person)}
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
                              {pinVisible ? clean(person.pin) || "No PIN" : clean(person.pin) ? "••••••" : "No PIN"}
                            </span>
                          </div>
                          <button
                            onClick={() => toggleVisiblePin(person.id)}
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
                            onClick={() => openViewer(person)}
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
                              disabled={uploadingPersonId === person.id}
                              onClick={() => setOpenPersonMenuId((prev) => (prev === person.id ? null : person.id))}
                              style={{
                                width: 40,
                                height: 40,
                                borderRadius: 10,
                                border: "1px solid #111111",
                                background: openPersonMenuId === person.id ? "#fff5f5" : "#fff",
                                color: "#111111",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: uploadingPersonId === person.id ? "wait" : "pointer",
                                opacity: uploadingPersonId === person.id ? 0.7 : 1,
                              }}
                              aria-label="Person actions"
                            >
                              {uploadingPersonId === person.id ? (
                                <span style={{ fontSize: 10, fontWeight: 800 }}>...</span>
                              ) : (
                                <Menu size={18} />
                              )}
                            </button>
                            {openPersonMenuId === person.id ? (
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
                                  onClick={() => openSettings(person)}
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
                                  onClick={() => openSettings(person)}
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
                                  onClick={() => openPersonUpload(person, "photos")}
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
                                  onClick={() => openPersonUpload(person, "folder")}
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
                                  onClick={() => void deletePeople([person.id])}
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

      <input ref={fileInputRef} type="file" multiple accept="image/*" onChange={queuePersonFiles} style={{ display: "none" }} />
      <input ref={folderInputRef} type="file" multiple accept="image/*" onChange={queuePersonFiles} style={{ display: "none" }} {...folderInputProps} />

      {createPersonOpen ? (
        <>
          <div
            onClick={resetCreatePersonForm}
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
                <div style={{ fontSize: 24, fontWeight: 900, color: "#111827" }}>Add Person</div>
                <div style={{ color: "#667085", marginTop: 4 }}>Create a person first, then upload one photo or a whole folder into this role gallery.</div>
              </div>
              <button type="button" onClick={resetCreatePersonForm} style={{ background: "none", border: "none", cursor: "pointer", color: "#667085" }}>
                <X size={22} />
              </button>
            </div>

            <div style={{ padding: 22, display: "grid", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontWeight: 700, color: "#111111", marginBottom: 8 }}>Person Name</label>
                <input
                  value={newPersonName}
                  onChange={(e) => setNewPersonName(e.target.value)}
                  placeholder="Coach Harout"
                  autoFocus
                  style={{ width: "100%", boxSizing: "border-box", borderRadius: 14, border: "1px solid #d0d5dd", padding: "13px 14px", fontSize: 15, color: "#111111", outline: "none" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontWeight: 700, color: "#111111", marginBottom: 8 }}>PIN / Password</label>
                <input
                  value={newPersonPin}
                  onChange={(e) => setNewPersonPin(e.target.value)}
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
                  {queuedPersonFiles.length ? (
                    <button type="button" onClick={() => setQueuedPersonFiles([])} style={{ borderRadius: 12, border: "1px solid #fecaca", background: "#fff", color: "#b91c1c", padding: "10px 12px", fontWeight: 700, cursor: "pointer" }}>
                      Clear Files
                    </button>
                  ) : null}
                </div>
                <div style={{ color: "#667085", fontSize: 13, marginTop: 10 }}>
                  {queuedPersonFiles.length ? `${queuedPersonFiles.length} photo${queuedPersonFiles.length !== 1 ? "s" : ""} ready to upload.` : "You can save without photos and add more later from the person's 3-line menu."}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, padding: "18px 22px", borderTop: "1px solid #eef2f7" }}>
              <button type="button" onClick={resetCreatePersonForm} style={{ borderRadius: 14, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "12px 16px", fontWeight: 800, cursor: "pointer" }}>
                Cancel
              </button>
              <button type="button" onClick={() => void createPerson()} disabled={!clean(newPersonName) || creatingPerson} style={{ borderRadius: 14, border: 0, background: !clean(newPersonName) || creatingPerson ? "#d1d5db" : "#111111", color: "#fff", padding: "12px 16px", fontWeight: 800, cursor: !clean(newPersonName) || creatingPerson ? "not-allowed" : "pointer" }}>
                {creatingPerson ? "Saving..." : "Add Person"}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {settingsPerson ? (
        <>
          <div
            onClick={() => setSettingsPerson(null)}
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
                <div style={{ fontSize: 24, fontWeight: 900, color: "#111827" }}>Person Details</div>
                <div style={{ color: "#667085", marginTop: 4 }}>Update the name and PIN/password.</div>
              </div>

              <button
                type="button"
                onClick={() => setSettingsPerson(null)}
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
                  Name
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
                  PIN / Password
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
                onClick={() => void deletePeople([settingsPerson.id])}
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
                Delete Person
              </button>

              <div style={{ display: "flex", gap: 12 }}>
                <button
                  type="button"
                  onClick={() => setSettingsPerson(null)}
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

"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Briefcase,
  Shield,
  Star,
  UserCog,
  UserRound,
  Users,
  Lock,
  Menu,
  Search,
  X,
  Mail,
  Send,
  Copy,
  ExternalLink,
  Heart,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ensureSchoolCollectionId } from "@/lib/school-sync";

type School = {
  id: string;
  school_name: string;
  local_school_id: string | null;
  photographer_id?: string | null;
  package_profile_id?: string | null;
  shoot_date?: string | null;
  portal_status?: string | null;
  status?: string | null;
  access_mode?: string | null;
  access_pin?: string | null;
  access?: string | null;
  password_protected?: boolean | null;
};

type PersonRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  class_name: string | null;
  role: string | null;
  photo_url: string | null;
};

type ClassCollectionRow = {
  id: string;
  title: string | null;
  slug: string | null;
  kind: string | null;
  cover_photo_url?: string | null;
  sort_order?: number | null;
};

type CoverOption = {
  id: string;
  url: string;
  label: string;
};

type FolderCoverAsset = {
  url: string;
  label: string;
};

type GalleryCard = {
  key: string;
  label: string;
  rawLabel: string;
  count: number;
  href: string;
  kind: "class" | "role";
  coverPhoto?: string;
};

type SchoolContact = {
  id: string;
  name: string;
  email: string;
  phone: string;
};

const ROLE_ORDER = [
  "Teacher",
  "Coach",
  "Principal",
  "Office Staff",
  "Staff",
  "Unassigned",
] as const;

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function slugify(value: string) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "class";
}

function safeStorageSegment(value: string, fallback: string) {
  return clean(value).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || fallback;
}

function extractObjectPathFromPublicUrl(url: string): string | null {
  try {
    const marker = "/storage/v1/object/public/thumbs/";
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    return decodeURIComponent(url.substring(idx + marker.length));
  } catch {
    return null;
  }
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

function labelFromCoverUrl(url: string, fallback: string) {
  const cleaned = clean(url);
  if (!cleaned) return fallback;
  const parts = cleaned.split("/");
  const raw = parts[parts.length - 1]?.split("?")[0] ?? "";
  return decodeURIComponent(raw || fallback);
}

function normalizedAccessMode(value: string | null | undefined) {
  const raw = clean(value).toLowerCase();
  if (!raw) return "public";
  if (raw === "pin" || raw === "protected" || raw === "private") return "pin";
  return raw;
}

function hasPinProtection(mode: string | null | undefined, pin: string | null | undefined) {
  return normalizedAccessMode(mode) === "pin" && clean(pin).length > 0;
}

function formatDisplayDate(value: string | null | undefined) {
  if (!value) return "No date set";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "No date set";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && clean(err.message)) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const message = clean(String((err as { message?: unknown }).message ?? ""));
    if (message) return message;
  }
  return fallback;
}

function isStudentLike(role: string, className: string) {
  if (className) return true;
  return role === "Student";
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

async function findSyncedProjectId(
  supabase: ReturnType<typeof createClient>,
  schoolId: string,
  options?: {
    localSchoolId?: string | null;
  }
) {
  const schoolProjectByLinkedSchoolId = await supabase
    .from("projects")
    .select("id")
    .eq("workflow_type", "school")
    .eq("linked_school_id", schoolId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (schoolProjectByLinkedSchoolId.data?.id) {
    return schoolProjectByLinkedSchoolId.data.id;
  }

  const localSchoolId = clean(options?.localSchoolId);
  if (localSchoolId) {
    const schoolProjectByLinkedLocalSchoolId = await supabase
      .from("projects")
      .select("id")
      .eq("workflow_type", "school")
      .eq("linked_local_school_id", localSchoolId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (schoolProjectByLinkedLocalSchoolId.data?.id) {
      return schoolProjectByLinkedLocalSchoolId.data.id;
    }
  }

  return null;
}

async function ensureSyncedProjectId(
  supabase: ReturnType<typeof createClient>,
  schoolId: string,
  school: School | null
) {
  const existingId = await findSyncedProjectId(supabase, schoolId, {
    localSchoolId: school?.local_school_id,
  });

  if (existingId) return existingId;

  const photographerId = clean(school?.photographer_id);
  if (!photographerId) {
    throw new Error("This school is missing its photographer link, so the cover could not sync yet.");
  }

  const { data, error } = await supabase
    .from("projects")
    .insert({
      photographer_id: photographerId,
      workflow_type: "school",
      source_type: "cloud_only",
      title: clean(school?.school_name) || "School Gallery",
      linked_school_id: schoolId,
      linked_local_school_id: clean(school?.local_school_id) || null,
      status: clean(school?.portal_status) || clean(school?.status) || "active",
    })
    .select("id")
    .single();

  if (error) {
    const fallbackId = await findSyncedProjectId(supabase, schoolId, {
      localSchoolId: school?.local_school_id,
    });
    if (fallbackId) return fallbackId;
    throw error;
  }

  return clean(data?.id) || null;
}

export default function SchoolsSchoolDetailPage() {
  const [supabase] = useState(() => createClient());
  const params = useParams();
  const schoolCoverInputRef = useRef<HTMLInputElement | null>(null);
  const coverFolderCacheRef = useRef<Map<string, FolderCoverAsset[]>>(new Map());

  const schoolId = params?.schoolId as string;

  const [loading, setLoading] = useState(true);
  const [school, setSchool] = useState<School | null>(null);
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [classCollectionsBySlug, setClassCollectionsBySlug] = useState<Record<string, ClassCollectionRow>>({});
  const [roleCollectionsBySlug, setRoleCollectionsBySlug] = useState<Record<string, ClassCollectionRow>>({});
  const [error, setError] = useState("");
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [hoveredClassId, setHoveredClassId] = useState<string | null>(null);
  const [hoveredRoleId, setHoveredRoleId] = useState<string | null>(null);
  const [classSearch, setClassSearch] = useState("");
  const [shareNotice, setShareNotice] = useState("");
  const [createGalleryKind, setCreateGalleryKind] = useState<"class" | "role" | null>(null);
  const [createGalleryName, setCreateGalleryName] = useState("");
  const [creatingGallery, setCreatingGallery] = useState(false);
  const [openClassMenuId, setOpenClassMenuId] = useState<string | null>(null);
  const [openSchoolMenu, setOpenSchoolMenu] = useState(false);
  const [schoolProjectCoverUrl, setSchoolProjectCoverUrl] = useState("");
  const [schoolCoverPickerOpen, setSchoolCoverPickerOpen] = useState(false);
  const [schoolCoverPickerLoading, setSchoolCoverPickerLoading] = useState(false);
  const [schoolCoverPickerSaving, setSchoolCoverPickerSaving] = useState(false);
  const [schoolCoverUploading, setSchoolCoverUploading] = useState(false);
  const [schoolCoverOptions, setSchoolCoverOptions] = useState<CoverOption[]>([]);
  const [selectedSchoolCoverUrl, setSelectedSchoolCoverUrl] = useState<string | null>(null);
  const [classCoverPickerOpen, setClassCoverPickerOpen] = useState(false);
  const [classCoverPickerLoading, setClassCoverPickerLoading] = useState(false);
  const [classCoverPickerSaving, setClassCoverPickerSaving] = useState(false);
  const [coverPickerClassName, setCoverPickerClassName] = useState("");
  const [coverPickerClassLabel, setCoverPickerClassLabel] = useState("");
  const [classCoverOptions, setClassCoverOptions] = useState<CoverOption[]>([]);
  const [selectedClassCoverUrl, setSelectedClassCoverUrl] = useState<string | null>(null);
  const [openRoleMenuId, setOpenRoleMenuId] = useState<string | null>(null);
  const [roleCoverPickerOpen, setRoleCoverPickerOpen] = useState(false);
  const [roleCoverPickerLoading, setRoleCoverPickerLoading] = useState(false);
  const [roleCoverPickerSaving, setRoleCoverPickerSaving] = useState(false);
  const [coverPickerRoleName, setCoverPickerRoleName] = useState("");
  const [roleCoverOptions, setRoleCoverOptions] = useState<CoverOption[]>([]);
  const [selectedRoleCoverUrl, setSelectedRoleCoverUrl] = useState<string | null>(null);
  const [contacts, setContacts] = useState<SchoolContact[]>([]);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [schoolSyncedProjectId, setSchoolSyncedProjectId] = useState<string | null>(null);
  const [focalEditorOpen, setFocalEditorOpen] = useState(false);
  const [focalX, setFocalX] = useState(0.5);
  const [focalY, setFocalY] = useState(0.5);
  const [savingFocal, setSavingFocal] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  useEffect(() => {
    if (!schoolId || typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(`studioos_school_contacts_${schoolId}`);
      if (!raw) {
        setContacts([]);
        return;
      }
      const parsed = JSON.parse(raw) as SchoolContact[];
      setContacts(Array.isArray(parsed) ? parsed : []);
    } catch {
      setContacts([]);
    }
  }, [schoolId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        if (!schoolId) throw new Error("Missing school id.");

        const { data: schoolRow, error: schoolError } = await supabase
          .from("schools")
          .select("*")
          .eq("id", schoolId)
          .maybeSingle();

        if (schoolError) throw schoolError;
        if (!schoolRow) throw new Error("School not found.");

        const { data: peopleRows, error: peopleError } = await supabase
          .from("students")
          .select("id,first_name,last_name,class_name,role,photo_url")
          .eq("school_id", schoolId);

        if (peopleError) throw peopleError;

        const syncedProjectId = await findSyncedProjectId(supabase, schoolId, {
          localSchoolId: (schoolRow as School).local_school_id,
        });
        if (!cancelled) setSchoolSyncedProjectId(syncedProjectId);
        const nextClassCollectionsBySlug: Record<string, ClassCollectionRow> = {};
        const nextRoleCollectionsBySlug: Record<string, ClassCollectionRow> = {};
        let nextSchoolProjectCoverUrl = "";

        if (syncedProjectId) {
          const { data: syncedProjectRow, error: projectError } = await supabase
            .from("projects")
            .select("cover_photo_url,cover_focal_x,cover_focal_y")
            .eq("id", syncedProjectId)
            .maybeSingle();

          if (projectError) throw projectError;

          const spRow = syncedProjectRow as { cover_photo_url?: string | null; cover_focal_x?: number | null; cover_focal_y?: number | null } | null;
          nextSchoolProjectCoverUrl = clean(spRow?.cover_photo_url);
          if (!cancelled) {
            setFocalX(Number(spRow?.cover_focal_x) || 0.5);
            setFocalY(Number(spRow?.cover_focal_y) || 0.5);
          }

          const { data: collectionRows, error: collectionError } = await supabase
            .from("collections")
            .select("id,title,slug,kind,cover_photo_url,sort_order")
            .eq("project_id", syncedProjectId)
            .in("kind", ["class", "gallery"]);

          if (collectionError) throw collectionError;

          for (const row of (collectionRows ?? []) as ClassCollectionRow[]) {
            const key = clean(row.slug);
            if (!key) continue;
            const kind = clean(row.kind).toLowerCase();
            if (kind === "class") {
              nextClassCollectionsBySlug[key] = row;
            } else if (kind === "gallery") {
              nextRoleCollectionsBySlug[key] = row;
            }
          }
        }

        if (!cancelled) {
          setSchool(schoolRow as School);
          setRows((peopleRows ?? []) as PersonRow[]);
          setClassCollectionsBySlug(nextClassCollectionsBySlug);
          setRoleCollectionsBySlug(nextRoleCollectionsBySlug);
          setSchoolProjectCoverUrl(nextSchoolProjectCoverUrl);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load school.");
          setRows([]);
          setClassCollectionsBySlug({});
          setRoleCollectionsBySlug({});
          setSchoolProjectCoverUrl("");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [schoolId, supabase]);

  async function loadCoverAssets(folderPath: string) {
    const cached = coverFolderCacheRef.current.get(folderPath);
    if (cached) return cached;

    const { data: files, error: listError } = await supabase.storage.from("thumbs").list(folderPath, {
      limit: 1000,
      sortBy: { column: "name", order: "asc" },
    });

    if (listError || !files) {
      coverFolderCacheRef.current.set(folderPath, []);
      return [];
    }

    const assets = files
      .filter((file) => !!file.name && /\.(png|jpg|jpeg|webp)$/i.test(file.name))
      .sort((a, b) => naturalCompare(a.name, b.name))
      .map((file) => ({
        url: supabase.storage.from("thumbs").getPublicUrl(`${folderPath}/${file.name}`).data.publicUrl,
        label: file.name,
      }));

    coverFolderCacheRef.current.set(folderPath, assets);
    return assets;
  }

  async function buildCoverOptions(sourceRows: PersonRow[]) {
    const optionMap = new Map<string, CoverOption>();
    const rowsByFolder = new Map<string, Array<{ rowId: string; photoUrl: string; fallbackLabel: string }>>();

    for (const row of sourceRows) {
      const fallbackLabel =
        `${clean(row.first_name)} ${clean(row.last_name)}`.trim() ||
        clean(row.class_name) ||
        normalizeRole(row.role) ||
        "Photo";
      const photoUrl = clean(row.photo_url);
      if (!photoUrl) continue;

      const folderPath = extractFolderPathFromPublicUrl(photoUrl);
      if (!folderPath) {
        optionMap.set(photoUrl, {
          id: `${row.id}-cover`,
          url: photoUrl,
          label: labelFromCoverUrl(photoUrl, fallbackLabel),
        });
        continue;
      }

      const entries = rowsByFolder.get(folderPath) ?? [];
      entries.push({ rowId: row.id, photoUrl, fallbackLabel });
      rowsByFolder.set(folderPath, entries);
    }

    await Promise.all(
      Array.from(rowsByFolder.entries()).map(async ([folderPath, entries]) => {
        try {
          const assets = await loadCoverAssets(folderPath);
          if (!assets.length) {
            for (const entry of entries) {
              if (!optionMap.has(entry.photoUrl)) {
                optionMap.set(entry.photoUrl, {
                  id: `${entry.rowId}-cover`,
                  url: entry.photoUrl,
                  label: labelFromCoverUrl(entry.photoUrl, entry.fallbackLabel),
                });
              }
            }
            return;
          }

          assets.forEach((asset, index) => {
            if (!optionMap.has(asset.url)) {
              optionMap.set(asset.url, {
                id: `${entries[0]?.rowId ?? folderPath}-${index}`,
                url: asset.url,
                label: asset.label,
              });
            }
          });
        } catch {
          for (const entry of entries) {
            if (!optionMap.has(entry.photoUrl)) {
              optionMap.set(entry.photoUrl, {
                id: `${entry.rowId}-cover`,
                url: entry.photoUrl,
                label: labelFromCoverUrl(entry.photoUrl, entry.fallbackLabel),
              });
            }
          }
        }
      })
    );

    return Array.from(optionMap.values());
  }

  function openSchoolSettingsPage() {
    if (typeof window === "undefined") return;
    window.location.assign(`/dashboard/projects/schools/${schoolId}/settings`);
  }

  function openContactModal() {
    setContactName("");
    setContactEmail("");
    setContactPhone("");
    setContactModalOpen(true);
  }

  function saveContacts(nextContacts: SchoolContact[]) {
    setContacts(nextContacts);
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`studioos_school_contacts_${schoolId}`, JSON.stringify(nextContacts));
  }

  function addContact() {
    const name = clean(contactName);
    if (!name) return;
    const nextContact: SchoolContact = {
      id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name,
      email: clean(contactEmail),
      phone: clean(contactPhone),
    };

    saveContacts([...contacts, nextContact]);
    setContactModalOpen(false);
    setShareNotice("Contact added");
    if (typeof window !== "undefined") {
      window.setTimeout(() => setShareNotice(""), 2200);
    }
  }

  const grouped = useMemo(() => {
    const classCounts: Record<string, number> = {};
    const roleCountsMap: Record<string, number> = {};
    const classCovers: Record<string, string> = {};
    const roleCovers: Record<string, string> = {};
    let totalStudents = 0;
    let firstSchoolPhoto = "";

    for (const row of rows) {
      const className = clean(row.class_name);
      const role = normalizeRole(row.role);
      const photo = clean(row.photo_url);

      // Track first school photo for school cover
      if (!firstSchoolPhoto && photo) {
        firstSchoolPhoto = photo;
      }

      if (isStudentLike(role, className)) {
        totalStudents += 1;
        if (className) {
          classCounts[className] = (classCounts[className] ?? 0) + 1;
          // Use first photo found in this class as cover
          if (!classCovers[className] && photo) {
            classCovers[className] = photo;
          }
        }
      } else {
        roleCountsMap[role] = (roleCountsMap[role] ?? 0) + 1;
        if (!roleCovers[role] && photo) {
          roleCovers[role] = photo;
        }
      }
    }

    const classMap = new Map<string, GalleryCard>();

    Object.keys(classCounts).forEach((className) => {
      const slug = slugify(className);
      classMap.set(slug, {
        key: `class:${className}`,
        label: className,
        rawLabel: className,
        count: classCounts[className],
        href: `/dashboard/projects/schools/${schoolId}/classes/${encodeURIComponent(className)}`,
        kind: "class" as const,
        coverPhoto: classCovers[className],
      });
    });

    Object.entries(classCollectionsBySlug).forEach(([slug, row]) => {
      const existing = classMap.get(slug);
      const rawLabel = existing?.rawLabel || clean(row.title) || clean(row.slug) || "Class";
      const label = clean(row.title) || existing?.label || rawLabel;
      classMap.set(slug, {
        key: `class:${rawLabel}`,
        label,
        rawLabel,
        count: existing?.count ?? 0,
        href: `/dashboard/projects/schools/${schoolId}/classes/${encodeURIComponent(rawLabel)}`,
        kind: "class",
        coverPhoto: clean(row.cover_photo_url) || existing?.coverPhoto || classCovers[rawLabel],
      });
    });

    const classCards = Array.from(classMap.values()).sort((a, b) =>
      clean(a.label).localeCompare(clean(b.label), undefined, { numeric: true, sensitivity: "base" })
    );

    const roleKeys = [
      ...ROLE_ORDER.filter((role) => roleCountsMap[role] > 0),
      ...Object.keys(roleCountsMap)
        .filter((role) => !ROLE_ORDER.includes(role as (typeof ROLE_ORDER)[number]))
        .sort((a, b) => a.localeCompare(b)),
    ];

    const roleMap = new Map<string, GalleryCard>();

    roleKeys.forEach((role) => {
      const slug = slugify(role);
      roleMap.set(slug, {
        key: `role:${role}`,
        label: role,
        rawLabel: role,
        count: roleCountsMap[role],
        href: `/dashboard/projects/schools/${schoolId}/roles/${encodeURIComponent(role)}`,
        kind: "role",
        coverPhoto: roleCovers[role],
      });
    });

    Object.entries(roleCollectionsBySlug).forEach(([slug, row]) => {
      const existing = roleMap.get(slug);
      const rawLabel = existing?.rawLabel || clean(row.title) || clean(row.slug) || "Role";
      const label = clean(row.title) || existing?.label || rawLabel;
      roleMap.set(slug, {
        key: `role:${rawLabel}`,
        label,
        rawLabel,
        count: existing?.count ?? 0,
        href: `/dashboard/projects/schools/${schoolId}/roles/${encodeURIComponent(rawLabel)}`,
        kind: "role",
        coverPhoto: clean(row.cover_photo_url) || existing?.coverPhoto || roleCovers[rawLabel],
      });
    });

    const roleCards = Array.from(roleMap.values()).sort((a, b) =>
      clean(a.label).localeCompare(clean(b.label), undefined, { numeric: true, sensitivity: "base" })
    );

    return {
      classCards,
      roleCards,
      totalPeople: rows.length,
      totalStudents,
      totalClasses: classCards.length,
      totalRoles: roleCards.length,
      schoolCover: schoolProjectCoverUrl || firstSchoolPhoto,
      totalSyncedPhotos: rows.filter((row) => clean(row.photo_url)).length,
    };
  }, [classCollectionsBySlug, roleCollectionsBySlug, rows, schoolId, schoolProjectCoverUrl]);

  async function createGallery(kind: "class" | "role") {
    const title = clean(createGalleryName);
    if (!title) return;

    const existingCards = kind === "class" ? grouped.classCards : grouped.roleCards;
    if (
      existingCards.some(
        (item) =>
          clean(item.label).toLowerCase() === title.toLowerCase() ||
          clean(item.rawLabel).toLowerCase() === title.toLowerCase() ||
          slugify(item.rawLabel) === slugify(title)
      )
    ) {
      setError(kind === "class" ? "A class with that name already exists." : "A role gallery with that name already exists.");
      return;
    }

    setCreatingGallery(true);

    try {
      setError("");
      const syncProjectId = await ensureSyncedProjectId(supabase, schoolId, school);
      if (!syncProjectId) {
        throw new Error("No synced school project found.");
      }

      const { data: sortRows, error: sortError } = await supabase
        .from("collections")
        .select("sort_order")
        .eq("project_id", syncProjectId);

      if (sortError) throw sortError;

      const nextSortOrder =
        (sortRows ?? []).length > 0
          ? Math.max(
              ...(sortRows ?? []).map((row) =>
                Number((row as { sort_order?: number | null }).sort_order ?? 0)
              )
            ) + 1
          : 0;

      const { data, error: insertError } = await supabase
        .from("collections")
        .insert({
          project_id: syncProjectId,
          kind: kind === "class" ? "class" : "gallery",
          title,
          slug: slugify(title),
          sort_order: nextSortOrder,
          visibility: "public",
        })
        .select("id,title,slug,kind,cover_photo_url,sort_order")
        .single();

      if (insertError) throw insertError;

      if (kind === "class") {
        setClassCollectionsBySlug((prev) => ({
          ...prev,
          [clean((data as ClassCollectionRow).slug) || slugify(title)]: data as ClassCollectionRow,
        }));
      } else {
        setRoleCollectionsBySlug((prev) => ({
          ...prev,
          [clean((data as ClassCollectionRow).slug) || slugify(title)]: data as ClassCollectionRow,
        }));
      }

      setCreateGalleryKind(null);
      setCreateGalleryName("");
      setShareNotice(kind === "class" ? "Class added" : "Role gallery added");
      window.setTimeout(() => setShareNotice(""), 2200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `Failed to add ${kind === "class" ? "class" : "role gallery"}.`);
    } finally {
      setCreatingGallery(false);
    }
  }

  async function copySchoolLink() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setShareNotice("School link copied");
      window.setTimeout(() => setShareNotice(""), 2200);
    } catch {
      setShareNotice("Could not copy link");
      window.setTimeout(() => setShareNotice(""), 2200);
    }
  }

  async function openSchoolCoverPicker() {
    setError("");
    setOpenSchoolMenu(false);
    setSchoolCoverPickerOpen(true);
    setSchoolCoverPickerLoading(true);
    setSchoolCoverOptions([]);
    setSelectedSchoolCoverUrl(null);

    try {
      const schoolRows = rows.filter((row) => clean(row.photo_url));
      const optionMap = new Map<string, CoverOption>();
      const options = await buildCoverOptions(schoolRows);
      options.forEach((option) => optionMap.set(option.url, option));

      const existingCover = clean(schoolProjectCoverUrl);
      if (existingCover && !optionMap.has(existingCover)) {
        optionMap.set(existingCover, {
          id: "school-current-cover",
          url: existingCover,
          label: labelFromCoverUrl(existingCover, "Current cover"),
        });
      }

      const nextOptions = Array.from(optionMap.values());
      setSchoolCoverOptions(nextOptions);
      setSelectedSchoolCoverUrl(existingCover || nextOptions[0]?.url || null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load school cover photos.");
    } finally {
      setSchoolCoverPickerLoading(false);
    }
  }

  async function saveSchoolCover() {
    if (!selectedSchoolCoverUrl) return;

    setSchoolCoverPickerSaving(true);

    try {
      setError("");
      const syncProjectId = await ensureSyncedProjectId(supabase, schoolId, school);
      if (!syncProjectId) {
        throw new Error("No synced school project found for school cover selection.");
      }

      const { error: updateError } = await supabase
        .from("projects")
        .update({ cover_photo_url: selectedSchoolCoverUrl })
        .eq("id", syncProjectId);

      if (updateError) throw updateError;

      setSchoolProjectCoverUrl(selectedSchoolCoverUrl);
      setSchoolCoverPickerOpen(false);
      setShareNotice("School cover updated");
      window.setTimeout(() => setShareNotice(""), 2200);
    } catch (err: unknown) {
      setError(errorMessage(err, "Failed to save school cover."));
    } finally {
      setSchoolCoverPickerSaving(false);
    }
  }

  function openSchoolCoverUpload() {
    setOpenSchoolMenu(false);
    setError("");
    schoolCoverInputRef.current?.click();
  }

  async function uploadSchoolCover(event: ChangeEvent<HTMLInputElement>) {
    const file = Array.from(event.target.files ?? []).find(
      (nextFile) => nextFile.type.startsWith("image/") || /\.(png|jpg|jpeg|webp)$/i.test(nextFile.name)
    );
    event.target.value = "";

    if (!file) return;

    setSchoolCoverUploading(true);

    try {
      setError("");
      const syncProjectId = await ensureSyncedProjectId(supabase, schoolId, school);
      if (!syncProjectId) {
        throw new Error("No synced school project found for school cover upload.");
      }

      const basePath = safeStorageSegment(clean(school?.local_school_id) || schoolId, schoolId);
      const ext = clean(file.name.split(".").pop()).toLowerCase() || "jpg";
      const storagePath = `${basePath}/__school_cover__/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const { error: uploadError } = await supabase.storage.from("thumbs").upload(storagePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || undefined,
      });

      if (uploadError) {
        throw new Error(uploadError.message || "School cover upload failed.");
      }

      const publicUrl = supabase.storage.from("thumbs").getPublicUrl(storagePath).data.publicUrl;
      if (!clean(publicUrl)) {
        throw new Error("School cover uploaded, but no public URL was returned.");
      }

      const { error: updateError } = await supabase
        .from("projects")
        .update({ cover_photo_url: publicUrl })
        .eq("id", syncProjectId);

      if (updateError) throw updateError;

      setSchoolProjectCoverUrl(publicUrl);
      setShareNotice("School cover uploaded");
      window.setTimeout(() => setShareNotice(""), 2200);
    } catch (err: unknown) {
      setError(errorMessage(err, "Failed to upload school cover."));
    } finally {
      setSchoolCoverUploading(false);
    }
  }

  async function openClassCoverPicker(className: string, classLabel: string) {
    setError("");
    setOpenClassMenuId(null);
    setCoverPickerClassName(className);
    setCoverPickerClassLabel(classLabel);
    setClassCoverPickerOpen(true);
    setClassCoverPickerLoading(true);
    setClassCoverOptions([]);
    setSelectedClassCoverUrl(null);

    try {
      const classRows = rows.filter(
        (row) => clean(row.class_name) === clean(className) && clean(row.photo_url)
      );
      const options = await buildCoverOptions(classRows);
      const existingCover = clean(classCollectionsBySlug[slugify(className)]?.cover_photo_url);
      setClassCoverOptions(options);
      setSelectedClassCoverUrl(existingCover || options[0]?.url || null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load class cover photos.");
    } finally {
      setClassCoverPickerLoading(false);
    }
  }

  async function saveClassCover() {
    if (!coverPickerClassName || !selectedClassCoverUrl) return;

    setClassCoverPickerSaving(true);

    try {
      setError("");
      const syncTarget = await ensureSchoolCollectionId(supabase, {
        schoolId,
        school,
        kind: "class",
        title: coverPickerClassLabel || coverPickerClassName,
        slugFallback: "class",
      });

      if (!syncTarget.collectionId) {
        throw new Error("No synced school project found for class cover selection.");
      }

      const { data, error: updateError } = await supabase
        .from("collections")
        .update({
          cover_photo_url: selectedClassCoverUrl,
        })
        .eq("id", syncTarget.collectionId)
        .select("id,title,slug,kind,cover_photo_url,sort_order")
        .single();

      if (updateError) throw updateError;
      const nextCollection = data as ClassCollectionRow;

      if (nextCollection) {
        const classSlug = clean(nextCollection.slug) || slugify(coverPickerClassName);
        setClassCollectionsBySlug((prev) => ({
          ...prev,
          [classSlug]: nextCollection!,
        }));
      }

      setError("");
      setClassCoverPickerOpen(false);
      setShareNotice("Class cover updated");
      window.setTimeout(() => setShareNotice(""), 2200);
    } catch (err: unknown) {
      setError(errorMessage(err, "Failed to save class cover."));
    } finally {
      setClassCoverPickerSaving(false);
    }
  }

  async function openRoleCoverPicker(roleName: string) {
    setError("");
    setOpenRoleMenuId(null);
    setCoverPickerRoleName(roleName);
    setRoleCoverPickerOpen(true);
    setRoleCoverPickerLoading(true);
    setRoleCoverOptions([]);
    setSelectedRoleCoverUrl(null);

    try {
      const roleRows = rows.filter((row) => {
        const className = clean(row.class_name);
        const role = normalizeRole(row.role);
        return !className && role === roleName && clean(row.photo_url);
      });
      const options = await buildCoverOptions(roleRows);
      const existingCover = clean(roleCollectionsBySlug[slugify(roleName)]?.cover_photo_url);
      setRoleCoverOptions(options);
      setSelectedRoleCoverUrl(existingCover || options[0]?.url || null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load role cover photos.");
    } finally {
      setRoleCoverPickerLoading(false);
    }
  }

  async function saveRoleCover() {
    if (!coverPickerRoleName || !selectedRoleCoverUrl) return;

    setRoleCoverPickerSaving(true);

    try {
      setError("");
      const syncTarget = await ensureSchoolCollectionId(supabase, {
        schoolId,
        school,
        kind: "gallery",
        title: coverPickerRoleName,
        slugFallback: "gallery",
      });

      if (!syncTarget.collectionId) {
        throw new Error("No synced school project found for role cover selection.");
      }

      const { data, error: updateError } = await supabase
        .from("collections")
        .update({
          cover_photo_url: selectedRoleCoverUrl,
        })
        .eq("id", syncTarget.collectionId)
        .select("id,title,slug,kind,cover_photo_url,sort_order")
        .single();

      if (updateError) throw updateError;
      const nextCollection = data as ClassCollectionRow;

      if (nextCollection) {
        const roleSlug = clean(nextCollection.slug) || slugify(coverPickerRoleName);
        setRoleCollectionsBySlug((prev) => ({
          ...prev,
          [roleSlug]: nextCollection!,
        }));
      }

      setError("");
      setRoleCoverPickerOpen(false);
      setShareNotice("Role cover updated");
      window.setTimeout(() => setShareNotice(""), 2200);
    } catch (err: unknown) {
      setError(errorMessage(err, "Failed to save role cover."));
    } finally {
      setRoleCoverPickerSaving(false);
    }
  }

  async function deleteClasses(classCardsToDelete: Array<Pick<GalleryCard, "rawLabel" | "label" | "key">>) {
    if (classCardsToDelete.length === 0) return;

    const classNames = classCardsToDelete.map((item) => item.rawLabel);
    const classLabels = classCardsToDelete.map((item) => item.label);
    const confirmed =
      typeof window !== "undefined"
        ? window.confirm(
            classCardsToDelete.length === 1
              ? `Delete class "${classLabels[0]}"? This will remove the class, all students in it, and its synced class settings.`
              : `Delete ${classCardsToDelete.length} classes? This will remove the selected classes, all students in them, and their synced class settings.`
          )
        : false;

    if (!confirmed) return;

    try {
      const { error: deleteStudentsError } = await supabase
        .from("students")
        .delete()
        .eq("school_id", schoolId)
        .in("class_name", classNames);

      if (deleteStudentsError) throw deleteStudentsError;

      const syncProjectId = await findSyncedProjectId(supabase, schoolId, {
        localSchoolId: school?.local_school_id,
      });
      const classCollectionIds = classNames
        .map((className) => classCollectionsBySlug[slugify(className)]?.id ?? null)
        .filter((id): id is string => !!id);

      if (syncProjectId && classCollectionIds.length > 0) {
        const { error: deleteCollectionError } = await supabase
          .from("collections")
          .delete()
          .in("id", classCollectionIds)
          .eq("project_id", syncProjectId);

        if (deleteCollectionError) throw deleteCollectionError;
      }

      const classNameSet = new Set(classNames.map((value) => clean(value)));
      const selectedKeySet = new Set(classCardsToDelete.map((item) => item.key));

      setRows((prev) => prev.filter((row) => !classNameSet.has(clean(row.class_name))));
      setClassCollectionsBySlug((prev) => {
        const next = { ...prev };
        classNames.forEach((className) => {
          delete next[slugify(className)];
        });
        return next;
      });
      setSelectedClassIds((prev) => prev.filter((id) => !selectedKeySet.has(id)));
      setOpenClassMenuId(null);
      setShareNotice(classCardsToDelete.length === 1 ? "Class deleted" : `${classCardsToDelete.length} classes deleted`);
      window.setTimeout(() => setShareNotice(""), 2200);
      setError("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete selected classes.");
    }
  }

  async function deleteClass(className: string, classLabel: string) {
    await deleteClasses([
      {
        key: `class:${className}`,
        rawLabel: className,
        label: classLabel,
      },
    ]);
  }

  async function deleteSelectedClasses() {
    const selectedCards = orderedClasses.filter((item) => selectedClassIds.includes(item.key));
    await deleteClasses(selectedCards);
  }

  async function deleteRoles(roleCardsToDelete: Array<Pick<GalleryCard, "rawLabel" | "label" | "key">>) {
    if (roleCardsToDelete.length === 0) return;

    const roleNames = roleCardsToDelete.map((item) => item.rawLabel);
    const roleLabels = roleCardsToDelete.map((item) => item.label);
    const confirmed =
      typeof window !== "undefined"
        ? window.confirm(
            roleCardsToDelete.length === 1
              ? `Delete role gallery "${roleLabels[0]}"? This will remove the people in it and its synced role gallery settings.`
              : `Delete ${roleCardsToDelete.length} role galleries? This will remove the selected people and their synced role gallery settings.`
          )
        : false;

    if (!confirmed) return;

    try {
      const roleNameSet = new Set(roleNames.map((value) => clean(value)));
      const peopleIds = rows
        .filter((row) => !clean(row.class_name) && roleNameSet.has(normalizeRole(row.role)))
        .map((row) => row.id);

      if (peopleIds.length > 0) {
        const { error: deletePeopleError } = await supabase
          .from("students")
          .delete()
          .in("id", peopleIds);

        if (deletePeopleError) throw deletePeopleError;
      }

      const syncProjectId = await findSyncedProjectId(supabase, schoolId, {
        localSchoolId: school?.local_school_id,
      });
      const roleCollectionIds = roleNames
        .map((roleName) => roleCollectionsBySlug[slugify(roleName)]?.id ?? null)
        .filter((id): id is string => !!id);

      if (syncProjectId && roleCollectionIds.length > 0) {
        const { error: deleteCollectionError } = await supabase
          .from("collections")
          .delete()
          .in("id", roleCollectionIds)
          .eq("project_id", syncProjectId);

        if (deleteCollectionError) throw deleteCollectionError;
      }

      const selectedKeySet = new Set(roleCardsToDelete.map((item) => item.key));

      setRows((prev) =>
        prev.filter((row) => clean(row.class_name) || !roleNameSet.has(normalizeRole(row.role)))
      );
      setRoleCollectionsBySlug((prev) => {
        const next = { ...prev };
        roleNames.forEach((roleName) => {
          delete next[slugify(roleName)];
        });
        return next;
      });
      setSelectedRoleIds((prev) => prev.filter((id) => !selectedKeySet.has(id)));
      setOpenRoleMenuId(null);
      setShareNotice(roleCardsToDelete.length === 1 ? "Role gallery deleted" : `${roleCardsToDelete.length} role galleries deleted`);
      window.setTimeout(() => setShareNotice(""), 2200);
      setError("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete selected role galleries.");
    }
  }

  async function deleteRole(roleName: string, roleLabel: string) {
    await deleteRoles([
      {
        key: `role:${roleName}`,
        rawLabel: roleName,
        label: roleLabel,
      },
    ]);
  }

  async function deleteSelectedRoles() {
    const selectedCards = orderedRoles.filter((item) => selectedRoleIds.includes(item.key));
    await deleteRoles(selectedCards);
  }

  const schoolDate = school?.shoot_date || null;
  const schoolStatus = clean(school?.portal_status) || clean(school?.status) || "Active";
  const schoolLocked =
    hasPinProtection(school?.access_mode, school?.access_pin) ||
    Boolean(school?.password_protected) ||
    clean(school?.access).toLowerCase() === "private";

  const orderedClasses = useMemo(() => grouped.classCards, [grouped.classCards]);
  const orderedRoles = useMemo(() => grouped.roleCards, [grouped.roleCards]);

  const filteredClasses = useMemo(() => {
    const q = clean(classSearch).toLowerCase();
    if (!q) return orderedClasses;
    return orderedClasses.filter((row) => {
      const label = clean(row.label).toLowerCase();
      return label.includes(q);
    });
  }, [classSearch, orderedClasses]);

  const classSearchCountLabel = `${filteredClasses.length} of ${orderedClasses.length}`;

  return (
    <div style={{ minHeight: "100vh", background: "#faf7f7", padding: 24 }}>
      <div style={{ maxWidth: 1560, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
          <div>
            <Link href="/dashboard/schools" style={{ color: "#111111", textDecoration: "none", fontSize: 14, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ArrowLeft size={16} /> Back to Schools
            </Link>
            <div style={{ marginTop: 8, color: "#b91c1c", fontWeight: 800 }}>School Gallery</div>
            <h1 style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 900, color: "#111111", display: "inline-flex", alignItems: "center", gap: 8 }}>
              {school?.school_name || "School"}
              {schoolLocked ? <Lock size={16} style={{ color: "#b91c1c" }} /> : null}
            </h1>
            <div style={{ color: "#b91c1c", fontWeight: 800, marginTop: 2 }}>{schoolStatus}</div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button onClick={() => { setError(""); setCreateGalleryKind("class"); setCreateGalleryName(""); }} style={{ borderRadius: 10, border: "1px solid #111111", background: "#fff", color: "#111111", padding: "12px 16px", fontWeight: 800, cursor: "pointer" }}>Add Class</button>
            <button onClick={() => { setError(""); setCreateGalleryKind("role"); setCreateGalleryName(""); }} style={{ borderRadius: 10, border: "1px solid #111111", background: "#fff", color: "#111111", padding: "12px 16px", fontWeight: 800, cursor: "pointer" }}>Add Role Gallery</button>
            <button onClick={() => setShareModalOpen(true)} style={{ borderRadius: 10, border: "1px solid #111111", background: "#111111", color: "#fff", padding: "12px 16px", fontWeight: 800, cursor: "pointer" }}>Share Gallery</button>
            <a
              href={`/dashboard/projects/schools/${schoolId}/settings`}
              onClick={(event) => {
                event.preventDefault();
                openSchoolSettingsPage();
              }}
              style={{ borderRadius: 10, border: "1px solid #111111", background: "#fff", color: "#111111", padding: "12px 16px", fontWeight: 800, cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", position: "relative", zIndex: 6 }}
            >
              School Settings
            </a>
          </div>
        </div>

        {shareNotice ? <div style={{ marginBottom: 14, color: "#b91c1c", fontWeight: 700 }}>{shareNotice}</div> : null}

        {error && (
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
        )}

        {loading && <p style={{ color: "#999", fontSize: 13 }}>Loading…</p>}

        {!loading && school && (
          <div style={{ display: "grid", gridTemplateColumns: "320px minmax(0,1fr)", gap: 18, alignItems: "start" }}>
            <aside style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 20, padding: 16, position: "sticky", top: 24, zIndex: 6 }}>
              <button
                type="button"
                onClick={() => void openSchoolCoverPicker()}
                style={{
                  width: "100%",
                  padding: 0,
                  border: 0,
                  borderRadius: 16,
                  overflow: "hidden",
                  background: grouped.schoolCover ? `url(${grouped.schoolCover}) ${Math.round(focalX * 100)}% ${Math.round(focalY * 100)}%/cover no-repeat` : "linear-gradient(135deg,#111111,#b91c1c)",
                  aspectRatio: "1.35 / 1",
                  boxSizing: "border-box",
                  cursor: "pointer",
                  outline: "none",
                  boxShadow: grouped.schoolCover ? "inset 0 0 0 1px #e5e7eb" : "inset 0 0 0 1px #e5e7eb",
                }}
                aria-label="Choose school cover photo"
                title="Choose school cover photo"
              />
              {grouped.schoolCover && (
                <button
                  type="button"
                  onClick={() => setFocalEditorOpen(true)}
                  style={{ width: "100%", marginTop: 8, padding: "10px 14px", background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 10, fontSize: 13, fontWeight: 700, color: "#111", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></svg>
                  Edit Cover Photo
                </button>
              )}
              <div style={{ color: "#4b5563", fontSize: 14, marginTop: 10 }}>Shoot Date: {formatDisplayDate(schoolDate)}</div>
              <div style={{ color: "#6b7280", fontSize: 12, marginTop: 4 }}>Click the cover to change it, or use the menu to upload one.</div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                <a
                  href={`/dashboard/projects/schools/${schoolId}/settings`}
                  onClick={(event) => {
                    event.preventDefault();
                    openSchoolSettingsPage();
                  }}
                  style={{ flex: 1, borderRadius: 10, border: "1px solid #111111", background: "#fff", color: "#b91c1c", padding: "12px 14px", fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box", textDecoration: "none", position: "relative", zIndex: 7 }}
                >
                  School Settings
                </a>
                <a
                  href={`/dashboard/projects/schools/${schoolId}/visitors`}
                  style={{ flex: 1, borderRadius: 10, border: "1px solid #111111", background: "#111", color: "#fff", padding: "12px 14px", fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box", textDecoration: "none", position: "relative", zIndex: 7, gap: 6 }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  Visitors
                </a>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => setOpenSchoolMenu((prev) => !prev)}
                    disabled={schoolCoverUploading}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      border: "1px solid #111111",
                      background: openSchoolMenu ? "#fff5f5" : "#fff",
                      color: "#111111",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: schoolCoverUploading ? "not-allowed" : "pointer",
                      opacity: schoolCoverUploading ? 0.7 : 1,
                    }}
                    aria-label="School cover actions"
                  >
                    <Menu size={18} />
                  </button>
                  {openSchoolMenu ? (
                    <div
                      style={{
                        position: "absolute",
                        right: 0,
                        top: "calc(100% + 8px)",
                        minWidth: 210,
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
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void openSchoolCoverPicker();
                        }}
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
                        Choose Cover Photo
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openSchoolCoverUpload();
                        }}
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
                        {schoolCoverUploading ? "Uploading..." : "Upload Cover Photo"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#111111", marginBottom: 8 }}>Contact</div>
                <button onClick={openContactModal} style={{ width: "100%", borderRadius: 10, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "12px 14px", fontWeight: 700, textAlign: "left", cursor: "pointer", position: "relative", zIndex: 7 }}>
                  + Add Contact
                </button>
                {contacts.length ? (
                  <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                    {contacts.map((contact) => (
                      <div key={contact.id} style={{ borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", padding: "10px 12px" }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: "#111111" }}>{contact.name}</div>
                        {contact.email ? <div style={{ marginTop: 4, fontSize: 12, color: "#4b5563" }}>{contact.email}</div> : null}
                        {contact.phone ? <div style={{ marginTop: 2, fontSize: 12, color: "#4b5563" }}>{contact.phone}</div> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div style={{ marginTop: 18, border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "12px 14px", borderBottom: "1px solid #e5e7eb", background: "#fff5f5" }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#111111" }}>School Activity</div>
                  <div style={{ fontSize: 12, color: "#4b5563", marginTop: 4 }}>Last Sync View: {new Date().toLocaleDateString("en-US", { month: "2-digit", year: "numeric" })}</div>
                </div>
                {[
                  ["Classes", grouped.totalClasses],
                  ["Role Galleries", grouped.totalRoles],
                  ["Synced Photos", grouped.totalSyncedPhotos],
                ].map(([label, value]) => (
                  <div key={String(label)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderTop: "1px solid #eef2f7", color: "#111111", fontSize: 13 }}>
                    <span>{label}</span>
                    <span style={{ fontWeight: 800 }}>{String(value)}</span>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#111111", marginBottom: 8 }}>Classes</div>
                <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid #e5e7eb" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", background: "#fff5f5", borderBottom: "1px solid #eef2f7", color: "#111111", fontWeight: 800, fontSize: 13 }}>
                    <span>All Classes</span>
                    <span>{grouped.classCards.length}</span>
                  </div>
                  <div style={{ maxHeight: 360, overflow: "auto" }}>
                    {grouped.classCards.map((classCard) => {
                      const active = selectedClassIds.includes(classCard.key);
                      return (
                        <Link key={classCard.key} href={classCard.href} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 12px", borderTop: "1px solid #eef2f7", background: active ? "#fff1f2" : "#fff", textDecoration: "none", color: "#111111", fontSize: 13, fontWeight: 700 }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: "100%" }}>
                            <span style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{clean(classCard.label) || "Class"}</span>
                          </span>
                          <span style={{ color: active ? "#b91c1c" : "#111111" }}>{classCard.count}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            </aside>

            <main style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 20, padding: 16 }}>
              {/* Toolbar */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#111111", fontWeight: 700, flexWrap: "wrap", flex: "1 1 360px" }}>
                  <button onClick={() => setSelectedClassIds((prev) => (prev.length === filteredClasses.length ? [] : filteredClasses.map((item) => item.key)))} style={{ borderRadius: 10, border: "1px solid #111111", background: "#fff", color: "#111111", padding: "9px 12px", fontWeight: 700, cursor: "pointer" }}>{selectedClassIds.length === filteredClasses.length && filteredClasses.length ? "Clear Selection" : "Select"}</button>
                  <button
                    onClick={() => void deleteSelectedClasses()}
                    disabled={selectedClassIds.length === 0}
                    style={{
                      borderRadius: 10,
                      border: "1px solid #ef4444",
                      background: selectedClassIds.length === 0 ? "#fff" : "#fff5f5",
                      color: selectedClassIds.length === 0 ? "#9ca3af" : "#b91c1c",
                      padding: "9px 12px",
                      fontWeight: 700,
                      cursor: selectedClassIds.length === 0 ? "not-allowed" : "pointer",
                    }}
                  >
                    Delete Selected
                  </button>
                  <div style={{ flex: "1 1 280px", minWidth: 220, maxWidth: 420, position: "relative" }}>
                    <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#6b7280", pointerEvents: "none" }} />
                    <input
                      value={classSearch}
                      onChange={(e) => setClassSearch(e.target.value)}
                      placeholder="Search classes..."
                      style={{ width: "100%", boxSizing: "border-box", borderRadius: 10, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "10px 12px 10px 38px", fontWeight: 600, outline: "none" }}
                    />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
                  {classSearch ? <div style={{ color: "#b91c1c", fontSize: 13, fontWeight: 700, minWidth: 72, textAlign: "right" }}>{classSearchCountLabel}</div> : null}
                  <button style={{ borderRadius: 10, border: "1px solid #111111", background: "#fff", color: "#111111", padding: "9px 12px", fontWeight: 700, cursor: "pointer" }}>Sort by: Name A-Z</button>
                </div>
              </div>

              {/* Stats line */}
              <div style={{ color: "#111111", marginBottom: 16, fontWeight: 700 }}>
                {grouped.classCards.length} classes • {grouped.totalRoles} roles • {grouped.totalPeople} people
              </div>

              {filteredClasses.length === 0 ? (
                <div style={{ border: "1px dashed #d0d5dd", borderRadius: 18, padding: 24, color: "#4b5563" }}>{classSearch ? "No classes found." : "No classes yet."}</div>
              ) : (
                <>
                  {/* Classes grid */}
                  {filteredClasses.length > 0 && (
                    <div style={{ marginBottom: 24 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 16 }}>
                        {filteredClasses.map((classCard) => {
                          const classHref = classCard.href;
                          const classSettingsHref = `/dashboard/projects/schools/${schoolId}/classes/${encodeURIComponent(classCard.rawLabel)}/settings`;
                          const cover = classCard.coverPhoto;
                          const studentCount = classCard.count;
                          const active =
                            selectedClassIds.includes(classCard.key) ||
                            hoveredClassId === classCard.key ||
                            openClassMenuId === classCard.key;
                          return (
                            <div
                              key={classCard.key}
                              onMouseEnter={() => setHoveredClassId(classCard.key)}
                              onMouseLeave={() => setHoveredClassId((prev) => (prev === classCard.key ? null : prev))}
                              style={{ position: "relative" }}
                            >
                              <Link href={classHref} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
                                <div style={{ position: "relative", height: 200, marginBottom: 10 }}>
                                  <div style={{ position: "absolute", inset: "10px 10px 0 10px", borderRadius: 4, background: cover ? `url(${cover}) center/cover no-repeat` : "linear-gradient(135deg,#e5e7eb,#cbd5e1)", transform: "rotate(-3deg)", boxShadow: "0 8px 20px rgba(15,23,42,0.10)" }} />
                                  <div style={{ position: "absolute", inset: "4px 6px 6px 6px", borderRadius: 4, background: cover ? `url(${cover}) center/cover no-repeat` : "linear-gradient(135deg,#e5e7eb,#dbe4f0)", transform: "rotate(2deg)", boxShadow: "0 8px 20px rgba(15,23,42,0.10)" }} />
                                  <div style={{ position: "absolute", inset: 0, borderRadius: 4, background: cover ? `url(${cover}) center/cover no-repeat` : "linear-gradient(135deg,#111111,#b91c1c)", border: active ? "2px solid #b91c1c" : "1px solid #d0d5dd", boxShadow: "0 10px 25px rgba(15,23,42,0.14)" }} />
                                </div>
                              </Link>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
                                <div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <button style={{ border: 0, background: "transparent", padding: 0, color: "#111111", fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0.3, cursor: "text", textAlign: "left" }}>
                                      {clean(classCard.label) || "Class"}
                                    </button>
                                  </div>
                                  <div style={{ color: "#4b5563", fontSize: 12, marginTop: 3 }}>{studentCount} Student{studentCount !== 1 ? "s" : ""}</div>
                                </div>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                                <Link
                                  href={classHref}
                                  style={{
                                    borderRadius: 10,
                                    border: "1px solid #111111",
                                    background: "#fff",
                                    color: "#111111",
                                    padding: "8px 10px",
                                    fontWeight: 700,
                                    textDecoration: "none",
                                  }}
                                >
                                  Open Class
                                </Link>
                                <div style={{ position: "relative" }}>
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setOpenClassMenuId((prev) => (prev === classCard.key ? null : classCard.key));
                                    }}
                                    style={{
                                      width: 40,
                                      height: 40,
                                      borderRadius: 10,
                                      border: "1px solid #111111",
                                      background: openClassMenuId === classCard.key ? "#fff5f5" : "#fff",
                                      color: "#111111",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      cursor: "pointer",
                                    }}
                                    aria-label="Class actions"
                                  >
                                    <Menu size={18} />
                                  </button>
                                  {openClassMenuId === classCard.key ? (
                                    <div
                                      style={{
                                        position: "absolute",
                                        right: 0,
                                        top: "calc(100% + 8px)",
                                        minWidth: 190,
                                        background: "#fff",
                                        border: "1px solid #e5e7eb",
                                        borderRadius: 14,
                                        boxShadow: "0 18px 36px rgba(17,17,17,0.12)",
                                        overflow: "hidden",
                                        zIndex: 20,
                                      }}
                                    >
                                      <Link
                                        href={classSettingsHref}
                                        onClick={() => setOpenClassMenuId(null)}
                                        style={{
                                          display: "block",
                                          padding: "12px 14px",
                                          color: "#111111",
                                          textDecoration: "none",
                                          fontWeight: 700,
                                          borderBottom: "1px solid #f1f5f9",
                                        }}
                                      >
                                        Rename / Settings
                                      </Link>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          void openClassCoverPicker(classCard.rawLabel, classCard.label);
                                        }}
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
                                        Choose Cover Photo
                                      </button>
                                      <Link
                                        href={classHref}
                                        onClick={() => setOpenClassMenuId(null)}
                                        style={{
                                          display: "block",
                                          padding: "12px 14px",
                                          color: "#b91c1c",
                                          textDecoration: "none",
                                          fontWeight: 700,
                                        }}
                                      >
                                        Open Class
                                      </Link>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          void deleteClass(classCard.rawLabel, classCard.label);
                                        }}
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
                                        Delete Class
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                                <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSelectedClassIds(prev => prev.includes(classCard.key) ? prev.filter(id => id !== classCard.key) : [...prev, classCard.key]); }} style={{ borderRadius: 10, border: selectedClassIds.includes(classCard.key) ? "1px solid #111111" : "1px solid #d0d5dd", background: selectedClassIds.includes(classCard.key) ? "#111111" : "#fff", color: selectedClassIds.includes(classCard.key) ? "#fff" : "#111111", padding: "8px 10px", fontWeight: 700, cursor: "pointer" }}>{selectedClassIds.includes(classCard.key) ? "Selected" : "Select"}</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Role Galleries section */}
                  {grouped.roleCards.length > 0 && (
                    <div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", margin: "24px 0 16px 0" }}>
                        <h2 style={{ fontSize: 15, fontWeight: 800, color: "#b91c1c", margin: 0 }}>Role Galleries</h2>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <button
                            onClick={() => setSelectedRoleIds((prev) => (prev.length === orderedRoles.length ? [] : orderedRoles.map((item) => item.key)))}
                            style={{ borderRadius: 10, border: "1px solid #111111", background: "#fff", color: "#111111", padding: "8px 10px", fontWeight: 700, cursor: "pointer" }}
                          >
                            {selectedRoleIds.length === orderedRoles.length && orderedRoles.length ? "Clear Selection" : "Select"}
                          </button>
                          <button
                            onClick={() => void deleteSelectedRoles()}
                            disabled={selectedRoleIds.length === 0}
                            style={{
                              borderRadius: 10,
                              border: "1px solid #ef4444",
                              background: selectedRoleIds.length === 0 ? "#fff" : "#fff5f5",
                              color: selectedRoleIds.length === 0 ? "#9ca3af" : "#b91c1c",
                              padding: "8px 10px",
                              fontWeight: 700,
                              cursor: selectedRoleIds.length === 0 ? "not-allowed" : "pointer",
                            }}
                          >
                            Delete Selected
                          </button>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 16 }}>
                        {grouped.roleCards.map((roleCard) => {
                          const roleHref = roleCard.href;
                          const personCount = roleCard.count;
                          const roleCover = roleCard.coverPhoto;
                          const active =
                            selectedRoleIds.includes(roleCard.key) ||
                            hoveredRoleId === roleCard.key ||
                            openRoleMenuId === roleCard.key;
                          return (
                            <div
                              key={roleCard.key}
                              onMouseEnter={() => setHoveredRoleId(roleCard.key)}
                              onMouseLeave={() => setHoveredRoleId((prev) => (prev === roleCard.key ? null : prev))}
                              style={{ position: "relative" }}
                            >
                              <Link href={roleHref} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
                                <div style={{ position: "relative", height: 200, marginBottom: 10 }}>
                                  <div style={{ position: "absolute", inset: "10px 10px 0 10px", borderRadius: 4, background: roleCover ? `url(${roleCover}) center/cover no-repeat` : "linear-gradient(135deg,#e5e7eb,#cbd5e1)", transform: "rotate(-3deg)", boxShadow: "0 8px 20px rgba(15,23,42,0.10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    {roleCover ? null : getRoleIcon(roleCard.label)}
                                  </div>
                                  <div style={{ position: "absolute", inset: "4px 6px 6px 6px", borderRadius: 4, background: roleCover ? `url(${roleCover}) center/cover no-repeat` : "linear-gradient(135deg,#e5e7eb,#dbe4f0)", transform: "rotate(2deg)", boxShadow: "0 8px 20px rgba(15,23,42,0.10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    {roleCover ? null : getRoleIcon(roleCard.label)}
                                  </div>
                                  <div style={{ position: "absolute", inset: 0, borderRadius: 4, background: roleCover ? `url(${roleCover}) center/cover no-repeat` : "linear-gradient(135deg,#f1f5f9,#dbe4f0)", border: active ? "2px solid #b91c1c" : "1px solid #d0d5dd", boxShadow: "0 10px 25px rgba(15,23,42,0.14)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    {roleCover ? null : getRoleIcon(roleCard.label)}
                                  </div>
                                </div>
                              </Link>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, alignItems: "start" }}>
                                <div>
                                  <button style={{ border: 0, background: "transparent", padding: 0, color: "#111111", fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: 0.3, cursor: "text", textAlign: "left" }}>
                                    {clean(roleCard.label) || "Role"}
                                  </button>
                                  <div style={{ color: "#4b5563", fontSize: 12, marginTop: 3 }}>{personCount} Person{personCount !== 1 ? "s" : ""}</div>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                  <Link
                                    href={roleHref}
                                    style={{
                                      borderRadius: 10,
                                      border: "1px solid #111111",
                                      background: "#fff",
                                      color: "#111111",
                                      padding: "8px 10px",
                                      fontWeight: 700,
                                      textDecoration: "none",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                    }}
                                  >
                                    Open Role
                                  </Link>
                                  <div style={{ position: "relative" }}>
                                    <button
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setOpenRoleMenuId((prev) => (prev === roleCard.key ? null : roleCard.key));
                                      }}
                                      style={{
                                        width: 40,
                                        height: 40,
                                        borderRadius: 10,
                                        border: "1px solid #111111",
                                        background: openRoleMenuId === roleCard.key ? "#fff5f5" : "#fff",
                                        color: "#111111",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        cursor: "pointer",
                                      }}
                                      aria-label="Role actions"
                                    >
                                      <Menu size={18} />
                                    </button>
                                    {openRoleMenuId === roleCard.key ? (
                                      <div
                                        style={{
                                          position: "absolute",
                                          right: 0,
                                          top: "calc(100% + 8px)",
                                          minWidth: 190,
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
                                          onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            void openRoleCoverPicker(roleCard.rawLabel);
                                          }}
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
                                          Choose Cover Photo
                                        </button>
                                        <Link
                                          href={roleHref}
                                          onClick={() => setOpenRoleMenuId(null)}
                                          style={{
                                            display: "block",
                                            padding: "12px 14px",
                                            color: "#b91c1c",
                                            textDecoration: "none",
                                            fontWeight: 700,
                                            borderTop: "1px solid #f1f5f9",
                                          }}
                                        >
                                          Open Role
                                        </Link>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            void deleteRole(roleCard.rawLabel, roleCard.label);
                                          }}
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
                                          Delete Role Gallery
                                        </button>
                                      </div>
                                    ) : null}
                                  </div>
                                  <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSelectedRoleIds(prev => prev.includes(roleCard.key) ? prev.filter(id => id !== roleCard.key) : [...prev, roleCard.key]); }} style={{ borderRadius: 10, border: active ? "1px solid #111111" : "1px solid #d0d5dd", background: active ? "#111111" : "#fff", color: active ? "#fff" : "#111111", padding: "8px 10px", fontWeight: 700, cursor: "pointer" }}>{active ? "Selected" : "Select"}</button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </main>
          </div>
        )}
      </div>

      <input
        ref={schoolCoverInputRef}
        type="file"
        accept="image/*"
        onChange={uploadSchoolCover}
        style={{ display: "none" }}
      />

      {createGalleryKind ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", zIndex: 72, padding: 24 }}>
          <div style={{ width: "100%", maxWidth: 520, background: "#fff", borderRadius: 24, border: "1px solid #e5e7eb", boxShadow: "0 30px 60px rgba(15,23,42,0.25)", overflow: "hidden" }}>
            <div style={{ padding: "20px 22px", borderBottom: "1px solid #eef2f7" }}>
              <div style={{ fontSize: 24, fontWeight: 900, color: "#111111" }}>{createGalleryKind === "class" ? "Add Class" : "Add Role Gallery"}</div>
              <div style={{ color: "#4b5563", marginTop: 4 }}>
                {createGalleryKind === "class"
                  ? "Create an empty class first, then open it to add students and photos."
                  : "Create an empty role gallery first, then open it to add people and photos."}
              </div>
            </div>
            <div style={{ padding: 22 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111111", marginBottom: 8 }}>
                {createGalleryKind === "class" ? "Class name" : "Role gallery name"}
              </div>
              <input
                value={createGalleryName}
                onChange={(e) => setCreateGalleryName(e.target.value)}
                placeholder={createGalleryKind === "class" ? "Eastern" : "Coach"}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void createGallery(createGalleryKind);
                  }
                }}
                style={{ width: "100%", boxSizing: "border-box", borderRadius: 14, border: "1px solid #d0d5dd", padding: "14px 16px", fontSize: 15, color: "#111111", outline: "none" }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, padding: "18px 22px", borderTop: "1px solid #eef2f7" }}>
              <button onClick={() => { setCreateGalleryKind(null); setCreateGalleryName(""); }} style={{ borderRadius: 14, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "12px 16px", fontWeight: 800, cursor: "pointer" }}>Cancel</button>
              <button onClick={() => void createGallery(createGalleryKind)} disabled={!clean(createGalleryName) || creatingGallery} style={{ borderRadius: 14, border: 0, background: !clean(createGalleryName) || creatingGallery ? "#d1d5db" : "#111111", color: "#fff", padding: "12px 16px", fontWeight: 800, cursor: !clean(createGalleryName) || creatingGallery ? "not-allowed" : "pointer" }}>{creatingGallery ? "Saving..." : createGalleryKind === "class" ? "Add Class" : "Add Role Gallery"}</button>
            </div>
          </div>
        </div>
      ) : null}

      {schoolCoverPickerOpen ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", zIndex: 70, padding: 24 }}>
          <div style={{ width: "100%", maxWidth: 1100, maxHeight: "88vh", overflow: "hidden", background: "#fff", borderRadius: 24, border: "1px solid #e5e7eb", boxShadow: "0 30px 60px rgba(15,23,42,0.25)", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 22px", borderBottom: "1px solid #eef2f7" }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#111111" }}>Choose Cover Photo</div>
                <div style={{ color: "#4b5563", marginTop: 4 }}>Pick one synced photo for this school gallery.</div>
              </div>
              <button onClick={() => setSchoolCoverPickerOpen(false)} style={{ border: 0, background: "#fff", cursor: "pointer", color: "#475467", fontSize: 22, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: 22, flex: 1, minHeight: 0, overflow: "auto" }}>
              {schoolCoverPickerLoading ? (
                <div style={{ border: "1px dashed #d0d5dd", borderRadius: 16, padding: 24, color: "#4b5563" }}>Loading school photos...</div>
              ) : schoolCoverOptions.length === 0 ? (
                <div style={{ border: "1px dashed #d0d5dd", borderRadius: 16, padding: 24, color: "#4b5563" }}>No synced photos available for school cover selection yet. Use Upload Cover Photo to add one directly.</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 16 }}>
                  {schoolCoverOptions.map((item) => {
                    const active = selectedSchoolCoverUrl === item.url;
                    return (
                      <button key={item.id} onClick={() => setSelectedSchoolCoverUrl(item.url)} style={{ border: active ? "3px solid #b91c1c" : "1px solid #e5e7eb", background: "#fff", borderRadius: 18, padding: 0, overflow: "hidden", cursor: "pointer", textAlign: "left" }}>
                        <div style={{ aspectRatio: "4 / 3", background: item.url ? `url(${item.url}) center/cover no-repeat` : "#e5e7eb" }} />
                        <div style={{ padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#111111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</div>
                          {active ? <span style={{ color: "#b91c1c", fontWeight: 900 }}>Selected</span> : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 22px", borderTop: "1px solid #eef2f7", background: "#ffffff" }}>
              <div style={{ minWidth: 0, color: selectedSchoolCoverUrl ? "#b91c1c" : "#6b7280", fontSize: 14, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selectedSchoolCoverUrl ? `Selected: ${labelFromCoverUrl(selectedSchoolCoverUrl, "Selected cover")}` : "Select a photo, then confirm it here."}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, flexShrink: 0 }}>
                <button onClick={() => setSchoolCoverPickerOpen(false)} style={{ borderRadius: 14, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "12px 16px", fontWeight: 800, cursor: "pointer" }}>Cancel</button>
                <button onClick={saveSchoolCover} disabled={!selectedSchoolCoverUrl || schoolCoverPickerSaving} style={{ borderRadius: 14, border: 0, background: !selectedSchoolCoverUrl || schoolCoverPickerSaving ? "#d1d5db" : "#111111", color: "#fff", padding: "12px 16px", fontWeight: 800, cursor: !selectedSchoolCoverUrl || schoolCoverPickerSaving ? "not-allowed" : "pointer" }}>{schoolCoverPickerSaving ? "Saving..." : "Confirm cover"}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {classCoverPickerOpen ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", zIndex: 70, padding: 24 }}>
          <div style={{ width: "100%", maxWidth: 1100, maxHeight: "88vh", overflow: "hidden", background: "#fff", borderRadius: 24, border: "1px solid #e5e7eb", boxShadow: "0 30px 60px rgba(15,23,42,0.25)", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 22px", borderBottom: "1px solid #eef2f7" }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#111111" }}>Choose Cover Photo</div>
                <div style={{ color: "#4b5563", marginTop: 4 }}>Pick one synced photo for {coverPickerClassLabel || "this class"}.</div>
              </div>
              <button onClick={() => setClassCoverPickerOpen(false)} style={{ border: 0, background: "#fff", cursor: "pointer", color: "#475467", fontSize: 22, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: 22, flex: 1, minHeight: 0, overflow: "auto" }}>
              {classCoverPickerLoading ? (
                <div style={{ border: "1px dashed #d0d5dd", borderRadius: 16, padding: 24, color: "#4b5563" }}>Loading class photos...</div>
              ) : classCoverOptions.length === 0 ? (
                <div style={{ border: "1px dashed #d0d5dd", borderRadius: 16, padding: 24, color: "#4b5563" }}>No synced photos available for class cover selection.</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 16 }}>
                  {classCoverOptions.map((item) => {
                    const active = selectedClassCoverUrl === item.url;
                    return (
                      <button key={item.id} onClick={() => setSelectedClassCoverUrl(item.url)} style={{ border: active ? "3px solid #b91c1c" : "1px solid #e5e7eb", background: "#fff", borderRadius: 18, padding: 0, overflow: "hidden", cursor: "pointer", textAlign: "left" }}>
                        <div style={{ aspectRatio: "4 / 3", background: item.url ? `url(${item.url}) center/cover no-repeat` : "#e5e7eb" }} />
                        <div style={{ padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#111111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</div>
                          {active ? <span style={{ color: "#b91c1c", fontWeight: 900 }}>Selected</span> : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 22px", borderTop: "1px solid #eef2f7", background: "#ffffff" }}>
              <div style={{ minWidth: 0, color: selectedClassCoverUrl ? "#b91c1c" : "#6b7280", fontSize: 14, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selectedClassCoverUrl ? `Selected: ${labelFromCoverUrl(selectedClassCoverUrl, "Selected cover")}` : "Select a photo, then confirm it here."}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, flexShrink: 0 }}>
              <button onClick={() => setClassCoverPickerOpen(false)} style={{ borderRadius: 14, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "12px 16px", fontWeight: 800, cursor: "pointer" }}>Cancel</button>
              <button onClick={saveClassCover} disabled={!selectedClassCoverUrl || classCoverPickerSaving} style={{ borderRadius: 14, border: 0, background: !selectedClassCoverUrl || classCoverPickerSaving ? "#d1d5db" : "#111111", color: "#fff", padding: "12px 16px", fontWeight: 800, cursor: !selectedClassCoverUrl || classCoverPickerSaving ? "not-allowed" : "pointer" }}>{classCoverPickerSaving ? "Saving..." : "Confirm cover"}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {roleCoverPickerOpen ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", zIndex: 70, padding: 24 }}>
          <div style={{ width: "100%", maxWidth: 1100, maxHeight: "88vh", overflow: "hidden", background: "#fff", borderRadius: 24, border: "1px solid #e5e7eb", boxShadow: "0 30px 60px rgba(15,23,42,0.25)", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 22px", borderBottom: "1px solid #eef2f7" }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#111111" }}>Choose Cover Photo</div>
                <div style={{ color: "#4b5563", marginTop: 4 }}>Pick one synced photo for {coverPickerRoleName || "this role gallery"}.</div>
              </div>
              <button onClick={() => setRoleCoverPickerOpen(false)} style={{ border: 0, background: "#fff", cursor: "pointer", color: "#475467", fontSize: 22, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: 22, flex: 1, minHeight: 0, overflow: "auto" }}>
              {roleCoverPickerLoading ? (
                <div style={{ border: "1px dashed #d0d5dd", borderRadius: 16, padding: 24, color: "#4b5563" }}>Loading role photos...</div>
              ) : roleCoverOptions.length === 0 ? (
                <div style={{ border: "1px dashed #d0d5dd", borderRadius: 16, padding: 24, color: "#4b5563" }}>No synced photos available for role cover selection.</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 16 }}>
                  {roleCoverOptions.map((item) => {
                    const active = selectedRoleCoverUrl === item.url;
                    return (
                      <button key={item.id} onClick={() => setSelectedRoleCoverUrl(item.url)} style={{ border: active ? "3px solid #b91c1c" : "1px solid #e5e7eb", background: "#fff", borderRadius: 18, padding: 0, overflow: "hidden", cursor: "pointer", textAlign: "left" }}>
                        <div style={{ aspectRatio: "4 / 3", background: item.url ? `url(${item.url}) center/cover no-repeat` : "#e5e7eb" }} />
                        <div style={{ padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#111111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</div>
                          {active ? <span style={{ color: "#b91c1c", fontWeight: 900 }}>Selected</span> : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 22px", borderTop: "1px solid #eef2f7", background: "#ffffff" }}>
              <div style={{ minWidth: 0, color: selectedRoleCoverUrl ? "#b91c1c" : "#6b7280", fontSize: 14, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selectedRoleCoverUrl ? `Selected: ${labelFromCoverUrl(selectedRoleCoverUrl, "Selected cover")}` : "Select a photo, then confirm it here."}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, flexShrink: 0 }}>
              <button onClick={() => setRoleCoverPickerOpen(false)} style={{ borderRadius: 14, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "12px 16px", fontWeight: 800, cursor: "pointer" }}>Cancel</button>
              <button onClick={saveRoleCover} disabled={!selectedRoleCoverUrl || roleCoverPickerSaving} style={{ borderRadius: 14, border: 0, background: !selectedRoleCoverUrl || roleCoverPickerSaving ? "#d1d5db" : "#111111", color: "#fff", padding: "12px 16px", fontWeight: 800, cursor: !selectedRoleCoverUrl || roleCoverPickerSaving ? "not-allowed" : "pointer" }}>{roleCoverPickerSaving ? "Saving..." : "Confirm cover"}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {contactModalOpen ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", zIndex: 80, padding: 24 }}>
          <div style={{ width: "100%", maxWidth: 520, background: "#fff", borderRadius: 24, border: "1px solid #e5e7eb", boxShadow: "0 30px 60px rgba(15,23,42,0.25)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 22px", borderBottom: "1px solid #eef2f7" }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#111111" }}>Add Contact</div>
                <div style={{ color: "#4b5563", marginTop: 4 }}>Save a school contact for quick reference here.</div>
              </div>
              <button onClick={() => setContactModalOpen(false)} style={{ border: 0, background: "#fff", cursor: "pointer", color: "#475467", fontSize: 22, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: 22, display: "grid", gap: 16 }}>
              <label style={{ display: "grid", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#111111" }}>Name</span>
                <input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="Contact name" style={{ width: "100%", boxSizing: "border-box", borderRadius: 12, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "12px 14px", fontWeight: 600, outline: "none" }} />
              </label>
              <label style={{ display: "grid", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#111111" }}>Email</span>
                <input value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="Contact email" style={{ width: "100%", boxSizing: "border-box", borderRadius: 12, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "12px 14px", fontWeight: 600, outline: "none" }} />
              </label>
              <label style={{ display: "grid", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#111111" }}>Phone</span>
                <input value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} placeholder="Contact phone" style={{ width: "100%", boxSizing: "border-box", borderRadius: 12, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "12px 14px", fontWeight: 600, outline: "none" }} />
              </label>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, padding: "18px 22px", borderTop: "1px solid #eef2f7", background: "#ffffff" }}>
              <button onClick={() => setContactModalOpen(false)} style={{ borderRadius: 14, border: "1px solid #d0d5dd", background: "#fff", color: "#111111", padding: "12px 16px", fontWeight: 800, cursor: "pointer" }}>Cancel</button>
              <button onClick={addContact} disabled={!clean(contactName)} style={{ borderRadius: 14, border: 0, background: !clean(contactName) ? "#d1d5db" : "#111111", color: "#fff", padding: "12px 16px", fontWeight: 800, cursor: !clean(contactName) ? "not-allowed" : "pointer" }}>Save Contact</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Share Gallery Modal ── */}
      {shareModalOpen ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", display: "grid", placeItems: "center", zIndex: 78, padding: 24 }}>
          <div style={{ width: "100%", maxWidth: 580, background: "#fff", borderRadius: 24, border: "1px solid #e5e7eb", boxShadow: "0 30px 60px rgba(15,23,42,0.25)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 22px", borderBottom: "1px solid #eef2f7" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 900, color: "#111111" }}>Share Gallery</div>
                <div style={{ color: "#4b5563", fontSize: 13, marginTop: 4 }}>Share the {school?.school_name || "school"} gallery</div>
              </div>
              <button onClick={() => setShareModalOpen(false)} style={{ border: 0, background: "transparent", cursor: "pointer", color: "#6b7280" }}>
                <X size={22} />
              </button>
            </div>
            <div style={{ padding: 24, display: "grid", gap: 16 }}>
              <a href={`/dashboard/projects/schools/${schoolId}/visitors`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, borderRadius: 18, border: "1px solid #e5e7eb", background: "#fff", padding: "18px 20px", cursor: "pointer", textAlign: "left", textDecoration: "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 999, background: "#fff3e8", color: "#f97316", display: "grid", placeItems: "center" }}><Mail size={20} /></div>
                  <div>
                    <div style={{ color: "#111111", fontWeight: 800 }}>Email Gallery Visitors</div>
                    <div style={{ color: "#4b5563", fontSize: 13, marginTop: 4 }}>Send mass emails to registered school visitors.</div>
                  </div>
                </div>
                <ExternalLink size={18} color="#6b7280" />
              </a>

              <a href={`/dashboard/projects/schools/${schoolId}/visitors`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, borderRadius: 18, border: "1px solid #e5e7eb", background: "#fff", padding: "18px 20px", cursor: "pointer", textAlign: "left", textDecoration: "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 999, background: "#eef2ff", color: "#4f46e5", display: "grid", placeItems: "center" }}><Send size={20} /></div>
                  <div>
                    <div style={{ color: "#111111", fontWeight: 800 }}>Email Others</div>
                    <div style={{ color: "#4b5563", fontSize: 13, marginTop: 4 }}>Compose a gallery email for custom recipients.</div>
                  </div>
                </div>
                <ExternalLink size={18} color="#6b7280" />
              </a>

              <button onClick={() => { void copySchoolLink(); setShareModalOpen(false); }} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, borderRadius: 18, border: "1px solid #e5e7eb", background: "#fff", padding: "18px 20px", cursor: "pointer", textAlign: "left" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 999, background: "#fff1f2", color: "#dc2626", display: "grid", placeItems: "center" }}><Copy size={20} /></div>
                  <div>
                    <div style={{ color: "#111111", fontWeight: 800 }}>Copy Gallery Link</div>
                    <div style={{ color: "#4b5563", fontSize: 13, marginTop: 4 }}>Copies the school gallery access link.</div>
                  </div>
                </div>
                <ExternalLink size={18} color="#6b7280" />
              </button>

              <a href={`/dashboard/projects/schools/${schoolId}/visitors`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, borderRadius: 18, border: "1px solid #e5e7eb", background: "#fff", padding: "18px 20px", cursor: "pointer", textAlign: "left", textDecoration: "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 999, background: "#eff6ff", color: "#0284c7", display: "grid", placeItems: "center" }}><Heart size={20} /></div>
                  <div>
                    <div style={{ color: "#111111", fontWeight: 800 }}>Gallery Visitors</div>
                    <div style={{ color: "#4b5563", fontSize: 13, marginTop: 4 }}>See visitor activity, favorites, and export a quick report.</div>
                  </div>
                </div>
                <ExternalLink size={18} color="#6b7280" />
              </a>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Focal Point Editor Modal ── */}
      {focalEditorOpen && grouped.schoolCover ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
          <div style={{ background: "#fff", borderRadius: 20, width: "90%", maxWidth: 680, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 64px rgba(0,0,0,0.25)" }}>
            {/* Header */}
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#111" }}>Edit Cover Photo</h2>
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>Adjust the focal point to control how the cover photo is cropped.</p>
              </div>
              <button onClick={() => setFocalEditorOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#6b7280" }}>
                <X size={20} />
              </button>
            </div>

            {/* Scrollable body */}
            <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            {/* Image with focal point */}
            <div style={{ padding: "24px 24px 16px", display: "flex", justifyContent: "center" }}>
              <div
                style={{ position: "relative", width: "100%", maxWidth: 600, cursor: "crosshair", borderRadius: 12, overflow: "hidden", border: "1px solid #e5e7eb" }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
                  setFocalX(x);
                  setFocalY(y);
                }}
              >
                <img
                  src={grouped.schoolCover}
                  alt="Cover"
                  draggable={false}
                  style={{ width: "100%", maxHeight: "50vh", objectFit: "contain", display: "block", userSelect: "none" }}
                />
                {/* Focal point indicator */}
                <div
                  style={{
                    position: "absolute",
                    left: `${focalX * 100}%`,
                    top: `${focalY * 100}%`,
                    transform: "translate(-50%, -50%)",
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    border: "3px solid #fff",
                    boxShadow: "0 0 0 2px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(0,0,0,0.2)",
                    pointerEvents: "none",
                    transition: "left 0.1s, top 0.1s",
                  }}
                >
                  <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "rgba(255,255,255,0.25)" }} />
                  <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.8)", transform: "translateX(-50%)" }} />
                  <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: "rgba(255,255,255,0.8)", transform: "translateY(-50%)" }} />
                </div>
              </div>
            </div>

            {/* Preview strip */}
            <div style={{ padding: "0 24px 16px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7280", marginBottom: 6 }}>Crop preview</div>
              <div style={{ width: "100%", height: 80, borderRadius: 10, overflow: "hidden", border: "1px solid #e5e7eb", backgroundImage: `url(${grouped.schoolCover})`, backgroundSize: "cover", backgroundPosition: `${Math.round(focalX * 100)}% ${Math.round(focalY * 100)}%` }} />
            </div>
            </div>{/* end scrollable body */}

            {/* Footer */}
            <div style={{ padding: "16px 24px 20px", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "flex-end", gap: 12, flexShrink: 0 }}>
              <button
                onClick={() => setFocalEditorOpen(false)}
                style={{ borderRadius: 12, border: "1px solid #d0d5dd", background: "#fff", color: "#344054", padding: "12px 20px", fontWeight: 700, cursor: "pointer", fontSize: 14 }}
              >
                Cancel
              </button>
              <button
                disabled={savingFocal || !schoolSyncedProjectId}
                onClick={async () => {
                  if (!schoolSyncedProjectId) return;
                  setSavingFocal(true);
                  try {
                    const res = await fetch(`/api/dashboard/events/${schoolSyncedProjectId}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ cover_focal_x: focalX, cover_focal_y: focalY }),
                    });
                    if (!res.ok) throw new Error("Failed to save focal point");
                    setFocalEditorOpen(false);
                  } catch (err) {
                    alert(err instanceof Error ? err.message : "Failed to save");
                  } finally {
                    setSavingFocal(false);
                  }
                }}
                style={{ borderRadius: 12, border: 0, background: savingFocal ? "#94a3b8" : "#0f172a", color: "#fff", padding: "12px 24px", fontWeight: 700, cursor: savingFocal ? "not-allowed" : "pointer", fontSize: 14 }}
              >
                {savingFocal ? "Saving\u2026" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

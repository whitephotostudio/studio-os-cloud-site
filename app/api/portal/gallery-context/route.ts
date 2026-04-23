import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import {
  sanitizeEventGallerySettingsForClient,
} from "@/lib/event-gallery-settings";
import { buildSchoolGalleryDownloadAccess } from "@/lib/school-gallery-downloads";
import { filterPackagesForProfile } from "@/lib/package-profile-selection";
import { buildSchoolCandidateFolders, loadFolderMediaRows } from "@/lib/storage-folder";
import { hasActiveSubscription } from "@/lib/subscription-gate";

export const dynamic = "force-dynamic";

type StudentRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  photo_url: string | null;
  class_id: string | null;
  school_id: string;
  class_name?: string | null;
  folder_name?: string | null;
  pin?: string | null;
};

type SchoolRow = {
  id: string;
  school_name: string | null;
  photographer_id: string | null;
  package_profile_id: string | null;
  local_school_id?: string | null;
  status?: string | null;
  order_due_date?: string | null;
  expiration_date?: string | null;
  access_mode?: string | null;
  access_pin?: string | null;
  email_required?: boolean | null;
  gallery_settings?: unknown;
  screenshot_protection_desktop?: boolean | null;
  screenshot_protection_mobile?: boolean | null;
  screenshot_protection_watermark?: boolean | null;
};

type ProjectRow = {
  id: string;
  portal_status?: string | null;
  order_due_date?: string | null;
  expiration_date?: string | null;
  project_name?: string | null;
  name?: string | null;
  title?: string | null;
};

type PackageItemValue =
  | string
  | {
      qty?: number | string | null;
      name?: string | null;
      type?: string | null;
      size?: string | null;
      finish?: string | null;
    };

type PackageRow = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  items?: PackageItemValue[] | null;
  profile_id?: string | null;
  category?: string | null;
};

type BackdropRow = {
  id: string;
  name: string;
  image_url: string;
  thumbnail_url: string | null;
  tier: "free" | "premium";
  price_cents: number;
  category: string | null;
  tags: string[] | null;
  sort_order: number;
};

type CompositeMediaRow = {
  id: string;
  collection_id: string | null;
  storage_path: string | null;
  preview_url: string | null;
  thumbnail_url: string | null;
  download_url?: string | null;
  filename: string | null;
  created_at: string | null;
  sort_order: number | null;
  collection_title?: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function looksLikeImageAssetUrl(value: string | null | undefined) {
  const candidate = clean(value);
  if (!candidate) return false;
  return (
    /^https?:\/\//i.test(candidate) &&
    (
      /(png|jpe?g|webp|gif|svg|avif)(\?|#|$)/i.test(candidate) ||
      candidate.includes("/storage/v1/object/") ||
      candidate.includes("/studio-logos/")
    )
  );
}

function slugify(value: string, fallback = "collection") {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

async function loadSchoolCompositeMedia(
  service: ReturnType<typeof createDashboardServiceClient>,
  school: SchoolRow | null,
  className: string | null | undefined,
) {
  const normalizedClass = clean(className);
  if (!school?.id || !normalizedClass) return [] as CompositeMediaRow[];

  const projectBySchoolId = await service
    .from("projects")
    .select("id")
    .eq("workflow_type", "school")
    .eq("linked_school_id", school.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (projectBySchoolId.error) throw projectBySchoolId.error;

  let projectId = clean(projectBySchoolId.data?.id);
  if (!projectId && school.local_school_id) {
    const localProject = await service
      .from("projects")
      .select("id")
      .eq("workflow_type", "school")
      .eq("linked_local_school_id", school.local_school_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (localProject.error) throw localProject.error;
    projectId = clean(localProject.data?.id);
  }

  if (!projectId) return [] as CompositeMediaRow[];

  const { data: collectionRows, error: collectionError } = await service
    .from("collections")
    .select("id,title,slug")
    .eq("project_id", projectId)
    .eq("kind", "composite")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (collectionError) throw collectionError;

  const targetSlug = slugify(normalizedClass, "composite");
  const matchingCollections = (collectionRows ?? []).filter((row) => {
    const rowTitle = clean(row.title).toLowerCase();
    const rowSlug = clean(row.slug);
    return rowTitle === normalizedClass.toLowerCase() || rowSlug === targetSlug;
  });
  if (!matchingCollections.length) return [] as CompositeMediaRow[];

  const collectionIds = matchingCollections.map((row) => clean(row.id)).filter(Boolean);
  const collectionTitleById = new Map(
    matchingCollections.map((row) => [clean(row.id), clean(row.title) || normalizedClass]),
  );

  const { data: mediaRows, error: mediaError } = await service
    .from("media")
    .select("id,collection_id,storage_path,preview_url,thumbnail_url,filename,created_at,sort_order")
    .eq("project_id", projectId)
    .in("collection_id", collectionIds)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(5000);

  if (mediaError) throw mediaError;

  const uniqueRows = new Map<string, CompositeMediaRow>();
  for (const row of (mediaRows ?? []) as CompositeMediaRow[]) {
    const collectionId = clean(row.collection_id);
    const storagePath = clean(row.storage_path);
    if (!collectionId) continue;
    const key = `${collectionId}::${storagePath || clean(row.id)}`;
    if (!uniqueRows.has(key)) {
      uniqueRows.set(key, row);
    }
  }

  return Array.from(uniqueRows.values()).map((row) => ({
    ...row,
    collection_title: collectionTitleById.get(clean(row.collection_id)) || normalizedClass,
  }));
}

export async function POST(request: NextRequest) {
  try {
    const { pin, schoolId, email } = (await request.json()) as {
      pin?: string;
      schoolId?: string;
      email?: string;
    };

    const selectedPin = clean(pin);
    const selectedSchoolId = clean(schoolId);
    const selectedEmail = clean(email).toLowerCase();

    if (!selectedPin) {
      return NextResponse.json({ ok: false, message: "Missing PIN." }, { status: 400 });
    }

    const service = createDashboardServiceClient();

    const { data: currentSchool, error: currentSchoolError } = selectedSchoolId
      ? await service
          .from("schools")
          .select("id,school_name,photographer_id,package_profile_id,local_school_id,status,order_due_date,expiration_date,access_mode,access_pin,email_required,gallery_settings,screenshot_protection_desktop,screenshot_protection_mobile,screenshot_protection_watermark")
          .eq("id", selectedSchoolId)
          .maybeSingle<SchoolRow>()
      : { data: null as SchoolRow | null, error: null };

    if (currentSchoolError) throw currentSchoolError;

    const schoolNameForMatch = clean(currentSchool?.school_name);
    let schoolIdsToSearch: string[] = [];
    let schoolRowsForMatch: SchoolRow[] = currentSchool ? [currentSchool] : [];

    if (schoolNameForMatch) {
      const { data: sameNameSchools, error: sameNameError } = await service
        .from("schools")
        .select("id,school_name,photographer_id,package_profile_id,local_school_id,status,order_due_date,expiration_date,access_mode,access_pin,email_required,gallery_settings,screenshot_protection_desktop,screenshot_protection_mobile,screenshot_protection_watermark")
        .ilike("school_name", schoolNameForMatch)
        .order("created_at", { ascending: false });

      if (sameNameError) throw sameNameError;

      schoolRowsForMatch = (sameNameSchools as SchoolRow[] | null) ?? schoolRowsForMatch;
      schoolIdsToSearch = Array.from(
        new Set([
          ...schoolRowsForMatch.map((row) => row.id),
          ...(selectedSchoolId ? [selectedSchoolId] : []),
        ]),
      );
    } else if (selectedSchoolId) {
      schoolIdsToSearch = [selectedSchoolId];
    }

    const studentQuery = service
      .from("students")
        .select("id,first_name,last_name,photo_url,class_id,school_id,class_name,folder_name,pin")
      .eq("pin", selectedPin);

    const { data: studentRows, error: studentsError } =
      schoolIdsToSearch.length > 0
        ? await studentQuery.in("school_id", schoolIdsToSearch)
        : await studentQuery;

    if (studentsError) throw studentsError;

    const studentCandidates = (studentRows as StudentRow[] | null) ?? [];
    if (!studentCandidates.length) {
      return NextResponse.json(
        { ok: false, message: "Student not found for this PIN." },
        { status: 404 },
      );
    }

    const primaryStudent =
      studentCandidates.find((row) => row.school_id === selectedSchoolId && !!row.photo_url) ??
      studentCandidates.find((row) => !!row.photo_url) ??
      studentCandidates.find((row) => row.school_id === selectedSchoolId) ??
      studentCandidates[0];

    const knownSchoolsById = new Map<string, SchoolRow>();
    for (const row of schoolRowsForMatch) {
      knownSchoolsById.set(row.id, row);
    }
    if (currentSchool?.id) {
      knownSchoolsById.set(currentSchool.id, currentSchool);
    }

    let activeSchool = knownSchoolsById.get(primaryStudent.school_id) ?? null;
    if (!activeSchool && primaryStudent.school_id) {
      const { data: fetchedSchool, error: fetchedSchoolError } = await service
        .from("schools")
        .select("id,school_name,photographer_id,package_profile_id,local_school_id,status,order_due_date,expiration_date,access_mode,access_pin,email_required,gallery_settings,screenshot_protection_desktop,screenshot_protection_mobile,screenshot_protection_watermark")
        .eq("id", primaryStudent.school_id)
        .maybeSingle<SchoolRow>();

      if (fetchedSchoolError) throw fetchedSchoolError;
      activeSchool = fetchedSchool ?? null;
    }

    const activeProject: ProjectRow | null = activeSchool
      ? {
          id: activeSchool.id,
          portal_status: activeSchool.status ?? null,
          order_due_date: activeSchool.order_due_date ?? null,
          expiration_date: activeSchool.expiration_date ?? null,
        }
      : null;
    const publicGallerySettings = sanitizeEventGallerySettingsForClient(
      activeSchool?.gallery_settings,
    );
    const downloadAccess = activeSchool
      ? await buildSchoolGalleryDownloadAccess({
          service,
          schoolId: activeSchool.id,
          viewerEmail: selectedEmail,
          gallerySettings: activeSchool.gallery_settings,
        })
      : undefined;

    let packageRows: PackageRow[] = [];
    let backdropRows: BackdropRow[] = [];
    let compositeRows: CompositeMediaRow[] = [];
    let mediaRows: CompositeMediaRow[] = [];
    let photographerId: string | null = activeSchool?.photographer_id ?? null;
    let watermarkEnabled = true;
    let watermarkLogoUrl = "";
    let studioInfo = {
      businessName: "",
      logoUrl: "",
      address: "",
      phone: "",
      email: "",
    };

    if (activeSchool?.photographer_id) {
      const [packagesResult, backdropsResult, photographerResult] = await Promise.all([
        service
          .from("packages")
          .select("id,name,description,price_cents,items,profile_id,category")
          .eq("photographer_id", activeSchool.photographer_id)
          .eq("active", true)
          .order("price_cents", { ascending: true }),
        service
          .from("backdrop_catalog")
          .select("id,name,image_url,thumbnail_url,tier,price_cents,category,tags,sort_order")
          .eq("photographer_id", activeSchool.photographer_id)
          .eq("active", true)
          .order("sort_order", { ascending: true }),
        service
          .from("photographers")
          .select("id,watermark_enabled,watermark_logo_url,logo_url,business_name,studio_address,studio_phone,studio_email,default_package_profile_id,is_platform_admin,subscription_status,trial_starts_at,trial_ends_at,created_at")
          .eq("id", activeSchool.photographer_id)
          .maybeSingle(),
      ]);

      if (packagesResult.error) throw packagesResult.error;
      if (backdropsResult.error) throw backdropsResult.error;
      if (photographerResult.error) throw photographerResult.error;

      // Defense-in-depth gate: block cancelled photographers at read time even
      // if the Stripe-webhook cleanup hasn't landed yet (webhook is
      // eventually-consistent and can fail/race). Platform admins and active
      // trial users pass.
      if (!hasActiveSubscription(photographerResult.data)) {
        return NextResponse.json(
          { ok: false, message: "This gallery is no longer available." },
          { status: 410 },
        );
      }

      const photographerDefaultProfileId = ((photographerResult.data as Record<string, unknown> | null)?.default_package_profile_id as string | null) ?? null;
      const availablePackages = (packagesResult.data ?? []) as PackageRow[];
      packageRows = filterPackagesForProfile(availablePackages, {
        selectedProfileId:
          activeSchool.package_profile_id ||
          publicGallerySettings.extras.priceSheetProfileId ||
          photographerDefaultProfileId,
      }).packages;
      backdropRows = (backdropsResult.data ?? []) as BackdropRow[];

      const photographer = photographerResult.data;
      if (photographer) {
        photographerId = photographer.id ?? photographerId;
        watermarkEnabled = photographer.watermark_enabled !== false;
        const resolvedLogoUrl = looksLikeImageAssetUrl(photographer.watermark_logo_url)
          ? photographer.watermark_logo_url
          : looksLikeImageAssetUrl(photographer.logo_url)
            ? photographer.logo_url
            : "";
        watermarkLogoUrl = resolvedLogoUrl || "";
        studioInfo = {
          businessName: photographer.business_name || "",
          logoUrl: resolvedLogoUrl || "",
          address: photographer.studio_address || "",
          phone: photographer.studio_phone || "",
          email: photographer.studio_email || "",
        };
      }
    }

    compositeRows = await loadSchoolCompositeMedia(
      service,
      activeSchool,
      primaryStudent.class_name,
    );
    mediaRows = (
      await loadFolderMediaRows(
        buildSchoolCandidateFolders({
          studentCandidates,
          activeSchool,
          selectedSchoolId,
        }),
      )
    ).map((row) => ({
      ...row,
      collection_id: null,
      created_at: null,
      sort_order: null,
    }));

    // Screenshot protection flags surfaced to the client.  The column values
    // live on `activeSchool` already (see select list above) but we also
    // surface them at a stable top-level key so the portal doesn't have to
    // poke into vendor-shaped rows.
    const screenshotProtection = {
      desktop: Boolean(activeSchool?.screenshot_protection_desktop),
      mobile: Boolean(activeSchool?.screenshot_protection_mobile),
      watermark: Boolean(activeSchool?.screenshot_protection_watermark),
    };

    return NextResponse.json({
      ok: true,
      currentSchool,
      schoolRowsForMatch,
      studentCandidates,
      primaryStudent,
      activeSchool,
      activeProject,
      gallerySettings: publicGallerySettings,
      downloadAccess,
      media: mediaRows,
      composites: compositeRows,
      packages: packageRows,
      backdrops: backdropRows,
      photographerId,
      watermarkEnabled,
      watermarkLogoUrl,
      studioInfo,
      screenshotProtection,
    });
  } catch (error) {
    console.error("[gallery-context]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to load gallery context." },
      { status: 500 },
    );
  }
}

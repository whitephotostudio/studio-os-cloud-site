import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import {
  sanitizeEventGallerySettingsForClient,
} from "@/lib/event-gallery-settings";
import { buildSchoolGalleryDownloadAccess } from "@/lib/school-gallery-downloads";
import { buildStoredMediaUrls } from "@/lib/storage-images";
import { filterPackagesForProfile } from "@/lib/package-profile-selection";
import { buildSchoolCandidateFolders, loadFolderMediaRows } from "@/lib/storage-folder";

export const dynamic = "force-dynamic";

type SchoolRow = {
  id: string;
  school_name: string;
  status: string | null;
  expiration_date: string | null;
  photographer_id?: string | null;
  package_profile_id?: string | null;
  local_school_id?: string | null;
  order_due_date?: string | null;
  access_mode?: string | null;
  access_pin?: string | null;
  email_required?: boolean | null;
  gallery_settings?: unknown;
};

type PackageRow = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items?: any[] | null;
  profile_id?: string | null;
  category?: string | null;
};

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

function slugify(value: string, fallback = "collection") {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function normalizedSchoolStatus(value: string | null | undefined) {
  return clean(value).toLowerCase().replaceAll("-", "_");
}

function looksLikeEmail(value: string | null | undefined) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
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
  const normalizedLower = normalizedClass.toLowerCase();
  const matchingCollections = (collectionRows ?? []).filter((row) => {
    const rowTitle = clean(row.title).toLowerCase();
    const rowSlug = clean(row.slug);
    return rowTitle === normalizedLower || rowSlug === targetSlug;
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
    .order("created_at", { ascending: true });

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

  return Array.from(uniqueRows.values()).map((row) => {
    const mediaUrls = buildStoredMediaUrls({
      storagePath: row.storage_path,
      previewUrl: row.preview_url,
      thumbnailUrl: row.thumbnail_url,
    });

    return {
      ...row,
      preview_url: mediaUrls.previewUrl || null,
      thumbnail_url: mediaUrls.thumbnailUrl || null,
      collection_title: collectionTitleById.get(clean(row.collection_id)) || normalizedClass,
    };
  });
}

export async function POST(request: NextRequest) {
  try {
    // Rate-limit PIN auth attempts per client IP so an attacker cannot grind
    // through PINs unnoticed. Window intentionally short so legitimate users
    // retry quickly.
    const clientIp = getClientIp(request);
    const limitResult = await rateLimit(clientIp, {
      namespace: "pin-auth-school",
      limit: 8,
      windowSeconds: 10,
    });
    if (!limitResult.allowed) {
      return NextResponse.json(
        { ok: false, message: "Too many attempts. Please wait a few seconds and try again." },
        {
          status: 429,
          headers: {
            "Retry-After": Math.max(1, Math.ceil((limitResult.resetAt - Date.now()) / 1000)).toString(),
          },
        },
      );
    }

    const body = (await request.json()) as {
      schoolId?: string;
      pin?: string;
      email?: string;
      // ✅ PERF: When true, also fetch packages/backdrops/photographer in
      // the same request so the gallery page can skip its own API call.
      prefetch?: boolean;
    };

    const selectedSchoolId = clean(body.schoolId);
    const selectedPin = clean(body.pin);
    const selectedEmail = clean(body.email).toLowerCase();
    const prefetch = body.prefetch === true;

    if (!selectedSchoolId) {
      return NextResponse.json({ ok: false, message: "Please choose your school." }, { status: 400 });
    }
    if (!selectedPin) {
      return NextResponse.json({ ok: false, message: "Please enter the PIN from your photo envelope." }, { status: 400 });
    }

    const service = createDashboardServiceClient();

    // Step 1: Validate school
    const { data: schoolRow, error: schoolError } = await service
      .from("schools")
      .select("id,school_name,status,expiration_date,photographer_id,package_profile_id,local_school_id,order_due_date,access_mode,access_pin,email_required,gallery_settings")
      .eq("id", selectedSchoolId)
      .maybeSingle();

    if (schoolError) throw schoolError;
    if (!schoolRow) {
      return NextResponse.json({ ok: false, message: "Please choose your school." }, { status: 404 });
    }

    const selectedSchool = schoolRow as SchoolRow & {
      photographer_id: string | null;
      package_profile_id: string | null;
      local_school_id: string | null;
      order_due_date: string | null;
    };

    if (selectedSchool.expiration_date && new Date(selectedSchool.expiration_date) < new Date()) {
      return NextResponse.json({ ok: false, step: "school_closed" }, { status: 409 });
    }

    if (normalizedSchoolStatus(selectedSchool.status) === "pre_release") {
      return NextResponse.json({ ok: false, step: "school_prerelease" }, { status: 409 });
    }

    if (!looksLikeEmail(selectedEmail)) {
      return NextResponse.json(
        { ok: false, message: "Please enter your email to open this gallery." },
        { status: 400 },
      );
    }

    // Step 2: Find same-name schools + validate PIN in parallel
    const selectedSchoolName = clean(selectedSchool.school_name);
    const [sameNameResult, pinResult] = await Promise.all([
      service
        .from("schools")
        .select("id")
        .ilike("school_name", selectedSchoolName),
      // ✅ PERF: We already have the school — look up the student PIN
      // scoped to the candidate school IDs (resolved below) but we can
      // start with just the selected school as an optimistic first check.
      service
        .from("students")
        .select("id,school_id,photo_url")
        .eq("pin", selectedPin)
        .eq("school_id", selectedSchoolId),
    ]);

    if (sameNameResult.error) throw sameNameResult.error;
    if (pinResult.error) throw pinResult.error;

    const candidateSchoolIds = Array.from(
      new Set([selectedSchoolId, ...(sameNameResult.data ?? []).map((row) => row.id)]),
    );

    // If direct school match found, use it; otherwise expand to same-name schools
    let matches = pinResult.data ?? [];
    if (!matches.length && candidateSchoolIds.length > 1) {
      const { data: broadMatches, error: broadError } = await service
        .from("students")
        .select("id,school_id,photo_url")
        .in("school_id", candidateSchoolIds)
        .eq("pin", selectedPin);

      if (broadError) throw broadError;
      matches = broadMatches ?? [];
    }

    if (!matches.length) {
      return NextResponse.json(
        { ok: false, message: "No gallery was found for that school and PIN." },
        { status: 404 },
      );
    }

    const best =
      matches.find((row) => row.school_id === selectedSchoolId && !!row.photo_url) ??
      matches.find((row) => !!row.photo_url) ??
      matches.find((row) => row.school_id === selectedSchoolId) ??
      matches[0];

    const resolvedSchoolId = best.school_id ?? selectedSchoolId;

    if (looksLikeEmail(selectedEmail)) {
      const { error: visitorError } = await service
        .from("school_gallery_visitors")
        .upsert(
          {
            school_id: resolvedSchoolId,
            viewer_email: selectedEmail,
            last_opened_at: new Date().toISOString(),
          },
          { onConflict: "school_id,viewer_email" },
        );

      if (visitorError && visitorError.code !== "42P01") {
        throw visitorError;
      }

      // Capture email for marketing — non-fatal, ignore duplicates
      try { await service.from("portal_email_captures").insert({ email: selectedEmail, school_id: resolvedSchoolId, source: "school_login" }); } catch { /* non-fatal */ }
    }

    // ─────────────────────────────────────────────────────────────────────
    // ✅ PERF: Prefetch gallery context in same request when requested.
    // This lets the gallery page skip its own API call entirely.
    // ─────────────────────────────────────────────────────────────────────
    let galleryContext: Record<string, unknown> | undefined;

    if (prefetch && selectedSchool.photographer_id) {
      try {
        // Resolve full student list for all candidate schools
        const [studentsResult, packagesResult, backdropsResult, photographerResult] =
          await Promise.all([
            service
              .from("students")
              .select("id,first_name,last_name,photo_url,class_id,school_id,class_name,folder_name,pin")
              .eq("pin", selectedPin)
              .in("school_id", candidateSchoolIds),
            service
              .from("packages")
              .select("id,name,description,price_cents,items,profile_id,category")
              .eq("photographer_id", selectedSchool.photographer_id)
              .eq("active", true)
              .order("price_cents", { ascending: true }),
            service
              .from("backdrop_catalog")
              .select("id,name,image_url,thumbnail_url,tier,price_cents,category,tags,sort_order")
              .eq("photographer_id", selectedSchool.photographer_id)
              .eq("active", true)
              .order("sort_order", { ascending: true }),
            service
              .from("photographers")
              .select("id,watermark_enabled,watermark_logo_url,logo_url,business_name,studio_address,studio_phone,studio_email,default_package_profile_id")
              .eq("id", selectedSchool.photographer_id)
              .maybeSingle(),
          ]);

        const studentCandidates = (studentsResult.data ?? []) as StudentRow[];
        const primaryStudent =
          studentCandidates.find((s) => s.school_id === resolvedSchoolId && !!s.photo_url) ??
          studentCandidates.find((s) => !!s.photo_url) ??
          studentCandidates.find((s) => s.school_id === resolvedSchoolId) ??
          studentCandidates[0] ??
          null;
        const mediaRows = (
          await loadFolderMediaRows(
            buildSchoolCandidateFolders({
              studentCandidates,
              activeSchool: selectedSchool,
              selectedSchoolId: resolvedSchoolId,
            }),
          )
        ).map((row) => ({
          ...row,
          collection_id: null,
          created_at: null,
          sort_order: null,
        }));
        const compositeRows = await loadSchoolCompositeMedia(
          service,
          selectedSchool,
          primaryStudent?.class_name,
        );

        const publicGallerySettings = sanitizeEventGallerySettingsForClient(
          selectedSchool.gallery_settings,
        );
        const photographerDefaultProfileId = ((photographerResult.data as Record<string, unknown> | null)?.default_package_profile_id as string | null) ?? null;
        const availablePackages = (packagesResult.data ?? []) as PackageRow[];
        const packageRows = filterPackagesForProfile(availablePackages, {
          selectedProfileId:
            selectedSchool.package_profile_id ||
            publicGallerySettings.extras.priceSheetProfileId ||
            photographerDefaultProfileId,
        }).packages;

        const photographer = photographerResult.data;
        const watermarkEnabled = photographer?.watermark_enabled !== false;
        const resolvedLogoUrl = looksLikeImageAssetUrl(photographer?.watermark_logo_url)
          ? photographer?.watermark_logo_url
          : looksLikeImageAssetUrl(photographer?.logo_url)
            ? photographer?.logo_url
            : "";
        const watermarkLogoUrl = resolvedLogoUrl || "";
        const studioInfo = {
          businessName: photographer?.business_name || "",
          logoUrl: resolvedLogoUrl || "",
          address: photographer?.studio_address || "",
          phone: photographer?.studio_phone || "",
          email: photographer?.studio_email || "",
        };

        const activeProject = {
          id: selectedSchool.id,
          portal_status: selectedSchool.status ?? null,
          order_due_date: selectedSchool.order_due_date ?? null,
          expiration_date: selectedSchool.expiration_date ?? null,
        };
        const downloadAccess = await buildSchoolGalleryDownloadAccess({
          service,
          schoolId: resolvedSchoolId,
          viewerEmail: selectedEmail,
          gallerySettings: selectedSchool.gallery_settings,
        });

        // Resolve the set of school rows needed by gallery-context consumers
        const { data: sameNameFull } = await service
          .from("schools")
          .select("id,school_name,photographer_id,package_profile_id,local_school_id,status,order_due_date,expiration_date,access_mode,access_pin,email_required,gallery_settings")
          .ilike("school_name", selectedSchoolName)
          .order("created_at", { ascending: false });

        galleryContext = {
          ok: true,
          currentSchool: selectedSchool,
          schoolRowsForMatch: sameNameFull ?? [selectedSchool],
          studentCandidates,
          primaryStudent,
          activeSchool: selectedSchool,
          activeProject,
          gallerySettings: publicGallerySettings,
          downloadAccess,
          media: mediaRows,
          composites: compositeRows,
          packages: packageRows,
          backdrops: backdropsResult.data ?? [],
          photographerId: photographer?.id ?? selectedSchool.photographer_id,
          watermarkEnabled,
          watermarkLogoUrl,
          studioInfo,
        };
      } catch (prefetchErr) {
        // Prefetch failure is non-fatal — gallery page will fetch on its own
        console.warn("[school-access] prefetch failed:", prefetchErr);
      }
    }

    return NextResponse.json({
      ok: true,
      schoolId: resolvedSchoolId,
      pin: selectedPin,
      ...(galleryContext ? { galleryContext } : {}),
    });
  } catch (error) {
    console.error("[school-access]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to check school access." },
      { status: 500 },
    );
  }
}

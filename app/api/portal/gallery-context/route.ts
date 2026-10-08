import { resolvePhotographerOrderCurrency, type OrderCurrency } from "@/lib/order-currency";
import { loadScopedSchoolCompositeMedia } from "@/lib/school-order-media";
import { schoolPreviewPresentation, buildSchoolFavoriteDownloadAccess } from "@/lib/school-portal-media";
import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import {
  sanitizeEventGallerySettingsForClient,
} from "@/lib/event-gallery-settings";
import { buildSchoolGalleryDownloadAccess } from "@/lib/school-gallery-downloads";
import { filterPackagesForProfile } from "@/lib/package-profile-selection";
import {
  buildSchoolCandidateFolders,
  loadFolderMediaRows,
  loadNoBgUrlMapForMediaRows,
} from "@/lib/storage-folder";
import { hasActiveSubscription } from "@/lib/subscription-gate";
import { applyCheckoutTaxFallbackToSettings } from "@/lib/checkout-tax";
import {
  SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS,
} from "@/lib/storage-images";
import { signBackdropRows } from "@/lib/backdrop-media-references";
import {
  signedPrivateMediaReference,
} from "@/lib/private-media-references";
import { hasCalendarBoundaryPassed } from "@/lib/calendar-dates";
import { isUuid } from "@/lib/r2-access-security";
import {
  clearOutOfScopeSchoolPhotoReferences,
  clearTombstonedSchoolPhotoReferences,
  loadSchoolPhotoTombstones,
  tombstoneFamilySet,
} from "@/lib/school-photo-deletions";

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
  portal_status?: string | null;
  order_due_date?: string | null;
  expiration_date?: string | null;
  access_mode?: string | null;
  access_pin?: string | null;
  email_required?: boolean | null;
  gallery_settings?: unknown;
  screenshot_protection_desktop?: boolean | null;
  screenshot_protection_mobile?: boolean | null;
  screenshot_protection_watermark?: boolean | null;
  group_label_singular?: string | null;
  group_label_plural?: string | null;
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
  /** When true the parents-portal exposes a Portrait/Landscape toggle on
   *  this backdrop.  Default false — every backdrop is portrait-only unless
   *  the photographer has explicitly opted in. */
  supports_landscape: boolean;
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

function looksLikeEmail(value: string | null | undefined) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

function normalizedSchoolStatus(value: string | null | undefined) {
  return clean(value).toLowerCase().replaceAll("-", "_");
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

async function loadSchoolCompositeMedia(service: ReturnType<typeof createDashboardServiceClient>, school: SchoolRow | null, className: string | null | undefined | Array<string | null | undefined>) {
  return loadScopedSchoolCompositeMedia(service, school, className);
}

export async function POST(request: NextRequest) {
  try {
    const limitResult = await rateLimit(getClientIp(request), {
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
            "Retry-After": Math.max(
              1,
              Math.ceil((limitResult.resetAt - Date.now()) / 1000),
            ).toString(),
          },
        },
      );
    }

    const { pin, schoolId, email } = (await request.json()) as {
      pin?: string;
      schoolId?: string;
      email?: string;
    };

    const selectedPin = clean(pin);
    const selectedSchoolId = clean(schoolId);
    const selectedEmail = clean(email).toLowerCase();

    if (!selectedPin || !isUuid(selectedSchoolId) || !looksLikeEmail(selectedEmail)) {
      return NextResponse.json(
        { ok: false, message: "School, PIN, and email are required." },
        { status: 400 },
      );
    }

    const service = createDashboardServiceClient();

    const { data: currentSchool, error: currentSchoolError } = selectedSchoolId
      ? await service
          .from("schools")
          .select("id,school_name,photographer_id,package_profile_id,local_school_id,status,portal_status,order_due_date,expiration_date,access_mode,access_pin,email_required,gallery_settings,screenshot_protection_desktop,screenshot_protection_mobile,screenshot_protection_watermark,group_label_singular,group_label_plural")
          .eq("id", selectedSchoolId)
          .maybeSingle<SchoolRow>()
      : { data: null as SchoolRow | null, error: null };

    if (currentSchoolError) throw currentSchoolError;
    if (!currentSchool) {
      return NextResponse.json(
        { ok: false, message: "Gallery not found." },
        { status: 404 },
      );
    }
    if (hasCalendarBoundaryPassed(currentSchool.expiration_date)) {
      return NextResponse.json(
        { ok: false, message: "This gallery is no longer available." },
        { status: 409 },
      );
    }
    if (
      normalizedSchoolStatus(currentSchool.portal_status ?? currentSchool.status) ===
      "pre_release"
    ) {
      return NextResponse.json(
        { ok: false, message: "This gallery is not available yet." },
        { status: 409 },
      );
    }

    // Keep the response shape expected by the portal while treating the
    // selected immutable school ID as the complete authorization boundary.
    const schoolRowsForMatch: SchoolRow[] = [currentSchool];

    const { data: studentRows, error: studentsError } = await service
      .from("students")
      .select("id,first_name,last_name,photo_url,class_id,school_id,class_name,folder_name,pin")
      .eq("pin", selectedPin)
      .eq("school_id", selectedSchoolId);

    if (studentsError) throw studentsError;

    const studentCandidates = (studentRows as StudentRow[] | null) ?? [];
    if (!studentCandidates.length) {
      return NextResponse.json(
        { ok: false, message: "Student not found for this PIN." },
        { status: 404 },
      );
    }

    const primaryStudent =
      studentCandidates.find((row) => !!row.photo_url) ?? studentCandidates[0];
    const activeSchool = currentSchool;
    if (hasCalendarBoundaryPassed(activeSchool.expiration_date)) {
      return NextResponse.json(
        { ok: false, message: "This gallery is no longer available." },
        { status: 409 },
      );
    }
    if (
      normalizedSchoolStatus(activeSchool.portal_status ?? activeSchool.status) ===
      "pre_release"
    ) {
      return NextResponse.json(
        { ok: false, message: "This gallery is not available yet." },
        { status: 409 },
      );
    }

    const tombstonedFamilies = tombstoneFamilySet(
      await loadSchoolPhotoTombstones(service, activeSchool.id),
    );
    const activeStudentCandidates = studentCandidates.filter(
      (student) => student.school_id === activeSchool.id,
    );
    const visibleStudentCandidates = clearTombstonedSchoolPhotoReferences(
      activeStudentCandidates,
      tombstonedFamilies,
    );
    const scopedVisibleStudentCandidates =
      clearOutOfScopeSchoolPhotoReferences(
        visibleStudentCandidates,
        activeSchool,
      );
    const visiblePrimaryStudent =
      scopedVisibleStudentCandidates.find(
        (student) => student.id === primaryStudent.id,
      ) ?? scopedVisibleStudentCandidates[0];

    const activeProject: ProjectRow | null = activeSchool
      ? {
          id: activeSchool.id,
          portal_status: activeSchool.portal_status ?? activeSchool.status ?? null,
          order_due_date: activeSchool.order_due_date ?? null,
          expiration_date: activeSchool.expiration_date ?? null,
        }
      : null;
    let publicGallerySettings = sanitizeEventGallerySettingsForClient(
      activeSchool?.gallery_settings,
    );
    const downloadAccess = activeSchool
      ? await buildSchoolGalleryDownloadAccess({
          service,
          schoolId: activeSchool.id,
          viewerEmail: selectedEmail,
          gallerySettings: activeSchool.gallery_settings,
          classId: primaryStudent.class_id,
          className: primaryStudent.class_name,
        })
      : undefined;

    let packageRows: PackageRow[] = [];
    let backdropRows: BackdropRow[] = [];
    let compositeRows: CompositeMediaRow[] = [];
    let mediaRows: CompositeMediaRow[] = [];
    let nobgUrls: Record<string, string> = {};
    let photographerId: string | null = activeSchool?.photographer_id ?? null;
    let watermarkEnabled = true;
    let watermarkLogoUrl = "";
    let orderCurrency: OrderCurrency = "cad";
    let studioInfo = {
      businessName: "",
      logoUrl: "",
      address: "",
      phone: "",
      email: "",
    };
    let lateOrderPolicy = {
      orderDueDate: activeSchool?.order_due_date ?? null,
      shippingFeeCents: 0,
      lateHandlingFeePercent: 0,
    };

    if (activeSchool?.photographer_id) {
      const [packagesResult, backdropsResult, photographerResult] = await Promise.all([
        service
          .from("packages")
          .select("id,name,description,price_cents,items,profile_id,category,is_retouch_addon")
          .eq("photographer_id", activeSchool.photographer_id)
          .eq("active", true)
          .order("price_cents", { ascending: true }),
        service
          .from("backdrop_catalog")
          .select("id,name,image_url,thumbnail_url,tier,price_cents,category,tags,sort_order,supports_landscape")
          .eq("photographer_id", activeSchool.photographer_id)
          .eq("active", true)
          .order("sort_order", { ascending: true }),
        service
          .from("photographers")
          .select("id,watermark_enabled,watermark_logo_url,logo_url,business_name,studio_address,studio_phone,studio_email,default_package_profile_id,is_platform_admin,subscription_status,trial_starts_at,trial_ends_at,created_at,shipping_fee_cents,late_handling_fee_percent,billing_currency")
          .eq("id", activeSchool.photographer_id)
          .maybeSingle(),
      ]);

      if (packagesResult.error) throw packagesResult.error;
      if (backdropsResult.error) throw backdropsResult.error;
      if (photographerResult.error) throw photographerResult.error;
      const resolvedCurrency = resolvePhotographerOrderCurrency(photographerResult.data?.billing_currency);
      if (!resolvedCurrency) {
        return NextResponse.json({ ok: false, message: "This studio’s sales currency is not supported. Please contact the photographer." }, { status: 409 });
      }
      orderCurrency = resolvedCurrency;

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
      const { data: taxRow, error: taxError } = await service
        .from("photographers")
        .select("tax_enabled,tax_percent,tax_label,tax_country,tax_rates_by_country")
        .eq("id", activeSchool.photographer_id)
        .maybeSingle();
      if (!taxError) {
        publicGallerySettings = applyCheckoutTaxFallbackToSettings(
          publicGallerySettings,
          (taxRow as Record<string, unknown> | null) ?? null,
        );
      }
      const availablePackages = (packagesResult.data ?? []) as PackageRow[];
      packageRows = filterPackagesForProfile(availablePackages, {
        selectedProfileId:
          activeSchool.package_profile_id ||
          publicGallerySettings.extras.priceSheetProfileId ||
          photographerDefaultProfileId,
      }).packages;
      backdropRows = signBackdropRows(
        (backdropsResult.data ?? []) as BackdropRow[],
        SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS,
      );

      const photographer = photographerResult.data;
      if (photographer) {
        photographerId = photographer.id ?? photographerId;
        watermarkEnabled = photographer.watermark_enabled !== false;
        const watermarkLogoCandidate = signedPrivateMediaReference(
          photographer.watermark_logo_url,
          SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS,
        );
        const studioLogoCandidate = signedPrivateMediaReference(
          photographer.logo_url,
          SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS,
        );
        const resolvedLogoUrl = looksLikeImageAssetUrl(watermarkLogoCandidate)
          ? watermarkLogoCandidate
          : looksLikeImageAssetUrl(studioLogoCandidate)
            ? studioLogoCandidate
            : "";
        watermarkLogoUrl = resolvedLogoUrl || "";
        studioInfo = {
          businessName: photographer.business_name || "",
          logoUrl: resolvedLogoUrl || "",
          address: photographer.studio_address || "",
          phone: photographer.studio_phone || "",
          email: photographer.studio_email || "",
        };
        lateOrderPolicy = {
          orderDueDate: activeSchool.order_due_date ?? null,
          shippingFeeCents: Math.max(
            0,
            Number((photographer as { shipping_fee_cents?: number | null }).shipping_fee_cents ?? 0) || 0,
          ),
          lateHandlingFeePercent: Math.max(
            0,
            Number((photographer as { late_handling_fee_percent?: number | null }).late_handling_fee_percent ?? 0) || 0,
          ),
        };
      }
    }

    compositeRows = await loadSchoolCompositeMedia(
      service,
      activeSchool,
      [primaryStudent.class_name, primaryStudent.folder_name],
    );
    const loadedMediaRows = await loadFolderMediaRows(
      buildSchoolCandidateFolders({
        studentCandidates: activeStudentCandidates,
        activeSchool,
        selectedSchoolId: activeSchool.id,
      }),
      {
        service,
        schoolId: activeSchool.id,
        tombstonedFamilies,
        ttlSeconds: SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS,
      },
    );
    nobgUrls = await loadNoBgUrlMapForMediaRows(loadedMediaRows, {
      ttlSeconds: SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS,
      service, photographerId: activeSchool.photographer_id,
    });
    mediaRows = loadedMediaRows.map((row) => ({
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

    // 2026-04-26: per-school grouping label (Class / Faculty / Grade /
    // Department).  Surfaced at a stable top-level key so the portal
    // can swap "Class:" → "Faculty:" without re-running the school join.
    const groupLabel = {
      singular:
        (typeof activeSchool?.group_label_singular === "string" &&
          activeSchool.group_label_singular.trim()) ||
        "Class",
      plural:
        (typeof activeSchool?.group_label_plural === "string" &&
          activeSchool.group_label_plural.trim()) ||
        "Classes",
    };

    const presentation = schoolPreviewPresentation({ school: activeSchool, students: activeStudentCandidates, visibleStudents: scopedVisibleStudentCandidates, email: selectedEmail, media: mediaRows, composites: compositeRows, nobgUrls });
    const signedStudentCandidates = presentation.students;
    const signedPrimaryStudent = signedStudentCandidates.find(row => row.id === visiblePrimaryStudent.id) ?? null;
    const favoriteDownloadAccess = await buildSchoolFavoriteDownloadAccess(service, activeSchool, activeStudentCandidates, selectedEmail);

    return NextResponse.json({
      ok: true,
      currentSchool: { ...currentSchool, gallery_settings: publicGallerySettings },
      schoolRowsForMatch: schoolRowsForMatch.map(row => ({ ...row, gallery_settings: publicGallerySettings })),
      studentCandidates: signedStudentCandidates,
      primaryStudent: signedPrimaryStudent,
      activeSchool: { ...activeSchool, gallery_settings: publicGallerySettings },
      activeProject,
      gallerySettings: publicGallerySettings,
      downloadAccess,
      media: presentation.media,
      composites: presentation.composites,
      packages: packageRows,
      backdrops: backdropRows,
      nobgUrls: presentation.nobgUrls,
      favoriteDownloadAccess,
      photographerId,
      watermarkEnabled,
      watermarkLogoUrl,
      studioInfo,
      orderCurrency,
      lateOrderPolicy,
      screenshotProtection,
      groupLabel,
    }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("[gallery-context]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to load gallery context." },
      { status: 500 },
    );
  }
}

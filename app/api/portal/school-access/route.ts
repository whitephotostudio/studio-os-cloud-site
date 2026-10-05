import { loadScopedSchoolCompositeMedia } from "@/lib/school-order-media";
import { schoolPreviewPresentation, buildSchoolFavoriteDownloadAccess } from "@/lib/school-portal-media";
import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import {
  sanitizeEventGallerySettingsForClient,
} from "@/lib/event-gallery-settings";
import { applyCheckoutTaxFallbackToSettings } from "@/lib/checkout-tax";
import { buildSchoolGalleryDownloadAccess } from "@/lib/school-gallery-downloads";
import {
  SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS,
} from "@/lib/storage-images";
import { signBackdropRows } from "@/lib/backdrop-media-references";
import {
  signedPrivateMediaReference,
} from "@/lib/private-media-references";
import { filterPackagesForProfile } from "@/lib/package-profile-selection";
import {
  buildSchoolCandidateFolders,
  loadFolderMediaRows,
  loadNoBgUrlMapForMediaRows,
} from "@/lib/storage-folder";
import { hasCalendarBoundaryPassed } from "@/lib/calendar-dates";
import {
  clearOutOfScopeSchoolPhotoReferences,
  clearTombstonedSchoolPhotoReferences,
  loadSchoolPhotoTombstones,
  tombstoneFamilySet,
} from "@/lib/school-photo-deletions";

export const dynamic = "force-dynamic";

type SchoolRow = {
  id: string;
  school_name: string;
  status: string | null;
  portal_status?: string | null;
  expiration_date: string | null;
  photographer_id?: string | null;
  package_profile_id?: string | null;
  local_school_id?: string | null;
  order_due_date?: string | null;
  access_mode?: string | null;
  access_pin?: string | null;
  email_required?: boolean | null;
  registration_class_required?: boolean | null;
  gallery_settings?: unknown;
  screenshot_protection_desktop?: boolean | null;
  screenshot_protection_mobile?: boolean | null;
  screenshot_protection_watermark?: boolean | null;
  group_label_singular?: string | null;
  group_label_plural?: string | null;
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


function clean(value: string | null | undefined) {
  return (value ?? "").trim();
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

async function loadSchoolCompositeMedia(service: ReturnType<typeof createDashboardServiceClient>, school: SchoolRow | null, className: string | null | undefined | Array<string | null | undefined>) {
  return loadScopedSchoolCompositeMedia(service, school, className);
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

    const service = createDashboardServiceClient();

    // Step 1: Validate school
    const { data: schoolRow, error: schoolError } = await service
      .from("schools")
      .select("id,school_name,status,portal_status,expiration_date,photographer_id,package_profile_id,local_school_id,order_due_date,access_mode,access_pin,email_required,registration_class_required,gallery_settings,screenshot_protection_desktop,screenshot_protection_mobile,screenshot_protection_watermark,group_label_singular,group_label_plural")
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

    if (hasCalendarBoundaryPassed(selectedSchool.expiration_date)) {
      return NextResponse.json({ ok: false, step: "school_closed" }, { status: 409 });
    }

    const selectedSchoolStatus = selectedSchool.portal_status ?? selectedSchool.status;

    if (normalizedSchoolStatus(selectedSchoolStatus) === "pre_release") {
      return NextResponse.json({ ok: false, step: "school_prerelease", registrationClassRequired: selectedSchool.registration_class_required === true }, { status: 409 });
    }

    if (!selectedPin) {
      return NextResponse.json({ ok: false, message: "Please enter the PIN from your photo envelope." }, { status: 400 });
    }

    if (!looksLikeEmail(selectedEmail)) {
      return NextResponse.json(
        { ok: false, message: "Please enter your email to open this gallery." },
        { status: 400 },
      );
    }

    // Step 2: A PIN only authorizes the immutable school selected by the
    // visitor. School names are presentation data and must never widen this
    // boundary, even when the photographer has two schools with the same name.
    const pinResult = await service
      .from("students")
      .select("id,school_id,photo_url")
      .eq("pin", selectedPin)
      .eq("school_id", selectedSchoolId);

    if (pinResult.error) throw pinResult.error;

    const matches = pinResult.data ?? [];

    if (!matches.length) {
      return NextResponse.json(
        { ok: false, message: "No gallery was found for that school and PIN." },
        { status: 404 },
      );
    }

    const resolvedSchoolId = selectedSchoolId;

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

    const gallerySchool = selectedSchool;

    if (hasCalendarBoundaryPassed(gallerySchool.expiration_date)) {
      return NextResponse.json(
        { ok: false, step: "school_closed" },
        { status: 409 },
      );
    }
    if (
      normalizedSchoolStatus(gallerySchool.portal_status ?? gallerySchool.status) ===
      "pre_release"
    ) {
      return NextResponse.json(
        { ok: false, step: "school_prerelease", registrationClassRequired: selectedSchool.registration_class_required === true },
        { status: 409 },
      );
    }

    const gallerySchoolStatus = gallerySchool.portal_status ?? gallerySchool.status;

    // The PIN query above is scoped to this immutable school. Only a unique
    // match can establish an email/student association. Never overwrite the
    // roster's parent_email, which is also used by PIN recovery.
    if (matches.length === 1 && selectedSchool.registration_class_required === true) {
      try {
        const { error: contactError } = await service.from("school_student_email_contacts").upsert({
          school_id: selectedSchoolId,
          student_id: matches[0].id,
          email: selectedEmail,
          last_verified_at: new Date().toISOString(),
        }, { onConflict: "student_id,email" });
        if (contactError) throw contactError;
      } catch {
        console.error("[school-access] Class notification contact was not saved; gallery access continues.");
      }
    }

    if (prefetch && gallerySchool.photographer_id) {
      try {
        // Resolve every matching student record inside the selected school.
        const [studentsResult, packagesResult, backdropsResult, photographerResult] =
          await Promise.all([
            service
              .from("students")
              .select("id,first_name,last_name,photo_url,class_id,school_id,class_name,folder_name,pin")
              .eq("pin", selectedPin)
              .eq("school_id", selectedSchoolId),
            service
              .from("packages")
              .select("id,name,description,price_cents,items,profile_id,category,is_retouch_addon")
              .eq("photographer_id", gallerySchool.photographer_id)
              .eq("active", true)
              .order("price_cents", { ascending: true }),
            service
              .from("backdrop_catalog")
              .select("id,name,image_url,thumbnail_url,tier,price_cents,category,tags,sort_order,supports_landscape")
              .eq("photographer_id", gallerySchool.photographer_id)
              .eq("active", true)
              .order("sort_order", { ascending: true }),
            service
              .from("photographers")
              .select("id,watermark_enabled,watermark_logo_url,logo_url,business_name,studio_address,studio_phone,studio_email,default_package_profile_id")
              .eq("id", gallerySchool.photographer_id)
              .maybeSingle(),
          ]);

        const studentCandidates = (studentsResult.data ?? []) as StudentRow[];
        const resolvedStudentCandidates = studentCandidates.filter(
          (student) => student.school_id === resolvedSchoolId,
        );
        const tombstonedFamilies = tombstoneFamilySet(
          await loadSchoolPhotoTombstones(service, resolvedSchoolId),
        );
        const visibleStudentCandidates = clearTombstonedSchoolPhotoReferences(
          resolvedStudentCandidates,
          tombstonedFamilies,
        );
        const scopedVisibleStudentCandidates =
          clearOutOfScopeSchoolPhotoReferences(
            visibleStudentCandidates,
            gallerySchool,
          );
        const primaryStudent =
          scopedVisibleStudentCandidates.find(
            (s) => s.school_id === resolvedSchoolId && !!s.photo_url,
          ) ??
          scopedVisibleStudentCandidates.find((s) => !!s.photo_url) ??
          scopedVisibleStudentCandidates.find(
            (s) => s.school_id === resolvedSchoolId,
          ) ??
          scopedVisibleStudentCandidates[0] ??
          null;
        const mediaRowsResult = await loadFolderMediaRows(
          buildSchoolCandidateFolders({
            studentCandidates: resolvedStudentCandidates,
            activeSchool: gallerySchool,
            selectedSchoolId: resolvedSchoolId,
          }),
          {
            service,
            schoolId: resolvedSchoolId,
            tombstonedFamilies,
            ttlSeconds: SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS,
          },
        );
        const noBgUrls = await loadNoBgUrlMapForMediaRows(mediaRowsResult, {
          ttlSeconds: SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS,
          service, photographerId: gallerySchool.photographer_id,
        });
        const mediaRows = mediaRowsResult.map((row) => ({
          ...row,
          collection_id: null,
          created_at: null,
          sort_order: null,
        }));
        const compositeRows = await loadSchoolCompositeMedia(
          service,
          gallerySchool,
          [primaryStudent?.class_name, primaryStudent?.folder_name],
        );

        let publicGallerySettings = sanitizeEventGallerySettingsForClient(
          gallerySchool.gallery_settings,
        );
        const photographerDefaultProfileId = ((photographerResult.data as Record<string, unknown> | null)?.default_package_profile_id as string | null) ?? null;
        const availablePackages = (packagesResult.data ?? []) as PackageRow[];
        const packageRows = filterPackagesForProfile(availablePackages, {
          selectedProfileId:
            gallerySchool.package_profile_id ||
            publicGallerySettings.extras.priceSheetProfileId ||
            photographerDefaultProfileId,
        }).packages;

        const photographer = photographerResult.data;
        const { data: taxRow, error: taxError } = await service
          .from("photographers")
          .select("tax_enabled,tax_percent,tax_label,tax_country,tax_rates_by_country")
          .eq("id", gallerySchool.photographer_id)
          .maybeSingle();
        if (!taxError) {
          publicGallerySettings = applyCheckoutTaxFallbackToSettings(
            publicGallerySettings,
            (taxRow as Record<string, unknown> | null) ?? null,
          );
        }
        const watermarkEnabled = photographer?.watermark_enabled !== false;
        const watermarkLogoCandidate = signedPrivateMediaReference(
          photographer?.watermark_logo_url,
          SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS,
        );
        const studioLogoCandidate = signedPrivateMediaReference(
          photographer?.logo_url,
          SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS,
        );
        const resolvedLogoUrl = looksLikeImageAssetUrl(watermarkLogoCandidate)
          ? watermarkLogoCandidate
          : looksLikeImageAssetUrl(studioLogoCandidate)
            ? studioLogoCandidate
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
          id: gallerySchool.id,
          portal_status: gallerySchoolStatus ?? null,
          order_due_date: gallerySchool.order_due_date ?? null,
          expiration_date: gallerySchool.expiration_date ?? null,
        };
        const downloadAccess = await buildSchoolGalleryDownloadAccess({
          service,
          schoolId: resolvedSchoolId,
          viewerEmail: selectedEmail,
          gallerySettings: gallerySchool.gallery_settings,
          classId: primaryStudent?.class_id,
          className: primaryStudent?.class_name,
        });

        // 2026-04-26: Mirror gallery-context's response shape for the
        // screenshot protection flags.  Without this the prefetch
        // payload would be missing them, and the parents page (which
        // reads from the cache before falling through to its own
        // gallery-context call) would default the flags to all-false.
        // Symptom Harout flagged: "screen protection doesn't work till
        // I refresh Safari" — refresh consumed the cache and forced a
        // fresh fetch that DID include the flags.  Same root cause as
        // the missing supports_landscape on backdrops above.
        const screenshotProtection = {
          desktop: Boolean(
            (gallerySchool as Record<string, unknown>).screenshot_protection_desktop,
          ),
          mobile: Boolean(
            (gallerySchool as Record<string, unknown>).screenshot_protection_mobile,
          ),
          watermark: Boolean(
            (gallerySchool as Record<string, unknown>).screenshot_protection_watermark,
          ),
        };

        // 2026-04-26: per-school grouping label, mirrored from gallery-
        // context so the prefetch cache lands fresh on the parents page.
        const schoolForLabel = gallerySchool as Record<string, unknown>;
        const groupLabel = {
          singular:
            (typeof schoolForLabel.group_label_singular === "string" &&
              (schoolForLabel.group_label_singular as string).trim()) ||
            "Class",
          plural:
            (typeof schoolForLabel.group_label_plural === "string" &&
              (schoolForLabel.group_label_plural as string).trim()) ||
            "Classes",
        };

        const presentation = schoolPreviewPresentation({ school: gallerySchool, students: resolvedStudentCandidates, visibleStudents: scopedVisibleStudentCandidates, email: selectedEmail, media: mediaRows, composites: compositeRows, nobgUrls: noBgUrls });
        const signedStudentCandidates = presentation.students;
        const signedPrimaryStudent = signedStudentCandidates.find(row => row.id === primaryStudent?.id) ?? null;
        const favoriteDownloadAccess = await buildSchoolFavoriteDownloadAccess(service, gallerySchool, resolvedStudentCandidates, selectedEmail);

        galleryContext = {
          ok: true,
          currentSchool: { ...selectedSchool, gallery_settings: publicGallerySettings },
          schoolRowsForMatch: [{ ...gallerySchool, gallery_settings: publicGallerySettings }],
          studentCandidates: signedStudentCandidates,
          primaryStudent: signedPrimaryStudent,
          activeSchool: { ...gallerySchool, gallery_settings: publicGallerySettings },
          activeProject,
          gallerySettings: publicGallerySettings,
          downloadAccess,
          media: presentation.media,
          composites: presentation.composites,
          packages: packageRows,
          backdrops: signBackdropRows(
            backdropsResult.data ?? [],
            SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS,
          ),
          nobgUrls: presentation.nobgUrls,
          favoriteDownloadAccess,
          photographerId: photographer?.id ?? gallerySchool.photographer_id,
          watermarkEnabled,
          watermarkLogoUrl,
          studioInfo,
          screenshotProtection,
          groupLabel,
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

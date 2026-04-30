import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import {
  normalizeEventGallerySettings,
  sanitizeEventGallerySettingsForClient,
} from "@/lib/event-gallery-settings";
import {
  buildSignedMediaUrls,
  SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS,
} from "@/lib/storage-images";
import { filterPackagesForProfile } from "@/lib/package-profile-selection";
import { hasActiveSubscription } from "@/lib/subscription-gate";

export const dynamic = "force-dynamic";

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

type ProjectRow = {
  id: string;
  title: string | null;
  client_name: string | null;
  workflow_type: string | null;
  status: string | null;
  portal_status: string | null;
  event_date: string | null;
  shoot_date: string | null;
  order_due_date: string | null;
  expiration_date: string | null;
  email_required: boolean | null;
  photographer_id: string | null;
  package_profile_id: string | null;
  access_mode: string | null;
  access_pin: string | null;
  cover_photo_url: string | null;
  gallery_settings: unknown;
  screenshot_protection_desktop?: boolean | null;
  screenshot_protection_mobile?: boolean | null;
  screenshot_protection_watermark?: boolean | null;
};

type CollectionRow = {
  id: string;
  title: string | null;
  slug: string | null;
  kind: string | null;
  access_mode: string | null;
  access_pin: string | null;
  cover_photo_url: string | null;
  sort_order: number | null;
  created_at: string | null;
};

type MediaRow = {
  id: string;
  collection_id: string | null;
  storage_path: string | null;
  preview_url: string | null;
  thumbnail_url: string | null;
  download_url?: string | null;
  filename: string | null;
  created_at: string | null;
  sort_order: number | null;
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

type PhotographerRow = {
  id: string;
  watermark_enabled: boolean | null;
  watermark_logo_url: string | null;
  logo_url: string | null;
  business_name: string | null;
  studio_address: string | null;
  studio_phone: string | null;
  studio_email: string | null;
  is_platform_admin?: boolean | null;
  subscription_status?: string | null;
  trial_starts_at?: string | null;
  trial_ends_at?: string | null;
  created_at?: string | null;
};

type OrderRow = {
  id: string;
  package_id: string | null;
  package_name: string | null;
  status: string | null;
  parent_email: string | null;
  customer_email: string | null;
};

type PurchasedPackageRow = {
  id: string;
  name: string | null;
  description: string | null;
  category: string | null;
};

type FavoriteDownloadAccess = {
  enabled: boolean;
  requiresAllDigitalsPurchase: boolean;
  hasPaidDigitalOrder: boolean;
  hasPurchasedAllDigitals: boolean;
  canDownload: boolean;
  message: string | null;
};

type DownloadAccess = {
  enabled: boolean;
  audience: "gallery" | "album" | "person";
  resolution: "original" | "large" | "web";
  downloadLimit: "unlimited" | "10" | "5" | "1";
  requiresPin: boolean;
  hasPinConfigured: boolean;
  downloadsUsed: number;
  downloadsRemaining: number | null;
  canDownload: boolean;
  message: string | null;
};

type DownloadLogRow = {
  download_count: number | null;
};

function normalizedAccessMode(value: string | null | undefined) {
  const raw = clean(value).toLowerCase();
  if (!raw) return "public";
  if (raw === "pin" || raw === "protected" || raw === "private") return "pin";
  if (raw === "inherit" || raw === "inherit_project" || raw === "project") return "inherit_project";
  return raw;
}

function isInactive(value: string | null | undefined) {
  return clean(value).toLowerCase() === "inactive";
}

function isEventProject(row: Pick<ProjectRow, "workflow_type">) {
  return clean(row.workflow_type).toLowerCase() === "event";
}

function matchesProjectPin(row: Pick<ProjectRow, "access_mode" | "access_pin">, pin: string) {
  return normalizedAccessMode(row.access_mode) === "pin" && clean(row.access_pin) === pin;
}

function matchesCollectionPin(row: Pick<CollectionRow, "slug" | "access_mode" | "access_pin">, pin: string) {
  return clean(row.slug) === pin || (normalizedAccessMode(row.access_mode) === "pin" && clean(row.access_pin) === pin);
}

function isMissingVisitorsTable(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "42P01"
  );
}

function isMissingDownloadsTable(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "42P01"
  );
}

function isPaidOrderStatus(value: string | null | undefined) {
  const normalized = clean(value).toLowerCase();
  return (
    normalized === "paid" ||
    normalized === "digital_paid" ||
    normalized === "ready" ||
    normalized === "printed"
  );
}

function isDigitalPackageText(...values: Array<string | null | undefined>) {
  const haystack = values.map((value) => clean(value).toLowerCase()).join(" ");
  return /digital|download|downloads|file|files|jpeg|jpg/.test(haystack);
}

function isAllDigitalsText(...values: Array<string | null | undefined>) {
  const haystack = values.map((value) => clean(value).toLowerCase()).join(" ");
  return (
    /(all|full|entire|complete)\s+(digital|digitals|downloads|files|gallery|album|collection|photos|images)/.test(
      haystack,
    ) ||
    /(digital|downloads|files)\s+(all|full|entire|complete)/.test(haystack) ||
    /buy all/.test(haystack)
  );
}

export async function POST(request: NextRequest) {
  try {
    const { projectId, email, pin } = (await request.json()) as {
      projectId?: string;
      email?: string;
      pin?: string;
    };

    const selectedProjectId = clean(projectId);
    const normalizedEmail = clean(email).toLowerCase();
    const pinValue = clean(pin);

    if (!selectedProjectId) {
      return NextResponse.json(
        { ok: false, message: "Missing event project." },
        { status: 400 },
      );
    }
    if (!normalizedEmail) {
      return NextResponse.json(
        { ok: false, message: "Missing event email." },
        { status: 400 },
      );
    }
    if (!pinValue) {
      return NextResponse.json(
        { ok: false, message: "Missing event access PIN." },
        { status: 400 },
      );
    }

    const service = createDashboardServiceClient();

    const { data: projectRow, error: projectError } = await service
      .from("projects")
      .select(
        "id,title,client_name,workflow_type,status,portal_status,event_date,shoot_date,order_due_date,expiration_date,email_required,photographer_id,package_profile_id,access_mode,access_pin,cover_photo_url,gallery_settings,screenshot_protection_desktop,screenshot_protection_mobile,screenshot_protection_watermark",
      )
      .eq("id", selectedProjectId)
      .maybeSingle<ProjectRow>();

    if (projectError) throw projectError;
    if (!projectRow || !isEventProject(projectRow) || isInactive(projectRow.status)) {
      return NextResponse.json(
        { ok: false, message: "Event gallery not found." },
        { status: 404 },
      );
    }

    const { data: whitelistRows, error: whitelistError } = await service
      .from("pre_release_emails")
      .select("id")
      .eq("project_id", selectedProjectId)
      .eq("email", normalizedEmail)
      .limit(1);

    if (whitelistError) throw whitelistError;

    const emailRequired = projectRow.email_required !== false;
    if (emailRequired && (whitelistRows?.length ?? 0) === 0) {
      const { data: anyWhitelist, error: anyWhitelistError } = await service
        .from("pre_release_emails")
        .select("id")
        .eq("project_id", selectedProjectId)
        .limit(1);

      if (anyWhitelistError) throw anyWhitelistError;

      if ((anyWhitelist?.length ?? 0) > 0) {
        return NextResponse.json(
          {
            ok: false,
            message: "That email is not approved for this event gallery.",
          },
          { status: 403 },
        );
      }
    }

    const [matchingSubjectResult, collectionRowsResult] = await Promise.all([
      service
        .from("subjects")
        .select("id")
        .eq("project_id", selectedProjectId)
        .eq("external_ref", pinValue)
        .limit(1)
        .maybeSingle(),
      service
        .from("collections")
        .select(
          "id,title,slug,kind,access_mode,access_pin,cover_photo_url,sort_order,created_at",
        )
        .eq("project_id", selectedProjectId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);

    if (matchingSubjectResult.error) throw matchingSubjectResult.error;
    if (collectionRowsResult.error) throw collectionRowsResult.error;

    const allCollections = (collectionRowsResult.data ?? []) as CollectionRow[];
    const matchingCollection = allCollections.find((row) =>
      matchesCollectionPin(row, pinValue),
    ) ?? null;
    const projectPinMatch = matchesProjectPin(projectRow, pinValue);

    if (!projectPinMatch && !matchingSubjectResult.data && !matchingCollection) {
      return NextResponse.json(
        { ok: false, message: "No event gallery was found for that email and PIN." },
        { status: 404 },
      );
    }

    const { error: visitorError } = await service
      .from("event_gallery_visitors")
      .upsert(
        {
          project_id: selectedProjectId,
          viewer_email: normalizedEmail,
          last_opened_at: new Date().toISOString(),
        },
        {
          onConflict: "project_id,viewer_email",
        },
      );

    if (visitorError && !isMissingVisitorsTable(visitorError)) {
      throw visitorError;
    }

    const scopedCollections = matchingCollection?.id
      ? allCollections.filter((row) => row.id === matchingCollection.id)
      : allCollections;

    const collections = scopedCollections.filter((row) => {
      const kind = clean(row.kind).toLowerCase();
      return kind === "album" || kind === "gallery" || !kind;
    });

    const collectionIds = collections
      .map((row) => clean(row.id))
      .filter((value) => value.length > 0);

    let mediaRows: MediaRow[] = [];
    if (collectionIds.length > 0) {
      // Safety limit: cap at 5000 media items to prevent unbounded queries.
      // Galleries with more than 5000 photos should use paginated loading.
      const { data: mediaData, error: mediaError } = await service
        .from("media")
        .select(
          "id,collection_id,storage_path,preview_url,thumbnail_url,filename,created_at,sort_order",
        )
        .eq("project_id", selectedProjectId)
        .in("collection_id", collectionIds)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(5000);

      if (mediaError) throw mediaError;
      // 2026-04-30 — Parents portal sessions stay open for hours
      // during shopping/checkout, so we sign with a 6-hour TTL.
      mediaRows = ((mediaData ?? []) as MediaRow[]).map((row) => {
        const mediaUrls = buildSignedMediaUrls({
          storagePath: row.storage_path,
          previewUrl: row.preview_url,
          thumbnailUrl: row.thumbnail_url,
        }, { ttlSeconds: SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS });

        return {
          ...row,
          download_url: mediaUrls.originalUrl || null,
          preview_url: mediaUrls.previewUrl || null,
          thumbnail_url: mediaUrls.thumbnailUrl || null,
        };
      });
    }

    const normalizedGallerySettings = normalizeEventGallerySettings(
      projectRow.gallery_settings,
    );
    const publicGallerySettings = sanitizeEventGallerySettingsForClient(
      projectRow.gallery_settings,
    );
    let packages: PackageRow[] = [];
    let watermarkEnabled = true;
    let watermarkLogoUrl = "";
    let favoriteDownloadAccess: FavoriteDownloadAccess = {
      enabled: normalizedGallerySettings.extras.allowClientFavoriteDownloads,
      requiresAllDigitalsPurchase:
        normalizedGallerySettings.extras.favoriteDownloadsRequireAllDigitalsPurchase,
      hasPaidDigitalOrder: false,
      hasPurchasedAllDigitals: false,
      canDownload: normalizedGallerySettings.extras.allowClientFavoriteDownloads,
      message: normalizedGallerySettings.extras.allowClientFavoriteDownloads
        ? null
        : "Favorites download is turned off for this gallery.",
    };
    let downloadAccess: DownloadAccess = {
      enabled:
        normalizedGallerySettings.extras.freeDigitalRuleEnabled &&
        normalizedGallerySettings.extras.showDownloadAllButton,
      audience: normalizedGallerySettings.extras.freeDigitalAudience,
      resolution: normalizedGallerySettings.extras.freeDigitalResolution,
      downloadLimit: normalizedGallerySettings.extras.freeDigitalDownloadLimit,
      requiresPin: normalizedGallerySettings.extras.downloadPinEnabled,
      hasPinConfigured:
        clean(normalizedGallerySettings.extras.downloadPin).length > 0,
      downloadsUsed: 0,
      downloadsRemaining:
        normalizedGallerySettings.extras.freeDigitalDownloadLimit === "unlimited"
          ? null
          : Math.max(
              0,
              Number.parseInt(
                normalizedGallerySettings.extras.freeDigitalDownloadLimit,
                10,
              ) || 0,
            ),
      canDownload:
        normalizedGallerySettings.extras.freeDigitalRuleEnabled &&
        normalizedGallerySettings.extras.showDownloadAllButton &&
        (!normalizedGallerySettings.extras.downloadPinEnabled ||
          clean(normalizedGallerySettings.extras.downloadPin).length > 0),
      message:
        normalizedGallerySettings.extras.freeDigitalRuleEnabled &&
        normalizedGallerySettings.extras.showDownloadAllButton
          ? normalizedGallerySettings.extras.downloadPinEnabled &&
            !clean(normalizedGallerySettings.extras.downloadPin)
            ? 'A "Download All" PIN needs to be set in Gallery Settings first.'
            : null
          : "Gallery downloads are turned off for this event.",
    };
    let studioInfo = {
      businessName: "",
      logoUrl: "",
      address: "",
      phone: "",
      email: "",
    };

    if (projectRow.photographer_id) {
      const [packagesResult, photographerResult] = await Promise.all([
        service
          .from("packages")
          .select("id,name,description,price_cents,items,profile_id,category,is_retouch_addon")
          .eq("photographer_id", projectRow.photographer_id)
          .eq("active", true)
          .order("price_cents", { ascending: true }),
        service
          .from("photographers")
          .select(
            "id,watermark_enabled,watermark_logo_url,logo_url,business_name,studio_address,studio_phone,studio_email,default_package_profile_id,is_platform_admin,subscription_status,trial_starts_at,trial_ends_at,created_at",
          )
          .eq("id", projectRow.photographer_id)
          .maybeSingle<PhotographerRow>(),
      ]);

      if (packagesResult.error) throw packagesResult.error;
      if (photographerResult.error) throw photographerResult.error;

      // Defense-in-depth gate: block cancelled photographers at read time even
      // if the Stripe-webhook cleanup hasn't landed yet. Platform admins and
      // active trial users pass.
      if (!hasActiveSubscription(photographerResult.data)) {
        return NextResponse.json(
          { ok: false, message: "This gallery is no longer available." },
          { status: 410 },
        );
      }

      const photographerDefaultProfileId = ((photographerResult.data as Record<string, unknown> | null)?.default_package_profile_id as string | null) ?? null;
      const availablePackages = (packagesResult.data ?? []) as PackageRow[];
      packages = filterPackagesForProfile(availablePackages, {
        selectedProfileId:
          projectRow.package_profile_id ||
          normalizedGallerySettings.extras.priceSheetProfileId ||
          photographerDefaultProfileId,
      }).packages;

      const photographer = photographerResult.data;
      if (photographer) {
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

    if (
      favoriteDownloadAccess.enabled &&
      favoriteDownloadAccess.requiresAllDigitalsPurchase
    ) {
      const { data: orderRows, error: orderError } = await service
        .from("orders")
        .select("id,package_id,package_name,status,parent_email,customer_email")
        .eq("project_id", selectedProjectId);

      if (orderError) throw orderError;

      const matchingOrders = ((orderRows ?? []) as OrderRow[]).filter((row) => {
        if (!isPaidOrderStatus(row.status)) return false;
        const orderEmails = [
          clean(row.parent_email).toLowerCase(),
          clean(row.customer_email).toLowerCase(),
        ].filter(Boolean);
        return orderEmails.includes(normalizedEmail);
      });

      const packageIds = Array.from(
        new Set(
          matchingOrders
            .map((row) => clean(row.package_id))
            .filter((value) => value.length > 0),
        ),
      );

      const purchasedPackageMap = new Map<string, PurchasedPackageRow>();
      if (packageIds.length > 0) {
        const { data: packageRows, error: packageError } = await service
          .from("packages")
          .select("id,name,description,category")
          .in("id", packageIds);

        if (packageError) throw packageError;

        for (const row of (packageRows ?? []) as PurchasedPackageRow[]) {
          purchasedPackageMap.set(row.id, row);
        }
      }

      const paidDigitalOrders = matchingOrders.filter((row) => {
        const linkedPackage = purchasedPackageMap.get(clean(row.package_id));
        return (
          clean(linkedPackage?.category).toLowerCase() === "digital" ||
          isDigitalPackageText(
            row.package_name,
            linkedPackage?.name,
            linkedPackage?.description,
          )
        );
      });

      const paidAllDigitalsOrder = paidDigitalOrders.find((row) => {
        const linkedPackage = purchasedPackageMap.get(clean(row.package_id));
        return isAllDigitalsText(
          row.package_name,
          linkedPackage?.name,
          linkedPackage?.description,
        );
      });

      favoriteDownloadAccess = {
        ...favoriteDownloadAccess,
        hasPaidDigitalOrder: paidDigitalOrders.length > 0,
        hasPurchasedAllDigitals: !!paidAllDigitalsOrder,
        canDownload: !!paidAllDigitalsOrder,
        message: paidAllDigitalsOrder
          ? null
          : "Favorites download unlocks after the full digital package is purchased.",
      };
    }

    if (downloadAccess.enabled) {
      if (downloadAccess.audience === "person") {
        const targetEmail = clean(
          normalizedGallerySettings.extras.freeDigitalTargetEmail,
        ).toLowerCase();
        downloadAccess = {
          ...downloadAccess,
          canDownload: !!targetEmail && targetEmail === normalizedEmail,
          message:
            !targetEmail
              ? "Choose the approved person email in Gallery Settings to enable this rule."
              : targetEmail === normalizedEmail
                ? null
                : "Free downloads are reserved for a specific invited person.",
        };
      }

      if (downloadAccess.canDownload) {
        const { data: downloadRows, error: downloadError } = await service
          .from("event_gallery_downloads")
          .select("download_count")
          .eq("project_id", selectedProjectId)
          .eq("viewer_email", normalizedEmail)
          .eq("download_type", "gallery");

        if (downloadError && !isMissingDownloadsTable(downloadError)) {
          throw downloadError;
        }

        const downloadsUsed = ((downloadRows ?? []) as DownloadLogRow[]).reduce(
          (sum, row) => sum + Math.max(0, Number(row.download_count ?? 0)),
          0,
        );
        const numericLimit =
          downloadAccess.downloadLimit === "unlimited"
            ? null
            : Math.max(0, Number.parseInt(downloadAccess.downloadLimit, 10) || 0);
        const downloadsRemaining =
          numericLimit === null ? null : Math.max(0, numericLimit - downloadsUsed);

        downloadAccess = {
          ...downloadAccess,
          downloadsUsed,
          downloadsRemaining,
          canDownload: downloadsRemaining === null ? true : downloadsRemaining > 0,
          message:
            downloadsRemaining === null
              ? null
              : downloadsRemaining > 0
                ? null
                : "This gallery's free download limit has been reached.",
        };
      }
    }

    // Screenshot protection flags surfaced to the client. Values live on
    // `projectRow` (see select list above); exposing them at a stable
    // top-level key keeps the portal's parser simple.
    const screenshotProtection = {
      desktop: Boolean(projectRow.screenshot_protection_desktop),
      mobile: Boolean(projectRow.screenshot_protection_mobile),
      watermark: Boolean(projectRow.screenshot_protection_watermark),
    };

    return NextResponse.json({
      ok: true,
      project: projectRow,
      gallerySettings: publicGallerySettings,
      downloadAccess,
      activeCollection: matchingCollection ?? null,
      collections,
      media: mediaRows,
      packages,
      favoriteDownloadAccess,
      photographerId: projectRow.photographer_id ?? null,
      watermarkEnabled,
      watermarkLogoUrl,
      studioInfo,
      screenshotProtection,
    });
  } catch (error) {
    console.error("[event-gallery-context]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to load event gallery." },
      { status: 500 },
    );
  }
}

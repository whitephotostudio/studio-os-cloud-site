import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import {
  defaultEventGallerySettings,
  getSchoolClassDownloadOverrideKeys,
  normalizeEventGallerySettings,
  type EventGallerySettings,
} from "@/lib/event-gallery-settings";

type DownloadLogRow = {
  download_count: number | null;
};

type SchoolDownloadAccess = {
  enabled: boolean;
  audience: EventGallerySettings["extras"]["freeDigitalAudience"];
  resolution: EventGallerySettings["extras"]["freeDigitalResolution"];
  downloadLimit: EventGallerySettings["extras"]["freeDigitalDownloadLimit"];
  requiresPin: boolean;
  hasPinConfigured: boolean;
  downloadsUsed: number;
  downloadsRemaining: number | null;
  canDownload: boolean;
  message: string | null;
};

type ServiceClient = ReturnType<typeof createDashboardServiceClient>;

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function isMissingDownloadsTable(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "42P01"
  );
}

export function defaultSchoolGalleryDownloadAccess(
  settings: EventGallerySettings = defaultEventGallerySettings,
): SchoolDownloadAccess {
  const enabled =
    settings.extras.freeDigitalRuleEnabled && settings.extras.showDownloadAllButton;
  const numericLimit =
    settings.extras.freeDigitalDownloadLimit === "unlimited"
      ? null
      : Math.max(0, Number.parseInt(settings.extras.freeDigitalDownloadLimit, 10) || 0);
  const requiresPin = settings.extras.downloadPinEnabled;
  const hasPinConfigured = clean(settings.extras.downloadPin).length > 0;

  let message: string | null = null;
  if (!enabled) {
    message = "Gallery downloads are turned off for this gallery.";
  } else if (requiresPin && !hasPinConfigured) {
    message = 'A "Download All" PIN needs to be set in School Settings first.';
  } else if (settings.extras.freeDigitalAudience === "person") {
    message =
      "Free downloads are reserved for a specific approved parent email.";
  } else if (settings.extras.freeDigitalAudience === "album") {
    message =
      "Album-specific free downloads are not available in school galleries.";
  }

  return {
    enabled,
    audience: settings.extras.freeDigitalAudience,
    resolution: settings.extras.freeDigitalResolution,
    downloadLimit: settings.extras.freeDigitalDownloadLimit,
    requiresPin,
    hasPinConfigured,
    downloadsUsed: 0,
    downloadsRemaining: numericLimit,
    canDownload:
      enabled &&
      (!requiresPin || hasPinConfigured) &&
      settings.extras.freeDigitalAudience !== "person" &&
      settings.extras.freeDigitalAudience !== "album",
    message,
  };
}

export function schoolClassAllowsFreeDownloads(gallerySettings: unknown, classId?: string | null, className?: string | null) {
  const settings = normalizeEventGallerySettings(gallerySettings);
  const override = getSchoolClassDownloadOverrideKeys({ classId, className }).map(key => settings.extras.schoolClassDownloadOverrides[key]).find(Boolean);
  return override?.freeDigitalRuleEnabled !== false;
}

export async function buildSchoolGalleryDownloadAccess(params: {
  service: ServiceClient;
  schoolId: string;
  viewerEmail: string;
  gallerySettings: unknown;
  classId?: string | null;
  className?: string | null;
}): Promise<SchoolDownloadAccess> {
  const settings = normalizeEventGallerySettings(params.gallerySettings);
  const base = defaultSchoolGalleryDownloadAccess(settings);
  const normalizedEmail = clean(params.viewerEmail).toLowerCase();
  const classOverride = getSchoolClassDownloadOverrideKeys({
    classId: params.classId,
    className: params.className,
  })
    .map((key) => settings.extras.schoolClassDownloadOverrides[key])
    .find((override) => override);

  if (!base.enabled) {
    return base;
  }

  if (classOverride?.freeDigitalRuleEnabled === false) {
    return {
      ...base,
      enabled: false,
      canDownload: false,
      message: "Downloads are turned off for this class.",
    };
  }

  if (!normalizedEmail) {
    return {
      ...base,
      canDownload: false,
      message: "Open this gallery from the school login page to unlock downloads.",
    };
  }

  if (base.audience === "album") {
    return {
      ...base,
      canDownload: false,
      message: "Album-specific free downloads are not available in school galleries.",
    };
  }

  if (base.audience === "person") {
    const targetEmail = clean(settings.extras.freeDigitalTargetEmail).toLowerCase();
    if (!targetEmail) {
      return {
        ...base,
        canDownload: false,
        message: "Choose the approved parent email in School Settings first.",
      };
    }
    if (targetEmail !== normalizedEmail) {
      return {
        ...base,
        canDownload: false,
        message: "Free downloads are reserved for a specific approved parent email.",
      };
    }
  }

  const downloadRows: DownloadLogRow[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset < 20000; offset += 500) {
    const { data, error } = await params.service.from("school_gallery_downloads")
      .select("id,download_count").eq("school_id", params.schoolId).eq("viewer_email", normalizedEmail)
      .eq("download_type", "gallery").order("id", { ascending: true }).range(offset, offset + 499);
    if (error) {
      if (!isMissingDownloadsTable(error) || base.downloadLimit !== "unlimited") throw error;
      break;
    }
    for (const row of data ?? []) {
      if (seen.has(row.id)) throw new Error("Download history changed while loading. Please retry.");
      seen.add(row.id); downloadRows.push(row);
    }
    if ((data?.length ?? 0) < 500) break;
    if (offset === 19500) throw new Error("Download history is too large to verify safely.");
  }

  const downloadsUsed = ((downloadRows ?? []) as DownloadLogRow[]).reduce(
    (sum, row) => sum + Math.max(0, Number(row.download_count ?? 0)),
    0,
  );
  const numericLimit =
    base.downloadLimit === "unlimited"
      ? null
      : Math.max(0, Number.parseInt(base.downloadLimit, 10) || 0);
  const downloadsRemaining =
    numericLimit === null ? null : Math.max(0, numericLimit - downloadsUsed);

  return {
    ...base,
    downloadsUsed,
    downloadsRemaining,
    canDownload: downloadsRemaining === null ? true : downloadsRemaining > 0,
    message:
      downloadsRemaining !== null && downloadsRemaining <= 0
        ? "There are no free downloads remaining for this gallery."
        : base.message,
  };
}

export type EventGalleryExtraSettings = {
  priceSheetProfileId: string;
  allowSocialSharing: boolean;
  socialShareMessage: string;
  allowBlackWhiteFiltering: boolean;
  galleryAccess: "public" | "private";
  passwordProtected: boolean;
  password: string;
  freeDigitalRuleEnabled: boolean;
  freeDigitalAudience: "gallery" | "album" | "person";
  freeDigitalTargetName: string;
  freeDigitalTargetEmail: string;
  freeDigitalResolution: "original" | "large" | "web";
  freeDigitalDownloadLimit: "unlimited" | "10" | "5" | "1";
  showDownloadAllButton: boolean;
  showProofWatermark: boolean;
  downloadPinEnabled: boolean;
  downloadPin: string;
  allowClientFavoriteDownloads: boolean;
  favoriteDownloadsRequireAllDigitalsPurchase: boolean;
  watermarkDownloads: boolean;
  includePrintRelease: boolean;
  enableStore: boolean;
  shippingEnabled: boolean;
  minimumOrderAmount: string;
  taxEnabled: boolean;
  taxPercent: number;
  taxLabel: string;
  taxCountry: string;
  taxRatesByCountry: Record<string, number>;
  allowCropping: boolean;
  enableAbandonedCartEmail: boolean;
  showBuyAllButton: boolean;
  offerPackagesOnly: boolean;
  allowClientToPayLater: boolean;
  allowClientComments: boolean;
  hideAllPhotosAlbum: boolean;
  hideAlbumPhotoCount: boolean;
  autoArchiveAfterExpiration: boolean;
  sendEmailCampaign: boolean;
  autoChooseAlbumCover: boolean;
  autoChooseProjectCover: boolean;
  coverSource: "first_valid" | "newest" | "oldest" | "manual";
  emailCaptureMode: "off" | "optional" | "required";
  liveGalleryMode: boolean;
  guestIdentificationMode: "none" | "qr" | "barcode";
  instantPhotoDelivery: boolean;
  orderNotificationHooks: boolean;
  schoolClassDownloadOverrides: Record<string, SchoolClassDownloadOverride>;
};

export type SchoolClassDownloadOverride = {
  freeDigitalRuleEnabled: boolean;
};

export type EventGalleryBrandingSettings = {
  themePreset: "signature" | "editorial" | "cinema";
  backgroundMode: "dark" | "light";
  tone: "ink" | "graphite" | "smoke";
  accentColor: "studio-red" | "champagne" | "ivory";
  photoLayout: "subway" | "cascade" | "editorial";
  fontPreset:
    | "brandon"
    | "freeland"
    | "baskerville"
    | "playfair"
    | "spectral"
    | "montserrat"
    | "raleway"
    | "inter"
    | "quicksand"
    | "oswald"
    | "pt-sans"
    | "lato"
    | "studio-sans"
    | "editorial-serif"
    | "classic-contrast";
  introEnabled: boolean;
  introLayout: "split" | "centered" | "minimal";
  introHeadline: string;
  introMessage: string;
  introCtaLabel: string;
  showStudioMark: boolean;
  useCoverAsIntro: boolean;
  showHeroHeader: boolean;
  heroTextAlign: "left" | "center";
  heroOverlayStrength: "soft" | "balanced" | "dramatic";
  gridDensity: "airy" | "balanced" | "tight";
  imageSpacing: "airy" | "balanced" | "tight";
  marketingBannerEnabled: boolean;
  marketingBannerText: string;
  marketingBannerLinkLabel: string;
  marketingBannerLinkUrl: string;
};

export type EventGalleryLinkedContact = {
  id: string;
  name: string;
  email: string;
  role: string;
  labelPhotos: boolean;
  hidePhotos: boolean;
  isVip: boolean;
  note: string;
};

export type EventGalleryShareSettings = {
  emailSubject: string;
  emailHeadline: string;
  emailButtonLabel: string;
  emailMessage: string;
};

export type EventScheduleDetails = {
  startTime: string;
  endTime: string;
  time: string;
  location: string;
  address: string;
  notes: string;
};

export type EventGallerySettings = {
  version: 1;
  galleryLanguage: string;
  extras: EventGalleryExtraSettings;
  branding: EventGalleryBrandingSettings;
  linkedContacts: EventGalleryLinkedContact[];
  share: EventGalleryShareSettings;
  schedule: EventScheduleDetails;
};

export const defaultEventGalleryExtras: EventGalleryExtraSettings = {
  priceSheetProfileId: "",
  allowSocialSharing: true,
  socialShareMessage: "Check out the photos from this gallery!",
  allowBlackWhiteFiltering: false,
  galleryAccess: "public",
  passwordProtected: false,
  password: "",
  freeDigitalRuleEnabled: false,
  freeDigitalAudience: "gallery",
  freeDigitalTargetName: "",
  freeDigitalTargetEmail: "",
  freeDigitalResolution: "original",
  freeDigitalDownloadLimit: "unlimited",
  showDownloadAllButton: false,
  showProofWatermark: true,
  downloadPinEnabled: false,
  downloadPin: "",
  allowClientFavoriteDownloads: false,
  favoriteDownloadsRequireAllDigitalsPurchase: false,
  watermarkDownloads: false,
  includePrintRelease: false,
  enableStore: true,
  shippingEnabled: false,
  minimumOrderAmount: "",
  taxEnabled: false,
  taxPercent: 0,
  taxLabel: "Tax",
  taxCountry: "CA",
  taxRatesByCountry: {},
  allowCropping: false,
  enableAbandonedCartEmail: true,
  showBuyAllButton: false,
  offerPackagesOnly: false,
  allowClientToPayLater: false,
  allowClientComments: false,
  hideAllPhotosAlbum: false,
  hideAlbumPhotoCount: false,
  autoArchiveAfterExpiration: false,
  sendEmailCampaign: false,
  autoChooseAlbumCover: true,
  autoChooseProjectCover: true,
  coverSource: "first_valid",
  emailCaptureMode: "off",
  liveGalleryMode: false,
  guestIdentificationMode: "none",
  instantPhotoDelivery: false,
  orderNotificationHooks: false,
  schoolClassDownloadOverrides: {},
};

export const defaultEventGalleryBranding: EventGalleryBrandingSettings = {
  themePreset: "signature",
  backgroundMode: "dark",
  tone: "ink",
  accentColor: "studio-red",
  photoLayout: "subway",
  fontPreset: "studio-sans",
  introEnabled: true,
  introLayout: "split",
  introHeadline: "",
  introMessage: "A private Studio OS gallery designed for your event.",
  introCtaLabel: "Enter Gallery",
  showStudioMark: true,
  useCoverAsIntro: true,
  showHeroHeader: true,
  heroTextAlign: "left",
  heroOverlayStrength: "balanced",
  gridDensity: "balanced",
  imageSpacing: "balanced",
  marketingBannerEnabled: false,
  marketingBannerText: "",
  marketingBannerLinkLabel: "",
  marketingBannerLinkUrl: "",
};

export const defaultEventGalleryShareSettings: EventGalleryShareSettings = {
  emailSubject: "Your gallery is ready",
  emailHeadline: "",
  emailButtonLabel: "View Gallery",
  emailMessage:
    "Hi,\n\nYour gallery is ready to view.\n\nUse the gallery link and access details provided below to enter.\n\nThanks,\nStudio OS",
};

export const defaultEventScheduleDetails: EventScheduleDetails = {
  startTime: "",
  endTime: "",
  time: "",
  location: "",
  address: "",
  notes: "",
};

export const defaultEventGallerySettings: EventGallerySettings = {
  version: 1,
  galleryLanguage: "English (US)",
  extras: defaultEventGalleryExtras,
  branding: defaultEventGalleryBranding,
  linkedContacts: [],
  share: defaultEventGalleryShareSettings,
  schedule: defaultEventScheduleDetails,
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

export function normalizeSchoolClassOverrideKey(
  value: string | null | undefined,
) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

export function getSchoolClassDownloadOverrideKeys(params: {
  classId?: string | null;
  className?: string | null;
}) {
  const keys = [
    normalizeSchoolClassOverrideKey(params.classId),
    normalizeSchoolClassOverrideKey(params.className),
  ].filter(Boolean);
  return Array.from(new Set(keys));
}

function normalizeSchoolClassDownloadOverrides(
  value: unknown,
): Record<string, SchoolClassDownloadOverride> {
  const source = asObject(value);
  if (!source) return {};

  const overrides: Record<string, SchoolClassDownloadOverride> = {};
  for (const [rawKey, rawValue] of Object.entries(source).slice(0, 500)) {
    const key = normalizeSchoolClassOverrideKey(rawKey);
    if (!key) continue;

    if (typeof rawValue === "boolean") {
      overrides[key] = { freeDigitalRuleEnabled: rawValue };
      continue;
    }

    const row = asObject(rawValue);
    if (typeof row?.freeDigitalRuleEnabled === "boolean") {
      overrides[key] = {
        freeDigitalRuleEnabled: row.freeDigitalRuleEnabled,
      };
    }
  }

  return overrides;
}

function normalizeCountryCode(value: unknown, fallback: string) {
  const raw = asString(value, fallback).trim().toUpperCase();
  return raw ? raw.slice(0, 2) : fallback;
}

function normalizeTaxRatesByCountry(value: unknown): Record<string, number> {
  const source = asObject(value);
  if (!source) return {};

  const rates: Record<string, number> = {};
  for (const [rawCountry, rawRate] of Object.entries(source)) {
    const country = normalizeCountryCode(rawCountry, "");
    const rate = asNumber(rawRate, -1);
    if (country && rate >= 0) rates[country] = Math.min(100, rate);
  }
  return rates;
}

export function normalizeEventGallerySettings(value: unknown): EventGallerySettings {
  const source = asObject(value);
  const extrasSource = asObject(source?.extras);
  const brandingSource = asObject(source?.branding);
  const commerceSource = asObject(source?.commerce);
  const taxRatesByCountry = {
    ...normalizeTaxRatesByCountry(extrasSource?.taxRatesByCountry),
    ...normalizeTaxRatesByCountry(commerceSource?.taxRatesByCountry),
  };
  const taxCountry = normalizeCountryCode(
    commerceSource?.taxCountry ?? extrasSource?.taxCountry,
    defaultEventGalleryExtras.taxCountry,
  );
  const rawTaxPercent = asNumber(
    commerceSource?.taxPercent ?? extrasSource?.taxPercent,
    taxRatesByCountry[taxCountry] ?? defaultEventGalleryExtras.taxPercent,
  );
  const taxPercent = Math.min(
    100,
    Math.max(0, taxRatesByCountry[taxCountry] ?? rawTaxPercent),
  );

  return {
    version: 1,
    galleryLanguage: asString(
      source?.galleryLanguage,
      defaultEventGallerySettings.galleryLanguage,
    ),
    extras: {
      priceSheetProfileId: asString(
        extrasSource?.priceSheetProfileId,
        defaultEventGalleryExtras.priceSheetProfileId,
      ),
      allowSocialSharing: asBoolean(
        extrasSource?.allowSocialSharing,
        defaultEventGalleryExtras.allowSocialSharing,
      ),
      socialShareMessage: asString(
        extrasSource?.socialShareMessage,
        defaultEventGalleryExtras.socialShareMessage,
      ),
      allowBlackWhiteFiltering: asBoolean(
        extrasSource?.allowBlackWhiteFiltering,
        defaultEventGalleryExtras.allowBlackWhiteFiltering,
      ),
      galleryAccess: asEnum(
        extrasSource?.galleryAccess,
        ["public", "private"] as const,
        defaultEventGalleryExtras.galleryAccess,
      ),
      passwordProtected: asBoolean(
        extrasSource?.passwordProtected,
        defaultEventGalleryExtras.passwordProtected,
      ),
      password: asString(extrasSource?.password, defaultEventGalleryExtras.password),
      freeDigitalRuleEnabled: asBoolean(
        extrasSource?.freeDigitalRuleEnabled,
        defaultEventGalleryExtras.freeDigitalRuleEnabled,
      ),
      freeDigitalAudience: asEnum(
        extrasSource?.freeDigitalAudience,
        ["gallery", "album", "person"] as const,
        defaultEventGalleryExtras.freeDigitalAudience,
      ),
      freeDigitalTargetName: asString(
        extrasSource?.freeDigitalTargetName,
        defaultEventGalleryExtras.freeDigitalTargetName,
      ),
      freeDigitalTargetEmail: asString(
        extrasSource?.freeDigitalTargetEmail,
        defaultEventGalleryExtras.freeDigitalTargetEmail,
      ),
      freeDigitalResolution: asEnum(
        extrasSource?.freeDigitalResolution,
        ["original", "large", "web"] as const,
        defaultEventGalleryExtras.freeDigitalResolution,
      ),
      freeDigitalDownloadLimit: asEnum(
        extrasSource?.freeDigitalDownloadLimit,
        ["unlimited", "10", "5", "1"] as const,
        defaultEventGalleryExtras.freeDigitalDownloadLimit,
      ),
      showProofWatermark: asBoolean(
        extrasSource?.showProofWatermark,
        defaultEventGalleryExtras.showProofWatermark,
      ),
      showDownloadAllButton: asBoolean(
        extrasSource?.showDownloadAllButton,
        defaultEventGalleryExtras.showDownloadAllButton,
      ),
      downloadPinEnabled: asBoolean(
        extrasSource?.downloadPinEnabled,
        defaultEventGalleryExtras.downloadPinEnabled,
      ),
      downloadPin: asString(
        extrasSource?.downloadPin,
        defaultEventGalleryExtras.downloadPin,
      ),
      allowClientFavoriteDownloads: asBoolean(
        extrasSource?.allowClientFavoriteDownloads,
        defaultEventGalleryExtras.allowClientFavoriteDownloads,
      ),
      favoriteDownloadsRequireAllDigitalsPurchase: asBoolean(
        extrasSource?.favoriteDownloadsRequireAllDigitalsPurchase,
        defaultEventGalleryExtras.favoriteDownloadsRequireAllDigitalsPurchase,
      ),
      watermarkDownloads: asBoolean(
        extrasSource?.watermarkDownloads,
        defaultEventGalleryExtras.watermarkDownloads,
      ),
      includePrintRelease: asBoolean(
        extrasSource?.includePrintRelease,
        defaultEventGalleryExtras.includePrintRelease,
      ),
      enableStore: asBoolean(
        extrasSource?.enableStore,
        defaultEventGalleryExtras.enableStore,
      ),
      shippingEnabled: asBoolean(
        extrasSource?.shippingEnabled,
        defaultEventGalleryExtras.shippingEnabled,
      ),
      minimumOrderAmount: asString(
        extrasSource?.minimumOrderAmount,
        defaultEventGalleryExtras.minimumOrderAmount,
      ),
      taxEnabled:
        asBoolean(
          commerceSource?.taxEnabled ?? extrasSource?.taxEnabled,
          defaultEventGalleryExtras.taxEnabled,
        ) && taxPercent > 0,
      taxPercent,
      taxLabel: asString(
        commerceSource?.taxLabel ?? extrasSource?.taxLabel,
        defaultEventGalleryExtras.taxLabel,
      ),
      taxCountry,
      taxRatesByCountry,
      allowCropping: asBoolean(
        extrasSource?.allowCropping,
        defaultEventGalleryExtras.allowCropping,
      ),
      enableAbandonedCartEmail: asBoolean(
        extrasSource?.enableAbandonedCartEmail,
        defaultEventGalleryExtras.enableAbandonedCartEmail,
      ),
      showBuyAllButton: asBoolean(
        extrasSource?.showBuyAllButton,
        defaultEventGalleryExtras.showBuyAllButton,
      ),
      offerPackagesOnly: asBoolean(
        extrasSource?.offerPackagesOnly,
        defaultEventGalleryExtras.offerPackagesOnly,
      ),
      allowClientToPayLater: asBoolean(
        extrasSource?.allowClientToPayLater,
        defaultEventGalleryExtras.allowClientToPayLater,
      ),
      allowClientComments: asBoolean(
        extrasSource?.allowClientComments,
        defaultEventGalleryExtras.allowClientComments,
      ),
      hideAllPhotosAlbum: asBoolean(
        extrasSource?.hideAllPhotosAlbum,
        defaultEventGalleryExtras.hideAllPhotosAlbum,
      ),
      hideAlbumPhotoCount: asBoolean(
        extrasSource?.hideAlbumPhotoCount,
        defaultEventGalleryExtras.hideAlbumPhotoCount,
      ),
      autoArchiveAfterExpiration: asBoolean(
        extrasSource?.autoArchiveAfterExpiration,
        defaultEventGalleryExtras.autoArchiveAfterExpiration,
      ),
      sendEmailCampaign: asBoolean(
        extrasSource?.sendEmailCampaign,
        defaultEventGalleryExtras.sendEmailCampaign,
      ),
      autoChooseAlbumCover: asBoolean(
        extrasSource?.autoChooseAlbumCover,
        defaultEventGalleryExtras.autoChooseAlbumCover,
      ),
      autoChooseProjectCover: asBoolean(
        extrasSource?.autoChooseProjectCover,
        defaultEventGalleryExtras.autoChooseProjectCover,
      ),
      coverSource: asEnum(
        extrasSource?.coverSource,
        ["first_valid", "newest", "oldest", "manual"] as const,
        defaultEventGalleryExtras.coverSource,
      ),
      emailCaptureMode: asEnum(
        extrasSource?.emailCaptureMode,
        ["off", "optional", "required"] as const,
        defaultEventGalleryExtras.emailCaptureMode,
      ),
      liveGalleryMode: asBoolean(
        extrasSource?.liveGalleryMode,
        defaultEventGalleryExtras.liveGalleryMode,
      ),
      guestIdentificationMode: asEnum(
        extrasSource?.guestIdentificationMode,
        ["none", "qr", "barcode"] as const,
        defaultEventGalleryExtras.guestIdentificationMode,
      ),
      instantPhotoDelivery: asBoolean(
        extrasSource?.instantPhotoDelivery,
        defaultEventGalleryExtras.instantPhotoDelivery,
      ),
      orderNotificationHooks: asBoolean(
        extrasSource?.orderNotificationHooks,
        defaultEventGalleryExtras.orderNotificationHooks,
      ),
      schoolClassDownloadOverrides: normalizeSchoolClassDownloadOverrides(
        extrasSource?.schoolClassDownloadOverrides,
      ),
    },
    branding: {
      themePreset: asEnum(
        brandingSource?.themePreset,
        ["signature", "editorial", "cinema"] as const,
        defaultEventGalleryBranding.themePreset,
      ),
      backgroundMode: asEnum(
        brandingSource?.backgroundMode,
        ["dark", "light"] as const,
        defaultEventGalleryBranding.backgroundMode,
      ),
      tone: asEnum(
        brandingSource?.tone,
        ["ink", "graphite", "smoke"] as const,
        defaultEventGalleryBranding.tone,
      ),
      accentColor: asEnum(
        brandingSource?.accentColor,
        ["studio-red", "champagne", "ivory"] as const,
        defaultEventGalleryBranding.accentColor,
      ),
      photoLayout: asEnum(
        brandingSource?.photoLayout,
        ["subway", "cascade", "editorial"] as const,
        defaultEventGalleryBranding.photoLayout,
      ),
      fontPreset: asEnum(
        brandingSource?.fontPreset,
        [
          "brandon",
          "freeland",
          "baskerville",
          "playfair",
          "spectral",
          "montserrat",
          "raleway",
          "inter",
          "quicksand",
          "oswald",
          "pt-sans",
          "lato",
          "studio-sans",
          "editorial-serif",
          "classic-contrast",
        ] as const,
        defaultEventGalleryBranding.fontPreset,
      ),
      introEnabled: asBoolean(
        brandingSource?.introEnabled,
        defaultEventGalleryBranding.introEnabled,
      ),
      introLayout: asEnum(
        brandingSource?.introLayout,
        ["split", "centered", "minimal"] as const,
        defaultEventGalleryBranding.introLayout,
      ),
      introHeadline: asString(
        brandingSource?.introHeadline,
        defaultEventGalleryBranding.introHeadline,
      ),
      introMessage: asString(
        brandingSource?.introMessage,
        defaultEventGalleryBranding.introMessage,
      ),
      introCtaLabel: asString(
        brandingSource?.introCtaLabel,
        defaultEventGalleryBranding.introCtaLabel,
      ),
      showStudioMark: asBoolean(
        brandingSource?.showStudioMark,
        defaultEventGalleryBranding.showStudioMark,
      ),
      useCoverAsIntro: asBoolean(
        brandingSource?.useCoverAsIntro,
        defaultEventGalleryBranding.useCoverAsIntro,
      ),
      showHeroHeader: asBoolean(
        brandingSource?.showHeroHeader,
        defaultEventGalleryBranding.showHeroHeader,
      ),
      heroTextAlign: asEnum(
        brandingSource?.heroTextAlign,
        ["left", "center"] as const,
        defaultEventGalleryBranding.heroTextAlign,
      ),
      heroOverlayStrength: asEnum(
        brandingSource?.heroOverlayStrength,
        ["soft", "balanced", "dramatic"] as const,
        defaultEventGalleryBranding.heroOverlayStrength,
      ),
      gridDensity: asEnum(
        brandingSource?.gridDensity,
        ["airy", "balanced", "tight"] as const,
        defaultEventGalleryBranding.gridDensity,
      ),
      imageSpacing: asEnum(
        brandingSource?.imageSpacing,
        ["airy", "balanced", "tight"] as const,
        defaultEventGalleryBranding.imageSpacing,
      ),
      marketingBannerEnabled: asBoolean(
        brandingSource?.marketingBannerEnabled,
        defaultEventGalleryBranding.marketingBannerEnabled,
      ),
      marketingBannerText: asString(
        brandingSource?.marketingBannerText,
        defaultEventGalleryBranding.marketingBannerText,
      ),
      marketingBannerLinkLabel: asString(
        brandingSource?.marketingBannerLinkLabel,
        defaultEventGalleryBranding.marketingBannerLinkLabel,
      ),
      marketingBannerLinkUrl: asString(
        brandingSource?.marketingBannerLinkUrl,
        defaultEventGalleryBranding.marketingBannerLinkUrl,
      ),
    },
    linkedContacts: asArray(source?.linkedContacts)
      .map((item) => {
        const contact = asObject(item);
        if (!contact) return null;
        const email = asString(contact.email, "").trim();
        if (!email) return null;
        return {
          id: asString(contact.id, crypto.randomUUID()),
          name: asString(contact.name, ""),
          email,
          role: asString(contact.role, "Linked Contact"),
          labelPhotos: asBoolean(contact.labelPhotos, false),
          hidePhotos: asBoolean(contact.hidePhotos, false),
          isVip: asBoolean(contact.isVip, false),
          note: asString(contact.note, ""),
        } satisfies EventGalleryLinkedContact;
      })
      .filter((item): item is EventGalleryLinkedContact => !!item),
    share: (() => {
      const shareSource = asObject(source?.share);
      return {
        emailSubject: asString(
          shareSource?.emailSubject,
          defaultEventGalleryShareSettings.emailSubject,
        ),
        emailHeadline: asString(
          shareSource?.emailHeadline,
          defaultEventGalleryShareSettings.emailHeadline,
        ),
        emailButtonLabel: asString(
          shareSource?.emailButtonLabel,
          defaultEventGalleryShareSettings.emailButtonLabel,
        ),
        emailMessage: asString(
          shareSource?.emailMessage,
          defaultEventGalleryShareSettings.emailMessage,
        ),
      } satisfies EventGalleryShareSettings;
    })(),
    schedule: (() => {
      const scheduleSource = asObject(source?.schedule);
      const legacyTime = asString(scheduleSource?.time, defaultEventScheduleDetails.time);
      return {
        startTime: asString(scheduleSource?.startTime, legacyTime),
        endTime: asString(scheduleSource?.endTime, defaultEventScheduleDetails.endTime),
        time: legacyTime,
        location: asString(
          scheduleSource?.location,
          defaultEventScheduleDetails.location,
        ),
        address: asString(
          scheduleSource?.address,
          defaultEventScheduleDetails.address,
        ),
        notes: asString(scheduleSource?.notes, defaultEventScheduleDetails.notes),
      } satisfies EventScheduleDetails;
    })(),
  };
}

export function sanitizeEventGallerySettingsForClient(
  value: unknown,
): EventGallerySettings {
  const normalized = normalizeEventGallerySettings(value);
  return {
    ...normalized,
    extras: {
      ...normalized.extras,
      password: "",
      downloadPin: "",
    },
  };
}

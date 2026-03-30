export type EventGalleryExtraSettings = {
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
  allowClientFavoriteDownloads: boolean;
  favoriteDownloadsRequireAllDigitalsPurchase: boolean;
  watermarkDownloads: boolean;
  includePrintRelease: boolean;
  enableStore: boolean;
  minimumOrderAmount: string;
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
};

export type EventGalleryBrandingSettings = {
  themePreset: "signature" | "editorial" | "cinema";
  backgroundMode: "dark" | "light";
  tone: "ink" | "graphite" | "smoke";
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

export type EventGallerySettings = {
  version: 1;
  galleryLanguage: string;
  extras: EventGalleryExtraSettings;
  branding: EventGalleryBrandingSettings;
  linkedContacts: EventGalleryLinkedContact[];
  share: EventGalleryShareSettings;
};

export const defaultEventGalleryExtras: EventGalleryExtraSettings = {
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
  allowClientFavoriteDownloads: false,
  favoriteDownloadsRequireAllDigitalsPurchase: false,
  watermarkDownloads: false,
  includePrintRelease: false,
  enableStore: true,
  minimumOrderAmount: "",
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
};

export const defaultEventGalleryBranding: EventGalleryBrandingSettings = {
  themePreset: "signature",
  backgroundMode: "dark",
  tone: "ink",
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

export const defaultEventGallerySettings: EventGallerySettings = {
  version: 1,
  galleryLanguage: "English (US)",
  extras: defaultEventGalleryExtras,
  branding: defaultEventGalleryBranding,
  linkedContacts: [],
  share: defaultEventGalleryShareSettings,
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

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

export function normalizeEventGallerySettings(value: unknown): EventGallerySettings {
  const source = asObject(value);
  const extrasSource = asObject(source?.extras);
  const brandingSource = asObject(source?.branding);

  return {
    version: 1,
    galleryLanguage: asString(
      source?.galleryLanguage,
      defaultEventGallerySettings.galleryLanguage,
    ),
    extras: {
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
      showDownloadAllButton: asBoolean(
        extrasSource?.showDownloadAllButton,
        defaultEventGalleryExtras.showDownloadAllButton,
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
      minimumOrderAmount: asString(
        extrasSource?.minimumOrderAmount,
        defaultEventGalleryExtras.minimumOrderAmount,
      ),
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
  };
}

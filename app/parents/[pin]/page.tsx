"use client";

import { FormEvent, SyntheticEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Heart,
  Share2,
  Mail,
  Phone,
  ShoppingBag,
  Truck,
  User,
  X,
  Info,
  Package,
  Plus,
  ShoppingCart,
  Printer,
  Download,
  Sparkles,
  Clock3,
  Palette,
  Eye,
  RotateCcw,
  LoaderCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  defaultEventGallerySettings,
  normalizeEventGallerySettings,
  type EventGallerySettings,
} from "@/lib/event-gallery-settings";
import { getPackageCategory } from "@/lib/package-categories";
import { defaultSchoolGalleryDownloadAccess } from "@/lib/school-gallery-downloads";
import { extractStoragePathFromSupabaseUrl } from "@/lib/storage-images";
import { createZipBlob } from "@/lib/zip";

// ── Types ──────────────────────────────────────────────────────────────────
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
  access_mode?: string | null;
  access_pin?: string | null;
  email_required?: boolean | null;
  gallery_settings?: unknown;
};

type ProjectRow = {
  id: string;
  portal_status?: string | null;
  order_due_date?: string | null;
  expiration_date?: string | null;
  project_name?: string | null;
  name?: string | null;
  title?: string | null;
  client_name?: string | null;
  photographer_id?: string | null;
  package_profile_id?: string | null;
  event_date?: string | null;
  shoot_date?: string | null;
  cover_photo_url?: string | null;
  access_mode?: string | null;
  access_pin?: string | null;
};

type EventCollectionRow = {
  id: string;
  title?: string | null;
  slug?: string | null;
  kind?: string | null;
  access_mode?: string | null;
  access_pin?: string | null;
  cover_photo_url?: string | null;
  sort_order?: number | null;
  created_at?: string | null;
};

type EventMediaRow = {
  id: string;
  collection_id?: string | null;
  storage_path?: string | null;
  download_url?: string | null;
  preview_url?: string | null;
  thumbnail_url?: string | null;
  filename?: string | null;
  created_at?: string | null;
  sort_order?: number | null;
};

type PackageItemValue =
  | string
  | {
      qty?: number | string | null;
      name?: string | null;
      type?: string | null;
      size?: string | null;
      finish?: string | null;
      composite?: boolean | null;
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

type CompositeMediaRow = {
  id: string;
  collection_id: string | null;
  storage_path: string | null;
  download_url?: string | null;
  preview_url: string | null;
  thumbnail_url: string | null;
  filename: string | null;
  created_at: string | null;
  sort_order: number | null;
  collection_title?: string | null;
};

type GalleryContextPayload = {
  ok?: boolean;
  message?: string;
  currentSchool?: SchoolRow | null;
  schoolRowsForMatch?: SchoolRow[];
  studentCandidates?: StudentRow[];
  primaryStudent?: StudentRow | null;
  activeSchool?: SchoolRow | null;
  activeProject?: ProjectRow | null;
  gallerySettings?: EventGallerySettings;
  downloadAccess?: EventGalleryDownloadAccess;
  media?: EventMediaRow[];
  composites?: CompositeMediaRow[];
  packages?: PackageRow[];
  backdrops?: BackdropRow[];
  photographerId?: string | null;
  watermarkEnabled?: boolean;
  watermarkLogoUrl?: string;
  studioInfo?: {
    businessName: string;
    logoUrl: string;
    address: string;
    phone: string;
    email: string;
  };
};

type EventGalleryContextPayload = {
  ok?: boolean;
  message?: string;
  project?: ProjectRow | null;
  gallerySettings?: EventGallerySettings;
  downloadAccess?: EventGalleryDownloadAccess;
  favoriteDownloadAccess?: EventFavoriteDownloadAccess;
  activeCollection?: EventCollectionRow | null;
  collections?: EventCollectionRow[];
  media?: EventMediaRow[];
  packages?: PackageRow[];
  photographerId?: string | null;
  watermarkEnabled?: boolean;
  watermarkLogoUrl?: string;
  studioInfo?: {
    businessName: string;
    logoUrl: string;
    address: string;
    phone: string;
    email: string;
  };
};

type EventFavoriteDownloadAccess = {
  enabled: boolean;
  requiresAllDigitalsPurchase: boolean;
  hasPaidDigitalOrder: boolean;
  hasPurchasedAllDigitals: boolean;
  canDownload: boolean;
  message: string | null;
};

type EventGalleryDownloadAccess = {
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

type GalleryImage = {
  id: string;
  url: string;
  collectionId?: string | null;
  filename?: string | null;
  downloadUrl?: string | null;
  thumbnailUrl?: string | null;
  previewUrl?: string | null;
  title?: string | null;
  source?: "photo" | "composite";
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
type DrawerView =
  | "product-select"
  | "category-list"
  | "build-package"
  | "checkout";
type ItemSlot = { label: string; assignedImageUrl: string | null; composite?: boolean };
type CartBackdropSelection = Pick<
  BackdropRow,
  "id" | "name" | "image_url" | "tier" | "price_cents"
> & {
  blurred?: boolean;
  blurAmount?: number;
};

const DEFAULT_BACKDROP_BLUR_PX = 4;
const MIN_BACKDROP_BLUR_PX = 4;
const MAX_BACKDROP_BLUR_PX = 24;
const BACKDROP_BLUR_INTENSITY_MULTIPLIER = 1.15;
type CartLineItem = {
  id: string;
  packageId: string;
  packageName: string;
  category: string;
  quantity: number;
  packageSubtotalCents: number;
  backdropAddOnCents: number;
  lineTotalCents: number;
  slots: ItemSlot[];
  selectedImageUrl: string | null;
  isCompositeOrder: boolean;
  compositeTitle: string | null;
  backdrop: CartBackdropSelection | null;
};
type GalleryView = "photos" | "store" | "favorites" | "about";
type EventPhotoStage = "albums" | "grid" | "viewer";

type GalleryLocale = "en-US" | "en-CA" | "fr-CA";

const galleryTranslations: Record<
  GalleryLocale,
  Record<string, string>
> = {
  "en-US": {
    photos: "Photos",
    store: "Store",
    basket: "Basket",
    favorites: "Favorites",
    about: "About",
    albums: "Albums",
    album: "Album",
    allPhotos: "All Photos",
    allPhotosFull: "All Photos",
    allPhotosSummary: "photos in the full event",
    browseGallery: "Browse Gallery",
    browseGalleryHint: "Switch between albums without using a full row of tabs. The wall will update right under this header.",
    chooseAlbumPrompt: "Choose an album from the menu to open its full photo wall.",
    privateGalleryMessage: "A private Studio OS gallery designed for your event.",
    share: "Share",
    bw: "B&W",
    bwOn: "B&W On",
    buyAll: "Buy All",
    downloadAll: "Download All",
    openStore: "Open Store",
    viewBasket: "View Basket",
    buyPhoto: "Buy Photo",
    viewPhoto: "View Photo",
    changeBackdrop: "Change Backdrop",
    closed: "Closed",
    orderingEnded: "Ordering for this gallery has ended. You can still view the photos.",
    galleryNotAvailableTitle: "Gallery Not Available",
    galleryNotAvailableBody: "This gallery is currently not available.",
    galleryClosedTitle: "Gallery Closed",
    galleryClosedBody: "This gallery is currently closed.",
    galleryExpiredTitle: "Gallery Expired",
    galleryExpiredBody: "This gallery has expired and is no longer available.",
    enterGallery: "Enter Gallery",
    selectedPhotos: "selected photos",
    downloadFavorites: "Download Favorites",
    favoritesIntro: "Download only these favorites in one step.",
    noPhotosYet: "No photos were found for this album yet.",
    orderingClosed: "Ordering Closed",
    openAlbumToDownload: "Open an album or photo view before downloading.",
    galleryDownloadsOff: "Gallery downloads are turned off for this gallery.",
    noPhotosAvailableDownload: "No photos are available to download right now.",
    freeLimitReached: "There are no free downloads remaining for this gallery.",
    galleryLinkCopied: "Gallery link copied.",
    shareSheetOpened: "Share sheet opened.",
    done: "Done",
    orderReference: "Order Reference",
    paymentComplete: "Your payment was completed and the order is now in the photographer queue.",
    receiptSentTo: "Receipt sent to",
    addToBasket: "Add to Basket",
    addAnotherProduct: "Add Another Product",
    basketReady: "Basket Ready",
    basketSavedItems: "Saved in Basket",
  },
  "en-CA": {
    photos: "Photos",
    store: "Store",
    basket: "Basket",
    favorites: "Favorites",
    about: "About",
    albums: "Albums",
    album: "Album",
    allPhotos: "All Photos",
    allPhotosFull: "All Photos",
    allPhotosSummary: "photos in the full event",
    browseGallery: "Browse Gallery",
    browseGalleryHint: "Switch between albums without using a full row of tabs. The wall will update right under this header.",
    chooseAlbumPrompt: "Choose an album from the menu to open its full photo wall.",
    privateGalleryMessage: "A private Studio OS gallery designed for your event.",
    share: "Share",
    bw: "B&W",
    bwOn: "B&W On",
    buyAll: "Buy All",
    downloadAll: "Download All",
    openStore: "Open Store",
    viewBasket: "View Basket",
    buyPhoto: "Buy Photo",
    viewPhoto: "View Photo",
    changeBackdrop: "Change Backdrop",
    closed: "Closed",
    orderingEnded: "Ordering for this gallery has ended. You can still view the photos.",
    galleryNotAvailableTitle: "Gallery Not Available",
    galleryNotAvailableBody: "This gallery is currently not available.",
    galleryClosedTitle: "Gallery Closed",
    galleryClosedBody: "This gallery is currently closed.",
    galleryExpiredTitle: "Gallery Expired",
    galleryExpiredBody: "This gallery has expired and is no longer available.",
    enterGallery: "Enter Gallery",
    selectedPhotos: "selected photos",
    downloadFavorites: "Download Favorites",
    favoritesIntro: "Download only these favorites in one step.",
    noPhotosYet: "No photos were found for this album yet.",
    orderingClosed: "Ordering Closed",
    openAlbumToDownload: "Open an album or photo view before downloading.",
    galleryDownloadsOff: "Gallery downloads are turned off for this gallery.",
    noPhotosAvailableDownload: "No photos are available to download right now.",
    freeLimitReached: "There are no free downloads remaining for this gallery.",
    galleryLinkCopied: "Gallery link copied.",
    shareSheetOpened: "Share sheet opened.",
    done: "Done",
    orderReference: "Order Reference",
    paymentComplete: "Your payment was completed and the order is now in the photographer queue.",
    receiptSentTo: "Receipt sent to",
    addToBasket: "Add to Basket",
    addAnotherProduct: "Add Another Product",
    basketReady: "Basket Ready",
    basketSavedItems: "Saved in Basket",
  },
  "fr-CA": {
    photos: "Photos",
    store: "Boutique",
    basket: "Panier",
    favorites: "Favoris",
    about: "Infos",
    albums: "Albums",
    album: "Album",
    allPhotos: "Toutes les photos",
    allPhotosFull: "Toutes les photos",
    allPhotosSummary: "photos dans tout l'evenement",
    browseGallery: "Parcourir la galerie",
    browseGalleryHint: "Passez d'un album a l'autre sans utiliser une longue rangee d'onglets. La grille se mettra a jour juste sous cet en-tete.",
    chooseAlbumPrompt: "Choisissez un album dans le menu pour ouvrir sa galerie complete.",
    privateGalleryMessage: "Une galerie Studio OS privee creee pour votre evenement.",
    share: "Partager",
    bw: "N&B",
    bwOn: "N&B actif",
    buyAll: "Tout acheter",
    downloadAll: "Tout telecharger",
    openStore: "Ouvrir la boutique",
    viewBasket: "Voir le panier",
    buyPhoto: "Acheter la photo",
    viewPhoto: "Voir la photo",
    changeBackdrop: "Changer le decor",
    closed: "Ferme",
    orderingEnded: "Les commandes pour cette galerie sont terminees. Vous pouvez toujours voir les photos.",
    galleryNotAvailableTitle: "Galerie indisponible",
    galleryNotAvailableBody: "Cette galerie n'est pas disponible pour le moment.",
    galleryClosedTitle: "Galerie fermee",
    galleryClosedBody: "Cette galerie est actuellement fermee.",
    galleryExpiredTitle: "Galerie expiree",
    galleryExpiredBody: "Cette galerie a expire et n'est plus disponible.",
    enterGallery: "Entrer dans la galerie",
    selectedPhotos: "photos selectionnees",
    downloadFavorites: "Telecharger les favoris",
    favoritesIntro: "Telechargez seulement ces favoris en une seule etape.",
    noPhotosYet: "Aucune photo n'a encore ete trouvee pour cet album.",
    orderingClosed: "Commandes fermees",
    openAlbumToDownload: "Ouvrez un album ou une photo avant de telecharger.",
    galleryDownloadsOff: "Les telechargements de la galerie sont desactives pour cette galerie.",
    noPhotosAvailableDownload: "Aucune photo n'est disponible pour le telechargement pour le moment.",
    freeLimitReached: "Il ne reste plus de telechargements gratuits pour cette galerie.",
    galleryLinkCopied: "Lien de la galerie copie.",
    shareSheetOpened: "Partage ouvert.",
    done: "Termine",
    orderReference: "Reference de commande",
    paymentComplete: "Votre paiement a ete complete et la commande est maintenant en file chez le photographe.",
    receiptSentTo: "Recu envoye a",
    addToBasket: "Ajouter au panier",
    addAnotherProduct: "Ajouter un autre produit",
    basketReady: "Panier pret",
    basketSavedItems: "Dans le panier",
  },
};

function localeFromGalleryLanguage(value: string | null | undefined): GalleryLocale {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "french" || normalized === "fr" || normalized === "fr-ca") {
    return "fr-CA";
  }
  if (normalized === "english (ca)" || normalized === "en-ca") {
    return "en-CA";
  }
  return "en-US";
}

function makeIndexedLabel(baseLabel: string, index: number, total: number): string {
  return total > 1 ? `${baseLabel} (${index} of ${total})` : baseLabel;
}

function defaultFavoriteDownloadAccess(
  settings: EventGallerySettings = defaultEventGallerySettings,
): EventFavoriteDownloadAccess {
  const enabled = settings.extras.allowClientFavoriteDownloads;
  const requiresAllDigitalsPurchase =
    settings.extras.favoriteDownloadsRequireAllDigitalsPurchase;

  return {
    enabled,
    requiresAllDigitalsPurchase,
    hasPaidDigitalOrder: false,
    hasPurchasedAllDigitals: false,
    canDownload: enabled && !requiresAllDigitalsPurchase,
    message: enabled
      ? requiresAllDigitalsPurchase
        ? "Favorites download unlocks after the full digital package is purchased."
        : null
      : "Favorites download is turned off for this gallery.",
  };
}

function defaultGalleryDownloadAccess(
  settings: EventGallerySettings = defaultEventGallerySettings,
): EventGalleryDownloadAccess {
  const enabled =
    settings.extras.freeDigitalRuleEnabled && settings.extras.showDownloadAllButton;
  const numericLimit =
    settings.extras.freeDigitalDownloadLimit === "unlimited"
      ? null
      : Math.max(0, Number.parseInt(settings.extras.freeDigitalDownloadLimit, 10) || 0);

  return {
    enabled,
    audience: settings.extras.freeDigitalAudience,
    resolution: settings.extras.freeDigitalResolution,
    downloadLimit: settings.extras.freeDigitalDownloadLimit,
    requiresPin: settings.extras.downloadPinEnabled,
    hasPinConfigured: false,
    downloadsUsed: 0,
    downloadsRemaining: numericLimit,
    canDownload: enabled && settings.extras.freeDigitalAudience !== "person",
    message: enabled
      ? settings.extras.freeDigitalAudience === "person"
        ? "Person-specific free downloads need a specific person target before they can be unlocked."
        : null
      : "Gallery downloads are turned off for this event.",
  };
}

// ── Constants ──────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://bwqhzczxoevouiondjak.supabase.co";
const NOBG_BUCKET = "nobg-photos";

const BACKDROP_CATEGORIES = [
  { key: "all", label: "All" },
  { key: "solid", label: "Solids" },
  { key: "gradient", label: "Gradients" },
  { key: "scenic", label: "Scenic" },
  { key: "holiday", label: "Holiday" },
  { key: "sports", label: "Sports" },
  { key: "custom", label: "Custom" },
];

function getGalleryFontFamily(settings: EventGallerySettings) {
  switch (settings.branding.fontPreset) {
    case "brandon":
      return '"Avenir Next", "Helvetica Neue", Helvetica, Arial, sans-serif';
    case "freeland":
      return '"Brush Script MT", "Segoe Script", cursive';
    case "baskerville":
      return 'Baskerville, "Baskerville Old Face", Garamond, serif';
    case "playfair":
      return '"Palatino Linotype", Palatino, Georgia, serif';
    case "spectral":
      return 'Cambria, Georgia, serif';
    case "montserrat":
      return '"Helvetica Neue", Arial, sans-serif';
    case "raleway":
      return '"Trebuchet MS", Arial, sans-serif';
    case "inter":
      return 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    case "quicksand":
      return '"Trebuchet MS", "Century Gothic", Arial, sans-serif';
    case "oswald":
      return 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif';
    case "pt-sans":
      return '"Gill Sans", "Segoe UI", Arial, sans-serif';
    case "lato":
      return 'Verdana, "Trebuchet MS", Arial, sans-serif';
    case "editorial-serif":
      return 'Georgia, "Times New Roman", serif';
    case "classic-contrast":
      return '"Avenir Next", "Helvetica Neue", Helvetica, Arial, sans-serif';
    default:
      return '"Helvetica Neue", Helvetica, Arial, sans-serif';
  }
}

function getGalleryTone(settings: EventGallerySettings) {
  if (settings.branding.backgroundMode === "light") {
    switch (settings.branding.tone) {
      case "graphite":
        return {
          background: "#f4f6f8",
          surface: "#ffffff",
          surfaceMuted: "rgba(15,23,42,0.05)",
          border: "#d7dde5",
          text: "#27313b",
          mutedText: "#6b7280",
          heroOverlay: "rgba(247,249,251,0.64)",
        };
      case "smoke":
        return {
          background: "#f7f7f7",
          surface: "#ffffff",
          surfaceMuted: "rgba(17,24,39,0.04)",
          border: "#e1e4e8",
          text: "#2f2f2f",
          mutedText: "#777777",
          heroOverlay: "rgba(250,250,250,0.62)",
        };
      default:
        return {
          background: "#f8f8f8",
          surface: "#ffffff",
          surfaceMuted: "rgba(17,24,39,0.04)",
          border: "#e5e7eb",
          text: "#262626",
          mutedText: "#7b7b7b",
          heroOverlay: "rgba(248,248,248,0.68)",
        };
    }
  }
  switch (settings.branding.tone) {
    case "graphite":
      return {
        background: "#0f1012",
        surface: "#17191d",
        surfaceMuted: "rgba(255,255,255,0.05)",
        border: "#23262b",
        text: "#c8ccd2",
        mutedText: "#8f97a3",
        heroOverlay: "rgba(8,9,11,0.58)",
      };
    case "smoke":
      return {
        background: "#141414",
        surface: "#1d1d1d",
        surfaceMuted: "rgba(255,255,255,0.06)",
        border: "#2d2d2d",
        text: "#cdcdcd",
        mutedText: "#9b9b9b",
        heroOverlay: "rgba(16,16,16,0.5)",
      };
    default:
      return {
        background: "#080808",
        surface: "#111111",
        surfaceMuted: "rgba(255,255,255,0.04)",
        border: "#1a1a1a",
        text: "#cfcfcf",
        mutedText: "#8f8f8f",
        heroOverlay: "rgba(6,6,6,0.62)",
      };
  }
}

function getGalleryAccent(settings: EventGallerySettings) {
  switch (settings.branding.accentColor) {
    case "champagne":
      return {
        solid: "#c4a574",
        strong: "#a78758",
        muted: "rgba(196,165,116,0.18)",
        border: "rgba(196,165,116,0.34)",
        text: "#f3e7d2",
      };
    case "ivory":
      return {
        solid: "#f2ede5",
        strong: "#d9d0c1",
        muted: "rgba(242,237,229,0.16)",
        border: "rgba(242,237,229,0.28)",
        text: "#fffaf2",
      };
    default:
      return {
        solid: "#991b1b",
        strong: "#b91c1c",
        muted: "rgba(153,27,27,0.18)",
        border: "rgba(153,27,27,0.34)",
        text: "#fee2e2",
      };
  }
}

function getHeroOverlayOpacity(settings: EventGallerySettings) {
  switch (settings.branding.heroOverlayStrength) {
    case "soft":
      return settings.branding.backgroundMode === "light"
        ? "rgba(255,255,255,0.18)"
        : "rgba(0,0,0,0.18)";
    case "dramatic":
      return settings.branding.backgroundMode === "light"
        ? "rgba(255,255,255,0.42)"
        : "rgba(0,0,0,0.5)";
    default:
      return settings.branding.backgroundMode === "light"
        ? "rgba(255,255,255,0.3)"
        : "rgba(0,0,0,0.34)";
  }
}

function formatEventDateLabel(value: string | null | undefined) {
  const raw = clean(value);
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat("en-CA", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function isProtectedAccessMode(
  value: string | null | undefined,
  pin: string | null | undefined,
) {
  const normalized = clean(value).toLowerCase();
  return normalized === "pin" || normalized === "private" || !!clean(pin);
}

function compactCountLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function usesSerifHero(fontPreset: EventGallerySettings["branding"]["fontPreset"]) {
  return ["editorial-serif", "baskerville", "playfair", "spectral"].includes(fontPreset);
}

function getGalleryGap(settings: EventGallerySettings) {
  switch (settings.branding.imageSpacing) {
    case "airy":
      return 12;
    case "tight":
      return 4;
    default:
      return 8;
  }
}

function getViewerPadding(settings: EventGallerySettings) {
  switch (settings.branding.imageSpacing) {
    case "airy":
      return "26px 60px 18px";
    case "tight":
      return "12px 44px 6px";
    default:
      return "18px 52px 10px";
  }
}

function getThumbnailSize(settings: EventGallerySettings) {
  switch (settings.branding.gridDensity) {
    case "airy":
      return 82;
    case "tight":
      return 64;
    default:
      return 72;
  }
}

function getFavoritesMinWidth(settings: EventGallerySettings) {
  switch (settings.branding.gridDensity) {
    case "airy":
      return 230;
    case "tight":
      return 170;
    default:
      return 200;
  }
}

function getSlotGridColumns(settings: EventGallerySettings) {
  switch (settings.branding.gridDensity) {
    case "airy":
      return "repeat(3, minmax(0, 1fr))";
    case "tight":
      return "repeat(5, minmax(0, 1fr))";
    default:
      return "repeat(4, minmax(0, 1fr))";
  }
}

function getPhotoGridMinWidth(settings: EventGallerySettings) {
  switch (settings.branding.gridDensity) {
    case "airy":
      return 280;
    case "tight":
      return 170;
    default:
      return 220;
  }
}

function getPhotoWallColumnWidth(settings: EventGallerySettings) {
  switch (settings.branding.gridDensity) {
    case "airy":
      return 320;
    case "tight":
      return 210;
    default:
      return 260;
  }
}

function getCascadeAspectRatio(index: number) {
  const sequence = [0.78, 1.24, 0.92, 1.38, 0.84, 1.06, 1.18, 0.88];
  return sequence[index % sequence.length];
}

function getEditorialAspectRatio(index: number) {
  const sequence = [0.82, 1.25, 1.06, 0.92, 1.34, 0.86, 1.12, 0.98];
  return sequence[index % sequence.length];
}

// ── Category config ────────────────────────────────────────────────────────
type TileConfig = {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }> | null;
  keywords: string[];
};

const TILES: TileConfig[] = [
  {
    key: "package",
    label: "Packages",
    icon: Package,
    keywords: ["package"],
  },
  {
    key: "print",
    label: "Prints",
    icon: Printer,
    keywords: ["print"],
  },
  {
    key: "digital",
    label: "Digitals",
    icon: Download,
    keywords: ["digital", "download", "usb"],
  },
  {
    key: "specialty",
    label: "Specialty Items",
    icon: Sparkles,
    keywords: ["specialty", "magnet", "mug", "ornament", "coaster", "puzzle"],
  },
  { key: "metal", label: "Metal Prints", icon: null, keywords: ["metal"] },
  { key: "canvas", label: "Canvases", icon: null, keywords: ["canvas"] },
];

// ── Helpers ────────────────────────────────────────────────────────────────
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

function uniq(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    const cleaned = clean(value);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    next.push(cleaned);
  }
  return next;
}

function withGalleryImageKey(url: string, mediaId: string, variant: string, candidateIndex: number) {
  void mediaId;
  void variant;
  void candidateIndex;
  return url;
}

function buildGalleryImageCandidates(
  image: GalleryImage,
  variant: "wall" | "viewer-thumb" | "viewer-main",
) {
  const rawCandidates =
    variant === "wall"
      ? uniq([image.previewUrl, image.downloadUrl, image.url, image.thumbnailUrl])
      : variant === "viewer-thumb"
        ? uniq([image.previewUrl, image.downloadUrl, image.thumbnailUrl, image.url])
        : uniq([image.downloadUrl, image.previewUrl, image.thumbnailUrl, image.url]);

  return rawCandidates.map((url, candidateIndex) =>
    withGalleryImageKey(url, image.id, variant, candidateIndex),
  );
}

function buildBackdropImageCandidates(backdrop: Pick<BackdropRow, "id" | "thumbnail_url" | "image_url">) {
  return uniq([backdrop.thumbnail_url, backdrop.image_url]).map((url, candidateIndex) =>
    withGalleryImageKey(url, backdrop.id, "viewer-thumb", candidateIndex),
  );
}

function handleGalleryImageError(event: SyntheticEvent<HTMLImageElement>) {
  const target = event.currentTarget;
  const candidates = (target.dataset.candidates || "")
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);
  const currentIndex = Number(target.dataset.candidateIndex || "0");
  const nextCandidate = candidates[currentIndex + 1];

  if (nextCandidate) {
    target.dataset.candidateIndex = String(currentIndex + 1);
    target.src = nextCandidate;
    return;
  }

  target.style.opacity = "0";
}

function handleBackdropImageError(event: SyntheticEvent<HTMLImageElement>) {
  const target = event.currentTarget;
  const candidates = (target.dataset.candidates || "")
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);
  const currentIndex = Number(target.dataset.candidateIndex || "0");
  const nextCandidate = candidates[currentIndex + 1];

  if (nextCandidate) {
    target.dataset.candidateIndex = String(currentIndex + 1);
    target.src = nextCandidate;
    return;
  }

  target.style.opacity = "0";
}

function shouldIgnoreGalleryKeyboardEvent(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select"
  );
}

function formatPackageItem(item: PackageItemValue): string {
  if (typeof item === "string") return item;
  const qty =
    item.qty !== undefined &&
    item.qty !== null &&
    String(item.qty).trim() !== ""
      ? `${item.qty} `
      : "";
  const name = item.name?.trim() || "";
  const type = item.type?.trim() || "";
  const size = item.size?.trim() || "";
  const finish = item.finish?.trim() || "";
  return [qty + name, type, size, finish].filter(Boolean).join(" · ").trim() || "Package item";
}

function folderFromPhotoUrl(photoUrl: string): string | null {
  try {
    const storagePath = extractStoragePathFromSupabaseUrl(photoUrl);
    if (!storagePath) return null;
    const parts = storagePath.split("/");
    if (parts.length < 2) return null;
    return parts.slice(0, parts.length - 1).join("/");
  } catch {
    return null;
  }
}

function favoriteStorageKey(projectId: string | null | undefined, email: string | null | undefined, pin: string | null | undefined) {
  const safeProjectId = clean(projectId);
  const safeEmail = clean(email).toLowerCase();
  const safePin = clean(pin);
  if (!safeProjectId || !safeEmail || !safePin) return "";
  return `event-favorites:${safeProjectId}:${safeEmail}:${safePin}`;
}

function readStoredFavorites(key: string): Set<string> {
  if (!key || typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((value) => clean(String(value))).filter(Boolean));
  } catch {
    return new Set();
  }
}

function writeStoredFavorites(key: string, values: Iterable<string>) {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(Array.from(values)));
  } catch {
    // Ignore storage errors and keep the in-memory state.
  }
}

function eventWallRatioStorageKey(projectId: string, email: string, pin: string) {
  const safeProjectId = clean(projectId);
  const safeEmail = clean(email).toLowerCase();
  const safePin = clean(pin);
  if (!safeProjectId || !safeEmail || !safePin) return "";
  return `event-wall-ratios:${safeProjectId}:${safeEmail}:${safePin}`;
}

function readStoredEventWallRatios(key: string) {
  if (!key || typeof window === "undefined") return {} as Record<string, number>;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {} as Record<string, number>;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const nextEntries = Object.entries(parsed)
      .map(([id, value]) => [id, getEventWallAspectRatio(Number(value))] as const)
      .filter(([, value]) => Number.isFinite(value));
    return Object.fromEntries(nextEntries);
  } catch {
    return {} as Record<string, number>;
  }
}

function writeStoredEventWallRatios(key: string, values: Record<string, number>) {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(values));
  } catch {
    // Ignore storage errors and keep the in-memory state.
  }
}

function fileNameFromUrl(url: string, fallback = "photo.jpg") {
  try {
    const pathname = new URL(url).pathname;
    const lastSegment = pathname.split("/").pop() || "";
    return decodeURIComponent(lastSegment) || fallback;
  } catch {
    return fallback;
  }
}

function preferredDownloadUrl(
  image: Pick<GalleryImage, "downloadUrl" | "previewUrl" | "thumbnailUrl" | "url">,
  resolution: EventGallerySettings["extras"]["freeDigitalResolution"],
) {
  const candidates =
    resolution === "web"
      ? [image.thumbnailUrl, image.previewUrl, image.downloadUrl, image.url]
      : resolution === "large"
        ? [image.previewUrl, image.downloadUrl, image.thumbnailUrl, image.url]
        : [image.downloadUrl, image.previewUrl, image.thumbnailUrl, image.url];

  return candidates.map((value) => clean(value)).find(Boolean) || "";
}

type EventWallRow = {
  height: number;
  items: Array<{
    image: GalleryImage;
    index: number;
    aspectRatio: number;
    width: number;
  }>;
};

const EVENT_WALL_FALLBACK_ASPECT_RATIO = 1;
const MIN_EVENT_WALL_ASPECT_RATIO = 0.56;
const MAX_EVENT_WALL_ASPECT_RATIO = 2.35;

function getSafeAspectRatio(width?: number | null, height?: number | null) {
  if (!width || !height) return null;
  const ratio = width / height;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return ratio;
}

function getEventWallAspectRatio(value?: number | null) {
  return clampNumber(
    value && Number.isFinite(value) ? value : EVENT_WALL_FALLBACK_ASPECT_RATIO,
    MIN_EVENT_WALL_ASPECT_RATIO,
    MAX_EVENT_WALL_ASPECT_RATIO,
  );
}

function buildEventPhotoRows(
  images: GalleryImage[],
  aspectRatios: Record<string, number>,
  containerWidth: number,
  gap: number,
  targetRowHeight: number,
) {
  const safeContainerWidth = Math.max(320, Math.floor(containerWidth));
  const safeGap = Math.max(10, Math.round(gap));
  const minRowHeight = Math.max(170, Math.round(targetRowHeight * 0.76));
  const maxRowHeight = Math.max(minRowHeight + 24, Math.round(targetRowHeight * 1.18));
  const rows: EventWallRow[] = [];
  let currentRow: Array<{
    image: GalleryImage;
    index: number;
    aspectRatio: number;
  }> = [];
  let currentRatioTotal = 0;

  const commitRow = (justify: boolean) => {
    if (!currentRow.length) return;
    const rowGapWidth = safeGap * Math.max(0, currentRow.length - 1);
    const nextHeight =
      justify && currentRow.length > 1
        ? (safeContainerWidth - rowGapWidth) / currentRatioTotal
        : targetRowHeight;
    const rowHeight = clampNumber(nextHeight, minRowHeight, maxRowHeight);
    rows.push({
      height: rowHeight,
      items: currentRow.map((item) => ({
        ...item,
        width: Math.max(94, Math.round(rowHeight * item.aspectRatio)),
      })),
    });
    currentRow = [];
    currentRatioTotal = 0;
  };

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const aspectRatio = getEventWallAspectRatio(aspectRatios[image.id]);
    currentRow.push({ image, index, aspectRatio });
    currentRatioTotal += aspectRatio;

    const isLastImage = index === images.length - 1;
    const rowGapWidth = safeGap * Math.max(0, currentRow.length - 1);
    const projectedWidth = currentRatioTotal * targetRowHeight + rowGapWidth;
    const shouldJustify = currentRow.length > 1 && projectedWidth >= safeContainerWidth;

    if (shouldJustify) {
      const justifiedHeight = (safeContainerWidth - rowGapWidth) / currentRatioTotal;
      if (currentRow.length > 2 && justifiedHeight < minRowHeight) {
        const overflowImage = currentRow.pop();
        if (overflowImage) {
          currentRatioTotal -= overflowImage.aspectRatio;
          commitRow(true);
          currentRow.push(overflowImage);
          currentRatioTotal += overflowImage.aspectRatio;
        } else {
          commitRow(true);
        }
      } else {
        commitRow(true);
      }
    }

    if (isLastImage) {
      commitRow(false);
    }
  }

  return rows;
}

function getGalleryActionErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const message = clean(error.message);
  if (!message) return fallback;
  const normalized = message.toLowerCase();
  if (
    normalized === "load failed"
    || normalized === "failed to fetch"
    || normalized.includes("networkerror")
    || normalized.includes("network request failed")
  ) {
    return fallback;
  }
  return message;
}

function buildArchiveBaseName(value: string, fallback: string) {
  const cleaned = clean(value)
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

function uniqueDownloadName(name: string, usedNames: Map<string, number>) {
  const cleaned = clean(name) || "download";
  const lastDot = cleaned.lastIndexOf(".");
  const base = lastDot > 0 ? cleaned.slice(0, lastDot) : cleaned;
  const ext = lastDot > 0 ? cleaned.slice(lastDot) : "";
  const nextCount = (usedNames.get(cleaned) ?? 0) + 1;
  usedNames.set(cleaned, nextCount);
  return nextCount === 1 ? cleaned : `${base}-${nextCount}${ext}`;
}

async function imageElementFromBlob(blob: Blob) {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Could not load image for download."));
      element.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function imageElementFromUrl(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Could not load studio logo for download.");
  }
  return imageElementFromBlob(await response.blob());
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType = "image/jpeg",
  quality?: number,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((nextBlob) => {
      if (nextBlob) resolve(nextBlob);
      else reject(new Error("Could not prepare the download file."));
    }, mimeType, quality);
  });
}

function buildPdfFromJpegBytes(imageBytes: Uint8Array, width: number, height: number) {
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const offsets: number[] = [];
  let size = 0;

  const push = (value: string | Uint8Array) => {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    const chunk = new Uint8Array(bytes.byteLength);
    chunk.set(bytes);
    parts.push(chunk);
    size += bytes.length;
  };

  push("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n");

  offsets.push(size);
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  offsets.push(size);
  push("2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n");

  offsets.push(size);
  push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
  );

  offsets.push(size);
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`,
  );
  push(imageBytes);
  push("\nendstream\nendobj\n");

  const contentStream = `q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`;
  offsets.push(size);
  push(
    `5 0 obj\n<< /Length ${encoder.encode(contentStream).length} >>\nstream\n${contentStream}endstream\nendobj\n`,
  );

  const xrefOffset = size;
  push(`xref\n0 6\n0000000000 65535 f \n`);
  for (const offset of offsets) {
    push(`${offset.toString().padStart(10, "0")} 00000 n \n`);
  }
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return new Blob(parts, { type: "application/pdf" });
}

async function createPrintReleasePdf(options: {
  studioName: string;
  galleryName: string;
  replyTo: string;
  logoUrl: string;
}) {
  const canvas = document.createElement("canvas");
  canvas.width = 1240;
  canvas.height = 1754;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not prepare print release.");
  }

  context.fillStyle = "#f7f7f5";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#111111";
  context.fillRect(0, 0, canvas.width, 200);

  let cursorY = 90;
  const safeLogoUrl = clean(options.logoUrl);
  if (safeLogoUrl) {
    try {
      const logo = await imageElementFromUrl(safeLogoUrl);
      const logoWidth = 280;
      const ratio =
        (logo.naturalWidth || logo.width) / Math.max(1, logo.naturalHeight || logo.height);
      const logoHeight = logoWidth / ratio;
      context.drawImage(logo, 90, 56, logoWidth, logoHeight);
      cursorY = 240;
    } catch {
      cursorY = 220;
    }
  } else {
    cursorY = 220;
  }

  context.fillStyle = "#111111";
  context.font = "700 46px Arial, sans-serif";
  context.fillText("Print Release", 90, cursorY);
  cursorY += 42;
  context.fillStyle = "#4b5563";
  context.font = "600 22px Arial, sans-serif";
  context.fillText(clean(options.studioName) || "Studio OS", 90, cursorY);
  cursorY += 56;

  const detailLines = [
    `Gallery: ${clean(options.galleryName) || "Event Gallery"}`,
    options.replyTo ? `Reply-to: ${options.replyTo}` : "",
    `Issued: ${new Date().toLocaleDateString()}`,
  ].filter(Boolean);

  context.fillStyle = "#111111";
  context.font = "500 24px Arial, sans-serif";
  for (const line of detailLines) {
    context.fillText(line, 90, cursorY);
    cursorY += 36;
  }

  cursorY += 30;
  context.strokeStyle = "#d4d4d8";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(90, cursorY);
  context.lineTo(canvas.width - 90, cursorY);
  context.stroke();
  cursorY += 70;

  context.fillStyle = "#18181b";
  context.font = "500 30px Arial, sans-serif";
  const paragraphs = [
    "This print release grants the recipient permission to make personal print reproductions of the downloaded images from this gallery.",
    "This release does not include commercial use, resale, redistribution, editing for third parties, publication, or transfer of copyright unless separately licensed in writing by the studio.",
    "Please retain this release with your downloaded files for your records.",
  ];

  const maxWidth = canvas.width - 180;
  const lineHeight = 42;
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/);
    let line = "";
    for (const word of words) {
      const nextLine = line ? `${line} ${word}` : word;
      if (context.measureText(nextLine).width > maxWidth && line) {
        context.fillText(line, 90, cursorY);
        cursorY += lineHeight;
        line = word;
      } else {
        line = nextLine;
      }
    }
    if (line) {
      context.fillText(line, 90, cursorY);
      cursorY += lineHeight;
    }
    cursorY += 22;
  }

  context.fillStyle = "#52525b";
  context.font = "italic 24px Arial, sans-serif";
  context.fillText("Studio OS Galleries", 90, canvas.height - 110);

  const jpegBlob = await canvasToBlob(canvas, "image/jpeg", 0.92);
  const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
  return buildPdfFromJpegBytes(jpegBytes, canvas.width, canvas.height);
}

async function addWatermarkToBlob(
  blob: Blob,
  options: {
    watermarkText: string;
    logoImage?: HTMLImageElement | null;
  },
) {
  if (!blob.type.startsWith("image/")) {
    return blob;
  }

  const image = await imageElementFromBlob(blob);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d");
  if (!context) {
    return blob;
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (options.logoImage) {
    const logo = options.logoImage;
    const drawWidth = Math.max(120, Math.round(canvas.width / 5));
    const ratio =
      (logo.naturalWidth || logo.width) / Math.max(1, logo.naturalHeight || logo.height);
    const drawHeight = drawWidth / ratio;
    const stepX = Math.max(drawWidth * 1.6, 240);
    const stepY = Math.max(drawHeight * 1.7, 180);
    context.save();
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((-24 * Math.PI) / 180);
    context.globalAlpha = 0.12;
    for (let y = -canvas.height; y <= canvas.height; y += stepY) {
      for (let x = -canvas.width; x <= canvas.width; x += stepX) {
        context.drawImage(logo, x, y, drawWidth, drawHeight);
      }
    }
    context.restore();
  } else {
    const text = clean(options.watermarkText) || "PROOF";
    const fontSize = Math.max(24, Math.round(canvas.width / 18));
    context.save();
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((-28 * Math.PI) / 180);
    context.fillStyle = "rgba(220, 38, 38, 0.16)";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `700 ${fontSize}px Arial, sans-serif`;

    const stepX = Math.max(fontSize * 3.6, 260);
    const stepY = Math.max(fontSize * 2.2, 180);
    for (let y = -canvas.height; y <= canvas.height; y += stepY) {
      for (let x = -canvas.width; x <= canvas.width; x += stepX) {
        context.fillText(text, x, y);
      }
    }
    context.restore();
  }

  const mimeType = blob.type === "image/png" ? "image/png" : "image/jpeg";
  return canvasToBlob(canvas, mimeType, mimeType === "image/jpeg" ? 0.92 : undefined);
}

function triggerDownloadBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
}

function normalizeStorageFolder(path: string): string {
  return path
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

function uniqueFolders(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const folder = normalizeStorageFolder(value ?? "");
    if (!folder || seen.has(folder)) continue;
    seen.add(folder);
    out.push(folder);
  }
  return out;
}

function isImageFileName(name: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(name);
}

function getCategory(pkg: PackageRow): string {
  return getPackageCategory(pkg);
}

function packageSearchText(pkg: PackageRow): string {
  const itemText = (pkg.items ?? []).map((item) => formatPackageItem(item)).join(" ");
  return [pkg.name, pkg.description, pkg.category, itemText]
    .map((value) => clean(value).toLowerCase())
    .filter(Boolean)
    .join(" ");
}

function extractPackageSizes(pkg: PackageRow): Array<{ width: number; height: number }> {
  const matches = packageSearchText(pkg).matchAll(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/g);
  const sizes: Array<{ width: number; height: number }> = [];
  for (const match of matches) {
    const width = Number.parseFloat(match[1] ?? "");
    const height = Number.parseFloat(match[2] ?? "");
    if (Number.isFinite(width) && Number.isFinite(height)) {
      sizes.push({ width, height });
    }
  }
  return sizes;
}

function isCompositeGalleryImage(image: GalleryImage | null | undefined) {
  return image?.source === "composite";
}

function compositeImageTitle(
  filename: string | null | undefined,
  fallback: string | null | undefined,
) {
  const cleaned = clean(filename);
  if (!cleaned) return fallback || "Class Composite";
  const withoutExt = cleaned.replace(/\.[^.]+$/, "").trim();
  const friendly = withoutExt
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return friendly || fallback || "Class Composite";
}

function isCompositeEligiblePackage(pkg: PackageRow): boolean {
  const category = getCategory(pkg);
  if (category === "digital" || category === "package" || category === "specialty") {
    return false;
  }

  const text = packageSearchText(pkg);
  if (!text) return false;
  if (/\bdigital\b|\bdownload\b|\bjpeg\b|\bjpg\b|\bfile\b|\bfiles\b/.test(text)) {
    return false;
  }
  if (
    /\bwallet\b|\bmini\b|\b4\s*[x×]\s*6\b|\b5\s*[x×]\s*7\b|\b3\.5\s*[x×]\s*5\b|\b2\s*[x×]\s*3\b/.test(
      text,
    )
  ) {
    return false;
  }

  const sizes = extractPackageSizes(pkg);
  if (!sizes.length) {
    return /\b8\s*[x×]\s*10\b|\b10\s*[x×]\s*8\b|\b11\s*[x×]\s*14\b|\b14\s*[x×]\s*11\b|\b16\s*[x×]\s*20\b|\b20\s*[x×]\s*16\b|\b20\s*[x×]\s*24\b|\b24\s*[x×]\s*20\b/.test(
      text,
    );
  }

  return sizes.every(({ width, height }) => Math.min(width, height) >= 8);
}

function parseCurrencyToCents(value: string | null | undefined): number {
  const normalized = clean(value).replace(/[^0-9.]/g, "");
  if (!normalized) return 0;
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 100);
}

function isDigitalPackageText(...values: Array<string | null | undefined>) {
  const haystack = values.map((value) => clean(value).toLowerCase()).join(" ");
  return /digital|download|downloads|file|files|jpeg|jpg/.test(haystack);
}

function isAllDigitalsPackage(pkg: PackageRow) {
  const haystack = [
    clean(pkg.name).toLowerCase(),
    clean(pkg.description).toLowerCase(),
    clean(pkg.category).toLowerCase(),
  ].join(" ");
  return (
    /(all|full|entire|complete)\s+(digital|digitals|downloads|files|gallery|album|collection|photos|images)/.test(
      haystack,
    ) ||
    /(digital|downloads|files)\s+(all|full|entire|complete)/.test(haystack) ||
    /buy all/.test(haystack) ||
    (isDigitalPackageText(pkg.name, pkg.description, pkg.category) &&
      /full gallery|entire gallery|complete gallery|all photos|all images/.test(
        haystack,
      ))
  );
}

function buildSlots(pkg: PackageRow, orderQty: number = 1, compositeImageUrl?: string | null): ItemSlot[] {
  const slots: ItemSlot[] = [];
  const safeOrderQty = Math.max(1, orderQty);

  for (const item of pkg.items ?? []) {
    const baseLabel = formatPackageItem(item);
    const isComposite = typeof item === "object" && !!item.composite;
    const qty =
      typeof item === "object" && item.qty
        ? parseInt(String(item.qty), 10) || 1
        : 1;

    for (let copy = 0; copy < safeOrderQty; copy++) {
      for (let i = 0; i < qty; i++) {
        const slotIndex = copy * qty + i + 1;
        const slotTotal = qty * safeOrderQty;
        slots.push({
          label: makeIndexedLabel(baseLabel, slotIndex, slotTotal),
          assignedImageUrl: isComposite && compositeImageUrl ? compositeImageUrl : null,
          composite: isComposite,
        });
      }
    }
  }

  if (slots.length === 0) {
    for (let i = 0; i < safeOrderQty; i++) {
      slots.push({
        label: makeIndexedLabel(pkg.name, i + 1, safeOrderQty),
        assignedImageUrl: null,
      });
    }
  }

  return slots;
}

function deduplicatePackages(pkgs: PackageRow[]): PackageRow[] {
  const seen = new Set<string>();
  return pkgs.filter((pkg) => {
    const key = `${pkg.name.toLowerCase().trim()}|${pkg.price_cents}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getProjectName(project: ProjectRow | null): string {
  return project?.project_name || project?.name || project?.title || "Gallery";
}


type PreviewKind = "package" | "print" | "canvas" | "digital" | "metal" | "specialty";

const imageAspectRatioCache = new Map<string, number>();

function getPreviewKind(key: string): PreviewKind {
  if (key === "print") return "print";
  if (key === "canvas") return "canvas";
  if (key === "digital") return "digital";
  if (key === "metal") return "metal";
  if (key === "specialty") return "specialty";
  return "package";
}

function useImageAspectRatio(imageUrl?: string | null) {
  const [aspectRatio, setAspectRatio] = useState<number | null>(() => {
    if (!imageUrl) return null;
    return imageAspectRatioCache.get(imageUrl) ?? null;
  });

  useEffect(() => {
    if (!imageUrl) {
      setAspectRatio(null);
      return;
    }

    const cached = imageAspectRatioCache.get(imageUrl);
    if (cached) {
      setAspectRatio(cached);
      return;
    }

    let cancelled = false;
    const image = new Image();

    image.onload = () => {
      if (cancelled) return;
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        const nextRatio = image.naturalWidth / image.naturalHeight;
        imageAspectRatioCache.set(imageUrl, nextRatio);
        setAspectRatio(nextRatio);
        return;
      }
      setAspectRatio(null);
    };

    image.onerror = () => {
      if (!cancelled) {
        setAspectRatio(null);
      }
    };

    image.src = imageUrl;

    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  return aspectRatio;
}

function renderPhotoSurface(
  imageUrl?: string | null,
  style?: React.CSSProperties,
  imageFilter?: string,
) {
  if (!imageUrl) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04))",
          color: "rgba(255,255,255,0.55)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          ...style,
        }}
      >
        Preview
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      alt=""
      style={{
        width: "100%",
        height: "100%",
        objectFit: "contain",
        display: "block",
        filter: imageFilter,
        ...style,
      }}
    />
  );
}

function parsePrintRatio(sizeLabel?: string | null, orientation: "portrait" | "landscape" = "portrait") {
  const match = (sizeLabel ?? "").match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (!match) return orientation === "landscape" ? { w: 5, h: 4 } : { w: 4, h: 5 };
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
    return orientation === "landscape" ? { w: 5, h: 4 } : { w: 4, h: 5 };
  }
  const w = orientation === "landscape" ? Math.max(a, b) : Math.min(a, b);
  const h = orientation === "landscape" ? Math.min(a, b) : Math.max(a, b);
  return { w, h };
}

function getPrintScale(sizeLabel?: string | null) {
  const match = (sizeLabel ?? "").match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (!match) return 1;
  const a = Number(match[1]);
  const b = Number(match[2]);
  const area = a * b;
  if (area <= 35) return 0.82;
  if (area <= 80) return 1.0;
  if (area <= 160) return 1.18;
  if (area <= 320) return 1.34;
  return 1.48;
}

function getScenePrintScale(
  sizeLabel?: string | null,
  options?: { compact?: boolean; landscape?: boolean },
) {
  const match = (sizeLabel ?? "").match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  const compactFactor = options?.compact ? 0.76 : 1;
  const landscapeFactor = options?.landscape ? 1.08 : 1;

  if (!match) {
    return 1.08 * compactFactor * landscapeFactor;
  }

  const a = Number(match[1]);
  const b = Number(match[2]);
  const area = a * b;

  let scale = 1.08;
  if (area <= 35) scale = 1.02;
  else if (area <= 80) scale = 1.24;
  else if (area <= 160) scale = 1.54;
  else if (area <= 320) scale = 1.88;
  else scale = 2.18;

  return scale * compactFactor * landscapeFactor;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getEffectiveBackdropBlurPx(blurPx?: number | null) {
  if (!blurPx || !Number.isFinite(blurPx) || blurPx <= 0) return 0;
  return Math.round(blurPx * BACKDROP_BLUR_INTENSITY_MULTIPLIER);
}

function getBackdropCompositeSize(imageAspectRatio?: number | null) {
  const safeAspect =
    imageAspectRatio && Number.isFinite(imageAspectRatio)
      ? clampNumber(imageAspectRatio, 0.62, 1.45)
      : 0.78;
  const height = safeAspect < 0.98 ? 1280 : 1120;
  return {
    width: Math.round(height * safeAspect),
    height,
  };
}

function getBackdropForegroundScale(imageAspectRatio?: number | null) {
  if (!imageAspectRatio || !Number.isFinite(imageAspectRatio)) return 0.98;
  if (imageAspectRatio < 0.7) return 1.02;
  if (imageAspectRatio < 0.85) return 1.01;
  if (imageAspectRatio < 1.05) return 1;
  return 1;
}

function getBackdropForegroundVerticalOffset(imageAspectRatio?: number | null) {
  if (!imageAspectRatio || !Number.isFinite(imageAspectRatio)) return 0.076;
  if (imageAspectRatio < 0.7) return 0.116;
  if (imageAspectRatio < 0.85) return 0.098;
  if (imageAspectRatio < 1.05) return 0.078;
  return 0.058;
}

function renderPremiumMockup(
  kind: PreviewKind,
  imageUrl?: string | null,
  variant = 0,
  compact = false,
  sizeLabel?: string | null,
  imageFilter?: string,
  imageAspectRatio?: number | null,
  isCompositeArtwork = false,
) {
  const isLandscapePhoto = (imageAspectRatio ?? 0) > 1.04;
  const sizeMatch = (sizeLabel ?? "").match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  const sizeArea = sizeMatch ? Number(sizeMatch[1]) * Number(sizeMatch[2]) : 80;
  const ratio = parsePrintRatio(sizeLabel, isLandscapePhoto ? "landscape" : "portrait");
  const compositeSceneBoost =
    isCompositeArtwork && kind !== "package" && kind !== "digital" && kind !== "specialty"
      ? kind === "print"
        ? sizeArea <= 80
          ? variant === 0
            ? compact
              ? 1.28
              : 1.24
            : variant === 1
            ? compact
              ? 1.22
              : 1.18
            : compact
            ? 1.18
            : 1.14
          : sizeArea <= 160
          ? variant === 0
            ? compact
              ? 1.22
              : 1.18
            : variant === 1
            ? compact
              ? 1.17
              : 1.13
            : compact
            ? 1.14
            : 1.1
          : variant === 0
          ? compact
            ? 1.18
            : 1.14
          : variant === 1
          ? compact
            ? 1.14
            : 1.1
          : compact
          ? 1.1
          : 1.08
        : kind === "metal"
        ? sizeArea <= 160
          ? compact
            ? 1.16
            : 1.12
          : compact
          ? 1.12
          : 1.08
        : compact
        ? 1.1
        : 1.06
      : 1;
  const sizeScale =
    kind === "print"
      ? getScenePrintScale(sizeLabel, { compact, landscape: isLandscapePhoto })
      : getPrintScale(sizeLabel);
  const sceneScale = sizeScale * compositeSceneBoost;
  const shell: React.CSSProperties = {
    width: "100%",
    height: "100%",
    position: "relative",
    overflow: "hidden",
    borderRadius: compact ? 14 : 18,
    background:
      kind === "digital"
        ? "linear-gradient(180deg, #10131a 0%, #1e2431 100%)"
        : kind === "metal"
        ? "linear-gradient(180deg, #dadfe5 0%, #c4cbd3 100%)"
        : kind === "canvas"
        ? "linear-gradient(180deg, #efe7dc 0%, #ddd2c5 100%)"
        : kind === "specialty"
        ? "linear-gradient(180deg, #f2efeb 0%, #ddd7d0 100%)"
        : "linear-gradient(180deg, #f5f2ee 0%, #e5dfd7 100%)",
  };

  const sceneBackground = (src: string, backgroundPosition = "center") => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage: `url(${src})`,
        backgroundSize: "cover",
        backgroundPosition,
        backgroundRepeat: "no-repeat",
      }}
    />
  );

  const framedPhoto = (
    photoStyle: React.CSSProperties,
    frameStyle?: React.CSSProperties,
    innerStyle?: React.CSSProperties,
    extra?: React.ReactNode
  ) => (
    <div
      style={{
        position: "absolute",
        ...photoStyle,
        background: "transparent",
        overflow: "hidden",
        boxShadow: "0 18px 40px rgba(25,25,25,0.22)",
        ...frameStyle,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          background: "transparent",
          ...innerStyle,
        }}
      >
        {renderPhotoSurface(
          imageUrl,
          { objectFit: "cover", objectPosition: "center center" },
          imageFilter,
        )}
      </div>
      {extra}
    </div>
  );

  const frameStyleAt = (
    baseWidth: number,
    verticalOffset: { top?: string; bottom?: string },
    anchorPercent: number,
    anchor: "left" | "center",
    landscapeBoost = 1.72,
  ) => {
    const baseScaledWidth = baseWidth * sceneScale;
    const width = isLandscapePhoto ? baseScaledWidth * landscapeBoost : baseScaledWidth;
    const left = anchor === "center"
      ? anchorPercent - width / 2
      : anchorPercent - (isLandscapePhoto ? (width - baseScaledWidth) * 0.24 : 0);

    return {
      left: `${left}%`,
      ...verticalOffset,
      width: `${width}%`,
      aspectRatio: `${ratio.w} / ${ratio.h}`,
      height: "auto",
      borderRadius: compact ? 2 : 3,
      padding: 0,
    } as React.CSSProperties;
  };

  const centeredFrameStyle = (
    baseWidth: number,
    verticalOffset: { top?: string; bottom?: string },
    centerPercent: number,
    landscapeBoost?: number,
  ) => frameStyleAt(baseWidth, verticalOffset, centerPercent, "center", landscapeBoost);

  const anchoredFrameStyle = (
    baseWidth: number,
    verticalOffset: { top?: string; bottom?: string },
    leftPercent: number,
    landscapeBoost?: number,
  ) => frameStyleAt(baseWidth, verticalOffset, leftPercent, "left", landscapeBoost);

  if (kind === "package") {
    return (
      <div style={shell}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at top, rgba(255,255,255,0.88), rgba(255,255,255,0.18) 42%, transparent 72%)",
          }}
        />
        {[0, 1, 2].map((idx) => (
          <div
            key={idx}
            style={{
              position: "absolute",
              width: compact ? 78 : 106,
              height: compact ? 104 : 142,
              top: compact ? 26 + idx * 4 : 28 + idx * 6,
              left: compact
                ? idx === 0
                  ? 18
                  : idx === 1
                  ? 58
                  : 100
                : idx === 0
                ? 26
                : idx === 1
                ? 86
                : 146,
              transform:
                idx === 0 ? "rotate(-8deg)" : idx === 1 ? "rotate(0deg)" : "rotate(8deg)",
              borderRadius: 14,
              background: "#fff",
              padding: compact ? 6 : 8,
              boxShadow: "0 18px 36px rgba(20,20,20,0.16)",
            }}
          >
            <div style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: 8 }}>
              {renderPhotoSurface(imageUrl)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (kind === "digital") {
    return (
      <div style={shell}>
        <div
          style={{
            position: "absolute",
            inset: compact ? "18% 12% 22%" : "14% 10% 24%",
            borderRadius: 16,
            background: "#121722",
            boxShadow: "0 20px 40px rgba(0,0,0,0.35)",
            padding: compact ? 8 : 12,
          }}
        >
          <div style={{ width: "100%", height: "100%", borderRadius: 10, overflow: "hidden", background: "#0c111a" }}>
            {renderPhotoSurface(imageUrl)}
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: compact ? 24 : 18,
            transform: "translateX(-50%)",
            width: compact ? 90 : 120,
            height: compact ? 10 : 12,
            borderRadius: 999,
            background: "rgba(255,255,255,0.18)",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: compact ? 16 : 18,
            top: compact ? 16 : 18,
            background: "rgba(255,255,255,0.12)",
            color: "#fff",
            borderRadius: 999,
            padding: compact ? "5px 8px" : "6px 10px",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Instant
        </div>
      </div>
    );
  }

  if (kind === "specialty") {
    return (
      <div style={shell}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(255,255,255,0.6), rgba(255,255,255,0.08))",
          }}
        />
        <div style={{ position: "absolute", left: compact ? 18 : 24, bottom: compact ? 24 : 26 }}>
          <div
            style={{
              width: compact ? 66 : 84,
              height: compact ? 74 : 94,
              borderRadius: 14,
              background: "#fff",
              padding: 7,
              boxShadow: "0 12px 30px rgba(40,40,40,0.18)",
              transform: variant % 2 === 0 ? "rotate(-7deg)" : "rotate(0deg)",
            }}
          >
            <div style={{ width: "100%", height: "100%", borderRadius: 10, overflow: "hidden" }}>
              {renderPhotoSurface(imageUrl)}
            </div>
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            right: compact ? 22 : 28,
            top: compact ? 24 : 28,
            width: compact ? 62 : 78,
            height: compact ? 62 : 78,
            borderRadius: 999,
            background: "#f4efe8",
            boxShadow: "0 12px 24px rgba(40,40,40,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <div style={{ width: "72%", height: "72%", borderRadius: 999, overflow: "hidden" }}>
            {renderPhotoSurface(imageUrl)}
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            right: compact ? 16 : 20,
            bottom: compact ? 18 : 22,
            width: compact ? 76 : 96,
            height: compact ? 56 : 74,
            borderRadius: 14,
            background: "#fff",
            boxShadow: "0 14px 24px rgba(40,40,40,0.16)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#8b7e71",
            fontSize: compact ? 10 : 12,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Gift
        </div>
      </div>
    );
  }

  if (variant === 0) {
    const wallLandscapeBoost = isCompositeArtwork ? (compact ? 1.08 : 1.12) : (compact ? 1.62 : 1.72);
    return (
      <div style={shell}>
        {sceneBackground("/mockups/prints/wall.jpg")}
        {framedPhoto(
          compact
            ? { ...centeredFrameStyle(9.8, { top: "4%" }, 48, wallLandscapeBoost), maxWidth: "52%", maxHeight: "78%" }
            : { ...centeredFrameStyle(8.2, { top: "3%" }, 48, wallLandscapeBoost), maxWidth: "52%", maxHeight: "78%" },
          {
            background: "transparent",
            boxShadow:
              kind === "canvas"
                ? "0 22px 42px rgba(25,25,25,0.22)"
                : "0 16px 34px rgba(25,25,25,0.20)",
          },
          {
            background: "transparent",
            borderRadius: kind === "canvas" ? (compact ? 2 : 3) : 2,
          }
        )}
      </div>
    );
  }

  if (variant === 1) {
    const deskLandscapeBoost = isCompositeArtwork ? (compact ? 1.04 : 1.08) : (compact ? 1.32 : 1.42);
    return (
      <div style={shell}>
        {sceneBackground("/mockups/prints/desktop.jpg", compact ? "center 56%" : "center 58%")}
        {framedPhoto(
          compact
            ? { ...centeredFrameStyle(11.5, { top: "22%" }, 68, deskLandscapeBoost), maxWidth: "48%", maxHeight: "68%" }
            : { ...centeredFrameStyle(9.5, { top: "20%" }, 66, deskLandscapeBoost), maxWidth: "48%", maxHeight: "68%" },
          {
            background: "transparent",
            boxShadow:
              kind === "canvas"
                ? "0 12px 28px rgba(25,25,25,0.22)"
                : "0 14px 28px rgba(25,25,25,0.20)",
            transform: compact ? "rotate(-2deg)" : "rotate(-2.5deg)",
          },
          { background: "transparent", borderRadius: kind === "canvas" ? (compact ? 2 : 3) : 2 }
        )}
      </div>
    );
  }

  if (kind === "canvas") {
    return (
      <div style={shell}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(255,255,255,0.38), rgba(255,255,255,0.06))",
          }}
        />
        {framedPhoto(
          compact
            ? centeredFrameStyle(24, { top: "18%" }, 50, 1.36)
            : centeredFrameStyle(22, { top: "16%" }, 50, 1.4),
          {
            background: "transparent",
            padding: 0,
            boxShadow: "0 18px 36px rgba(40,40,40,0.18)",
          },
          { background: "transparent", borderRadius: compact ? 4 : 6 }
        )}
        <div
          style={{
            position: "absolute",
            inset: compact ? "18% 30% 18% 30%" : "16% 31% 18% 31%",
            borderRadius: compact ? 4 : 6,
            boxShadow: "inset -6px 0 12px rgba(0,0,0,0.10), inset 6px 0 12px rgba(255,255,255,0.15)",
            pointerEvents: "none",
          }}
        />
      </div>
    );
  }

  if (kind === "metal") {
    return (
      <div style={shell}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.03))",
          }}
        />
        {framedPhoto(
          compact
            ? centeredFrameStyle(24, { top: "16%" }, 50, 1.44)
            : centeredFrameStyle(22, { top: "12%" }, 50, 1.48),
          {
            background: "transparent",
            boxShadow: "0 22px 40px rgba(24,30,38,0.22)",
          },
          { borderRadius: compact ? 3 : 4 },
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(120deg, rgba(255,255,255,0.0) 18%, rgba(255,255,255,0.30) 38%, rgba(255,255,255,0.08) 55%, rgba(255,255,255,0.0) 78%)",
              mixBlendMode: "screen",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div style={shell}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, rgba(255,255,255,0.34), rgba(255,255,255,0.06))",
        }}
      />
      {framedPhoto(
        compact
          ? centeredFrameStyle(24, { top: "16%" }, 50, 1.44)
          : centeredFrameStyle(22, { top: "12%" }, 50, 1.48),
        {
          background: "transparent",
          boxShadow: "0 18px 36px rgba(25,25,25,0.20)",
        },
        { borderRadius: compact ? 3 : 4 }
      )}
    </div>
  );
}

const PREVIEW_LABELS = ["Wall", "Desk", "Close-up"];

function renderMockupStrip(
  kind: PreviewKind,
  imageUrl: string | null | undefined,
  activeVariant: number,
  sizeLabel: string | null | undefined,
  onSelect: (variant: number) => void,
  imageFilter?: string,
  imageAspectRatio?: number | null,
  isCompositeArtwork = false,
) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 14 }}>
      {[0, 1, 2].map((variant) => {
        const active = activeVariant === variant;
        return (
          <button
            key={variant}
            type="button"
            onClick={() => onSelect(variant)}
            style={{
              border: active ? "1px solid rgba(255,255,255,0.48)" : "1px solid rgba(255,255,255,0.10)",
              background: active ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.035)",
              borderRadius: 12,
              padding: 8,
              cursor: "pointer",
              width: "100%",
              minHeight: 96,
            }}
          >
            <div style={{ width: "100%", height: 60, borderRadius: 10, overflow: "hidden", background: "#1b1b1b" }}>
              {renderPremiumMockup(
                kind,
                imageUrl,
                variant,
                true,
                sizeLabel,
                imageFilter,
                imageAspectRatio,
                isCompositeArtwork,
              )}
            </div>
            <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, color: active ? "#fff" : "#9a9a9a" }}>
              {PREVIEW_LABELS[variant]}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Nobg helpers ──────────────────────────────────────────────────────────
function nobgPublicUrl(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${NOBG_BUCKET}/${path}`;
}

/** Client-side canvas composite: backdrop image + nobg (transparent foreground) */
/** Repeating watermark overlay — prevents screenshots from being usable */
function WatermarkOverlay({
  text,
  logoUrl,
  variant = "wall",
}: {
  text: string;
  logoUrl?: string;
  variant?: "wall" | "viewer";
}) {
  const isViewer = variant === "viewer";
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: 4,
        borderRadius: 6,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: isViewer ? "-28%" : "-50%",
          left: isViewer ? "-28%" : "-50%",
          width: isViewer ? "156%" : "200%",
          height: isViewer ? "156%" : "200%",
          transform: "rotate(-30deg)",
          display: "flex",
          flexDirection: "column",
          gap: isViewer ? (logoUrl ? 96 : 84) : logoUrl ? 64 : 48,
          justifyContent: "center",
        }}
      >
        {Array.from({ length: isViewer ? 10 : 20 }).map((_, row) => (
          <div
            key={row}
            style={{
              display: "flex",
              gap: isViewer ? (logoUrl ? 108 : 92) : logoUrl ? 48 : 32,
              whiteSpace: "nowrap",
              paddingLeft: row % 2 === 0 ? 0 : isViewer ? 120 : 80,
              alignItems: "center",
            }}
          >
            {Array.from({ length: isViewer ? 6 : 12 }).map((_, col) =>
              logoUrl ? (
                <img
                  key={col}
                  src={logoUrl}
                  alt=""
                  draggable={false}
                  style={{
                    width: isViewer ? 92 : 60,
                    height: isViewer ? 92 : 60,
                    objectFit: "contain",
                    opacity: isViewer ? 0.16 : 0.22,
                    userSelect: "none",
                    pointerEvents: "none",
                    filter: isViewer
                      ? "drop-shadow(0 1px 2px rgba(0,0,0,0.14))"
                      : "drop-shadow(0 0 2px rgba(0,0,0,0.4))",
                  }}
                />
              ) : (
                <span
                  key={col}
                  style={{
                    fontSize: isViewer ? 21 : 14,
                    fontWeight: 700,
                    color: isViewer ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.28)",
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    fontFamily: "system-ui, sans-serif",
                    textShadow: isViewer ? "0 1px 2px rgba(0,0,0,0.18)" : "0 0 4px rgba(0,0,0,0.5)",
                    WebkitTextStroke: isViewer ? "0.25px rgba(0,0,0,0.08)" : "0.3px rgba(0,0,0,0.15)",
                  } as React.CSSProperties}
                >
                  {text}
                </span>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ContainedViewerImage({
  src,
  fallbackSrc,
  candidates,
  alt,
  aspectRatio,
  imageFilter,
  onError,
  watermarkEnabled,
  watermarkText,
  watermarkLogoUrl,
}: {
  src: string;
  fallbackSrc: string;
  candidates: string[];
  alt: string;
  aspectRatio?: number | null;
  imageFilter?: string;
  onError?: (event: SyntheticEvent<HTMLImageElement, Event>) => void;
  watermarkEnabled?: boolean;
  watermarkText: string;
  watermarkLogoUrl?: string;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [imageBounds, setImageBounds] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const updateBounds = () => {
      const nextWidth = frame.clientWidth;
      const nextHeight = frame.clientHeight;
      if (!nextWidth || !nextHeight) return;

      if (!aspectRatio || aspectRatio <= 0) {
        setImageBounds({ width: nextWidth, height: nextHeight });
        return;
      }

      let fittedWidth = nextWidth;
      let fittedHeight = fittedWidth / aspectRatio;

      if (fittedHeight > nextHeight) {
        fittedHeight = nextHeight;
        fittedWidth = fittedHeight * aspectRatio;
      }

      const normalizedWidth = Math.max(1, Math.round(fittedWidth));
      const normalizedHeight = Math.max(1, Math.round(fittedHeight));

      setImageBounds((prev) => {
        if (
          prev &&
          prev.width === normalizedWidth &&
          prev.height === normalizedHeight
        ) {
          return prev;
        }
        return { width: normalizedWidth, height: normalizedHeight };
      });
    };

    updateBounds();

    const resizeObserver = new ResizeObserver(() => {
      updateBounds();
    });

    resizeObserver.observe(frame);
    window.addEventListener("resize", updateBounds);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateBounds);
    };
  }, [aspectRatio]);

  return (
    <div
      ref={frameRef}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        maxWidth: "100%",
        maxHeight: "100%",
        overflow: "hidden",
        borderRadius: 6,
      }}
    >
      <div
        style={{
          position: "relative",
          width: imageBounds ? `${imageBounds.width}px` : "100%",
          height: imageBounds ? `${imageBounds.height}px` : "100%",
          maxWidth: "100%",
          maxHeight: "100%",
          overflow: "hidden",
          borderRadius: 6,
          flexShrink: 0,
        }}
      >
        <img
          src={src || fallbackSrc}
          data-candidates={candidates.join("|")}
          data-candidate-index="0"
          onError={onError}
          alt={alt}
          draggable={false}
          decoding="async"
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 6,
            objectFit: "contain",
            display: "block",
            userSelect: "none",
            WebkitUserDrag: "none",
            pointerEvents: "none",
            filter: imageFilter,
          } as React.CSSProperties}
        />
        {watermarkEnabled ? (
          <WatermarkOverlay
            text={watermarkText}
            logoUrl={watermarkLogoUrl}
            variant="viewer"
          />
        ) : null}
      </div>
    </div>
  );
}

function CompositeCanvas({
  backdropUrl,
  backdropFallbackUrl,
  nobgUrl,
  fallbackUrl,
  width,
  height,
  foregroundScale = 1,
  foregroundVerticalOffset = 0,
  trimTransparentForeground = false,
  responsive = false,
  style,
  showWatermark = false,
  watermarkText,
  watermarkLogoUrl,
  watermarkVariant = "viewer",
  backdropBlurPx = 0,
  preserveForegroundAlignment = false,
}: {
  backdropUrl: string;
  backdropFallbackUrl?: string | null;
  nobgUrl: string | null;
  fallbackUrl: string;
  width: number;
  height: number;
  foregroundScale?: number;
  foregroundVerticalOffset?: number;
  trimTransparentForeground?: boolean;
  responsive?: boolean;
  style?: React.CSSProperties;
  showWatermark?: boolean;
  watermarkText?: string;
  watermarkLogoUrl?: string;
  watermarkVariant?: "wall" | "viewer";
  backdropBlurPx?: number;
  preserveForegroundAlignment?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderKey = `${backdropUrl}|${backdropFallbackUrl ?? ""}|${nobgUrl ?? ""}|${fallbackUrl}|${width}|${height}|${foregroundScale}|${foregroundVerticalOffset}|${trimTransparentForeground ? "trim" : "full"}|${backdropBlurPx}|${preserveForegroundAlignment ? "aligned" : "free"}`;
  const nextBackdropSrc = backdropUrl || backdropFallbackUrl || "";
  const nextForegroundSrc = nobgUrl || fallbackUrl;
  const effectiveBackdropBlurPx = getEffectiveBackdropBlurPx(backdropBlurPx);
  const useDomBlurLayer = effectiveBackdropBlurPx > 0;
  const [loadedKey, setLoadedKey] = useState("");
  const [domBackdropSrc, setDomBackdropSrc] = useState(nextBackdropSrc);
  const [domForegroundSrc, setDomForegroundSrc] = useState(nextForegroundSrc);
  const [domBackdropLoaded, setDomBackdropLoaded] = useState(false);
  const [domForegroundLoaded, setDomForegroundLoaded] = useState(false);
  const ready = useDomBlurLayer
    ? domBackdropLoaded && domForegroundLoaded
    : loadedKey === renderKey;
  const hasRenderedFrame = useDomBlurLayer
    ? domBackdropLoaded || domForegroundLoaded
    : loadedKey.length > 0;

  useEffect(() => {
    if (!useDomBlurLayer) return;
    setDomBackdropSrc((current) => {
      if (current === nextBackdropSrc) return current;
      setDomBackdropLoaded(false);
      return nextBackdropSrc;
    });
    setDomForegroundSrc((current) => {
      if (current === nextForegroundSrc) return current;
      setDomForegroundLoaded(false);
      return nextForegroundSrc;
    });
  }, [useDomBlurLayer, nextBackdropSrc, nextForegroundSrc]);

  useEffect(() => {
    if (useDomBlurLayer) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const displayCanvas = canvas;

    let cancelled = false;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const scratchCanvas = document.createElement("canvas");
    scratchCanvas.width = width * dpr;
    scratchCanvas.height = height * dpr;
    const scratchCtx = scratchCanvas.getContext("2d");
    if (!scratchCtx) return;
    const bufferCtx = scratchCtx;
    bufferCtx.scale(dpr, dpr);

    const bgImg = new Image();
    bgImg.crossOrigin = "anonymous";
    bgImg.decoding = "async";
    const fgImg = new Image();
    fgImg.crossOrigin = "anonymous";
    fgImg.decoding = "async";

    let bgLoaded = false;
    let fgLoaded = false;
    let triedBackdropFallback = false;
    let fgCrop: { sx: number; sy: number; sw: number; sh: number } | null = null;

    function detectForegroundCrop(image: HTMLImageElement) {
      if (!trimTransparentForeground) return null;

      try {
        const naturalWidth = image.naturalWidth || image.width;
        const naturalHeight = image.naturalHeight || image.height;
        if (!naturalWidth || !naturalHeight) return null;

        const longestSide = Math.max(naturalWidth, naturalHeight);
        const sampleScale = longestSide > 1200 ? 1200 / longestSide : 1;
        const sampleWidth = Math.max(1, Math.round(naturalWidth * sampleScale));
        const sampleHeight = Math.max(1, Math.round(naturalHeight * sampleScale));
        const sampleCanvas = document.createElement("canvas");
        sampleCanvas.width = sampleWidth;
        sampleCanvas.height = sampleHeight;
        const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
        if (!sampleContext) return null;

        sampleContext.drawImage(image, 0, 0, sampleWidth, sampleHeight);
        const pixelData = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
        const columnCounts = new Uint16Array(sampleWidth);
        const rowCounts = new Uint16Array(sampleHeight);
        const alphaThreshold = 28;

        for (let y = 0; y < sampleHeight; y += 1) {
          const rowOffset = y * sampleWidth * 4;
          for (let x = 0; x < sampleWidth; x += 1) {
            const alpha = pixelData[rowOffset + x * 4 + 3];
            if (alpha < alphaThreshold) continue;
            columnCounts[x] += 1;
            rowCounts[y] += 1;
          }
        }
        const minColumnHits = Math.max(4, Math.round(sampleHeight * 0.012));
        const minRowHits = Math.max(4, Math.round(sampleWidth * 0.012));

        let minX = columnCounts.findIndex((count) => count >= minColumnHits);
        let maxX = -1;
        for (let x = sampleWidth - 1; x >= 0; x -= 1) {
          if (columnCounts[x] >= minColumnHits) {
            maxX = x;
            break;
          }
        }

        let minY = rowCounts.findIndex((count) => count >= minRowHits);
        let maxY = -1;
        for (let y = sampleHeight - 1; y >= 0; y -= 1) {
          if (rowCounts[y] >= minRowHits) {
            maxY = y;
            break;
          }
        }

        if (minX < 0 || minY < 0 || maxX < 0 || maxY < 0) {
          minX = sampleWidth;
          minY = sampleHeight;
          maxX = -1;
          maxY = -1;

          for (let y = 0; y < sampleHeight; y += 1) {
            const rowOffset = y * sampleWidth * 4;
            for (let x = 0; x < sampleWidth; x += 1) {
              const alpha = pixelData[rowOffset + x * 4 + 3];
              if (alpha < alphaThreshold) continue;
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            }
          }
        }

        if (maxX < 0 || maxY < 0) return null;

        const padX = Math.max(1, Math.round(sampleWidth * 0.01));
        const padTop = Math.max(1, Math.round(sampleHeight * 0.008));
        const padBottom = Math.max(1, Math.round(sampleHeight * 0.01));
        const safeMinX = Math.max(0, minX - padX);
        const safeMinY = Math.max(0, minY - padTop);
        const safeMaxX = Math.min(sampleWidth - 1, maxX + padX);
        const safeMaxY = Math.min(sampleHeight - 1, maxY + padBottom);

        return {
          sx: Math.round((safeMinX / sampleWidth) * naturalWidth),
          sy: Math.round((safeMinY / sampleHeight) * naturalHeight),
          sw: Math.max(1, Math.round(((safeMaxX - safeMinX + 1) / sampleWidth) * naturalWidth)),
          sh: Math.max(1, Math.round(((safeMaxY - safeMinY + 1) / sampleHeight) * naturalHeight)),
        };
      } catch {
        return null;
      }
    }

    function draw() {
      if (cancelled || !bgLoaded || !fgLoaded) return;
      bufferCtx.clearRect(0, 0, width, height);

      // Draw backdrop (cover)
      const canvasRatio = width / height;
      const bgRatio = bgImg.naturalWidth / bgImg.naturalHeight;
      let sx = 0, sy = 0, sw = bgImg.naturalWidth, sh = bgImg.naturalHeight;
      if (bgRatio > canvasRatio) {
        sw = bgImg.naturalHeight * canvasRatio;
        sx = (bgImg.naturalWidth - sw) / 2;
      } else {
        sh = bgImg.naturalWidth / canvasRatio;
        sy = (bgImg.naturalHeight - sh) / 2;
      }
      if (effectiveBackdropBlurPx > 0) {
        bufferCtx.filter = `blur(${effectiveBackdropBlurPx}px)`;
      }
      bufferCtx.drawImage(bgImg, sx, sy, sw, sh, 0, 0, width, height);
      if (effectiveBackdropBlurPx > 0) {
        bufferCtx.filter = "none";
      }

      // For blurred-original mode, redraw the cutout using the exact same cover math
      // as the original photo so the subject stays perfectly aligned.
      if (preserveForegroundAlignment) {
        const fgRatio = fgImg.naturalWidth / fgImg.naturalHeight;
        let fgSx = 0;
        let fgSy = 0;
        let fgSw = fgImg.naturalWidth;
        let fgSh = fgImg.naturalHeight;
        if (fgRatio > canvasRatio) {
          fgSw = fgImg.naturalHeight * canvasRatio;
          fgSx = (fgImg.naturalWidth - fgSw) / 2;
        } else {
          fgSh = fgImg.naturalWidth / canvasRatio;
          fgSy = (fgImg.naturalHeight - fgSh) / 2;
        }
        bufferCtx.drawImage(fgImg, fgSx, fgSy, fgSw, fgSh, 0, 0, width, height);
      } else {
        // Draw foreground (contain, centered)
      const sourceWidth = fgCrop?.sw ?? fgImg.naturalWidth;
      const sourceHeight = fgCrop?.sh ?? fgImg.naturalHeight;
      const fgRatio = sourceWidth / sourceHeight;
      let dw: number, dh: number;
      if (fgRatio > canvasRatio) {
        dw = width;
        dh = width / fgRatio;
      } else {
        dh = height;
        dw = height * fgRatio;
      }
      dw *= foregroundScale;
      dh *= foregroundScale;
      const dx = (width - dw) / 2;
      const maxDy = height - dh + height * 0.035;
      const minDy = -height * 0.02;
      const dy = clampNumber(
        (height - dh) / 2 + height * foregroundVerticalOffset,
        minDy,
        maxDy,
      );
      if (fgCrop) {
        bufferCtx.drawImage(fgImg, fgCrop.sx, fgCrop.sy, fgCrop.sw, fgCrop.sh, dx, dy, dw, dh);
      } else {
        bufferCtx.drawImage(fgImg, dx, dy, dw, dh);
      }
      }

      const displayCtx = displayCanvas.getContext("2d");
      if (!displayCtx) return;
      displayCanvas.width = scratchCanvas.width;
      displayCanvas.height = scratchCanvas.height;
      displayCtx.setTransform(1, 0, 0, 1, 0, 0);
      displayCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
      displayCtx.drawImage(scratchCanvas, 0, 0);
      if (cancelled) {
        return;
      }

      setLoadedKey(renderKey);
    }

    bgImg.onload = () => { bgLoaded = true; draw(); };
    fgImg.onload = () => {
      fgCrop = detectForegroundCrop(fgImg);
      fgLoaded = true;
      draw();
    };
    bgImg.onerror = () => {
      if (!triedBackdropFallback && backdropFallbackUrl && backdropFallbackUrl !== backdropUrl) {
        triedBackdropFallback = true;
        bgImg.src = backdropFallbackUrl;
        return;
      }
      bgLoaded = true;
      draw();
    };
    fgImg.onerror = () => {
      // If nobg fails, fall back to original photo
      fgImg.src = fallbackUrl;
    };

    bgImg.src = backdropUrl || backdropFallbackUrl || "";
    fgImg.src = nobgUrl || fallbackUrl;

    return () => { cancelled = true; };
  }, [useDomBlurLayer, backdropUrl, backdropFallbackUrl, nobgUrl, fallbackUrl, width, height, renderKey, trimTransparentForeground, preserveForegroundAlignment, effectiveBackdropBlurPx]);

  const wrapperStyle: React.CSSProperties = responsive
    ? {
        position: "relative",
        width: width > height ? `min(100%, ${width}px)` : "auto",
        height: height >= width ? `min(100%, ${height}px)` : "auto",
        maxWidth: "100%",
        maxHeight: "100%",
        aspectRatio: `${width} / ${height}`,
        flexShrink: 0,
        display: "block",
        alignSelf: "center",
        ...style,
      }
    : { position: "relative", width, height, ...style };

  return (
    <div style={wrapperStyle}>
      {useDomBlurLayer ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            overflow: "hidden",
            borderRadius: 6,
            opacity: ready || hasRenderedFrame ? 1 : 0,
            transition: "opacity 0.3s ease",
            background: "#000",
          }}
        >
          <img
            src={domBackdropSrc}
            alt=""
            draggable={false}
            decoding="async"
            onLoad={() => setDomBackdropLoaded(true)}
            onError={() => {
              if (backdropFallbackUrl && domBackdropSrc !== backdropFallbackUrl) {
                setDomBackdropSrc(backdropFallbackUrl);
                return;
              }
              setDomBackdropLoaded(true);
            }}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: `blur(${effectiveBackdropBlurPx}px)`,
              transform: `translateZ(0) scale(${1 + Math.min(0.12, effectiveBackdropBlurPx / 220)})`,
              transformOrigin: "center center",
              display: "block",
              userSelect: "none",
              pointerEvents: "none",
              willChange: "filter, transform",
              backfaceVisibility: "hidden",
              contain: "paint",
              transition: "filter 120ms linear, transform 120ms linear",
            }}
          />
          <img
            src={domForegroundSrc}
            alt=""
            draggable={false}
            decoding="async"
            onLoad={() => setDomForegroundLoaded(true)}
            onError={() => {
              if (domForegroundSrc !== fallbackUrl) {
                setDomForegroundSrc(fallbackUrl);
                return;
              }
              setDomForegroundLoaded(true);
            }}
            style={
              preserveForegroundAlignment
                ? {
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                    userSelect: "none",
                    pointerEvents: "none",
                  }
                : {
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    width: `${foregroundScale * 100}%`,
                    height: `${foregroundScale * 100}%`,
                    transform: `translate(-50%, -50%) translateY(${foregroundVerticalOffset * 100}%)`,
                    objectFit: "contain",
                    display: "block",
                    userSelect: "none",
                    pointerEvents: "none",
                  }
            }
          />
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            borderRadius: 6,
            opacity: ready || hasRenderedFrame ? 1 : 0,
            transition: "opacity 0.3s ease",
          }}
        />
      )}
      {showWatermark && watermarkText ? (
        <WatermarkOverlay
          text={watermarkText}
          logoUrl={watermarkLogoUrl}
          variant={watermarkVariant}
        />
      ) : null}
      {!ready && !hasRenderedFrame && (
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#444",
          fontSize: 12,
        }}>
          Loading preview…
        </div>
      )}
    </div>
  );
}

/** Tiny canvas composite for photo strip thumbnails (72×72) */
function MiniComposite({
  backdropUrl,
  backdropFallbackUrl,
  nobgUrl,
  fallbackUrl,
  size = 72,
  backdropBlurPx = 0,
}: {
  backdropUrl: string;
  backdropFallbackUrl?: string | null;
  nobgUrl: string;
  fallbackUrl: string;
  size?: number;
  backdropBlurPx?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const bgImg = new Image();
    bgImg.crossOrigin = "anonymous";
    bgImg.decoding = "async";
    const fgImg = new Image();
    fgImg.crossOrigin = "anonymous";
    fgImg.decoding = "async";

    let bgDone = false, fgDone = false;
    let triedBackdropFallback = false;

    function draw() {
      if (!bgDone || !fgDone) return;
      ctx!.clearRect(0, 0, size, size);
      // BG cover (square crop)
      const bgR = bgImg.naturalWidth / bgImg.naturalHeight;
      let sx = 0, sy = 0, sw = bgImg.naturalWidth, sh = bgImg.naturalHeight;
      if (bgR > 1) { sw = sh; sx = (bgImg.naturalWidth - sw) / 2; }
      else { sh = sw; sy = (bgImg.naturalHeight - sh) / 2; }
      const effectiveBackdropBlurPx = getEffectiveBackdropBlurPx(backdropBlurPx);
      if (effectiveBackdropBlurPx > 0) {
        ctx!.filter = `blur(${effectiveBackdropBlurPx}px)`;
      }
      ctx!.drawImage(bgImg, sx, sy, sw, sh, 0, 0, size, size);
      if (effectiveBackdropBlurPx > 0) {
        ctx!.filter = "none";
      }
      // FG contain
      const fR = fgImg.naturalWidth / fgImg.naturalHeight;
      let dw: number, dh: number;
      if (fR > 1) { dw = size; dh = size / fR; } else { dh = size; dw = size * fR; }
      ctx!.drawImage(fgImg, (size - dw) / 2, (size - dh) / 2, dw, dh);
    }

    bgImg.onload = () => { bgDone = true; draw(); };
    fgImg.onload = () => { fgDone = true; draw(); };
    bgImg.onerror = () => {
      if (!triedBackdropFallback && backdropFallbackUrl && backdropFallbackUrl !== backdropUrl) {
        triedBackdropFallback = true;
        bgImg.src = backdropFallbackUrl;
        return;
      }
      bgDone = true;
      draw();
    };
    fgImg.onerror = () => { fgDone = true; draw(); };

    bgImg.src = backdropUrl || backdropFallbackUrl || "";
    fgImg.src = nobgUrl || fallbackUrl;
  }, [backdropUrl, backdropFallbackUrl, nobgUrl, fallbackUrl, size, backdropBlurPx]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, display: "block" }}
    />
  );
}

/** Smaller backdrop thumbnail with canvas composite preview */
function BackdropThumbCanvas({
  backdropUrl,
  backdropFallbackUrl,
  selected,
  isPremium,
  fetchPriority = "low",
  onClick,
}: {
  backdropUrl: string;
  backdropFallbackUrl?: string | null;
  selected: boolean;
  isPremium: boolean;
  fetchPriority?: "high" | "low" | "auto";
  onClick: () => void;
}) {
  const backdropCandidates = useMemo(
    () =>
      uniq([backdropUrl, backdropFallbackUrl]).map((url, candidateIndex) =>
        withGalleryImageKey(url, `backdrop-thumb-${url}`, "viewer-thumb", candidateIndex),
      ),
    [backdropFallbackUrl, backdropUrl],
  );
  const [thumbLoaded, setThumbLoaded] = useState(false);

  useEffect(() => {
    setThumbLoaded(false);
  }, [backdropCandidates]);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: "relative",
        padding: 0,
        border: selected ? "2px solid #fff" : "2px solid transparent",
        borderRadius: 10,
        overflow: "hidden",
        cursor: "pointer",
        background: "#1a1a1a",
        transition: "all 0.2s ease",
        transform: selected ? "scale(1.05)" : "scale(1)",
        boxShadow: selected ? "0 0 20px rgba(255,255,255,0.12)" : "none",
        outline: "none",
      }}
    >
      {!thumbLoaded && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 8,
            background:
              "linear-gradient(90deg, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.12) 40%, rgba(255,255,255,0.06) 65%)",
          }}
        />
      )}
      <img
        src={backdropCandidates[0] || backdropUrl}
        data-candidates={backdropCandidates.join("|")}
        data-candidate-index="0"
        onError={handleBackdropImageError}
        onLoad={() => setThumbLoaded(true)}
        alt=""
        loading="lazy"
        decoding="async"
        fetchPriority={fetchPriority}
        draggable={false}
        style={{
          width: 80,
          height: 100,
          display: "block",
          borderRadius: 8,
          objectFit: "cover",
          background: "transparent",
          opacity: thumbLoaded ? 1 : 0,
          transition: "opacity 0.18s ease",
        }}
      />
      {isPremium && (
        <div style={{
          position: "absolute",
          top: 4,
          right: 4,
          background: "linear-gradient(135deg, #f59e0b, #d97706)",
          color: "#000",
          fontSize: 8,
          fontWeight: 800,
          padding: "2px 5px",
          borderRadius: 4,
          letterSpacing: "0.05em",
        }}>
          ★
        </div>
      )}
    </button>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const darkInput: React.CSSProperties = {
  width: "100%",
  border: "1px solid #2e2e2e",
  borderRadius: 8,
  padding: "11px 14px",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
  color: "#fff",
  background: "#1c1c1c",
  fontFamily: "inherit",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  fontWeight: 700,
  color: "#888",
  marginBottom: 5,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

// ══════════════════════════════════════════════════════════════════════════
export default function ParentGalleryPage() {
  const supabase = useMemo(() => createClient(), []);
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const pin = decodeURIComponent(String(params.pin ?? ""));
  const schoolId = searchParams.get("school") ?? "";
  const projectId = searchParams.get("project") ?? "";
  const eventEmail = searchParams.get("email") ?? "";
  const schoolViewerEmail = searchParams.get("email") ?? "";
  const checkoutStatus = searchParams.get("checkout") ?? "";
  const sessionId = searchParams.get("session_id") ?? "";
  const mode = searchParams.get("mode") ?? "school";
  const isSchoolMode = mode !== "event";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [student, setStudent] = useState<StudentRow | null>(null);
  const [schoolName, setSchoolName] = useState("");
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [galleryImageRatios, setGalleryImageRatios] = useState<Record<string, number>>({});
  const [loadedGalleryImageIds, setLoadedGalleryImageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [eventPhotoStage, setEventPhotoStage] = useState<EventPhotoStage>(
    mode === "event" ? "albums" : "viewer",
  );
  const viewerThumbnailStripRef = useRef<HTMLDivElement | null>(null);
  const viewerThumbnailButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const eventPhotoWallRef = useRef<HTMLDivElement | null>(null);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<PackageRow | null>(null);
  const [cartItems, setCartItems] = useState<CartLineItem[]>([]);
  const [selectedOrderQty, setSelectedOrderQty] = useState(1);
  const [packageQuantities, setPackageQuantities] = useState<Record<string, number>>({});
  const [cardPreviewVariant, setCardPreviewVariant] = useState<Record<string, number>>({});

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerView, setDrawerView] = useState<DrawerView>("product-select");
  const [activeCategoryKey, setActiveCategoryKey] = useState<string>("package");

  // Package builder
  const [slots, setSlots] = useState<ItemSlot[]>([]);
  const [activeSlotIndex, setActiveSlotIndex] = useState<number | null>(null);

  // Checkout
  const [parentName, setParentName] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<"pickup" | "shipping">(
    "pickup"
  );
  const [shippingName, setShippingName] = useState("");
  const [shippingAddress1, setShippingAddress1] = useState("");
  const [shippingAddress2, setShippingAddress2] = useState("");
  const [shippingCity, setShippingCity] = useState("");
  const [shippingProvince, setShippingProvince] = useState("");
  const [shippingPostalCode, setShippingPostalCode] = useState("");
  const [placing, setPlacing] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [orderId, setOrderId] = useState("");
  const [placed, setPlaced] = useState(false);

  // Pre-release capture
  const [captureEmail, setCaptureEmail] = useState("");
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureDone, setCaptureDone] = useState(false);
  const [captureError, setCaptureError] = useState("");

  // ── Backdrop selector (school mode only) ────────────────────────────────
  const [backdropPickerOpen, setBackdropPickerOpen] = useState(false);
  const [backdrops, setBackdrops] = useState<BackdropRow[]>([]);
  const [selectedBackdrop, setSelectedBackdrop] = useState<BackdropRow | null>(null);
  const [confirmedBackdrop, setConfirmedBackdrop] = useState<BackdropRow | null>(null);
  const [selectedBlurBackground, setSelectedBlurBackground] = useState(false);
  const [confirmedBlurBackground, setConfirmedBlurBackground] = useState(false);
  const [selectedBlurAmount, setSelectedBlurAmount] = useState(DEFAULT_BACKDROP_BLUR_PX);
  const [confirmedBlurAmount, setConfirmedBlurAmount] = useState(DEFAULT_BACKDROP_BLUR_PX);
  const [backdropCategory, setBackdropCategory] = useState("all");
  const [nobgUrls, setNobgUrls] = useState<Record<string, string>>({});
  const [nobgStatus, setNobgStatus] = useState<"idle" | "loading" | "ready">("idle");
  const [compositeDataUrl, setCompositeDataUrl] = useState<string | null>(null);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [premiumTarget, setPremiumTarget] = useState<BackdropRow | null>(null);
  const [watermarkEnabled, setWatermarkEnabled] = useState(true);
  const [watermarkLogoUrl, setWatermarkLogoUrl] = useState<string>("");
  const [photographerId, setPhotographerId] = useState<string | null>(null);
  const [eventCollections, setEventCollections] = useState<EventCollectionRow[]>([]);
  const [activeEventCollectionId, setActiveEventCollectionId] = useState<string | null>(null);

  // ── Gallery views + favorites + studio info ──────────────────────────────
  const [activeView, setActiveView] = useState<GalleryView>("photos");
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [eventFavoritesAvailable, setEventFavoritesAvailable] = useState(true);
  const [favoriteMessage, setFavoriteMessage] = useState("");
  const [galleryActionMessage, setGalleryActionMessage] = useState("");
  const [downloadingGallery, setDownloadingGallery] = useState(false);
  const [galleryDownloadProgress, setGalleryDownloadProgress] = useState<number | null>(null);
  const [eventPhotoWallWidth, setEventPhotoWallWidth] = useState(0);
  const [downloadingFavorites, setDownloadingFavorites] = useState(false);
  const [gallerySettings, setGallerySettings] = useState<EventGallerySettings>(defaultEventGallerySettings);
  const [galleryDownloadAccess, setGalleryDownloadAccess] = useState<EventGalleryDownloadAccess>(
    () => defaultGalleryDownloadAccess(defaultEventGallerySettings),
  );
  const [favoriteDownloadAccess, setFavoriteDownloadAccess] = useState<EventFavoriteDownloadAccess>(
    () => defaultFavoriteDownloadAccess(defaultEventGallerySettings),
  );
  const [enteredEventIntro, setEnteredEventIntro] = useState(false);
  const [blackWhitePreviewEnabled, setBlackWhitePreviewEnabled] = useState(false);
  const [showLoadingFallback, setShowLoadingFallback] = useState(false);
  const galleryActionTimeoutRef = useRef<number | null>(null);
  const [studioInfo, setStudioInfo] = useState<{
    businessName: string;
    logoUrl: string;
    address: string;
    phone: string;
    email: string;
  }>({ businessName: "", logoUrl: "", address: "", phone: "", email: "" });
  const displayStudioLogoUrl = looksLikeImageAssetUrl(studioInfo.logoUrl)
    ? clean(studioInfo.logoUrl)
    : "";
  const effectiveWatermarkLogoUrl = looksLikeImageAssetUrl(watermarkLogoUrl)
    ? clean(watermarkLogoUrl)
    : displayStudioLogoUrl;
  const effectiveWatermarkText =
    clean(studioInfo.businessName) || schoolName || "PROOF";
  const eventWallRatiosKey = !isSchoolMode
    ? eventWallRatioStorageKey(projectId, eventEmail, pin)
    : "";

  useEffect(() => {
    const validIds = new Set(images.map((img) => img.id));
    setLoadedGalleryImageIds((prev) => {
      const next = new Set(Array.from(prev).filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setGalleryImageRatios((prev) => {
      const nextEntries = Object.entries(prev).filter(([id]) => validIds.has(id));
      return nextEntries.length === Object.keys(prev).length
        ? prev
        : Object.fromEntries(nextEntries);
    });
  }, [images]);

  useEffect(() => {
    if (!eventWallRatiosKey || !Object.keys(galleryImageRatios).length) return;
    writeStoredEventWallRatios(eventWallRatiosKey, galleryImageRatios);
  }, [eventWallRatiosKey, galleryImageRatios]);

  function markGalleryImageLoaded(id: string, aspectRatio?: number | null) {
    setLoadedGalleryImageIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    if (!aspectRatio || !Number.isFinite(aspectRatio) || aspectRatio <= 0) return;
    const nextAspectRatio = getEventWallAspectRatio(aspectRatio);
    setGalleryImageRatios((prev) =>
      prev[id] === nextAspectRatio
        ? prev
        : {
            ...prev,
            [id]: nextAspectRatio,
          },
    );
  }

  // ── Load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        if (!pin) {
          setError("Missing PIN.");
          setLoading(false);
          return;
        }

        setLoading(true);
        setError("");

        if (!isSchoolMode) {
          if (!projectId) {
            throw new Error("Missing event project.");
          }
          if (!eventEmail) {
            throw new Error("Missing event email.");
          }

          const contextResponse = await fetch("/api/portal/event-gallery-context", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              projectId,
              email: eventEmail,
              pin,
            }),
            cache: "no-store",
          });

          const contextPayload = (await contextResponse.json()) as EventGalleryContextPayload;
          if (!contextResponse.ok || contextPayload.ok === false) {
            throw new Error(contextPayload.message || "Failed to load event gallery.");
          }

          const activeProject = contextPayload.project ?? null;
          const activeCollection = contextPayload.activeCollection ?? null;
          const collections = contextPayload.collections ?? [];
          const mediaRows = contextPayload.media ?? [];
          const eventImages = mediaRows
            .map((row) => {
              const thumbnailUrl = clean(row.thumbnail_url) || null;
              const previewUrl = clean(row.preview_url) || null;
              const downloadUrl = clean(row.download_url) || previewUrl || thumbnailUrl;
              const url = previewUrl || thumbnailUrl || downloadUrl;
              if (!url) return null;
              return {
                id: row.id,
                url,
                collectionId: clean(row.collection_id) || null,
                filename: clean(row.filename) || null,
                downloadUrl: downloadUrl || url,
                thumbnailUrl,
                previewUrl,
              } as GalleryImage;
            })
            .filter((row): row is GalleryImage => !!row);
          const packageRows = deduplicatePackages(contextPayload.packages ?? []);
          const eventLabel =
            clean(activeCollection?.title) ||
            clean(activeProject?.title) ||
            clean(activeProject?.client_name) ||
            "Event Gallery";
          const primaryImageUrl = eventImages[0]?.url ?? null;
          const pseudoStudent: StudentRow = {
            id: clean(activeCollection?.id) || `event-${projectId}`,
            first_name: eventLabel,
            last_name: null,
            photo_url: primaryImageUrl,
            class_id: null,
            school_id: "",
            class_name: clean(activeCollection?.title) || null,
            folder_name: clean(activeCollection?.title) || null,
            pin,
          };
          const nextWatermarkEnabled = contextPayload.watermarkEnabled !== false;
          const nextWatermarkLogoUrl = contextPayload.watermarkLogoUrl ?? "";
          const nextGallerySettings = normalizeEventGallerySettings(
            contextPayload.gallerySettings,
          );
          const nextGalleryDownloadAccess = {
            ...defaultGalleryDownloadAccess(nextGallerySettings),
            ...(contextPayload.downloadAccess ?? {}),
          } as EventGalleryDownloadAccess;
          const nextFavoriteDownloadAccess = {
            ...defaultFavoriteDownloadAccess(nextGallerySettings),
            ...(contextPayload.favoriteDownloadAccess ?? {}),
          } as EventFavoriteDownloadAccess;
          const nextStudioInfo = contextPayload.studioInfo ?? {
            businessName: "",
            logoUrl: "",
            address: "",
            phone: "",
            email: "",
          };
          const favoritesParams = new URLSearchParams({
            projectId,
            email: eventEmail,
            pin,
          });
          const favoritesResponse = await fetch(
            `/api/portal/event-favorites?${favoritesParams.toString()}`,
            {
              cache: "no-store",
            },
          );
          const favoritesPayload = (await favoritesResponse.json().catch(() => ({}))) as {
            ok?: boolean;
            mediaIds?: string[];
            unavailable?: boolean;
          };
          const storedFavorites = readStoredFavorites(
            favoriteStorageKey(projectId, eventEmail, pin),
          );
          const nextFavorites =
            favoritesResponse.ok && favoritesPayload.ok !== false
              ? new Set([
                  ...storedFavorites,
                  ...(favoritesPayload.mediaIds ?? [])
                    .map((value) => clean(value))
                    .filter(Boolean),
                ])
              : storedFavorites;
          const storedWallRatios = readStoredEventWallRatios(
            eventWallRatioStorageKey(projectId, eventEmail, pin),
          );
          const nextEventWallRatios = Object.fromEntries(
            eventImages
              .map((image) => [image.id, storedWallRatios[image.id]] as const)
              .filter((entry): entry is readonly [string, number] => Number.isFinite(entry[1])),
          );

          if (!mounted) return;

          setStudent(pseudoStudent);
          setSchoolName(eventLabel);
          setProject(activeProject);
          setGallerySettings(nextGallerySettings);
          setGalleryDownloadAccess(nextGalleryDownloadAccess);
          setFavoriteDownloadAccess(nextFavoriteDownloadAccess);
          setGalleryImageRatios(nextEventWallRatios);
          setImages(eventImages);
          setSelectedImageIndex(0);
          setEventCollections(collections);
          setActiveEventCollectionId(clean(activeCollection?.id) || null);
          setEventPhotoStage(
            clean(activeCollection?.id)
              ? "grid"
              : collections.length > 0
                ? "albums"
                : "viewer",
          );
          setActiveView("photos");
          setEnteredEventIntro(true);
          setBlackWhitePreviewEnabled(false);
          setPackages(packageRows);
          setBackdrops([]);
          setSelectedBackdrop(null);
          setConfirmedBackdrop(null);
          setFavorites(nextFavorites);
          setEventFavoritesAvailable(favoritesPayload.unavailable !== true);
          setNobgUrls({});
          setNobgStatus("ready");
          setPhotographerId(contextPayload.photographerId ?? activeProject?.photographer_id ?? null);
          setWatermarkEnabled(nextWatermarkEnabled);
          setWatermarkLogoUrl(nextWatermarkLogoUrl);
          setStudioInfo(nextStudioInfo);
          setLoading(false);
          return;
        }

        // ✅ PERF: Check sessionStorage for a prefetched gallery context written
        // by LoginForm after school-access succeeded. If the cache is fresh
        // (< 5 minutes) skip the round-trip to /api/portal/gallery-context.
        let contextPayload: GalleryContextPayload | null = null;
        const cacheKey = `gallery_ctx:${pin}:${schoolId}`;
        try {
          const cached = sessionStorage.getItem(cacheKey);
          if (cached) {
            const parsed = JSON.parse(cached) as GalleryContextPayload & { ts?: number };
            const ageMs = Date.now() - (parsed.ts ?? 0);
            if (ageMs < 5 * 60 * 1000) {
              contextPayload = parsed;
              sessionStorage.removeItem(cacheKey); // consume once — avoid stale reads
            }
          }
        } catch {
          // sessionStorage unavailable (e.g. private browsing strict mode) — fall through
        }

        if (!contextPayload) {
          const contextResponse = await fetch("/api/portal/gallery-context", {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              pin,
              schoolId,
              email: schoolViewerEmail,
            }),
            cache: "no-store",
          });

          contextPayload = (await contextResponse.json()) as GalleryContextPayload;
          if (!contextResponse.ok || contextPayload.ok === false) {
            throw new Error(contextPayload.message || "Failed to load gallery context.");
          }
        }

        const currentSchool = contextPayload.currentSchool ?? null;
        const schoolRowsForMatch = contextPayload.schoolRowsForMatch ?? [];
        const studentCandidates = contextPayload.studentCandidates ?? [];
        const primaryStudent = contextPayload.primaryStudent ?? null;
        const activeSchool = contextPayload.activeSchool ?? null;
        const activeProject = contextPayload.activeProject ?? null;
        const compositeRows = contextPayload.composites ?? [];
        const schoolMediaRows = contextPayload.media ?? [];

        if (!primaryStudent || !studentCandidates.length) {
          throw new Error("Student not found for this PIN.");
        }

        const combinedImages: GalleryImage[] = [];
        const seenUrls = new Set<string>();

        const candidateFolders = uniqueFolders([
          ...studentCandidates.map((s) => folderFromPhotoUrl(s.photo_url ?? "")),
          ...studentCandidates.flatMap((s) =>
            (schoolRowsForMatch.length ? schoolRowsForMatch : activeSchool ? [activeSchool] : [])
              .map((school) =>
                school.local_school_id && s.class_name && s.folder_name
                  ? `${school.local_school_id}/${s.class_name}/${s.folder_name}`
                  : null
              )
          ),
          activeSchool?.local_school_id && primaryStudent.class_name && primaryStudent.folder_name
            ? `${activeSchool.local_school_id}/${primaryStudent.class_name}/${primaryStudent.folder_name}`
            : null,
        ]);

        for (const row of schoolMediaRows) {
          const downloadUrl = clean(row.download_url) || clean(row.preview_url) || clean(row.thumbnail_url);
          const displayUrl = clean(row.preview_url) || clean(row.thumbnail_url) || downloadUrl;
          if (!displayUrl || seenUrls.has(displayUrl)) continue;
          seenUrls.add(displayUrl);
          combinedImages.push({
            id: row.id,
            url: displayUrl,
            filename: clean(row.filename) || null,
            downloadUrl: downloadUrl || displayUrl,
            previewUrl: clean(row.preview_url) || null,
            thumbnailUrl: clean(row.thumbnail_url) || null,
            source: "photo",
          });
        }

        if (!combinedImages.length) {
          for (const s of studentCandidates) {
            if (s.photo_url && !seenUrls.has(s.photo_url)) {
              seenUrls.add(s.photo_url);
              combinedImages.push({
                id: `student-${s.id}`,
                url: s.photo_url,
                source: "photo",
              });
            }
          }
        }

        for (const composite of compositeRows) {
          const compositeUrl =
            composite.preview_url || composite.thumbnail_url || null;
          if (!compositeUrl || seenUrls.has(compositeUrl)) continue;
          seenUrls.add(compositeUrl);
          combinedImages.push({
            id: `composite-${composite.id}`,
            url: compositeUrl,
            collectionId: composite.collection_id,
            filename: composite.filename ?? null,
            downloadUrl: composite.preview_url ?? composite.thumbnail_url ?? null,
            previewUrl: composite.preview_url ?? composite.thumbnail_url ?? null,
            thumbnailUrl: composite.thumbnail_url ?? composite.preview_url ?? null,
            title: compositeImageTitle(
              composite.filename,
              composite.collection_title ?? "Class Composite",
            ),
            source: "composite",
          });
        }

        const packageRows = deduplicatePackages(contextPayload.packages ?? []);
        const backdropRows = contextPayload.backdrops ?? [];
        const resolvedPhotographerId =
          contextPayload.photographerId ?? activeSchool?.photographer_id ?? null;
        const nextWatermarkEnabled = contextPayload.watermarkEnabled !== false;
        const nextWatermarkLogoUrl = contextPayload.watermarkLogoUrl ?? "";
        const nextGallerySettings = normalizeEventGallerySettings(
          contextPayload.gallerySettings ?? activeSchool?.gallery_settings,
        );
        const nextStudioInfo = contextPayload.studioInfo ?? {
          businessName: "",
          logoUrl: "",
          address: "",
          phone: "",
          email: "",
        };

        if (!mounted) return;

        setGalleryImageRatios({});
        setStudent(primaryStudent);
        setSchoolName(activeSchool?.school_name ?? currentSchool?.school_name ?? "");
        setProject(activeProject ?? null);
        setGallerySettings(nextGallerySettings);
        setGalleryDownloadAccess({
          ...defaultSchoolGalleryDownloadAccess(nextGallerySettings),
          ...(contextPayload.downloadAccess ?? {}),
        });
        setFavoriteDownloadAccess(defaultFavoriteDownloadAccess(nextGallerySettings));
        setImages(combinedImages);
        setSelectedImageIndex(0);
        setEventCollections([]);
        setActiveEventCollectionId(null);
        setEventPhotoStage("viewer");
        setActiveView("photos");
        setEnteredEventIntro(false);
        setBlackWhitePreviewEnabled(false);
        setPackages(packageRows);
        setBackdrops(backdropRows);
        setFavorites(new Set());
        setEventFavoritesAvailable(true);
        setNobgUrls({});
        setNobgStatus("idle");
        setPhotographerId(resolvedPhotographerId);
        setWatermarkEnabled(nextWatermarkEnabled);
        setWatermarkLogoUrl(nextWatermarkLogoUrl);
        setStudioInfo(nextStudioInfo);
        if (schoolViewerEmail) {
          setParentEmail(schoolViewerEmail);
        }

        setLoading(false);

        if (!resolvedPhotographerId || !candidateFolders.length || !combinedImages.length) {
          setNobgStatus("ready");
          return;
        }

        setNobgStatus("loading");

        void (async () => {
          const nobgUrlMap: Record<string, string> = {};
          const priorityImageId = combinedImages[0]?.id ?? null;
          let priorityResolved = false;
          const nobgListings = await Promise.all(
            candidateFolders.map(async (folder) => {
              try {
                const { data: nobgFiles, error: nobgErr } = await supabase.storage
                  .from(NOBG_BUCKET)
                  .list(folder, { limit: 200, sortBy: { column: "name", order: "asc" } });

                if (nobgErr) {
                  console.warn(`[Gallery] nobg bucket list error for ${folder}:`, nobgErr.message);
                  return { folder, files: [] as { name?: string | null }[] };
                }

                return { folder, files: nobgFiles ?? [] };
              } catch (nobgCatchErr) {
                console.warn(`[Gallery] nobg bucket error for folder ${folder}:`, nobgCatchErr);
                return { folder, files: [] as { name?: string | null }[] };
              }
            })
          );

          for (const { folder, files } of nobgListings) {
            for (const f of files) {
              if (!f.name || !isImageFileName(f.name)) continue;
              const baseName = f.name.replace(/_cutout/i, "").replace(/\.png$/i, "");
              for (const origImg of combinedImages) {
                const origName = origImg.url.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
                const normalizedOrigName =
                  origImg.url.split("/").pop()?.replace(/\.[^.]+$/, "").toLowerCase() ?? "";
                const normalizedNobgName = f.name.replace(/\.[^.]+$/, "").toLowerCase();
                if (
                  origName.toLowerCase() === baseName.toLowerCase() ||
                  normalizedOrigName === normalizedNobgName
                ) {
                  const resolvedUrl = nobgPublicUrl(`${folder}/${f.name}`);
                  nobgUrlMap[origImg.id] = resolvedUrl;
                  if (!priorityResolved && priorityImageId && origImg.id === priorityImageId && mounted) {
                    priorityResolved = true;
                    setNobgUrls({ [origImg.id]: resolvedUrl });
                    setNobgStatus("ready");
                  }
                  break;
                }
              }
            }
          }

          if (!mounted) return;
          setNobgUrls(nobgUrlMap);
          setNobgStatus("ready");
        })();
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load gallery.");
        setLoading(false);
      }
    }

    void load();
    return () => {
      mounted = false;
    };
  }, [eventEmail, isSchoolMode, pin, projectId, schoolId, schoolViewerEmail, supabase]);

  useEffect(() => {
    return () => {
      if (galleryActionTimeoutRef.current) {
        window.clearTimeout(galleryActionTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function confirmCheckout() {
      if (checkoutStatus !== "success" || !sessionId || placed) return;
      try {
        setConfirmingPayment(true);
        setOrderError("");
        const res = await fetch("/api/stripe/checkout/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const json = (await res.json()) as {
          ok: boolean;
          message?: string;
          orderId?: string;
          customerEmail?: string | null;
        };
        if (!res.ok || !json.ok) {
          throw new Error(json.message || "Payment confirmation failed.");
        }
        if (!active) return;
        setOrderId(json.orderId || "");
        if (json.customerEmail) setParentEmail(json.customerEmail);
        setPlaced(true);
        setDrawerOpen(false);
      } catch (err) {
        if (!active) return;
        setOrderError(err instanceof Error ? err.message : "Payment confirmation failed.");
      } finally {
        if (active) setConfirmingPayment(false);
      }
    }

    void confirmCheckout();

    if (checkoutStatus === "cancel") {
      setOrderError("Checkout was cancelled. Your order draft is still saved — you can try again anytime.");
      setDrawerOpen(true);
      setDrawerView("checkout");
    }

    return () => {
      active = false;
    };
  }, [checkoutStatus, sessionId, placed]);

  const visibleImages =
    !isSchoolMode && activeEventCollectionId
      ? images.filter((img) => clean(img.collectionId) === activeEventCollectionId)
      : images;
  const selectedImage = visibleImages[selectedImageIndex] ?? null;
  const isCompositeSelection = isSchoolMode && isCompositeGalleryImage(selectedImage);
  const selectedImageAspectRatio = useImageAspectRatio(
    selectedImage?.downloadUrl || selectedImage?.previewUrl || selectedImage?.url || null,
  );
  const backdropCompositeSize = getBackdropCompositeSize(selectedImageAspectRatio);
  const backdropForegroundScale = getBackdropForegroundScale(selectedImageAspectRatio);
  const backdropForegroundVerticalOffset = getBackdropForegroundVerticalOffset(selectedImageAspectRatio);
  const currentGalleryExtras = gallerySettings.extras;
  const showProofWatermark =
    watermarkEnabled && currentGalleryExtras.showProofWatermark !== false;
  const currentGalleryBranding = gallerySettings.branding;
  const galleryLocale = localeFromGalleryLanguage(gallerySettings.galleryLanguage);
  const galleryCopy = galleryTranslations[galleryLocale];
  const blackWhiteFilteringAllowed = currentGalleryExtras.allowBlackWhiteFiltering;
  const blackWhitePreviewActive =
    blackWhiteFilteringAllowed && blackWhitePreviewEnabled;
  const galleryImageFilter = blackWhitePreviewActive ? "grayscale(1)" : undefined;
  const isLightGallery = currentGalleryBranding.backgroundMode === "light";
  const galleryTone = getGalleryTone(gallerySettings);
  const galleryAccent = getGalleryAccent(gallerySettings);
  const galleryGap = getGalleryGap(gallerySettings);
  const galleryFontFamily = getGalleryFontFamily(gallerySettings);
  const viewerPadding = getViewerPadding(gallerySettings);
  const thumbnailSize = getThumbnailSize(gallerySettings);
  const slotGridColumns = getSlotGridColumns(gallerySettings);
  const photoGridMinWidth = getPhotoGridMinWidth(gallerySettings);
  const photoWallColumnWidth = getPhotoWallColumnWidth(gallerySettings);
  const photoWallStyle = currentGalleryBranding.photoLayout;
  const eventCollectionPhotoCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const image of images) {
      const collectionId = clean(image.collectionId);
      if (!collectionId) continue;
      counts[collectionId] = (counts[collectionId] ?? 0) + 1;
    }
    return counts;
  }, [images]);
  const eventCollectionsWithImages = eventCollections.filter((collection) =>
    images.some((img) => clean(img.collectionId) === clean(collection.id)),
  );
  const eventHasAlbums = !isSchoolMode && eventCollectionsWithImages.length > 0;
  const selectedEventCollection = !isSchoolMode && activeEventCollectionId
    ? eventCollections.find((collection) => clean(collection.id) === activeEventCollectionId) ?? null
    : null;
  const heroImageUrl = selectedEventCollection?.cover_photo_url
    || project?.cover_photo_url
    || visibleImages[0]?.url
    || images[0]?.url
    || null;
  const introImageUrl = currentGalleryBranding.useCoverAsIntro ? heroImageUrl : null;
  const heroOverlayTint = getHeroOverlayOpacity(gallerySettings);
  const galleryHeadline =
    clean(currentGalleryBranding.introHeadline)
    || clean(selectedEventCollection?.title)
    || clean(project?.title)
    || clean(project?.project_name)
    || clean(project?.name)
    || schoolName
    || "Event Gallery";
  const orderingDisabled =
    !!project?.order_due_date &&
    new Date() > new Date(project.order_due_date);
  const galleryTabs = useMemo(
    () =>
      [
        "photos",
        ...(currentGalleryExtras.enableStore && !orderingDisabled
          ? (["store"] as GalleryView[])
          : []),
        "favorites",
        "about",
      ] satisfies GalleryView[],
    [currentGalleryExtras.enableStore, orderingDisabled],
  );
  const galleryNavTabs = useMemo(
    () => galleryTabs.filter((tab) => tab !== "store"),
    [galleryTabs],
  );
  const showAlbumOverview = eventHasAlbums && activeView === "photos" && eventPhotoStage === "albums";
  const showEventPhotoGrid = !isSchoolMode && activeView === "photos" && eventPhotoStage === "grid";
  const showPhotoViewer = isSchoolMode || (activeView === "photos" && eventPhotoStage === "viewer");
  const isEventGallery = !isSchoolMode && activeView === "photos";
  const isEventLanding = isEventGallery && showAlbumOverview;
  const isEventImageStage = isEventGallery && !showAlbumOverview;
  const eventCanvasBackground = isEventImageStage
    ? "#ffffff"
    : isEventGallery
      ? "#f7f3ee"
      : galleryTone.background;
  const galleryPickerValue = showAlbumOverview
    ? "__albums__"
    : activeEventCollectionId
      ? `album:${activeEventCollectionId}`
      : "__all__";
  const galleryHeaderLabel = showAlbumOverview
    ? galleryCopy.albums
    : selectedEventCollection
      ? galleryCopy.album
      : galleryCopy.allPhotos;
  const galleryHeaderTitle = showAlbumOverview
    ? galleryHeadline
    : clean(selectedEventCollection?.title) || galleryHeadline;
  const galleryHeaderDescription = showAlbumOverview
    ? galleryCopy.chooseAlbumPrompt
    : clean(currentGalleryBranding.introMessage) || galleryCopy.privateGalleryMessage;
  const galleryEventDate = formatEventDateLabel(
    project?.event_date || project?.shoot_date || null,
  );
  const galleryClientLabel =
    clean(project?.client_name) &&
    clean(project?.client_name) !== clean(galleryHeaderTitle) &&
    clean(project?.client_name) !== clean(galleryHeadline)
      ? clean(project?.client_name)
      : "";
  const eventBrandLabel = clean(studioInfo.businessName) || "Studio OS";
  const galleryLocked =
    isProtectedAccessMode(project?.access_mode ?? null, project?.access_pin ?? null) ||
    currentGalleryExtras.galleryAccess === "private" ||
    currentGalleryExtras.passwordProtected;
  const galleryAccessLabel = galleryLocked ? "Private access" : "Open link";
  const galleryAccessNote = galleryLocked
    ? currentGalleryExtras.passwordProtected
      ? "Protected with gallery access controls."
      : "Shared only with approved guests or PIN holders."
    : "Anyone with the link can enter unless an album has its own lock.";
  const galleryFutureBadges = [
    currentGalleryExtras.liveGalleryMode ? "Live event ready" : "",
    currentGalleryExtras.guestIdentificationMode === "qr"
      ? "QR guest mode ready"
      : currentGalleryExtras.guestIdentificationMode === "barcode"
        ? "Barcode guest mode ready"
        : "",
    currentGalleryExtras.instantPhotoDelivery ? "Instant upload feed ready" : "",
    currentGalleryExtras.orderNotificationHooks ? "Order alerts ready" : "",
    currentGalleryExtras.emailCaptureMode === "required"
      ? "Email capture planned"
      : currentGalleryExtras.emailCaptureMode === "optional"
        ? "Optional email capture"
        : "",
  ].filter(Boolean);
  const heroPreviewImages = images.slice(0, Math.min(images.length, 8));
  const featuredAlbums = eventCollectionsWithImages.slice(0, Math.min(eventCollectionsWithImages.length, 3));
  const galleryMetaItems = [
    galleryEventDate,
    showAlbumOverview ? compactCountLabel(eventCollectionsWithImages.length, galleryCopy.album.toLowerCase()) : "",
    !currentGalleryExtras.hideAlbumPhotoCount ? compactCountLabel(images.length, "photo") : "",
    galleryAccessLabel,
  ].filter(Boolean);
  const favoriteImages = useMemo(
    () => images.filter((img) => favorites.has(img.id)),
    [favorites, images],
  );
  const visibleDownloadImages = useMemo(() => {
    if (showAlbumOverview) return [];
    if (activeEventCollectionId) {
      return images.filter((img) => clean(img.collectionId) === activeEventCollectionId);
    }
    return visibleImages;
  }, [activeEventCollectionId, images, showAlbumOverview, visibleImages]);
  const favoriteDownloadNotice =
    !isSchoolMode &&
    favoriteDownloadAccess.enabled &&
    !favoriteDownloadAccess.canDownload &&
    favoriteDownloadAccess.message
      ? favoriteDownloadAccess.message
      : "";
  const galleryDownloadNotice =
    galleryDownloadAccess.enabled &&
    galleryDownloadAccess.audience === "album" &&
    !activeEventCollectionId &&
    !isSchoolMode
      ? "Open a specific album to use this gallery download rule."
      : galleryDownloadAccess.enabled &&
          !galleryDownloadAccess.canDownload &&
          galleryDownloadAccess.message
        ? galleryDownloadAccess.message
        : "";

  function showGalleryActionNotice(message: string) {
    setGalleryActionMessage(message);
    if (galleryActionTimeoutRef.current) {
      window.clearTimeout(galleryActionTimeoutRef.current);
    }
    galleryActionTimeoutRef.current = window.setTimeout(() => {
      setGalleryActionMessage("");
      galleryActionTimeoutRef.current = null;
    }, 3200);
  }

  async function handleShareGallery() {
    if (!currentGalleryExtras.allowSocialSharing) return;

    const shareText =
      clean(currentGalleryExtras.socialShareMessage) ||
      "Check out the photos from this gallery!";
    const shareTitle = galleryHeaderTitle || galleryHeadline;
    const shareUrl = window.location.href;
    const browserNavigator = window.navigator as Navigator & {
      clipboard?: Clipboard;
      share?: (data?: ShareData) => Promise<void>;
    };

    try {
      if (typeof browserNavigator.share === "function") {
        await browserNavigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl,
        });
        showGalleryActionNotice(galleryCopy.shareSheetOpened);
        return;
      }

      const clipboardApi = browserNavigator.clipboard;
      if (clipboardApi?.writeText) {
        await clipboardApi.writeText(`${shareText}\n\n${shareUrl}`);
        showGalleryActionNotice(galleryCopy.galleryLinkCopied);
        return;
      }

      const helper = document.createElement("textarea");
      helper.value = `${shareText}\n\n${shareUrl}`;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      document.body.removeChild(helper);
      showGalleryActionNotice(galleryCopy.galleryLinkCopied);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      showGalleryActionNotice("Could not open share right now.");
    }
  }

  useEffect(() => {
    if (!visibleImages.length) {
      if (selectedImageIndex !== 0) setSelectedImageIndex(0);
      return;
    }
    if (selectedImageIndex >= visibleImages.length) {
      setSelectedImageIndex(0);
    }
  }, [selectedImageIndex, visibleImages.length]);

  useEffect(() => {
    if (!isCompositeSelection) return;
    if (backdropPickerOpen) setBackdropPickerOpen(false);
    if (selectedBackdrop) setSelectedBackdrop(null);
    if (confirmedBackdrop) setConfirmedBackdrop(null);
    if (selectedBlurBackground) setSelectedBlurBackground(false);
    if (confirmedBlurBackground) setConfirmedBlurBackground(false);
    if (selectedBlurAmount !== DEFAULT_BACKDROP_BLUR_PX) setSelectedBlurAmount(DEFAULT_BACKDROP_BLUR_PX);
    if (confirmedBlurAmount !== DEFAULT_BACKDROP_BLUR_PX) setConfirmedBlurAmount(DEFAULT_BACKDROP_BLUR_PX);
    if (compositeDataUrl) setCompositeDataUrl(null);
  }, [
    backdropPickerOpen,
    compositeDataUrl,
    confirmedBackdrop,
    confirmedBlurBackground,
    confirmedBlurAmount,
    isCompositeSelection,
    selectedBackdrop,
    selectedBlurBackground,
    selectedBlurAmount,
  ]);

  useEffect(() => {
    if (!galleryTabs.includes(activeView)) {
      setActiveView("photos");
    }
  }, [activeView, galleryTabs]);

  useEffect(() => {
    if (!blackWhiteFilteringAllowed && blackWhitePreviewEnabled) {
      setBlackWhitePreviewEnabled(false);
    }
  }, [blackWhiteFilteringAllowed, blackWhitePreviewEnabled]);

  useEffect(() => {
    if (!showPhotoViewer || !selectedImage) return;
    const nextButton = viewerThumbnailButtonRefs.current[selectedImage.id];
    if (!nextButton) return;

    nextButton.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [selectedImage, showPhotoViewer]);

  useEffect(() => {
    if (!showPhotoViewer || visibleImages.length <= 1) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (shouldIgnoreGalleryKeyboardEvent(event.target)) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveSelectedImage("prev");
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        moveSelectedImage("next");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showPhotoViewer, visibleImages.length, selectedImage, selectedImageIndex]);

  useEffect(() => {
    if (!loading) {
      setShowLoadingFallback(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setShowLoadingFallback(true);
    }, 420);

    return () => window.clearTimeout(timeoutId);
  }, [loading]);

  useEffect(() => {
    if (isSchoolMode || activeView !== "photos") return;
    if (showAlbumOverview && !eventHasAlbums) {
      setEventPhotoStage("grid");
      return;
    }
    if ((showEventPhotoGrid || showPhotoViewer) && !visibleImages.length) {
      setEventPhotoStage(eventHasAlbums ? "albums" : "grid");
      setSelectedImageIndex(0);
    }
  }, [
    activeView,
    eventHasAlbums,
    isSchoolMode,
    showAlbumOverview,
    showEventPhotoGrid,
    showPhotoViewer,
    visibleImages.length,
  ]);

  useLayoutEffect(() => {
    if (!showEventPhotoGrid) {
      setEventPhotoWallWidth(0);
      return;
    }

    const node = eventPhotoWallRef.current;
    if (!node) return;

    const updateWidth = () => {
      const nextWidth = Math.max(0, Math.floor(node.getBoundingClientRect().width));
      setEventPhotoWallWidth((prev) => (prev === nextWidth ? prev : nextWidth));
    };

    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }

    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(node);
    return () => observer.disconnect();
  }, [showEventPhotoGrid, visibleImages.length]);

  function goBack() {
    if (activeView !== "photos") {
      setActiveView("photos");
      return;
    }
    if (!isSchoolMode) {
      if (eventPhotoStage === "viewer") {
        setEventPhotoStage("grid");
        return;
      }
      if (eventPhotoStage === "grid" && eventHasAlbums) {
        setEventPhotoStage("albums");
        return;
      }
    }
    router.push("/parents");
  }

  async function syncEventFavorite(imageId: string, favorited: boolean) {
    const response = await fetch("/api/portal/event-favorites", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId,
        email: eventEmail,
        pin,
        mediaId: imageId,
        favorited,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      unavailable?: boolean;
    };

    if (payload.unavailable === true) {
      setEventFavoritesAvailable(false);
      return;
    }

    if (!response.ok || payload.ok === false) {
      throw new Error(payload.message || "Could not save favorite.");
    }
  }

  function toggleFavorite(imageId: string) {
    const storageKey = favoriteStorageKey(projectId, eventEmail, pin);
    let nextFavorited = false;
    let nextSetSnapshot = new Set<string>();
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(imageId)) {
        next.delete(imageId);
        nextFavorited = false;
      } else {
        next.add(imageId);
        nextFavorited = true;
      }
      nextSetSnapshot = next;
      writeStoredFavorites(storageKey, next);
      return next;
    });

    if (!isSchoolMode && projectId && eventEmail && eventFavoritesAvailable) {
      void syncEventFavorite(imageId, nextFavorited).catch(() => {
        writeStoredFavorites(storageKey, nextSetSnapshot);
        setFavoriteMessage("Favorite saved only in this browser for now.");
        window.setTimeout(() => setFavoriteMessage(""), 2800);
      });
    }
  }

  async function downloadFavoriteImages() {
    if (favoriteImages.length === 0 || downloadingFavorites) return;
    if (!isSchoolMode && !favoriteDownloadAccess.canDownload) {
      setFavoriteMessage(
        favoriteDownloadAccess.message || "Favorite downloads are not enabled for this gallery.",
      );
      window.setTimeout(() => setFavoriteMessage(""), 3200);
      return;
    }
    setDownloadingFavorites(true);
    setFavoriteMessage("");
    try {
      let allowedImages = favoriteImages;
      if (!isSchoolMode && projectId && eventEmail) {
        const response = await fetch("/api/portal/event-downloads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId,
            email: eventEmail,
            pin,
            mediaIds: favoriteImages.map((image) => image.id),
            downloadType: "favorites",
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          message?: string;
          allowedMediaIds?: string[];
        };

        if (!response.ok || payload.ok === false) {
          throw new Error(payload.message || "Could not prepare favorite downloads.");
        }

        const allowedIds = new Set(
          (payload.allowedMediaIds ?? []).map((value) => clean(value)).filter(Boolean),
        );
        allowedImages = favoriteImages.filter((image) => allowedIds.has(image.id));
        if (!allowedImages.length) {
          throw new Error("There are no favorite downloads available right now.");
        }
      }

      await downloadImagesBatch(allowedImages, {
        resolution: currentGalleryExtras.freeDigitalResolution,
        applyWatermark: currentGalleryExtras.watermarkDownloads,
        includePrintRelease: currentGalleryExtras.includePrintRelease,
        batchLabel: "favorite",
      });
      setFavoriteMessage(
        allowedImages.length === 1
          ? "Favorite ZIP is ready."
          : `${allowedImages.length} favorites packaged into one ZIP.`,
      );
    } catch (error) {
      setFavoriteMessage(getGalleryActionErrorMessage(error, "Could not download favorites."));
    } finally {
      setDownloadingFavorites(false);
      window.setTimeout(() => setFavoriteMessage(""), 3200);
    }
  }

  async function downloadImagesBatch(
    sourceImages: GalleryImage[],
    options: {
      resolution: EventGallerySettings["extras"]["freeDigitalResolution"];
      applyWatermark: boolean;
      includePrintRelease: boolean;
      batchLabel: string;
      onProgress?: (percent: number) => void;
    },
  ) {
    const nextPaint = () =>
      new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    const emitProgress = async (percent: number) => {
      options.onProgress?.(Math.max(1, Math.min(100, Math.round(percent))));
      await nextPaint();
    };
    const watermarkText =
      effectiveWatermarkText || clean(galleryHeadline) || "PROOF";
    let logoImage: HTMLImageElement | null = null;
    const zipEntries: Array<{ name: string; data: Uint8Array }> = [];
    const usedNames = new Map<string, number>();
    const workUnits = sourceImages.length + (options.includePrintRelease ? 1 : 0);

    await emitProgress(8);
    if (options.applyWatermark && clean(effectiveWatermarkLogoUrl)) {
      try {
        logoImage = await imageElementFromUrl(clean(effectiveWatermarkLogoUrl));
      } catch {
        logoImage = null;
      }
    }

    for (let index = 0; index < sourceImages.length; index += 1) {
      const image = sourceImages[index];
      const sourceUrl = preferredDownloadUrl(image, options.resolution);
      if (!sourceUrl) continue;
      const response = await fetch(sourceUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(
          `Failed to download ${image.filename || `${options.batchLabel}-${index + 1}`}.`,
        );
      }
      let blob = await response.blob();
      if (options.applyWatermark) {
        blob = await addWatermarkToBlob(blob, {
          watermarkText,
          logoImage,
        });
      }
      const fallbackName = `${options.batchLabel}-${index + 1}${
        blob.type.includes("png") ? ".png" : ".jpg"
      }`;
      zipEntries.push({
        name: uniqueDownloadName(
          clean(image.filename) || fileNameFromUrl(sourceUrl, fallbackName),
          usedNames,
        ),
        data: new Uint8Array(await blob.arrayBuffer()),
      });

      const completedUnits = index + 1;
      const progressBase = workUnits > 0 ? completedUnits / workUnits : 1;
      await emitProgress(10 + progressBase * 78);
    }

    if (options.includePrintRelease) {
      const releasePdf = await createPrintReleasePdf({
        studioName: clean(studioInfo.businessName) || "Studio OS",
        galleryName: clean(galleryHeadline) || "Event Gallery",
        replyTo: clean(studioInfo.email),
        logoUrl: clean(effectiveWatermarkLogoUrl),
      });
      zipEntries.push({
        name: uniqueDownloadName("Print Release.pdf", usedNames),
        data: new Uint8Array(await releasePdf.arrayBuffer()),
      });
      await emitProgress(90);
    }

    if (!zipEntries.length) {
      throw new Error("There were no downloadable files in this selection.");
    }

    const archiveBaseName = buildArchiveBaseName(
      galleryHeaderTitle || galleryHeadline,
      isSchoolMode ? "school-gallery" : "event-gallery",
    );
    await emitProgress(96);
    const zipBlob = createZipBlob(zipEntries);
    await emitProgress(100);
    triggerDownloadBlob(
      zipBlob,
      `${archiveBaseName} ${options.batchLabel}.zip`,
    );
  }

  async function downloadGalleryImages() {
    if (downloadingGallery) return;
    if (showAlbumOverview) {
      showGalleryActionNotice(galleryCopy.openAlbumToDownload);
      return;
    }
    if (!galleryDownloadAccess.enabled) {
      showGalleryActionNotice(
        galleryDownloadAccess.message || galleryCopy.galleryDownloadsOff,
      );
      return;
    }
    if (!isSchoolMode && galleryDownloadAccess.audience === "album" && !activeEventCollectionId) {
      showGalleryActionNotice("Open a specific album to use this download rule.");
      return;
    }
    if (!galleryDownloadAccess.canDownload) {
      showGalleryActionNotice(
        galleryDownloadAccess.message || "This gallery's free download limit has been reached.",
      );
      return;
    }

    const candidateImages =
      galleryDownloadAccess.audience === "album" && activeEventCollectionId
        ? images.filter((img) => clean(img.collectionId) === activeEventCollectionId)
        : visibleDownloadImages;
    if (!candidateImages.length) {
      showGalleryActionNotice(galleryCopy.noPhotosAvailableDownload);
      return;
    }

    let downloadPin = "";
    if (galleryDownloadAccess.requiresPin) {
      if (!galleryDownloadAccess.hasPinConfigured) {
        showGalleryActionNotice(
          galleryDownloadAccess.message ||
            'A "Download All" PIN needs to be set in Gallery Settings first.',
        );
        return;
      }

      const enteredPin = window.prompt(
        isSchoolMode
          ? 'Enter the "Download All" PIN for this school gallery.'
          : 'Enter the "Download All" PIN for this event gallery.',
        "",
      );

      if (enteredPin === null) {
        return;
      }

      downloadPin = clean(enteredPin);
      if (!downloadPin) {
        showGalleryActionNotice("Please enter the download PIN to continue.");
        return;
      }
    }

    setDownloadingGallery(true);
    setGalleryDownloadProgress(3);
    try {
      const response = await fetch(
        isSchoolMode ? "/api/portal/school-downloads" : "/api/portal/event-downloads",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: isSchoolMode ? undefined : projectId,
            schoolId: isSchoolMode ? schoolId : undefined,
            email: isSchoolMode ? schoolViewerEmail : eventEmail,
            pin,
            downloadPin,
            collectionId:
              !isSchoolMode && galleryDownloadAccess.audience === "album"
                ? activeEventCollectionId
                : null,
            mediaIds: candidateImages.map((image) => image.id),
            downloadType: "gallery",
          }),
        },
      );

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        allowedMediaIds?: string[];
        downloadsUsed?: number;
        downloadsRemaining?: number | null;
      };

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || "Could not prepare gallery downloads.");
      }

      setGalleryDownloadProgress(8);

      const allowedIds = new Set(
        (payload.allowedMediaIds ?? []).map((value) => clean(value)).filter(Boolean),
      );
      const allowedImages = candidateImages.filter((image) => allowedIds.has(image.id));

      if (!allowedImages.length) {
        throw new Error(galleryCopy.freeLimitReached);
      }

      await downloadImagesBatch(allowedImages, {
        resolution: galleryDownloadAccess.resolution,
        applyWatermark: currentGalleryExtras.watermarkDownloads,
        includePrintRelease: currentGalleryExtras.includePrintRelease,
        batchLabel: "gallery",
        onProgress: setGalleryDownloadProgress,
      });

      setGalleryDownloadAccess((prev) => ({
        ...prev,
        downloadsUsed:
          typeof payload.downloadsUsed === "number"
            ? payload.downloadsUsed
            : prev.downloadsUsed + allowedImages.length,
        downloadsRemaining:
          payload.downloadsRemaining === null ||
          typeof payload.downloadsRemaining === "number"
            ? payload.downloadsRemaining
            : prev.downloadsRemaining,
        canDownload:
          payload.downloadsRemaining === null
            ? true
            : typeof payload.downloadsRemaining === "number"
              ? payload.downloadsRemaining > 0
              : prev.canDownload,
        message:
          payload.downloadsRemaining === 0
            ? "This gallery's free download limit has been reached."
            : prev.message,
      }));

      showGalleryActionNotice(
        allowedImages.length === candidateImages.length
          ? `${allowedImages.length} photo${
              allowedImages.length === 1 ? "" : "s"
            } packaged into one ZIP.`
          : `${allowedImages.length} of ${candidateImages.length} photos packaged within this gallery's free limit.`,
      );
    } catch (error) {
      showGalleryActionNotice(
        getGalleryActionErrorMessage(error, "Could not download gallery photos."),
      );
    } finally {
      setDownloadingGallery(false);
      setGalleryDownloadProgress(null);
    }
  }

  function openImageInGallery(image: GalleryImage) {
    if (!isSchoolMode && clean(image.collectionId)) {
      const nextCollectionId = clean(image.collectionId);
      const nextVisibleImages =
        nextCollectionId.length > 0
          ? images.filter((item) => clean(item.collectionId) === nextCollectionId)
          : images;
      const nextIndex = Math.max(
        0,
        nextVisibleImages.findIndex((item) => item.id === image.id),
      );
      setActiveEventCollectionId(nextCollectionId);
      setSelectedImageIndex(nextIndex >= 0 ? nextIndex : 0);
    } else {
      const nextIndex = Math.max(
        0,
        visibleImages.findIndex((item) => item.id === image.id),
      );
      setSelectedImageIndex(nextIndex >= 0 ? nextIndex : 0);
    }
    setEventPhotoStage("viewer");
    setActiveView("photos");
  }

  function focusImageForActions(image: GalleryImage) {
    if (!isSchoolMode && clean(image.collectionId)) {
      const nextCollectionId = clean(image.collectionId);
      const nextVisibleImages =
        nextCollectionId.length > 0
          ? images.filter((item) => clean(item.collectionId) === nextCollectionId)
          : images;
      const nextIndex = Math.max(
        0,
        nextVisibleImages.findIndex((item) => item.id === image.id),
      );
      setActiveEventCollectionId(nextCollectionId);
      setSelectedImageIndex(nextIndex >= 0 ? nextIndex : 0);
    } else {
      const nextIndex = Math.max(
        0,
        images.findIndex((item) => item.id === image.id),
      );
      setSelectedImageIndex(nextIndex >= 0 ? nextIndex : 0);
    }
    setEventPhotoStage("viewer");
    setActiveView("photos");
  }

  function openBuyDrawerForImage(image: GalleryImage) {
    focusImageForActions(image);
    openBuyDrawer();
  }

  function openBackdropPickerForImage(image: GalleryImage) {
    focusImageForActions(image);
    openBackdropPicker();
  }

  function openEventPhotoGrid(collectionId: string | null) {
    setActiveEventCollectionId(collectionId);
    setSelectedImageIndex(0);
    setEventPhotoStage("grid");
    setActiveView("photos");
  }

  function openAlbumsOverview() {
    setSelectedImageIndex(0);
    setEventPhotoStage("albums");
    setActiveView("photos");
  }

  function handleGalleryPickerChange(value: string) {
    if (value === "__albums__") {
      openAlbumsOverview();
      return;
    }

    if (value === "__all__") {
      openEventPhotoGrid(null);
      return;
    }

    if (value.startsWith("album:")) {
      openEventPhotoGrid(value.slice(6));
    }
  }

  function getPhotoReference(index: number, image: GalleryImage) {
    const number = `Photo ${String(index + 1).padStart(3, "0")}`;
    const name = clean(image.filename).replace(/\.[^.]+$/, "");
    return {
      number,
      name,
      full: name ? `${number} · ${name}` : number,
    };
  }

  async function handleShareImage(image: GalleryImage, index: number) {
    if (!currentGalleryExtras.allowSocialSharing) return;

    const reference = getPhotoReference(index, image);
    const shareText =
      clean(currentGalleryExtras.socialShareMessage) ||
      `Please ask the photographer about ${reference.full}.`;
    const shareTitle = `${galleryHeaderTitle || galleryHeadline} · ${reference.number}`;
    const shareUrl = window.location.href;
    const browserNavigator = window.navigator as Navigator & {
      clipboard?: Clipboard;
      share?: (data?: ShareData) => Promise<void>;
    };

    try {
      if (typeof browserNavigator.share === "function") {
        await browserNavigator.share({
          title: shareTitle,
          text: `${shareText}\n${reference.full}`,
          url: shareUrl,
        });
        showGalleryActionNotice(galleryCopy.shareSheetOpened);
        return;
      }

      const sharePayload = `${reference.full}\n${shareText}\n\n${shareUrl}`;
      if (browserNavigator.clipboard?.writeText) {
        await browserNavigator.clipboard.writeText(sharePayload);
        showGalleryActionNotice(`${reference.number} copied.`);
        return;
      }

      const helper = document.createElement("textarea");
      helper.value = sharePayload;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      document.body.removeChild(helper);
      showGalleryActionNotice(`${reference.number} copied.`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      showGalleryActionNotice("Could not share this photo right now.");
    }
  }

  async function downloadSingleImage(image: GalleryImage, index: number) {
    const reference = getPhotoReference(index, image);

    if (!galleryDownloadAccess.enabled) {
      showGalleryActionNotice("Downloads are not enabled for this gallery.");
      return;
    }

    if (galleryDownloadAccess.audience === "album" && !activeEventCollectionId) {
      showGalleryActionNotice("Open a specific album to download this photo.");
      return;
    }

    if (!galleryDownloadAccess.canDownload) {
      showGalleryActionNotice(
        galleryDownloadAccess.message || "This photo cannot be downloaded right now.",
      );
      return;
    }

    let downloadPin = "";
    if (galleryDownloadAccess.requiresPin) {
      if (!galleryDownloadAccess.hasPinConfigured) {
        showGalleryActionNotice(
          galleryDownloadAccess.message ||
            'A "Download All" PIN needs to be set in Gallery Settings first.',
        );
        return;
      }

      const enteredPin = window.prompt(
        'Enter the "Download All" PIN for this event gallery.',
        "",
      );

      if (enteredPin === null) {
        return;
      }

      downloadPin = clean(enteredPin);
      if (!downloadPin) {
        showGalleryActionNotice("Please enter the download PIN to continue.");
        return;
      }
    }

    try {
      const response = await fetch("/api/portal/event-downloads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          email: eventEmail,
          pin,
          downloadPin,
          collectionId:
            galleryDownloadAccess.audience === "album" ? activeEventCollectionId : null,
          mediaIds: [image.id],
          downloadType: "gallery",
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        allowedMediaIds?: string[];
        downloadsUsed?: number;
        downloadsRemaining?: number | null;
      };

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || "Could not prepare this photo for download.");
      }

      const allowedIds = new Set(
        (payload.allowedMediaIds ?? []).map((value) => clean(value)).filter(Boolean),
      );
      if (!allowedIds.has(image.id)) {
        throw new Error("This photo is not available for download right now.");
      }

      await downloadImagesBatch([image], {
        resolution: galleryDownloadAccess.resolution,
        applyWatermark: currentGalleryExtras.watermarkDownloads,
        includePrintRelease: currentGalleryExtras.includePrintRelease,
        batchLabel: "photo",
      });

      setGalleryDownloadAccess((prev) => ({
        ...prev,
        downloadsUsed:
          typeof payload.downloadsUsed === "number"
            ? payload.downloadsUsed
            : prev.downloadsUsed + 1,
        downloadsRemaining:
          payload.downloadsRemaining === null ||
          typeof payload.downloadsRemaining === "number"
            ? payload.downloadsRemaining
            : prev.downloadsRemaining,
        canDownload:
          payload.downloadsRemaining === null
            ? true
            : typeof payload.downloadsRemaining === "number"
              ? payload.downloadsRemaining > 0
              : prev.canDownload,
        message:
          payload.downloadsRemaining === 0
            ? "This gallery's free download limit has been reached."
            : prev.message,
      }));

      showGalleryActionNotice(`${reference.number} download prepared.`);
    } catch (error) {
      showGalleryActionNotice(
        getGalleryActionErrorMessage(error, "Could not download this photo."),
      );
    }
  }

  function renderPhotoWallCard(
    img: GalleryImage,
    index: number,
    options?: {
      layout?: "subway" | "cascade" | "editorial";
      featured?: boolean;
      imageAspectRatio?: number;
    },
  ) {
    const layout = options?.layout ?? photoWallStyle;
    const isFavorited = favorites.has(img.id);
    const isEventPhotoWall = !isSchoolMode && activeView === "photos";
    const imagePadding = isEventPhotoWall ? 0 : options?.featured ? 14 : layout === "subway" ? 8 : 6;
    const wallImageCandidates = buildGalleryImageCandidates(img, "wall");
    const cardImageUrl = wallImageCandidates[0] || img.downloadUrl || img.url;
    const photoReference = getPhotoReference(index, img);
    const imageLoaded = loadedGalleryImageIds.has(img.id);
    const eventImageAspectRatio = isEventPhotoWall
      ? getEventWallAspectRatio(options?.imageAspectRatio ?? galleryImageRatios[img.id])
      : null;
    const canHoverDownload =
      isEventPhotoWall &&
      galleryDownloadAccess.enabled &&
      (galleryDownloadAccess.audience !== "album" || !!activeEventCollectionId);
    const canHoverShare = isEventPhotoWall && currentGalleryExtras.allowSocialSharing;

    return (
      <div
        key={img.id}
        onClick={() => openImageInGallery(img)}
        className={isEventPhotoWall ? "event-photo-card" : undefined}
        style={{
          textAlign: "left",
          background: isEventPhotoWall ? "transparent" : galleryTone.surface,
          border: isEventPhotoWall
            ? "none"
            : layout === "subway"
              ? `1px solid ${galleryTone.border}`
              : `1px solid ${isLightGallery ? galleryTone.border : "rgba(255,255,255,0.06)"}`,
          borderRadius: isEventPhotoWall ? 0 : layout === "subway" ? 22 : 26,
          overflow: "hidden",
          cursor: "pointer",
          padding: 0,
          boxShadow:
            isEventPhotoWall
              ? "none"
              : isLightGallery
              ? "0 18px 40px rgba(15,23,42,0.08)"
              : "0 18px 44px rgba(0,0,0,0.24)",
          alignSelf: "start",
        }}
      >
        <div
          style={{
            position: "relative",
            background: isEventPhotoWall
              ? "transparent"
              : isLightGallery
                ? "linear-gradient(180deg, #f7f7f6 0%, #efefec 100%)"
                : "linear-gradient(180deg, #141414 0%, #0b0b0b 100%)",
            padding: imagePadding,
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              position: "relative",
              borderRadius: isEventPhotoWall ? 0 : 18,
              overflow: "hidden",
              background: isEventPhotoWall ? "#efeae2" : isLightGallery ? "#f8f8f7" : "#090909",
              aspectRatio: eventImageAspectRatio ?? undefined,
            }}
          >
            {!imageLoaded ? (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: isEventPhotoWall
                    ? "linear-gradient(135deg, #efe7dc 0%, #f7f2ea 45%, #efe7dc 100%)"
                    : isLightGallery
                      ? "linear-gradient(135deg, #f7f7f6 0%, #efefec 100%)"
                      : "linear-gradient(135deg, #141414 0%, #222222 100%)",
                  display: "grid",
                  placeItems: "center",
                  zIndex: 1,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 10,
                    color: isEventPhotoWall ? "#8a7866" : isLightGallery ? "#98a2b3" : "#9ca3af",
                  }}
                >
                  <LoaderCircle size={24} />
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    Loading photo
                  </div>
                </div>
              </div>
            ) : null}
            <img
              src={cardImageUrl}
              data-candidates={wallImageCandidates.join("|")}
              data-candidate-index="0"
              onError={handleGalleryImageError}
              onLoad={(event) =>
                markGalleryImageLoaded(
                  img.id,
                  getSafeAspectRatio(
                    event.currentTarget.naturalWidth,
                    event.currentTarget.naturalHeight,
                  ),
                )
              }
              alt=""
              loading={index < 16 ? "eager" : "lazy"}
              fetchPriority={index < 6 ? "high" : "auto"}
              decoding="async"
              style={{
                width: "100%",
                height: isEventPhotoWall ? "100%" : "auto",
                display: "block",
                background: isEventPhotoWall ? "#efeae2" : isLightGallery ? "#f8f8f7" : "#090909",
                maxHeight: options?.featured && !isEventPhotoWall ? 620 : "none",
                objectFit: "contain",
                margin: "0 auto",
                filter: galleryImageFilter,
                opacity: imageLoaded ? 1 : 0.02,
                transition: "opacity 220ms ease",
                position: "relative",
                zIndex: 2,
              }}
            />
            {showProofWatermark ? <WatermarkOverlay text={effectiveWatermarkText} logoUrl={effectiveWatermarkLogoUrl} /> : null}
            {isEventPhotoWall && (canHoverDownload || canHoverShare || true) ? (
              <div
                className="event-photo-actions"
                style={{
                  position: "absolute",
                  left: "50%",
                  bottom: 14,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  zIndex: 3,
                }}
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleFavorite(img.id);
                  }}
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.22)",
                    background: "rgba(17,17,17,0.38)",
                    backdropFilter: "blur(12px)",
                    color: "#ffffff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}
                  aria-label={isFavorited ? "Remove favorite" : "Add favorite"}
                >
                  <Heart size={18} fill={isFavorited ? "#ffffff" : "none"} />
                </button>

                {canHoverDownload ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void downloadSingleImage(img, index);
                    }}
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.22)",
                      background: "rgba(17,17,17,0.38)",
                      backdropFilter: "blur(12px)",
                      color: "#ffffff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                    }}
                    aria-label="Download photo"
                  >
                    <Download size={18} />
                  </button>
                ) : null}

                {canHoverShare ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleShareImage(img, index);
                    }}
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.22)",
                      background: "rgba(17,17,17,0.38)",
                      backdropFilter: "blur(12px)",
                      color: "#ffffff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                    }}
                    aria-label="Share photo"
                  >
                    <Share2 size={18} />
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {isEventPhotoWall ? (
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 10,
                padding: "8px 2px 0",
                color: "#6b635b",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                {photoReference.number}
              </div>
              {photoReference.name ? (
                <div
                  style={{
                    minWidth: 0,
                    flex: 1,
                    textAlign: "right",
                    fontSize: 11,
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={photoReference.name}
                >
                  {photoReference.name}
                </div>
              ) : null}
            </div>
          ) : (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  layout === "subway"
                    ? "linear-gradient(180deg, rgba(15,23,42,0.01) 0%, rgba(15,23,42,0.05) 100%)"
                    : "linear-gradient(180deg, rgba(15,23,42,0.01) 0%, rgba(15,23,42,0.1) 100%)",
                pointerEvents: "none",
              }}
            />
          )}
          {isEventPhotoWall ? null : (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                toggleFavorite(img.id);
              }}
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                borderRadius: 999,
                border: `1px solid ${isFavorited ? "rgba(239,68,68,0.35)" : "rgba(255,255,255,0.14)"}`,
                background: isFavorited ? "rgba(239,68,68,0.18)" : "rgba(10,10,10,0.55)",
                color: isFavorited ? "#f87171" : galleryTone.text,
                width: 34,
                height: 34,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backdropFilter: "blur(12px)",
              }}
            >
              <Heart size={15} fill={isFavorited ? "#f87171" : "none"} />
            </button>
          )}
        </div>
      </div>
    );
  }

  function renderPhotoWall(imagesToRender: GalleryImage[]) {
    const isEventPhotoWall = !isSchoolMode && activeView === "photos";
    const columnItemStyle = {
      breakInside: "avoid-column",
      pageBreakInside: "avoid",
      display: "inline-block",
      width: "100%",
      WebkitColumnBreakInside: "avoid",
    } as React.CSSProperties & Record<string, string>;

    if (isEventPhotoWall) {
      const eventGap = Math.max(12, Math.min(galleryGap, 16));
      const eventColumnWidth = Math.max(220, photoWallColumnWidth - 30);
      const eventWallFallbackWidth =
        typeof window !== "undefined"
          ? Math.max(320, Math.floor(window.innerWidth - 48))
          : Math.max(980, eventColumnWidth * 4 + eventGap * 3);
      const eventTargetRowHeight = Math.max(
        210,
        Math.min(250, Math.round(eventColumnWidth * 0.98)),
      );
      const eventRows = buildEventPhotoRows(
        imagesToRender,
        galleryImageRatios,
        eventPhotoWallWidth || eventWallFallbackWidth,
        eventGap,
        eventTargetRowHeight,
      );
      return (
        <div
          ref={eventPhotoWallRef}
          style={{
            display: "grid",
            gap: `${eventGap}px`,
            alignContent: "start",
          }}
        >
          {eventRows.map((row, rowIndex) => (
            <div
              key={`event-wall-row-${rowIndex}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: `${eventGap}px`,
              }}
            >
              {row.items.map((item) => (
                <div
                  key={item.image.id}
                  style={{
                    width: `${item.width}px`,
                    flex: `0 0 ${item.width}px`,
                    minWidth: 0,
                  }}
                >
                  {renderPhotoWallCard(item.image, item.index, {
                    layout: "cascade",
                    imageAspectRatio: item.aspectRatio,
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      );
    }

    if (photoWallStyle === "cascade") {
      return (
        <div
          style={{
            columnWidth: `${photoWallColumnWidth}px`,
            columnGap: `${galleryGap}px`,
          }}
        >
          {imagesToRender.map((img, index) => (
            <div
              key={img.id}
              style={{
                ...columnItemStyle,
                marginBottom: galleryGap,
              }}
            >
              {renderPhotoWallCard(img, index, { layout: "cascade" })}
            </div>
          ))}
        </div>
      );
    }

    if (photoWallStyle === "editorial" && imagesToRender.length > 0) {
      const leadImages = imagesToRender.slice(0, Math.min(5, imagesToRender.length));
      const trailingImages = imagesToRender.slice(Math.min(5, imagesToRender.length));

      return (
        <div style={{ display: "grid", gap: galleryGap + 6 }}>
          {leadImages.length ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: leadImages.length > 1 ? "minmax(0, 1.35fr) minmax(320px, 1fr)" : "minmax(0, 1fr)",
                gap: galleryGap,
                alignItems: "stretch",
              }}
            >
              <div>{renderPhotoWallCard(leadImages[0], 0, { layout: "editorial", featured: true })}</div>
              {leadImages.length > 1 ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: leadImages.length > 3 ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)",
                    gap: galleryGap,
                  }}
                >
                  {leadImages.slice(1).map((img, index) => renderPhotoWallCard(img, index + 1, { layout: "editorial" }))}
                </div>
              ) : null}
            </div>
          ) : null}

          {trailingImages.length ? (
            <div
              style={{
                columnWidth: `${Math.max(220, photoWallColumnWidth - 20)}px`,
                columnGap: `${galleryGap}px`,
              }}
            >
              {trailingImages.map((img, index) => (
                <div
                  key={img.id}
                  style={{
                    ...columnItemStyle,
                    marginBottom: galleryGap,
                  }}
                >
                  {renderPhotoWallCard(img, index + leadImages.length, { layout: "editorial" })}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fill, minmax(${photoGridMinWidth}px, 1fr))`,
          gap: galleryGap,
        }}
      >
        {imagesToRender.map((img, index) => renderPhotoWallCard(img, index, { layout: "subway" }))}
      </div>
    );
  }

  function moveSelectedImage(direction: "prev" | "next") {
    if (!visibleImages.length) return;

    const currentIndex = selectedImage
      ? visibleImages.findIndex((item) => item.id === selectedImage.id)
      : selectedImageIndex;

    const safeIndex = currentIndex >= 0 ? currentIndex : selectedImageIndex;
    const nextIndex =
      direction === "prev"
        ? safeIndex === 0
          ? visibleImages.length - 1
          : safeIndex - 1
        : safeIndex === visibleImages.length - 1
          ? 0
          : safeIndex + 1;

    setSelectedImageIndex(nextIndex);
  }

  function goPrev() {
    moveSelectedImage("prev");
  }

  function goNext() {
    moveSelectedImage("next");
  }

  function openBuyDrawer() {
    if (orderingDisabled) return;
    setBackdropPickerOpen(false);
    setDrawerView("product-select");
    setDrawerOpen(true);
    setActiveSlotIndex(null);
  }

  function openCategory(catKey: string) {
    setActiveCategoryKey(catKey);
    setDrawerView("category-list");
  }

  function getChosenQty(pkgId: string) {
    return Math.max(1, packageQuantities[pkgId] ?? 1);
  }

  function setChosenQty(pkgId: string, nextQty: number) {
    setPackageQuantities((prev) => ({ ...prev, [pkgId]: Math.max(1, nextQty) }));
  }

  function selectPackage(pkg: PackageRow) {
    if (orderingDisabled) return;

    const chosenQty = getChosenQty(pkg.id);
    const compositeSelectedImage =
      selectedImage && isCompositeGalleryImage(selectedImage) ? selectedImage : null;
    const initialAssignedImageUrl =
      compositeSelectedImage?.url ??
      (selectedImage && !isCompositeGalleryImage(selectedImage)
        ? selectedImage.url
        : null);
    setSelectedOrderQty(chosenQty);
    setSelectedPkg(pkg);

    // Find the first composite image for auto-filling composite slots in mixed packages
    const firstCompositeImage = images.find((img) => img.source === "composite");
    const compositeAutoFillUrl = firstCompositeImage?.url ?? null;

    const newSlots = buildSlots(pkg, chosenQty, compositeAutoFillUrl);
    setSlots(
      newSlots.map((s) => ({
        ...s,
        // For non-composite slots, pre-assign the selected image; composite slots keep their auto-fill
        assignedImageUrl: s.composite ? s.assignedImageUrl : initialAssignedImageUrl,
      }))
    );
    setActiveSlotIndex(null);

    if (getCategory(pkg) === "digital" || compositeSelectedImage) {
      setDrawerView("checkout");
    } else {
      setDrawerView("build-package");
    }
  }

  function selectBuyAllPackage() {
    if (!buyAllPackage || orderingDisabled) return;
    openBuyDrawer();
    setActiveCategoryKey(getCategory(buyAllPackage));
    selectPackage(buyAllPackage);
  }

  function assignImageToSlot(imageUrl: string) {
    if (activeSlotIndex === null) return;
    // Don't allow assigning to composite slots — they're auto-filled
    if (slots[activeSlotIndex]?.composite) return;
    const selectedGalleryImage = visibleImages.find((img) => img.url === imageUrl);
    if (isCompositeGalleryImage(selectedGalleryImage)) return;
    setSlots((prev) =>
      prev.map((s, i) =>
        i === activeSlotIndex ? { ...s, assignedImageUrl: imageUrl } : s
      )
    );
    // Skip composite slots when finding next empty
    const nextEmpty = slots.findIndex(
      (s, i) => i > activeSlotIndex && !s.assignedImageUrl && !s.composite
    );
    setActiveSlotIndex(nextEmpty >= 0 ? nextEmpty : null);
  }

  const allSlotsAssigned = slots.every((s) => s.assignedImageUrl !== null);
  const compositeSelectedImage =
    isCompositeSelection && isCompositeGalleryImage(selectedImage) ? selectedImage : null;
  const packageAssignableImages = useMemo(
    () =>
      compositeSelectedImage
        ? [compositeSelectedImage]
        : visibleImages.filter((img) => !isCompositeGalleryImage(img)),
    [compositeSelectedImage, visibleImages],
  );
  const storefrontPackages = useMemo(
    () =>
      isCompositeSelection ? packages.filter((pkg) => isCompositeEligiblePackage(pkg)) : packages,
    [isCompositeSelection, packages],
  );
  const packagesInCategory = storefrontPackages.filter(
    (p) => getCategory(p) === activeCategoryKey
  );

  const tilesWithData = TILES.map((tile) => ({
    ...tile,
    count: storefrontPackages.filter((p) => getCategory(p) === tile.key).length,
    minPrice: (() => {
      const pkgs = storefrontPackages.filter((p) => getCategory(p) === tile.key);
      return pkgs.length ? Math.min(...pkgs.map((p) => p.price_cents)) / 100 : null;
    })(),
  })).filter((t) => t.count > 0);
  const storeTiles = isCompositeSelection
    ? tilesWithData
    : currentGalleryExtras.offerPackagesOnly
    ? tilesWithData.filter((tile) => tile.key === "package")
    : tilesWithData;

  useEffect(() => {
    const availableTileKeys = new Set(storeTiles.map((tile) => tile.key));
    if (availableTileKeys.has(activeCategoryKey)) return;
    const nextCategory = storeTiles[0]?.key ?? "package";
    if (activeCategoryKey !== nextCategory) {
      setActiveCategoryKey(nextCategory);
    }
  }, [activeCategoryKey, storeTiles]);

  useEffect(() => {
    if (!selectedPkg) return;
    const stillAllowed = storefrontPackages.some((pkg) => pkg.id === selectedPkg.id);
    if (stillAllowed) return;
    setSelectedPkg(null);
    setSlots([]);
    setActiveSlotIndex(null);
    setDrawerView("product-select");
  }, [selectedPkg, storefrontPackages]);

  useEffect(() => {
    if (!compositeSelectedImage || !selectedPkg) return;
    const compositeUrl = compositeSelectedImage.url;
    const slotsNeedUpdate = slots.some((slot) => slot.assignedImageUrl !== compositeUrl);
    if (slotsNeedUpdate) {
      setSlots((prev) =>
        prev.map((slot) => ({
          ...slot,
          assignedImageUrl: compositeUrl,
        })),
      );
    }
    if (drawerView === "build-package") {
      setActiveSlotIndex(null);
      setDrawerView("checkout");
    }
  }, [compositeSelectedImage, drawerView, selectedPkg, slots]);

  const minimumOrderAmountCents = parseCurrencyToCents(
    currentGalleryExtras.minimumOrderAmount,
  );
  const buyAllPackage = useMemo(
    () =>
      isCompositeSelection
        ? null
        : storefrontPackages.find((pkg) => isAllDigitalsPackage(pkg)) ?? null,
    [isCompositeSelection, storefrontPackages],
  );

  // ── Backdrop helpers (school mode only) ─────────────────────────────────
  const hasBackdrops = isSchoolMode && !isCompositeSelection && backdrops.length > 0;
  const currentNobgUrl = selectedImage ? (nobgUrls[selectedImage.id] ?? null) : null;
  const confirmedBackdropVerticalOffset = getBackdropForegroundVerticalOffset(selectedImageAspectRatio);
  // Generate a composite data URL for use in buy section mockups
  useEffect(() => {
    const activeConfirmedBackdrop = confirmedBackdrop;
    if (!activeConfirmedBackdrop || !currentNobgUrl || !selectedImage) {
      setCompositeDataUrl(null);
      return;
    }

    let cancelled = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = 600, H = 800;
    canvas.width = W;
    canvas.height = H;

    const bgImg = new Image();
    bgImg.crossOrigin = "anonymous";
    const fgImg = new Image();
    fgImg.crossOrigin = "anonymous";

    let bgDone = false, fgDone = false;

    function draw() {
      if (cancelled || !bgDone || !fgDone) return;
      ctx!.clearRect(0, 0, W, H);
      // BG cover
      const bgR = bgImg.naturalWidth / bgImg.naturalHeight;
      const cR = W / H;
      let sx = 0, sy = 0, sw = bgImg.naturalWidth, sh = bgImg.naturalHeight;
      if (bgR > cR) { sw = bgImg.naturalHeight * cR; sx = (bgImg.naturalWidth - sw) / 2; }
      else { sh = bgImg.naturalWidth / cR; sy = (bgImg.naturalHeight - sh) / 2; }
      const effectiveBackdropBlurPx = confirmedBlurBackground
        ? getEffectiveBackdropBlurPx(confirmedBlurAmount)
        : 0;
      if (effectiveBackdropBlurPx > 0) {
        ctx!.filter = `blur(${effectiveBackdropBlurPx}px)`;
      }
      ctx!.drawImage(bgImg, sx, sy, sw, sh, 0, 0, W, H);
      if (effectiveBackdropBlurPx > 0) {
        ctx!.filter = "none";
      }
      // FG preserve original photo framing so the subject does not look zoomed.
      const fgRatio = fgImg.naturalWidth / fgImg.naturalHeight;
      let fgSx = 0;
      let fgSy = 0;
      let fgSw = fgImg.naturalWidth;
      let fgSh = fgImg.naturalHeight;
      if (fgRatio > cR) {
        fgSw = fgImg.naturalHeight * cR;
        fgSx = (fgImg.naturalWidth - fgSw) / 2;
      } else {
        fgSh = fgImg.naturalWidth / cR;
        fgSy = (fgImg.naturalHeight - fgSh) / 2;
      }
      ctx!.drawImage(fgImg, fgSx, fgSy, fgSw, fgSh, 0, 0, W, H);
      if (!cancelled) {
        setCompositeDataUrl(canvas.toDataURL("image/png"));
      }
    }

    bgImg.onload = () => { bgDone = true; draw(); };
    fgImg.onload = () => { fgDone = true; draw(); };
    bgImg.onerror = () => { bgDone = true; draw(); };
    fgImg.onerror = () => { fgDone = true; draw(); };

    bgImg.src = activeConfirmedBackdrop.image_url;
    fgImg.src = currentNobgUrl;

    return () => { cancelled = true; };
  }, [
    confirmedBackdrop,
    confirmedBackdropVerticalOffset,
    confirmedBlurAmount,
    confirmedBlurBackground,
    currentNobgUrl,
    selectedImage,
  ]);

  // Use composite in buy section when backdrop is confirmed
  const effectiveImageUrl = compositeDataUrl ?? selectedImage?.url ?? null;
  const effectiveImageAspectRatio = useImageAspectRatio(effectiveImageUrl);

  // Premium backdrop pricing — added to checkout total
  const premiumBackdropCents =
    confirmedBackdrop && confirmedBackdrop.tier === "premium"
      ? (confirmedBackdrop.price_cents ?? 0)
      : 0;
  const currentDraftCartItem = useMemo<CartLineItem | null>(() => {
    if (!selectedPkg) return null;

    const category = getCategory(selectedPkg);
    const isDigital = category === "digital";
    if (!isDigital && slots.some((slot) => !slot.assignedImageUrl)) return null;

    const selectedImageUrl =
      selectedImage?.downloadUrl ?? selectedImage?.previewUrl ?? selectedImage?.url ?? null;
    const packageSubtotalCents = selectedPkg.price_cents * selectedOrderQty;
    const backdropSnapshot = confirmedBackdrop
      ? {
          id: confirmedBackdrop.id,
          name: confirmedBackdrop.name,
          image_url: confirmedBackdrop.image_url,
          tier: confirmedBackdrop.tier,
          price_cents: confirmedBackdrop.price_cents,
          blurred: confirmedBlurBackground,
          blurAmount: confirmedBlurBackground ? confirmedBlurAmount : 0,
        }
      : null;

    return {
      id: "__draft__",
      packageId: selectedPkg.id,
      packageName: selectedPkg.name,
      category,
      quantity: selectedOrderQty,
      packageSubtotalCents,
      backdropAddOnCents: premiumBackdropCents,
      lineTotalCents: packageSubtotalCents + premiumBackdropCents,
      slots: slots.map((slot) => ({ ...slot })),
      selectedImageUrl,
      isCompositeOrder: isSchoolMode && isCompositeSelection,
      compositeTitle: selectedImage?.title || student?.class_name || null,
      backdrop: backdropSnapshot,
    };
  }, [
    confirmedBackdrop,
    confirmedBlurAmount,
    confirmedBlurBackground,
    isCompositeSelection,
    isSchoolMode,
    premiumBackdropCents,
    selectedImage,
    selectedOrderQty,
    selectedPkg,
    slots,
    student?.class_name,
  ]);

  const checkoutItems = useMemo(
    () => (currentDraftCartItem ? [...cartItems, currentDraftCartItem] : cartItems),
    [cartItems, currentDraftCartItem],
  );
  const basketItemCount = cartItems.length;
  const anyPhysicalCheckoutItem = checkoutItems.some((item) => item.category !== "digital");
  const checkoutSubtotalCents = checkoutItems.reduce(
    (sum, item) => sum + item.packageSubtotalCents,
    0,
  );
  const checkoutBackdropTotalCents = checkoutItems.reduce(
    (sum, item) => sum + item.backdropAddOnCents,
    0,
  );
  const checkoutTotalCents = checkoutItems.reduce((sum, item) => sum + item.lineTotalCents, 0);

  function resetCurrentSelection() {
    setSelectedPkg(null);
    setSelectedOrderQty(1);
    setSlots([]);
    setActiveSlotIndex(null);
  }

  function openCartCheckout() {
    setBackdropPickerOpen(false);
    setDrawerOpen(true);
    setDrawerView("checkout");
    setActiveSlotIndex(null);
  }

  function addCurrentSelectionToCart() {
    if (!currentDraftCartItem) return;
    setCartItems((prev) => [
      ...prev,
      {
        ...currentDraftCartItem,
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `cart_${Date.now()}_${prev.length + 1}`,
      },
    ]);
    resetCurrentSelection();
    setOrderError("");
    setDrawerView("product-select");
  }

  function removeCartItem(cartItemId: string) {
    setCartItems((prev) => prev.filter((item) => item.id !== cartItemId));
  }

  function continueShoppingAfterCheckout() {
    setPlaced(false);
    setOrderId("");
    setOrderError("");
    setPlacing(false);
    setCartItems([]);
    resetCurrentSelection();
    setDrawerOpen(false);
    setBackdropPickerOpen(false);

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete("checkout");
    nextUrl.searchParams.delete("session_id");
    router.replace(`${nextUrl.pathname}${nextUrl.search}`);
  }
  const filteredBackdrops = useMemo(
    () => (
      backdropCategory === "all"
        ? backdrops
        : backdrops.filter((b) => b.category === backdropCategory)
    ),
    [backdropCategory, backdrops],
  );
  const backdropCategoriesWithData = useMemo(
    () =>
      BACKDROP_CATEGORIES.filter(
        (cat) => cat.key === "all" || backdrops.some((b) => b.category === cat.key),
      ),
    [backdrops],
  );

  useEffect(() => {
    if (!backdropPickerOpen || !filteredBackdrops.length) return;

    const backdropPreviewQueue = filteredBackdrops.slice(0, 6);
    const preloaders: HTMLImageElement[] = [];
    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const startPreload = () => {
      for (const backdrop of backdropPreviewQueue) {
        const src = buildBackdropImageCandidates(backdrop)[0];
        if (!src) continue;
        const image = new Image();
        image.decoding = "async";
        image.src = src;
        preloaders.push(image);
      }
    };

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleHandle = window.requestIdleCallback(() => {
        startPreload();
      }, { timeout: 600 });
    } else {
      timeoutHandle = setTimeout(() => {
        startPreload();
      }, 180);
    }

    return () => {
      if (idleHandle !== null && typeof window !== "undefined" && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      for (const image of preloaders) {
        image.src = "";
      }
    };
  }, [backdropPickerOpen, filteredBackdrops]);

  function handleBackdropClick(backdrop: BackdropRow) {
    if (backdrop.tier === "premium") {
      setPremiumTarget(backdrop);
      setShowPremiumModal(true);
    } else {
      setSelectedBackdrop(backdrop);
    }
  }

  function handleConfirmBackdrop() {
    if (!selectedBackdrop) return;
    setConfirmedBackdrop(selectedBackdrop);
    setConfirmedBlurBackground(selectedBlurBackground);
    setConfirmedBlurAmount(selectedBlurAmount);
    setBackdropPickerOpen(false);
  }

  function handleConfirmBlurBackground() {
    if (!currentNobgUrl) return;
    if (!selectedBackdrop && confirmedBackdrop) {
      setSelectedBackdrop(confirmedBackdrop);
    }
    setSelectedBlurBackground((prev) => !prev);
  }

  function handleClearBackdrop() {
    setConfirmedBackdrop(null);
    setConfirmedBlurBackground(false);
    setConfirmedBlurAmount(DEFAULT_BACKDROP_BLUR_PX);
    setSelectedBackdrop(null);
    setSelectedBlurBackground(false);
    setSelectedBlurAmount(DEFAULT_BACKDROP_BLUR_PX);
    setCompositeDataUrl(null);
  }

  /** Given an image URL (from slot assignment), find its nobg URL if available */
  function nobgForUrl(url: string | null): string | null {
    if (!url) return null;
    const match = images.find((i) => i.url === url);
    return match ? (nobgUrls[match.id] ?? null) : null;
  }

  function handleUnlockPremium() {
    if (premiumTarget) {
      setSelectedBackdrop(premiumTarget);
      setConfirmedBackdrop(premiumTarget);
      setConfirmedBlurBackground(selectedBlurBackground);
      setConfirmedBlurAmount(selectedBlurAmount);
      setShowPremiumModal(false);
      setPremiumTarget(null);
    }
  }

  function openBackdropPicker() {
    if (drawerOpen) setDrawerOpen(false);
    setBackdropPickerOpen(true);
    if (confirmedBackdrop) {
      setSelectedBlurBackground(confirmedBlurBackground);
      setSelectedBlurAmount(confirmedBlurAmount);
      setSelectedBackdrop(confirmedBackdrop);
      return;
    }
    if (!selectedBackdrop && backdrops.length > 0) {
      setSelectedBackdrop(backdrops[0]);
      setSelectedBlurBackground(false);
      setSelectedBlurAmount(DEFAULT_BACKDROP_BLUR_PX);
    }
  }

  async function handlePlaceOrder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (orderingDisabled) {
      setOrderError("Ordering is no longer available for this gallery.");
      return;
    }

    if (isSchoolMode && !student) return;
    if (checkoutItems.length === 0) {
      setOrderError("Add at least one product before checkout.");
      return;
    }
    if (!parentEmail.trim()) {
      setOrderError("Email is required.");
      return;
    }

    if (
      anyPhysicalCheckoutItem &&
      deliveryMethod === "shipping" &&
      (!shippingName.trim() ||
        !shippingAddress1.trim() ||
        !shippingCity.trim() ||
        !shippingProvince.trim() ||
        !shippingPostalCode.trim())
    ) {
      setOrderError("Please complete the shipping information.");
      return;
    }

    setPlacing(true);
    setOrderError("");

    let resolvedPhotographerId = photographerId;
    if (isSchoolMode && student?.school_id) {
      const { data: schoolRow } = await supabase
        .from("schools")
        .select("photographer_id")
        .eq("id", student.school_id)
        .maybeSingle();
      resolvedPhotographerId =
        (schoolRow?.photographer_id as string | null) ?? resolvedPhotographerId;
    }

    if (!resolvedPhotographerId) {
      setOrderError("This gallery is missing a photographer link.");
      setPlacing(false);
      return;
    }

    const resolvedProjectId = !isSchoolMode ? project?.id || projectId || null : null;
    const totalCents = checkoutTotalCents;
    const firstCheckoutItem = checkoutItems[0];

    if (!firstCheckoutItem) {
      setOrderError("Add at least one product before checkout.");
      setPlacing(false);
      return;
    }

    if (minimumOrderAmountCents > 0 && totalCents < minimumOrderAmountCents) {
      setOrderError(
        `This gallery requires a minimum order of $${(
          minimumOrderAmountCents / 100
        ).toFixed(2)}.`,
      );
      setPlacing(false);
      return;
    }

    if (!isSchoolMode && !resolvedProjectId) {
      setOrderError("This event gallery is missing a project link.");
      setPlacing(false);
      return;
    }

    const shippingBlock =
      anyPhysicalCheckoutItem && deliveryMethod === "shipping"
        ? [
            `Delivery: shipping`,
            `Name: ${shippingName.trim()}`,
            `Address: ${shippingAddress1.trim()}`,
            shippingAddress2.trim() ? `Line 2: ${shippingAddress2.trim()}` : "",
            `City: ${shippingCity.trim()}`,
            `Province: ${shippingProvince.trim()}`,
            `Postal: ${shippingPostalCode.trim()}`,
          ]
            .filter(Boolean)
            .join("\n")
        : anyPhysicalCheckoutItem
          ? "Delivery: pickup"
          : "";

    const entryNotes = checkoutItems.map((entry, index) => {
      const backdropNote = entry.backdrop
        ? `BACKDROP: ${entry.backdrop.name}${entry.backdrop.tier === "premium" ? ` (Premium · $${(entry.backdropAddOnCents / 100).toFixed(2)})` : " (Included)"}${entry.backdrop.blurred ? ` · Blurred ${entry.backdrop.blurAmount || DEFAULT_BACKDROP_BLUR_PX}px` : ""}`
        : "";
      const compositeNote = entry.isCompositeOrder
        ? `CLASS COMPOSITE: ${entry.compositeTitle || "Class composite"}`
        : "";
      const slotsSummary =
        entry.category === "digital"
          ? `Digital download order x${entry.quantity}`
          : entry.slots
              .map(
                (slot, slotIndex) =>
                  `Item ${slotIndex + 1}: ${slot.label} → ${slot.assignedImageUrl ?? "no photo"}`,
              )
              .join("\n");

      return [
        `ORDER ITEM ${index + 1}: ${entry.isCompositeOrder ? `Composite • ${entry.packageName}` : entry.packageName}`,
        compositeNote,
        backdropNote,
        entry.category === "digital"
          ? "DIGITAL ORDER"
          : "PHOTO SELECTIONS:\n" + slotsSummary,
      ]
        .filter(Boolean)
        .join("\n");
    });

    const combinedNotes = [
      currentGalleryExtras.allowClientComments ? notes.trim() : "",
      ...entryNotes,
      shippingBlock,
    ]
      .filter(Boolean)
      .join("\n\n");

    const orderSummaryName =
      checkoutItems.length === 1
        ? firstCheckoutItem.isCompositeOrder
          ? `Composite • ${firstCheckoutItem.packageName}`
          : firstCheckoutItem.packageName
        : `${firstCheckoutItem.isCompositeOrder ? `Composite • ${firstCheckoutItem.packageName}` : firstCheckoutItem.packageName} + ${checkoutItems.length - 1} more`;

    const { data: orderRow, error: orderErr } = await supabase
      .from("orders")
      .insert({
        school_id: isSchoolMode ? student?.school_id ?? null : null,
        class_id: isSchoolMode ? student?.class_id ?? null : null,
        student_id: isSchoolMode ? student?.id ?? null : null,
        project_id: resolvedProjectId,
        photographer_id: resolvedPhotographerId,
        parent_name: parentName.trim() || null,
        parent_email: parentEmail.trim() || null,
        parent_phone: parentPhone.trim() || null,
        customer_name: parentName.trim() || null,
        customer_email: parentEmail.trim() || null,
        package_id: firstCheckoutItem.packageId,
        package_name: orderSummaryName,
        package_price: totalCents / 100,
        special_notes: combinedNotes || null,
        notes: combinedNotes || null,
        status: "payment_pending",
        seen_by_photographer: false,
        subtotal_cents: totalCents,
        tax_cents: 0,
        total_cents: totalCents,
        total_amount: totalCents / 100,
        currency: "cad",
      })
      .select("id")
      .single();

    if (orderErr || !orderRow) {
      setOrderError(orderErr?.message ?? "Failed to create order draft.");
      setPlacing(false);
      return;
    }

    const itemsToInsert = checkoutItems.flatMap((entry) => {
      const orderItems =
        entry.category === "digital"
          ? [
              {
                order_id: orderRow.id,
                product_name: entry.isCompositeOrder
                  ? `Composite • ${entry.packageName}`
                  : entry.packageName,
                quantity: entry.quantity,
                price: entry.packageSubtotalCents / 100,
                unit_price_cents: Math.round(
                  entry.packageSubtotalCents / Math.max(entry.quantity, 1),
                ),
                line_total_cents: entry.packageSubtotalCents,
                sku: entry.selectedImageUrl,
              },
            ]
          : entry.slots.map((slot) => ({
              order_id: orderRow.id,
              product_name: slot.label,
              quantity: 1,
              price: entry.packageSubtotalCents / 100 / Math.max(entry.slots.length, 1),
              unit_price_cents: Math.round(
                entry.packageSubtotalCents / Math.max(entry.slots.length, 1),
              ),
              line_total_cents: Math.round(
                entry.packageSubtotalCents / Math.max(entry.slots.length, 1),
              ),
              sku: slot.assignedImageUrl ?? null,
            }));

      if (entry.backdropAddOnCents > 0 && entry.backdrop) {
        orderItems.push({
          order_id: orderRow.id,
          product_name: `★ Premium Backdrop: ${entry.backdrop.name}${entry.backdrop.blurred ? ` (Blurred ${entry.backdrop.blurAmount || DEFAULT_BACKDROP_BLUR_PX}px)` : ""}`,
          quantity: 1,
          price: entry.backdropAddOnCents / 100,
          unit_price_cents: entry.backdropAddOnCents,
          line_total_cents: entry.backdropAddOnCents,
          sku: entry.backdrop.image_url ?? null,
        });
      }

      return orderItems;
    });

    const { error: orderItemsError } = await supabase
      .from("order_items")
      .insert(itemsToInsert);

    if (orderItemsError) {
      setOrderError(orderItemsError.message || "Failed to prepare order items.");
      setPlacing(false);
      return;
    }

    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: orderRow.id,
          pin,
          schoolId: isSchoolMode ? student?.school_id ?? null : null,
          projectId: resolvedProjectId,
          mode,
          email: !isSchoolMode ? eventEmail : undefined,
          customerEmail: parentEmail.trim(),
        }),
      });

      const json = (await res.json()) as { ok: boolean; message?: string; url?: string };
      if (!res.ok || !json.ok || !json.url) {
        throw new Error(json.message || "Failed to start secure checkout.");
      }

      window.location.href = json.url;
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : "Failed to start secure checkout.");
      setPlacing(false);
      return;
    }
  }

  async function handlePreReleaseSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const email = captureEmail.trim().toLowerCase();
    if (!project?.id) {
      setCaptureError("This gallery is not linked to a project yet.");
      return;
    }
    if (!email) {
      setCaptureError("Please enter your email.");
      return;
    }

    setCaptureBusy(true);
    setCaptureError("");

    try {
      const response = await fetch("/api/portal/pre-release-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          email,
        }),
      });

      const payload = (await response.json()) as { ok?: boolean; message?: string };
      setCaptureBusy(false);

      if (!response.ok || payload.ok === false) {
        setCaptureError(payload.message || "Failed to save your email.");
        return;
      }
    } catch (error) {
      setCaptureBusy(false);
      setCaptureError(error instanceof Error ? error.message : "Failed to save your email.");
      return;
    }

    setCaptureDone(true);
    setCaptureEmail("");
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    if (!showLoadingFallback) {
      return (
        <div
          style={{
            minHeight: "100vh",
            background: "#ffffff",
          }}
        />
      );
    }

    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          color: "#1f1a17",
          fontFamily: galleryFontFamily,
        }}
      >
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div
          style={{
            width: "100%",
            display: "grid",
            justifyItems: "center",
            maxWidth: 420,
            gap: 18,
            textAlign: "center",
          }}
        >
          {displayStudioLogoUrl ? (
            <img
              src={displayStudioLogoUrl}
              alt=""
              style={{ height: 28, objectFit: "contain", opacity: 0.96 }}
            />
          ) : (
            <div
              style={{
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "#6f6458",
              }}
            >
              {clean(studioInfo.businessName) || "Studio OS"}
            </div>
          )}

          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              border: "2px solid rgba(26,26,26,0.08)",
              borderTopColor: "#8b1f1f",
              animation: "spin 0.9s linear infinite",
            }}
          />

          <div style={{ display: "grid", gap: 8 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "#51473d",
              }}
            >
              Loading Gallery
            </div>
            <div
              style={{
                fontSize: 14,
                lineHeight: 1.7,
                color: "#7a6f63",
              }}
            >
              {isSchoolMode
                ? "Preparing gallery photos and backdrop previews."
                : "Preparing the event gallery."}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !student) {
    return (
      <div
        style={{
          height: "100vh",
          background: "#080808",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 400,
            background: "#111",
            border: "1px solid #1e1e1e",
            borderRadius: 16,
            padding: "44px 36px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 44, marginBottom: 16 }}>🔍</div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: "#fff",
              margin: "0 0 10px",
            }}
          >
            Gallery Not Found
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "#666",
              lineHeight: 1.7,
              margin: "0 0 24px",
            }}
          >
            {error || "Unable to load this gallery."}
          </p>
          <button
            type="button"
            onClick={goBack}
            style={{
              background: "#fff",
              color: "#000",
              border: "none",
              borderRadius: 999,
              padding: "12px 24px",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (confirmingPayment) {
    return (
      <div
        style={{
          height: "100vh",
          background: "#080808",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 440,
            background: "#111",
            border: "1px solid #1e1e1e",
            borderRadius: 20,
            padding: "52px 40px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 16, color: "#888", marginBottom: 10 }}>Verifying payment…</div>
          <div style={{ fontSize: 13, color: "#555", lineHeight: 1.7 }}>We are confirming your Stripe checkout and syncing it to the photographer dashboard.</div>
        </div>
      </div>
    );
  }

  if (placed) {
    return (
      <div
        style={{
          height: "100vh",
          background: "#080808",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 440,
            background: "#111",
            border: "1px solid #1e1e1e",
            borderRadius: 20,
            padding: "52px 40px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 68,
              height: 68,
              borderRadius: "50%",
              background: "#0f2e0f",
              border: "1.5px solid #1f5c1f",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 24px",
            }}
          >
            <Check size={30} color="#4ade80" strokeWidth={2.5} />
          </div>
          <h1
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: "#fff",
              margin: "0 0 10px",
            }}
          >
            Order Placed!
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "#888",
              lineHeight: 1.7,
              margin: "0 0 8px",
            }}
          >
            {galleryCopy.paymentComplete}
          </p>
          {parentEmail && (
            <p style={{ fontSize: 13, color: "#555", margin: "0 0 24px" }}>
              {galleryCopy.receiptSentTo}{" "}
              <strong style={{ color: "#bbb" }}>{parentEmail}</strong>
            </p>
          )}
          <div
            style={{
              background: "#161616",
              border: "1px solid #222",
              borderRadius: 10,
              padding: "12px 16px",
              marginBottom: 28,
            }}
          >
            <p
              style={{
                fontSize: 10,
                color: "#444",
                margin: "0 0 5px",
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                fontWeight: 700,
              }}
            >
              {galleryCopy.orderReference}
            </p>
            <p
              style={{
                fontSize: 11,
                fontFamily: "monospace",
                color: "#555",
                margin: 0,
                wordBreak: "break-all",
              }}
            >
              {orderId}
            </p>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "center",
            }}
          >
            <button
              type="button"
              onClick={continueShoppingAfterCheckout}
              style={{
                background: "#fff",
                color: "#000",
                border: "none",
                borderRadius: 999,
                padding: "13px 32px",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                minWidth: 220,
              }}
            >
              Continue Shopping
            </button>
            <button
              type="button"
              onClick={goBack}
              style={{
                background: "transparent",
                color: "#777",
                border: "1px solid #2a2a2a",
                borderRadius: 999,
                padding: "11px 24px",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {galleryCopy.done}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Project state gates ──────────────────────────────────────────────────
  if (project?.portal_status === "inactive") {
    return (
      <div
        style={{
          height: "100vh",
          background: "#080808",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 460,
            background: "#111",
            border: "1px solid #1e1e1e",
            borderRadius: 20,
            padding: "48px 36px",
            textAlign: "center",
          }}
        >
          <h1
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: "#fff",
              margin: "0 0 10px",
            }}
          >
            {galleryCopy.galleryNotAvailableTitle}
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "#777",
              lineHeight: 1.7,
              margin: 0,
            }}
          >
            {galleryCopy.galleryNotAvailableBody}
          </p>
        </div>
      </div>
    );
  }

  if (project?.portal_status === "pre_release") {
    return (
      <>
        <style>{`html,body{margin:0;padding:0;height:100%;overflow:hidden;}`}</style>
        <div
          style={{
            minHeight: "100vh",
            background:
              "radial-gradient(circle at top, #152238 0%, #0b0b0b 45%, #080808 100%)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 560,
              background: "rgba(17,17,17,0.88)",
              border: "1px solid #242424",
              borderRadius: 24,
              padding: "44px 38px",
              boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                borderRadius: 999,
                padding: "8px 14px",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.09)",
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "#c8d3e8",
                marginBottom: 20,
              }}
            >
              <Clock3 size={14} />
              Coming Soon
            </div>

            <h1
              style={{
                fontSize: 34,
                lineHeight: 1.1,
                fontWeight: 800,
                margin: "0 0 12px",
              }}
            >
              {getProjectName(project)}
            </h1>

            <p
              style={{
                fontSize: 15,
                color: "#8f95a3",
                lineHeight: 1.8,
                margin: "0 0 24px",
              }}
            >
              This gallery is not open yet. Enter your email and we’ll notify you
              when it becomes available.
            </p>

            {captureDone ? (
              <div
                style={{
                  background: "#0f2e0f",
                  border: "1px solid #1f5c1f",
                  color: "#c8ffd7",
                  borderRadius: 14,
                  padding: "16px 18px",
                  fontSize: 14,
                  lineHeight: 1.6,
                }}
              >
                Thanks — your email has been registered.
              </div>
            ) : (
              <form onSubmit={handlePreReleaseSubmit}>
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Email Address</label>
                  <div style={{ position: "relative" }}>
                    <Mail
                      size={14}
                      color="#666"
                      style={{ position: "absolute", left: 12, top: 12 }}
                    />
                    <input
                      type="email"
                      value={captureEmail}
                      onChange={(e) => setCaptureEmail(e.target.value)}
                      placeholder="parent@email.com"
                      required
                      style={{ ...darkInput, paddingLeft: 36 }}
                    />
                  </div>
                </div>

                {captureError && (
                  <div
                    style={{
                      background: "#1e0a0a",
                      border: "1px solid #4a1a1a",
                      borderRadius: 8,
                      padding: "10px 13px",
                      color: "#f87171",
                      fontSize: 12,
                      marginBottom: 14,
                    }}
                  >
                    {captureError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={captureBusy}
                  style={{
                    width: "100%",
                    background: "#fff",
                    color: "#000",
                    border: "none",
                    borderRadius: 999,
                    padding: "14px 18px",
                    fontSize: 14,
                    fontWeight: 800,
                    cursor: captureBusy ? "not-allowed" : "pointer",
                    opacity: captureBusy ? 0.7 : 1,
                  }}
                >
                  {captureBusy ? "Saving..." : "Notify Me"}
                </button>
              </form>
            )}

            <button
              type="button"
              onClick={goBack}
              style={{
                marginTop: 18,
                background: "transparent",
                border: "none",
                color: "#999",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                padding: 0,
              }}
            >
              ← Back
            </button>
          </div>
        </div>
      </>
    );
  }

  if (project?.portal_status === "closed") {
    return (
      <div
        style={{
          height: "100vh",
          background: "#080808",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 460,
            background: "#111",
            border: "1px solid #1e1e1e",
            borderRadius: 20,
            padding: "48px 36px",
            textAlign: "center",
          }}
        >
          <h1
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: "#fff",
              margin: "0 0 10px",
            }}
          >
            {galleryCopy.galleryClosedTitle}
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "#777",
              lineHeight: 1.7,
              margin: 0,
            }}
          >
            {galleryCopy.galleryClosedBody}
          </p>
        </div>
      </div>
    );
  }

  if (
    project?.expiration_date &&
    new Date() > new Date(project.expiration_date)
  ) {
    return (
      <div
        style={{
          height: "100vh",
          background: "#080808",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 460,
            background: "#111",
            border: "1px solid #1e1e1e",
            borderRadius: 20,
            padding: "48px 36px",
            textAlign: "center",
          }}
        >
          <h1
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: "#fff",
              margin: "0 0 10px",
            }}
          >
            {galleryCopy.galleryExpiredTitle}
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "#777",
              lineHeight: 1.7,
              margin: 0,
            }}
          >
            {galleryCopy.galleryExpiredBody}
          </p>
        </div>
      </div>
    );
  }

  // ── Main Gallery ──────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        html,body{margin:0;padding:0;height:100%;overflow:hidden;}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes floatUp{0%{transform:translateY(0)}100%{transform:translateY(-4px)}}
        ::-webkit-scrollbar{width:4px;height:4px;}
        ::-webkit-scrollbar-track{background:transparent;}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.12);border-radius:2px;}
        .event-hover-card{transition:transform .22s ease, box-shadow .22s ease, border-color .22s ease;}
        .event-hover-card:hover{transform:translateY(-4px);box-shadow:0 26px 56px rgba(0,0,0,0.22);}
        .event-chip{transition:background .18s ease,border-color .18s ease,color .18s ease,transform .18s ease;}
        .event-chip:hover{transform:translateY(-1px);}
        .event-photo-card{transition:transform .22s ease, opacity .22s ease;}
        .event-photo-card img{transition:transform .32s ease;}
        .event-photo-card:hover{transform:translateY(-2px);}
        .event-photo-card:hover img{transform:scale(1.015);}
        .event-photo-actions{
          opacity:0;
          transform:translate(-50%,10px);
          pointer-events:none;
          transition:opacity .18s ease, transform .18s ease;
        }
        .event-photo-card:hover .event-photo-actions,
        .event-photo-card:focus-within .event-photo-actions{
          opacity:1;
          transform:translate(-50%,0);
          pointer-events:auto;
        }
        @media (hover:none){
          .event-photo-actions{
            opacity:1;
            transform:translate(-50%,0);
            pointer-events:auto;
          }
        }
      `}</style>

      <div
        style={{
          position: "fixed",
          inset: 0,
          background: eventCanvasBackground,
          color: galleryTone.text,
          display: "flex",
          flexDirection: "column",
          fontFamily: galleryFontFamily,
          overflow: "hidden",
        }}
      >
        {/* Top bar */}
        <div
          style={{
            minHeight: isEventImageStage ? 72 : 52,
            flexShrink: 0,
            display: isEventLanding ? "none" : "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 18,
            flexWrap: "wrap",
            padding: isEventImageStage ? "12px 22px" : "0 20px",
            borderBottom: isEventImageStage ? "1px solid rgba(17,17,17,0.08)" : `1px solid ${galleryTone.border}`,
            position: "relative",
            zIndex: 20,
            background: isEventImageStage
              ? "rgba(255,255,255,0.96)"
              : isLightGallery
                ? "rgba(255,255,255,0.92)"
                : galleryTone.background,
            backdropFilter: "blur(18px)",
          }}
        >
          {isEventImageStage ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 24,
                minWidth: 0,
                flex: "1 1 540px",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={openAlbumsOverview}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  textAlign: "left",
                  cursor: "pointer",
                  display: "grid",
                  gap: 2,
                }}
              >
                <span style={{ fontSize: 28, lineHeight: 1, fontWeight: 400, color: "#222222" }}>
                  {galleryHeadline}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: "#8b8176",
                    fontWeight: 700,
                  }}
                >
                  {eventBrandLabel}
                </span>
              </button>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 18,
                  flexWrap: "wrap",
                  minWidth: 0,
                }}
              >
                {!currentGalleryExtras.hideAllPhotosAlbum ? (
                  <button
                    type="button"
                    onClick={() => openEventPhotoGrid(null)}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      color: !activeEventCollectionId ? "#18181b" : "#8b8176",
                      fontSize: 13,
                      fontWeight: !activeEventCollectionId ? 600 : 500,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {galleryCopy.allPhotos}
                  </button>
                ) : null}
                {eventCollectionsWithImages.slice(0, 5).map((collection) => {
                  const collectionId = clean(collection.id);
                  const isCurrent = activeEventCollectionId === collectionId;
                  return (
                    <button
                      key={collectionId}
                      type="button"
                      onClick={() => openEventPhotoGrid(collectionId)}
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        color: isCurrent ? "#18181b" : "#8b8176",
                        fontSize: 13,
                        fontWeight: isCurrent ? 600 : 500,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {clean(collection.title) || galleryCopy.album}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <button type="button" onClick={goBack} style={{ background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", padding: 0 }}>
                  <ArrowLeft size={16} color={galleryTone.mutedText} />
                </button>
                {displayStudioLogoUrl ? (
                  <img src={displayStudioLogoUrl} alt="" style={{ height: 28, objectFit: "contain", maxWidth: 120 }} />
                ) : studioInfo.businessName ? (
                  <span style={{ fontSize: 14, fontWeight: 800, color: galleryTone.text, letterSpacing: "0.04em", textTransform: "uppercase" }}>{studioInfo.businessName}</span>
                ) : null}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 4,
                  position: "absolute",
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 5,
                  pointerEvents: "auto",
                }}
              >
                {galleryNavTabs.map((tab) => {
                  const isActive = activeView === tab;
                  const label =
                    tab === "photos"
                      ? galleryCopy.photos
                      : tab === "favorites"
                          ? `${galleryCopy.favorites}${favorites.size > 0 ? ` (${favorites.size})` : ""}`
                          : galleryCopy.about;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveView(tab)}
                      style={{
                        background: "transparent",
                        border: "none",
                        borderBottom: isActive ? `2px solid ${galleryTone.text}` : "2px solid transparent",
                        color: isActive ? galleryTone.text : galleryTone.mutedText,
                        fontSize: 13,
                        fontWeight: 600,
                        padding: "14px 16px",
                        cursor: "pointer",
                        transition: "color 0.15s",
                        letterSpacing: "0.01em",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* Right: cart */}
          <div style={{ display: "flex", alignItems: "center", gap: isEventImageStage ? 16 : 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {currentGalleryExtras.allowSocialSharing ? (
              <button
                type="button"
                onClick={handleShareGallery}
                style={{
                  background: "transparent",
                  color: isEventImageStage ? "#7a6f63" : galleryTone.text,
                  border: isEventImageStage ? "none" : `1px solid ${galleryTone.border}`,
                  borderRadius: 999,
                  padding: isEventImageStage ? 0 : "8px 16px",
                  fontSize: 12,
                  fontWeight: isEventImageStage ? 500 : 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Share2 size={14} />
                {galleryCopy.share}
              </button>
            ) : null}

            {blackWhiteFilteringAllowed ? (
              <button
                type="button"
                onClick={() => setBlackWhitePreviewEnabled((prev) => !prev)}
                style={{
                  background: blackWhitePreviewActive
                    ? isLightGallery
                      ? "rgba(17,17,17,0.08)"
                      : "rgba(255,255,255,0.08)"
                    : "transparent",
                  color: isEventImageStage ? "#7a6f63" : galleryTone.text,
                  border: isEventImageStage
                    ? "none"
                    : `1px solid ${blackWhitePreviewActive ? galleryTone.text : galleryTone.border}`,
                  borderRadius: 999,
                  padding: isEventImageStage ? 0 : "8px 16px",
                  fontSize: 12,
                  fontWeight: isEventImageStage ? 500 : 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Palette size={14} />
                {blackWhitePreviewActive ? galleryCopy.bwOn : galleryCopy.bw}
              </button>
            ) : null}

            {currentGalleryExtras.showBuyAllButton && buyAllPackage ? (
              <button
                type="button"
                onClick={selectBuyAllPackage}
                disabled={orderingDisabled}
                style={{
                  background: "transparent",
                  color: orderingDisabled ? "#777" : isEventImageStage ? "#7a6f63" : galleryTone.text,
                  border: isEventImageStage ? "none" : `1px solid ${galleryTone.border}`,
                  borderRadius: 999,
                  padding: isEventImageStage ? 0 : "8px 16px",
                  fontSize: 12,
                  fontWeight: isEventImageStage ? 500 : 700,
                  cursor: orderingDisabled ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Download size={14} />
                {galleryCopy.buyAll}
              </button>
            ) : null}

            {currentGalleryExtras.showDownloadAllButton &&
            galleryDownloadAccess.enabled &&
            !showAlbumOverview ? (
              <button
                type="button"
                onClick={downloadGalleryImages}
                disabled={
                  downloadingGallery ||
                  !galleryDownloadAccess.canDownload ||
                  (galleryDownloadAccess.audience === "album" && !activeEventCollectionId)
                }
                style={{
                  background: "transparent",
                  color:
                    downloadingGallery ||
                    !galleryDownloadAccess.canDownload ||
                    (galleryDownloadAccess.audience === "album" && !activeEventCollectionId)
                      ? "#777"
                      : isEventImageStage
                        ? "#7a6f63"
                        : galleryTone.text,
                  border: isEventImageStage ? "none" : `1px solid ${galleryTone.border}`,
                  borderRadius: 999,
                  padding: isEventImageStage ? 0 : "8px 16px",
                  fontSize: 12,
                  fontWeight: isEventImageStage ? 500 : 700,
                  cursor:
                    downloadingGallery ||
                    !galleryDownloadAccess.canDownload ||
                    (galleryDownloadAccess.audience === "album" && !activeEventCollectionId)
                      ? "not-allowed"
                      : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Download size={14} />
                {downloadingGallery
                  ? `Preparing${typeof galleryDownloadProgress === "number" ? ` ${galleryDownloadProgress}%` : "..."}`
                  : galleryCopy.downloadAll}
              </button>
            ) : null}

            <button
              type="button"
              onClick={basketItemCount > 0 ? openCartCheckout : openBuyDrawer}
              disabled={orderingDisabled}
              style={{
                background: isEventImageStage
                  ? "transparent"
                  : orderingDisabled
                    ? isLightGallery
                      ? "#e5e7eb"
                      : "#2b2b2b"
                    : isLightGallery
                      ? "#111111"
                      : "#fff",
                color: orderingDisabled ? "#777" : isEventImageStage ? "#111111" : isLightGallery ? "#fff" : "#000",
                border: isEventImageStage ? "none" : isLightGallery ? "1px solid #111111" : "none",
                borderRadius: 999,
                padding: isEventImageStage ? 0 : "8px 18px",
                fontSize: 12,
                fontWeight: isEventImageStage ? 600 : 700,
                cursor: orderingDisabled ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <ShoppingCart size={14} />
              {orderingDisabled
                ? galleryCopy.closed
                : basketItemCount > 0
                  ? `${galleryCopy.viewBasket ?? "View Basket"} (${basketItemCount})`
                  : currentGalleryExtras.enableStore
                    ? galleryCopy.openStore
                    : galleryCopy.buyPhoto}
            </button>
          </div>
        </div>

        {orderingDisabled && (
          <div
            style={{
              flexShrink: 0,
              background: "#1b1510",
              borderBottom: "1px solid #2f2416",
              color: "#d2b48c",
              padding: "10px 18px",
              fontSize: 12,
              textAlign: "center",
              letterSpacing: "0.02em",
            }}
          >
            {galleryCopy.orderingEnded}
          </div>
        )}

        {galleryActionMessage ? (
          <div
            style={{
              flexShrink: 0,
              borderBottom: `1px solid ${galleryTone.border}`,
              background: galleryTone.surface,
              padding: "10px 18px",
              color: galleryTone.text,
              fontSize: 12,
              textAlign: "center",
            }}
          >
            {galleryActionMessage}
          </div>
        ) : null}

        {galleryDownloadNotice ? (
          <div
            style={{
              flexShrink: 0,
              borderBottom: `1px solid ${galleryTone.border}`,
              background: galleryTone.surface,
              padding: "10px 18px",
              color: galleryTone.text,
              fontSize: 12,
              textAlign: "center",
            }}
          >
            {galleryDownloadNotice}
          </div>
        ) : null}

        {!isSchoolMode && currentGalleryBranding.marketingBannerEnabled && clean(currentGalleryBranding.marketingBannerText) && (
          <div
            style={{
              flexShrink: 0,
              borderBottom: `1px solid ${galleryTone.border}`,
              background: galleryTone.surface,
              padding: "12px 18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <div style={{ color: galleryTone.text, fontSize: 13, lineHeight: 1.6 }}>
              {currentGalleryBranding.marketingBannerText}
            </div>
            {clean(currentGalleryBranding.marketingBannerLinkLabel) && clean(currentGalleryBranding.marketingBannerLinkUrl) ? (
              <a
                href={currentGalleryBranding.marketingBannerLinkUrl}
                style={{
                  color: galleryTone.text,
                  fontSize: 12,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  textDecoration: "underline",
                  textUnderlineOffset: 4,
                }}
              >
                {currentGalleryBranding.marketingBannerLinkLabel}
              </a>
            ) : null}
          </div>
        )}

        {!isSchoolMode && activeView === "photos" && showAlbumOverview && (
          <div
            style={{
              flexShrink: 0,
              background: "#f7f3ee",
            }}
          >
            <div
              style={{
                position: "relative",
                overflow: "hidden",
                minHeight: "100vh",
                background: "#e9e2da",
              }}
            >
              {heroImageUrl ? (
                <img
                  src={heroImageUrl}
                  alt=""
                  loading="eager"
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    filter: blackWhitePreviewActive
                      ? "grayscale(1) saturate(0.7)"
                      : "saturate(0.95)",
                  }}
                />
              ) : null}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "linear-gradient(180deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.2) 26%, rgba(0,0,0,0.4) 72%, rgba(0,0,0,0.5) 100%)",
                }}
              />

              <div
                style={{
                  position: "relative",
                  zIndex: 1,
                  minHeight: "100vh",
                  display: "grid",
                  gridTemplateRows: "auto 1fr auto",
                  padding: "32px 42px 54px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "center" }}>
                  {displayStudioLogoUrl ? (
                    <img src={displayStudioLogoUrl} alt="" style={{ height: 22, objectFit: "contain", opacity: 0.98 }} />
                  ) : (
                    <div
                      style={{
                        color: "#ffffff",
                        fontSize: 12,
                        fontWeight: 800,
                        letterSpacing: "0.2em",
                        textTransform: "uppercase",
                      }}
                    >
                      {eventBrandLabel}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    display: "grid",
                    alignContent: "center",
                    justifyItems: "center",
                    textAlign: "center",
                    gap: 14,
                  }}
                >
                  {galleryEventDate ? (
                    <div
                      style={{
                        color: "rgba(255,255,255,0.84)",
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.2em",
                        textTransform: "uppercase",
                      }}
                    >
                      {galleryEventDate}
                    </div>
                  ) : null}

                  <div
                    style={{
                      maxWidth: 820,
                      color: "#ffffff",
                      fontSize: usesSerifHero(currentGalleryBranding.fontPreset) ? 68 : 60,
                      fontWeight: 600,
                      lineHeight: 1,
                      letterSpacing: usesSerifHero(currentGalleryBranding.fontPreset) ? "0.01em" : "-0.04em",
                      textShadow: "0 18px 48px rgba(0,0,0,0.3)",
                    }}
                  >
                    {galleryHeaderTitle}
                  </div>

                  {galleryClientLabel ? (
                    <div
                      style={{
                        color: "rgba(255,255,255,0.74)",
                        fontSize: 13,
                        letterSpacing: "0.14em",
                        textTransform: "uppercase",
                      }}
                    >
                      {galleryClientLabel}
                    </div>
                  ) : null}

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 16,
                      justifyContent: "center",
                      color: "rgba(255,255,255,0.82)",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                    }}
                  >
                    {!currentGalleryExtras.hideAlbumPhotoCount ? <span>{compactCountLabel(images.length, "photo")}</span> : null}
                    {eventHasAlbums ? <span>{compactCountLabel(eventCollectionsWithImages.length, "album")}</span> : null}
                    <span>{galleryLocked ? "Private Gallery" : "Event Gallery"}</span>
                  </div>

                  <button
                    type="button"
                    className="event-chip"
                    onClick={() => {
                      if (!currentGalleryExtras.hideAllPhotosAlbum) {
                        openEventPhotoGrid(null);
                        return;
                      }
                      const firstCollectionId = clean(featuredAlbums[0]?.id);
                      openEventPhotoGrid(firstCollectionId || null);
                    }}
                    style={{
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.88)",
                      background: "transparent",
                      color: "#ffffff",
                      padding: "12px 22px",
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                      cursor: "pointer",
                    }}
                  >
                    {currentGalleryExtras.hideAllPhotosAlbum ? "Open First Album" : "View Gallery"}
                  </button>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-start" }}>
                  <button
                    type="button"
                    onClick={openAlbumsOverview}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "rgba(255,255,255,0.78)",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    {galleryCopy.albums}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Body */}

        {activeView === "store" && (
          <div style={{ flex: 1, overflow: "auto", padding: "30px 20px 40px" }}>
            <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gap: 24 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-end",
                  gap: 16,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                      color: galleryTone.mutedText,
                      marginBottom: 8,
                    }}
                  >
                    Studio OS Store
                  </div>
                  <div style={{ fontSize: 30, fontWeight: 700, color: galleryTone.text }}>
                    Prints, packages, and downloads
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  {currentGalleryExtras.minimumOrderAmount ? (
                    <div
                      style={{
                        border: `1px solid ${galleryTone.border}`,
                        background: galleryTone.surface,
                        borderRadius: 999,
                        padding: "10px 14px",
                        color: galleryTone.mutedText,
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                      }}
                    >
                      Minimum Order {currentGalleryExtras.minimumOrderAmount}
                    </div>
                  ) : null}
                  {currentGalleryExtras.showBuyAllButton && buyAllPackage ? (
                    <button
                      type="button"
                      onClick={selectBuyAllPackage}
                      disabled={orderingDisabled}
                      style={{
                        border: `1px solid ${galleryTone.border}`,
                        background: galleryTone.surface,
                        borderRadius: 999,
                        padding: "10px 14px",
                        color: orderingDisabled ? galleryTone.mutedText : galleryTone.text,
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        cursor: orderingDisabled ? "not-allowed" : "pointer",
                      }}
                    >
                      {galleryCopy.buyAll}
                    </button>
                  ) : null}
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                  gap: galleryGap,
                }}
              >
                {storeTiles.map((tile) => (
                  <button
                    key={tile.key}
                    type="button"
                    onClick={() => {
                      openBuyDrawer();
                      setActiveCategoryKey(tile.key);
                      setDrawerView("category-list");
                    }}
                    style={{
                      textAlign: "left",
                      background: galleryTone.surface,
                      border: `1px solid ${galleryTone.border}`,
                      borderRadius: 22,
                      padding: "20px 18px",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 700, color: galleryTone.text }}>
                      {tile.label}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 13, color: galleryTone.mutedText, lineHeight: 1.6 }}>
                      {tile.minPrice !== null ? `From $${tile.minPrice.toFixed(2)}` : "Available in this gallery"}
                    </div>
                    <div
                      style={{
                        marginTop: 18,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        color: galleryTone.text,
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                      }}
                    >
                      Browse products
                    </div>
                  </button>
                ))}
              </div>

              {packages.length > 0 ? (
                <div style={{ display: "grid", gap: 14 }}>
                  <div style={{ fontSize: 12, color: galleryTone.mutedText, letterSpacing: "0.16em", textTransform: "uppercase" }}>
                    Featured Items
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                      gap: galleryGap,
                    }}
                  >
                    {packages
                      .filter((pkg) => !currentGalleryExtras.offerPackagesOnly || getCategory(pkg) === "package")
                      .slice(0, 6)
                      .map((pkg) => (
                        <div
                          key={pkg.id}
                          style={{
                            background: galleryTone.surface,
                            border: `1px solid ${galleryTone.border}`,
                            borderRadius: 22,
                            padding: "18px 18px 20px",
                          }}
                        >
                          <div style={{ fontSize: 18, fontWeight: 700, color: galleryTone.text }}>
                            {pkg.name}
                          </div>
                          <div style={{ marginTop: 8, fontSize: 13, color: galleryTone.mutedText, lineHeight: 1.7 }}>
                            {pkg.description || (pkg.items?.length ? pkg.items.slice(0, 3).map((item) => formatPackageItem(item)).join(" · ") : "Available for this event gallery.")}
                          </div>
                          <div style={{ marginTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: galleryTone.text }}>
                              ${(pkg.price_cents / 100).toFixed(2)}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                openBuyDrawer();
                                selectPackage(pkg);
                              }}
                              style={{
                                border: "none",
                                borderRadius: 999,
                                background: "#fff",
                                color: "#000",
                                padding: "10px 14px",
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              Select
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* ── About view ────────────────────────────────────────────── */}
        {activeView === "about" && (
          <div style={{ flex: 1, overflow: "auto", display: "flex", justifyContent: "center", padding: "60px 20px" }}>
            <div style={{ maxWidth: 520, width: "100%", textAlign: "center" }}>
              {displayStudioLogoUrl ? (
                <img src={displayStudioLogoUrl} alt="" style={{ height: 60, objectFit: "contain", marginBottom: 28, display: "block", margin: "0 auto 28px" }} />
              ) : studioInfo.businessName ? (
                <div style={{ fontSize: 28, fontWeight: 900, color: galleryTone.text, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 28 }}>{studioInfo.businessName}</div>
              ) : null}

              {studioInfo.address && (
                <div style={{ color: galleryTone.mutedText, fontSize: 15, lineHeight: 1.8, marginBottom: 24, whiteSpace: "pre-line" }}>{studioInfo.address}</div>
              )}

              {studioInfo.phone && (
                <a href={`tel:${studioInfo.phone}`} style={{ display: "block", color: galleryTone.text, fontSize: 15, fontWeight: 600, marginBottom: 12, textDecoration: "underline", textUnderlineOffset: 4 }}>{studioInfo.phone}</a>
              )}

              {studioInfo.email && (
                <a href={`mailto:${studioInfo.email}`} style={{ display: "block", color: galleryTone.text, fontSize: 15, fontWeight: 600, marginBottom: 24, textDecoration: "underline", textUnderlineOffset: 4 }}>{studioInfo.email}</a>
              )}

              {!studioInfo.address && !studioInfo.phone && !studioInfo.email && (
                <div style={{ color: "#555", fontSize: 14 }}>No studio contact info available yet.</div>
              )}
            </div>
          </div>
        )}

        {/* ── Favorites view ────────────────────────────────────────── */}
        {activeView === "favorites" && (
          <div style={{ flex: 1, overflow: "auto", padding: "30px 20px" }}>
            {favoriteImages.length === 0 ? (
              <div style={{ textAlign: "center", padding: "80px 20px", color: "#555" }}>
                <Heart size={36} strokeWidth={1.2} color="#333" />
                <div style={{ fontSize: 16, fontWeight: 700, color: "#888", marginTop: 14 }}>No favorites yet</div>
                <div style={{ fontSize: 13, color: "#555", marginTop: 6 }}>Tap the heart icon on any photo to add it here.</div>
              </div>
            ) : (
              <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gap: 20 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                    flexWrap: "wrap",
                  }}
                >
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", color: galleryTone.mutedText }}>
                    {galleryCopy.favorites}
                  </div>
                    <div style={{ fontSize: 26, fontWeight: 700, color: galleryTone.text }}>
                      {favoriteImages.length} {galleryCopy.selectedPhotos}
                    </div>
                    <div style={{ fontSize: 13, color: galleryTone.mutedText }}>
                      {galleryCopy.favoritesIntro}
                    </div>
                  </div>
                  {(isSchoolMode || favoriteDownloadAccess.canDownload) ? (
                    <button
                      type="button"
                      onClick={downloadFavoriteImages}
                      disabled={downloadingFavorites}
                      style={{
                        borderRadius: 999,
                        border: `1px solid ${galleryTone.border}`,
                        background: downloadingFavorites ? galleryTone.surfaceMuted : galleryTone.surface,
                        color: galleryTone.text,
                        padding: "12px 18px",
                        fontSize: 13,
                        fontWeight: 800,
                        cursor: downloadingFavorites ? "not-allowed" : "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <Download size={15} />
                      {downloadingFavorites ? "Preparing downloads..." : galleryCopy.downloadFavorites}
                    </button>
                  ) : null}
                </div>

                {favoriteDownloadNotice ? (
                  <div
                    style={{
                      borderRadius: 16,
                      border: `1px solid ${galleryTone.border}`,
                      background: galleryTone.surface,
                      color: galleryTone.text,
                      padding: "12px 14px",
                      fontSize: 13,
                    }}
                  >
                    {favoriteDownloadNotice}
                  </div>
                ) : null}

                {favoriteMessage ? (
                  <div
                    style={{
                      borderRadius: 16,
                      border: `1px solid ${galleryTone.border}`,
                      background: galleryTone.surface,
                      color: galleryTone.text,
                      padding: "12px 14px",
                      fontSize: 13,
                    }}
                  >
                    {favoriteMessage}
                  </div>
                ) : null}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                    gap: galleryGap,
                  }}
                >
                  {favoriteImages.map((img, index) => {
                    const favoriteCardUrl =
                      buildGalleryImageCandidates(img, "wall")[0] || img.downloadUrl || img.url;
                    const canChangeBackdrop = isSchoolMode && hasBackdrops;
                    return (
                      <div
                        key={img.id}
                        style={{
                          background: galleryTone.surface,
                          border: `1px solid ${galleryTone.border}`,
                          borderRadius: 24,
                          overflow: "hidden",
                          boxShadow: isLightGallery
                            ? "0 18px 40px rgba(15,23,42,0.08)"
                            : "0 18px 44px rgba(0,0,0,0.24)",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => openImageInGallery(img)}
                          style={{
                            width: "100%",
                            border: "none",
                            background: isLightGallery
                              ? "linear-gradient(180deg, #f7f7f6 0%, #efefec 100%)"
                              : "linear-gradient(180deg, #141414 0%, #0b0b0b 100%)",
                            padding: 12,
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          <div
                            style={{
                              position: "relative",
                              borderRadius: 18,
                              overflow: "hidden",
                              background: isLightGallery ? "#f8f8f7" : "#090909",
                            }}
                          >
                            <img
                              src={favoriteCardUrl}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              style={{
                                width: "100%",
                                height: 260,
                                objectFit: "contain",
                                display: "block",
                                background: isLightGallery ? "#f8f8f7" : "#090909",
                                filter: galleryImageFilter,
                              }}
                            />
                            {showProofWatermark ? (
                              <WatermarkOverlay
                                text={effectiveWatermarkText}
                                logoUrl={effectiveWatermarkLogoUrl}
                              />
                            ) : null}
                            <div
                              style={{
                                position: "absolute",
                                top: 12,
                                right: 12,
                                borderRadius: 999,
                                border: "1px solid rgba(239,68,68,0.35)",
                                background: "rgba(239,68,68,0.18)",
                                color: "#f87171",
                                width: 34,
                                height: 34,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                backdropFilter: "blur(12px)",
                              }}
                            >
                              <Heart size={15} fill="#f87171" />
                            </div>
                          </div>
                        </button>

                        <div style={{ padding: "14px 14px 16px" }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                              marginBottom: 12,
                            }}
                          >
                            <div
                              style={{
                                fontSize: 12,
                                fontWeight: 800,
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                                color: galleryTone.mutedText,
                              }}
                            >
                              {getPhotoReference(index, img).number}
                            </div>
                            {img.title ? (
                              <div
                                style={{
                                  minWidth: 0,
                                  fontSize: 12,
                                  color: galleryTone.mutedText,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                                title={img.title}
                              >
                                {img.title}
                              </div>
                            ) : null}
                          </div>

                          <div style={{ display: "grid", gap: 10 }}>
                            <button
                              type="button"
                              onClick={() => openImageInGallery(img)}
                              style={{
                                width: "100%",
                                background: "transparent",
                                color: galleryTone.text,
                                border: `1px solid ${galleryTone.border}`,
                                borderRadius: 999,
                                padding: "11px 14px",
                                fontSize: 13,
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              {galleryCopy.viewPhoto ?? "View Photo"}
                            </button>

                            {canChangeBackdrop ? (
                              <button
                                type="button"
                                onClick={() => openBackdropPickerForImage(img)}
                                style={{
                                  width: "100%",
                                  background: "transparent",
                                  color: "#ef4444",
                                  border: "1px solid rgba(239,68,68,0.4)",
                                  borderRadius: 999,
                                  padding: "11px 14px",
                                  fontSize: 13,
                                  fontWeight: 700,
                                  cursor: "pointer",
                                }}
                              >
                                {galleryCopy.changeBackdrop ?? "Change Backdrop"}
                              </button>
                            ) : null}

                            <button
                              type="button"
                              onClick={() => openBuyDrawerForImage(img)}
                              disabled={orderingDisabled}
                              style={{
                                width: "100%",
                                background: orderingDisabled ? "#1f1f1f" : "#22c55e",
                                color: orderingDisabled ? "#555" : "#04130a",
                                border: orderingDisabled ? "1px solid #333" : "none",
                                borderRadius: 999,
                                padding: "12px 14px",
                                fontSize: 13,
                                fontWeight: 800,
                                cursor: orderingDisabled ? "not-allowed" : "pointer",
                              }}
                            >
                              {orderingDisabled
                                ? galleryCopy.orderingClosed
                                : galleryCopy.buyPhoto}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ flex: 1, display: activeView === "photos" ? "flex" : "none", overflow: "hidden", minHeight: 0 }}>
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              minWidth: 0,
            }}
          >
            {showAlbumOverview ? (
              <div style={{ flex: 1 }} />
            ) : showEventPhotoGrid ? (
              <div style={{ flex: 1, overflow: "auto", padding: "12px 12px 32px" }}>
                <div style={{ width: "100%", display: "grid", gap: 12 }}>
                  {visibleImages.length > 0 ? (
                    renderPhotoWall(visibleImages)
                  ) : (
                    <div
                      style={{
                        border: `1px solid ${galleryTone.border}`,
                        background: galleryTone.surface,
                        borderRadius: 28,
                        padding: "34px 28px",
                        color: galleryTone.mutedText,
                        fontSize: 14,
                      }}
                    >
                      {galleryCopy.noPhotosYet}
                    </div>
                  )}
                </div>
              </div>
            ) : showPhotoViewer ? (
              <>
                <div
                  onContextMenu={(e) => e.preventDefault()}
                  style={{
                    flex: 1,
                    minHeight: 0,
                    position: "relative",
                    zIndex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: viewerPadding,
                    WebkitUserSelect: "none",
                    userSelect: "none",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: 16,
                      top: 16,
                      right: 16,
                      zIndex: 3,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 22, alignItems: "flex-start" }}>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: 6,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (isSchoolMode) {
                              router.push("/parents");
                              return;
                            }
                            setEventPhotoStage("grid");
                          }}
                          style={{
                            border: "none",
                            background: "transparent",
                            color: "#6f6458",
                            padding: 0,
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: "0.16em",
                            textTransform: "uppercase",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontFamily: galleryFontFamily,
                          }}
                        >
                          <X size={14} />
                          Close Viewer
                        </button>
                        <div
                          style={{
                            color: "#8b8176",
                            padding: 0,
                            fontSize: 11,
                            fontWeight: 600,
                            letterSpacing: "0.14em",
                            textTransform: "uppercase",
                            fontFamily: galleryFontFamily,
                          }}
                        >
                          {selectedImageIndex + 1} / {visibleImages.length}
                        </div>
                      </div>
                      {selectedImage ? (
                        <div
                          style={{
                            color: "#6f6458",
                            padding: 0,
                            fontSize: 12,
                            fontWeight: 600,
                            letterSpacing: "0.16em",
                            textTransform: "uppercase",
                            fontFamily: galleryFontFamily,
                          }}
                        >
                          {getPhotoReference(selectedImageIndex, selectedImage).number}
                        </div>
                      ) : null}
                    </div>
                    {selectedEventCollection ? (
                      <div
                        style={{
                          color: "#6f6458",
                          padding: 0,
                          fontSize: 12,
                          fontWeight: 600,
                          letterSpacing: "0.16em",
                          textTransform: "uppercase",
                          fontFamily: galleryFontFamily,
                        }}
                      >
                        {clean(selectedEventCollection.title) || galleryCopy.album}
                      </div>
                    ) : null}
                  </div>
                  {visibleImages.length > 1 && (
                    <button
                      type="button"
                      onClick={goPrev}
                      style={{
                        position: "absolute",
                        left: 10,
                        top: "50%",
                        transform: "translateY(-50%)",
                        width: 38,
                        height: 38,
                        borderRadius: "50%",
                        background: "rgba(255,255,255,0.07)",
                        border: "none",
                        color: "#fff",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 2,
                      }}
                    >
                      <ChevronLeft size={20} strokeWidth={1.5} />
                    </button>
                  )}

                  {selectedImage ? (() => {
                    const previewBlurBackground =
                      backdropPickerOpen ? selectedBlurBackground : confirmedBlurBackground;
                    const previewBlurAmount = previewBlurBackground
                      ? (backdropPickerOpen ? selectedBlurAmount : confirmedBlurAmount)
                      : 0;
                    const activeBackdrop = backdropPickerOpen
                      ? (selectedBackdrop ?? confirmedBackdrop)
                      : confirmedBackdrop;
                    const backdropControlsVisible =
                      backdropPickerOpen && currentNobgUrl && (selectedBackdrop || confirmedBackdrop);
                    const isPreview =
                      backdropPickerOpen && (
                        (selectedBlurBackground !== confirmedBlurBackground) ||
                        (!!selectedBackdrop && selectedBackdrop.id !== confirmedBackdrop?.id)
                      );
                    const viewerImageCandidates = buildGalleryImageCandidates(selectedImage, "viewer-main");
                    const activeBackdropSource = activeBackdrop?.image_url;
                    return activeBackdrop && currentNobgUrl ? (
                      <div
                        style={{
                          position: "relative",
                          width: backdropControlsVisible
                            ? "min(920px, calc(100vw - 160px))"
                            : "min(980px, calc(100vw - 120px))",
                          maxWidth: "100%",
                          height: backdropControlsVisible
                            ? "min(68vh, calc(100vh - 300px))"
                            : "min(78vh, calc(100vh - 210px))",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <div
                          style={{
                            position: "relative",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "100%",
                            height: "100%",
                            maxWidth: "100%",
                          }}
                        >
                          <CompositeCanvas
                            backdropUrl={activeBackdropSource || activeBackdrop.image_url}
                            backdropFallbackUrl={activeBackdrop.image_url}
                            nobgUrl={currentNobgUrl}
                            fallbackUrl={selectedImage.url}
                            width={backdropCompositeSize.width}
                            height={backdropCompositeSize.height}
                            foregroundScale={backdropForegroundScale}
                            foregroundVerticalOffset={backdropForegroundVerticalOffset}
                            trimTransparentForeground
                            responsive
                            style={{ borderRadius: 6 }}
                            showWatermark={showProofWatermark}
                            watermarkText={effectiveWatermarkText}
                            watermarkLogoUrl={effectiveWatermarkLogoUrl}
                            watermarkVariant="viewer"
                            backdropBlurPx={previewBlurAmount}
                            preserveForegroundAlignment
                          />
                        </div>
                        {confirmedBackdrop && (
                          <button
                            type="button"
                            onClick={handleClearBackdrop}
                            style={{
                              position: "absolute",
                              top: 10,
                              right: 10,
                              background: "rgba(0,0,0,0.65)",
                              backdropFilter: "blur(8px)",
                              border: "1px solid rgba(255,255,255,0.1)",
                              borderRadius: 999,
                              padding: "5px 12px",
                              color: "#ccc",
                              fontSize: 11,
                              fontWeight: 600,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: 5,
                              zIndex: 3,
                            }}
                          >
                            <X size={12} /> Remove Backdrop
                          </button>
                        )}
                        <div style={{
                          position: "absolute",
                          bottom: backdropControlsVisible ? 22 : 10,
                          left: "50%",
                          transform: "translateX(-50%)",
                          background: isPreview ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.65)",
                          backdropFilter: "blur(8px)",
                          border: isPreview
                            ? "1px solid rgba(255,255,255,0.15)"
                            : "1px solid rgba(255,255,255,0.08)",
                          borderRadius: 999,
                          padding: "5px 14px",
                          color: "#fff",
                          fontSize: 11,
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                        }}>
                          {isPreview ? (
                            <>
                              <Eye size={12} color="#60a5fa" /> {activeBackdrop.name}
                              <span style={{ color: "#60a5fa", fontSize: 10, fontWeight: 500 }}>Preview</span>
                            </>
                          ) : (
                            <>
                              <Check size={12} color="#4ade80" /> {activeBackdrop.name}
                            </>
                          )}
                          {activeBackdrop.tier === "premium" && (
                            <span style={{ color: "#f59e0b", fontSize: 10 }}>★ Premium</span>
                          )}
                          {previewBlurBackground && previewBlurAmount > 0 && (
                            <span style={{ color: "#facc15", fontSize: 10 }}>Blur {previewBlurAmount}px</span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          position: "relative",
                          width: "min(1240px, calc(100vw - 120px))",
                          maxWidth: "100%",
                          height: "min(80vh, calc(100vh - 210px))",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <div
                          style={{
                            position: "relative",
                            width: "100%",
                            height: "100%",
                          }}
                        >
                          <ContainedViewerImage
                            key={selectedImage.id}
                            src={viewerImageCandidates[0] || selectedImage.url}
                            fallbackSrc={selectedImage.url}
                            candidates={viewerImageCandidates}
                            alt={student?.first_name ?? "Photo"}
                            aspectRatio={selectedImageAspectRatio}
                            imageFilter={galleryImageFilter}
                            onError={handleGalleryImageError}
                            watermarkEnabled={showProofWatermark}
                            watermarkText={effectiveWatermarkText}
                            watermarkLogoUrl={effectiveWatermarkLogoUrl}
                          />
                        </div>
                      </div>
                    );
                  })() : (
                    <div style={{ color: "#333", fontSize: 14 }}>No photos available</div>
                  )}

                  {visibleImages.length > 1 && (
                    <button
                      type="button"
                      onClick={goNext}
                      style={{
                        position: "absolute",
                        right: 10,
                        top: "50%",
                        transform: "translateY(-50%)",
                        width: 38,
                        height: 38,
                        borderRadius: "50%",
                        background: "rgba(255,255,255,0.07)",
                        border: "none",
                        color: "#fff",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 2,
                      }}
                    >
                      <ChevronRight size={20} strokeWidth={1.5} />
                    </button>
                  )}
                </div>

                {backdropPickerOpen &&
                  currentNobgUrl &&
                  (selectedBackdrop || confirmedBackdrop) && (
                  <div style={{ display: "flex", justifyContent: "center", padding: "18px 0 8px", position: "relative", zIndex: 6 }}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                      {selectedBackdrop ? (
                        <button
                          type="button"
                          onClick={handleConfirmBackdrop}
                          style={{
                            background: "#fff",
                            color: "#000",
                            border: "none",
                            borderRadius: 999,
                            padding: "10px 32px",
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            transition: "transform 0.1s ease",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.03)")}
                          onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                        >
                          <Check size={15} strokeWidth={2.5} /> Use This Backdrop
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={handleConfirmBlurBackground}
                        style={{
                          background: selectedBlurBackground ? "#facc15" : "rgba(250,204,21,0.92)",
                          color: "#171717",
                          border: "none",
                          borderRadius: 999,
                          padding: "10px 24px",
                          fontSize: 13,
                          fontWeight: 800,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          transition: "transform 0.1s ease",
                          boxShadow: "0 8px 22px rgba(250,204,21,0.16)",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.03)")}
                        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                      >
                        <Sparkles size={15} strokeWidth={2.2} /> Blur Background
                      </button>
                      <button
                        type="button"
                        onClick={handleClearBackdrop}
                        style={{
                          background: "rgba(255,255,255,0.08)",
                          color: "#e5e7eb",
                          border: "1px solid rgba(255,255,255,0.12)",
                          borderRadius: 999,
                          padding: "10px 22px",
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          transition: "transform 0.1s ease",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.03)")}
                        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                      >
                        <RotateCcw size={15} strokeWidth={2.2} /> Reset to Original
                      </button>
                    </div>
                  </div>
                )}

                <div
                  style={{
                    flexShrink: 0,
                    borderTop: "1px solid #141414",
                    background: isLightGallery ? "rgba(255,255,255,0.92)" : "#0d0d0d",
                    padding: "12px 20px 18px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 10,
                    position: "relative",
                    zIndex: 5,
                  }}
                >
                  {favoriteMessage ? (
                    <div
                      style={{
                        color: "#9ca3af",
                        fontSize: 12,
                        lineHeight: 1.5,
                        textAlign: "center",
                      }}
                    >
                      {favoriteMessage}
                    </div>
                  ) : null}
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      flexWrap: "wrap",
                      justifyContent: "center",
                      position: "relative",
                      zIndex: 2,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => selectedImage && toggleFavorite(selectedImage.id)}
                      style={{
                        background: selectedImage && favorites.has(selectedImage.id)
                          ? "rgba(239,68,68,0.15)"
                          : isLightGallery
                            ? "rgba(15,23,42,0.04)"
                            : "rgba(255,255,255,0.04)",
                        border: selectedImage && favorites.has(selectedImage.id)
                          ? "1px solid rgba(239,68,68,0.4)"
                          : isLightGallery
                            ? "1px solid rgba(15,23,42,0.12)"
                            : "1px solid rgba(255,255,255,0.1)",
                        color: selectedImage && favorites.has(selectedImage.id)
                          ? "#f87171"
                          : isLightGallery
                            ? "#4b5563"
                            : "#aaa",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        fontSize: 12,
                        fontWeight: 600,
                        padding: "9px 18px",
                        borderRadius: 999,
                        transition: "all 0.18s ease",
                        position: "relative",
                        zIndex: 2,
                        pointerEvents: "auto",
                      }}
                    >
                      <Heart size={14} strokeWidth={1.8} fill={selectedImage && favorites.has(selectedImage.id) ? "#f87171" : "none"} /> {selectedImage && favorites.has(selectedImage.id) ? "Favorited" : "Favorite"}
                    </button>

                    {hasBackdrops && (
                      <button
                        type="button"
                        onClick={openBackdropPicker}
                        style={{
                          background: backdropPickerOpen ? "rgba(239,68,68,0.12)" : "transparent",
                          border: backdropPickerOpen ? "1.5px solid #ef4444" : "1.5px solid #ef4444",
                          color: "#ef4444",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 7,
                          fontSize: 12,
                          fontWeight: 700,
                          borderRadius: 999,
                          padding: "9px 20px",
                          transition: "all 0.18s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "rgba(239,68,68,0.15)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = backdropPickerOpen ? "rgba(239,68,68,0.12)" : "transparent";
                        }}
                      >
                        <Palette size={14} strokeWidth={1.8} /> Change Backdrop
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={openBuyDrawer}
                      disabled={orderingDisabled}
                      style={{
                        background: orderingDisabled ? "rgba(255,255,255,0.02)" : "rgba(74,222,128,0.08)",
                        border: orderingDisabled ? "1px solid rgba(255,255,255,0.05)" : "1px solid rgba(74,222,128,0.3)",
                        color: orderingDisabled ? "#3d3d3d" : "#4ade80",
                        cursor: orderingDisabled ? "not-allowed" : "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        fontSize: 12,
                        fontWeight: 700,
                        padding: "9px 20px",
                        borderRadius: 999,
                        transition: "all 0.18s ease",
                        position: "relative",
                        zIndex: 2,
                        pointerEvents: "auto",
                      }}
                      onMouseEnter={(e) => {
                        if (!orderingDisabled) {
                          e.currentTarget.style.background = "rgba(74,222,128,0.15)";
                          e.currentTarget.style.borderColor = "rgba(74,222,128,0.5)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!orderingDisabled) {
                          e.currentTarget.style.background = "rgba(74,222,128,0.08)";
                          e.currentTarget.style.borderColor = "rgba(74,222,128,0.3)";
                        }
                      }}
                    >
                      <ShoppingBag size={14} strokeWidth={1.8} /> {galleryCopy.buyPhoto}
                    </button>
                  </div>

                  {visibleImages.length > 0 && (
                    <div
                      ref={viewerThumbnailStripRef}
                      style={{
                        display: "flex",
                        gap: galleryGap,
                        overflowX: "auto",
                        maxWidth: "100%",
                        paddingBottom: 2,
                        scrollbarWidth: "none",
                        scrollBehavior: "smooth",
                      }}
                    >
                      {visibleImages.map((img, idx) => {
                        const active = idx === selectedImageIndex;
                        const hasNobg = !!nobgUrls[img.id];
                        const showComposite = !!confirmedBackdrop && hasNobg;
                        const thumbCandidates = buildGalleryImageCandidates(img, "viewer-thumb");
                        return (
                          <button
                            key={img.id}
                            ref={(element) => {
                              viewerThumbnailButtonRefs.current[img.id] = element;
                            }}
                            type="button"
                            onClick={() => setSelectedImageIndex(idx)}
                          style={{
                              flexShrink: 0,
                              padding: 0,
                              background: "transparent",
                              border: active
                                ? "2px solid #ef4444"
                                : "2px solid transparent",
                              borderRadius: 5,
                              overflow: "hidden",
                              cursor: "pointer",
                              opacity: active ? 1 : isLightGallery ? 0.78 : 0.74,
                              transition: "opacity 0.12s, border-color 0.12s, transform 0.12s, box-shadow 0.12s",
                              position: "relative",
                              transform: active ? "translateY(0)" : "translateY(0)",
                              boxShadow: active
                                ? "0 0 0 1px rgba(239,68,68,0.15), 0 10px 24px rgba(239,68,68,0.18)"
                                : "none",
                            }}
                          >
                            {showComposite ? (
                              <MiniComposite
                                backdropUrl={confirmedBackdrop!.image_url}
                                backdropFallbackUrl={confirmedBackdrop!.image_url}
                                nobgUrl={nobgUrls[img.id]}
                                fallbackUrl={img.previewUrl || img.url}
                                size={thumbnailSize}
                                backdropBlurPx={confirmedBlurBackground ? confirmedBlurAmount : 0}
                              />
                            ) : (
                              <img
                                src={thumbCandidates[0] || img.url}
                                data-candidates={thumbCandidates.join("|")}
                                data-candidate-index="0"
                                onError={handleGalleryImageError}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                style={{
                                  width: thumbnailSize,
                                  height: thumbnailSize,
                                  objectFit: "contain",
                                  display: "block",
                                  filter: galleryImageFilter,
                                }}
                              />
                            )}
                            {hasNobg && !showComposite && (
                              <span
                                title="Background removed — backdrop ready"
                                style={{
                                  position: "absolute",
                                  top: 3,
                                  right: 3,
                                  width: 8,
                                  height: 8,
                                  borderRadius: "50%",
                                  background: "#4ade80",
                                  border: "1px solid rgba(0,0,0,0.3)",
                                }}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>

          {/* Right drawer */}
          {drawerOpen && (
            <div
              style={{
                width: 620,
                display: "flex",
                flexDirection: "column",
                background: "#1a1a1a",
                borderLeft: "1px solid #222",
                flexShrink: 0,
                overflow: "hidden",
              }}
            >
              {/* Drawer header */}
              <div
                style={{
                  height: 56,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 18px",
                  gap: 8,
                  borderBottom: "1px solid #252525",
                  background: "#141414",
                }}
              >
                {drawerView !== "product-select" && (
                  <button
                    type="button"
                    onClick={() => {
                      if (drawerView === "checkout") {
                        if (!selectedPkg) setDrawerView("product-select");
                        else if (
                          getCategory(selectedPkg) === "digital" ||
                          compositeSelectedImage
                        )
                          setDrawerView("category-list");
                        else setDrawerView("build-package");
                      }
                      else if (drawerView === "build-package")
                        setDrawerView("category-list");
                      else setDrawerView("product-select");
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#aaa",
                      cursor: "pointer",
                      padding: 4,
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    <ChevronLeft size={16} /> Back
                  </button>
                )}

                <h2
                  style={{
                    flex: 1,
                    margin: 0,
                    textAlign: drawerView === "product-select" ? "left" : "center",
                    fontSize: 12,
                    fontWeight: 800,
                    color: "#fff",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                  }}
                >
                  {drawerView === "product-select" && "Select a Product"}
                  {drawerView === "category-list" &&
                    (TILES.find((t) => t.key === activeCategoryKey)?.label ??
                      "Select")}
                  {drawerView === "build-package" &&
                    selectedPkg &&
                    `Building: ${selectedPkg.name}`}
                  {drawerView === "checkout" && "Checkout"}
                </h2>

                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#666",
                    cursor: "pointer",
                    padding: 4,
                    borderRadius: 6,
                    display: "flex",
                  }}
                >
                  <X size={18} />
                </button>
              </div>

              {/* Drawer content */}
              <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
                {drawerView !== "checkout" && cartItems.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      background: "rgba(74,222,128,0.08)",
                      border: "1px solid rgba(74,222,128,0.2)",
                      borderRadius: 14,
                      padding: "12px 14px",
                      marginBottom: 18,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 800,
                          color: "#e7fbe7",
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                        }}
                      >
                        {galleryCopy.basketReady ?? "Basket Ready"}
                      </div>
                      <div style={{ fontSize: 12, color: "#9fbe9f", marginTop: 2 }}>
                        {cartItems.length} saved item{cartItems.length === 1 ? "" : "s"} ready for checkout.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={openCartCheckout}
                      style={{
                        background: "#fff",
                        color: "#000",
                        border: "none",
                        borderRadius: 999,
                        padding: "10px 14px",
                        fontSize: 12,
                        fontWeight: 800,
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    >
                      {galleryCopy.viewBasket ?? "View Basket"}
                    </button>
                  </div>
                )}

                {/* ══ PRODUCT SELECT ══════════════════════════════════════ */}
                {drawerView === "product-select" && (
                  <>
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          background: "rgba(255,255,255,0.06)",
                          borderRadius: 999,
                          padding: "6px 16px",
                          fontSize: 12,
                          color: "#888",
                        }}
                      >
                        <Info size={12} /> Pricing info
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                        gap: 12,
                        marginBottom: 22,
                      }}
                    >
                      {tilesWithData.map((tile) => {
                        const Icon = tile.icon;
                        return (
                          <button
                            key={tile.key}
                            type="button"
                            onClick={() => openCategory(tile.key)}
                            style={{
                              background: "#242424",
                              border: "1px solid #2e2e2e",
                              borderRadius: 14,
                              padding: 0,
                              cursor: "pointer",
                              textAlign: "left",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                height: 150,
                                background: "#1e1e1e",
                                overflow: "hidden",
                                position: "relative",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                          {renderPremiumMockup(
                            getPreviewKind(tile.key),
                            effectiveImageUrl,
                            0,
                            false,
                            undefined,
                            galleryImageFilter,
                            effectiveImageAspectRatio,
                            isCompositeSelection,
                          )}

                              <div
                                style={{
                                  position: "absolute",
                                  inset: 0,
                                  background:
                                    "linear-gradient(to top, rgba(5,10,18,0.38) 0%, transparent 52%)",
                                }}
                              />

                              <div
                                style={{
                                  position: "absolute",
                                  top: 12,
                                  left: 12,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                  background: "rgba(10,14,24,0.72)",
                                  color: "#fff",
                                  border: "1px solid rgba(255,255,255,0.12)",
                                  borderRadius: 999,
                                  padding: "6px 10px",
                                  fontSize: 10,
                                  fontWeight: 800,
                                  letterSpacing: "0.08em",
                                  textTransform: "uppercase",
                                  backdropFilter: "blur(8px)",
                                }}
                              >
                                {Icon ? <Icon size={12} color="#d9e5ff" /> : null}
                                {tile.label}
                              </div>
                            </div>

                            <div style={{ padding: "11px 13px 13px" }}>
                              <div
                                style={{
                                  fontSize: 15,
                                  fontWeight: 700,
                                  color: "#fff",
                                }}
                              >
                                {tile.label}
                              </div>
                              <div
                                style={{
                                  fontSize: 12,
                                  color: "#aaa",
                                  marginTop: 2,
                                }}
                              >
                                {tile.minPrice !== null
                                  ? `From $${tile.minPrice.toFixed(2)}`
                                  : "Available"}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {storefrontPackages.filter((p) => getCategory(p) === "package").length > 0 && (
                      <>
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 800,
                            color: "#555",
                            letterSpacing: "0.1em",
                            textTransform: "uppercase",
                            marginBottom: 12,
                          }}
                        >
                          Package List
                        </div>

                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 10,
                          }}
                        >
                          {packages
                            .filter((p) => getCategory(p) === "package")
                            .map((pkg) => (
                              <div
                                key={pkg.id}
                                style={{
                                  background: "linear-gradient(180deg, #242424 0%, #1f1f1f 100%)",
                                  border: "1px solid #2e2e2e",
                                  borderRadius: 16,
                                  padding: "13px 14px 15px",
                                  boxShadow: "0 10px 26px rgba(0,0,0,0.18)",
                                }}
                              >
                                <div
                                  style={{
                                    height: 144,
                                    borderRadius: 14,
                                    overflow: "hidden",
                                    marginBottom: 14,
                                    background: "#171717",
                                  }}
                                >
                                  {renderPremiumMockup(
                                    "package",
                                    effectiveImageUrl,
                                    0,
                                    false,
                                    undefined,
                                    galleryImageFilter,
                                    effectiveImageAspectRatio,
                                    isCompositeSelection,
                                  )}
                                </div>
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "flex-start",
                                    marginBottom: pkg.items?.length ? 8 : 12,
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: 15,
                                      fontWeight: 700,
                                      color: "#fff",
                                    }}
                                  >
                                    {pkg.name}
                                  </div>
                                  <div
                                    style={{
                                      fontSize: 14,
                                      fontWeight: 700,
                                      color: "#aaa",
                                      flexShrink: 0,
                                      marginLeft: 12,
                                    }}
                                  >
                                    ${(pkg.price_cents / 100).toFixed(2)}
                                  </div>
                                </div>

                                {pkg.items?.length ? (
                                  <div
                                    style={{
                                      fontSize: 12,
                                      color: "#666",
                                      lineHeight: 1.8,
                                      marginBottom: 12,
                                    }}
                                  >
                                    {pkg.items.map((item, idx) => (
                                      <div key={idx}>· {formatPackageItem(item)}</div>
                                    ))}
                                  </div>
                                ) : null}

                                <button
                                  type="button"
                                  onClick={() => selectPackage(pkg)}
                                  style={{
                                    width: "100%",
                                    background: "#fff",
                                    color: "#000",
                                    border: "none",
                                    borderRadius: 999,
                                    padding: "11px",
                                    fontSize: 13,
                                    fontWeight: 700,
                                    cursor: "pointer",
                                  }}
                                >
                                  Select Package
                                </button>
                              </div>
                            ))}
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* ══ CATEGORY LIST ══════════════════════════════════════ */}
                {drawerView === "category-list" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {packagesInCategory.length === 0 && (
                      <div
                        style={{
                          background: "#242424",
                          borderRadius: 12,
                          padding: 28,
                          color: "#666",
                          fontSize: 13,
                          textAlign: "center",
                        }}
                      >
                        {isCompositeSelection
                          ? "Composite orders are limited to standalone 8x10 and larger print products."
                          : "No items available in this category."}
                      </div>
                    )}

                    {packagesInCategory.map((pkg) => {
                      const previewKind = getPreviewKind(getCategory(pkg));
                      const previewVariant = cardPreviewVariant[pkg.id] ?? 0;
                      const chosenQty = getChosenQty(pkg.id);
                      return (
                      <div
                        key={pkg.id}
                        style={{
                          background: "linear-gradient(180deg, #242424 0%, #1f1f1f 100%)",
                          border: "1px solid #2e2e2e",
                          borderRadius: 18,
                          overflow: "hidden",
                          boxShadow: "0 12px 30px rgba(0,0,0,0.18)",
                        }}
                      >
                        <div
                          style={{
                            height: 196,
                            background: "#181818",
                            position: "relative",
                          }}
                        >
                          {renderPremiumMockup(
                            previewKind,
                            effectiveImageUrl,
                            previewVariant,
                            false,
                            pkg.name,
                            galleryImageFilter,
                            effectiveImageAspectRatio,
                            isCompositeSelection,
                          )}
                          <div
                            style={{
                              position: "absolute",
                              inset: 0,
                              background:
                                "linear-gradient(to top, rgba(0,0,0,0.32), transparent 58%)",
                            }}
                          />
                          <div
                            style={{
                              position: "absolute",
                              left: 14,
                              top: 14,
                              background: "rgba(9,14,22,0.76)",
                              color: "#fff",
                              borderRadius: 999,
                              border: "1px solid rgba(255,255,255,0.12)",
                              padding: "6px 10px",
                              fontSize: 10,
                              fontWeight: 800,
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                              backdropFilter: "blur(8px)",
                            }}
                          >
                            {TILES.find((t) => t.key === getCategory(pkg))?.label ?? "Product"}
                          </div>
                        </div>

                        <div style={{ padding: 16 }}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "flex-start",
                              gap: 12,
                              marginBottom: 4,
                            }}
                          >
                            <div
                              style={{
                                fontSize: 17,
                                fontWeight: 700,
                                color: "#fff",
                                lineHeight: 1.3,
                              }}
                            >
                              {pkg.name}
                            </div>
                            <div
                              style={{
                                fontSize: 15,
                                fontWeight: 700,
                                color: "#f4f4f4",
                                flexShrink: 0,
                              }}
                            >
                              ${(pkg.price_cents / 100).toFixed(2)}
                            </div>
                          </div>

                          <div
                            style={{
                              fontSize: 12,
                              color: "#9a9a9a",
                              lineHeight: 1.65,
                            }}
                          >
                            {pkg.description?.trim() ||
                              "Professionally presented with premium preview scenes and clean ordering controls."}
                          </div>

                          <div
                            style={{
                              marginTop: 14,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 12,
                              padding: "10px 12px",
                              borderRadius: 12,
                              background: "rgba(255,255,255,0.04)",
                              border: "1px solid rgba(255,255,255,0.06)",
                            }}
                          >
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 800, color: "#8d8d8d", letterSpacing: "0.08em", textTransform: "uppercase" }}>Quantity</div>
                              <div style={{ fontSize: 12, color: "#bfbfbf", marginTop: 2 }}>Choose how many of this item to order.</div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <button
                                type="button"
                                onClick={() => setChosenQty(pkg.id, chosenQty - 1)}
                                style={{ width: 32, height: 32, borderRadius: 999, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#fff", fontSize: 18, cursor: "pointer" }}
                              >
                                -
                              </button>
                              <div style={{ minWidth: 20, textAlign: "center", color: "#fff", fontWeight: 700 }}>{chosenQty}</div>
                              <button
                                type="button"
                                onClick={() => setChosenQty(pkg.id, chosenQty + 1)}
                                style={{ width: 32, height: 32, borderRadius: 999, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#fff", fontSize: 18, cursor: "pointer" }}
                              >
                                +
                              </button>
                            </div>
                          </div>

                          <div style={{ marginTop: 14 }}>
                            <button
                              type="button"
                              onClick={() => selectPackage(pkg)}
                              style={{
                                width: "100%",
                                background: "#fff",
                                color: "#000",
                                border: "none",
                                borderRadius: 999,
                                padding: "12px",
                                fontSize: 13,
                                fontWeight: 700,
                                cursor: "pointer",
                                boxShadow: "0 8px 20px rgba(255,255,255,0.08)",
                              }}
                            >
                              {getCategory(pkg) === "digital"
                                ? "Order Digital"
                                : compositeSelectedImage
                                ? `Order Composite (${chosenQty})`
                                : `Select (${chosenQty})`}
                            </button>
                          </div>

                          {renderMockupStrip(
                            previewKind,
                            effectiveImageUrl,
                            previewVariant,
                            pkg.name,
                            (variant) =>
                              setCardPreviewVariant((prev) => ({
                                ...prev,
                                [pkg.id]: variant,
                            })),
                            galleryImageFilter,
                            effectiveImageAspectRatio,
                            isCompositeSelection,
                          )}

                          {pkg.items?.length ? (
                            <div
                              style={{
                                marginTop: 14,
                                display: "grid",
                                gap: 6,
                              }}
                            >
                              {pkg.items.slice(0, 4).map((item, idx) => (
                                <div
                                  key={idx}
                                  style={{
                                    fontSize: 12,
                                    color: "#b0b0b0",
                                    background: "rgba(255,255,255,0.04)",
                                    border: "1px solid rgba(255,255,255,0.06)",
                                    borderRadius: 10,
                                    padding: "8px 10px",
                                  }}
                                >
                                  {formatPackageItem(item)}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>

                      </div>
                    )})}
                  </div>
                )}

                {/* ══ BUILD PACKAGE ══════════════════════════════════════ */}
                {drawerView === "build-package" && selectedPkg && (
                  <>
                    <p
                      style={{
                        fontSize: 13,
                        color: "#777",
                        margin: "0 0 18px",
                        lineHeight: 1.6,
                      }}
                    >
                      Click a slot to select it, then tap a photo to assign it.
                    </p>

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                        marginBottom: 22,
                      }}
                    >
                      {slots.map((slot, i) => {
                        const isActive = activeSlotIndex === i;
                        const isCompositeSlot = !!slot.composite;
                        return (
                          <div
                            key={i}
                            onClick={() => {
                              if (isCompositeSlot) return; // composite slots are not selectable
                              setActiveSlotIndex(isActive ? null : i);
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 14,
                              background: isCompositeSlot ? "#1a1a2e" : isActive ? "#1e2a1e" : "#242424",
                              border: isCompositeSlot
                                ? "1px solid #4338ca"
                                : isActive
                                ? "1.5px solid #3a7a3a"
                                : "1px solid #2e2e2e",
                              borderRadius: 12,
                              padding: "12px 14px",
                              cursor: isCompositeSlot ? "default" : "pointer",
                              transition: "border-color 0.15s, background 0.15s",
                              opacity: isCompositeSlot ? 0.85 : 1,
                            }}
                          >
                            <div
                              style={{
                                width: 64,
                                height: 64,
                                borderRadius: 8,
                                overflow: "hidden",
                                flexShrink: 0,
                                background: "#1a1a1a",
                                border: isActive
                                  ? "2px solid #4ade80"
                                  : "2px solid #2e2e2e",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                position: "relative",
                              }}
                            >
                              {slot.assignedImageUrl ? (() => {
                                const slotNobg = nobgForUrl(slot.assignedImageUrl);
                                return confirmedBackdrop && slotNobg ? (
                                  <MiniComposite
                                    backdropUrl={confirmedBackdrop.image_url}
                                    backdropFallbackUrl={confirmedBackdrop.image_url}
                                    nobgUrl={slotNobg}
                                    fallbackUrl={slot.assignedImageUrl}
                                    size={48}
                                    backdropBlurPx={confirmedBlurBackground ? confirmedBlurAmount : 0}
                                  />
                                ) : (
                                  <img
                                    src={slot.assignedImageUrl}
                                    alt=""
                                    style={{
                                      width: "100%",
                                      height: "100%",
                                      objectFit: "contain",
                                    }}
                                  />
                                );
                              })() : (
                                <Plus size={20} color={isActive ? "#4ade80" : "#444"} />
                              )}

                              {isActive && (
                                <div
                                  style={{
                                    position: "absolute",
                                    inset: 0,
                                    background: "rgba(74,222,128,0.15)",
                                    borderRadius: 6,
                                  }}
                                />
                              )}
                            </div>

                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 13,
                                  fontWeight: 700,
                                  color: "#fff",
                                  marginBottom: 3,
                                }}
                              >
                                Slot {i + 1} of {slots.length}
                              </div>

                              <div
                                style={{
                                  fontSize: 11,
                                  color: "#8a8a8a",
                                  marginBottom: 4,
                                }}
                              >
                                {slot.label}
                              </div>

                              {slot.assignedImageUrl ? (
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                  }}
                                >
                                  <div
                                    style={{
                                      width: 6,
                                      height: 6,
                                      borderRadius: "50%",
                                      background: isCompositeSlot ? "#818cf8" : "#4ade80",
                                      flexShrink: 0,
                                    }}
                                  />
                                  <span
                                    style={{
                                      fontSize: 11,
                                      color: isCompositeSlot ? "#818cf8" : "#4ade80",
                                    }}
                                  >
                                    {isCompositeSlot
                                      ? "Class photo (auto-included)"
                                      : isActive
                                      ? `Selected for slot ${i + 1} of ${slots.length}`
                                      : `Assigned to slot ${i + 1} of ${slots.length}`}
                                  </span>
                                </div>
                              ) : (
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: isActive ? "#aaa" : "#555",
                                  }}
                                >
                                  {isActive ? "↓ Choose the photo for this slot below" : `Tap to assign slot ${i + 1}`}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {activeSlotIndex !== null && (
                      <>
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 800,
                            color: "#555",
                            letterSpacing: "0.1em",
                            textTransform: "uppercase",
                            marginBottom: 10,
                          }}
                        >
                          Choose photo for slot {activeSlotIndex + 1} of {slots.length}
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: slotGridColumns,
                            gap: galleryGap,
                            marginBottom: 22,
                          }}
                        >
                          {packageAssignableImages.map((img, idx) => {
                            const isAssigned =
                              slots[activeSlotIndex]?.assignedImageUrl === img.url;
                            const imgNobg = nobgUrls[img.id];
                            const showComp = !!confirmedBackdrop && !!imgNobg;
                            return (
                              <button
                                key={img.id}
                                type="button"
                                onClick={() => assignImageToSlot(img.url)}
                                style={{
                                  padding: 0,
                                  border: isAssigned
                                    ? "2.5px solid #4ade80"
                                    : "2px solid transparent",
                                  borderRadius: 8,
                                  overflow: "hidden",
                                  cursor: "pointer",
                                  background: "transparent",
                                  position: "relative",
                                  aspectRatio: "1",
                                }}
                              >
                                {showComp ? (
                                  <MiniComposite
                                    backdropUrl={confirmedBackdrop!.image_url}
                                    backdropFallbackUrl={confirmedBackdrop!.image_url}
                                    nobgUrl={imgNobg}
                                    fallbackUrl={img.url}
                                    size={120}
                                    backdropBlurPx={confirmedBlurBackground ? confirmedBlurAmount : 0}
                                  />
                                ) : (
                                  <img
                                    src={img.url}
                                    alt={`Photo ${idx + 1}`}
                                    style={{
                                      width: "100%",
                                      height: "100%",
                                      objectFit: "contain",
                                      display: "block",
                                    }}
                                  />
                                )}
                                {isAssigned && (
                                  <div
                                    style={{
                                      position: "absolute",
                                      top: 4,
                                      right: 4,
                                      width: 18,
                                      height: 18,
                                      borderRadius: "50%",
                                      background: "#4ade80",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                    }}
                                  >
                                    <Check size={11} color="#000" strokeWidth={3} />
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                        {packageAssignableImages.length === 0 && (
                          <div
                            style={{
                              color: "#8b8b8b",
                              fontSize: 13,
                              fontWeight: 600,
                              padding: "8px 0 18px",
                            }}
                          >
                            Class composites cannot be used inside package photo slots.
                          </div>
                        )}
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        if (allSlotsAssigned) addCurrentSelectionToCart();
                      }}
                      disabled={!allSlotsAssigned}
                      style={{
                        width: "100%",
                        background: allSlotsAssigned ? "#22c55e" : "#222",
                        color: allSlotsAssigned ? "#04130a" : "#444",
                        border: allSlotsAssigned ? "none" : "1px solid #333",
                        borderRadius: 999,
                        padding: "14px",
                        fontSize: 14,
                        fontWeight: 800,
                        cursor: allSlotsAssigned ? "pointer" : "not-allowed",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                        transition: "background 0.2s, color 0.2s",
                      }}
                    >
                      <ShoppingCart size={16} />
                      {allSlotsAssigned
                        ? galleryCopy.addToBasket ?? "Add to Basket"
                        : `Assign all ${slots.length} photos to continue`}
                    </button>
                  </>
                )}

                {/* ══ CHECKOUT ══════════════════════════════════════════ */}
                {drawerView === "checkout" && checkoutItems.length > 0 && (
                  <form
                    onSubmit={handlePlaceOrder}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 14,
                    }}
                  >
                    {cartItems.length > 0 && (
                      <div
                        style={{
                          background: "#242424",
                          border: "1px solid #2e2e2e",
                          borderRadius: 12,
                          padding: "14px 16px",
                          marginBottom: 4,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: 10,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 800,
                              color: "#9fbe9f",
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                            }}
                          >
                            {galleryCopy.basketSavedItems ?? "Saved in Basket"}
                          </div>
                          <div style={{ fontSize: 12, color: "#8a8a8a" }}>
                            {cartItems.length} item{cartItems.length === 1 ? "" : "s"}
                          </div>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {cartItems.map((item) => (
                            <div
                              key={item.id}
                              style={{
                                display: "flex",
                                alignItems: "flex-start",
                                justifyContent: "space-between",
                                gap: 12,
                                background: "#1b1b1b",
                                border: "1px solid #2a2a2a",
                                borderRadius: 10,
                                padding: "10px 12px",
                              }}
                            >
                              <div style={{ minWidth: 0 }}>
                                <div
                                  style={{
                                    fontSize: 13,
                                    fontWeight: 700,
                                    color: "#fff",
                                    marginBottom: 3,
                                  }}
                                >
                                  {item.isCompositeOrder ? `Composite • ${item.packageName}` : item.packageName}
                                </div>
                                <div style={{ fontSize: 11, color: "#8a8a8a", lineHeight: 1.6 }}>
                                  {item.category === "digital"
                                    ? `${item.quantity} digital download${item.quantity === 1 ? "" : "s"}`
                                    : `${item.slots.length} print slot${item.slots.length === 1 ? "" : "s"}`}
                                  {item.compositeTitle ? ` • ${item.compositeTitle}` : ""}
                                  {item.backdrop ? ` • ${item.backdrop.name}` : ""}
                                </div>
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 10,
                                  flexShrink: 0,
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: 13,
                                    fontWeight: 700,
                                    color: "#fff",
                                  }}
                                >
                                  ${(item.lineTotalCents / 100).toFixed(2)}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeCartItem(item.id)}
                                  style={{
                                    background: "transparent",
                                    border: "1px solid #3a3a3a",
                                    color: "#999",
                                    borderRadius: 999,
                                    width: 28,
                                    height: 28,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    cursor: "pointer",
                                  }}
                                  aria-label={`Remove ${item.packageName}`}
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {currentDraftCartItem && (
                      <div
                        style={{
                          background: "#242424",
                          border: "1px solid #2e2e2e",
                          borderRadius: 12,
                          padding: "14px 16px",
                          marginBottom: 4,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom:
                              currentDraftCartItem.category !== "digital" ? 10 : 0,
                          }}
                        >
                          <div>
                            <div
                              style={{
                                fontSize: 12,
                                fontWeight: 800,
                                color: "#8a8a8a",
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                                marginBottom: 4,
                              }}
                            >
                              Current selection
                            </div>
                            <div
                              style={{
                                fontSize: 15,
                                fontWeight: 700,
                                color: "#fff",
                              }}
                            >
                              {currentDraftCartItem.isCompositeOrder
                                ? `Composite • ${currentDraftCartItem.packageName}`
                                : currentDraftCartItem.packageName}
                            </div>
                          </div>
                          <div
                            style={{
                              fontSize: 16,
                              fontWeight: 800,
                              color: "#fff",
                            }}
                          >
                            ${(currentDraftCartItem.lineTotalCents / 100).toFixed(2)}
                          </div>
                        </div>

                        {currentDraftCartItem.category !== "digital" && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {currentDraftCartItem.slots.map((slot, i) => (
                              <div
                                key={`${slot.label}_${i}`}
                                style={{ display: "flex", alignItems: "center", gap: 10 }}
                              >
                                <div
                                  style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 6,
                                    overflow: "hidden",
                                    flexShrink: 0,
                                    background: "#1a1a1a",
                                  }}
                                >
                                  {slot.assignedImageUrl && (() => {
                                    const slotNobg = nobgForUrl(slot.assignedImageUrl);
                                    return currentDraftCartItem.backdrop && slotNobg ? (
                                      <MiniComposite
                                        backdropUrl={currentDraftCartItem.backdrop.image_url}
                                        backdropFallbackUrl={currentDraftCartItem.backdrop.image_url}
                                        nobgUrl={slotNobg}
                                        fallbackUrl={slot.assignedImageUrl}
                                        size={42}
                                        backdropBlurPx={
                                          currentDraftCartItem.backdrop.blurred
                                            ? (currentDraftCartItem.backdrop.blurAmount || DEFAULT_BACKDROP_BLUR_PX)
                                            : 0
                                        }
                                      />
                                    ) : (
                                      <img
                                        src={slot.assignedImageUrl}
                                        alt=""
                                        style={{
                                          width: "100%",
                                          height: "100%",
                                          objectFit: "contain",
                                        }}
                                      />
                                    );
                                  })()}
                                </div>
                                <div style={{ fontSize: 12, color: "#888" }}>
                                  {slot.label}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {currentDraftCartItem.category === "digital" && (
                          <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                            {currentDraftCartItem.isCompositeOrder
                              ? "Composite orders are print-only."
                              : "Digital download — photos will be emailed to you"}
                          </div>
                        )}
                      </div>
                    )}

                    <div>
                      <label style={labelStyle}>Name</label>
                      <div style={{ position: "relative" }}>
                        <User
                          size={13}
                          color="#555"
                          style={{ position: "absolute", left: 12, top: 12 }}
                        />
                        <input
                          value={parentName}
                          onChange={(e) => setParentName(e.target.value)}
                          placeholder="Jane Smith"
                          style={{ ...darkInput, paddingLeft: 34 }}
                        />
                      </div>
                    </div>

                    <div>
                      <label style={labelStyle}>Email *</label>
                      <div style={{ position: "relative" }}>
                        <Mail
                          size={13}
                          color="#555"
                          style={{ position: "absolute", left: 12, top: 12 }}
                        />
                        <input
                          type="email"
                          value={parentEmail}
                          onChange={(e) => setParentEmail(e.target.value)}
                          placeholder="jane@email.com"
                          required
                          style={{ ...darkInput, paddingLeft: 34 }}
                        />
                      </div>
                    </div>

                    <div>
                      <label style={labelStyle}>Phone</label>
                      <div style={{ position: "relative" }}>
                        <Phone
                          size={13}
                          color="#555"
                          style={{ position: "absolute", left: 12, top: 12 }}
                        />
                        <input
                          value={parentPhone}
                          onChange={(e) => setParentPhone(e.target.value)}
                          placeholder="(555) 000-0000"
                          style={{ ...darkInput, paddingLeft: 34 }}
                        />
                      </div>
                    </div>

                    {anyPhysicalCheckoutItem && (
                      <div>
                        <label style={labelStyle}>Delivery</label>
                        <div style={{ display: "flex", gap: 8 }}>
                          {(["pickup", "shipping"] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setDeliveryMethod(m)}
                              style={{
                                flex: 1,
                                border: "none",
                                background: deliveryMethod === m ? "#fff" : "#242424",
                                outline:
                                  deliveryMethod === m
                                    ? "none"
                                    : "1px solid #333",
                                outlineOffset: -1,
                                color: deliveryMethod === m ? "#000" : "#666",
                                borderRadius: 8,
                                padding: "11px",
                                fontSize: 13,
                                fontWeight: 700,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 6,
                                transition: "background 0.15s, color 0.15s",
                              }}
                            >
                              {m === "shipping" && <Truck size={13} />}
                              {m.charAt(0).toUpperCase() + m.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {deliveryMethod === "shipping" &&
                      anyPhysicalCheckoutItem && (
                        <div
                          style={{
                            background: "#141414",
                            border: "1px solid #252525",
                            borderRadius: 10,
                            padding: 12,
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                          }}
                        >
                          <input
                            value={shippingName}
                            onChange={(e) => setShippingName(e.target.value)}
                            placeholder="Full name"
                            style={darkInput}
                          />
                          <input
                            value={shippingAddress1}
                            onChange={(e) => setShippingAddress1(e.target.value)}
                            placeholder="Address line 1"
                            style={darkInput}
                          />
                          <input
                            value={shippingAddress2}
                            onChange={(e) => setShippingAddress2(e.target.value)}
                            placeholder="Address line 2 (optional)"
                            style={darkInput}
                          />
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: 8,
                            }}
                          >
                            <input
                              value={shippingCity}
                              onChange={(e) => setShippingCity(e.target.value)}
                              placeholder="City"
                              style={darkInput}
                            />
                            <input
                              value={shippingProvince}
                              onChange={(e) => setShippingProvince(e.target.value)}
                              placeholder="Province"
                              style={darkInput}
                            />
                          </div>
                          <input
                            value={shippingPostalCode}
                            onChange={(e) => setShippingPostalCode(e.target.value)}
                            placeholder="Postal code"
                            style={darkInput}
                          />
                        </div>
                      )}

                    {currentGalleryExtras.allowClientComments ? (
                      <div>
                        <label style={labelStyle}>Notes</label>
                        <textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="Special requests…"
                          rows={3}
                          style={{ ...darkInput, resize: "vertical" }}
                        />
                      </div>
                    ) : null}

                    {orderError && (
                      <div
                        style={{
                          background: "#1e0a0a",
                          border: "1px solid #4a1a1a",
                          borderRadius: 8,
                          padding: "10px 13px",
                          color: "#f87171",
                          fontSize: 12,
                        }}
                      >
                        {orderError}
                      </div>
                    )}

                    <div
                      style={{
                        background: "#141414",
                        border: "1px solid #252525",
                        borderRadius: 10,
                        padding: "12px 14px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          color: "#666",
                          marginBottom: 10,
                          lineHeight: 1.5,
                        }}
                      >
                        Secure card checkout powered by Stripe. Studio OS will route the photographer payout automatically after payment.
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 12,
                          color: "#555",
                          marginBottom: 8,
                        }}
                      >
                        <span>Subtotal</span>
                        <span>${(checkoutSubtotalCents / 100).toFixed(2)}</span>
                      </div>
                      {checkoutBackdropTotalCents > 0 && (
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: 12,
                            color: "#f59e0b",
                            marginBottom: 8,
                          }}
                        >
                          <span>Backdrop add-ons</span>
                          <span>${(checkoutBackdropTotalCents / 100).toFixed(2)}</span>
                        </div>
                      )}
                      <div
                        style={{
                          borderTop: "1px solid #222",
                          paddingTop: 8,
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 15,
                          fontWeight: 700,
                          color: "#fff",
                        }}
                      >
                        <span>Total</span>
                        <span>${(checkoutTotalCents / 100).toFixed(2)}</span>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 10 }}>
                      <button
                        type="button"
                        onClick={() => {
                          if (currentDraftCartItem) addCurrentSelectionToCart();
                          else setDrawerView("product-select");
                        }}
                        style={{
                          flex: 1,
                          background: "#22c55e",
                          color: "#04130a",
                          border: "none",
                          borderRadius: 999,
                          padding: "13px 14px",
                          fontSize: 13,
                          fontWeight: 800,
                          cursor: "pointer",
                        }}
                      >
                        {galleryCopy.addAnotherProduct ?? "Add Another Product"}
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={placing || orderingDisabled || checkoutItems.length === 0}
                      style={{
                        width: "100%",
                        background:
                          placing || orderingDisabled || checkoutItems.length === 0 ? "#222" : "#fff",
                        color:
                          placing || orderingDisabled || checkoutItems.length === 0 ? "#555" : "#000",
                        border: "none",
                        borderRadius: 999,
                        padding: "15px",
                        fontSize: 15,
                        fontWeight: 800,
                        cursor:
                          placing || orderingDisabled || checkoutItems.length === 0 ? "not-allowed" : "pointer",
                      }}
                    >
                      {placing
                        ? "Redirecting to secure checkout…"
                        : orderingDisabled
                        ? galleryCopy.orderingClosed
                        : checkoutItems.length > 1
                        ? `Continue to Secure Checkout (${checkoutItems.length} items)`
                        : currentDraftCartItem?.category === "digital" && !anyPhysicalCheckoutItem
                        ? "Pay for Digital Photos"
                        : "Continue to Secure Checkout"}
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}

          {/* ── Backdrop Picker Panel (school mode only) ─────────────── */}
          {backdropPickerOpen && hasBackdrops && !drawerOpen && (
            <div
              style={{
                width: 520,
                display: "flex",
                flexDirection: "column",
                background: "#111",
                borderLeft: "1px solid #1e1e1e",
                flexShrink: 0,
                overflow: "hidden",
              }}
            >
              {/* Panel header */}
              <div style={{
                padding: "16px 18px",
                borderBottom: "1px solid #1e1e1e",
                background: "#0d0d0d",
              }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 14,
                }}>
                  <h2 style={{
                    margin: 0,
                    fontSize: 13,
                    fontWeight: 800,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "#fff",
                  }}>
                    Choose Backdrop
                  </h2>
                  <button
                    type="button"
                    onClick={() => setBackdropPickerOpen(false)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#666",
                      cursor: "pointer",
                      fontSize: 18,
                      padding: 4,
                      lineHeight: 1,
                      display: "flex",
                    }}
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Nobg status */}
                {nobgStatus === "loading" ? (
                  <div style={{
                    padding: "8px 12px",
                    marginBottom: 10,
                    borderRadius: 6,
                    background: "rgba(59,130,246,0.1)",
                    border: "1px solid rgba(59,130,246,0.25)",
                    fontSize: 11,
                    color: "#93c5fd",
                    lineHeight: 1.5,
                  }}>
                    Preparing backdrop previews for this photo…
                  </div>
                ) : !currentNobgUrl && (
                  <div style={{
                    padding: "8px 12px",
                    marginBottom: 10,
                    borderRadius: 6,
                    background: "rgba(245,158,11,0.1)",
                    border: "1px solid rgba(245,158,11,0.25)",
                    fontSize: 11,
                    color: "#f59e0b",
                    lineHeight: 1.5,
                  }}>
                    ⚠️ No background-removed version found for this photo. Run <strong>Background Removal</strong> in
                    the desktop app, then <strong>Cloud Sync</strong> to enable backdrop compositing.
                  </div>
                )}

                {/* Category tabs */}
                <div style={{
                  display: "flex",
                  gap: 4,
                  overflowX: "auto",
                  paddingBottom: 2,
                  scrollbarWidth: "none",
                }}>
                  {backdropCategoriesWithData.map((cat) => {
                    const active = backdropCategory === cat.key;
                    const count = cat.key === "all"
                      ? backdrops.length
                      : backdrops.filter((b) => b.category === cat.key).length;
                    return (
                      <button
                        key={cat.key}
                        type="button"
                        onClick={() => setBackdropCategory(cat.key)}
                        style={{
                          flexShrink: 0,
                          padding: "7px 14px",
                          borderRadius: 999,
                          border: "none",
                          background: active ? "#fff" : "rgba(255,255,255,0.06)",
                          color: active ? "#000" : "#888",
                          fontSize: 11,
                          fontWeight: active ? 800 : 600,
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        {cat.label}
                        <span style={{ fontSize: 10, opacity: 0.6, fontWeight: 500 }}>{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Live preview */}
              {(() => {
                const panelPreviewBackdrop = selectedBackdrop ?? confirmedBackdrop;
                if (!panelPreviewBackdrop || !selectedImage || !currentNobgUrl) {
                  return null;
                }
                const blurPreviewActive = selectedBlurBackground;
                const panelBlurAmount = blurPreviewActive ? selectedBlurAmount : 0;
                return (
                  <div style={{
                    padding: "16px 18px 12px",
                    borderBottom: "1px solid #1a1a1a",
                    display: "flex",
                    gap: 14,
                    alignItems: "center",
                    background: "#0a0a0a",
                  }}>
                    <div style={{
                      flexShrink: 0,
                      borderRadius: 10,
                      overflow: "hidden",
                      boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}>
                      <CompositeCanvas
                        backdropUrl={panelPreviewBackdrop.thumbnail_url || panelPreviewBackdrop.image_url}
                        backdropFallbackUrl={panelPreviewBackdrop.image_url}
                        nobgUrl={currentNobgUrl}
                        fallbackUrl={selectedImage.url}
                        width={110}
                        height={142}
                        foregroundScale={backdropForegroundScale}
                        foregroundVerticalOffset={backdropForegroundVerticalOffset}
                        trimTransparentForeground
                        backdropBlurPx={panelBlurAmount}
                        preserveForegroundAlignment
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: "#555",
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        marginBottom: 4,
                      }}>
                        Live Preview
                      </div>
                      <div style={{
                        fontSize: 15,
                        fontWeight: 700,
                        color: "#fff",
                        marginBottom: 2,
                      }}>
                        {panelPreviewBackdrop.name}
                      </div>
                      <div style={{
                        fontSize: 11,
                        color: blurPreviewActive
                          ? "#facc15"
                          : panelPreviewBackdrop.tier === "premium"
                            ? "#f59e0b"
                            : "#4ade80",
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        marginBottom: 12,
                      }}>
                        {blurPreviewActive
                          ? `★ Blur preview · ${selectedBlurAmount}px`
                          : panelPreviewBackdrop.tier === "premium"
                            ? `★ Premium · $${(panelPreviewBackdrop.price_cents / 100).toFixed(2)}`
                            : "✓ Included Free"}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {selectedBackdrop ? (
                          <button
                            type="button"
                            onClick={handleConfirmBackdrop}
                            style={{
                              background: "#fff",
                              color: "#000",
                              border: "none",
                              borderRadius: 999,
                              padding: "10px 22px",
                              fontSize: 12,
                              fontWeight: 800,
                              cursor: "pointer",
                              letterSpacing: "0.02em",
                            }}
                          >
                            Use This Backdrop
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={handleConfirmBlurBackground}
                          style={{
                            background: blurPreviewActive ? "#facc15" : "rgba(250,204,21,0.92)",
                            color: "#171717",
                            border: "none",
                            borderRadius: 999,
                            padding: "10px 18px",
                            fontSize: 12,
                            fontWeight: 800,
                            cursor: "pointer",
                            letterSpacing: "0.02em",
                            boxShadow: "0 8px 22px rgba(250,204,21,0.16)",
                          }}
                        >
                          Blur Background
                        </button>
                        <button
                          type="button"
                          onClick={handleClearBackdrop}
                          style={{
                            background: "rgba(255,255,255,0.08)",
                            color: "#e5e7eb",
                            border: "1px solid rgba(255,255,255,0.12)",
                            borderRadius: 999,
                            padding: "10px 16px",
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: "pointer",
                            letterSpacing: "0.02em",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <RotateCcw size={13} strokeWidth={2.2} /> Reset
                        </button>
                      </div>
                      {blurPreviewActive && (
                        <div style={{ marginTop: 12 }}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 8,
                              marginBottom: 6,
                              fontSize: 11,
                              color: "#d4d4d8",
                              fontWeight: 700,
                            }}
                          >
                            <span>Blur Amount</span>
                            <span style={{ color: "#facc15" }}>{selectedBlurAmount}px</span>
                          </div>
                          <input
                            type="range"
                            min={MIN_BACKDROP_BLUR_PX}
                            max={MAX_BACKDROP_BLUR_PX}
                            step={2}
                            value={selectedBlurAmount}
                            onChange={(e) => setSelectedBlurAmount(Number(e.target.value))}
                            style={{ width: "100%", accentColor: "#facc15", cursor: "pointer" }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Backdrop grid */}
              <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
                {/* Free section */}
                {filteredBackdrops.some((b) => b.tier === "free") && (
                  <>
                    <div style={{
                      fontSize: 10,
                      fontWeight: 800,
                      color: "#4ade80",
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      marginBottom: 10,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}>
                      <span style={{
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        background: "rgba(74, 222, 128, 0.12)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 9,
                      }}>✓</span>
                      Included with Gallery
                    </div>
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
                      gap: 8,
                      marginBottom: 20,
                    }}>
                      {filteredBackdrops.filter((b) => b.tier === "free").map((backdrop) => (
                        <BackdropThumbCanvas
                          key={backdrop.id}
                          backdropUrl={backdrop.thumbnail_url || backdrop.image_url}
                          backdropFallbackUrl={backdrop.image_url}
                          selected={selectedBackdrop?.id === backdrop.id}
                          isPremium={false}
                          fetchPriority={selectedBackdrop?.id === backdrop.id ? "high" : "auto"}
                          onClick={() => handleBackdropClick(backdrop)}
                        />
                      ))}
                    </div>
                  </>
                )}

                {/* Premium section */}
                {filteredBackdrops.some((b) => b.tier === "premium") && (
                  <>
                    <div style={{
                      fontSize: 10,
                      fontWeight: 800,
                      color: "#f59e0b",
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      marginBottom: 10,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}>
                      <span style={{
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        background: "rgba(245, 158, 11, 0.12)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 9,
                      }}>★</span>
                      Premium Backdrops
                    </div>
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
                      gap: 8,
                      marginBottom: 14,
                    }}>
                      {filteredBackdrops.filter((b) => b.tier === "premium").map((backdrop) => (
                        <BackdropThumbCanvas
                          key={backdrop.id}
                          backdropUrl={backdrop.thumbnail_url || backdrop.image_url}
                          backdropFallbackUrl={backdrop.image_url}
                          selected={selectedBackdrop?.id === backdrop.id}
                          isPremium={true}
                          fetchPriority={selectedBackdrop?.id === backdrop.id ? "high" : "auto"}
                          onClick={() => handleBackdropClick(backdrop)}
                        />
                      ))}
                    </div>
                    <div style={{
                      background: "rgba(245, 158, 11, 0.06)",
                      border: "1px solid rgba(245, 158, 11, 0.12)",
                      borderRadius: 10,
                      padding: "10px 14px",
                      fontSize: 11,
                      color: "#a0875a",
                      lineHeight: 1.6,
                    }}>
                      Premium backdrops are paid add-ons. Your photographer earns directly when you pick a premium backdrop.
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Premium Backdrop Unlock Modal ───────────────────────────── */}
        {showPremiumModal && premiumTarget && (
          <div
            onClick={() => setShowPremiumModal(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.7)",
              backdropFilter: "blur(8px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 100,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                maxWidth: 400,
                background: "#151515",
                border: "1px solid #2a2a2a",
                borderRadius: 20,
                padding: "36px 32px",
                textAlign: "center",
              }}
            >
              {selectedImage && (
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
                  <div style={{
                    borderRadius: 14,
                    overflow: "hidden",
                    boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}>
                    <CompositeCanvas
                      backdropUrl={premiumTarget.thumbnail_url || premiumTarget.image_url}
                      backdropFallbackUrl={premiumTarget.image_url}
                      nobgUrl={currentNobgUrl}
                      fallbackUrl={selectedImage.url}
                      width={160}
                      height={210}
                      foregroundScale={backdropForegroundScale}
                      foregroundVerticalOffset={backdropForegroundVerticalOffset}
                      trimTransparentForeground
                      preserveForegroundAlignment
                    />
                  </div>
                </div>
              )}

              <div style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                background: "rgba(245,158,11,0.1)",
                border: "1px solid rgba(245,158,11,0.2)",
                borderRadius: 999,
                padding: "5px 12px",
                fontSize: 10,
                fontWeight: 800,
                color: "#f59e0b",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginBottom: 14,
              }}>
                ★ Premium Backdrop
              </div>

              <h3 style={{
                fontSize: 20,
                fontWeight: 800,
                color: "#fff",
                margin: "0 0 6px",
              }}>
                {premiumTarget.name}
              </h3>
              <p style={{
                fontSize: 13,
                color: "#888",
                margin: "0 0 20px",
                lineHeight: 1.6,
              }}>
                Unlock this premium backdrop for a one-time fee. Your photographer earns from every premium backdrop chosen.
              </p>

              <div style={{
                background: "#1a1a1a",
                border: "1px solid #252525",
                borderRadius: 12,
                padding: "14px 18px",
                marginBottom: 18,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}>
                <span style={{ fontSize: 13, color: "#888" }}>Backdrop add-on</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>
                  ${(premiumTarget.price_cents / 100).toFixed(2)}
                </span>
              </div>

              <button
                type="button"
                onClick={handleUnlockPremium}
                style={{
                  width: "100%",
                  background: "linear-gradient(135deg, #f59e0b, #d97706)",
                  color: "#000",
                  border: "none",
                  borderRadius: 999,
                  padding: "14px",
                  fontSize: 14,
                  fontWeight: 800,
                  cursor: "pointer",
                  marginBottom: 10,
                }}
              >
                Unlock for ${(premiumTarget.price_cents / 100).toFixed(2)}
              </button>

              <button
                type="button"
                onClick={() => setShowPremiumModal(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#555",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  padding: "8px 16px",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {!isSchoolMode && currentGalleryBranding.introEnabled && !enteredEventIntro && !loading && !error && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 80,
              background: galleryTone.background,
              display: "flex",
              alignItems: "stretch",
              justifyContent: "center",
            }}
          >
            {introImageUrl ? (
              <>
                <img
                  src={introImageUrl}
                  alt=""
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    filter: blackWhitePreviewActive
                      ? "grayscale(1) blur(20px) saturate(0.7)"
                      : isLightGallery
                        ? "blur(20px) saturate(0.85)"
                        : "grayscale(8%) blur(18px)",
                    transform: "scale(1.04)",
                    opacity: isLightGallery ? 0.2 : 0.28,
                  }}
                />
                <img
                  src={introImageUrl}
                  alt=""
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    padding: "36px",
                    boxSizing: "border-box",
                    opacity: isLightGallery ? 0.96 : 0.92,
                    filter: galleryImageFilter,
                  }}
                />
              </>
            ) : null}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  currentGalleryBranding.introLayout === "minimal"
                    ? isLightGallery
                      ? "rgba(250,250,250,0.72)"
                      : "rgba(8,8,8,0.78)"
                    : isLightGallery
                      ? "linear-gradient(135deg, rgba(252,252,252,0.82) 0%, rgba(252,252,252,0.52) 52%, rgba(252,252,252,0.2) 100%)"
                      : `linear-gradient(135deg, ${galleryTone.heroOverlay} 0%, rgba(0,0,0,0.42) 100%)`,
              }}
            />
            <div
              style={{
                position: "relative",
                zIndex: 1,
                width: "100%",
                display: "flex",
                alignItems: currentGalleryBranding.introLayout === "centered" ? "center" : "stretch",
                justifyContent: "center",
                padding: "40px 24px",
              }}
            >
              <div
                style={{
                  width: "100%",
                  maxWidth: currentGalleryBranding.introLayout === "split" ? 1240 : 760,
                  display: "grid",
                  gridTemplateColumns:
                    currentGalleryBranding.introLayout === "split" ? "minmax(0, 1.2fr) minmax(320px, 460px)" : "minmax(0, 1fr)",
                  gap: 28,
                  alignItems: "center",
                }}
              >
                {currentGalleryBranding.introLayout === "split" ? (
                  <div />
                ) : null}
                <div
                  style={{
                    justifySelf: currentGalleryBranding.introLayout === "split" ? "end" : "center",
                  width: "100%",
                  maxWidth: 460,
                  background:
                    currentGalleryBranding.introLayout === "minimal"
                        ? isLightGallery
                          ? "rgba(255,255,255,0.68)"
                          : "rgba(12,12,12,0.48)"
                        : isLightGallery
                          ? "rgba(255,255,255,0.82)"
                          : "rgba(11,11,11,0.78)",
                    border: isLightGallery ? "1px solid rgba(39,49,59,0.08)" : "1px solid rgba(255,255,255,0.12)",
                    backdropFilter: "blur(18px)",
                    borderRadius: 28,
                    padding: "34px 30px",
                    textAlign: currentGalleryBranding.introLayout === "centered" ? "center" : "left",
                    boxShadow: isLightGallery ? "0 28px 80px rgba(15,23,42,0.12)" : "0 28px 80px rgba(0,0,0,0.28)",
                  }}
                >
                  {currentGalleryBranding.showStudioMark ? (
                    displayStudioLogoUrl ? (
                      <img
                        src={displayStudioLogoUrl}
                        alt=""
                        style={{
                          height: 34,
                          objectFit: "contain",
                          margin: currentGalleryBranding.introLayout === "centered" ? "0 auto 24px" : "0 0 24px",
                        }}
                      />
                    ) : studioInfo.businessName ? (
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 800,
                          letterSpacing: "0.18em",
                          textTransform: "uppercase",
                          color: galleryTone.mutedText,
                          marginBottom: 24,
                        }}
                      >
                        {studioInfo.businessName}
                      </div>
                    ) : null
                  ) : null}

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                      justifyContent: currentGalleryBranding.introLayout === "centered" ? "center" : "flex-start",
                      marginBottom: 18,
                    }}
                  >
                    {[galleryAccessLabel, galleryEventDate, compactCountLabel(images.length, "photo")]
                      .filter(Boolean)
                      .map((item) => (
                        <div
                          key={item}
                          style={{
                            borderRadius: 999,
                            border: isLightGallery
                              ? "1px solid rgba(39,49,59,0.08)"
                              : "1px solid rgba(255,255,255,0.12)",
                            background: isLightGallery
                              ? "rgba(255,255,255,0.72)"
                              : "rgba(255,255,255,0.06)",
                            color: galleryTone.text,
                            padding: "8px 12px",
                            fontSize: 11,
                            fontWeight: 800,
                            letterSpacing: "0.12em",
                            textTransform: "uppercase",
                          }}
                        >
                          {item}
                        </div>
                      ))}
                  </div>

                  <div
                    style={{
                      fontSize: usesSerifHero(currentGalleryBranding.fontPreset) ? 42 : 36,
                      lineHeight: 1.04,
                      fontWeight: 700,
                      color: galleryTone.text,
                      letterSpacing: currentGalleryBranding.themePreset === "cinema" ? "0.06em" : "-0.03em",
                      textTransform: currentGalleryBranding.themePreset === "cinema" ? "uppercase" : "none",
                    }}
                  >
                    {galleryHeadline}
                  </div>
                  {clean(currentGalleryBranding.introMessage) ? (
                    <div
                      style={{
                        marginTop: 18,
                        color: galleryTone.text,
                        fontSize: 15,
                        lineHeight: 1.8,
                      }}
                    >
                      {currentGalleryBranding.introMessage}
                    </div>
                  ) : null}
                  {galleryFutureBadges.length > 0 ? (
                    <div
                      style={{
                        marginTop: 18,
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 8,
                        justifyContent: currentGalleryBranding.introLayout === "centered" ? "center" : "flex-start",
                      }}
                    >
                      {galleryFutureBadges.slice(0, 3).map((badge) => (
                        <div
                          key={badge}
                          style={{
                            borderRadius: 999,
                            background: galleryAccent.muted,
                            border: `1px solid ${galleryAccent.border}`,
                            color: galleryAccent.text,
                            padding: "8px 12px",
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          {badge}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div
                    style={{
                      marginTop: 28,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 12,
                      justifyContent: currentGalleryBranding.introLayout === "centered" ? "center" : "flex-start",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setEnteredEventIntro(true)}
                      style={{
                        borderRadius: 999,
                        background: galleryAccent.solid,
                        color: currentGalleryBranding.accentColor === "ivory" ? "#111111" : "#ffffff",
                        border: "none",
                        padding: "13px 22px",
                        fontSize: 13,
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      {currentGalleryBranding.introCtaLabel || galleryCopy.enterGallery}
                    </button>
                    {eventHasAlbums ? (
                      <button
                        type="button"
                        onClick={() => {
                          setEnteredEventIntro(true);
                          openAlbumsOverview();
                        }}
                        style={{
                          borderRadius: 999,
                          background: isLightGallery ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.08)",
                          color: galleryTone.text,
                          border: isLightGallery ? "1px solid rgba(39,49,59,0.08)" : "1px solid rgba(255,255,255,0.12)",
                          padding: "13px 22px",
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        View Albums
                      </button>
                    ) : null}
                  </div>
                  {heroPreviewImages.length > 0 ? (
                    <div
                      style={{
                        marginTop: 24,
                        display: "grid",
                        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                        gap: 10,
                      }}
                    >
                      {heroPreviewImages.slice(0, 3).map((image) => (
                        <button
                          key={image.id}
                          type="button"
                          onClick={() => {
                            setEnteredEventIntro(true);
                            openImageInGallery(image);
                          }}
                          style={{
                            borderRadius: 18,
                            overflow: "hidden",
                            border: isLightGallery ? "1px solid rgba(39,49,59,0.08)" : "1px solid rgba(255,255,255,0.08)",
                            background: isLightGallery ? "rgba(255,255,255,0.62)" : "rgba(255,255,255,0.05)",
                            cursor: "pointer",
                            padding: 0,
                            aspectRatio: "1 / 1",
                          }}
                        >
                          <img
                            src={image.thumbnailUrl || image.previewUrl || image.url}
                            alt=""
                            loading="lazy"
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              display: "block",
                              filter: galleryImageFilter,
                            }}
                          />
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

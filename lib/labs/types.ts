/** Shared browser/server contracts. Catalog costs are never accepted from a save request. */
export type LabCategory = "prints" | "fine_art" | "canvas" | "metal";
export type LabRounding = "none" | "nearest-dollar" | "0.99";
export type GalleryRef = { kind: "school" | "project"; id: string };

export type Lab = {
  id: string;
  slug: string;
  name: string;
  location: string;
  countryCode: string;
  city: string;
  region: string;
  currency: string;
  status: "setup" | "active" | "paused";
  intakeEnabled: boolean;
  catalogVerified: boolean;
  description: string;
};

export type LabCatalogProduct = {
  id: string;
  labId: string;
  category: LabCategory;
  name: string;
  size: string;
  finish: string;
  /** Integer minor units: CAD cents, JPY yen, BHD fils. */
  costCents: number | null;
  currency: string;
  sku: string | null;
  verified: boolean;
  active: boolean;
  popular: boolean;
  widthInches: number;
  heightInches: number;
  costSource: "lab_confirmed" | "lab_upload" | "screenshot_reference" | "not_provided";
};

export type LabPriceSheetItem = {
  catalogProductId: string;
  /** Integer minor units of the sheet currency. */
  retailCents: number;
  enabled: boolean;
};

export type LabPriceSheetPackage = {
  id: string;
  name: string;
  description: string;
  retailCents: number;
  items: { catalogProductId: string; quantity: number }[];
};

export type LabPriceSheet = {
  id: string;
  version: number;
  name: string;
  labId: string;
  currency: string;
  status: "draft" | "published";
  updatedAt: string;
  pricing: { markupPercent: number; rounding: LabRounding };
  items: LabPriceSheetItem[];
  packages: LabPriceSheetPackage[];
  shipping: { mode: "lab" | "custom" | "pickup"; feeCents: number; title: string };
  terms: string;
  assignments: GalleryRef[];
  publishedProfileId: string | null;
};

export type LabGallery = GalleryRef & { name: string; currentProfileId: string | null };

export type LabWorkspace = {
  labs: Lab[];
  catalog: LabCatalogProduct[];
  priceSheets: LabPriceSheet[];
  galleries: LabGallery[];
};

export type LabWorkspaceAction =
  | { action: "create"; labId: string; name: string; starter: "popular" | "blank" }
  | { action: "save"; sheet: LabPriceSheet; expectedVersion: number }
  | { action: "duplicate"; id: string; name: string }
  | { action: "delete"; id: string; expectedVersion: number }
  | { action: "publish"; id: string; expectedVersion: number; assignments: GalleryRef[] };

export type LabApiResponse = { ok: boolean; message?: string; workspace?: LabWorkspace; sheet?: LabPriceSheet; code?: string };

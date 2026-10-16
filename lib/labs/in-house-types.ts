/** Owner-private copies of existing studio retail sheets. These are never lab catalogs. */
export type InHousePriceSheetEntry = {
  id: string;
  sourceKey: string;
  section: "individual" | "package" | "specialty";
  name: string;
  /** Integer minor units of the sheet currency; no wholesale cost is inferred. */
  retailCents: number;
  active: boolean;
  category: string;
  contents: unknown[];
  original: Record<string, unknown>;
};

export type InHousePriceSheetImport = {
  name: string;
  studioName: string;
  currency: string;
  source: { profileId: string; profileName: string; contentHash: string };
  entries: InHousePriceSheetEntry[];
  warnings: string[];
  tax: { enabled: boolean; percent: number; label: string };
  sourceSnapshot: Record<string, unknown>;
};

export type InHousePriceSheet = InHousePriceSheetImport & {
  id: string;
  version: number;
  status: "draft";
  fulfillment: "in_house";
  updatedAt: string;
};

export type InHousePriceSheetAction =
  | { action: "import"; sheet: InHousePriceSheetImport }
  | { action: "save"; id: string; expectedVersion: number; name: string; entries: { id: string; retailCents: number; active: boolean }[] };

export type InHousePriceSheetsResponse = {
  ok: boolean;
  message?: string;
  code?: string;
  sheets?: InHousePriceSheet[];
  sheet?: InHousePriceSheet;
  replayed?: boolean;
};

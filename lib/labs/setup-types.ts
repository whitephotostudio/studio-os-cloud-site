import type { CatalogImportRow, CatalogIssue, CatalogMapping } from "../lab-catalog-import";
import type { FulfillmentDeliveryMode, FulfillmentInputMode } from "./fulfillment-profile";
import type { Lab } from "./types";

/** Private owner proposals. Nothing in this contract approves a catalog or enables intake. */
export type LabSetupDocument = {
  version: 1;
  marketCountryCode: string | null;
  currency: string | null;
  timeZone: string | null;
  papers: { paperId: string; name: string; size: { unit: "mm" | "in"; width: number | null; height: number | null }; dpi: number | null; colorSpace: "sRGB" }[];
  inputModes: FulfillmentInputMode[];
  labCropping: boolean | null;
  labColourCorrection: boolean | null;
  deliveryModes: FulfillmentDeliveryMode[];
  deliveryCountries: string[];
  productMappings: { sku: string; paperIds: string[]; inputModes: FulfillmentInputMode[] }[];
};
export type LabSetupCatalog = {
  id: string; sourceName: string; contentHash: string; currency: string; headers: string[]; mapping: CatalogMapping;
  /** Bounded preview only. The immutable staged record retains all normalized rows. */
  rows: CatalogImportRow[]; issues: CatalogIssue[]; sourceRowCount: number; validRowCount: number; issueCount: number; createdAt: string;
};
export type LabSetupDraft = {
  labId: string; version: number; status: "draft" | "submitted"; document: LabSetupDocument;
  catalog: LabSetupCatalog | null; readinessIssues: string[]; updatedAt: string | null; submittedAt: string | null;
  canEdit: boolean; testOnly: true; printAllowed: false;
};
export type LabSetupWorkspace = {
  labs: (Lab & { role: "owner" | "operator" | "viewer"; canEdit: boolean })[];
  selectedLabId: string | null; draft: LabSetupDraft | null; available: boolean;
};
type SetupMutation = { labId: string; requestId: string; expectedVersion: number };
export type LabSetupAction =
  | (SetupMutation & { action: "save" | "clear_catalog"; document: LabSetupDocument })
  | (SetupMutation & { action: "stage_catalog"; document: LabSetupDocument; csv: string; sourceName: string; mapping?: CatalogMapping })
  | (SetupMutation & { action: "submit" });
export type LabSetupMutationResult = { draft: LabSetupDraft; replayed: boolean };

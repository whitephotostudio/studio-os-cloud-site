import type { ProductionAsset, ProductionCrop, ProductionEvent, ProductionGallery, ProductionOffer, ProductionOwnerAction, ProductionPolicy, ProductionStatus, ProductionWorkspace } from "./production-types";

export const PRODUCTION_V2_SLOT_IDS = ["8x10", "5x7-a", "5x7-b"] as const;
export type ProductionV2SlotId = typeof PRODUCTION_V2_SLOT_IDS[number];
export type ProductionV2Selections = Record<ProductionV2SlotId, string>;
export type ProductionV2DispatchState = "idle" | "claimed" | "handed_off" | "printed";
export type ProductionV2Slot = {
  id: ProductionV2SlotId; photoId: string; size: "8x10" | "5x7"; quantity: number;
  widthInches: number; heightInches: number; source: ProductionAsset;
  crop: ProductionCrop | null; cropAsset: ProductionAsset | null;
  cropApproved: boolean; cropApprovedAt: string | null;
  colourAsset: ProductionAsset | null; colourCompletedAt: string | null;
  finalReviewedAt: string | null; finalAsset: ProductionAsset | null;
};
export type ProductionV2Job = {
  workflowVersion: 2; id: string; reference: string; galleryId: string;
  version: number; status: ProductionStatus; studioName: string; targetLabel: string;
  targetKind: "in_house" | "partner_lab"; amountKind: "retail" | "wholesale";
  policy: ProductionPolicy; offer: ProductionOffer; currency: string; quantity: number;
  subtotalMinor: number; slots: ProductionV2Slot[];
  availablePhotos: ProductionGallery["photos"];
  photographerApproved: boolean; photographerApprovedAt: string | null;
  holds: string[]; events: ProductionEvent[];
  dispatchState: ProductionV2DispatchState; reprintOf: string | null;
  canReceive: boolean; canApproveOrder: boolean; canCrop: boolean; canChangeSource: boolean;
  canReopen: boolean; canReprint: boolean;
  testOnly: true; payment: "test_no_payment"; printAllowed: false;
  createdAt: string; updatedAt: string;
};
export type ProductionV2Workspace = Omit<ProductionWorkspace, "jobs"> & { jobs: ProductionV2Job[] };
type Base = { jobId: string; expectedVersion: number; requestId: string };
export type ProductionV2OwnerAction =
  | Extract<ProductionOwnerAction, { action: "save_policy" | "create_gallery" | "rotate_gallery" | "revoke_gallery" }>
  | (Base & { action: "approve_order" })
  | (Base & { action: "accept" })
  | (Base & { action: "set_slot_source"; slotId: ProductionV2SlotId; photoId: string })
  | (Base & { action: "save_crop"; slotId: ProductionV2SlotId; rect: ProductionCrop })
  | (Base & { action: "approve_crop"; slotId: ProductionV2SlotId; assetId: string })
  | (Base & { action: "final_review"; slotId: ProductionV2SlotId; assetId: string })
  | (Base & { action: "complete_colour"; slotId: ProductionV2SlotId; assetId: string; reviewNoChange: boolean })
  | (Base & { action: "transition"; status: "in_production" | "ready" | "completed" })
  | (Base & { action: "reopen"; reason: string })
  | (Base & { action: "reprint"; reason: string; receiptToken: string });
export type ProductionV2ParentAction =
  | { action: "gallery"; galleryId: string; accessToken: string }
  | { action: "photo"; galleryId: string; accessToken: string; photoId: string }
  | { action: "submit"; galleryId: string; accessToken: string; requestId: string; receiptToken: string; selections: ProductionV2Selections; quantity: number }
  | { action: "receipt"; receiptToken: string };
export type ProductionV2Receipt = Pick<ProductionV2Job, "workflowVersion" | "id" | "reference" | "version" | "status" | "studioName" | "targetLabel" | "policy" | "offer" | "currency" | "quantity" | "subtotalMinor" | "holds" | "events" | "testOnly" | "payment" | "printAllowed" | "createdAt" | "updatedAt" | "reprintOf"> & { printSlots: { slotId: ProductionV2SlotId; photoId: string; filename: string }[] };
export type ProductionV2Response = { ok: boolean; message?: string; code?: string; workspace?: ProductionV2Workspace; gallery?: ProductionGallery; job?: ProductionV2Job; receipt?: ProductionV2Receipt; asset?: ProductionAsset; replayed?: boolean };
/** Server-created bytes only; never accepted as JSON from an untrusted client. */
export type ProductionV2AssetRegistration = ProductionAsset & { kind: "crop" | "corrected"; jobId: string; slotId: ProductionV2SlotId; sourceAssetId: string; storageKey: string };

export type ProductionPolicy = { autoApprove: boolean; cropResponsibility: "photographer" | "lab"; labColourCorrection: boolean };
export type ProductionPolicyRecord = { version: number; policy: ProductionPolicy };
export type ProductionSize = "8x10" | "5x7";
export type ProductionStatus = "submitted" | "accepted" | "in_production" | "ready" | "completed";
export type ProductionTarget = { kind: "in_house" } | { kind: "partner_lab"; labId: string; product8x10Id: string; product5x7Id: string };
export type ProductionAsset = { id: string; kind: "original" | "crop" | "corrected"; filename: string; sha256: string; byteSize: number; widthPixels: number; heightPixels: number; contentType: "image/jpeg" | "image/png" };
/** Internal server-generated immutable registry document. Never accepted as a browser action. */
export type ProductionAssetRegistration = ProductionAsset & { storageKey: string; jobId: string | null; size: ProductionSize | null; sourceAssetId: string | null };
export type ProductionCrop = { x: number; y: number; width: number; height: number; rotation: 0 | 90 | 180 | 270 };
export type ProductionLine = { size: ProductionSize; quantity: number; widthInches: number; heightInches: number;
  crop: ProductionCrop | null; cropAsset: ProductionAsset | null; cropApproved: boolean; cropApprovedAt: string | null;
  colourAsset: ProductionAsset | null; colourCompletedAt: string | null; finalReviewedAt: string | null; finalAsset: ProductionAsset | null };
export type ProductionEvent = { id: string; action: string; actorRole: "photographer" | "lab" | "policy"; version: number; createdAt: string };
export type ProductionOffer = { id: string; name: string; retailCents: number; contents: { name: string; qty: number }[] };
export type ProductionGallery = { id: string; name: string; studioName: string; currency: string; version: number; offer: ProductionOffer; policy: ProductionPolicy;
  photos: { id: string; filename: string; widthPixels: number; heightPixels: number }[]; expiresAt: string; revokedAt: string | null; createdAt: string; targetLabel: string };
export type ProductionJob = { amountKind: "retail" | "wholesale"; targetKind: "in_house" | "partner_lab"; canReceive: boolean; canApproveOrder: boolean; canCrop: boolean; id: string; reference: string; galleryId: string; version: number; status: ProductionStatus; studioName: string; targetLabel: string;
  policy: ProductionPolicy; offer: ProductionOffer; currency: string; quantity: number; subtotalMinor: number; source: ProductionAsset;
  photographerApproved: boolean; photographerApprovedAt: string | null; lines: ProductionLine[]; holds: string[]; events: ProductionEvent[];
  testOnly: true; payment: "test_no_payment"; printAllowed: false; createdAt: string; updatedAt: string };
export type ProductionWorkspace = { policy: ProductionPolicyRecord; sheets: { id: string; name: string; studioName: string; currency: string; version: number; offers: ProductionOffer[] }[];
  assets: ProductionAsset[]; galleries: ProductionGallery[]; jobs: ProductionJob[]; labs: { id: string; name: string }[]; catalog: { id: string; labId: string; name: string; size: string }[] };
export type ProductionOwnerAction =
  | { action: "save_policy"; expectedVersion: number; policy: ProductionPolicy }
  | { action: "create_gallery"; requestId: string; sheetId: string; expectedSheetVersion: number; entryId: string; name: string; assetIds: string[]; accessToken: string; target: ProductionTarget }
  | { action: "rotate_gallery"; galleryId: string; expectedVersion: number; accessToken: string }
  | { action: "revoke_gallery"; galleryId: string; expectedVersion: number }
  | { action: "approve_order"; jobId: string; expectedVersion: number; requestId: string }
  | { action: "accept"; jobId: string; expectedVersion: number; requestId: string }
  | { action: "save_crop"; jobId: string; expectedVersion: number; requestId: string; productSize: ProductionSize; rect: ProductionCrop }
  | { action: "approve_crop"; jobId: string; expectedVersion: number; requestId: string; size: ProductionSize; assetId: string }
  | { action: "complete_colour"; jobId: string; expectedVersion: number; requestId: string; size: ProductionSize; assetId: string; reviewNoChange: boolean }
  | { action: "final_review"; jobId: string; expectedVersion: number; requestId: string; size: ProductionSize; assetId: string }
  | { action: "transition"; jobId: string; expectedVersion: number; requestId: string; status: "in_production" | "ready" | "completed" };
export type ProductionParentAction = { action: "photo"; galleryId: string; accessToken: string; photoId: string }
  | { action: "gallery"; galleryId: string; accessToken: string }
  | { action: "submit"; galleryId: string; accessToken: string; requestId: string; receiptToken: string; photoId: string; quantity: number }
  | { action: "receipt"; receiptToken: string };
export type ProductionReceipt = Pick<ProductionJob, "id" | "reference" | "version" | "status" | "studioName" | "targetLabel" | "policy" | "offer" | "currency" | "quantity" | "subtotalMinor" | "holds" | "events" | "testOnly" | "payment" | "printAllowed" | "createdAt" | "updatedAt">;
export type ProductionResponse = { ok: boolean; message?: string; code?: string; workspace?: ProductionWorkspace; gallery?: ProductionGallery; job?: ProductionJob; receipt?: ProductionReceipt; asset?: ProductionAsset; replayed?: boolean };

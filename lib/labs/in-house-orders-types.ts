import type { InHousePriceSheetEntry } from "./in-house-types";

export type InHouseTestStatus = "submitted" | "accepted" | "in_production" | "ready" | "completed";
export type InHouseTestContents = { name: "8x10 Lustre" | "5x7 Lustre"; qty: number };
export type InHouseTestOffer = Pick<InHousePriceSheetEntry, "id" | "name" | "retailCents"> & { contents: InHouseTestContents[] };
export type InHouseTestSheetChoice = { id: string; name: string; studioName: string; currency: string; version: number; offers: InHouseTestOffer[] };
export type InHouseTestAsset = {
  id: "sample-8x10" | "sample-5x7"; filename: string; widthInches: number; heightInches: number;
  widthPixels: number; heightPixels: number; sha256: string; byteSize: number; quantity: number;
};
export type InHouseTestGallery = {
  id: string; name: string; studioName: string; currency: string; version: number;
  offer: InHouseTestOffer; photoId: "studio-os-inhouse-demo-v1"; assets: InHouseTestAsset[];
  expiresAt: string; revokedAt: string | null; createdAt: string;
};
export type InHouseTestEvent = { id: string; status: InHouseTestStatus; version: number; createdAt: string };
export type InHouseTestPublicSnapshot = {
  schemaVersion: 1; testOnly: true; galleryName: string; studioName: string;
  currency: string; offer: InHouseTestOffer; photoId: "studio-os-inhouse-demo-v1";
  quantity: number; subtotalMinor: number; taxMinor: 0; shippingMinor: 0; paymentCollectedMinor: 0;
  fulfillment: "in_house"; delivery: "pickup"; assets: InHouseTestAsset[];
};
export type InHouseTestOrderSnapshot = InHouseTestPublicSnapshot & {
  source: { sheetId: string; sheetVersion: number; entryId: string; sourceHash: string; sourceProfileId: string };
};
export type InHouseTestReceipt = {
  id: string; reference: string; status: InHouseTestStatus; version: number;
  snapshot: InHouseTestPublicSnapshot; events: InHouseTestEvent[]; createdAt: string; updatedAt: string;
};
export type InHouseTestOrder = Omit<InHouseTestReceipt, "snapshot"> & { galleryId: string; snapshot: InHouseTestOrderSnapshot };
export type InHouseTestWorkspace = { sheets: InHouseTestSheetChoice[]; galleries: InHouseTestGallery[]; orders: InHouseTestOrder[] };
export type InHouseTestOwnerAction =
  | { action: "create_gallery"; requestId: string; sheetId: string; expectedSheetVersion: number; entryId: string; name: string; accessToken: string }
  | { action: "rotate_gallery"; galleryId: string; expectedVersion: number; accessToken: string }
  | { action: "revoke_gallery"; galleryId: string; expectedVersion: number }
  | { action: "transition"; orderId: string; expectedVersion: number; requestId: string; status: Exclude<InHouseTestStatus, "submitted"> };
export type InHouseTestParentAction =
  | { action: "gallery"; galleryId: string; accessToken: string }
  | { action: "submit"; galleryId: string; accessToken: string; requestId: string; receiptToken: string; offerId: string; photoId: "studio-os-inhouse-demo-v1"; quantity: number }
  | { action: "receipt"; receiptToken: string };
export type InHouseTestResponse = {
  ok: boolean; message?: string; code?: string; workspace?: InHouseTestWorkspace;
  gallery?: InHouseTestGallery; order?: InHouseTestOrder | InHouseTestReceipt; replayed?: boolean;
};

import type { Lab, LabCatalogProduct, LabCategory } from "./types";

export type LabOrderStatus = "submitted" | "accepted" | "declined" | "cancelled" | "in_production" | "ready" | "shipped" | "completed";
export type LabOrderDelivery = { mode: "pickup" | "ship_to_studio"; name: string; address: string };
export type LabOrderLineInput = { catalogProductId: string; assetId: string; quantity: number };
export type LabOrderSubmitPayload = { labId: string; reference: string; notes: string; delivery: LabOrderDelivery; items: LabOrderLineInput[] };
export type LabOrderSubmitAction = LabOrderSubmitPayload & { action: "submit"; requestId: string };
export type LabOrderTransitionAction = { action: "transition"; orderId: string; expectedVersion: number; requestId: string; status: LabOrderStatus; reason: string; carrier: string; trackingNumber: string };
export type LabOrderAction = LabOrderSubmitAction | LabOrderTransitionAction;

export type LabOrderAsset = {
  id: string; photographerId: string; labId: string; filename: string;
  sha256: string; contentType: "image/jpeg" | "image/png"; byteSize: number;
  widthPixels: number; heightPixels: number; ready: boolean; createdAt: string;
};
export type LabOrderSnapshotLine = {
  line: number; catalogProductId: string; sku: string; name: string; category: LabCategory; size: string; finish: string;
  widthInches: number; heightInches: number; unitCostMinor: number; quantity: number; lineCostMinor: number;
  asset: LabOrderAsset & { storageKey: string };
};
export type LabOrderSnapshot = {
  version: 1; lab: { id: string; name: string; currency: string }; studio: { photographerId: string; name: string };
  reference: string; notes: string; delivery: LabOrderDelivery; items: LabOrderSnapshotLine[];
  currency: string; totalMinor: number;
};
export type LabOrderEvent = {
  id: string; orderId: string; actorUserId: string; requestId: string;
  fromStatus: LabOrderStatus | null; toStatus: LabOrderStatus; version: number;
  reason: string; carrier: string; trackingNumber: string; createdAt: string;
};
export type LabOrder = {
  id: string; photographerId: string; labId: string; reference: string; status: LabOrderStatus; version: number;
  currency: string; totalMinor: number; snapshot: LabOrderSnapshot; events: LabOrderEvent[];
  createdAt: string; updatedAt: string;
};
export type ManagedOrderLab = Lab & { role: "owner" | "operator" | "viewer" };
export type LabOrdersWorkspace = {
  photographerId: string | null; labs: Lab[]; managedLabs: ManagedOrderLab[];
  catalog: LabCatalogProduct[]; assets: LabOrderAsset[]; orders: LabOrder[];
};
export type LabOrdersResponse = { ok: boolean; workspace?: LabOrdersWorkspace; order?: LabOrder; asset?: LabOrderAsset; nextCursor?: string | null; message?: string; code?: string };

/** Only server-owned row values are mapped; never manufacture a receipt client-side. */
export function labOrderAssetFromRow(row: Record<string, unknown>): LabOrderAsset {
  return { id: String(row.id), photographerId: String(row.photographer_id), labId: String(row.lab_id), filename: String(row.filename),
    sha256: String(row.sha256), contentType: row.content_type as LabOrderAsset["contentType"], byteSize: Number(row.byte_size),
    widthPixels: Number(row.width_pixels), heightPixels: Number(row.height_pixels), ready: row.ready === true, createdAt: String(row.created_at) };
}
export function labOrderEventFromRow(row: Record<string, unknown>): LabOrderEvent {
  return { id: String(row.id), orderId: String(row.order_id), actorUserId: String(row.actor_user_id), requestId: String(row.request_id),
    fromStatus: row.from_status == null ? null : row.from_status as LabOrderStatus, toStatus: row.to_status as LabOrderStatus, version: Number(row.version),
    reason: String(row.reason || ""), carrier: String(row.carrier || ""), trackingNumber: String(row.tracking_number || ""), createdAt: String(row.created_at) };
}
export function orderFromRow(row: Record<string, unknown>, events: Record<string, unknown>[] = []): LabOrder {
  const snapshot = row.snapshot as LabOrderSnapshot;
  return { id: String(row.id), photographerId: String(row.photographer_id), labId: String(row.lab_id), reference: snapshot.reference,
    status: row.status as LabOrderStatus, version: Number(row.version), currency: String(row.currency), totalMinor: Number(row.total_minor), snapshot,
    events: events.map(labOrderEventFromRow).sort((a, b) => a.version - b.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

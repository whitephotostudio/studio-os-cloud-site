import type { NextRequest } from "next/server";
import { createDashboardServiceClient, isTrustedDashboardRequest } from "@/lib/dashboard-auth";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { inHouseSampleAssets } from "./in-house-sample-assets";
import { loadInHousePriceSheets, type LabAccess } from "./server";
import { LabError } from "./validation";
import { eligibleInHouseTestOffer, inHouseTestTokenHash } from "./in-house-orders-validation";
import type { InHouseTestAsset, InHouseTestEvent, InHouseTestGallery, InHouseTestOffer, InHouseTestOrder, InHouseTestOrderSnapshot, InHouseTestOwnerAction, InHouseTestParentAction, InHouseTestPublicSnapshot, InHouseTestReceipt, InHouseTestWorkspace } from "./in-house-orders-types";

type Row = Record<string, unknown>;
const iso = (value: unknown) => new Date(String(value)).toISOString();
export function inHouseTestDatabaseError(error: { message?: string; code?: string } | null): never {
  const message = error?.message || "";
  if (/VERSION_CONFLICT/.test(message)) throw new LabError("This private test changed in another window. Refresh before trying again.", 409, "IN_HOUSE_TEST_VERSION_CONFLICT");
  if (/REQUEST_CONFLICT/.test(message) || error?.code === "23505") throw new LabError("This test request was already used with different details. Review the saved result before starting another request.", 409, "IN_HOUSE_TEST_REQUEST_CONFLICT");
  if (/NOT_FOUND|FORBIDDEN|OWNER/.test(message)) throw new LabError("This private test link is unavailable, expired, or belongs to another studio.", 404, "IN_HOUSE_TEST_NOT_FOUND");
  if (/OFFER_UNAVAILABLE/.test(message)) throw new LabError("Select an active copied package containing one 8×10 and two 5×7 Lustre prints.", 409, "IN_HOUSE_TEST_OFFER_UNAVAILABLE");
  if (/TRANSITION/.test(message)) throw new LabError("Refresh this order and use its next available production stage.", 409, "IN_HOUSE_TEST_TRANSITION");
  if (/LIMIT/.test(message)) throw new LabError("This private rehearsal has reached its gallery or test-order limit.", 409, "IN_HOUSE_TEST_LIMIT");
  if (/INVALID/.test(message)) throw new LabError("Check the copied package, synthetic sample files and test quantity.", 400, "IN_HOUSE_TEST_INVALID");
  throw new LabError("The private in-house rehearsal is temporarily unavailable. Existing prices and customer orders have not changed.", 503, "IN_HOUSE_TEST_UNAVAILABLE");
}
function assetsProjection(value: unknown): InHouseTestAsset[] {
  return (value as InHouseTestAsset[]).map(asset => ({ id: asset.id, filename: asset.filename, widthInches: asset.widthInches, heightInches: asset.heightInches,
    widthPixels: asset.widthPixels, heightPixels: asset.heightPixels, sha256: asset.sha256, byteSize: asset.byteSize, quantity: asset.quantity }));
}
function offerProjection(value: unknown): InHouseTestOffer {
  const offer = value as InHouseTestOffer;
  return { id: offer.id, name: offer.name, retailCents: offer.retailCents, contents: offer.contents.map(item => ({ name: item.name, qty: item.qty })) };
}
function publicSnapshot(value: unknown): InHouseTestPublicSnapshot {
  const snapshot = value as InHouseTestPublicSnapshot;
  return { schemaVersion: 1, testOnly: true, galleryName: snapshot.galleryName, studioName: snapshot.studioName, currency: snapshot.currency,
    offer: offerProjection(snapshot.offer), photoId: snapshot.photoId, quantity: snapshot.quantity, subtotalMinor: snapshot.subtotalMinor,
    taxMinor: 0, shippingMinor: 0, paymentCollectedMinor: 0, fulfillment: "in_house", delivery: "pickup", assets: assetsProjection(snapshot.assets) };
}
/** Explicit projection: capability responses never include source profiles, owner IDs or capability hashes. */
function galleryProjection(value: unknown): InHouseTestGallery {
  const gallery = value as InHouseTestGallery;
  return { id: gallery.id, name: gallery.name, studioName: gallery.studioName, currency: gallery.currency, version: gallery.version,
    offer: offerProjection(gallery.offer), photoId: gallery.photoId, assets: assetsProjection(gallery.assets),
    expiresAt: iso(gallery.expiresAt), revokedAt: gallery.revokedAt == null ? null : iso(gallery.revokedAt), createdAt: iso(gallery.createdAt) };
}
function galleryFromRow(row: Row): InHouseTestGallery {
  return galleryProjection({ ...(row.document as Row), id: String(row.id), version: Number(row.version), expiresAt: row.expires_at, revokedAt: row.revoked_at, createdAt: row.created_at });
}
function eventFromRow(row: Row): InHouseTestEvent { return { id: String(row.id), status: row.status as InHouseTestEvent["status"], version: Number(row.version), createdAt: iso(row.created_at) }; }
function ownerOrderFromRow(row: Row, events: Row[]): InHouseTestOrder {
  const savedSource = (row.snapshot as InHouseTestOrderSnapshot).source;
  const source = { sheetId: savedSource.sheetId, sheetVersion: savedSource.sheetVersion, entryId: savedSource.entryId, sourceHash: savedSource.sourceHash, sourceProfileId: savedSource.sourceProfileId };
  return { id: String(row.id), reference: String(row.reference), galleryId: String(row.gallery_id), status: row.status as InHouseTestOrder["status"], version: Number(row.version),
    snapshot: { ...publicSnapshot(row.snapshot), source }, events: events.map(eventFromRow).sort((a, b) => a.version - b.version), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}
function receiptProjection(value: unknown): InHouseTestReceipt {
  const receipt = value as InHouseTestReceipt;
  return { id: receipt.id, reference: receipt.reference, status: receipt.status, version: receipt.version, snapshot: publicSnapshot(receipt.snapshot),
    events: receipt.events.map(event => ({ id: event.id, status: event.status, version: event.version, createdAt: iso(event.createdAt) })), createdAt: iso(receipt.createdAt), updatedAt: iso(receipt.updatedAt) };
}
async function orderEvents(access: LabAccess, orderIds: string[]): Promise<Row[]> {
  const events: Row[] = [];
  for (let start = 0; start < orderIds.length; start += 100) {
    const result = await access.service.from("in_house_test_order_events").select("*").in("order_id", orderIds.slice(start, start + 100)).order("version").limit(500);
    if (result.error || !Array.isArray(result.data)) inHouseTestDatabaseError(result.error);
    events.push(...result.data);
  }
  return events;
}
export async function loadInHouseTestOrder(access: LabAccess, id: string): Promise<InHouseTestOrder> {
  const result = await access.service.from("in_house_test_orders").select("*").eq("id", id).eq("photographer_id", access.photographerId).maybeSingle();
  if (result.error) inHouseTestDatabaseError(result.error);
  if (!result.data) throw new LabError("This private test order does not belong to your studio.", 404, "IN_HOUSE_TEST_NOT_FOUND");
  return ownerOrderFromRow(result.data, await orderEvents(access, [id]));
}
export async function loadInHouseTestWorkspace(access: LabAccess): Promise<InHouseTestWorkspace> {
  const [sheets, galleries, orders] = await Promise.all([
    loadInHousePriceSheets(access),
    access.service.from("in_house_test_galleries").select("*").eq("photographer_id", access.photographerId).order("created_at", { ascending: false }).order("id").limit(30),
    access.service.from("in_house_test_orders").select("*").eq("photographer_id", access.photographerId).order("created_at", { ascending: false }).order("id").limit(600),
  ]);
  if (galleries.error || !Array.isArray(galleries.data)) inHouseTestDatabaseError(galleries.error);
  if (orders.error || !Array.isArray(orders.data)) inHouseTestDatabaseError(orders.error);
  const events = await orderEvents(access, orders.data.map(row => String(row.id)));
  return { sheets: sheets.map(sheet => ({ id: sheet.id, name: sheet.name, studioName: sheet.studioName, currency: sheet.currency, version: sheet.version,
    offers: sheet.entries.map(eligibleInHouseTestOffer).filter((offer): offer is InHouseTestOffer => offer !== null) })).filter(sheet => sheet.offers.length > 0),
    galleries: galleries.data.map(galleryFromRow), orders: orders.data.map(row => ownerOrderFromRow(row, events.filter(event => event.order_id === row.id))) };
}
export async function performInHouseTestOwnerAction(access: LabAccess, action: InHouseTestOwnerAction) {
  const result = action.action === "create_gallery" ? await access.service.rpc("create_in_house_test_gallery", {
    p_user_id: access.userId, p_request_id: action.requestId, p_sheet_id: action.sheetId, p_expected_sheet_version: action.expectedSheetVersion,
    p_entry_id: action.entryId, p_name: action.name, p_token_hash: inHouseTestTokenHash(action.accessToken), p_assets: await inHouseSampleAssets(),
  }) : action.action === "transition" ? await access.service.rpc("transition_in_house_test_order", {
    p_user_id: access.userId, p_order_id: action.orderId, p_expected_version: action.expectedVersion, p_request_id: action.requestId, p_status: action.status,
  }) : await access.service.rpc("manage_in_house_test_gallery", {
    p_user_id: access.userId, p_gallery_id: action.galleryId, p_expected_version: action.expectedVersion,
    p_action: action.action === "rotate_gallery" ? "rotate" : "revoke", p_token_hash: action.action === "rotate_gallery" ? inHouseTestTokenHash(action.accessToken) : null,
  });
  if (result.error) inHouseTestDatabaseError(result.error);
  if (!result.data || typeof result.data.id !== "string") throw new LabError("The saved test receipt is unavailable. Retry the same request to confirm it.", 503, "IN_HOUSE_TEST_UNAVAILABLE");
  const workspace = await loadInHouseTestWorkspace(access);
  const saved = action.action === "transition" ? { order: await loadInHouseTestOrder(access, result.data.id) } : { gallery: galleryFromRow(result.data) };
  return { workspace, ...saved, replayed: result.data.replayed === true };
}
export async function performInHouseTestParentAction(request: NextRequest, action: InHouseTestParentAction) {
  if (!isTrustedDashboardRequest(request)) throw new LabError("Open this private test from its Studio OS link.", 403, "IN_HOUSE_TEST_ORIGIN");
  const quota = await rateLimit(getClientIp(request), { namespace: "in-house-test-parent", limit: action.action === "submit" ? 30 : 90, windowSeconds: 60, failClosed: true });
  if (!quota.allowed) throw new LabError(quota.unavailable ? "Private test protection is temporarily unavailable. Try again shortly." : "Too many private test requests. Try again shortly.", quota.unavailable ? 503 : 429, "IN_HOUSE_TEST_RATE_LIMIT");
  const service = createDashboardServiceClient();
  const result = action.action === "gallery" ? await service.rpc("read_in_house_test_gallery", { p_gallery_id: action.galleryId, p_token_hash: inHouseTestTokenHash(action.accessToken) })
    : action.action === "receipt" ? await service.rpc("read_in_house_test_receipt", { p_receipt_hash: inHouseTestTokenHash(action.receiptToken) })
      : await service.rpc("submit_in_house_test_order", { p_gallery_id: action.galleryId, p_token_hash: inHouseTestTokenHash(action.accessToken), p_request_id: action.requestId,
        p_receipt_hash: inHouseTestTokenHash(action.receiptToken), p_offer_id: action.offerId, p_photo_id: action.photoId, p_quantity: action.quantity });
  if (result.error) inHouseTestDatabaseError(result.error);
  if (!result.data || typeof result.data.id !== "string") throw new LabError("The saved private test could not be confirmed. Retry the same request.", 503, "IN_HOUSE_TEST_UNAVAILABLE");
  return action.action === "gallery" ? { gallery: galleryProjection(result.data) } : { order: receiptProjection(result.data), replayed: result.data.replayed === true };
}

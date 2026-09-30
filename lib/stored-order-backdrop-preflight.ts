import type { createDashboardServiceClient } from "@/lib/dashboard-auth";
import {
  assertParentBackdropCutouts,
  isAllDigitalBackdropPackage,
  ParentCutoutPreflightError,
  type ParentBackdropEntry,
} from "@/lib/parent-cutout-preflight";
import { isRetouchPackage } from "@/lib/retouching";
import { cartSnapshotToOrderItems } from "@/lib/order-display";

type Service = ReturnType<typeof createDashboardServiceClient>;
export type StoredBackdropOrder = {
  id: string;
  school_id?: string | null;
  student_id?: string | null;
  project_id?: string | null;
  photographer_id?: string | null;
  package_id?: string | null;
  package_name?: string | null;
  cart_snapshot?: unknown;
  special_notes?: string | null;
  notes?: string | null;
};
export type StoredBackdropLine = { product_name?: string | null; sku?: string | null; quantity?: number | null; line_total_cents?: number | null; unit_price_cents?: number | null };
class StoredGalleryPurchaseReviewError extends ParentCutoutPreflightError {
  constructor() {
    super();
    this.message = "This saved order needs review. Please return to your gallery or contact your photographer before paying.";
  }
}
type Package = {
  id: string;
  photographer_id: string | null;
  name: string | null;
  category: string | null;
  items: unknown[] | null;
  is_retouch_addon: boolean | null;
};
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const isAllDigital = (pkg: Package) => !isRetouchPackage(pkg) &&
  (clean(pkg.category).toLowerCase() === "digital" || /digital|download|usb/i.test(clean(pkg.name))) && isAllDigitalBackdropPackage(pkg);
// Match delivery's label-based all-gallery trigger only as a review hint.
// It cannot establish which paid package or gallery scope was purchased.
function allGalleryLabel(value: unknown) {
  const text = clean(value).toLowerCase();
  if (text.includes("retouch") || !/digital|download|file|jpg|jpeg|png|usb/.test(text)) return false;
  return /(all|full|entire|complete)\s+(digital|digitals|downloads|files|gallery|album|collection|photos|images)/.test(text) ||
    /(digital|digitals|downloads|files)\s+(all|full|entire|complete)/.test(text) || /all photos|all images|all files/.test(text);
}
function hasPaidPackageLine(entry: Record<string, unknown>, pkg: Package, lines: StoredBackdropLine[]) {
  if (!(Number(entry.quantity ?? 1) > 0)) return false;
  // A client/snapshot name cannot relabel a paid one-image line as an
  // all-digital purchase merely by pointing at a real catalog ID. Without a
  // current authoritative name match, renamed legacy history needs review.
  const name = clean(pkg.name);
  if (!name) return false;
  return lines.some(line => {
    const lineName = clean(line.product_name);
    const cents = Number(line.line_total_cents ?? Number(line.unit_price_cents ?? 0) * Number(line.quantity ?? 0));
    return Number.isSafeInteger(cents) && cents > 0 &&
      (lineName === name || lineName.startsWith(`${name} • `) || lineName === `${name} (Landscape)`);
  });
}

/** Saved selections remain intact on refusal. A price row or old BACKDROP
 * note is not enough to reconstruct the exact photo/background selection.
 * Caller gallery overrides are deliberately not accepted here.
 */
export async function assertStoredOrderBackdropCutouts(
  service: Service,
  orders: StoredBackdropOrder[],
  linesByOrder: ReadonlyMap<string, StoredBackdropLine[]>,
  pin?: string,
) {
  for (const order of orders) {
    if (!Array.isArray(order.cart_snapshot) && record(order.cart_snapshot)?.backdrop != null) throw new ParentCutoutPreflightError();
    const snapshot = Array.isArray(order.cart_snapshot) ? order.cart_snapshot.map(record) : [];
    const chosen = snapshot.filter((entry): entry is Record<string, unknown> => !!entry && entry.backdrop != null);
    const lines = linesByOrder.get(order.id) ?? [];
    const snapshotItems = cartSnapshotToOrderItems(order.cart_snapshot);
    const deliveryItems = snapshotItems.length ? snapshotItems : lines;
    // Filenames and slot labels participate in delivery's all-gallery trigger.
    // Evaluate them before the original-background fast path as review hints,
    // never as proof of an all-gallery package purchase.
    const claimsAllGallery = allGalleryLabel(order.package_name) ||
      deliveryItems.some(item => allGalleryLabel([item.product_name, order.package_name].map(clean).join(" "))) ||
      snapshot.some(entry => !!entry && allGalleryLabel([entry.packageName,
        ...(Array.isArray(entry.slots) ? entry.slots.map(slot => record(slot)?.label) : [])].map(clean).join(" ")));
    const hasPremiumLine = lines.some(line => /premium\s+backdrop/i.test(clean(line.product_name)));
    // Current customer prose is prefixed "> ", so it cannot masquerade as
    // the unprefixed machine-written fulfillment marker.
    const hasBackdropNote = [order.special_notes, order.notes].some(notes => /^BACKDROP:\s*\S/m.test(notes ?? ""));
    if (!chosen.length) {
      if (hasPremiumLine || hasBackdropNote) throw new ParentCutoutPreflightError();
      if (!claimsAllGallery) continue; // Ordinary originals need no extra reads.
    }
    try {
      const photographerId = clean(order.photographer_id);
      if (!photographerId) throw new ParentCutoutPreflightError();
      if (chosen.some(entry => !clean(entry.packageId))) throw new ParentCutoutPreflightError();
      const purchaseEntries = snapshot.length ? snapshot.filter((entry): entry is Record<string, unknown> => !!entry) :
        [{ packageId: order.package_id, packageName: order.package_name, quantity: 1 }];
      const packageIds = [...new Set(purchaseEntries.map(entry => clean(entry.packageId)).filter(Boolean))];
      if (!packageIds.length) throw new ParentCutoutPreflightError();
      const { data: rows, error } = await service.from("packages")
        .select("id,photographer_id,name,category,items,is_retouch_addon").in("id", packageIds);
      if (error) throw error;
      const packages = new Map((rows ?? []).map(row => [row.id, row as Package]));
      const paidAllDigital = (entry: Record<string, unknown>) => {
        const pkg = packages.get(clean(entry.packageId));
        return !!pkg && pkg.photographer_id === photographerId && isAllDigital(pkg) && hasPaidPackageLine(entry, pkg, lines);
      };
      if (claimsAllGallery && !purchaseEntries.some(paidAllDigital)) throw new ParentCutoutPreflightError();
      // Genuine original all-digital purchases need package/payment authority,
      // not background credits, cutouts, invented photo refs or gallery reads.
      if (!chosen.length) continue;
      const entries: ParentBackdropEntry[] = [];
      for (const entry of chosen) {
        const pkg = packages.get(clean(entry.packageId));
        if (!pkg || pkg.photographer_id !== photographerId) throw new ParentCutoutPreflightError();
        // Only the current server package can exempt a retouching service;
        // a stored/browser-supplied package name never grants an exemption.
        if (isRetouchPackage(pkg)) {
          if (hasPremiumLine) throw new ParentCutoutPreflightError();
          continue;
        }
        const entryClaimsAll = cartSnapshotToOrderItems([entry]).some(item => allGalleryLabel(item.product_name));
        if ((entryClaimsAll || isAllDigital(pkg)) && !paidAllDigital(entry)) throw new ParentCutoutPreflightError();
        if (!record(entry.backdrop) || !clean(record(entry.backdrop)?.id)) throw new ParentCutoutPreflightError();
        if (entry.slots != null && !Array.isArray(entry.slots)) throw new ParentCutoutPreflightError();
        if (entry.digitalSelections != null && !Array.isArray(entry.digitalSelections)) throw new ParentCutoutPreflightError();
        const slots = (Array.isArray(entry.slots) ? entry.slots : []).map(slot => {
          const value = record(slot);
          if (!value || (value.assignedImageUrl != null && !clean(value.assignedImageUrl))) throw new ParentCutoutPreflightError();
          return { assignedImageUrl: clean(value.assignedImageUrl) || null };
        });
        const digitalSelections = (Array.isArray(entry.digitalSelections) ? entry.digitalSelections : []).flatMap<{ mediaId: string; url: string | null }>(selection => {
          const value = record(selection);
          if (!value || !clean(value.mediaId) || [value.url, value.thumbnailUrl].some(ref => ref != null && !clean(ref))) throw new ParentCutoutPreflightError();
          // Fulfillment resolves url || thumbnailUrl. Validate that fallback,
          // and both supplied references when present, against the same ID.
          const refs = [...new Set([clean(value.url), clean(value.thumbnailUrl)].filter(Boolean))];
          if (!refs.length) throw new ParentCutoutPreflightError();
          return refs.map(url => ({ mediaId: clean(value.mediaId), url }));
        });
        if (entry.selectedImageUrl != null && !clean(entry.selectedImageUrl)) throw new ParentCutoutPreflightError();
        entries.push({ hasBackdrop: true, allPhotos: isAllDigital(pkg),
          selectedImageUrl: clean(entry.selectedImageUrl) || null, slots, digitalSelections });
      }
      if (!entries.length) continue;
      const schoolId = clean(order.school_id);
      const projectId = clean(order.project_id);
      if (schoolId) {
        const studentId = clean(order.student_id);
        if (!studentId) throw new ParentCutoutPreflightError();
        await assertParentBackdropCutouts(service, { mode: "school", photographerId, schoolId, studentId }, entries);
      } else {
        const credential = clean(pin);
        if (!projectId || !credential) throw new ParentCutoutPreflightError();
        // Existing event all-gallery snapshots do not preserve the purchased
        // collection/PIN scope, and delivery currently enumerates the whole
        // project. A caller's current PIN cannot rewrite that saved scope.
        if (entries.some(entry => entry.allPhotos)) throw new ParentCutoutPreflightError();
        await assertParentBackdropCutouts(service, { mode: "event", photographerId, projectId, pin: credential }, entries);
      }
    } catch { throw chosen.length ? new ParentCutoutPreflightError() : new StoredGalleryPurchaseReviewError(); }
  }
}

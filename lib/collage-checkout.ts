import type { SupabaseClient } from "@supabase/supabase-js";
import type { CollageTemplate } from "@/lib/collage-template";
import { parseCollageSelection, packageCollageVersion, type CollageSelection } from "@/lib/collage-selection";
import { resolveCollageVersions, type StoredCollageVersion } from "@/lib/collage-server";
import { resolveSchoolOrderMediaReferences } from "@/lib/school-order-media";
import { resolveEventOrderMediaReferences } from "@/lib/event-order-media";

/** Captured from server-owned immutable versions and authorized original keys. */
export type CollageOrderSnapshot = Omit<CollageSelection, "placements"> & {
  templateId: string;
  versionNumber: number;
  photographerId: string;
  design: CollageTemplate;
  artworkKey: string | null;
  contentHash: string;
  placements: Array<CollageSelection["placements"][number] & { mediaKey: string }>;
};
export type CollageCheckoutSlot = {
  label: string;
  assignedImageUrl: string | null;
  collage?: CollageSelection | CollageOrderSnapshot;
};
export type CollagePackageItem = string | {
  qty?: number | string | null; name?: string | null; type?: string | null;
  size?: string | null; finish?: string | null; composite?: boolean | null;
  collage?: { templateVersionId?: unknown } | null;
};
type CollagePackage = { items?: CollagePackageItem[] | null; category?: string | null; name?: string | null; is_retouch_addon?: boolean | null };
type Entry = { packageId: string; quantity: number; slots: CollageCheckoutSlot[]; isComposite?: boolean; backdrop?: unknown; digitalSelections?: unknown[]; retouchSelections?: unknown[] };
export class CollageCheckoutError extends Error {}

/** No format checks or version lookups affect older ordinary-print packages. */
export function collagePackageVersions(pkg: CollagePackage): string[] {
  return [...new Set((pkg.items ?? []).flatMap(item => {
    if (typeof item === "string" || item.collage == null) return [];
    let id: string | null;
    try { id = packageCollageVersion(item); }
    catch { throw new CollageCheckoutError("A collage product has an invalid template version. Please contact the studio."); }
    if (!id) throw new CollageCheckoutError("A collage product has an invalid template version. Please contact the studio.");
    return [id];
  }))];
}

function configuredSlots(pkg: CollagePackage, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new CollageCheckoutError("Invalid collage package quantity.");
  const slots: Array<{ item: CollagePackageItem; versionId: string | null }> = [];
  for (const item of pkg.items ?? []) {
    const rawQty = typeof item === "string" ? 1 : item.qty ?? 1;
    const qty = Number(rawQty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new CollageCheckoutError("A collage package has an invalid print quantity. Please contact the studio.");
    const versionId = typeof item === "string" ? null : packageCollageVersion(item);
    for (let copy = 0; copy < quantity; copy++) for (let print = 0; print < qty; print++) slots.push({ item, versionId });
  }
  if (slots.length > 20) throw new CollageCheckoutError("This collage package contains too many print copies. Please contact the studio.");
  return slots;
}

function assertOutputSize(item: CollagePackageItem, design: CollageTemplate) {
  if (typeof item === "string" || !item.size?.trim()) return;
  const dimensions = item.size.trim().match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:in(?:ches)?|["″])?$/i);
  if (!dimensions || Math.abs(Number(dimensions[1]) - design.widthInches) > .001 || Math.abs(Number(dimensions[2]) - design.heightInches) > .001) {
    throw new CollageCheckoutError("The collage print size no longer matches its design. Reopen the gallery and choose the product again.");
  }
}

/** All dependencies resolve against the current authenticated gallery, never browser URLs. */
export async function validateCollageCheckoutEntries<T extends Entry>(
  entries: T[], getPackage: (id: string) => CollagePackage,
  versions: Map<string, StoredCollageVersion>,
  authorizeMedia: (mediaIds: string[]) => Promise<string[]>,
) {
  const pending: Array<{ slot: CollageCheckoutSlot; selection: CollageSelection; stored: StoredCollageVersion }> = [];
  for (const entry of entries) {
    const pkg = getPackage(entry.packageId);
    const requiredVersions = collagePackageVersions(pkg);
    const hasSelection = entry.slots.some(slot => slot.collage != null);
    if (!requiredVersions.length) {
      if (hasSelection) throw new CollageCheckoutError("This product no longer includes a collage. Reopen the gallery and choose the product again.");
      continue;
    }
    const category = `${pkg.category ?? ""} ${pkg.name ?? ""}`.toLowerCase();
    if (pkg.is_retouch_addon || /digital|download|usb/.test(category) || entry.isComposite || entry.backdrop || entry.digitalSelections?.length || entry.retouchSelections?.length) {
      throw new CollageCheckoutError("Collages must be configured as physical prints without a backdrop, retouching or class-composite option.");
    }
    const expected = configuredSlots(pkg, entry.quantity);
    if (expected.length !== entry.slots.length) throw new CollageCheckoutError("The collage package or copy count changed. Reopen the gallery and choose the product again.");
    // No untrusted snapshot fields survive parsing, including reorders.
    for (let index = 0; index < expected.length; index++) {
      const { item, versionId } = expected[index];
      const slot = entry.slots[index];
      const itemText = typeof item === "string" ? item : `${item.type ?? ""} ${item.name ?? ""}`;
      if (/digital|download|usb|jpeg|jpg|png|\bfiles?\b/i.test(itemText)) throw new CollageCheckoutError("Mixed collage packages must contain physical prints. Digital products need a separate package.");
      if (!versionId) {
        if (slot.collage) throw new CollageCheckoutError("A collage selection was supplied for an ordinary print.");
        if (!slot.assignedImageUrl) throw new CollageCheckoutError("Choose a photo for every print in the collage package.");
        continue;
      }
      if (typeof item !== "string" && (item.composite || /digital|download|file|jpeg|jpg|png/.test(`${item.type ?? ""} ${item.name ?? ""}`.toLowerCase()))) {
        throw new CollageCheckoutError("A collage product cannot also be a digital or class-composite print.");
      }
      const configured = versions.get(versionId);
      if (!configured) throw new CollageCheckoutError("This collage template is no longer available in the gallery.");
      let selection: CollageSelection;
      try { selection = parseCollageSelection(slot.collage); }
      catch (error) { throw new CollageCheckoutError(error instanceof Error ? error.message : "Complete every collage photo space."); }
      const stored = versions.get(selection.templateVersionId);
      if (!stored || stored.templateId !== configured.templateId ||
        stored.design.widthInches !== configured.design.widthInches || stored.design.heightInches !== configured.design.heightInches) {
        throw new CollageCheckoutError("The collage product changed. Reopen the gallery and choose the product again.");
      }
      // A reorder may retain a previously purchased immutable version only
      // while that exact version is still published, granted and compatible
      // with this current product's template identity and physical size.
      try { selection = parseCollageSelection(selection, stored.design); }
      catch (error) { throw new CollageCheckoutError(error instanceof Error ? error.message : "Complete every collage photo space."); }
      assertOutputSize(item, configured.design);
      pending.push({ slot, selection, stored });
    }
  }
  if (!pending.length) return;
  // Read the authorized gallery once for all print copies. Reused photos stay
  // independent crop recipes without repeating the same scoped media query.
  const mediaIds = [...new Set(pending.flatMap(({ selection }) => selection.placements.map(placement => placement.mediaId)))];
  const mediaKeys = await authorizeMedia(mediaIds);
  if (mediaKeys.length !== mediaIds.length || mediaKeys.some(key => !key)) throw new CollageCheckoutError("Could not verify every selected collage photo.");
  const keyById = new Map(mediaIds.map((id, index) => [id, mediaKeys[index]]));
  for (const { slot, selection, stored } of pending) {
    const snapshot: CollageOrderSnapshot = {
      ...selection, templateId: stored.templateId, versionNumber: stored.versionNumber,
      photographerId: stored.photographerId, design: JSON.parse(JSON.stringify(stored.design)) as CollageTemplate,
      artworkKey: stored.artworkKey, contentHash: stored.contentHash,
      placements: selection.placements.map(placement => ({ ...placement, mediaKey: keyById.get(placement.mediaId)! })),
    };
    slot.collage = snapshot;
    // A collage output is rendered later. Never mistake its source portrait
    // for the purchased image in existing fulfillment and download paths.
    slot.assignedImageUrl = null;
    slot.label = `${snapshot.design.name} • ${snapshot.design.widthInches}×${snapshot.design.heightInches} collage`.slice(0, 120);
  }
}

export async function resolveCollageCheckout<T extends Entry>(
  service: SupabaseClient, photographerId: string,
  scope: { schoolId: string; studentId: string } | { projectId: string; collectionIds: string[] },
  entries: T[], getPackage: (id: string) => CollagePackage,
) {
  const configuredVersionIds = entries.flatMap(entry => collagePackageVersions(getPackage(entry.packageId)));
  const selectedVersionIds: string[] = [];
  for (const entry of entries) for (const slot of entry.slots) {
    if (slot.collage == null) continue;
    try { selectedVersionIds.push(parseCollageSelection(slot.collage).templateVersionId); }
    catch (error) { throw new CollageCheckoutError(error instanceof Error ? error.message : "Invalid collage selection."); }
  }
  const versionIds = [...new Set([...configuredVersionIds, ...selectedVersionIds])];
  if (!versionIds.length) return;
  if (process.env.STUDIO_OS_COLLAGE_CHECKOUT_ENABLED !== "1") throw new CollageCheckoutError("Collages are a preview. Purchasing will be available after production integration is verified.");
  let versions: Map<string, StoredCollageVersion>;
  try { versions = await resolveCollageVersions(service, photographerId, scope, versionIds); }
  catch (error) { throw new CollageCheckoutError(error instanceof Error ? error.message : "Could not verify collage availability."); }
  await validateCollageCheckoutEntries(entries, getPackage, versions, async mediaIds => {
    // Existing media resolvers enforce the same student folders, tombstones
    // and collection scopes as ordinary print selection, including siblings.
    const selection = { selectedImageUrl: null, slots: [], retouchSelections: [], digitalSelections: mediaIds.map(mediaId => ({ mediaId, url: null as string | null })) };
    try {
      if ("schoolId" in scope) await resolveSchoolOrderMediaReferences(service, scope.schoolId, scope.studentId, photographerId, [selection]);
      else await resolveEventOrderMediaReferences(service, scope.projectId, scope.collectionIds, [selection]);
    } catch (error) { throw new CollageCheckoutError(error instanceof Error ? error.message : "A collage photo is outside this gallery."); }
    return selection.digitalSelections.map(placement => placement.url || "");
  });
}

import type { LabCatalogProduct, LabPriceSheetItem, LabRounding, LabStarterCollection, LabStarterSize } from "./types";
import { isLabCurrency, roundedLabRetail } from "./money";

const size = (widthInches: number, heightInches: number): LabStarterSize => ({ id: `${widthInches}x${heightInches}`, widthInches, heightInches, label: `${widthInches} × ${heightInches}` });
const printSizes = [size(4, 6), size(5, 7), size(8, 10), size(8, 12), size(11, 14), size(16, 20)];
const parts = (...values: [string, number][]) => values.map(([sizeId, quantity]) => ({ sizeId, quantity }));
const portraitSources = ["https://www.mitphotography.ca/pricing-packages", "https://www.hannahgilbert.com.au/family-info"];

/** Original starter structures based on offered print menus, not measured parent favourites or copied prices. */
export const LAB_STARTER_COLLECTIONS: LabStarterCollection[] = [
  { id: "everyday-prints", version: 1, name: "Everyday prints", audience: "Individual sizes", description: "Six familiar print sizes, ready for your own prices.", sizes: printSizes, packages: [], notes: ["Each size is a separate print product. All dimensions are inches."], sourceUrls: ["https://www.volkanphotography.com/pricing", "https://www.julianaustinphotography.co.uk/studio-print-prices/"] },
  { id: "school-simple", version: 1, name: "School print collections", audience: "School & nursery", description: "Three simple print-only packages for parents to choose from.", sizes: [size(4, 6), size(5, 7), size(8, 10)], packages: [
    { id: "school-small", name: "School Small", description: "Two prints to keep or share.", items: parts(["5x7", 2]) },
    { id: "school-classic", name: "School Classic", description: "One larger print and two gift prints.", items: parts(["8x10", 1], ["5x7", 2]) },
    { id: "school-sharing", name: "School Sharing", description: "A print collection for family and friends.", items: parts(["8x10", 2], ["5x7", 4], ["4x6", 4]) },
  ], notes: ["Prints only. Wallet sheets need an explicit pieces-per-sheet specification; class/group photographs need a separate image-role contract. Digital files remain in the existing digital-delivery workflow."], sourceUrls: ["https://imperialphoto.ca/schoolphotopackages", "https://www.rapidfocusmedia.com.au/pricing", "https://www.sandboxphotographers.com/school-pricing"] },
  { id: "portrait-essentials", version: 1, name: "Portrait Essentials", audience: "Portrait & family", description: "One 8 × 10 and two 5 × 7 prints in one editable package.", sizes: [size(5, 7), size(8, 10)], packages: [{ id: "portrait-essentials", name: "Portrait Essentials", description: "One 8 × 10 and two 5 × 7 prints.", items: parts(["8x10", 1], ["5x7", 2]) }], notes: ["Choose photographs and crops separately when ordering; a package quantity describes print pieces."], sourceUrls: portraitSources },
  { id: "family-sharing", version: 1, name: "Family Sharing", audience: "Portrait & family", description: "Two 8 × 10, four 5 × 7 and four 4 × 6 prints to share.", sizes: [size(4, 6), size(5, 7), size(8, 10)], packages: [{ id: "family-sharing", name: "Family Sharing", description: "Two 8 × 10, four 5 × 7 and four 4 × 6 prints.", items: parts(["8x10", 2], ["5x7", 4], ["4x6", 4]) }], notes: ["This is an original print-only combination; no wallets, digital files or session fees are included."], sourceUrls: [...portraitSources, "https://www.johncreightonphotography.com/pricing1"] },
  { id: "gift-prints", version: 1, name: "Gift Prints", audience: "Sharing & gifts", description: "Ten 5 × 7 prints, with every quantity and price editable.", sizes: [size(5, 7)], packages: [{ id: "gift-prints", name: "Gift Prints", description: "Ten 5 × 7 prints.", items: parts(["5x7", 10]) }], notes: ["A print quantity does not promise ten different images; image selection is reviewed in the order."], sourceUrls: ["https://www.hannahgilbert.com.au/family-info"] },
  { id: "wall-and-gift", version: 1, name: "Wall & Gift", audience: "Portrait & display", description: "One 11 × 14, two 8 × 10 and four 5 × 7 prints.", sizes: [size(5, 7), size(8, 10), size(11, 14)], packages: [{ id: "wall-and-gift", name: "Wall & Gift", description: "One 11 × 14, two 8 × 10 and four 5 × 7 prints.", items: parts(["11x14", 1], ["8x10", 2], ["5x7", 4]) }], notes: ["Unframed individual photo prints. Mounts, frames and canvas wraps are separate products."], sourceUrls: portraitSources },
];

export type StarterMatchStatus = "matched" | "missing" | "verification" | "ambiguous";
export type StarterSizeMatch = { size: LabStarterSize; status: StarterMatchStatus; product: LabCatalogProduct | null; retailCents: number | null };
export type StarterResolvedPackage = { id: string; name: string; description: string; available: boolean; items: { catalogProductId: string; quantity: number }[]; costCents: number | null; retailCents: number | null };
export type StarterPreview = { sizes: StarterSizeMatch[]; packages: StarterResolvedPackage[]; items: LabPriceSheetItem[]; counts: Record<StarterMatchStatus, number> };

export function starterCollection(id: string) { return LAB_STARTER_COLLECTIONS.find(entry => entry.id === id); }
export const normalizedStarterFinish = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
// Catalog approval must describe a single ordinary print. Never reinterpret a wallet sheet,
// class image, mounted product or collage as one print based only on its outer dimensions.
const differentSellUnit = /\b(wallet|wallets|sheet|sheets|package|bundle|pair|pairs|set|sets|pack|packs|collage|montage|mounted|mount|class|group|team|canvas|metal|framed|frame|trader|card|cards|[248][ -]?up)\b/i;
const quantityBeforeSize = /(?:^|\s)(?:[2-9]|[1-9]\d+)\s*(?:[-x×]\s*)?\d+(?:\.\d+)?\s*[x×]\s*\d+/i;
function isIndividualPrint(product: LabCatalogProduct) { return product.category === "prints" && !differentSellUnit.test(`${product.name} ${product.size} ${product.finish}`) && !quantityBeforeSize.test(product.name); }
export function approvedStarterProduct(product: LabCatalogProduct, labId: string, currency: string) {
  return product.labId === labId && product.printsPerUnit === 1 && isIndividualPrint(product) && product.active && product.verified && !!product.sku?.trim() && product.costSource === "lab_confirmed" && Number.isSafeInteger(product.costCents) && product.costCents! >= 0 && product.costCents! <= 100_000_000 && product.currency === currency && isLabCurrency(currency) && Number.isFinite(product.widthInches) && Number.isFinite(product.heightInches) && product.widthInches > 0 && product.heightInches > 0 && !!product.finish.trim();
}
export function starterFinishes(catalog: LabCatalogProduct[], labId: string, currency: string): string[] {
  const values = new Map<string, string>();
  for (const product of catalog) if (approvedStarterProduct(product, labId, currency)) values.set(normalizedStarterFinish(product.finish), product.finish.trim());
  return [...values.values()].sort((a, b) => a.localeCompare(b));
}

/** One exact approved SKU or no match. Similar names, crop ratios and nearby sizes never substitute. */
export function resolveStarterCollection(collection: LabStarterCollection, catalog: LabCatalogProduct[], labId: string, currency: string, finish: string, markupPercent: number, rounding: LabRounding): StarterPreview {
  if (!isLabCurrency(currency)) throw new TypeError("Choose the lab's supported currency.");
  if (!Number.isFinite(markupPercent) || markupPercent < 0 || markupPercent > 10_000) throw new TypeError("Choose a markup between 0% and 10000%.");
  if (!["none", "nearest-dollar", "0.99"].includes(rounding)) throw new TypeError("Choose a supported rounding rule.");
  const indexed = new Map<string, LabCatalogProduct[]>();
  const key = (width: number, height: number) => `${Math.min(width, height)}:${Math.max(width, height)}`;
  for (const product of catalog) {
    if (product.labId !== labId || !isIndividualPrint(product) || normalizedStarterFinish(product.finish) !== normalizedStarterFinish(finish)) continue;
    const id = key(product.widthInches, product.heightInches);
    indexed.set(id, [...(indexed.get(id) ?? []), product]);
  }
  const counts: StarterPreview["counts"] = { matched: 0, missing: 0, verification: 0, ambiguous: 0 };
  const sizes = collection.sizes.map(required => {
    const candidates = indexed.get(key(required.widthInches, required.heightInches)) ?? [];
    const approved = candidates.filter(product => approvedStarterProduct(product, labId, currency));
    const product = approved.length === 1 ? approved[0] : null;
    const status: StarterMatchStatus = product ? "matched" : approved.length > 1 ? "ambiguous" : candidates.length ? "verification" : "missing";
    counts[status]++;
    const retailCents = product ? roundedLabRetail(product.costCents!, markupPercent, rounding, currency) : null;
    if (retailCents !== null && retailCents > 100_000_000) throw new RangeError("The calculated retail price is too large. Lower the markup.");
    return { size: required, status, product, retailCents };
  });
  const byId = new Map(sizes.map(entry => [entry.size.id, entry]));
  const packages = collection.packages.map(pack => {
    const available = pack.items.every(item => byId.get(item.sizeId)?.product);
    const items = available ? pack.items.map(item => ({ catalogProductId: byId.get(item.sizeId)!.product!.id, quantity: item.quantity })) : [];
    const costCents = available ? pack.items.reduce((total, item) => total + byId.get(item.sizeId)!.product!.costCents! * item.quantity, 0) : null;
    const retailCents = costCents === null ? null : roundedLabRetail(costCents, markupPercent, rounding, currency);
    if (retailCents !== null && retailCents > 100_000_000) throw new RangeError("The calculated package price is too large. Lower the markup.");
    return { ...pack, available, items, costCents, retailCents };
  });
  return { sizes, packages, counts, items: sizes.filter(entry => entry.product).map(entry => ({ catalogProductId: entry.product!.id, retailCents: entry.retailCents!, enabled: true })) };
}

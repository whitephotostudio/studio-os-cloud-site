import { z } from "zod";
import type { Lab, LabCatalogProduct, LabPriceSheet, LabWorkspaceAction } from "./types";
import { isLabCurrency, roundedLabRetail } from "./money";

export class LabError extends Error {
  constructor(message: string, public status = 400, public code = "LAB_INVALID") { super(message); }
}

const uuid = z.string().uuid();
const cents = z.number().int().min(0).max(100_000_000);
const name = z.string().trim().min(1).max(100);
const gallery = z.object({ kind: z.enum(["school", "project"]), id: uuid }).strict();
const sheet = z.object({
  id: uuid, version: z.number().int().min(1).max(2_000_000_000), name,
  labId: uuid, currency: z.string().refine(isLabCurrency), status: z.enum(["draft", "published"]),
  updatedAt: z.string().max(64), publishedProfileId: z.string().max(150).nullable(),
  pricing: z.object({ markupPercent: z.number().min(0).max(10_000), rounding: z.enum(["none", "nearest-dollar", "0.99"]) }).strict(),
  items: z.array(z.object({ catalogProductId: uuid, retailCents: cents, enabled: z.boolean() }).strict()).max(500),
  packages: z.array(z.object({ id: uuid, name, description: z.string().trim().max(1000), retailCents: cents,
    items: z.array(z.object({ catalogProductId: uuid, quantity: z.number().int().min(1).max(100) }).strict()).min(1).max(100),
  }).strict()).max(100),
  shipping: z.object({ mode: z.enum(["lab", "custom", "pickup"]), feeCents: cents, title: z.string().trim().max(100) }).strict(),
  terms: z.string().trim().max(10_000), assignments: z.array(gallery).max(200),
}).strict();

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), labId: uuid, name, starter: z.enum(["popular", "blank"]) }).strict(),
  z.object({ action: z.literal("save"), sheet, expectedVersion: z.number().int().min(1) }).strict(),
  z.object({ action: z.literal("duplicate"), id: uuid, name }).strict(),
  z.object({ action: z.literal("delete"), id: uuid, expectedVersion: z.number().int().min(1) }).strict(),
  z.object({ action: z.literal("publish"), id: uuid, expectedVersion: z.number().int().min(1), assignments: z.array(gallery).min(1).max(200) }).strict(),
]);

function unique(values: string[], message: string) {
  if (new Set(values).size !== values.length) throw new LabError(message);
}

export function parseLabAction(value: unknown): LabWorkspaceAction {
  const parsed = action.safeParse(value);
  if (!parsed.success) throw new LabError("The lab workspace request is invalid. Refresh and check the selected products, prices and quantities.");
  const result = parsed.data;
  if (result.action === "save") {
    if (result.sheet.version !== result.expectedVersion) throw new LabError("The sheet changed. Refresh before saving.", 409, "LAB_VERSION_CONFLICT");
    validateSheetStructure(result.sheet);
  }
  if (result.action === "publish") unique(result.assignments.map(g => `${g.kind}:${g.id}`), "Choose each gallery once.");
  return result;
}

export function validateSheetStructure(value: LabPriceSheet) {
  unique(value.items.map(i => i.catalogProductId), "A product appears more than once in this sheet.");
  unique(value.packages.map(p => p.id), "Package identifiers must be unique.");
  unique(value.assignments.map(g => `${g.kind}:${g.id}`), "Choose each gallery once.");
  for (const pack of value.packages) {
    unique(pack.items.map(i => i.catalogProductId), "A package contains a repeated product. Adjust its quantity instead.");
    if (pack.items.reduce((total, i) => total + i.quantity, 0) > 100) throw new LabError("A package can contain at most 100 pieces.");
  }
  if (value.shipping.mode !== "custom" && value.shipping.feeCents !== 0) throw new LabError("Only custom shipping can set a shipping fee.");
}

export function validateSheetCatalog(value: LabPriceSheet, lab: Lab | undefined, catalog: LabCatalogProduct[]) {
  if (!lab || value.labId !== lab.id || !isLabCurrency(value.currency) || value.currency !== lab.currency) throw new LabError("The selected lab or currency is unavailable.");
  const products = new Map(catalog.filter(p => p.labId === lab.id).map(p => [p.id, p]));
  const selected = [...value.items.map(i => i.catalogProductId), ...value.packages.flatMap(p => p.items.map(i => i.catalogProductId))];
  if (selected.some(id => !products.has(id))) throw new LabError("A selected product does not belong to this lab.", 403, "LAB_CATALOG_SCOPE");
  return products;
}

export function assertPublicationReady(value: LabPriceSheet, lab: Lab, catalog: LabCatalogProduct[]) {
  const products = validateSheetCatalog(value, lab, catalog);
  if (lab.status !== "active" || !lab.catalogVerified || !lab.intakeEnabled) {
    throw new LabError("This lab is in setup. Confirm its catalog, costs and production intake before publishing or sending orders.", 409, "LAB_NOT_READY");
  }
  const ids = [...value.items.filter(i => i.enabled).map(i => i.catalogProductId), ...value.packages.flatMap(p => p.items.map(i => i.catalogProductId))];
  if (!ids.length) throw new LabError("Select at least one product or package before publishing.");
  if (value.items.some(i => i.enabled && i.retailCents <= 0) || value.packages.some(p => p.retailCents <= 0)) {
    throw new LabError("Set a positive retail price for every published product and package. Zero prices can be saved in a draft.", 409, "LAB_RETAIL_PRICE_REQUIRED");
  }
  if (ids.some(id => { const p = products.get(id)!; return !p.active || !p.verified || !p.sku?.trim() || p.costSource !== "lab_confirmed" || p.costCents === null || p.currency !== value.currency; })) {
    throw new LabError("Every published product needs a lab-confirmed SKU, cost, currency and production specification.", 409, "LAB_SKU_NOT_VERIFIED");
  }
}

/** An environment flag cannot activate unsupported shipping, terms or print routing. */
export function assertLabFulfillmentIntegrated(): never {
  throw new LabError("Your draft is saved. Publishing and gallery assignments remain on hold until lab checkout, shipping, terms and production are integrated and accepted.", 409, "LAB_FULFILLMENT_NOT_INTEGRATED");
}

export function roundedRetailCents(costCents: number, markupPercent: number, rounding: LabPriceSheet["pricing"]["rounding"], currency = "CAD") {
  return roundedLabRetail(costCents, markupPercent, rounding, currency);
}

/** Never persist client status, owner, catalog costs or publication authority. */
export function labSheetDocument(value: LabPriceSheet) {
  return { name: value.name, labId: value.labId, currency: value.currency, pricing: value.pricing,
    items: value.items, packages: value.packages, shipping: value.shipping, terms: value.terms, assignments: value.assignments };
}

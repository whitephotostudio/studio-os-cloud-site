import { z } from "zod";
import { CATALOG_FIELDS, type CatalogPreview } from "../lab-catalog-import";
import { isLabCountryCode } from "../lab-directory";
import { isLabCurrency } from "./money";
import { LabError } from "./validation";
import type { LabSetupAction, LabSetupDocument } from "./setup-types";

export const LAB_SETUP_BODY_BYTES = 4_000_000;
export const LAB_SETUP_DOCUMENT_BYTES = 200_000;
const unique = <T>(values: T[]) => new Set(values).size === values.length;
const text = (maximum: number) => z.string().min(1).max(maximum).refine(v => v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v));
const identity = text(100).refine(v => /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(v));
const decimal = z.number().finite().positive().max(3048).refine(v => Math.round(v * 1000) / 1000 === v);
const mode = z.enum(["individual", "composite"]);
const modes = z.array(mode).max(2).refine(unique);
const countries = z.array(z.string().refine(isLabCountryCode)).max(250).refine(unique);
const paper = z.object({ paperId: identity, name: text(100), size: z.object({ unit: z.enum(["mm", "in"]), width: decimal.nullable(), height: decimal.nullable() }).strict().refine(v => v.unit === "mm" || (v.width ?? 0) <= 120 && (v.height ?? 0) <= 120), dpi: z.number().int().min(72).max(1200).nullable(), colorSpace: z.literal("sRGB") }).strict();
const documentSchema = z.object({
  version: z.literal(1), marketCountryCode: z.string().refine(isLabCountryCode).nullable(), currency: z.string().refine(isLabCurrency).nullable(),
  timeZone: text(100).refine(v => { try { new Intl.DateTimeFormat("en", { timeZone: v }).format(0); return true; } catch { return false; } }).nullable(),
  papers: z.array(paper).max(50), inputModes: modes, labCropping: z.boolean().nullable(), labColourCorrection: z.boolean().nullable(),
  deliveryModes: z.array(z.enum(["pickup", "ship_to_studio", "ship_to_client"])).max(3).refine(unique), deliveryCountries: countries,
  productMappings: z.array(z.object({ sku: text(100), paperIds: z.array(identity).max(50).refine(unique), inputModes: modes }).strict()).max(500),
}).strict().refine(v => unique(v.papers.map(p => p.paperId)) && unique(v.productMappings.map(p => p.sku)), "Use each paper identity and exact product SKU once.");
const base = { labId: z.string().uuid(), requestId: z.string().uuid(), expectedVersion: z.number().int().min(0).max(1_000_000_000) };
const mapping = z.object(Object.fromEntries(CATALOG_FIELDS.map(field => [field, z.number().int().min(0).max(49).optional()]))).strict();
const actionSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("save"), document: documentSchema }).strict(),
  z.object({ ...base, action: z.literal("clear_catalog"), document: documentSchema }).strict(),
  z.object({ ...base, action: z.literal("stage_catalog"), document: documentSchema, csv: z.string().min(1).refine(v => !v.includes("\u0000") && new TextEncoder().encode(v).length <= 2_000_000), sourceName: text(150), mapping: mapping.optional() }).strict(),
  z.object({ ...base, action: z.literal("submit") }).strict(),
]);
export function parseLabSetupDocument(value: unknown): LabSetupDocument {
  if (new TextEncoder().encode(JSON.stringify(value) ?? "").length > LAB_SETUP_DOCUMENT_BYTES) throw new LabError("Keep this setup under 200 KB.", 413, "LAB_SETUP_INVALID");
  const result = documentSchema.safeParse(value);
  if (!result.success) throw new LabError("Check the setup fields, explicit paper units, countries and product mappings.", 400, "LAB_SETUP_INVALID");
  return result.data as LabSetupDocument;
}
export function parseLabSetupAction(value: unknown): LabSetupAction {
  const result = actionSchema.safeParse(value);
  if (!result.success) throw new LabError("Use a complete setup request with valid paper units and a CSV up to 2 MB.", 400, "LAB_SETUP_INVALID");
  if ("document" in result.data) parseLabSetupDocument(result.data.document);
  return result.data as LabSetupAction;
}
export function defaultLabSetupDocument(country: string, currency: string): LabSetupDocument {
  return { version: 1, marketCountryCode: isLabCountryCode(country) ? country : null, currency: isLabCurrency(currency) ? currency : null, timeZone: null, papers: [], inputModes: [], labCropping: null, labColourCorrection: null, deliveryModes: [], deliveryCountries: [], productMappings: [] };
}
/** Proposals select exact SKUs. Paper rotation and automatic size substitutions are not inferred. */
export function labSetupReadinessIssues(document: LabSetupDocument, catalog: (CatalogPreview & { currency: string }) | null): string[] {
  const issues: string[] = [];
  if (!document.marketCountryCode) issues.push("Choose the catalog's market country.");
  if (!document.currency) issues.push("Choose the catalog currency.");
  if (!document.timeZone) issues.push("Choose the lab's IANA time zone.");
  if (!document.papers.length || document.papers.some(p => p.size.width === null || p.size.height === null || p.dpi === null)) issues.push("Complete at least one paper size, explicit unit and resolution.");
  if (!document.inputModes.length) issues.push("Choose individual files, composite sheets, or both.");
  if (document.labCropping === null || document.labColourCorrection === null) issues.push("State whether the lab offers cropping and colour correction.");
  if (!document.deliveryModes.length) issues.push("Choose at least one delivery option.");
  if (document.deliveryModes.some(m => m !== "pickup") && !document.deliveryCountries.length) issues.push("List the countries the lab can ship to.");
  if (!catalog) issues.push("Stage a catalog CSV before submitting.");
  else if (catalog.currency !== document.currency || catalog.issues.length || !catalog.rows.length) issues.push("Resolve all staged catalog issues and use the same explicit currency.");
  if (!document.productMappings.length) issues.push("Map at least one exact catalog SKU to its paper and input options.");
  const rows = new Map(catalog?.rows.map(row => [row.sku, row]) ?? []), papers = new Map(document.papers.map(p => [p.paperId, p]));
  for (const product of document.productMappings) {
    const row = rows.get(product.sku);
    if (!row || row.printsPerUnit !== 1 || !product.paperIds.length || !product.inputModes.length || product.inputModes.some(m => !document.inputModes.includes(m))) { issues.push(`Complete the single-print SKU mapping for ${product.sku}.`); continue; }
    const widthNm = Math.round(row.widthInches * 1000) * 25400, heightNm = Math.round(row.heightInches * 1000) * 25400;
    if (Math.round(row.widthInches * 1000) / 1000 !== row.widthInches || Math.round(row.heightInches * 1000) / 1000 !== row.heightInches) { issues.push(`Use at most three decimal places for ${product.sku}'s finished dimensions.`); continue; }
    let hasExactPaper = false;
    for (const id of product.paperIds) {
      const p = papers.get(id), factor = p?.size.unit === "mm" ? 1000 : 25400;
      const w = p?.size.width == null ? 0 : Math.round(p.size.width * 1000) * factor, h = p?.size.height == null ? 0 : Math.round(p.size.height * 1000) * factor;
      if (!p || widthNm > w || heightNm > h) issues.push(`Choose a fitting paper for ${product.sku}; finished sizes and orientation are never changed automatically.`);
      if (p && widthNm === w && heightNm === h) hasExactPaper = true;
    }
    if (product.inputModes.includes("individual") && !hasExactPaper) issues.push(`Map an exact finished-size paper for ${product.sku}'s individual-file option.`);
  }
  return [...new Set(issues)];
}

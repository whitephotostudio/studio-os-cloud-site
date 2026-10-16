import { z } from "zod";
import { isLabCountryCode } from "../lab-directory";
import { currencyMinorUnits, isLabCurrency } from "./money";

/** Pure planning metadata. A profile never grants permission to sell, pay or print. */
export type FulfillmentSize = { unit: "mm" | "in"; width: number; height: number };
export type FulfillmentInputMode = "individual" | "composite";
export type FulfillmentDeliveryMode = "pickup" | "ship_to_studio" | "ship_to_client";
export type FulfillmentProfile = {
  version: 1; labId: string; marketCountryCode: string; revision: number;
  location: { countryCode: string; city: string; timeZone: string };
  currency: string;
  transport: { kind: "manual_download" | "windows_helper" | "api" | "hot_folder"; state: "configured" | "unverified" };
  capabilities: { inputModes: FulfillmentInputMode[]; labCropping: boolean; labColourCorrection: boolean; deliveryModes: FulfillmentDeliveryMode[]; deliveryCountries: string[] };
  products: { productId: string; sku: string; finishedSize: FulfillmentSize; inputModes: FulfillmentInputMode[]; paperIds: string[] }[];
  papers: { paperId: string; size: FulfillmentSize; dpi: number; colorSpace: "sRGB" }[];
};
export type FulfillmentPlanRequest = {
  labId: string; marketCountryCode: string; profileRevision: number; currency: string;
  inputMode: FulfillmentInputMode; labCropping: boolean; labColourCorrection: boolean;
  delivery: { mode: FulfillmentDeliveryMode; countryCode: string };
  lines: { lineId: string; productId: string; sku: string; finishedSize: FulfillmentSize; quantity: number; sourceAssetId: string }[];
  outputs: { outputId: string; paperId: string; dpi: number; colorSpace: "sRGB"; copies: number; cells: { lineId: string; sourceAssetId: string; x: number; y: number; unit: "mm" | "in"; rotation: 0 | 90 }[] }[];
};
type DeepReadonly<T> = T extends (infer V)[] ? readonly DeepReadonly<V>[] : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type FulfillmentTestPlan = DeepReadonly<{
  profileVersion: 1; labId: string; marketCountryCode: string; revision: number; currency: string; currencyMinorUnits: number;
  profile: FulfillmentProfile; request: FulfillmentPlanRequest;
  lines: FulfillmentPlanRequest["lines"]; outputs: FulfillmentPlanRequest["outputs"];
  testOnly: true; printAllowed: false; paymentAllowed: false; operationallyAuthorized: false;
}>;
export type FulfillmentResolution = { supported: false; reasons: string[]; plan: null } | { supported: true; reasons: []; plan: FulfillmentTestPlan };

const LIMITS = { products: 500, papers: 100, lines: 200, outputs: 200, cellsPerOutput: 100, totalCells: 1000 } as const;
const identity = z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const sku = z.string().min(1).max(100).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value));
const country = z.string().refine(isLabCountryCode);
const currency = z.string().refine(isLabCurrency);
const positiveInteger = z.number().int().min(1).max(1_000_000_000);
const inputMode = z.enum(["individual", "composite"]);
const deliveryMode = z.enum(["pickup", "ship_to_studio", "ship_to_client"]);
const unique = <T>(values: T[]) => new Set(values).size === values.length;
const idList = z.array(identity).min(1).max(100).refine(unique);
const modes = z.array(inputMode).min(1).max(2).refine(unique);
const decimal = z.number().finite().min(0).max(3048).refine(value => Math.round(value * 1000) / 1000 === value);
const size = z.object({ unit: z.enum(["mm", "in"]), width: decimal.refine(v => v > 0), height: decimal.refine(v => v > 0) }).strict()
  .refine(v => v.unit === "mm" || v.width <= 120 && v.height <= 120);
const profileSchema = z.object({
  version: z.literal(1), labId: z.string().uuid(), marketCountryCode: country, revision: positiveInteger,
  location: z.object({ countryCode: country, city: z.string().trim().min(1).max(100).refine(v => !/[\u0000-\u001f\u007f]/.test(v)), timeZone: z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }).format(0); return true; } catch { return false; } }) }).strict(),
  currency, transport: z.object({ kind: z.enum(["manual_download", "windows_helper", "api", "hot_folder"]), state: z.enum(["configured", "unverified"]) }).strict(),
  capabilities: z.object({ inputModes: modes, labCropping: z.boolean(), labColourCorrection: z.boolean(), deliveryModes: z.array(deliveryMode).min(1).max(3).refine(unique), deliveryCountries: z.array(country).max(250).refine(unique) }).strict(),
  products: z.array(z.object({ productId: identity, sku, finishedSize: size, inputModes: modes, paperIds: idList }).strict()).min(1).max(LIMITS.products),
  papers: z.array(z.object({ paperId: identity, size, dpi: z.number().int().min(72).max(1200), colorSpace: z.literal("sRGB") }).strict()).min(1).max(LIMITS.papers),
}).strict().superRefine((profile, context) => {
  if (!unique(profile.products.map(p => p.productId)) || !unique(profile.products.map(p => p.sku)) || !unique(profile.papers.map(p => p.paperId))) context.addIssue({ code: "custom", message: "Product identities, exact SKUs and paper identities must be unique." });
  const papers = new Set(profile.papers.map(p => p.paperId));
  if (profile.products.some(p => p.paperIds.some(id => !papers.has(id)) || p.inputModes.some(mode => !profile.capabilities.inputModes.includes(mode)))) context.addIssue({ code: "custom", message: "Each product must refer to supported paper and input modes." });
});
const requestSchema = z.object({
  labId: z.string().uuid(), marketCountryCode: country, profileRevision: positiveInteger, currency,
  inputMode, labCropping: z.boolean(), labColourCorrection: z.boolean(),
  delivery: z.object({ mode: deliveryMode, countryCode: country }).strict(),
  lines: z.array(z.object({ lineId: identity, productId: identity, sku, finishedSize: size, quantity: z.number().int().min(1).max(1000), sourceAssetId: identity }).strict()).min(1).max(LIMITS.lines),
  outputs: z.array(z.object({ outputId: identity, paperId: identity, dpi: z.number().int().min(72).max(1200), colorSpace: z.literal("sRGB"), copies: z.number().int().min(1).max(1000), cells: z.array(z.object({ lineId: identity, sourceAssetId: identity, x: decimal, y: decimal, unit: z.enum(["mm", "in"]), rotation: z.union([z.literal(0), z.literal(90)]) }).strict()).min(1).max(LIMITS.cellsPerOutput) }).strict()).min(1).max(LIMITS.outputs),
}).strict().superRefine((request, context) => {
  if (!unique(request.lines.map(l => l.lineId)) || !unique(request.outputs.map(o => o.outputId)) || request.outputs.reduce((n, o) => n + o.cells.length, 0) > LIMITS.totalCells) context.addIssue({ code: "custom", message: "Use unique line/output identities and a bounded number of cells." });
});
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function bounded(value: unknown, kind: "profile" | "request") {
  if (!record(value)) return false;
  const first = kind === "profile" ? "products" : "lines", second = kind === "profile" ? "papers" : "outputs";
  if (!Array.isArray(value[first]) || value[first].length > (kind === "profile" ? LIMITS.products : LIMITS.lines) || !Array.isArray(value[second]) || value[second].length > (kind === "profile" ? LIMITS.papers : LIMITS.outputs)) return false;
  if (kind === "profile") {
    const capabilities = value.capabilities;
    if (!record(capabilities) || !Array.isArray(capabilities.inputModes) || capabilities.inputModes.length > 2 || !Array.isArray(capabilities.deliveryModes) || capabilities.deliveryModes.length > 3 || !Array.isArray(capabilities.deliveryCountries) || capabilities.deliveryCountries.length > 250) return false;
    for (const product of value.products as unknown[]) if (!record(product) || !Array.isArray(product.paperIds) || product.paperIds.length > 100 || !Array.isArray(product.inputModes) || product.inputModes.length > 2) return false;
  }
  if (kind === "request") {
    let cells = 0;
    for (const output of value.outputs as unknown[]) { if (!record(output) || !Array.isArray(output.cells) || output.cells.length > LIMITS.cellsPerOutput) return false; cells += output.cells.length; if (cells > LIMITS.totalCells) return false; }
  }
  return true;
}
export function parseFulfillmentProfile(value: unknown): FulfillmentProfile {
  if (!bounded(value, "profile")) throw new TypeError("Use a bounded, complete lab fulfillment profile.");
  return profileSchema.parse(value);
}
export function parseFulfillmentPlanRequest(value: unknown): FulfillmentPlanRequest {
  if (!bounded(value, "request")) throw new TypeError("Use a bounded, complete test planning request.");
  return requestSchema.parse(value);
}
/** At most three supplied decimals, converted to integer nanometres; no size approximation. */
function nm(value: number, unit: "mm" | "in") { return Math.round(value * 1000) * (unit === "mm" ? 1000 : 25400); }
function physical(value: FulfillmentSize) { return { width: nm(value.width, value.unit), height: nm(value.height, value.unit) }; }
function sameSize(a: FulfillmentSize, b: FulfillmentSize) { const x = physical(a), y = physical(b); return x.width === y.width && x.height === y.height; }
function freeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value as DeepReadonly<T>;
}

/** Resolves declared compatibility only. It cannot validate bytes, consent, credentials or a real printer. */
export function resolveFulfillmentCapabilities(profileUnknown: unknown, requestUnknown: unknown): FulfillmentResolution {
  let profile: FulfillmentProfile, request: FulfillmentPlanRequest;
  try { profile = parseFulfillmentProfile(profileUnknown); } catch { return { supported: false, reasons: ["invalid_profile"], plan: null }; }
  try { request = parseFulfillmentPlanRequest(requestUnknown); } catch { return { supported: false, reasons: ["invalid_request"], plan: null }; }
  const reasons = new Set<string>(), fail = (reason: string) => { reasons.add(reason); };
  if (request.labId !== profile.labId || request.marketCountryCode !== profile.marketCountryCode) fail("profile_scope_mismatch");
  if (request.profileRevision !== profile.revision) fail("profile_revision_mismatch");
  if (request.currency !== profile.currency) fail("fx_unsupported");
  if (profile.transport.state !== "configured") fail("transport_unverified");
  // A configured profile is metadata, not an implementation or operational grant.
  // The legacy Windows rehearsal connector remains an independent adapter.
  if (profile.transport.kind !== "manual_download") fail("transport_execution_unsupported");
  if (!profile.capabilities.inputModes.includes(request.inputMode)) fail("input_mode_unsupported");
  if (request.labCropping && !profile.capabilities.labCropping) fail("lab_crop_unsupported");
  if (request.labColourCorrection && !profile.capabilities.labColourCorrection) fail("lab_colour_unsupported");
  if (!profile.capabilities.deliveryModes.includes(request.delivery.mode)) fail("delivery_mode_unsupported");
  if (request.delivery.mode === "pickup") { if (request.delivery.countryCode !== profile.location.countryCode) fail("pickup_country_mismatch"); }
  else if (!profile.capabilities.deliveryCountries.includes(request.delivery.countryCode)) fail("delivery_country_unsupported");
  const products = new Map(profile.products.map(p => [p.productId, p])), papers = new Map(profile.papers.map(p => [p.paperId, p]));
  const lines = new Map(request.lines.map(l => [l.lineId, l])), quantities = new Map(request.lines.map(l => [l.lineId, 0]));
  for (const line of request.lines) {
    const product = products.get(line.productId);
    if (!product) { fail("unknown_product"); continue; }
    if (line.sku !== product.sku) fail("sku_mismatch");
    if (!sameSize(line.finishedSize, product.finishedSize)) fail("finished_size_mismatch");
    if (!product.inputModes.includes(request.inputMode)) fail("product_input_mode_unsupported");
  }
  for (const output of request.outputs) {
    const paper = papers.get(output.paperId);
    if (!paper) { fail("unknown_paper"); continue; }
    if (output.dpi !== paper.dpi || output.colorSpace !== paper.colorSpace) fail("output_spec_mismatch");
    if (request.inputMode === "individual" && output.cells.length !== 1) fail("individual_requires_single_cell");
    const page = physical(paper.size), rectangles: { x: number; y: number; width: number; height: number }[] = [];
    for (const cell of output.cells) {
      const line = lines.get(cell.lineId);
      if (!line) { fail("unknown_line"); continue; }
      if (cell.sourceAssetId !== line.sourceAssetId) fail("source_identity_mismatch");
      const product = products.get(line.productId);
      if (!product?.paperIds.includes(output.paperId)) fail("product_paper_unsupported");
      const finished = physical(line.finishedSize), rect = { x: nm(cell.x, cell.unit), y: nm(cell.y, cell.unit), width: cell.rotation === 90 ? finished.height : finished.width, height: cell.rotation === 90 ? finished.width : finished.height };
      if (rect.x + rect.width > page.width || rect.y + rect.height > page.height) fail("paper_does_not_fit");
      if (rectangles.some(other => rect.x < other.x + other.width && other.x < rect.x + rect.width && rect.y < other.y + other.height && other.y < rect.y + rect.height)) fail("overlapping_cells");
      rectangles.push(rect);
      if (request.inputMode === "individual" && (rect.x !== 0 || rect.y !== 0 || rect.width !== page.width || rect.height !== page.height)) fail("individual_requires_finished_size_paper");
      quantities.set(line.lineId, quantities.get(line.lineId)! + output.copies);
    }
  }
  if (request.lines.some(line => quantities.get(line.lineId) !== line.quantity)) fail("quantity_mismatch");
  if (reasons.size) return { supported: false, reasons: [...reasons], plan: null };
  // Zod has copied every admitted field. Clone again so profile/request/lines
  // are independent of caller objects, then recursively freeze the result.
  const snapshot = structuredClone({ profileVersion: profile.version, labId: profile.labId, marketCountryCode: profile.marketCountryCode, revision: profile.revision, currency: profile.currency, currencyMinorUnits: currencyMinorUnits(profile.currency), profile, request, lines: request.lines, outputs: request.outputs, testOnly: true as const, printAllowed: false as const, paymentAllowed: false as const, operationallyAuthorized: false as const });
  return { supported: true, reasons: [], plan: freeze(snapshot) };
}

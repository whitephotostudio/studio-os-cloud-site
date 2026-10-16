import { createHash } from "node:crypto";
import { z } from "zod";
import { isLabCurrency } from "./money";
import { LabError } from "./validation";
import type { InHousePriceSheetAction } from "./in-house-types";

export const IN_HOUSE_MAX_BODY_BYTES = 2_000_000;
const plainText = (maximum: number) => z.string().trim().min(1).max(maximum).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const id = plainText(200);
const cents = z.number().int().min(0).max(100_000_000);
const record = z.record(z.string(), z.unknown());
const source = z.object({ profileId: id, profileName: plainText(200), contentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const entry = z.object({ id, sourceKey: id, section: z.enum(["individual", "package", "specialty"]), name: plainText(200),
  retailCents: cents, active: z.boolean(), category: z.string().trim().max(100), contents: z.array(z.unknown()).max(1000), original: record,
}).strict();
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("import"), sheet: z.object({ name: plainText(100), studioName: plainText(100), currency: z.string().refine(isLabCurrency), source,
    entries: z.array(entry).min(1).max(1000), warnings: z.array(z.string().max(1000)).max(100),
    tax: z.object({ enabled: z.boolean(), percent: z.number().min(0).max(100), label: z.string().trim().max(100) }).strict(), sourceSnapshot: record,
  }).strict() }).strict(),
  z.object({ action: z.literal("save"), id: z.string().uuid(), expectedVersion: z.number().int().min(1).max(2_000_000_000), name: plainText(100),
    entries: z.array(z.object({ id, retailCents: cents, active: z.boolean() }).strict()).min(1).max(1000),
  }).strict(),
]);

/** Imported opaque settings must still be bounded JSON, never executable/prototype state. */
function assertSafeJson(value: unknown, depth = 0, budget = { remaining: 100_000 }): void {
  if (depth > 24 || --budget.remaining < 0) throw new LabError("This studio price sheet contains too much nested data.");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value === "string" && value.length <= 100_000 && !value.includes("\u0000")) return;
  if (Array.isArray(value)) { for (const item of value) assertSafeJson(item, depth + 1, budget); return; }
  if (typeof value === "object" && value && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, item] of Object.entries(value)) {
      if (key.length > 200 || ["__proto__", "prototype", "constructor"].includes(key)) throw new LabError("This studio price sheet contains an unsupported setting key.");
      assertSafeJson(item, depth + 1, budget);
    }
    return;
  }
  throw new LabError("Use a complete JSON copy of the studio price sheet.");
}

/** Stable across object-key ordering; array ordering and all saved values remain significant. */
export function canonicalInHouseSource(value: Record<string, unknown>): string {
  assertSafeJson(value);
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical) : item && typeof item === "object"
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical((item as Record<string, unknown>)[key])])) : item;
  return JSON.stringify(canonical(value));
}

export function inHouseSourceHash(value: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalInHouseSource(value)).digest("hex");
}

export function parseInHousePriceSheetAction(value: unknown): InHousePriceSheetAction {
  assertSafeJson(value);
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > IN_HOUSE_MAX_BODY_BYTES) throw new LabError("This studio price sheet is too large.", 413, "IN_HOUSE_TOO_LARGE");
  const parsed = actionSchema.safeParse(value);
  if (!parsed.success) throw new LabError("Check the studio price sheet, exact retail prices and imported contents.", 400, "IN_HOUSE_INVALID");
  const result = parsed.data;
  const entries = result.action === "import" ? result.sheet.entries : result.entries;
  if (new Set(entries.map(item => item.id)).size !== entries.length) throw new LabError("Each studio price item must have a unique identifier.", 400, "IN_HOUSE_INVALID");
  if (result.action === "import") {
    if (new Set(result.sheet.entries.map(item => item.sourceKey)).size !== result.sheet.entries.length) throw new LabError("Each imported studio item needs a unique source key.", 400, "IN_HOUSE_INVALID");
    const contentHash = inHouseSourceHash(result.sheet.sourceSnapshot);
    if (contentHash !== result.sheet.source.contentHash) throw new LabError("The source price sheet changed. Create a fresh copy before importing.", 409, "IN_HOUSE_SOURCE_CHANGED");
    result.sheet.source.contentHash = contentHash;
  }
  return result;
}

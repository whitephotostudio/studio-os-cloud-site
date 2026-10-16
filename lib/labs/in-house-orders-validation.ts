import { createHash } from "node:crypto";
import { z } from "zod";
import { LabError } from "./validation";
import type { InHousePriceSheetEntry } from "./in-house-types";
import type { InHouseTestOffer, InHouseTestOwnerAction, InHouseTestParentAction, InHouseTestStatus } from "./in-house-orders-types";

export const IN_HOUSE_TEST_BODY_BYTES = 16_000;
export const IN_HOUSE_TEST_PHOTO_ID = "studio-os-inhouse-demo-v1" as const;
export const IN_HOUSE_TEST_STATUSES = ["submitted", "accepted", "in_production", "ready", "completed"] as const;
const uuid = z.string().uuid();
const version = z.number().int().min(1).max(2_000_000_000);
const token = z.string().regex(/^[a-f0-9]{64}$/);
const text = (max: number) => z.string().trim().min(1).max(max).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const ownerActions = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_gallery"), requestId: uuid, sheetId: uuid, expectedSheetVersion: version, entryId: text(200), name: text(100), accessToken: token }).strict(),
  z.object({ action: z.literal("rotate_gallery"), galleryId: uuid, expectedVersion: version, accessToken: token }).strict(),
  z.object({ action: z.literal("revoke_gallery"), galleryId: uuid, expectedVersion: version }).strict(),
  z.object({ action: z.literal("transition"), orderId: uuid, expectedVersion: version, requestId: uuid, status: z.enum(["accepted", "in_production", "ready", "completed"]) }).strict(),
]);
const parentActions = z.discriminatedUnion("action", [
  z.object({ action: z.literal("gallery"), galleryId: uuid, accessToken: token }).strict(),
  z.object({ action: z.literal("submit"), galleryId: uuid, accessToken: token, requestId: uuid, receiptToken: token, offerId: text(200), photoId: z.literal(IN_HOUSE_TEST_PHOTO_ID), quantity: z.number().int().min(1).max(10) }).strict(),
  z.object({ action: z.literal("receipt"), receiptToken: token }).strict(),
]);
export function parseInHouseTestOwnerAction(value: unknown): InHouseTestOwnerAction {
  const result = ownerActions.safeParse(value);
  if (!result.success) throw new LabError("Check the private test gallery, copied package and latest saved version.", 400, "IN_HOUSE_TEST_INVALID");
  return result.data;
}
export function parseInHouseTestParentAction(value: unknown): InHouseTestParentAction {
  const result = parentActions.safeParse(value);
  if (!result.success) throw new LabError("Check the test gallery link, sample package and quantity.", 400, "IN_HOUSE_TEST_INVALID");
  return result.data;
}
export function inHouseTestTokenHash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
/** The first rehearsal offers only this explicitly recorded, unambiguous print package. */
export function eligibleInHouseTestOffer(entry: InHousePriceSheetEntry): InHouseTestOffer | null {
  if (!entry.active || entry.section !== "package" || !Number.isSafeInteger(entry.retailCents) || entry.retailCents < 1 || entry.retailCents > 100_000_000 || entry.contents.length !== 2) return null;
  const expected = new Map<string, number>([["8x10 Lustre", 1], ["5x7 Lustre", 2]]);
  for (const item of entry.contents) {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).sort().join(",") !== "name,qty") return null;
    const row = item as { name: string; qty: number };
    if (expected.get(row.name) !== row.qty) return null;
    expected.delete(row.name);
  }
  return expected.size ? null : { id: entry.id, name: entry.name, retailCents: entry.retailCents, contents: [{ name: "8x10 Lustre", qty: 1 }, { name: "5x7 Lustre", qty: 2 }] };
}
export function nextInHouseTestStatus(status: InHouseTestStatus): Exclude<InHouseTestStatus, "submitted"> | null {
  switch (status) { case "submitted": return "accepted"; case "accepted": return "in_production"; case "in_production": return "ready"; case "ready": return "completed"; default: return null; }
}

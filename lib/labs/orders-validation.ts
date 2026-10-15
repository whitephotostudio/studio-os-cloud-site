import { z } from "zod";
import type { LabOrderAction, LabOrderDelivery, LabOrderStatus } from "./orders-types";
import { LabError } from "./validation";

export const LAB_ORDER_MAX_FILE_BYTES = 4_000_000;
export const LAB_ORDER_MAX_IMAGE_PIXELS = 100_000_000;
export const LAB_ORDER_MAX_LINES = 50;
export const LAB_ORDER_MAX_QUANTITY = 100;
export const LAB_ORDER_ASPECT_TOLERANCE = 0.02;
export const LAB_ORDER_STATUSES = ["submitted", "accepted", "declined", "cancelled", "in_production", "ready", "shipped", "completed"] as const;
const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().max(max).refine(value => !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value));
const delivery = z.object({ mode: z.enum(["pickup", "ship_to_studio"]), name: z.string().trim().min(1).max(200).refine(value => !/[\x00-\x1f]/.test(value)), address: text(1000) }).strict();
const actions = z.discriminatedUnion("action", [
  z.object({ action: z.literal("submit"), requestId: uuid, labId: uuid, reference: z.string().trim().min(1).max(120).refine(value => !/[\x00-\x1f]/.test(value)), notes: text(2000), delivery,
    items: z.array(z.object({ catalogProductId: uuid, assetId: uuid, quantity: z.number().int().min(1).max(LAB_ORDER_MAX_QUANTITY) }).strict()).min(1).max(LAB_ORDER_MAX_LINES),
  }).strict(),
  z.object({ action: z.literal("transition"), orderId: uuid, expectedVersion: z.number().int().min(1), requestId: uuid,
    status: z.enum(LAB_ORDER_STATUSES), reason: text(2000), carrier: text(100), trackingNumber: text(200),
  }).strict(),
]);

export function parseLabOrderAction(value: unknown): LabOrderAction {
  const parsed = actions.safeParse(value);
  if (!parsed.success) throw new LabError("Check the lab order, uploaded files, quantities and delivery details.", 400, "LAB_ORDER_INVALID");
  const result = parsed.data;
  if (result.action === "submit") {
    if (result.delivery.mode === "ship_to_studio" && !result.delivery.address) throw new LabError("Enter the studio delivery address.", 400, "LAB_ORDER_ADDRESS_REQUIRED");
    const pairs = result.items.map(item => `${item.catalogProductId}:${item.assetId}`);
    if (new Set(pairs).size !== pairs.length) throw new LabError("Combine repeated product and photo lines by adjusting their quantity.", 400, "LAB_ORDER_DUPLICATE_LINE");
  } else {
    if (result.status === "declined" && !result.reason) throw new LabError("Enter a reason for declining this order.", 400, "LAB_ORDER_REASON_REQUIRED");
    if (result.status === "shipped" && (!result.carrier || !result.trackingNumber)) throw new LabError("Enter the carrier and tracking number.", 400, "LAB_ORDER_TRACKING_REQUIRED");
  }
  return result;
}

export function labOrderAspectMatches(widthPixels: number, heightPixels: number, widthInches: number, heightInches: number) {
  if (![widthPixels, heightPixels, widthInches, heightInches].every(value => Number.isFinite(value) && value > 0)) return false;
  const image = widthPixels / heightPixels, print = widthInches / heightInches;
  const tolerance = LAB_ORDER_ASPECT_TOLERANCE + 1e-9; // Match exact SQL numeric boundaries despite binary float noise.
  return Math.abs(image / print - 1) <= tolerance || Math.abs(image * print - 1) <= tolerance;
}

export function allowedLabOrderTransitions(status: LabOrderStatus, delivery: LabOrderDelivery["mode"], role: "studio" | "owner" | "operator" | "viewer"): LabOrderStatus[] {
  if (role === "studio") return status === "submitted" ? ["cancelled"] : [];
  if (role === "viewer") return [];
  switch (status) {
    case "submitted": return ["accepted", "declined"];
    case "accepted": return ["in_production"];
    case "in_production": return ["ready"];
    case "ready": return [delivery === "pickup" ? "completed" : "shipped"];
    case "shipped": return ["completed"];
    default: return [];
  }
}

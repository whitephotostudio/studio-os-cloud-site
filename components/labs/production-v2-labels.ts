import type { ProductionV2SlotId } from "@/lib/labs/production-v2-types";
export const productionV2SlotLabel = (slotId: ProductionV2SlotId): string => ({ "8x10": "8×10", "5x7-a": "5×7 A", "5x7-b": "5×7 B" })[slotId];
export function productionV2HoldLabel(hold: string): string {
  if (hold === "photographer_approval") return "Photographer approval is needed.";
  for (const slotId of ["8x10", "5x7-a", "5x7-b"] as const) {
    const label = productionV2SlotLabel(slotId);
    if (hold === `crop_${slotId}`) return `Review and approve the ${label} crop.`;
    if (hold === `colour_${slotId}`) return `Complete ${label} lab colour review.`;
    if (hold === `final_review_${slotId}`) return `Review the ${label} final print file.`;
  }
  return "Review the pending production checks.";
}

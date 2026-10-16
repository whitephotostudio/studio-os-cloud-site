export function productionHoldLabel(hold: string): string {
  if (hold === "photographer_approval") return "Photographer approval is needed.";
  const size = hold.endsWith("8x10") ? "8×10" : hold.endsWith("5x7") ? "5×7" : "print";
  if (hold.startsWith("crop_")) return `Review and approve the ${size} crop.`;
  if (hold.startsWith("colour_")) return `The lab needs to complete ${size} colour review.`;
  if (hold.startsWith("final_review_")) return `The ${size} final print file needs review.`;
  return "Review the pending production checks.";
}
export function productionEventLabel(action: string): string {
  const labels: Record<string, string> = { submitted: "Order submitted", submitted_auto_approved: "Order submitted · photographer approval automatic", approve_order: "Photographer approved the order", accept: "Job accepted for review", save_crop: "Cropped print file generated", crop_saved: "Cropped print file generated", approve_crop: "Print crop approved", complete_colour: "Lab colour correction saved", reviewed_no_colour_change: "Lab colour reviewed · no change needed", final_review: "Final print file reviewed", transition: "Order status updated", in_production: "Production preparation started", ready: "Order marked ready", completed: "Order completed" };
  return labels[action] || "Production record updated";
}

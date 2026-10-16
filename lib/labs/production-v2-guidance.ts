import type { ProductionV2Job, ProductionV2Slot, ProductionV2SlotId } from "./production-v2-types";

const ids: ProductionV2SlotId[] = ["8x10", "5x7-a", "5x7-b"];
const label = (id: ProductionV2SlotId) => ({ "8x10": "8×10", "5x7-a": "5×7 A", "5x7-b": "5×7 B" })[id];
export type ProductionV2PrintStage = "crop" | "approve_crop" | "colour" | "final_review" | "done";
export type ProductionV2Guidance = {
  kind: "approve_order" | "accept" | ProductionV2PrintStage | "prepare" | "handoff" | "ready" | "complete" | "waiting" | "blocked";
  title: string; description: string; slotId?: ProductionV2SlotId;
};

/** Display abbreviation only. Requests, receipts and file names retain the full reference. */
export function productionV2ShortReference(reference: string): string {
  const clean = reference.replace(/^PROOF2-/, "");
  return clean.length > 12 ? `Order · ${clean.slice(-8).toUpperCase()}` : `Order · ${clean}`;
}

export function productionV2PrintStage(job: Pick<ProductionV2Job, "policy">, slot: ProductionV2Slot): ProductionV2PrintStage {
  if (!slot.cropAsset) return "crop";
  if (!slot.cropApproved) return "approve_crop";
  if (job.policy.labColourCorrection && (!slot.colourCompletedAt || !slot.colourAsset)) return "colour";
  const expected = job.policy.labColourCorrection ? slot.colourAsset : slot.cropAsset;
  if (!slot.finalReviewedAt || !slot.finalAsset || slot.finalAsset.id !== expected?.id) return "final_review";
  return "done";
}

export function productionV2ReviewComplete(job: ProductionV2Job): boolean {
  return job.photographerApproved && job.holds.length === 0 && job.slots.length === ids.length &&
    ids.every(id => job.slots.filter(slot => slot.id === id).length === 1) &&
    job.slots.every(slot => productionV2PrintStage(job, slot) === "done");
}

/** Guidance never grants permission or marks a print as approved. The server remains authoritative. */
export function productionV2NextStep(job: ProductionV2Job): ProductionV2Guidance {
  if (job.status === "completed") return { kind: "done", title: "Test order completed", description: "The saved test history is available below. This does not confirm physical printing." };
  if (job.dispatchState === "claimed") return { kind: "waiting", title: "Waiting for Windows receipt", description: "The reviewed files are locked for handoff. Open the Windows helper and check for orders, then refresh here. Files have not been confirmed received yet." };
  if (job.dispatchState === "printed") return { kind: "blocked", title: "Check the recorded handoff", description: "This pilot does not confirm physical printing. Review the order details with your lab before continuing." };
  if (job.dispatchState === "handed_off") {
    if (!productionV2ReviewComplete(job)) return { kind: "blocked", title: "Check the recorded handoff", description: "A required review is missing from this record. Refresh and check the saved order details before continuing." };
    if (job.status === "in_production" && job.canReceive) return { kind: "ready", title: "Files received on Windows", description: "The helper confirmed the reviewed files in its private folder. Check those files before marking this test job ready. This has not printed anything." };
    if (job.status === "ready" && job.canReceive) return { kind: "complete", title: "Finish this test order", description: "Confirm the test handoff has been reviewed. No payment or physical print is created." };
    return { kind: "waiting", title: "Files received on Windows", description: "The lab is reviewing the received test files. Physical printing remains disabled." };
  }
  if (job.status === "ready" && !productionV2ReviewComplete(job)) return { kind: "blocked", title: "An order check is still pending", description: "Refresh and check the saved reviews before completing this test order." };
  if (job.status === "ready") return job.canReceive
    ? { kind: "complete", title: "Finish this test order", description: "Confirm the lab has finished reviewing this test order. Physical printing remains disabled." }
    : { kind: "waiting", title: "Test order ready at the lab", description: "The lab will update the status when its review is finished." };
  if (job.status === "submitted" && job.canReceive) return { kind: "accept", title: "Accept this order for review", description: "Check the destination and package, then accept. Cropping, colour and final checks still follow." };
  if (!job.photographerApproved && job.status === "in_production") return { kind: "blocked", title: "An order check is still pending", description: "Photographer approval is missing from this saved production record. Refresh and check its history before continuing." };
  if (!job.photographerApproved) return job.canApproveOrder
    ? { kind: "approve_order", title: "Approve this order", description: "Confirm the three photo choices and package. This approval does not approve crops or send anything to a printer." }
    : { kind: "waiting", title: "Waiting for the photographer", description: "The photographer must approve this order. You can see the selected photos below." };
  if (job.slots.length !== 3 || !ids.every(id => job.slots.filter(slot => slot.id === id).length === 1)) return { kind: "blocked", title: "Print choices need attention", description: "The order must contain one 8×10, 5×7 A and 5×7 B. Refresh the order before continuing." };
  if (job.status === "in_production") return productionV2ReviewComplete(job) && job.canReceive
    ? { kind: "handoff", title: "Send reviewed files to Windows", description: "One 8×10 file and one 10×7 sheet containing A + B will go to the helper’s private review folder. No physical printing." }
    : { kind: "waiting", title: "The lab is preparing this order", description: "The lab controls the next handoff. Refresh to see its latest update." };
  let waiting: ProductionV2Guidance | undefined;
  for (const slot of job.slots) {
    const stage = productionV2PrintStage(job, slot);
    if (stage === "done") continue;
    if (stage === "crop" || stage === "approve_crop") {
      if (job.canCrop) return { kind: stage, slotId: slot.id, title: stage === "crop" ? `Crop ${label(slot.id)}` : `Check the saved ${label(slot.id)} crop`, description: "Open this print below. Keep faces and important details inside the print edge. Only this print’s checks are affected." };
      waiting ??= { kind: "waiting", slotId: slot.id, title: `Waiting for ${job.policy.cropResponsibility === "lab" ? "lab" : "photographer"} cropping`, description: `${label(slot.id)} needs its own approved crop. The assigned reviewer will complete it.` };
      continue;
    }
    if (job.status !== "accepted" || !job.canReceive) { waiting ??= { kind: "waiting", slotId: slot.id, title: job.status === "submitted" ? "Waiting for lab acceptance" : "Waiting for the lab’s print review", description: "The lab handles the remaining colour and final-file checks. Each print keeps its own saved work." }; continue; }
    return { kind: stage, slotId: slot.id, title: stage === "colour" ? `Review ${label(slot.id)} colour` : `Approve the final ${label(slot.id)}`, description: stage === "colour" ? "Use your existing photo editor if a correction is needed, or explicitly confirm that the colour needs no change." : "Look at the saved final file below before approving this print." };
  }
  if (waiting) return waiting;
  if (!productionV2ReviewComplete(job)) return { kind: "blocked", title: "An order check is still pending", description: "Open the pending checks below or refresh. Files cannot be handed off until every required check is complete." };
  return job.status === "accepted" && job.canReceive
    ? { kind: "prepare", title: "All three prints are reviewed", description: "Start preparing the two paper files. The two 5×7 photos are combined only after their separate reviews." }
    : { kind: "waiting", title: "Waiting for the lab", description: "Your photo work is saved. The lab will accept the order and complete its review." };
}

import "server-only";
import type { ProductionAccess } from "./production-server";
import type { ProductionV2Job } from "./production-v2-types";
import { loadProductionV2Asset, loadProductionV2Job } from "./production-v2-server";
import { productionV2Bytes } from "./production-v2-image-server";
import { packProductionDistinctPair, productionHash, productionJpegDensity, verifyProductionFinal } from "./production-renderer";
import { LabError } from "./validation";

export function requireProductionV2Ready(job: ProductionV2Job) {
  const ids = new Set(job.slots.map(s => s.id));
  if (job.holds.length || !["accepted", "in_production", "ready", "completed"].includes(job.status) || !job.photographerApproved ||
    ids.size !== 3 || !["8x10", "5x7-a", "5x7-b"].every(id => ids.has(id as never)) || job.slots.some(s =>
      !s.cropApproved || !s.cropAsset || !s.finalAsset || !s.finalReviewedAt || (job.policy.labColourCorrection && (!s.colourAsset || !s.colourCompletedAt)))) {
    throw new LabError("Approve the order, all three crops, requested colour work and each final print before preparing paper files.", 409, "PRODUCTION_HELD");
  }
}

export async function prepareProductionV2Files(access: ProductionAccess, id: string) {
  const job = await loadProductionV2Job(access, id);
  requireProductionV2Ready(job);
  const finals = await Promise.all(job.slots.map(async slot => {
    const asset = await loadProductionV2Asset(access, slot.finalAsset!.id), bytes = await productionV2Bytes(access.service, asset);
    await verifyProductionFinal(bytes, asset, slot.size);
    return { slot, asset, bytes };
  }));
  const single = finals.find(f => f.slot.id === "8x10")!, left = finals.find(f => f.slot.id === "5x7-a")!, right = finals.find(f => f.slot.id === "5x7-b")!;
  const sheets = [
    { size: "8x10", widthPixels: 2400, heightPixels: 3000, copies: job.quantity, printsPerSheet: 1, slots: ["8x10"], bytes: productionJpegDensity(single.bytes) },
    { size: "10x7", widthPixels: 3000, heightPixels: 2100, copies: job.quantity, printsPerSheet: 2, slots: ["5x7-a", "5x7-b"], bytes: await packProductionDistinctPair(left, right) },
  ];
  const manifest = { schemaVersion: 2, reference: job.reference, jobId: job.id, version: job.version, reprintOf: job.reprintOf,
    testOnly: true as const, payment: "test_no_payment" as const, printAllowed: false as const,
    outputProfile: "sRGB", densityPpi: 300, quantity: job.quantity, finishedPrints: job.quantity * 3, paperSheets: job.quantity * 2,
    reviews: finals.map(f => ({ slotId: f.slot.id, sourceSha256: f.slot.source.sha256, cropSha256: f.slot.cropAsset!.sha256,
      finalSha256: f.asset.sha256, cropApprovedAt: f.slot.cropApprovedAt, colourCompletedAt: f.slot.colourCompletedAt, finalReviewedAt: f.slot.finalReviewedAt })),
    sheets: sheets.map(({ bytes, ...s }) => ({ ...s, filename: `${job.reference}-${s.size}.jpg`, byteSize: bytes.length, sha256: productionHash(bytes) })) };
  if ((await loadProductionV2Job(access, id)).version !== job.version) throw new LabError("The job changed while preparing its paper files. Refresh and review again.", 409, "PRODUCTION_VERSION_CONFLICT");
  return { job, manifest, files: new Map([
    ["manifest", Buffer.from(JSON.stringify(manifest, null, 2))], ["8x10", sheets[0].bytes], ["10x7", sheets[1].bytes],
    ["5x7-a", left.bytes], ["5x7-b", right.bytes],
  ]) };
}

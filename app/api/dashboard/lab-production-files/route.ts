import { NextRequest } from "next/server";
import { z } from "zod";
import { isLabPilot } from "@/lib/labs/pilot";
import { loadProductionAsset, loadProductionJob, productionAccess } from "@/lib/labs/production-server";
import { productionBytes, productionImageFailure, productionPrivateHeaders } from "@/lib/labs/production-image-server";
import { packProductionPair, productionHash, productionJpegDensity, requireProductionReady, verifyProductionFinal } from "@/lib/labs/production-renderer";
import { LabError } from "@/lib/labs/validation";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    if (!isLabPilot()) throw new LabError("This production rehearsal is not enabled here.", 404);
    const id = z.string().uuid().parse(request.nextUrl.searchParams.get("jobId")), file = z.enum(["manifest", "8x10", "10x7"]).parse(request.nextUrl.searchParams.get("file"));
    const access = await productionAccess(request, request.nextUrl.searchParams.get("audience") === "lab" ? "lab" : "studio"), job = await loadProductionJob(access, id);
    requireProductionReady(job);
    const finals = await Promise.all(job.lines.map(async line => {
      const asset = await loadProductionAsset(access, line.finalAsset!.id), bytes = await productionBytes(access.service, asset);
      await verifyProductionFinal(bytes, asset, line.size); return { line, asset, bytes };
    }));
    const single = finals.find(f => f.line.size === "8x10")!, pair = finals.find(f => f.line.size === "5x7")!;
    const sheets = [{ size: "8x10", widthPixels: 2400, heightPixels: 3000, copies: job.quantity, printsPerSheet: 1, bytes: productionJpegDensity(single.bytes) },
      { size: "10x7", widthPixels: 3000, heightPixels: 2100, copies: job.quantity, printsPerSheet: 2, bytes: await packProductionPair(pair.bytes, pair.asset) }];
    const manifest = { schemaVersion: 1, reference: job.reference, jobId: job.id, version: job.version, policy: job.policy, status: job.status,
      testOnly: true, payment: "test_no_payment", printAllowed: false, outputProfile: "sRGB", densityPpi: 300,
      sourceSha256: job.source.sha256, finishedPrints: job.quantity * 3, paperSheets: job.quantity * 2,
      reviews: finals.map(f => ({ size: f.line.size, cropSha256: f.line.cropAsset!.sha256, finalSha256: f.asset.sha256,
        cropApprovedAt: f.line.cropApprovedAt, colourCompletedAt: f.line.colourCompletedAt, finalReviewedAt: f.line.finalReviewedAt })),
      sheets: sheets.map(({ bytes, ...s }) => ({ ...s, filename: `${job.reference}-${s.size}.jpg`, byteSize: bytes.length, sha256: productionHash(bytes) })) };
    if ((await loadProductionJob(access, id)).version !== job.version) throw new LabError("This job changed while preparing its files. Refresh and download again.", 409, "PRODUCTION_VERSION_CONFLICT");
    const output = file === "manifest" ? Buffer.from(JSON.stringify(manifest, null, 2)) : sheets.find(s => s.size === file)!.bytes;
    return new Response(new Uint8Array(output), { headers: { ...productionPrivateHeaders, "Content-Type": file === "manifest" ? "application/json" : "image/jpeg",
      "Content-Disposition": `attachment; filename="${job.reference}-${file}.${file === "manifest" ? "json" : "jpg"}"` } });
  } catch (error) { return productionImageFailure(error); }
}

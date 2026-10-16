import { NextRequest } from "next/server";
import { z } from "zod";
import { isLabPilot } from "@/lib/labs/pilot";
import { productionAccess, loadProductionAsset } from "@/lib/labs/production-server";
import { productionBytes, productionImageFailure, productionPreview, productionPrivateHeaders, uploadProductionAsset } from "@/lib/labs/production-image-server";
import { PRODUCTION_MAX_BYTES } from "@/lib/labs/production-renderer";
import { readBoundedLabBody } from "@/lib/labs/orders-http";
import { requireLabOrderAgreement } from "@/lib/labs/orders-server";
import { LabError } from "@/lib/labs/validation";
import { rateLimit } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function pilot() { if (!isLabPilot()) throw new LabError("This production rehearsal is not enabled here.", 404, "PRODUCTION_NOT_FOUND"); }
const audience = (value: unknown) => value === "lab" ? "lab" as const : "studio" as const;
export async function GET(request: NextRequest) {
  try {
    pilot(); const id = z.string().uuid().parse(request.nextUrl.searchParams.get("assetId"));
    const access = await productionAccess(request, audience(request.nextUrl.searchParams.get("audience"))), asset = await loadProductionAsset(access, id);
    const preview = request.nextUrl.searchParams.get("preview") === "1";
    const bytes = preview ? await productionPreview(access.service, asset) : await productionBytes(access.service, asset);
    return new Response(new Uint8Array(bytes), { headers: { ...productionPrivateHeaders, "Content-Type": preview ? "image/jpeg" : asset.contentType,
      "Content-Disposition": `${preview ? "inline" : "attachment"}; filename="${preview ? "preview.jpg" : `${asset.id}.${asset.contentType === "image/png" ? "png" : "jpg"}`}"` } });
  } catch (error) { return productionImageFailure(error); }
}
export async function POST(request: NextRequest) {
  try {
    pilot();
    const type = request.headers.get("content-type") || "";
    if (!/^multipart\/form-data\s*;/i.test(type)) throw new LabError("Choose a JPEG or PNG file.", 400);
    const body = await readBoundedLabBody(request, PRODUCTION_MAX_BYTES + 250_000);
    let form: FormData;
    try { form = await new Response(new Uint8Array(body), { headers: { "Content-Type": type } }).formData(); }
    catch { throw new LabError("This image upload could not be read.", 400); }
    if (Array.from(form.keys()).some(k => !["file", "kind", "audience", "jobId", "productSize", "sourceAssetId"].includes(k))) throw new LabError("Unsupported production upload fields.", 400);
    if (new Set(form.keys()).size !== Array.from(form.keys()).length) throw new LabError("Use one value for each production upload field.", 400);
    const access = await productionAccess(request, audience(form.get("audience")));
    if (access.audience === "studio") await requireLabOrderAgreement(access);
    const quota = await rateLimit(access.userId, { namespace: "lab-production-upload", limit: 30, windowSeconds: 60, failClosed: true });
    if (!quota.allowed) throw new LabError("Please wait before uploading more production files.", quota.unavailable ? 503 : 429);
    const file = form.get("file"), kind = form.get("kind");
    if (!(file instanceof File) || (kind !== "original" && kind !== "corrected")) throw new LabError("Choose the original or corrected photograph.", 400);
    if (file.size > PRODUCTION_MAX_BYTES) throw new LabError("Choose a JPEG or PNG up to 4 MB.", 413);
    const jobId = kind === "corrected" ? z.string().uuid().parse(form.get("jobId")) : undefined;
    const size = kind === "corrected" ? z.enum(["8x10", "5x7"]).parse(form.get("productSize")) : undefined;
    const reviewedCropId = kind === "corrected" ? z.string().uuid().parse(form.get("sourceAssetId")) : undefined;
    const asset = await uploadProductionAsset(access, file, kind, jobId, size, reviewedCropId);
    return Response.json({ ok: true, asset }, { headers: productionPrivateHeaders });
  } catch (error) { return productionImageFailure(error); }
}

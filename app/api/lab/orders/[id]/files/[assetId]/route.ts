import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { LAB_ORDER_BUCKET, labOrderAccess, readLabOrder, type LabOrderAccess } from "@/lib/labs/orders-server";
import { labOrderFailure } from "@/lib/labs/orders-http";
import { LAB_ORDER_MAX_FILE_BYTES } from "@/lib/labs/orders-validation";
import { LabError } from "@/lib/labs/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const { id, assetId } = await context.params;
    if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(assetId).success) throw new LabError("Choose an available production file.", 404);
    let access: LabOrderAccess;
    // A regular photographer may download its own submitted originals. Lab
    // recipients additionally need enrolled MFA and a current lab membership.
    if (request.nextUrl.searchParams.get("audience") === "studio") access = await labOrderAccess(request, "studio");
    else access = await labOrderAccess(request, "lab");
    const order = await readLabOrder(access, id);
    const asset = order.snapshot.items.find(item => item.asset.id === assetId)?.asset;
    if (!asset) throw new LabError("This file is not part of the submitted order.", 404, "LAB_ORDER_FILE_NOT_FOUND");
    const bucket = await access.service.storage.getBucket(LAB_ORDER_BUCKET);
    if (bucket.error || bucket.data?.public !== false) throw new LabError("Private production-file storage is temporarily unavailable.", 503);
    const downloaded = await access.service.storage.from(LAB_ORDER_BUCKET).download(asset.storageKey);
    if (downloaded.error || !downloaded.data) throw new LabError("This production file is temporarily unavailable. Try again shortly.", 503);
    if (downloaded.data.size !== asset.byteSize || downloaded.data.size > LAB_ORDER_MAX_FILE_BYTES) throw new LabError("This file no longer matches the submitted original. Contact the studio before producing it.", 409, "LAB_ORDER_FILE_CHANGED");
    const bytes = Buffer.from(await downloaded.data.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new LabError("This file no longer matches the submitted original. Contact the studio before producing it.", 409, "LAB_ORDER_FILE_CHANGED");
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": asset.contentType, "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="production.${asset.contentType === "image/png" ? "png" : "jpg"}"; filename*=UTF-8''${encodeURIComponent(asset.filename).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return labOrderFailure(error); }
}

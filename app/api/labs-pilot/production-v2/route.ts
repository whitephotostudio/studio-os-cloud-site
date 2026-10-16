import { NextRequest, NextResponse } from "next/server";
import { isLabPilot } from "@/lib/labs/pilot";
import { performProductionV2ParentAction, productionV2DatabaseError } from "@/lib/labs/production-v2-server";
import { productionParentAccess } from "@/lib/labs/production-server";
import { productionImageFailure, productionPreview, productionPrivateHeaders } from "@/lib/labs/production-image-server";
import { inHouseTestTokenHash } from "@/lib/labs/in-house-orders-validation";
import { parseProductionV2ParentAction } from "@/lib/labs/production-v2-validation";
import { PRODUCTION_BODY_BYTES } from "@/lib/labs/production-validation";
import { readBoundedLabBody } from "@/lib/labs/orders-http";
import { LabError } from "@/lib/labs/validation";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  if (!isLabPilot()) return NextResponse.json({ ok: false }, { status: 404, headers: productionPrivateHeaders });
  try {
    const bytes = await readBoundedLabBody(request, PRODUCTION_BODY_BYTES);
    let body: unknown; try { body = JSON.parse(bytes.toString("utf8")); } catch { throw new LabError("Use a complete private gallery request.", 400, "PRODUCTION_INVALID"); }
    const action = parseProductionV2ParentAction(body);
    if (action.action === "photo") {
      const service = await productionParentAccess(request), result = await service.rpc("read_lab_production_photo", { p_gallery_id: action.galleryId, p_token_hash: inHouseTestTokenHash(action.accessToken), p_photo_id: action.photoId });
      if (result.error) productionV2DatabaseError(result.error);
      const preview = await productionPreview(service, result.data);
      return new Response(new Uint8Array(preview), { headers: { ...productionPrivateHeaders, "Content-Type": "image/jpeg", "Content-Disposition": "inline; filename=preview.jpg" } });
    }
    return NextResponse.json({ ok: true, ...await performProductionV2ParentAction(request, action) }, { headers: productionPrivateHeaders });
  } catch (error) { return productionImageFailure(error); }
}

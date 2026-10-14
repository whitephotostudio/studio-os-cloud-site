import { NextRequest, NextResponse } from "next/server";
import { CollageAccessError, COLLAGE_UUID, collageDashboardAccess, collageVersionFields, collageVersionForPreview, storedCollageVersion, type CollageVersionRow } from "@/lib/collage-server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: { params: Promise<{ versionId: string }> }) {
  try {
    const { service, photographerId } = await collageDashboardAccess(request);
    const { versionId } = await context.params;
    if (!COLLAGE_UUID.test(versionId)) throw new CollageAccessError("Invalid collage version.");
    const result = await service.from("collage_template_versions").select(collageVersionFields).eq("id", versionId).eq("photographer_id", photographerId).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new CollageAccessError("Collage version not found.", 404);
    return NextResponse.json({ ok: true, preview: true, version: await collageVersionForPreview(storedCollageVersion(result.data as CollageVersionRow)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof CollageAccessError ? error.message : "This saved collage is temporarily unavailable." }, { status: error instanceof CollageAccessError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } });
  }
}

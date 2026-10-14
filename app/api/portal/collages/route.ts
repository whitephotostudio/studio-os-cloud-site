import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { assertParentSessionScope, resolveParentGallerySession, ParentGallerySessionError } from "@/lib/parent-gallery-session";
import { CollageAccessError, COLLAGE_UUID, resolveCollageVersions, collageVersionForPreview } from "@/lib/collage-server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const scope = await resolveParentGallerySession(request, request.nextUrl.searchParams.get("parentLaneId") || "");
    assertParentSessionScope(request, scope);
    const versionIds = (request.nextUrl.searchParams.get("versionIds") || "").split(",").filter(Boolean);
    if (!versionIds.length || versionIds.length > 20 || versionIds.some(id => !COLLAGE_UUID.test(id))) throw new CollageAccessError("Choose valid collage versions.");
    const versions = await resolveCollageVersions(createDashboardServiceClient(), scope.photographerId, scope.kind === "school" ? { schoolId: scope.galleryId } : { projectId: scope.galleryId }, versionIds);
    return NextResponse.json({ ok: true, preview: true, versions: await Promise.all([...versions.values()].map(collageVersionForPreview)) }, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    const known = error instanceof CollageAccessError || error instanceof ParentGallerySessionError;
    return NextResponse.json({ ok: false, message: known ? error.message : "Collage designs are temporarily unavailable." }, { status: known ? error.status : 503, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  }
}

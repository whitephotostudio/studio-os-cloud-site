import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { assertParentSessionScope, resolveParentGallerySession, ParentGallerySessionError } from "@/lib/parent-gallery-session";
import { CollageAccessError, COLLAGE_UUID, resolveCollageVersions, resolveCollageCatalogueVersions, collageVersionForPreview } from "@/lib/collage-server";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const scope = await resolveParentGallerySession(request, request.nextUrl.searchParams.get("parentLaneId") || "");
    assertParentSessionScope(request, scope);
    const versionIds = (request.nextUrl.searchParams.get("versionIds") || "").split(",").filter(Boolean);
    if (!versionIds.length || versionIds.length > 20 || versionIds.some(id => !COLLAGE_UUID.test(id))) throw new CollageAccessError("Choose valid collage versions.");
    const gallery = scope.kind === "school" ? { schoolId: scope.galleryId } : { projectId: scope.galleryId };
    if (request.nextUrl.searchParams.has("artwork")) {
      if (request.nextUrl.searchParams.get("artwork") !== "1" || versionIds.length !== 1) throw new CollageAccessError("Choose one collage version when loading artwork.");
      const allowed = await resolveCollageVersions(createDashboardServiceClient(), scope.photographerId, gallery, versionIds);
      return NextResponse.json({ ok: true, preview: true, versions: [await collageVersionForPreview(allowed.get(versionIds[0])!)], unavailableVersionIds: [] }, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
    }
    const catalogue = await resolveCollageCatalogueVersions(createDashboardServiceClient(), scope.photographerId, gallery, versionIds);
    return NextResponse.json({ ok: true, preview: true, versions: [...catalogue.versions.values()].map(version => ({ ...version, hasArtwork: !!version.artworkKey })), unavailableVersionIds: catalogue.unavailableVersionIds }, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    const known = error instanceof CollageAccessError || error instanceof ParentGallerySessionError;
    return NextResponse.json({ ok: false, message: known ? error.message : "Collage designs are temporarily unavailable." }, { status: known ? error.status : 503, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  }
}

import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { assertParentSessionScope, resolveParentGallerySession, ParentGallerySessionError } from "@/lib/parent-gallery-session";
import { validateEventGalleryAccess } from "@/lib/event-gallery-access";
import { resolveSchoolOrderMediaReferences } from "@/lib/school-order-media";
import { resolveEventOrderMediaReferences } from "@/lib/event-order-media";
import { CollageAccessError, resolveCollageVersions, readCollageJson } from "@/lib/collage-server";
import { parseCollageSelection } from "@/lib/collage-selection";
import { renderCollageProduction } from "@/lib/collage-production";
import { r2Download } from "@/lib/r2";
import { rateLimit } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function POST(request: NextRequest) {
  try {
    const body = await readCollageJson(request, 16384);
    const scope = await resolveParentGallerySession(request, typeof body.parentLaneId === "string" ? body.parentLaneId : request.nextUrl.searchParams.get("parentLaneId") || "");
    assertParentSessionScope(request, scope, body);
    const limit = await rateLimit(createHash("sha256").update(scope.laneId).digest("hex"), { namespace: "collage-preview", limit: 45, windowSeconds: 60 });
    if (!limit.allowed) throw new CollageAccessError("Please wait before refreshing the collage preview.", 429);
    const selection = parseCollageSelection(body.selection);
    const service = createDashboardServiceClient();
    const stored = (await resolveCollageVersions(service, scope.photographerId, scope.kind === "school" ? { schoolId: scope.galleryId } : { projectId: scope.galleryId }, [selection.templateVersionId])).get(selection.templateVersionId)!;
    parseCollageSelection(selection, stored.design);
    const refs = { selectedImageUrl: null, slots: [], retouchSelections: [], digitalSelections: selection.placements.map(placement => ({ mediaId: placement.mediaId, url: null as string | null })) };
    if (scope.kind === "school") {
      const student = await service.from("students").select("id").eq("school_id", scope.galleryId).eq("pin", scope.pin).maybeSingle();
      if (student.error) throw student.error;
      if (!student.data) throw new CollageAccessError("Reopen this student's gallery before previewing a collage.", 403);
      await resolveSchoolOrderMediaReferences(service, scope.galleryId, student.data.id, scope.photographerId, [refs]);
    } else {
      const access = await validateEventGalleryAccess({ projectId: scope.galleryId, email: scope.email, pin: scope.pin });
      if (!access.ok) throw new CollageAccessError(access.message, access.status);
      await resolveEventOrderMediaReferences(service, scope.galleryId, access.collectionIds, [refs]);
    }
    const authorizedKeys = new Set(refs.digitalSelections.map(selection => selection.url));
    const snapshot = { ...selection, templateId: stored.templateId, photographerId: stored.photographerId, versionNumber: stored.versionNumber, design: stored.design, artworkKey: stored.artworkKey, contentHash: stored.contentHash,
      placements: selection.placements.map((placement, index) => ({ ...placement, mediaKey: refs.digitalSelections[index].url! })) };
    const result = await renderCollageProduction({ snapshot, previewMaxDimension: 1200, loadMedia: async key => {
      if (!authorizedKeys.has(key)) throw new CollageAccessError("A selected collage photo is outside this gallery.", 403);
      return r2Download(key, { maxBytes: 100 * 1024 * 1024 });
    } });
    return NextResponse.json({ ok: true, preview: `data:image/png;base64,${result.bytes.toString("base64")}`, width: result.width, height: result.height, trim: result.trim, bleedPixels: result.bleedPixels, warnings: result.warnings }, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    const known = error instanceof CollageAccessError || error instanceof ParentGallerySessionError;
    return NextResponse.json({ ok: false, message: known ? error.message : "The collage preview could not be verified. Reopen the gallery and choose authorized photos." }, { status: known ? error.status : 403, headers: { "Cache-Control": "private, no-store" } });
  }
}

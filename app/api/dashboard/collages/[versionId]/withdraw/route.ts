import { NextRequest, NextResponse } from "next/server";
import { CollageAccessError, COLLAGE_UUID, collageDashboardAccess } from "@/lib/collage-server";
import { rateLimit } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest, context: { params: Promise<{ versionId: string }> }) {
  try {
    const { service, photographerId, user } = await collageDashboardAccess(request, true);
    const { versionId } = await context.params;
    if (!COLLAGE_UUID.test(versionId)) throw new CollageAccessError("Choose a valid collage version.");
    const limit = await rateLimit(user.id, { namespace: "collage-withdraw", limit: 60, windowSeconds: 3600 });
    if (!limit.allowed) throw new CollageAccessError("Please wait before changing more collage gallery access.", 429);
    const result = await service.rpc("withdraw_collage_gallery_access", { p_version_id: versionId, p_photographer_id: photographerId });
    if (result.error?.code === "42501") throw new CollageAccessError("This collage version is unavailable for this studio.", 404);
    if (result.error) throw result.error;
    return NextResponse.json({ ok: true, revokedCount: Number(result.data) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof CollageAccessError ? error.message : "Collage gallery access could not be withdrawn." }, { status: error instanceof CollageAccessError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } });
  }
}

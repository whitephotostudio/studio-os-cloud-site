import { portalPreviewGlobalLimit, portalPreviewViewerLimit } from "@/lib/portal-preview-rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { authorizeSchoolMediaToken, schoolImageBytes, verifySchoolMediaToken } from "@/lib/school-portal-media";
import { getClientIp } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  try {
    const limit = await portalPreviewGlobalLimit(getClientIp(request));
    if (!limit.allowed) return NextResponse.json({ ok: false, message: "Please wait before loading more previews." }, { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))) } });
    let token;
    try { token = verifySchoolMediaToken(request.nextUrl.searchParams.get("token") || "", "school-gallery-preview"); } catch { return NextResponse.json({ ok: false, message: "Reopen the school gallery to refresh this preview." }, { status: 403 }); }
    const viewerLimit = await portalPreviewViewerLimit(getClientIp(request), token.schoolId, token.viewerEmail);
    if (!viewerLimit.allowed) return NextResponse.json({ ok: false, message: "Please wait before loading more previews." }, { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((viewerLimit.resetAt - Date.now()) / 1000))) } });
    const service = createDashboardServiceClient(), access = await authorizeSchoolMediaToken(service, token);
    if (!access) return NextResponse.json({ ok: false, message: "School gallery access changed." }, { status: 403 });
    const image = await schoolImageBytes(service, token, true, request.nextUrl.searchParams.get("size") === "thumbnail", access.watermarkEnabled, access.watermarkOpacity);
    return new NextResponse(new Uint8Array(image.buffer), { headers: { "content-type": image.contentType, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch { return NextResponse.json({ ok: false, message: "Preview unavailable. Please retry or contact the photographer." }, { status: 503 }); }
}

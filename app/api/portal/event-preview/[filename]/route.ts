import { portalPreviewGlobalLimit, portalPreviewViewerLimit } from "@/lib/portal-preview-rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { verifyEventPreviewToken } from "@/lib/event-gallery-download-tokens";
import { authorizeEventMediaToken, eventImageBytes } from "@/lib/event-media-delivery";
import { validateUuid } from "@/lib/request-validation";
import { getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest, context: { params: Promise<{ filename: string }> }) {
  try {
    // Image paths use the proxy's existing image exclusion; keep a separate
    // bounded budget so browsing photos cannot exhaust login/checkout requests.
    const limit = await portalPreviewGlobalLimit(getClientIp(request));
    if (!limit.allowed) return NextResponse.json({ ok: false, message: "Please wait before loading more previews." }, { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))) } });
    const { filename } = await context.params;
    const id = validateUuid(filename.replace(/\.jpg$/i, ""), "mediaId");
    if (!/\.jpg$/i.test(filename) || !id.ok) return NextResponse.json({ ok: false, message: "Invalid preview." }, { status: 400 });
    let payload;
    try { payload = verifyEventPreviewToken(request.nextUrl.searchParams.get("token") || ""); }
    catch { return NextResponse.json({ ok: false, message: "This preview session expired. Reopen the gallery." }, { status: 403 }); }
    const viewerLimit = await portalPreviewViewerLimit(getClientIp(request), payload.projectId, payload.viewerEmail);
    if (!viewerLimit.allowed) return NextResponse.json({ ok: false, message: "Please wait before loading more previews." }, { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((viewerLimit.resetAt - Date.now()) / 1000))) } });
    const service = createDashboardServiceClient(), access = await authorizeEventMediaToken(service, payload);
    if (!access) return NextResponse.json({ ok: false, message: "Gallery access changed. Reopen the gallery." }, { status: 403 });
    const { data: media, error } = await service.from("media").select("id,collection_id,storage_path,preview_url,thumbnail_url").eq("project_id", payload.projectId).eq("id", id.value).maybeSingle();
    if (error) throw error;
    if (!media?.collection_id || !access.collectionIds.has(media.collection_id)) return NextResponse.json({ ok: false, message: "Photo unavailable." }, { status: 403 });
    const image = await eventImageBytes(media, { resolution: request.nextUrl.searchParams.get("size") === "thumbnail" ? "thumbnail" : "preview", watermark: access.watermarkEnabled, watermarkText: "PROOF", watermarkOpacity: access.watermarkOpacity });
    return new NextResponse(new Uint8Array(image.buffer), { headers: { "content-type": image.contentType, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    console.error("[event-preview] Preview could not be rendered", error instanceof Error ? error.message : "image read failed");
    return NextResponse.json({ ok: false, message: "Preview unavailable. Please retry or contact the photographer." }, { status: 503 });
  }
}

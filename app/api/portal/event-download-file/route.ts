import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { verifyEventGalleryBatchToken } from "@/lib/event-gallery-download-tokens";
import { authorizeEventMediaToken, eventImageBytes } from "@/lib/event-media-delivery";
import { validateUuid } from "@/lib/request-validation";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const limit = await rateLimit(getClientIp(request), { namespace: "event-download-file", limit: 100, windowSeconds: 60 });
    if (!limit.allowed) return NextResponse.json({ ok: false, message: "Please wait before downloading more photos." }, { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))) } });
    let payload;
    try { payload = verifyEventGalleryBatchToken(request.nextUrl.searchParams.get("token") || ""); }
    catch { return NextResponse.json({ ok: false, message: "Prepare a fresh download from the gallery." }, { status: 403 }); }
    const id = validateUuid(payload.mediaIds?.length === 1 ? payload.mediaIds[0] : null, "mediaId");
    if (!id.ok) return NextResponse.json({ ok: false, message: "Invalid single-photo download." }, { status: 400 });
    const service = createDashboardServiceClient(), access = await authorizeEventMediaToken(service, payload, true);
    if (!access) return NextResponse.json({ ok: false, message: "Download permission changed. Prepare the download again." }, { status: 403 });
    const { data: media, error } = await service.from("media").select("id,collection_id,storage_path,preview_url,thumbnail_url,filename").eq("project_id", payload.projectId).eq("id", id.value).maybeSingle();
    if (error) throw error;
    if (!media?.collection_id || !access.collectionIds.has(media.collection_id) || (payload.collectionId && media.collection_id !== payload.collectionId)) return NextResponse.json({ ok: false, message: "Photo access changed." }, { status: 403 });
    const image = await eventImageBytes(media, { resolution: payload.resolution, watermark: payload.applyWatermark, watermarkText: payload.watermarkText });
    const name = (media.filename || "photo.jpg").replace(/[\r\n"\\/]/g, "_");
    return new NextResponse(new Uint8Array(image.buffer), { headers: { "content-type": image.contentType, "cache-control": "private, no-store", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, "x-content-type-options": "nosniff" } });
  } catch (error) {
    console.error("[event-download-file]", error instanceof Error ? error.message : "image read failed");
    return NextResponse.json({ ok: false, message: "The requested photo could not be delivered. Please retry." }, { status: 503 });
  }
}

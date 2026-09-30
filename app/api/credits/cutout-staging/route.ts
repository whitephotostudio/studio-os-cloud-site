import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";
import { MAX_MANAGED_CUTOUT_BYTES } from "@/lib/credit-cutout-access";
import { r2PresignedPutUrl } from "@/lib/r2-signed-urls";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const error = (message: string, status: number) => NextResponse.json({ ok: false, error: message }, { status, headers: { "Cache-Control": "no-store" } });
const TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/tiff", "image/heic", "image/heif", "application/octet-stream"]);
export async function POST(request: NextRequest) {
  try {
    const auth = await resolveDashboardAuth(request);
    if (!auth.user) return error("Please sign in to Studio OS.", 401);
    if (auth.mfaSatisfied === false) return error("Complete two-step verification before uploading cutouts.", 403);
    const service = createDashboardServiceClient();
    const { data: photographer, error: profileError } = await service.from("photographers").select("id").eq("user_id", auth.user.id).maybeSingle();
    if (profileError || !photographer?.id) return error("Your photographer account could not be verified.", 403);
    const limit = await rateLimit(photographer.id, { namespace: "credit-cutout-staging", limit: 1200, windowSeconds: 600 });
    if (!limit.allowed) return error("Too many cutout uploads. Try again shortly.", 429);
    if (Number(request.headers.get("content-length") || 0) > 4096) return error("Invalid upload request.", 400);
    const body = await request.json();
    if (!body || !Number.isSafeInteger(body.contentLength) || body.contentLength < 1 || body.contentLength > MAX_MANAGED_CUTOUT_BYTES) return error("Use a PNG smaller than 25 MB.", 400);
    const contentType = typeof body.contentType === "string" ? body.contentType.trim().toLowerCase() : "image/png";
    if (!TYPES.has(contentType)) return error("Unsupported image upload type.", 400);
    // The client supplies a length only; it can never choose an object key.
    const key = `credit-staging/${auth.user.id}/${randomUUID()}.png`;
    const url = r2PresignedPutUrl(key, 120, { allowCutoutStaging: true, contentLength: body.contentLength, contentType });
    if (!url) return error("Private upload is temporarily unavailable.", 503);
    return NextResponse.json({ ok: true, key, url, headers: { "content-type": contentType, "content-length": String(body.contentLength), "cache-control": "private, no-store" }, expiresIn: 120,
      maxBytes: MAX_MANAGED_CUTOUT_BYTES }, { headers: { "Cache-Control": "no-store" } });
  } catch { return error("The private upload could not be started. Try again.", 503); }
}

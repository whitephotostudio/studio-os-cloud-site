import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";
import { legacyStorageReference, privateSupabaseStorageReference } from "@/lib/photo-url";
import { legacyStorageOwner } from "@/lib/legacy-storage-access";
import { verifyLegacyStorageToken } from "@/lib/legacy-storage-token";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
const denied = (status: number) => NextResponse.json({ ok: false, message: "This photo is unavailable or access has changed." }, { status, headers: PRIVATE_HEADERS });

export async function GET(request: NextRequest, context: { params: Promise<{ bucket: string; path: string[] }> }) {
  try {
    const { bucket, path } = await context.params;
    const reference = legacyStorageReference(bucket, (path ?? []).join("/"));
    if (!reference) return denied(400);
    const token = request.nextUrl.searchParams.get("token");
    let userId: string | null = null;
    let grantedOwner: string | null = null;
    if (token) {
      grantedOwner = verifyLegacyStorageToken(token, reference) || null;
      if (!grantedOwner) return denied(403);
    } else {
      const auth = await resolveDashboardAuth(request);
      if (auth.mfaSatisfied === false) return denied(403);
      if (!auth.user) return denied(401);
      userId = auth.user.id;
    }
    const limit = await rateLimit(userId || getClientIp(request), { namespace: "legacy-storage-read", limit: 300, windowSeconds: 60 });
    if (!limit.allowed) return denied(429);
    const service = createDashboardServiceClient();
    const ownerId = await legacyStorageOwner(service, reference.bucket, reference.key);
    if (!ownerId || (grantedOwner && grantedOwner !== ownerId)) return denied(403);
    if (userId) {
      const { data: photographer, error } = await service.from("photographers").select("id").eq("user_id", userId).maybeSingle();
      if (error || photographer?.id !== ownerId) return denied(403);
    }
    const { data, error } = await service.storage.from(reference.bucket).createSignedUrl(reference.key, 300);
    const signed = privateSupabaseStorageReference(data?.signedUrl);
    if (error || !data?.signedUrl || signed?.bucket !== reference.bucket || signed.key !== reference.key) return denied(503);
    return new NextResponse(null, { status: 302, headers: { ...PRIVATE_HEADERS, location: data.signedUrl } });
  } catch { return denied(503); }
}

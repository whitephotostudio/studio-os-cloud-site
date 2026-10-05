import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { authorizeSchoolMediaToken, schoolImageBytes, verifySchoolMediaToken } from "@/lib/school-portal-media";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  try {
    const limit = await rateLimit(getClientIp(request), { namespace: "school-download-file", limit: 100, windowSeconds: 60 });
    if (!limit.allowed) return NextResponse.json({ ok: false, message: "Please wait before downloading more photos." }, { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))) } });
    let token;
    try { token = verifySchoolMediaToken(request.nextUrl.searchParams.get("token") || "", "school-photo-download"); } catch { return NextResponse.json({ ok: false, message: "Prepare a fresh download from the school gallery." }, { status: 403 }); }
    const service = createDashboardServiceClient();
    if (!await authorizeSchoolMediaToken(service, token)) return NextResponse.json({ ok: false, message: "Download access changed." }, { status: 403 });
    const image = await schoolImageBytes(service, token, false);
    return new NextResponse(new Uint8Array(image.buffer), { headers: { "content-type": image.contentType, "cache-control": "private, no-store", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(token.mediaKey.split("/").pop() || "photo.jpg")}`, "x-content-type-options": "nosniff" } });
  } catch { return NextResponse.json({ ok: false, message: "This photo could not be delivered. Please retry." }, { status: 503 }); }
}

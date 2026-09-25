import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { schoolRegistrationClasses } from "@/lib/school-registration-classes";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const schoolId = new URL(request.url).searchParams.get("schoolId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(schoolId)) return NextResponse.json({ ok: false }, { status: 400 });
  const limit = await rateLimit(getClientIp(request), { namespace: "registration-classes", limit: 60, windowSeconds: 300 });
  if (!limit.allowed) return NextResponse.json({ ok: false }, { status: 429 });
  try {
    const service = createDashboardServiceClient();
    const { data: school, error } = await service.from("schools").select("id,status").eq("id", schoolId).maybeSingle();
    if (error) throw error;
    if (!school || ["inactive", "closed", "archived"].includes(String(school.status).toLowerCase())) {
      return NextResponse.json({ ok: false }, { status: 404 });
    }
    // Only class labels are public. Never include student names, counts or PINs.
    return NextResponse.json({ ok: true, classes: await schoolRegistrationClasses(service, schoolId) });
  } catch {
    return NextResponse.json({ ok: false, message: "Classes are unavailable. You can still register your email." }, { status: 503 });
  }
}

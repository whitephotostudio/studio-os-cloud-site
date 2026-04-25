// GET /api/portal/recovery/claim?token=<plaintext>
//
// The "magic link" endpoint a parent hits from the recovery email.  We
// validate the single-use token, mark it consumed, look up the student
// (so we can redirect to the right gallery), and bounce the parent to the
// parents portal with the PIN already pre-filled in the URL.
//
// Spec: docs/design/combine-orders-and-recovery.md (section 4.4 step 5).

import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { claimRecoveryToken } from "@/lib/pin-recovery";

export const dynamic = "force-dynamic";

function clientIp(request: NextRequest): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() ?? null;
}

function buildResultUrl(
  request: NextRequest,
  status: "ok" | "expired" | "used" | "invalid",
  pin?: string,
  schoolId?: string,
): string {
  const origin =
    request.nextUrl.origin ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://studiooscloud.com";
  const params = new URLSearchParams();
  params.set("recovery", status);
  if (pin) params.set("pin", pin);
  if (schoolId) params.set("school", schoolId);
  return `${origin.replace(/\/$/, "")}/parents?${params.toString()}`;
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(buildResultUrl(request, "invalid"));
  }

  const service = createDashboardServiceClient();
  const ipAddress = clientIp(request);
  const userAgent = request.headers.get("user-agent");

  const result = await claimRecoveryToken(service, {
    plaintextToken: token,
    ipAddress,
    userAgent,
  });

  if (!result.ok) {
    const status =
      result.reason === "expired"
        ? "expired"
        : result.reason === "already_used"
          ? "used"
          : "invalid";
    return NextResponse.redirect(buildResultUrl(request, status));
  }

  // Resolve the student → school + PIN so we can deep-link the parent into
  // the gallery they were trying to recover.  The parents portal already
  // accepts ?pin=... + ?school=... query params from its sign-in flow.
  const { data: student } = await service
    .from("students")
    .select("id, pin, school_id")
    .eq("id", result.studentId)
    .maybeSingle();

  if (!student) {
    return NextResponse.redirect(buildResultUrl(request, "invalid"));
  }

  const pin = (student.pin as string | null)?.trim() ?? "";
  const schoolId = (student.school_id as string | null) ?? "";
  if (!pin || !schoolId) {
    return NextResponse.redirect(buildResultUrl(request, "invalid"));
  }

  return NextResponse.redirect(buildResultUrl(request, "ok", pin, schoolId));
}

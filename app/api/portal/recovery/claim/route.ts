// GET /api/portal/recovery/claim?token=<plaintext>
//
// The "magic link" endpoint a parent hits from the recovery email.  We
// validate the single-use token, mark it consumed, look up the student
// (so we can redirect to the right gallery), and bounce the parent to the
// private browser session without placing the PIN in a redirect URL.
//
// Spec: docs/design/combine-orders-and-recovery.md (section 4.4 step 5).

import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { claimRecoveryToken, pinRecoveryOrigin } from "@/lib/pin-recovery";
import { bootstrapParentGallerySession } from "@/lib/parent-gallery-session";

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
  status: "ok" | "expired" | "used" | "invalid",
  schoolId?: string,
): string {
  const params = new URLSearchParams();
  params.set("recovery", status);
  if (schoolId) params.set("school", schoolId);
  return `${pinRecoveryOrigin()}/parents?${params.toString()}`;
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token || request.nextUrl.searchParams.getAll("token").length !== 1 || token.length > 256) {
    return NextResponse.redirect(buildResultUrl("invalid"));
  }
  // Recovery links are generated for one configured origin. Never consume a
  // token or issue a host-only credential on an untrusted alternate host.
  if (request.nextUrl.origin !== pinRecoveryOrigin()) {
    const canonical = new URL("/api/portal/recovery/claim", pinRecoveryOrigin());
    canonical.searchParams.set("token", token);
    return NextResponse.redirect(canonical);
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
    return NextResponse.redirect(buildResultUrl(status));
  }

  // The consumed token already rechecked the trusted roster/approved email
  // association. Keep the recovered credentials exclusively server-side.
  const { data: student } = await service
    .from("students")
    .select("id, pin, school_id")
    .eq("id", result.studentId)
    .maybeSingle();

  if (!student) {
    return NextResponse.redirect(buildResultUrl("invalid"));
  }

  const pin = (student.pin as string | null)?.trim() ?? "";
  const schoolId = (student.school_id as string | null) ?? "";
  if (!pin || !schoolId) {
    return NextResponse.redirect(buildResultUrl("invalid"));
  }

  try {
    const session = await bootstrapParentGallerySession(request, {
      kind: "school", galleryId: schoolId, pin, email: result.parentEmail,
    }, { expectedPhotographerId: result.photographerId });
    if (session.grant.photographerId !== result.photographerId) {
      return NextResponse.redirect(buildResultUrl("invalid"));
    }
    const target = new URL(session.grant.galleryUrl, pinRecoveryOrigin());
    target.searchParams.set("recovery", "ok");
    const response = NextResponse.redirect(target);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return await session.applyCookie(response);
  } catch {
    return NextResponse.redirect(buildResultUrl("invalid", schoolId));
  }
}

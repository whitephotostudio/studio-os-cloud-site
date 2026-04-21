import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

export async function POST(request: NextRequest) {
  try {
    // Unauthenticated public endpoint — any anonymous caller can POST here.
    // Without a rate limit, an attacker can flood pre_release_emails /
    // pre_release_registrations / portal_email_captures with millions of
    // junk rows using distinct @attacker.com addresses. Cap at 10 requests
    // per 5-minute window per IP; legitimate visitors only hit this once.
    const clientIp = getClientIp(request);
    const limitResult = rateLimit(clientIp, {
      namespace: "pre-release-register",
      limit: 10,
      windowSeconds: 300,
    });
    if (!limitResult.allowed) {
      return NextResponse.json(
        { ok: false, message: "Too many requests. Please try again in a few minutes." },
        {
          status: 429,
          headers: {
            "Retry-After": Math.max(
              1,
              Math.ceil((limitResult.resetAt - Date.now()) / 1000),
            ).toString(),
          },
        },
      );
    }

    const { schoolId, projectId, email } = (await request.json()) as {
      schoolId?: string;
      projectId?: string;
      email?: string;
    };

    const selectedSchoolId = clean(schoolId);
    const selectedProjectId = clean(projectId);
    const normalizedEmail = clean(email).toLowerCase();

    if ((!selectedSchoolId && !selectedProjectId) || !normalizedEmail) {
      return NextResponse.json(
        { ok: false, message: "Please enter your email." },
        { status: 400 },
      );
    }

    const service = createDashboardServiceClient();

    if (selectedProjectId) {
      // Event pre-release — RLS policy allows anon INSERT on pre_release_emails
      const { error } = await service.from("pre_release_emails").insert({
        project_id: selectedProjectId,
        email: normalizedEmail,
      });
      if (error && error.code !== "23505") throw error;

      // Also save to general marketing captures (non-fatal)
      try { await service.from("portal_email_captures").insert({ email: normalizedEmail, project_id: selectedProjectId, source: "pre_release" }); } catch { /* non-fatal */ }

      return NextResponse.json({ ok: true });
    }

    // School pre-release
    const { error } = await service.from("pre_release_registrations").insert({
      school_id: selectedSchoolId,
      email: normalizedEmail,
    });
    if (error && error.code !== "23505") throw error;

    // Also save to general marketing captures (non-fatal)
    try { await service.from("portal_email_captures").insert({ email: normalizedEmail, school_id: selectedSchoolId, source: "pre_release" }); } catch { /* non-fatal */ }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[pre-release-register]", error);
    return NextResponse.json(
      { ok: false, message: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

export async function POST(request: NextRequest) {
  try {
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
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Something went wrong. Please try again.",
      },
      { status: 500 },
    );
  }
}

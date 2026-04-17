import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      school_name?: string | null;
    };

    const schoolName = (body.school_name ?? "").trim();
    if (!schoolName) {
      return NextResponse.json(
        { ok: false, message: "School name is required." },
        { status: 400 },
      );
    }

    const service = createDashboardServiceClient();

    const { data: photographerRow, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (photographerError) throw photographerError;
    if (!photographerRow?.id) {
      return NextResponse.json(
        { ok: false, message: "Photographer profile not found." },
        { status: 404 },
      );
    }

    const localSchoolId = `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const { data: newSchool, error: insertError } = await service
      .from("schools")
      .insert({
        school_name: schoolName,
        photographer_id: photographerRow.id,
        local_school_id: localSchoolId,
        // ✅ Default new schools to "pre_release" so parents can register
        // their email for a gallery-ready notification before any photos
        // or students have been uploaded. Photographer can change the
        // status from the school settings page once the gallery is live.
        status: "pre_release",
        email_required: true,
      })
      .select("id,school_name,status,created_at")
      .single();

    if (insertError) {
      console.error("School insert error:", insertError);
      return NextResponse.json(
        {
          ok: false,
          message: insertError.message || "Database error creating school.",
          code: insertError.code ?? null,
          details: insertError.details ?? null,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, school: newSchool });
  } catch (error) {
    console.error("School creation error:", error);
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to create school.",
      },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────
// /api/dashboard/schools/roster-snapshots/[id]
//
// GET a single snapshot by id, including the full roster_json payload.
// Used when the app wants to download/restore a specific cloud version.
// ─────────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json(
        { ok: false, message: "snapshot id is required." },
        { status: 400 },
      );
    }

    const service = createDashboardServiceClient();

    // Fetch the snapshot + its school in one shot, then verify ownership.
    const { data: snap, error } = await service
      .from("school_roster_snapshots")
      .select(
        "id,school_id,version,roster_json,student_count,teacher_count,source,uploaded_by_machine,is_current,note,created_at",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!snap) {
      return NextResponse.json(
        { ok: false, message: "Snapshot not found." },
        { status: 404 },
      );
    }

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

    const { data: schoolRow, error: schoolError } = await service
      .from("schools")
      .select("id,school_name")
      .eq("id", (snap as { school_id: string }).school_id)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle();
    if (schoolError) throw schoolError;
    if (!schoolRow) {
      return NextResponse.json(
        { ok: false, message: "Not authorized for this snapshot." },
        { status: 403 },
      );
    }

    return NextResponse.json({
      ok: true,
      school: schoolRow,
      snapshot: snap,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to load roster snapshot.",
      },
      { status: 500 },
    );
  }
}

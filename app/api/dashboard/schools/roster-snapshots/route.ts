import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const StudentPayloadSchema = z.object({
  student_id: z.string().max(200).nullable().optional(),
  first_name: z.string().max(200).nullable().optional(),
  last_name: z.string().max(200).nullable().optional(),
  pin: z.string().max(64).nullable().optional(),
  class_name: z.string().max(200).nullable().optional(),
  folder_name: z.string().max(500).nullable().optional(),
});

const TeacherPayloadSchema = z.object({
  teacher_id: z.string().max(200).nullable().optional(),
  first_name: z.string().max(200).nullable().optional(),
  last_name: z.string().max(200).nullable().optional(),
  pin: z.string().max(64).nullable().optional(),
  role: z.string().max(200).nullable().optional(),
  class_names: z.array(z.string().max(200)).max(500).nullable().optional(),
  folder_name: z.string().max(500).nullable().optional(),
});

const RosterSnapshotBodySchema = z.object({
  schoolId: z.string().max(128).nullable().optional(),
  students: z.array(StudentPayloadSchema).max(20_000).nullable().optional(),
  teachers: z.array(TeacherPayloadSchema).max(5000).nullable().optional(),
  source: z
    .enum(["auto_upload", "manual_sync", "pre_download", "restore"])
    .nullable()
    .optional(),
  machine: z.string().max(200).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  markCurrent: z.boolean().nullable().optional(),
});

// ─────────────────────────────────────────────────────────────────────────
// /api/dashboard/schools/roster-snapshots
//
// Versioned cloud history of roster uploads from Studio OS.
// Mirrors the local snapshot system in the Flutter app so the user can
// restore a previous cloud version onto a second machine.
//
// GET  ?schoolId=…            → list up to 20 latest snapshots for a school
// POST { schoolId, roster, … } → write a new snapshot (auto-versioned)
// ─────────────────────────────────────────────────────────────────────────

type StudentPayload = {
  student_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  pin?: string | null;
  class_name?: string | null;
  folder_name?: string | null;
};

type TeacherPayload = {
  teacher_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  pin?: string | null;
  role?: string | null;
  class_names?: string[] | null;
  folder_name?: string | null;
};

type PostBody = {
  schoolId?: string | null;
  students?: StudentPayload[] | null;
  teachers?: TeacherPayload[] | null;
  source?:
    | "auto_upload"
    | "manual_sync"
    | "pre_download"
    | "restore"
    | null;
  machine?: string | null;
  note?: string | null;
  markCurrent?: boolean | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

async function resolveSchoolOwnership(
  service: ReturnType<typeof createDashboardServiceClient>,
  userId: string,
  schoolId: string,
) {
  const { data: photographerRow, error: photographerError } = await service
    .from("photographers")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (photographerError) throw photographerError;
  if (!photographerRow?.id) {
    return { error: "Photographer profile not found.", status: 404 as const };
  }

  const { data: schoolRow, error: schoolError } = await service
    .from("schools")
    .select("id,school_name,photographer_id")
    .eq("id", schoolId)
    .eq("photographer_id", photographerRow.id)
    .maybeSingle();
  if (schoolError) throw schoolError;
  if (!schoolRow) {
    return { error: "School not found.", status: 404 as const };
  }
  return { ok: true as const, school: schoolRow };
}

// ─────────────────────────────────────────────────────────────────────────
// GET — list versions
// ─────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const schoolId = clean(request.nextUrl.searchParams.get("schoolId"));
    if (!schoolId) {
      return NextResponse.json(
        { ok: false, message: "schoolId is required." },
        { status: 400 },
      );
    }

    const service = createDashboardServiceClient();
    const ownership = await resolveSchoolOwnership(service, user.id, schoolId);
    if ("error" in ownership) {
      return NextResponse.json(
        { ok: false, message: ownership.error },
        { status: ownership.status },
      );
    }

    // Versions list — lightweight, no roster_json to keep responses small.
    const { data: snapshots, error } = await service
      .from("school_roster_snapshots")
      .select(
        "id,version,student_count,teacher_count,source,uploaded_by_machine,is_current,note,created_at",
      )
      .eq("school_id", schoolId)
      .order("version", { ascending: false })
      .limit(20);
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      school: ownership.school,
      snapshots: snapshots ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to list roster snapshots.",
      },
      { status: 500 },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// POST — write a new snapshot
// ─────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const parsed = await parseJson(request, RosterSnapshotBodySchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const schoolId = clean(body.schoolId);
    if (!schoolId) {
      return NextResponse.json(
        { ok: false, message: "schoolId is required." },
        { status: 400 },
      );
    }

    const students = Array.isArray(body.students) ? body.students : [];
    const teachers = Array.isArray(body.teachers) ? body.teachers : [];
    if (students.length === 0 && teachers.length === 0) {
      return NextResponse.json(
        { ok: false, message: "roster is empty — nothing to snapshot." },
        { status: 400 },
      );
    }

    const service = createDashboardServiceClient();
    const ownership = await resolveSchoolOwnership(service, user.id, schoolId);
    if ("error" in ownership) {
      return NextResponse.json(
        { ok: false, message: ownership.error },
        { status: ownership.status },
      );
    }

    const source = body.source ?? "auto_upload";
    const machine = clean(body.machine) || null;
    const note = clean(body.note);
    // Default: every new snapshot becomes the canonical "current" unless the
    // caller explicitly opts out (e.g. a pre_download safety snapshot).
    const markCurrent = body.markCurrent !== false;

    const { data: inserted, error: insertError } = await service
      .from("school_roster_snapshots")
      .insert({
        school_id: schoolId,
        roster_json: { students, teachers },
        student_count: students.length,
        teacher_count: teachers.length,
        source,
        uploaded_by_machine: machine,
        uploaded_by_user_id: user.id,
        is_current: markCurrent,
        note,
      })
      .select(
        "id,version,student_count,teacher_count,source,uploaded_by_machine,is_current,note,created_at",
      )
      .single();
    if (insertError) throw insertError;

    await recordAudit({
      request,
      actorUserId: user.id,
      actorPhotographerId: ownership.school.photographer_id ?? null,
      action: source === "restore" ? "roster.restore" : "roster.snapshot_write",
      entityType: "school",
      entityId: schoolId,
      targetPhotographerId: ownership.school.photographer_id ?? null,
      metadata: {
        snapshotId: (inserted as { id?: string | null })?.id ?? null,
        version: (inserted as { version?: number | null })?.version ?? null,
        studentCount: students.length,
        teacherCount: teachers.length,
        source,
        machine,
        markCurrent,
      },
      result: "ok",
    });

    return NextResponse.json({ ok: true, snapshot: inserted });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to write roster snapshot.",
      },
      { status: 500 },
    );
  }
}

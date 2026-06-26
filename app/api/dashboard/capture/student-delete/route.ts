import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { guardAgreement } from "@/lib/require-agreement";
import { buildSchoolCandidateFolders } from "@/lib/storage-folder";
import { r2DeletePrefix } from "@/lib/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

type StudentRow = {
  id: string;
  school_id: string | null;
  class_name: string | null;
  folder_name: string | null;
  photo_url: string | null;
};

type SchoolRow = { id: string; local_school_id: string | null };

// Capture student-delete (mobile Sort panel).
//
// Removes a student from the roster AND deletes their photos from R2. The
// existing roster DELETE only removes the DB row and orphans storage; this also
// clears the student's R2 folder(s). Scoped to a school the photographer owns.
export async function POST(request: NextRequest) {
  const auth = await resolveDashboardAuth(request);
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createDashboardServiceClient();

  const guard = await guardAgreement({ service, userId: auth.user.id });
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  const { data: photographer } = await service
    .from("photographers")
    .select("id")
    .eq("user_id", auth.user.id)
    .maybeSingle<{ id: string }>();
  if (!photographer?.id) {
    return NextResponse.json(
      { error: "Photographer profile not found." },
      { status: 403 },
    );
  }

  let body: { schoolId?: string; studentId?: string };
  try {
    body = (await request.json()) as { schoolId?: string; studentId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const schoolId = clean(body.schoolId);
  const studentId = clean(body.studentId);
  if (!schoolId || !studentId) {
    return NextResponse.json(
      { error: "schoolId and studentId are required." },
      { status: 400 },
    );
  }

  const { data: school } = await service
    .from("schools")
    .select("id, local_school_id")
    .eq("id", schoolId)
    .eq("photographer_id", photographer.id)
    .maybeSingle<SchoolRow>();
  if (!school?.id) {
    return NextResponse.json(
      { error: "School not found for this account." },
      { status: 404 },
    );
  }

  const { data: student } = await service
    .from("students")
    .select("id, school_id, class_name, folder_name, photo_url")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle<StudentRow>();
  if (!student?.id) {
    return NextResponse.json(
      { error: "Student not found in this school." },
      { status: 404 },
    );
  }

  // Delete the student's photos from R2 (best-effort), guarded to the school
  // prefix so we can never touch another tenant's storage.
  const schoolBaseId = clean(school.local_school_id) || school.id;
  const folders = buildSchoolCandidateFolders({
    studentCandidates: [student],
    activeSchool: school,
    selectedSchoolId: schoolId,
  });
  let deletedFiles = 0;
  for (const folder of folders) {
    if (!folder.startsWith(`${schoolBaseId}/`)) continue;
    try {
      // Trailing slash so we only clear THIS folder, not a sibling whose name
      // starts the same way.
      deletedFiles += await r2DeletePrefix(`${folder}/`);
    } catch (error) {
      console.error("[capture/student-delete] r2 prefix delete failed", folder, error);
    }
  }

  const { error: delErr } = await service
    .from("students")
    .delete()
    .eq("id", studentId)
    .eq("school_id", schoolId);
  if (delErr) {
    console.error("[capture/student-delete] db delete failed", delErr);
    return NextResponse.json(
      { error: "Could not remove the student." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, deletedFiles });
}

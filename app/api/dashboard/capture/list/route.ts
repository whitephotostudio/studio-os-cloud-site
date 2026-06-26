import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import {
  buildSchoolCandidateFolders,
  loadFolderMediaRows,
} from "@/lib/storage-folder";

export const dynamic = "force-dynamic";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

type StudentRow = {
  id: string;
  school_id: string | null;
  first_name: string | null;
  last_name: string | null;
  pin: string | null;
  class_name: string | null;
  folder_name: string | null;
  photo_url: string | null;
};

type SchoolRow = { id: string; local_school_id: string | null };

// Capture list (mobile Picture Day panel).
//
// Returns the photos currently in a student's R2 folder(s) so the photographer
// can review them and delete bad/test shots. Read-only. Scoped to a school the
// authenticated photographer owns.
export async function POST(request: NextRequest) {
  const auth = await resolveDashboardAuth(request);
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createDashboardServiceClient();

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
    .select(
      "id, school_id, first_name, last_name, pin, class_name, folder_name, photo_url",
    )
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle<StudentRow>();
  if (!student?.id) {
    return NextResponse.json(
      { error: "Student not found in this school." },
      { status: 404 },
    );
  }

  const folders = buildSchoolCandidateFolders({
    studentCandidates: [student],
    activeSchool: school,
    selectedSchoolId: schoolId,
  });

  let rows;
  try {
    rows = await loadFolderMediaRows(folders);
  } catch (error) {
    console.error("[capture/list] loadFolderMediaRows failed", error);
    return NextResponse.json({ error: "Could not load photos." }, { status: 502 });
  }

  const photos = rows.map((row) => ({
    key: row.storage_path,
    url: row.preview_url,
    name: row.filename,
  }));

  return NextResponse.json({ ok: true, photos, count: photos.length });
}

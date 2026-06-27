import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { r2Upload } from "@/lib/r2";
import { guardAgreement } from "@/lib/require-agreement";
import sharp from "sharp";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

// Keep R2 path segments human-readable but safe — they must mirror the
// {schoolId}/{className}/{folderName} convention the parent gallery lists by
// prefix (see buildSchoolCandidateFolders in lib/storage-folder.ts). No slashes
// inside a single segment.
function safeSegment(value: string, fallback: string) {
  const cleaned = clean(value)
    .replace(/[\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
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

type SchoolRow = {
  id: string;
  local_school_id: string | null;
};

// Capture upload (mobile photographer panel).
//
// Accepts a single captured JPEG and stores it where the school gallery already
// discovers student photos:  {local_school_id || id}/{class_name}/{folder_name}/<file>.jpg
// The parent gallery enumerates that folder, so the capture shows up with no
// media row needed. The student's preview photo_url is set if it was empty.
export async function POST(request: NextRequest) {
  const auth = await resolveDashboardAuth(request);
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createDashboardServiceClient();

  const guard = await guardAgreement({ service, userId: auth.user.id });
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  const { data: photographer, error: photographerError } = await service
    .from("photographers")
    .select("id")
    .eq("user_id", auth.user.id)
    .maybeSingle<{ id: string }>();
  if (photographerError || !photographer?.id) {
    return NextResponse.json(
      { error: "Photographer profile not found." },
      { status: 403 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const schoolId = clean(formData.get("schoolId") as string | null);
  const studentId = clean(formData.get("studentId") as string | null);

  if (!file) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (!schoolId) {
    return NextResponse.json({ error: "schoolId is required" }, { status: 400 });
  }
  if (!studentId) {
    return NextResponse.json({ error: "studentId is required" }, { status: 400 });
  }
  if (file.size > 30 * 1024 * 1024) {
    return NextResponse.json({ error: "Photo is too large." }, { status: 413 });
  }

  // School must belong to this photographer.
  const { data: school, error: schoolError } = await service
    .from("schools")
    .select("id, local_school_id")
    .eq("id", schoolId)
    .eq("photographer_id", photographer.id)
    .maybeSingle<SchoolRow>();
  if (schoolError || !school?.id) {
    return NextResponse.json(
      { error: "School not found for this account." },
      { status: 404 },
    );
  }

  // Student must belong to that school.
  const { data: student, error: studentError } = await service
    .from("students")
    .select(
      "id, school_id, first_name, last_name, pin, class_name, folder_name, photo_url",
    )
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle<StudentRow>();
  if (studentError || !student?.id) {
    return NextResponse.json(
      { error: "Student not found in this school." },
      { status: 404 },
    );
  }

  const schoolBaseId = clean(school.local_school_id) || school.id;
  const className = safeSegment(student.class_name ?? "", "Unassigned");
  const fallbackFolder = safeSegment(
    [clean(student.last_name), clean(student.first_name), clean(student.pin)]
      .filter(Boolean)
      .join(" "),
    `student ${student.id.slice(0, 8)}`,
  );
  // Match the Flutter desktop convention exactly (_folderNameFor → "Last First
  // PIN", spaces) so mobile captures land in the SAME R2 folder the Mac app
  // creates and pulls. Do NOT use students.folder_name — that column is the
  // different "studentId_Last_First" value, which would fork into a separate
  // folder and make pulled photos feel out of place.
  const folderName = fallbackFolder;

  // Normalise to an auto-oriented JPEG (phone photos carry EXIF rotation), with
  // a defensive dimension cap.
  let jpeg: Buffer;
  try {
    jpeg = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize({ width: 3000, height: 3000, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 92 })
      .toBuffer();
  } catch {
    return NextResponse.json(
      { error: "Could not process the photo." },
      { status: 400 },
    );
  }

  const fileName = `capture_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}.jpg`;
  const key = `${schoolBaseId}/${className}/${folderName}/${fileName}`;

  let publicUrl: string;
  try {
    publicUrl = await r2Upload(key, jpeg, "image/jpeg");
  } catch (error) {
    console.error("[capture/upload] r2Upload failed", error);
    return NextResponse.json(
      { error: "Upload failed. Please try again." },
      { status: 502 },
    );
  }

  // First capture becomes the student's preview if none exists yet.
  if (!clean(student.photo_url)) {
    await service
      .from("students")
      .update({ photo_url: publicUrl })
      .eq("id", student.id);
  }

  return NextResponse.json({
    ok: true,
    url: publicUrl,
    key,
    fileName,
    studentId: student.id,
  });
}

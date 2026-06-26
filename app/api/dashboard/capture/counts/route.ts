import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { buildSchoolCandidateFolders } from "@/lib/storage-folder";
import { listR2FolderImages } from "@/lib/r2";

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

// Run `worker` over `items` with at most `limit` in flight.
async function pooledForEach<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

// Capture counts (mobile Sort panel).
//
// Returns the number of photos in each student's R2 folder(s) plus a cover URL,
// so the Sort grid can show "{student} · {N} shots" with a thumbnail. Read-only.
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

  let body: { schoolId?: string; studentIds?: string[] };
  try {
    body = (await request.json()) as { schoolId?: string; studentIds?: string[] };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const schoolId = clean(body.schoolId);
  if (!schoolId) {
    return NextResponse.json({ error: "schoolId is required." }, { status: 400 });
  }
  const studentIdFilter =
    Array.isArray(body.studentIds) && body.studentIds.length
      ? new Set(body.studentIds.map((id) => clean(id)).filter(Boolean))
      : null;

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

  const { data: studentsData } = await service
    .from("students")
    .select("id, school_id, class_name, folder_name, photo_url")
    .eq("school_id", schoolId);

  let students = (studentsData ?? []) as StudentRow[];
  if (studentIdFilter) {
    students = students.filter((s) => studentIdFilter.has(s.id));
  }

  const counts: Record<string, number> = {};
  const covers: Record<string, string> = {};

  await pooledForEach(students, 8, async (student) => {
    try {
      const folders = buildSchoolCandidateFolders({
        studentCandidates: [student],
        activeSchool: school,
        selectedSchoolId: schoolId,
      });
      const seen = new Set<string>();
      let firstUrl = "";
      for (const folder of folders) {
        const files = await listR2FolderImages(folder);
        for (const f of files) {
          if (seen.has(f.key)) continue;
          seen.add(f.key);
          if (!firstUrl) firstUrl = f.url;
        }
      }
      counts[student.id] = seen.size;
      covers[student.id] = clean(student.photo_url) || firstUrl;
    } catch {
      counts[student.id] = 0;
      covers[student.id] = clean(student.photo_url);
    }
  });

  return NextResponse.json({ ok: true, counts, covers });
}

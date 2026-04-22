import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";

export const dynamic = "force-dynamic";

const StudentPayloadSchema = z.object({
  first_name: z.string().max(200).nullable().optional(),
  last_name: z.string().max(200).nullable().optional(),
  pin: z.string().max(64).nullable().optional(),
  class_name: z.string().max(200).nullable().optional(),
  role: z.string().max(64).nullable().optional(),
  external_student_id: z.string().max(200).nullable().optional(),
  photo_url: z.string().max(2000).nullable().optional(),
  folder_name: z.string().max(500).nullable().optional(),
});

const DesktopSyncBodySchema = z.object({
  schoolId: z.string().min(1).max(128).nullable().optional(),
  students: z.array(StudentPayloadSchema).max(10_000).nullable().optional(),
});

type StudentPayload = z.infer<typeof StudentPayloadSchema>;

type StudentRow = {
  id: string;
  school_id: string;
  first_name: string;
  last_name: string | null;
  pin: string | null;
  class_name: string | null;
  role: string | null;
  external_student_id: string | null;
  photo_url: string | null;
  folder_name: string | null;
  created_at: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

/**
 * GET /api/dashboard/schools/desktop-sync
 *
 * Fetch all students for a school, intended for Flutter/desktop app sync.
 * Query params:
 *   - schoolId (required): the school UUID
 *   - since (optional): ISO timestamp — only return students updated after this time
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const schoolId = clean(searchParams.get("schoolId"));
    const since = clean(searchParams.get("since"));

    if (!schoolId) {
      return NextResponse.json(
        { ok: false, message: "schoolId is required." },
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

    // Verify the photographer owns this school
    const { data: schoolRow, error: schoolError } = await service
      .from("schools")
      .select("id,school_name,local_school_id,status")
      .eq("id", schoolId)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle();

    if (schoolError) throw schoolError;
    if (!schoolRow) {
      return NextResponse.json(
        { ok: false, message: "School not found." },
        { status: 404 },
      );
    }

    let query = service
      .from("students")
      .select(
        "id,school_id,first_name,last_name,pin,class_name,role,external_student_id,photo_url,folder_name,created_at",
      )
      .eq("school_id", schoolId)
      .order("class_name", { ascending: true })
      .order("first_name", { ascending: true });

    if (since) {
      query = query.gte("created_at", since);
    }

    const { data: students, error: studentsError } = await query;

    if (studentsError) throw studentsError;

    return NextResponse.json({
      ok: true,
      school: schoolRow,
      students: (students ?? []) as StudentRow[],
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to fetch school students for sync.",
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/dashboard/schools/desktop-sync
 *
 * Sync students from Flutter/desktop app to the cloud.
 * Accepts a batch of students — creates new ones and updates existing ones.
 *
 * Body:
 *   - schoolId (required): the school UUID
 *   - students (required): array of StudentPayload
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const parsed = await parseJson(request, DesktopSyncBodySchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const schoolId = clean(body.schoolId);
    if (!schoolId) {
      return NextResponse.json(
        { ok: false, message: "schoolId is required." },
        { status: 400 },
      );
    }

    const incomingStudents = Array.isArray(body.students) ? body.students : [];
    if (!incomingStudents.length) {
      return NextResponse.json({
        ok: true,
        created: 0,
        updated: 0,
        students: [],
      });
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

    // Verify the photographer owns this school
    const { data: schoolRow, error: schoolError } = await service
      .from("schools")
      .select("id,school_name,local_school_id,photographer_id")
      .eq("id", schoolId)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle();

    if (schoolError) throw schoolError;
    if (!schoolRow) {
      return NextResponse.json(
        { ok: false, message: "School not found." },
        { status: 404 },
      );
    }

    // Fetch existing students to detect updates vs creates
    const { data: existingStudents, error: existingError } = await service
      .from("students")
      .select("id,external_student_id,first_name,last_name,class_name")
      .eq("school_id", schoolId);

    if (existingError) throw existingError;

    const existingByExternalId = new Map<string, { id: string }>();
    const existingByNameAndClass = new Map<string, { id: string }>();

    for (const student of existingStudents ?? []) {
      const extId = clean((student as { external_student_id?: string | null }).external_student_id);
      if (extId) {
        existingByExternalId.set(extId, { id: (student as { id: string }).id });
      }
      const nameKey = `${clean((student as { first_name?: string }).first_name)}::${clean((student as { last_name?: string | null }).last_name)}::${clean((student as { class_name?: string | null }).class_name)}`.toLowerCase();
      if (!existingByNameAndClass.has(nameKey)) {
        existingByNameAndClass.set(nameKey, { id: (student as { id: string }).id });
      }
    }

    let created = 0;
    let updated = 0;
    const syncedStudents: StudentRow[] = [];

    for (const incoming of incomingStudents) {
      const firstName = clean(incoming.first_name);
      if (!firstName) continue;

      const lastName = clean(incoming.last_name) || null;
      const className = clean(incoming.class_name) || null;
      const pin = clean(incoming.pin) || null;
      const role = clean(incoming.role) || "Student";
      const externalId = clean(incoming.external_student_id) || null;
      const photoUrl = clean(incoming.photo_url) || null;
      const folderName = clean(incoming.folder_name) || null;

      // Try to match an existing student
      let existingMatch: { id: string } | undefined;
      if (externalId) {
        existingMatch = existingByExternalId.get(externalId);
      }
      if (!existingMatch) {
        const nameKey = `${firstName}::${lastName ?? ""}::${className ?? ""}`.toLowerCase();
        existingMatch = existingByNameAndClass.get(nameKey);
      }

      if (existingMatch) {
        // Update existing student
        const { data: updatedRow, error: updateError } = await service
          .from("students")
          .update({
            first_name: firstName,
            last_name: lastName,
            pin,
            class_name: className,
            role,
            external_student_id: externalId,
            photo_url: photoUrl,
            folder_name: folderName,
          })
          .eq("id", existingMatch.id)
          .eq("school_id", schoolId)
          .select(
            "id,school_id,first_name,last_name,pin,class_name,role,external_student_id,photo_url,folder_name,created_at",
          )
          .maybeSingle();

        if (updateError) throw updateError;
        if (updatedRow) {
          syncedStudents.push(updatedRow as StudentRow);
          updated += 1;
        }
      } else {
        // Create new student
        const { data: insertedRow, error: insertError } = await service
          .from("students")
          .insert({
            school_id: schoolId,
            class_id: null,
            first_name: firstName,
            last_name: lastName,
            pin,
            class_name: className,
            role,
            external_student_id: externalId,
            photo_url: photoUrl,
            folder_name: folderName,
          })
          .select(
            "id,school_id,first_name,last_name,pin,class_name,role,external_student_id,photo_url,folder_name,created_at",
          )
          .maybeSingle();

        if (insertError) throw insertError;
        if (insertedRow) {
          syncedStudents.push(insertedRow as StudentRow);
          created += 1;
        }
      }
    }

    return NextResponse.json({
      ok: true,
      created,
      updated,
      students: syncedStudents,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to sync students from desktop.",
      },
      { status: 500 },
    );
  }
}

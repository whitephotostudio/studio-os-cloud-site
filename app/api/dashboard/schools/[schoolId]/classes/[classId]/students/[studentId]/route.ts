import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import {
  DashboardStudentRow,
  loadOwnedSchool,
  loadOwnedStudent,
  splitDisplayName,
} from "@/lib/dashboard-school-students";

export const dynamic = "force-dynamic";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

export async function PATCH(
  request: NextRequest,
  context: {
    params: Promise<{ schoolId: string; classId: string; studentId: string }>;
  },
) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const { schoolId, studentId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      studentName?: string;
      studentPin?: string;
    };

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

    const school = await loadOwnedSchool({
      service,
      schoolId,
      photographerId: photographerRow.id,
    });
    if (!school?.id) {
      return NextResponse.json(
        { ok: false, message: "School not found." },
        { status: 404 },
      );
    }

    const student = await loadOwnedStudent({ service, schoolId, studentId });
    if (!student?.id) {
      return NextResponse.json(
        { ok: false, message: "Student not found." },
        { status: 404 },
      );
    }

    const fullName = clean(body.studentName);
    const { firstName, lastName } = splitDisplayName(fullName);
    const nextPin = clean(body.studentPin);

    const { data: updatedRow, error: updateError } = await service
      .from("students")
      .update({
        first_name: firstName || student.first_name,
        last_name: fullName ? lastName : student.last_name,
        pin: nextPin || student.pin,
      })
      .eq("id", student.id)
      .eq("school_id", schoolId)
      .select(
        "id,school_id,first_name,last_name,pin,photo_url,class_id,class_name,folder_name,external_student_id",
      )
      .single<DashboardStudentRow>();

    if (updateError) throw updateError;

    return NextResponse.json({ ok: true, student: updatedRow });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Failed to save student settings.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: {
    params: Promise<{ schoolId: string; classId: string; studentId: string }>;
  },
) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const { schoolId, studentId } = await context.params;
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

    const school = await loadOwnedSchool({
      service,
      schoolId,
      photographerId: photographerRow.id,
    });
    if (!school?.id) {
      return NextResponse.json(
        { ok: false, message: "School not found." },
        { status: 404 },
      );
    }

    const student = await loadOwnedStudent({ service, schoolId, studentId });
    if (!student?.id) {
      return NextResponse.json(
        { ok: false, message: "Student not found." },
        { status: 404 },
      );
    }

    const { error: deleteError } = await service
      .from("students")
      .delete()
      .eq("id", studentId)
      .eq("school_id", schoolId);

    if (deleteError) throw deleteError;

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Failed to delete student.",
      },
      { status: 500 },
    );
  }
}

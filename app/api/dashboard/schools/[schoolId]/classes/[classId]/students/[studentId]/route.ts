import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";
import { recordAudit, diffFields } from "@/lib/audit";
import {
  DashboardStudentRow,
  loadOwnedSchool,
  loadOwnedStudent,
  splitDisplayName,
} from "@/lib/dashboard-school-students";
import { guardAgreement } from "@/lib/require-agreement";

export const dynamic = "force-dynamic";

const StudentPatchBodySchema = z.object({
  studentName: z.string().max(500).optional(),
  studentPin: z.string().max(64).optional(),
});

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
    const parsed = await parseJson(request, StudentPatchBodySchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const service = createDashboardServiceClient();

    // Agreement gate — refuse to act for users who haven't accepted the
    // Studio OS Cloud legal agreement. Defense in depth behind the client
    // modal. Same pattern as upload-to-r2 / generate-thumbnails.
    {
      const guard = await guardAgreement({ service, userId: user.id });
      if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });
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

    const auditDiff = diffFields(
      student as unknown as Record<string, unknown>,
      updatedRow as unknown as Record<string, unknown>,
      ["first_name", "last_name", "class_id", "class_name", "folder_name", "external_student_id"] as (keyof Record<string, unknown>)[],
    );
    // Pin changes are sensitive — record that it changed, but don't log the value.
    const pinChanged =
      clean(body.studentPin) !== "" && clean(body.studentPin) !== clean(student.pin ?? "");
    await recordAudit({
      request,
      actorUserId: user.id,
      actorPhotographerId: photographerRow.id,
      action: "student.update",
      entityType: "student",
      entityId: studentId,
      targetPhotographerId: photographerRow.id,
      before: auditDiff.before,
      after: auditDiff.after,
      metadata: { schoolId, pinChanged },
      result: "ok",
    });

    return NextResponse.json({ ok: true, student: updatedRow });
  } catch (error) {
    console.error("[dashboard:student:PATCH]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to save student settings." },
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

    // Agreement gate — refuse to act for users who haven't accepted the
    // Studio OS Cloud legal agreement. Defense in depth behind the client
    // modal. Same pattern as upload-to-r2 / generate-thumbnails.
    {
      const guard = await guardAgreement({ service, userId: user.id });
      if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });
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

    await recordAudit({
      request,
      actorUserId: user.id,
      actorPhotographerId: photographerRow.id,
      action: "student.delete",
      entityType: "student",
      entityId: studentId,
      targetPhotographerId: photographerRow.id,
      before: {
        first_name: (student as { first_name?: string | null }).first_name ?? null,
        last_name: (student as { last_name?: string | null }).last_name ?? null,
        class_name: (student as { class_name?: string | null }).class_name ?? null,
      },
      metadata: { schoolId },
      result: "ok",
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[dashboard:student:DELETE]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to delete student." },
      { status: 500 },
    );
  }
}

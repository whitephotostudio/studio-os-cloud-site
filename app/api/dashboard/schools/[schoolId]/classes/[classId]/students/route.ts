import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import {
  collectImageFiles,
  DashboardStudentRow,
  listStorageFolderAssets,
  loadOwnedSchool,
  safeStorageSegment,
  splitDisplayName,
  storageFilePublicUrl,
  syncStudentAssets,
  uploadStudentAssets,
} from "@/lib/dashboard-school-students";
import { guardAgreement } from "@/lib/require-agreement";

export const dynamic = "force-dynamic";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && clean(error.message)) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const maybeMessage = "message" in error ? clean(String(error.message)) : "";
    const maybeDetails = "details" in error ? clean(String(error.details)) : "";
    const maybeHint = "hint" in error ? clean(String(error.hint)) : "";

    return maybeMessage || maybeDetails || maybeHint || fallback;
  }

  return fallback;
}

function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ schoolId: string; classId: string }> },
) {
  let createdStudentId: string | null = null;

  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const { schoolId, classId } = await context.params;
    const className = decodeURIComponent(classId);
    const formData = await request.formData();
    const studentName = clean(String(formData.get("studentName") ?? ""));
    const studentFirstName = clean(String(formData.get("studentFirstName") ?? ""));
    const studentLastName = clean(String(formData.get("studentLastName") ?? ""));
    const studentPin = clean(String(formData.get("studentPin") ?? ""));
    const files = collectImageFiles(formData);

    const fallbackName = studentName || [studentFirstName, studentLastName].filter(Boolean).join(" ");
    if (!fallbackName) {
      return NextResponse.json(
        { ok: false, message: "Student name is required." },
        { status: 400 },
      );
    }

    const parsedName =
      studentFirstName || studentLastName
        ? { firstName: studentFirstName, lastName: studentLastName || null }
        : splitDisplayName(fallbackName);
    const { firstName, lastName } = parsedName;
    if (!firstName) {
      return NextResponse.json(
        { ok: false, message: "Student name is required." },
        { status: 400 },
      );
    }

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

    const folderName = files.length
      ? `${safeStorageSegment(fallbackName, "Student")}-${Date.now()}`
      : null;

    const { data: insertedRow, error: insertError } = await service
      .from("students")
      .insert({
        school_id: school.id,
        class_id: null,
        class_name: className,
        role: "Student",
        first_name: firstName,
        last_name: lastName,
        pin: studentPin,
        folder_name: folderName,
        photo_url: null,
        external_student_id: null,
      })
      .select(
        "id,school_id,first_name,last_name,pin,photo_url,class_id,class_name,folder_name,external_student_id",
      )
      .single<DashboardStudentRow>();

    if (insertError) throw insertError;
    if (!insertedRow?.id) {
      throw new Error("Student could not be created.");
    }

    createdStudentId = insertedRow.id;
    let nextStudent = insertedRow;
    let uploadedUrls: string[] = [];
    let photoUrls: string[] = [];

    if (files.length && folderName) {
      const uploaded = await uploadStudentAssets({
        service,
        schoolId,
        school,
        className,
        folderName,
        files,
      });

      uploadedUrls = uploaded.uploadedUrls;
      photoUrls = [...uploaded.uploadedUrls];

      await syncStudentAssets({
        service,
        schoolId,
        school,
        className,
        uploadedAssets: uploaded.uploadedAssets,
      });

      if (uploadedUrls.length) {
        const { data: updatedRow, error: updateError } = await service
          .from("students")
          .update({
            photo_url: uploadedUrls[0] || null,
            folder_name: folderName,
          })
          .eq("id", nextStudent.id)
          .eq("school_id", schoolId)
          .select(
            "id,school_id,first_name,last_name,pin,photo_url,class_id,class_name,folder_name,external_student_id",
          )
          .single<DashboardStudentRow>();

        if (updateError) throw updateError;
        nextStudent = updatedRow;
      }

      const { data: listedFiles, error: listError } = await listStorageFolderAssets(
        service,
        uploaded.folderPath,
      );

      if (listError) throw listError;

      photoUrls = (listedFiles ?? [])
        .filter((file) => !!file.name && /\.(png|jpg|jpeg|webp)$/i.test(file.name))
        .sort((a, b) => naturalCompare(a.name, b.name))
        .map((file) => storageFilePublicUrl(service, uploaded.folderPath, file));
    }

    return NextResponse.json({
      ok: true,
      student: nextStudent,
      uploadedUrls,
      photoUrls: Array.from(
        new Set(
          [
            nextStudent.photo_url,
            ...photoUrls,
          ].filter((value): value is string => clean(value).length > 0),
        ),
      ),
    });
  } catch (error) {
    if (createdStudentId) {
      const rollbackService = createDashboardServiceClient();
      await rollbackService.from("students").delete().eq("id", createdStudentId);
    }

    return NextResponse.json(
      {
        ok: false,
        message: errorMessage(error, "Failed to add student."),
      },
      { status: 500 },
    );
  }
}

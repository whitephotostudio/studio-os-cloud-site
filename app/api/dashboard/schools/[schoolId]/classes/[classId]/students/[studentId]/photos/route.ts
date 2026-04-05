import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import {
  collectImageFiles,
  DashboardStudentRow,
  extractFolderPathFromPublicUrl,
  loadOwnedSchool,
  loadOwnedStudent,
  safeStorageSegment,
  storageFilePublicUrl,
  syncStudentAssets,
  uploadStudentAssets,
  listStorageFolderAssets,
} from "@/lib/dashboard-school-students";

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

    const { schoolId, classId, studentId } = await context.params;
    const className = decodeURIComponent(classId);
    const formData = await request.formData();
    const files = collectImageFiles(formData);

    if (!files.length) {
      return NextResponse.json(
        { ok: false, message: "Please choose at least one image to upload." },
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

    const currentPhotoUrl = clean(student.photo_url);
    const currentFolderPath = currentPhotoUrl
      ? extractFolderPathFromPublicUrl(currentPhotoUrl)
      : null;
    const derivedFolderName =
      clean(student.folder_name) ||
      (currentFolderPath
        ? currentFolderPath.split("/").filter(Boolean).at(-1) ?? ""
        : "") ||
      `${safeStorageSegment(
        `${student.first_name} ${student.last_name ?? ""}`.trim(),
        "Student",
      )}-${Date.now()}`;

    const uploaded = await uploadStudentAssets({
      service,
      schoolId,
      school,
      className,
      folderName: derivedFolderName,
      files,
    });

    let nextStudent = student;
    const needsStudentUpdate =
      !currentPhotoUrl || clean(student.folder_name) !== derivedFolderName;

    if (needsStudentUpdate) {
      const { data: updatedRow, error: updateError } = await service
        .from("students")
        .update({
          photo_url: currentPhotoUrl || uploaded.uploadedUrls[0] || null,
          folder_name: derivedFolderName,
        })
        .eq("id", student.id)
        .eq("school_id", schoolId)
        .select(
          "id,school_id,first_name,last_name,pin,photo_url,class_id,class_name,folder_name,external_student_id",
        )
        .single<DashboardStudentRow>();

      if (updateError) throw updateError;
      nextStudent = updatedRow;
    }

    try {
      await syncStudentAssets({
        service,
        schoolId,
        school,
        className,
        uploadedAssets: uploaded.uploadedAssets,
      });
    } catch (syncError) {
      console.error("CLASS STUDENT PHOTO SYNC ERROR:", syncError);
    }

    let photoUrls = [...uploaded.uploadedUrls];

    try {
      const { data: listedFiles, error: listError } = await listStorageFolderAssets(
        service,
        uploaded.folderPath,
      );
      if (listError) throw listError;

      photoUrls = (listedFiles ?? [])
        .filter((file) => !!file.name && /\.(png|jpg|jpeg|webp)$/i.test(file.name))
        .sort((a, b) => naturalCompare(a.name, b.name))
        .map((file) => storageFilePublicUrl(service, uploaded.folderPath, file));
    } catch (listError) {
      console.error("CLASS STUDENT PHOTO LIST ERROR:", listError);
    }

    if (currentPhotoUrl && !photoUrls.includes(currentPhotoUrl)) {
      photoUrls.unshift(currentPhotoUrl);
    }

    return NextResponse.json({
      ok: true,
      student: nextStudent,
      uploadedUrls: uploaded.uploadedUrls,
      photoUrls: Array.from(new Set(photoUrls.filter(Boolean))),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: errorMessage(error, "Failed to upload photos."),
      },
      { status: 500 },
    );
  }
}

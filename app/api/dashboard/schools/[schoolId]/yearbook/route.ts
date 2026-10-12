import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";
import { guardAgreement } from "@/lib/require-agreement";
import { isUuid } from "@/lib/r2-access-security";
import { proxiedPhotoUrl } from "@/lib/photo-url";
import { r2Download } from "@/lib/r2";
import { createZipStream, type ZipStreamEntry } from "@/lib/zip";
import { yearbookCsv, yearbookDeadline, type YearbookSelection } from "@/lib/school-yearbook";
import { YearbookError, yearbookSchoolFields, yearbookStudentFields, loadYearbookSettings, loadYearbookSelection, yearbookPhotos, yearbookRows, yearbookExportRows, saveYearbookSelection, type YearbookSchool, type YearbookStudent } from "@/lib/school-yearbook-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const selectionFields = "student_id,media_key,filename,source,revision,updated_at";
async function ownerAccess(request: NextRequest, schoolId: string, mutate = false) {
  if (!isUuid(schoolId)) throw new YearbookError("Invalid school.", 400);
  const { user, mfaSatisfied } = await resolveDashboardAuth(request);
  if (!user) throw new YearbookError("Please sign in again.", 401);
  if (mfaSatisfied === false) throw new YearbookError("Complete two-factor sign-in first.", 403);
  const service = createDashboardServiceClient();
  if (mutate) {
    const guard = await guardAgreement({ service, userId: user.id });
    if (!guard.ok) throw new YearbookError("Accept the studio agreement before changing yearbook settings.", guard.status);
  }
  const { data: photographer, error } = await service.from("photographers").select("id").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (!photographer) throw new YearbookError("Photographer profile not found.", 404);
  const { data: school, error: schoolError } = await service.from("schools").select(yearbookSchoolFields).eq("id", schoolId).eq("photographer_id", photographer.id).maybeSingle<YearbookSchool>();
  if (schoolError) throw schoolError;
  if (!school) throw new YearbookError("School not found.", 404);
  return { service, school };
}
function failure(error: unknown) {
  if (!(error instanceof YearbookError)) console.error("[yearbook:owner]", error);
  return NextResponse.json({ ok: false, message: error instanceof YearbookError ? error.message : "Yearbook tools are temporarily unavailable. Please try again." }, { status: error instanceof YearbookError ? error.status : 503, headers: { "Cache-Control": "no-store" } });
}
export async function GET(request: NextRequest, context: { params: Promise<{ schoolId: string }> }) {
  try {
    const { service, school } = await ownerAccess(request, (await context.params).schoolId);
    const studentId = request.nextUrl.searchParams.get("studentId");
    if (studentId) {
      if (!isUuid(studentId)) throw new YearbookError("Invalid student.", 400);
      const { data: student, error } = await service.from("students").select(yearbookStudentFields).eq("school_id", school.id).eq("id", studentId).maybeSingle<YearbookStudent>();
      if (error) throw error;
      if (!student) throw new YearbookError("Student not found.", 404);
      const [photos, selection] = await Promise.all([yearbookPhotos(service, school, student), loadYearbookSelection(service, school.id, student.id)]);
      return NextResponse.json({ ok: true, selection, photos: photos.map(photo => ({ mediaKey: photo.storage_path, filename: photo.filename, previewUrl: proxiedPhotoUrl(photo.storage_path) })) }, { headers: { "Cache-Control": "no-store" } });
    }
    const [settings, students, selections] = await Promise.all([
      loadYearbookSettings(service, school.id), yearbookRows<YearbookStudent>(service, "students", yearbookStudentFields, school.id), yearbookRows<YearbookSelection>(service, "school_yearbook_selections", selectionFields, school.id),
    ]);
    const format = request.nextUrl.searchParams.get("format");
    if (format === "csv" || format === "zip") {
      const rows = await yearbookExportRows(service, school, students, selections);
      const headers = { "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="yearbook-${school.id}.${format}"` };
      if (format === "csv") return new Response("\uFEFF" + yearbookCsv(rows), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
      const batch = Number(request.nextUrl.searchParams.get("batch") ?? "0");
      const chosen = rows.filter(row => !!row.mediaKey);
      if (!Number.isInteger(batch) || batch < 0 || batch * 72 >= chosen.length) throw new YearbookError("No portraits are available in this export batch.", 400);
      const selected = chosen.slice(batch * 72, (batch + 1) * 72);
      if (selected.some(row => !row.available)) throw new YearbookError("A selected portrait is unavailable. Export the selection CSV and review the flagged student before downloading portraits.");
      async function* entries(): AsyncGenerator<ZipStreamEntry> {
        yield { name: "yearbook_selections.csv", data: new TextEncoder().encode(yearbookCsv(selected)) };
        for (const row of selected) {
          // Revalidate scope/tombstones immediately before reading each original.
          const student = students.find(student => student.id === row.studentId)!;
          if (!(await yearbookPhotos(service, school, student)).some(photo => photo.storage_path === row.mediaKey)) throw new YearbookError("A selected portrait was removed during export. Refresh and download again.");
          yield { name: row.filename, data: await r2Download(row.mediaKey, { maxBytes: 100 * 1024 * 1024 }) };
        }
      }
      return new Response(createZipStream(entries()), { headers: { ...headers, "Content-Disposition": `attachment; filename="yearbook-${school.id}-batch-${batch + 1}.zip"`, "Content-Type": "application/zip" } });
    }
    const byStudent = new Map(selections.map(row => [row.student_id, row]));
    return NextResponse.json({ ok: true, settings, students: students.map(student => ({ id: student.id, name: `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim(), className: student.class_name, selection: byStudent.get(student.id) ?? null })), selectedCount: selections.filter(row => students.some(student => student.id === row.student_id)).length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: NextRequest, context: { params: Promise<{ schoolId: string }> }) {
  try {
    const { service, school } = await ownerAccess(request, (await context.params).schoolId, true);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") throw new YearbookError("Invalid request.", 400);
    if (body.action === "select") {
      if (!isUuid(body.studentId)) throw new YearbookError("Invalid student.", 400);
      const { data: student, error } = await service.from("students").select(yearbookStudentFields).eq("id", body.studentId).eq("school_id", school.id).maybeSingle<YearbookStudent>();
      if (error) throw error;
      if (!student) throw new YearbookError("Student not found.", 404);
      const selection = await saveYearbookSelection(service, { school, student, mediaKey: body.mediaKey, expectedRevision: body.expectedRevision, source: "photographer" });
      return NextResponse.json({ ok: true, selection }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action !== "settings" || typeof body.enabled !== "boolean" || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) throw new YearbookError("Invalid yearbook settings.", 400);
    let deadline: string | null;
    try { deadline = yearbookDeadline(body.deadline); } catch { throw new YearbookError("Choose a valid deadline.", 400); }
    const { data, error } = await service.rpc("save_school_yearbook_settings", { p_school_id: school.id, p_photographer_id: school.photographer_id, p_enabled: body.enabled, p_deadline: deadline, p_expected_revision: body.expectedRevision });
    if (error?.code === "40001") throw new YearbookError("Settings changed. Reload before saving again.");
    if (error?.code === "42501") throw new YearbookError("School access changed.", 403);
    if (error) throw error;
    return NextResponse.json({ ok: true, settings: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

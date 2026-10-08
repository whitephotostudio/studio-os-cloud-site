import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { schoolPreviewUrl } from "@/lib/school-portal-media";
import { yearbookIsOpen } from "@/lib/school-yearbook";
import { YearbookError, yearbookParentAccess, yearbookPhotos, loadYearbookSettings, loadYearbookSelection, saveYearbookSelection } from "@/lib/school-yearbook-server";

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    const limit = await rateLimit(getClientIp(request), { namespace: "school-yearbook", limit: 30, windowSeconds: 60 });
    if (!limit.allowed) return NextResponse.json({ ok: false, message: "Please wait before trying again." }, { status: 429, headers: { "Retry-After": "60" } });
    const body = await request.json().catch(() => ({}));
    if (!body || typeof body !== "object" || !["load", "select"].includes(body.action)) throw new YearbookError("Choose a valid action.", 400);
    const service = createDashboardServiceClient();
    const access = await yearbookParentAccess(service, body);
    const settings = await loadYearbookSettings(service, access.school.id);
    if (body.action === "select") {
      const student = access.students.find(row => row.id === body.studentId);
      if (!student) throw new YearbookError("Student not found for this gallery and PIN.", 404);
      const selection = await saveYearbookSelection(service, { school: access.school, student, mediaKey: body.mediaKey, expectedRevision: body.expectedRevision, source: "parent", pin: access.pin, email: access.email });
      return NextResponse.json({ ok: true, selection }, { headers: { "Cache-Control": "no-store" } });
    }
    // When disabled, do not expose an additional student/photo surface.
    if (!settings.enabled) return NextResponse.json({ ok: true, settings, open: false, students: [] }, { headers: { "Cache-Control": "no-store" } });
    const students = await Promise.all(access.students.map(async student => {
      const [photos, saved] = await Promise.all([yearbookPhotos(service, access.school, student), loadYearbookSelection(service, access.school.id, student.id)]);
      return {
        id: student.id, name: `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim(), className: student.class_name,
        selection: saved, selectionAvailable: !!saved && photos.some(photo => photo.storage_path === saved.media_key),
        photos: photos.map(photo => ({ mediaKey: photo.storage_path, filename: photo.filename, previewUrl: schoolPreviewUrl({ school: access.school, students: [student], email: access.email, mediaKey: photo.storage_path, kind: "school-gallery-preview" }) })),
      };
    }));
    return NextResponse.json({ ok: true, settings, open: yearbookIsOpen(settings), students }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!(error instanceof YearbookError)) console.error("[yearbook:parent]", error);
    return NextResponse.json({ ok: false, message: error instanceof YearbookError ? error.message : "Yearbook selection is temporarily unavailable. Please try again." }, { status: error instanceof YearbookError ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  }
}

import "server-only";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { hasCalendarBoundaryPassed } from "@/lib/calendar-dates";
import { validateEventGalleryAccess } from "@/lib/event-gallery-access";

export type ParentGalleryCredentials = {
  kind: "school" | "event";
  galleryId: string;
  pin: string;
  email: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";

export function normalizeParentGalleryCredentials(input: ParentGalleryCredentials): ParentGalleryCredentials | null {
  const kind = input?.kind;
  const galleryId = clean(input?.galleryId).toLowerCase();
  const pin = clean(input?.pin);
  const email = clean(input?.email).toLowerCase();
  if ((kind !== "school" && kind !== "event") || !UUID.test(galleryId) || !pin || pin.length > 64 ||
    email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return { kind, galleryId, pin, email };
}

/** Read-only authentication. Session issuance never registers or emails a parent. */
export async function validateParentGalleryCredentials(input: ParentGalleryCredentials) {
  const credentials = normalizeParentGalleryCredentials(input);
  if (!credentials) return { ok: false as const, status: 400, message: "Invalid gallery access request." };
  if (credentials.kind === "event") {
    const access = await validateEventGalleryAccess({
      projectId: credentials.galleryId, pin: credentials.pin, email: credentials.email,
    });
    if (!access.ok) return access;
    if (!access.project.photographer_id || !UUID.test(access.project.photographer_id)) {
      return { ok: false as const, status: 403, message: "Gallery access is unavailable." };
    }
    return { ok: true as const, credentials, photographerId: access.project.photographer_id.toLowerCase() };
  }

  const service = createDashboardServiceClient();
  const { data: school, error: schoolError } = await service.from("schools")
    .select("id,photographer_id,status,portal_status,expiration_date")
    .eq("id", credentials.galleryId).maybeSingle();
  if (schoolError) throw schoolError;
  if (!school) return { ok: false as const, status: 404, message: "School gallery not found." };
  if (hasCalendarBoundaryPassed(school.expiration_date)) {
    return { ok: false as const, status: 409, message: "This gallery is no longer available." };
  }
  // Match the current school gallery-context boundary, including portal_status precedence.
  const status = clean(school.portal_status ?? school.status).toLowerCase().replaceAll("-", "_");
  if (status === "pre_release") {
    return { ok: false as const, status: 409, message: "This gallery is not available yet." };
  }
  if (!UUID.test(clean(school.photographer_id))) {
    return { ok: false as const, status: 403, message: "Gallery access is unavailable." };
  }
  const { data: students, error: studentError } = await service.from("students")
    .select("id,school_id").eq("school_id", credentials.galleryId).eq("pin", credentials.pin).limit(1);
  if (studentError) throw studentError;
  if (!students?.length) {
    return { ok: false as const, status: 404, message: "No gallery was found for that school and PIN." };
  }
  return { ok: true as const, credentials, photographerId: clean(school.photographer_id).toLowerCase() };
}

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildSchoolClassEmailAudience,
  type SchoolGalleryBookingEmailRow,
  type SchoolGalleryRosterStudentRow,
  type SchoolPreReleaseRegistration,
  type SchoolStudentEmailContact,
} from "@/lib/school-gallery-email-personalization";

// Page through rows: a school's audience must not depend on the REST row cap.
async function schoolRows<T>(service: SupabaseClient, schoolId: string, table: string, columns: string, order: string) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = service.from(table).select(columns).eq("school_id", schoolId);
    for (const column of order.split(",")) query = query.order(column);
    const { data, error } = await query.range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data ?? []) as unknown as T[]);
    if ((data ?? []).length < 500) return rows;
  }
}

export async function loadSchoolClassEmailAudience(service: SupabaseClient, schoolId: string, classNames: string[], onlyWithPhotos: boolean, includeClassRegistrations = false) {
  const [students, bookings, contacts, prereleaseRegistrations] = await Promise.all([
    schoolRows<SchoolGalleryRosterStudentRow & { school_id: string; photo_url: string | null }>(service, schoolId, "students", "id,school_id,first_name,last_name,pin,parent_email,class_name,role,photo_url", "id"),
    schoolRows<SchoolGalleryBookingEmailRow>(service, schoolId, "bookings", "id,parent_email,access_pin,student_first_name,student_last_name,class_name,status", "id"),
    schoolRows<SchoolStudentEmailContact>(service, schoolId, "school_student_email_contacts", "student_id,email", "student_id,email"),
    schoolRows<SchoolPreReleaseRegistration>(service, schoolId, "pre_release_registrations", "email,class_names", "email"),
  ]);
  const audience = buildSchoolClassEmailAudience({ students, bookings, contacts, prereleaseRegistrations, classNames, onlyWithPhotos, includeClassRegistrations });
  const fingerprint = createHash("sha256").update(JSON.stringify({
    schoolId, classNames: [...new Set(classNames)].sort(), onlyWithPhotos, includeClassRegistrations,
    deliveries: audience.deliveries.map((d) => [d.recipientEmail, d.studentPin, d.studentId, d.bookingId, d.className, d.studentName]).sort(),
  })).digest("hex");
  return { ...audience, fingerprint };
}

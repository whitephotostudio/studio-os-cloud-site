import type { SupabaseClient } from "@supabase/supabase-js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const validPin = (value: string) => !!value && value.length <= 64 && !/[\u0000-\u001f\u007f]/.test(value);
function emailAddress(value: unknown) {
  const email = clean(value).toLowerCase();
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

/** Complete URL context is required even in a fresh browser with no session storage. */
export function schoolParentGalleryPath(input: {
  schoolId: unknown; pin: unknown; email: unknown; tab?: "orders";
}) {
  const schoolId = clean(input.schoolId), pin = clean(input.pin), email = emailAddress(input.email);
  if (!uuid.test(schoolId) || !validPin(pin) || !email) return null;
  const query = new URLSearchParams({ mode: "school", school: schoolId, email });
  if (input.tab) query.set("tab", input.tab);
  return `/parents/${encodeURIComponent(pin)}?${query.toString()}`;
}

export class SchoolCheckoutReturnError extends Error {}

type CheckoutOrder = {
  id: string; photographer_id: string | null; school_id: string | null; student_id: string | null;
  customer_email: string | null; parent_email: string | null;
};

/** Never pair the primary order's school with another checkout lane's PIN. */
export async function schoolCheckoutReturnContext(service: SupabaseClient, input: {
  orders: CheckoutOrder[]; photographerId: string; preferredOrderId: string;
  schoolId?: unknown; pin?: unknown; email?: unknown;
}) {
  const fail = () => { throw new SchoolCheckoutReturnError("Return to your school gallery before starting checkout."); };
  const schoolIds = [...new Set(input.orders.map(order => order.school_id).filter((id): id is string => !!id && uuid.test(id)))];
  const studentIds = [...new Set(input.orders.map(order => order.student_id).filter((id): id is string => !!id && uuid.test(id)))];
  if (!schoolIds.length || !studentIds.length || input.orders.some(order => order.photographer_id !== input.photographerId)) fail();
  const [schools, students] = await Promise.all([
    service.from("schools").select("id").in("id", schoolIds).eq("photographer_id", input.photographerId),
    service.from("students").select("id,school_id,pin").in("id", studentIds).in("school_id", schoolIds),
  ]);
  if (schools.error) throw schools.error;
  if (students.error) throw students.error;
  const ownedSchools = new Set((schools.data ?? []).map(school => school.id));
  const studentsById = new Map((students.data ?? []).map(student => [student.id, student]));
  const requestedSchool = clean(input.schoolId), requestedPin = clean(input.pin), requestedEmail = clean(input.email);
  if ((requestedSchool && !uuid.test(requestedSchool)) || (requestedPin && !validPin(requestedPin)) ||
      (requestedEmail && !emailAddress(requestedEmail))) fail();
  const candidates = input.orders.flatMap(order => {
    const student = studentsById.get(order.student_id);
    if (!student || student.school_id !== order.school_id || !ownedSchools.has(order.school_id) || !validPin(clean(student.pin))) return [];
    if ((requestedSchool && order.school_id !== requestedSchool) || (requestedPin && clean(student.pin) !== requestedPin)) return [];
    return [{ order, schoolId: order.school_id!, pin: clean(student.pin) }];
  });
  // Older clients may omit school/email. Prefer their persisted order; otherwise
  // require one unambiguous school/PIN pair among the validated group members.
  const preferred = candidates.find(candidate => candidate.order.id === input.preferredOrderId);
  if (!preferred && new Set(candidates.map(candidate => `${candidate.schoolId}:${candidate.pin}`)).size !== 1) fail();
  const selected = preferred ?? candidates[0];
  if (!selected) fail();
  const email = emailAddress(requestedEmail) || emailAddress(selected.order.customer_email) || emailAddress(selected.order.parent_email);
  const path = schoolParentGalleryPath({ schoolId: selected.schoolId, pin: selected.pin, email });
  if (!path) fail();
  return { path: path!, schoolId: selected.schoolId, pin: selected.pin, email, orderId: selected.order.id };
}

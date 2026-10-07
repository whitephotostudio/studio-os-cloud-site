import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasCurrentDigitalPayment } from "@/lib/digital-entitlement-payment";
import { matchesSchoolVisitorFilters, visitorEmail, type SchoolVisitorFilters } from "@/lib/school-visitor-filters";

type Row = Record<string, unknown>;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const records = (value: unknown): Row[] => Array.isArray(value) ? value.filter(row => row && typeof row === "object") as Row[] : [];
const names = (values: unknown[]) => [...new Set(values.map(text).filter(Boolean))];
const studentRecord = (value: unknown): Row => (Array.isArray(value) ? value[0] : value) as Row || {};

/** Stable paging prevents the REST row cap from silently dropping orders or
 * registrations, which would incorrectly put buyers in a reminder audience. */
export async function schoolVisitorRows(service: SupabaseClient, schoolId: string, table: string, columns = "*", order = "id", optional = false) {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = service.from(table).select(columns).eq("school_id", schoolId);
    for (const column of order.split(",")) query = query.order(column);
    const { data, error } = await query.range(offset, offset + 499);
    if (error) {
      if (optional && error.code === "42P01") return [];
      throw error;
    }
    rows.push(...(data ?? []) as unknown as Row[]);
    if ((data ?? []).length < 500) return rows;
  }
}

export async function loadSchoolVisitorData(service: SupabaseClient, schoolId: string) {
  const [visitors, registrations, orders, students, contacts, downloads, favorites] = await Promise.all([
    schoolVisitorRows(service, schoolId, "school_gallery_visitors"),
    schoolVisitorRows(service, schoolId, "pre_release_registrations", "id,email,created_at,class_names"),
    schoolVisitorRows(service, schoolId, "orders", `id,status,payment_status,paid_at,refund_status,refund_amount_cents,total_cents,subtotal_cents,tax_cents,currency,
      created_at,parent_email,customer_email,customer_name,parent_name,package_name,cart_snapshot,special_notes,
      student:students(id,first_name,last_name,class_name),
      items:order_items(id,product_name,quantity,price,unit_price_cents,line_total_cents,sku)`),
    schoolVisitorRows(service, schoolId, "students", "id,first_name,last_name,class_name,parent_email"),
    schoolVisitorRows(service, schoolId, "school_student_email_contacts", "student_id,email", "student_id,email"),
    schoolVisitorRows(service, schoolId, "school_gallery_downloads"),
    schoolVisitorRows(service, schoolId, "school_gallery_favorites", "*", "id", true),
  ]);
  return { visitors, registrations, orders, students, contacts, downloads, favorites };
}

export type SchoolVisitorData = Awaited<ReturnType<typeof loadSchoolVisitorData>>;

function paidOrder(order: Row) {
  const payment = text(order.payment_status).toLowerCase();
  if (payment) return ["paid", "succeeded", "no_payment_required", "partially_refunded", "refunded"].includes(payment);
  return !!text(order.paid_at) || ["paid", "digital_paid"].includes(text(order.status).toLowerCase());
}

function paidDigitalOrder(order: Row) {
  if (!hasCurrentDigitalPayment(order) || !(Number(order.total_cents) > 0)) return false;
  // Use purchased product labels, never an image URL/SKU (a print also has
  // a .jpg URL). Retouch services and free gallery downloads are separate.
  const digitalLabel = (value: unknown) => /digital|download|usb/i.test(text(value)) && !/retouch/i.test(text(value));
  return digitalLabel(order.package_name) || ["digital_paid", "digital_sent"].includes(text(order.status).toLowerCase()) ||
    records(order.items).some(item => digitalLabel(item.product_name)) ||
    records(order.cart_snapshot).some(entry => digitalLabel(entry.packageName));
}

export function buildSchoolVisitorAudience(data: SchoolVisitorData) {
  const byEmail = new Map<string, { id: string; email: string; firstVisit: string; lastVisit: string; preRelease: boolean; alsoPreRelease: boolean; registrationClasses: string[] }>();
  for (const visitor of data.visitors) {
    const email = visitorEmail(visitor.viewer_email);
    if (!email) continue;
    const previous = byEmail.get(email);
    const lastVisit = text(visitor.last_opened_at);
    if (!previous || lastVisit > previous.lastVisit) byEmail.set(email, {
      id: text(visitor.id), email, firstVisit: text(visitor.created_at), lastVisit,
      preRelease: false, alsoPreRelease: false, registrationClasses: [],
    });
  }
  for (const registration of data.registrations) {
    const email = visitorEmail(registration.email);
    if (!email) continue;
    const row = byEmail.get(email) || {
      id: `pre_${text(registration.id)}`, email, firstVisit: text(registration.created_at), lastVisit: text(registration.created_at),
      preRelease: true, alsoPreRelease: false, registrationClasses: [],
    };
    row.alsoPreRelease = !row.preRelease;
    row.registrationClasses = names([...row.registrationClasses, ...(Array.isArray(registration.class_names) ? registration.class_names : [])]);
    byEmail.set(email, row);
  }
  // Include purchasing families even if an older visitor row is missing.
  // Their email is read-only here: editing it would change an issued order.
  for (const order of data.orders) for (const address of [order.parent_email, order.customer_email]) {
    const email = visitorEmail(address);
    if (email && !byEmail.has(email)) byEmail.set(email, { id: `order_${text(order.id)}_${email}`, email,
      firstVisit: text(order.created_at), lastVisit: text(order.created_at), preRelease: false, alsoPreRelease: false, registrationClasses: [] });
  }
  return [...byEmail.values()].map(visitor => {
    const orders = data.orders.filter(order => [visitorEmail(order.parent_email), visitorEmail(order.customer_email)].includes(visitor.email));
    const linkedIds = new Set(data.contacts.filter(contact => visitorEmail(contact.email) === visitor.email).map(contact => text(contact.student_id)));
    const students = data.students.filter(student => linkedIds.has(text(student.id)) || visitorEmail(student.parent_email) === visitor.email);
    const linkedStudents = [...students, ...orders.map(order => studentRecord(order.student))];
    const downloads = data.downloads.filter(download => visitorEmail(download.viewer_email) === visitor.email);
    const favorites = data.favorites.filter(favorite => visitorEmail(favorite.viewer_email) === visitor.email);
    return { ...visitor,
      classNames: names([...visitor.registrationClasses, ...linkedStudents.map(student => student.class_name)]),
      studentNames: names(linkedStudents.map(student => `${text(student.first_name)} ${text(student.last_name)}`.trim())),
      rawOrders: orders, orders: orders.map(order => ({ id: text(order.id) })),
      orderCount: orders.length, hasPaidOrder: orders.some(paidOrder), hasDigitalPurchase: orders.some(paidDigitalOrder),
      downloadCount: downloads.reduce((sum, download) => sum + (Number(download.download_count) || 0), 0), favoriteCount: favorites.length,
    };
  }).sort((a, b) => b.lastVisit.localeCompare(a.lastVisit));
}

export function schoolVisitorEmailAudience(schoolId: string, data: SchoolVisitorData, visitorIds: string[], filters: SchoolVisitorFilters) {
  const selected = new Set(visitorIds);
  const visitors = buildSchoolVisitorAudience(data).filter(visitor => selected.has(visitor.id));
  if (visitors.length !== selected.size || visitors.some(visitor => !matchesSchoolVisitorFilters(visitor, filters))) {
    throw new Error("The recipient list changed. Refresh the report and review recipients again.");
  }
  const recipients = [...new Set(visitors.map(visitor => visitor.email))].sort();
  const fingerprint = createHash("sha256").update(JSON.stringify({ schoolId, filters, recipients,
    visitors: visitors.map(visitor => [visitor.id, visitor.classNames, visitor.rawOrders.map(order =>
      [order.id, order.status, order.payment_status, order.paid_at, order.refund_status, order.refund_amount_cents])]).sort(),
  })).digest("hex");
  return { recipients, fingerprint };
}

import { buildSchoolVisitorAudience, type SchoolVisitorData } from "@/lib/school-visitor-audience";
import { DEFAULT_SCHOOL_VISITOR_FILTERS, matchesSchoolVisitorFilters, visitorEmail, type SchoolVisitorFilters } from "@/lib/school-visitor-filters";

export type SchoolDeadlineReminderSource = "gallery_visitor" | "registration" | "roster_parent" | "school_contact";
export type SchoolDeadlineReminderRecipient = {
  id: string;
  email: string;
  classNames: string[];
  registrationClasses: string[];
  studentNames: string[];
  orderCount: number;
  /** A gallery-captured email does not establish whether its owner is a parent
   * or a student. Only the roster/contact sources establish a saved parent link. */
  sources: SchoolDeadlineReminderSource[];
};

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

/** Build the school's known-contact audience, including parents who have not
 * visited or registered. The caller must load the entire school data set and
 * fail closed on read errors before using this result for delivery. */
export function buildSchoolDeadlineReminderAudience(data: SchoolVisitorData, filters: Partial<SchoolVisitorFilters> = {}, allowedClassNames?: ReadonlySet<string>): SchoolDeadlineReminderRecipient[] {
  const sources = new Map<string, Set<SchoolDeadlineReminderSource>>();
  const addSource = (value: unknown, source: SchoolDeadlineReminderSource) => {
    const email = visitorEmail(value);
    // Keep malformed saved addresses in the audience so the durable sender
    // can record an individual failure without attempting provider delivery.
    if (!email) return;
    const current = sources.get(email) ?? new Set<SchoolDeadlineReminderSource>();
    current.add(source);
    sources.set(email, current);
  };
  for (const visitor of data.visitors) addSource(visitor.viewer_email, "gallery_visitor");
  for (const registration of data.registrations) addSource(registration.email, "registration");
  const studentIds = new Set(data.students.map(student => text(student.id)).filter(Boolean));
  for (const student of data.students) addSource(student.parent_email, "roster_parent");
  for (const contact of data.contacts) {
    // A stale contact without a student in this school cannot establish a
    // school parent relationship or pull an unrelated family into a reminder.
    if (studentIds.has(text(contact.student_id))) addSource(contact.email, "school_contact");
  }
  const rosterOnly = [...sources].filter(([, origin]) => !origin.has("gallery_visitor") && !origin.has("registration"));
  // Use the report's existing class/name/order enrichment. Synthetic seeds
  // only make these known roster parents available to that shared logic;
  // sources below preserve their real origin rather than claiming a visit or
  // an opt-in registration that never happened.
  const audience = buildSchoolVisitorAudience({
    ...data,
    registrations: [...data.registrations, ...rosterOnly.map(([email]) => ({ id: `deadline_parent_${email}`, email, class_names: [], created_at: "" }))],
  });
  const chosen = { ...DEFAULT_SCHOOL_VISITOR_FILTERS, ...filters, orders: "no_orders" as const, activity: "all" as const };
  return audience.filter(visitor => {
    const origin = sources.get(visitor.email);
    if (!origin || !matchesSchoolVisitorFilters(visitor, chosen)) return false;
    // The same class must have photos AND fall inside the selected range.
    // A photographed younger sibling cannot qualify an unshot older class.
    if (allowedClassNames && !visitor.classNames.some(className => allowedClassNames.has(className) &&
      matchesSchoolVisitorFilters({ ...visitor, classNames: [className] }, chosen))) return false;
    if (filters.activity === "registered" && !origin.has("registration")) return false;
    if (filters.activity === "visited" && !origin.has("gallery_visitor")) return false;
    if (filters.activity === "favorites" && !visitor.favoriteCount) return false;
    if (filters.activity === "downloads" && !visitor.downloadCount) return false;
    return true;
  }).map(visitor => ({
    id: visitor.id,
    email: visitor.email,
    classNames: visitor.classNames,
    registrationClasses: visitor.registrationClasses,
    studentNames: visitor.studentNames,
    orderCount: visitor.orderCount,
    sources: [...sources.get(visitor.email)!].sort(),
  })).sort((a, b) => a.email.localeCompare(b.email));
}

export type SchoolVisitorFilters = {
  search: string;
  className: string;
  classMode?: "single" | "range";
  classFrom?: string;
  classTo?: string;
  orders: "all" | "ordered" | "no_orders" | "paid" | "unpaid" | "digitals";
  activity: "all" | "registered" | "visited" | "favorites" | "downloads";
};

export const DEFAULT_SCHOOL_VISITOR_FILTERS: SchoolVisitorFilters = {
  search: "", className: "", classMode: "single", classFrom: "", classTo: "", orders: "all", activity: "all",
};

export type SchoolVisitorAudienceEntry = {
  id: string;
  email: string;
  classNames: string[];
  registrationClasses: string[];
  studentNames: string[];
  orderCount: number;
  hasPaidOrder: boolean;
  hasDigitalPurchase: boolean;
  favoriteCount: number;
  downloadCount: number;
  preRelease: boolean;
  alsoPreRelease?: boolean;
  orders: { id: string; studentName?: string; className?: string }[];
};

export function visitorEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

const classCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function classParts(value: string) {
  const match = value.trim().match(/^(?:grade\s*)?(\d+)\s*(.*)$/i);
  return match ? { grade: Number(match[1]), section: match[2].trim() } : null;
}

export function schoolVisitorClassGrade(value: string) {
  return classParts(value)?.grade ?? null;
}

/** Keep Grade 7 A / 7A before Grade 10, including schools that mix labels. */
export function compareSchoolVisitorClasses(left: string, right: string) {
  const a = classParts(left), b = classParts(right);
  if (a && b) return a.grade - b.grade || classCollator.compare(a.section, b.section);
  return classCollator.compare(left, right);
}

export function isSchoolVisitorClassRangeValid(from = "", to = "") {
  if (!from.trim() || !to.trim()) return false;
  const first = classParts(from), last = classParts(to);
  if (first && last && first.grade === last.grade && (!first.section || !last.section)) return true;
  return compareSchoolVisitorClasses(from, to) <= 0;
}

function matchesClassRange(className: string, from: string, to: string) {
  if (!isSchoolVisitorClassRangeValid(from, to)) return false;
  const current = classParts(className), first = classParts(from), last = classParts(to);
  // A grade without a section is a whole-grade boundary: "Grade 12"
  // includes Grade 12 A, B, etc., even if no class has that exact label.
  const afterStart = first && current && !first.section
    ? current.grade >= first.grade : compareSchoolVisitorClasses(className, from) >= 0;
  const beforeEnd = last && current && !last.section
    ? current.grade <= last.grade : compareSchoolVisitorClasses(className, to) <= 0;
  return afterStart && beforeEnd;
}

export function matchesSchoolVisitorFilters(visitor: SchoolVisitorAudienceEntry, filters: SchoolVisitorFilters) {
  if (filters.classMode === "range") {
    if (!visitor.classNames.some(name => matchesClassRange(name, filters.classFrom?.trim() ?? "", filters.classTo?.trim() ?? ""))) return false;
  } else if (filters.className && !visitor.classNames.includes(filters.className)) return false;
  if (filters.orders === "ordered" && visitor.orderCount === 0) return false;
  // An unpaid or cancelled order is still an order. Never target its family
  // as someone who has not ordered; they have a separate filter.
  if (filters.orders === "no_orders" && visitor.orderCount !== 0) return false;
  if (filters.orders === "paid" && !visitor.hasPaidOrder) return false;
  if (filters.orders === "unpaid" && (!visitor.orderCount || visitor.hasPaidOrder)) return false;
  if (filters.orders === "digitals" && !visitor.hasDigitalPurchase) return false;
  if (filters.activity === "registered" && !(visitor.preRelease || visitor.alsoPreRelease)) return false;
  if (filters.activity === "visited" && visitor.preRelease) return false;
  if (filters.activity === "favorites" && !visitor.favoriteCount) return false;
  if (filters.activity === "downloads" && !visitor.downloadCount) return false;
  const search = filters.search.trim().toLowerCase();
  return !search || [visitor.email, ...visitor.studentNames, ...visitor.classNames,
    ...visitor.orders.map(order => order.id)].some(value => value.toLowerCase().includes(search));
}

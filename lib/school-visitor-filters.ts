export type SchoolVisitorFilters = {
  search: string;
  className: string;
  orders: "all" | "ordered" | "no_orders" | "paid" | "unpaid" | "digitals";
  activity: "all" | "registered" | "visited" | "favorites" | "downloads";
};

export const DEFAULT_SCHOOL_VISITOR_FILTERS: SchoolVisitorFilters = {
  search: "", className: "", orders: "all", activity: "all",
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

export function matchesSchoolVisitorFilters(visitor: SchoolVisitorAudienceEntry, filters: SchoolVisitorFilters) {
  if (filters.className && !visitor.classNames.includes(filters.className)) return false;
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

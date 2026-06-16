import { calendarBoundaryEnd } from "@/lib/calendar-dates";

/**
 * Shared "is ordering still open?" check for the parents portal.
 *
 * Both `projects` (event mode) and `schools` (school mode) carry
 * `order_due_date` and `expiration_date` columns. The client reads
 * project.order_due_date to disable the checkout buttons, but a scripted
 * caller hitting /api/portal/orders/create directly bypasses the UI.
 * This helper is the authoritative server-side gate.
 *
 * Both fields are optional. A selected calendar date stays open through
 * the end of that studio business day. If either boundary has passed,
 * ordering is closed.
 */
export type OrderingWindowRow = {
  order_due_date?: string | null;
  expiration_date?: string | null;
};

export function isOrderingWindowOpen(
  row: OrderingWindowRow | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!row) return true;

  const orderDue = parseBoundary(row.order_due_date);
  if (orderDue && now > orderDue) return false;

  const expiration = parseBoundary(row.expiration_date);
  if (expiration && now > expiration) return false;

  return true;
}

/**
 * Parse a date string from Postgres. Bare date values are treated as the
 * end of that calendar day in the studio business timezone.
 */
function parseBoundary(value: string | null | undefined): Date | null {
  return calendarBoundaryEnd(value);
}

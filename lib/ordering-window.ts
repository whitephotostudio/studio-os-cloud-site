/**
 * Shared "is ordering still open?" check for the parents portal.
 *
 * Both `projects` (event mode) and `schools` (school mode) carry
 * `order_due_date` and `expiration_date` columns. The client reads
 * project.order_due_date to disable the checkout buttons, but a scripted
 * caller hitting /api/portal/orders/create directly bypasses the UI.
 * This helper is the authoritative server-side gate.
 *
 * Both fields are optional. `order_due_date` means "no new orders after
 * this". `expiration_date` means "the whole gallery is archived". If
 * either has passed, ordering is closed.
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
 * Parse a date string from Postgres. Accepts both `timestamp with time
 * zone` (projects uses these for shoot/event dates, schools for
 * everything) and plain `date` values (projects uses these for
 * order_due_date / expiration_date, which come back as "YYYY-MM-DD").
 *
 * For a bare "YYYY-MM-DD", we treat it as end-of-day in UTC — parents
 * anywhere in the world get the full calendar day to finish their order,
 * rather than having ordering snap shut at 00:00 UTC on the due date.
 */
function parseBoundary(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Bare date (YYYY-MM-DD): treat as 23:59:59.999 UTC that day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}T23:59:59.999Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

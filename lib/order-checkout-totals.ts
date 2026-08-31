export type StoredOrderTotal = {
  total_cents?: number | null;
  total_amount?: number | null;
};

export type StoredOrderItemTotal = {
  line_total_cents?: number | null;
  unit_price_cents?: number | null;
  quantity?: number | null;
};

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Resolve the amount that one persisted order contributes to Stripe.
 * `total_cents` is authoritative; `total_amount` is retained only for legacy
 * rows created before cent-based totals were added.
 */
export function storedOrderTotalCents(order: StoredOrderTotal): number | null {
  const cents =
    order.total_cents == null
      ? Math.round((finiteNumber(order.total_amount) ?? 0) * 100)
      : Math.round(finiteNumber(order.total_cents) ?? Number.NaN);

  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

/** Sum every member of an order group exactly once. */
export function sumStoredOrderTotalsCents(
  orders: readonly StoredOrderTotal[],
): number | null {
  if (orders.length === 0) return null;

  let total = 0;
  for (const order of orders) {
    const cents = storedOrderTotalCents(order);
    if (cents == null) return null;
    total += cents;
    if (!Number.isSafeInteger(total)) return null;
  }

  return total > 0 ? total : null;
}

/**
 * Rebuild an order subtotal from persisted line items. Negative discount rows
 * are intentional and must reduce the result; older rows without a usable
 * line total fall back to unit price multiplied by quantity.
 */
export function sumStoredOrderItemTotalsCents(
  rows: readonly StoredOrderItemTotal[],
): number {
  let total = 0;

  for (const row of rows) {
    const lineTotal = finiteNumber(row.line_total_cents);
    if (lineTotal != null && lineTotal !== 0) {
      total += lineTotal;
      continue;
    }

    const unit = finiteNumber(row.unit_price_cents);
    const quantity = finiteNumber(row.quantity);
    if (unit != null && unit !== 0 && quantity != null && quantity > 0) {
      total += unit * quantity;
    }
  }

  return total;
}

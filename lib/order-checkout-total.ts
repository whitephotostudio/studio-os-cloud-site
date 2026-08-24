export type StoredCheckoutOrder = {
  id: string;
  order_group_id: string | null;
  photographer_id: string | null;
  subtotal_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  total_amount: number | null;
  currency: string | null;
  status: string | null;
  payment_status: string | null;
};

export type StoredCheckoutItem = {
  order_id: string;
  line_total_cents: number | null;
  unit_price_cents: number | null;
  quantity: number | null;
};

export type ResolvedCheckoutCharge = {
  orderIds: string[];
  orderGroupId: string | null;
  photographerId: string;
  currency: string;
  totalCents: number;
};

function requiredIntegerCents(value: unknown, label: string, minimum = 0) {
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents < minimum) {
    throw new Error(`${label} is invalid.`);
  }
  return cents;
}

function normalizedCurrency(value: string | null | undefined) {
  return (value ?? "cad").trim().toLowerCase();
}

function storedOrderAmounts(order: StoredCheckoutOrder) {
  const fallbackTotalCents = Math.round(Number(order.total_amount ?? 0) * 100);
  const totalCents = requiredIntegerCents(
    order.total_cents ?? fallbackTotalCents,
    `Order ${order.id} total`,
    1,
  );
  const taxCents = requiredIntegerCents(order.tax_cents ?? 0, `Order ${order.id} tax`);
  const subtotalCents = requiredIntegerCents(
    order.subtotal_cents ?? totalCents - taxCents,
    `Order ${order.id} subtotal`,
  );
  return { subtotalCents, taxCents, totalCents };
}

function isPaid(order: StoredCheckoutOrder) {
  const status = (order.status ?? "").trim().toLowerCase();
  const paymentStatus = (order.payment_status ?? "").trim().toLowerCase();
  return (
    status === "paid" ||
    status === "digital_paid" ||
    paymentStatus === "paid" ||
    paymentStatus === "succeeded" ||
    paymentStatus === "no_payment_required"
  );
}

/**
 * Resolve the one Stripe charge represented by an order row. Combined
 * checkouts persist one order per child/school, so the charge must include
 * every row sharing the seed order's exact order_group_id.
 */
export function resolveStoredCheckoutCharge(input: {
  seedOrderId: string;
  orders: StoredCheckoutOrder[];
  requireUnpaid?: boolean;
}): ResolvedCheckoutCharge {
  const seed = input.orders.find((order) => order.id === input.seedOrderId);
  if (!seed) throw new Error("Checkout order was not found.");

  const groupId = seed.order_group_id?.trim() || null;
  const expectedOrders = groupId
    ? input.orders.filter((order) => order.order_group_id === groupId)
    : input.orders.filter((order) => order.id === seed.id);

  if (expectedOrders.length !== input.orders.length || expectedOrders.length === 0) {
    throw new Error("Checkout order group is invalid.");
  }
  if (!groupId && expectedOrders.length !== 1) {
    throw new Error("Single checkout contains unrelated orders.");
  }

  const photographerId = seed.photographer_id?.trim() || "";
  if (!photographerId) throw new Error("Checkout photographer is missing.");
  const currency = normalizedCurrency(seed.currency);
  if (!currency) throw new Error("Checkout currency is missing.");

  const seenIds = new Set<string>();
  let totalCents = 0;
  for (const order of expectedOrders) {
    if (!order.id || seenIds.has(order.id)) {
      throw new Error("Checkout order group contains duplicate orders.");
    }
    seenIds.add(order.id);
    if ((order.photographer_id?.trim() || "") !== photographerId) {
      throw new Error("Checkout order group has mixed photographers.");
    }
    if (normalizedCurrency(order.currency) !== currency) {
      throw new Error("Checkout order group has mixed currencies.");
    }
    if (input.requireUnpaid && isPaid(order)) {
      throw new Error("This order has already been paid.");
    }
    const amounts = storedOrderAmounts(order);
    totalCents += amounts.totalCents;
    if (!Number.isSafeInteger(totalCents)) {
      throw new Error("Checkout total is too large.");
    }
  }

  return {
    orderIds: [...seenIds].sort(),
    orderGroupId: groupId,
    photographerId,
    currency,
    totalCents,
  };
}

/**
 * Reconcile every stored order subtotal against its order_items. Discount
 * lines are intentionally signed (negative), while shipping/handling lines
 * are positive. The small tolerance preserves compatibility with older
 * split-slot rows created before exact-cent allocation was introduced.
 */
export function reconcileStoredCheckoutItems(input: {
  orders: StoredCheckoutOrder[];
  items: StoredCheckoutItem[];
  toleranceCents?: number;
}) {
  const toleranceCents = requiredIntegerCents(
    input.toleranceCents ?? 2,
    "Checkout reconciliation tolerance",
  );
  const ordersById = new Map(input.orders.map((order) => [order.id, order]));
  const itemsByOrderId = new Map<string, StoredCheckoutItem[]>();

  for (const item of input.items) {
    if (!ordersById.has(item.order_id)) {
      throw new Error("Checkout contains an item for an unrelated order.");
    }
    const bucket = itemsByOrderId.get(item.order_id) ?? [];
    bucket.push(item);
    itemsByOrderId.set(item.order_id, bucket);
  }

  for (const order of input.orders) {
    const orderItems = itemsByOrderId.get(order.id) ?? [];
    if (orderItems.length === 0) {
      throw new Error(`Order ${order.id} has no line items.`);
    }

    let computedSubtotalCents = 0;
    for (const item of orderItems) {
      let lineTotalCents: number;
      if (item.line_total_cents != null) {
        lineTotalCents = requiredIntegerCents(
          Math.abs(Number(item.line_total_cents)),
          `Order ${order.id} line total`,
        );
        if (Number(item.line_total_cents) < 0) lineTotalCents *= -1;
      } else {
        const unitPriceCents = Number(item.unit_price_cents);
        const quantity = requiredIntegerCents(item.quantity, `Order ${order.id} quantity`, 1);
        if (!Number.isSafeInteger(unitPriceCents)) {
          throw new Error(`Order ${order.id} unit price is invalid.`);
        }
        lineTotalCents = unitPriceCents * quantity;
      }
      computedSubtotalCents += lineTotalCents;
      if (!Number.isSafeInteger(computedSubtotalCents)) {
        throw new Error(`Order ${order.id} item total is too large.`);
      }
    }

    const { subtotalCents, taxCents, totalCents } = storedOrderAmounts(order);
    if (Math.abs(computedSubtotalCents - subtotalCents) > toleranceCents) {
      throw new Error(`Order ${order.id} line items do not match its subtotal.`);
    }
    if (Math.abs(subtotalCents + taxCents - totalCents) > toleranceCents) {
      throw new Error(`Order ${order.id} subtotal and tax do not match its total.`);
    }
  }
}

export function assertStripePaymentMatches(input: {
  expected: ResolvedCheckoutCharge;
  amountCents: unknown;
  currency: string | null | undefined;
}) {
  const amountCents = requiredIntegerCents(input.amountCents, "Stripe payment amount");
  if (amountCents !== input.expected.totalCents) {
    throw new Error("Stripe payment amount does not match the order total.");
  }
  if (normalizedCurrency(input.currency) !== input.expected.currency) {
    throw new Error("Stripe payment currency does not match the order currency.");
  }
}

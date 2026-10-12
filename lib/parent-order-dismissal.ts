import type { PaymentOrder } from "./order-payment-policy";

export type ParentCheckoutOrder = PaymentOrder & {
  school_id: string | null;
  project_id: string | null;
  student_id: string | null;
  parent_email: string | null;
  customer_email: string | null;
  refund_status?: string | null;
  refund_amount_cents?: number | null;
  cart_snapshot?: unknown;
  parent_dismissed_at?: string | null;
};

export type ParentCheckoutGrant = {
  photographerId: string;
  email: string;
  schoolId?: string;
  studentId?: string;
  projectId?: string;
  collectionIds?: string[];
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** Hiding a deleted draft must never hide a paid, processing or refunded order. */
export function isParentDismissedCheckout(order: Parameters<typeof isUnfinishedCheckout>[0] & { parent_dismissed_at?: string | null }) {
  return !!order.parent_dismissed_at && ["cancelled", "canceled"].includes(clean(order.status)) && isUnfinishedCheckout(order, true);
}

/** The purchase recipient is authoritative; history's PIN fallback is unused. */
export function purchaseEmailMatches(order: Pick<ParentCheckoutOrder, "customer_email" | "parent_email">, email: string) {
  return (clean(order.customer_email) || clean(order.parent_email)) === clean(email) && !!clean(email);
}

/** A cart is distinct from a genuine placed order still awaiting production. */
export function isUnfinishedCheckout(order: {
  status: string | null;
  payment_status: string | null;
  paid_at: string | null;
  refund_status?: string | null;
  refund_amount_cents?: number | null;
}, allowCancellationRetry = false) {
  const statuses = allowCancellationRetry
    ? ["payment_pending", "cancel_pending", "cancelled", "canceled"]
    : ["payment_pending"];
  const refund = clean(order.refund_status);
  const refundedAmount = Number(order.refund_amount_cents ?? 0);
  return statuses.includes(clean(order.status)) && !order.paid_at &&
    ["", "pending", "unpaid", "failed", "cancelled", "canceled", "requires_payment_method", "requires_confirmation", "requires_action"].includes(clean(order.payment_status)) &&
    ["", "none", "not_refunded", "not_requested"].includes(refund) && Number.isFinite(refundedAmount) && refundedAmount === 0;
}

export function assertParentCheckoutScope(orders: ParentCheckoutOrder[], seedId: string, grant: ParentCheckoutGrant) {
  const seed = orders.find(order => order.id === seedId);
  if (!seed || !orders.length || new Set(orders.map(order => order.id)).size !== orders.length) {
    throw new Error("Checkout scope is incomplete.");
  }
  const group = seed.order_group_id;
  const collections = new Set(grant.collectionIds ?? []);
  for (const order of orders) {
    if (order.photographer_id !== grant.photographerId ||
        !purchaseEmailMatches(order, grant.email) ||
        order.order_group_id !== group || (!group && orders.length !== 1)) {
      throw new Error("This checkout is outside your purchase scope.");
    }
    if (grant.schoolId) {
      if (order.school_id !== grant.schoolId || order.project_id || order.student_id !== grant.studentId) {
        throw new Error("Every checkout member requires its own student access.");
      }
    } else if (!grant.projectId || order.project_id !== grant.projectId || order.school_id || order.student_id) {
      throw new Error("This checkout is outside your gallery.");
    }
    if (grant.projectId && Array.isArray(order.cart_snapshot)) {
      for (const entry of order.cart_snapshot) {
        const scope = entry && typeof entry === "object" ? entry.purchasedEventScope : null;
        if (scope && (scope.version !== 1 || scope.projectId !== grant.projectId ||
          !Array.isArray(scope.collectionIds) || !scope.collectionIds.length ||
          !scope.collectionIds.every((id: unknown) => typeof id === "string" && collections.has(id)))) {
          throw new Error("A checkout album is outside your access scope.");
        }
      }
    }
  }
}

export function assertUnpaidStripeCheckout(session: {
  status: string;
  payment_status: string;
} | null, intent: {
  status: string;
  amount_received: number;
} | null) {
  if (session && (!['open', 'expired'].includes(session.status) || session.payment_status !== 'unpaid')) {
    throw new Error("Checkout payment is complete or unresolved.");
  }
  if (intent && (intent.amount_received !== 0 ||
      !['requires_payment_method', 'requires_confirmation', 'requires_action', 'canceled'].includes(intent.status))) {
    throw new Error("Checkout payment is complete or processing.");
  }
}

export function checkoutScopeFingerprint(orders: ParentCheckoutOrder[]) {
  return JSON.stringify([...orders].sort((a, b) => a.id.localeCompare(b.id)).map(order => [
    order.id, order.photographer_id, order.order_group_id, order.school_id,
    order.project_id, order.student_id, clean(order.customer_email) || clean(order.parent_email),
    order.stripe_checkout_session_id, order.stripe_payment_intent_id,
    order.total_cents, clean(order.currency || 'cad'),
  ]));
}

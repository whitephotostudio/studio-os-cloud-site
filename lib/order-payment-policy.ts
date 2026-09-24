export const CLOSED_ORDER_STATUSES = ["cancelled", "canceled", "cancel_pending", "refunded", "refund_pending"];
export type PaymentOrder = {
  id: string; photographer_id: string; order_group_id: string | null;
  status: string | null; payment_status: string | null; paid_at: string | null;
  stripe_payment_intent_id: string | null; stripe_checkout_session_id: string | null;
  total_cents: number; currency: string | null;
};
export type PaymentSnapshot = {
  paymentId: string | null; currency: string; chargedCents: number; refundedCents: number;
  remainingCents: number; pending: boolean; canRefund: boolean; canCancel: boolean;
  orderIds: string[]; status: string; customer: string;
};

export function assertPaymentBelongsToOrders(orders: PaymentOrder[], payment: {
  id: string; amount: number; currency: string; metadata?: Record<string, string>;
}) {
  const group = orders[0]?.order_group_id;
  if (!orders.length || orders.some((o) => o.photographer_id !== orders[0].photographer_id) ||
      payment.metadata?.photographer_id !== orders[0].photographer_id ||
      !(orders.some((o) => o.id === payment.metadata?.order_id) || (group && payment.metadata?.order_group_id === group)) ||
      orders.some((o) => o.stripe_payment_intent_id && o.stripe_payment_intent_id !== payment.id) ||
      payment.amount !== orders.reduce((sum, o) => sum + o.total_cents, 0) ||
      orders.some((o) => (o.currency || "cad").toLowerCase() !== payment.currency.toLowerCase())) {
    throw new Error("Payment does not match this checkout. Review it in Stripe before proceeding.");
  }
}

/** Preserve the transaction total across combined orders, including odd cents. */
export function allocateRefundCents(amount: number, totals: number[]): number[] {
  const total = totals.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > total || totals.some((n) => !Number.isSafeInteger(n) || n < 0)) throw new Error("Invalid refund amount");
  // Allocate in stable order-ID order, filling each order's balance first.
  // Every member's allocation is monotonic as further partial refunds arrive;
  // rounding proportional shares could decrease a member by a cent and make
  // out-of-order webhook reconciliation overcount the transaction.
  let remaining = amount;
  return totals.map((value) => {
    const allocated = Math.min(remaining, value);
    remaining -= allocated;
    return allocated;
  });
}

export function verifyPaymentConfirmation(snapshot: PaymentSnapshot, body: {
  action: string; paymentId?: string | null; amountCents?: number; orderIds?: string[];
}) {
  if (snapshot.paymentId !== (body.paymentId || null) ||
      snapshot.remainingCents !== body.amountCents ||
      JSON.stringify([...snapshot.orderIds].sort()) !== JSON.stringify([...(body.orderIds || [])].sort())) {
    throw new Error("Payment details changed. Refresh and review the amount before confirming again.");
  }
  if (body.action === "refund" && !snapshot.canRefund) throw new Error("This payment cannot be refunded now. Refresh its status.");
  if (body.action === "cancel" && !snapshot.canCancel) throw new Error("This order cannot be cancelled without a refund. Refresh its payment status.");
}

export function orderCheckoutIdempotencyKey(orderId: string, previousExpiredSessionId?: string | null) {
  return `studio-os-order-session-${orderId}${previousExpiredSessionId ? `-${previousExpiredSessionId}` : ""}`;
}

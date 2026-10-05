type Payment = { status?: unknown; payment_status?: unknown; paid_at?: unknown; refund_status?: unknown; refund_amount_cents?: unknown };
function clean(value: unknown) { return typeof value === "string" ? value.trim().toLowerCase() : ""; }

// Workflow progress and old timestamps cannot override current payment/refund
// authority. Legacy orders need an explicit paid state, or a paid timestamp
// together with an established fulfillment state; ambiguous records need review.
export function hasCurrentDigitalPayment(order: Payment) {
  const status = clean(order.status), payment = clean(order.payment_status), refund = clean(order.refund_status);
  const refundedAmount = order.refund_amount_cents == null ? 0 : Number(order.refund_amount_cents);
  if (!Number.isFinite(refundedAmount) || refundedAmount !== 0 || (refund && !["none", "not_refunded", "not_requested"].includes(refund)) || ["refunded", "refund_pending", "cancelled", "canceled", "cancel_pending"].includes(status)) return false;
  if (payment) return ["paid", "succeeded", "no_payment_required"].includes(payment);
  return ["paid", "digital_paid"].includes(status) || (!!clean(order.paid_at) && ["digital_sent", "completed", "fulfilled"].includes(status));
}

export const CLOSED_ORDER_STATUSES = ["cancelled", "canceled", "cancel_pending", "refunded", "refund_pending"];
export type PaymentOrder = {
  id: string; photographer_id: string; order_group_id: string | null;
  status: string | null; payment_status: string | null; paid_at: string | null;
  stripe_payment_intent_id: string | null; stripe_checkout_session_id: string | null;
  total_cents: number; currency: string | null;
  platform_fee_collection_method?: string | null;
  platform_fee_amount_cents?: number | null;
  platform_fee_currency?: string | null;
  platform_fee_rate_cents?: number | null;
  stripe_application_fee_id?: string | null;
};
export type PaymentSnapshot = {
  paymentId: string | null; currency: string; chargedCents: number; refundedCents: number;
  remainingCents: number; pending: boolean; canRefund: boolean; canCancel: boolean;
  orderIds: string[]; status: string; customer: string;
  applicationFeeRefundPending?: boolean;
  canCompleteApplicationFeeRefund?: boolean;
  applicationFeeRefundRemainingCents?: number;
  applicationFeeCurrency?: string | null;
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

export type ApplicationFeeCharge = {
  id?: string;
  payment_intent?: string | { id: string } | null;
  amount: number;
  amount_refunded?: number;
  currency?: string;
  application_fee_amount?: number | null;
  application_fee?: string | { id: string } | null;
};

export type FrozenCheckoutFee = {
  collectionMethod: "connect_application_fee" | "waived";
  amountCents: number; currency: string; snapshotKey: string; billableOrderCount: number;
  rateCents: number;
};

/** Compare a validated frozen group quote with the charge before refunding any money. */
export function assertApplicationFeeMatchesCheckout(orders: PaymentOrder[], payment: {
  id: string; amount: number; currency: string; metadata?: Record<string, string>;
}, charge: ApplicationFeeCharge, fee: FrozenCheckoutFee | null) {
  const chargeFeeId = typeof charge.application_fee === "string" ? charge.application_fee : charge.application_fee?.id;
  const fail = () => { throw new Error("The saved service fee does not match this payment. Review it in Stripe before refunding."); };
  if (!fee) {
    if (orders.some((row) => row.platform_fee_collection_method != null || row.stripe_application_fee_id || (row.platform_fee_amount_cents ?? 0) !== 0) ||
        payment.metadata?.platform_fee_collection_method || (charge.application_fee_amount ?? 0) !== 0 || chargeFeeId) fail();
    return null;
  }
  const expected = {
    platform_fee_collection_method: fee.collectionMethod,
    platform_fee_amount_cents: String(fee.amountCents),
    platform_fee_currency: fee.currency,
    platform_fee_snapshot_key: fee.snapshotKey,
    platform_fee_billable_order_count: String(fee.billableOrderCount),
    platform_fee_rate_cents: String(fee.rateCents),
  };
  const chargeIntent = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  const groupId = orders[0]?.order_group_id;
  if (Object.entries(expected).some(([key, value]) => payment.metadata?.[key] !== value) ||
      orders.some((row) => row.order_group_id !== groupId) || (groupId && payment.metadata?.order_group_id !== groupId) ||
      !charge.id || chargeIntent !== payment.id || charge.amount !== payment.amount ||
      charge.currency?.toLowerCase() !== payment.currency.toLowerCase() || fee.currency !== payment.currency.toLowerCase() ||
      (charge.application_fee_amount ?? 0) !== fee.amountCents || fee.amountCents > payment.amount) fail();
  if (fee.collectionMethod === "waived") {
    if (chargeFeeId || orders.some((row) => row.stripe_application_fee_id)) fail();
    return null;
  }
  if (!chargeFeeId || orders.some((row) => row.stripe_application_fee_id && row.stripe_application_fee_id !== chargeFeeId)) fail();
  return chargeFeeId!;
}

export type VerifiedApplicationFee = {
  id: string; object: string; account: string | { id: string }; charge: string | { id: string };
  amount: number; amount_refunded: number; currency: string; refunded: boolean;
};

/** Charge-currency proof is separate from the fee's potentially converted settlement currency. */
export function assertApplicationFeeOwnership(fee: VerifiedApplicationFee, expected: {
  id: string; account: string; charge: string; chargeCurrency: string; chargeFeeCents: number;
}) {
  const account = typeof fee.account === "string" ? fee.account : fee.account?.id;
  const charge = typeof fee.charge === "string" ? fee.charge : fee.charge?.id;
  if (fee.id !== expected.id || fee.object !== "application_fee" || account !== expected.account || charge !== expected.charge ||
      !/^[a-z]{3}$/.test(fee.currency) || !Number.isSafeInteger(fee.amount) || fee.amount <= 0 ||
      !Number.isSafeInteger(fee.amount_refunded) || fee.amount_refunded < 0 || fee.amount_refunded > fee.amount ||
      (fee.currency === expected.chargeCurrency && fee.amount !== expected.chargeFeeCents) ||
      fee.refunded !== (fee.amount_refunded === fee.amount)) {
    throw new Error("The platform service-fee refund could not be verified for this payment.");
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

export function verifyPaymentTarget(snapshot: PaymentSnapshot, body: { paymentId?: string | null; orderIds?: string[] }) {
  if (snapshot.paymentId !== (body.paymentId || null) ||
      JSON.stringify([...snapshot.orderIds].sort()) !== JSON.stringify([...(body.orderIds || [])].sort())) {
    throw new Error("Payment details changed. Refresh and review the amount before confirming again.");
  }
}

export function verifyPaymentConfirmation(snapshot: PaymentSnapshot, body: {
  action: string; paymentId?: string | null; amountCents?: number; orderIds?: string[];
}) {
  verifyPaymentTarget(snapshot, body);
  if (snapshot.remainingCents !== body.amountCents) throw new Error("Payment details changed. Refresh and review the amount before confirming again.");
  if (body.action === "refund" && !snapshot.canRefund) throw new Error("This payment cannot be refunded now. Refresh its status.");
  if (body.action === "cancel" && !snapshot.canCancel) throw new Error("This order cannot be cancelled without a refund. Refresh its payment status.");
}

export function orderCheckoutIdempotencyKey(orderId: string, previousExpiredSessionId?: string | null) {
  return `studio-os-order-session-${orderId}${previousExpiredSessionId ? `-${previousExpiredSessionId}` : ""}`;
}

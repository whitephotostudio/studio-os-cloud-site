import { directOrderPlatformFeePayload, stripeRequest, type DirectOrderFeeSnapshotRow } from "@/lib/payments";
import { assertApplicationFeeMatchesCheckout, assertApplicationFeeOwnership, assertPaymentBelongsToOrders,
  type ApplicationFeeCharge, type PaymentOrder, type VerifiedApplicationFee } from "@/lib/order-payment-policy";

type FeeRefundContext = {
  orders: PaymentOrder[];
  account: string;
  payment: { id: string; amount: number; currency: string; metadata?: Record<string, string> };
  charge: ApplicationFeeCharge;
};
export type DirectOrderFeeRefundState = {
  refundApplicationFee: boolean;
  fullyRefunded: boolean;
  applicationFeeId: string | null;
  fee: VerifiedApplicationFee | null;
};

/** Read only. Both the connected charge and the platform fee must agree with the immutable checkout quote. */
export async function verifyDirectOrderApplicationFeeRefund(input: FeeRefundContext, request = stripeRequest): Promise<DirectOrderFeeRefundState> {
  assertPaymentBelongsToOrders(input.orders, input.payment);
  const hasSnapshot = input.orders.some((row) => row.platform_fee_collection_method != null);
  const frozen = hasSnapshot ? directOrderPlatformFeePayload(input.orders as DirectOrderFeeSnapshotRow[], input.payment.currency) : null;
  const feeId = assertApplicationFeeMatchesCheckout(input.orders, input.payment, input.charge, frozen);
  if (!feeId || !frozen) return { refundApplicationFee: false, fullyRefunded: true, applicationFeeId: null, fee: null };
  // Application fees belong to the platform; a Stripe-Account header here would address the wrong owner.
  const fee = await request<VerifiedApplicationFee>(`application_fees/${encodeURIComponent(feeId)}`);
  assertApplicationFeeOwnership(fee, { id: feeId, account: input.account, charge: input.charge.id!,
    chargeCurrency: frozen.currency, chargeFeeCents: frozen.amountCents });
  return { refundApplicationFee: true, fullyRefunded: fee.amount_refunded === fee.amount,
    applicationFeeId: fee.id, fee };
}

/** Explicit full-refund POST recovery only. Never called from a refresh or a partial-refund path. */
export async function completeDirectOrderApplicationFeeRefund(input: FeeRefundContext, request = stripeRequest) {
  if (!Number.isSafeInteger(input.charge.amount_refunded) || input.charge.amount_refunded !== input.charge.amount) {
    throw new Error("The customer payment must be fully refunded before completing its service-fee refund.");
  }
  const before = await verifyDirectOrderApplicationFeeRefund(input, request);
  if (!before.refundApplicationFee || before.fullyRefunded || !before.fee) return before;
  await request(`application_fees/${encodeURIComponent(before.fee.id)}/refunds`, { method: "POST",
    idempotencyKey: `studio-os-full-application-fee-refund-${before.fee.id}`,
    body: new URLSearchParams({ amount: String(before.fee.amount - before.fee.amount_refunded), "metadata[payment_intent_id]": input.payment.id }) });
  // A success-shaped refund response is insufficient: confirm the actual cumulative fee balance.
  return verifyDirectOrderApplicationFeeRefund(input, request);
}

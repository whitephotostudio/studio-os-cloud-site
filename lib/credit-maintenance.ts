/** Pause platform billing/credits and queue fulfillment during a schema upgrade. */
export function creditMaintenanceActive() {
  return process.env.STUDIO_CREDIT_MAINTENANCE === "1";
}

export function pausePlatformCreditEvent(event: { type: string; account?: string | null }) {
  return creditMaintenanceActive() && !event.account && [
    "checkout.session.completed", "checkout.session.async_payment_succeeded",
    "charge.refunded", "refund.updated", "refund.failed",
    "invoice.paid", "invoice.payment_failed", "customer.subscription.created",
    "customer.subscription.updated", "customer.subscription.deleted",
  ].includes(event.type);
}

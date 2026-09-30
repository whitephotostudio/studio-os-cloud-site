/** Pause credit checkout and queue platform fulfillment during a schema upgrade. */
export function creditMaintenanceActive() {
  return process.env.STUDIO_CREDIT_MAINTENANCE === "1";
}

export function pausePlatformCreditEvent(event: { type: string; account?: string | null }) {
  return creditMaintenanceActive() && !event.account && [
    "checkout.session.completed", "checkout.session.async_payment_succeeded",
    "charge.refunded", "refund.updated", "refund.failed",
  ].includes(event.type);
}

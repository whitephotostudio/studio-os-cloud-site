import { resolveOrderTotalCents, type OrderItemMoneyLike } from "@/lib/order-display";

export type MobileOrderMoneyRow = {
  created_at?: string | null;
  status?: string | null;
  parent_email?: string | null;
  customer_email?: string | null;
  total_cents?: number | null;
  total_amount?: number | null;
  subtotal_cents?: number | null;
  package_price?: number | null;
  currency?: string | null;
  payment_status?: string | null;
  paid_at?: string | null;
  stripe_checkout_session_id?: string | null;
  stripe_payment_intent_id?: string | null;
  seen_by_photographer?: boolean | null;
  items?: OrderItemMoneyLike[] | null;
};

export const MOBILE_ORDER_SELECT_MONEY = `
  total_cents, total_amount, subtotal_cents, package_price, currency,
  payment_status, paid_at, stripe_checkout_session_id, stripe_payment_intent_id,
  items:order_items(product_name, quantity, price, unit_price_cents, line_total_cents, sku)
`;

export function cleanMobileOrderValue(value: string | null | undefined) {
  return (value ?? "").trim();
}

export function mobileOrderTotalCents(order: MobileOrderMoneyRow) {
  return resolveOrderTotalCents(order, order.items);
}

export function isMobilePaidOrder(order: MobileOrderMoneyRow) {
  const paymentStatus = cleanMobileOrderValue(order.payment_status).toLowerCase();
  return (
    paymentStatus === "paid" ||
    paymentStatus === "succeeded" ||
    paymentStatus === "digital_paid" ||
    paymentStatus === "no_payment_required" ||
    !!cleanMobileOrderValue(order.paid_at) ||
    !!cleanMobileOrderValue(order.stripe_payment_intent_id)
  );
}

export function hasMobileStartedCheckout(order: MobileOrderMoneyRow) {
  return !isMobilePaidOrder(order) && !!cleanMobileOrderValue(order.stripe_checkout_session_id);
}

export function isMobileCustomerOrder(order: MobileOrderMoneyRow) {
  const buyerEmail = cleanMobileOrderValue(order.parent_email ?? order.customer_email);
  const paymentStatus = cleanMobileOrderValue(order.payment_status);
  return (
    !!buyerEmail ||
    mobileOrderTotalCents(order) > 0 ||
    !!paymentStatus ||
    !!cleanMobileOrderValue(order.paid_at) ||
    !!cleanMobileOrderValue(order.stripe_checkout_session_id) ||
    !!cleanMobileOrderValue(order.stripe_payment_intent_id)
  );
}

export function mobileDisplayStatus(order: MobileOrderMoneyRow) {
  const status = cleanMobileOrderValue(order.status).toLowerCase();
  if (hasMobileStartedCheckout(order)) return "payment_pending";
  if (isMobilePaidOrder(order)) {
    if (status === "digital_paid") return "digital_paid";
    if (status === "reviewed" || status === "sent_to_print" || status === "completed") return status;
    return "paid";
  }
  return status || "pending";
}

export function isMobileMainWorkflowOrder(order: MobileOrderMoneyRow) {
  return mobileDisplayStatus(order) !== "payment_pending";
}

export function isMobileUnreadOrder(order: MobileOrderMoneyRow) {
  return order.seen_by_photographer === false && isMobileMainWorkflowOrder(order);
}

export function isMobileCompletedOrder(order: MobileOrderMoneyRow) {
  const status = mobileDisplayStatus(order);
  return status === "completed" || status === "paid" || status === "digital_paid" || status === "sent_to_print";
}

export function mobileRevenueDate(order: MobileOrderMoneyRow) {
  return cleanMobileOrderValue(order.paid_at) || cleanMobileOrderValue(order.created_at);
}

/** Shared fee disclosure for public pricing and photographer billing. */
export function formatOrderFeeMoney(rateCents: number, currency = "CAD") {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rateCents / 100);
}

export const ORDER_FEE_PURPOSE =
  "This flat fee helps cover secure photo hosting, order delivery, and ongoing platform maintenance and support.";

export const ORDER_FEE_BILLING =
  "Billed monthly to your studio on paid plans, including annual subscriptions. Payment processing fees and AI background credits are separate.";

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
  "Studio OS charges your studio a small flat fee for each paid order. This helps cover secure photo hosting, order delivery, platform maintenance, and support.";

export const ORDER_FEE_BILLING =
  "Order fees are deducted automatically from each sale, including on annual plans. The same fee amount is charged in your studio’s sales currency. Stripe payment processing fees and AI background credits are additional.";

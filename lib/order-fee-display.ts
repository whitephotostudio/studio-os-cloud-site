/** Shared fee disclosure for public pricing and photographer billing. */
import type { PlanDefinition, PricingProfile } from "@/lib/studio-pricing";

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

/** Display only: fee eligibility and collection remain server payment decisions. */
export function getOrderFeeDisclosure(
  plan: Pick<PlanDefinition, "usageRateCents"> & Partial<Pick<PlanDefinition, "orderFeeScope">>,
  profile: PricingProfile,
  salesCurrency?: string,
) {
  if (profile === "gallery_v3") {
    return {
      fee: `${salesCurrency
        ? formatOrderFeeMoney(plan.usageRateCents, salesCurrency.toUpperCase())
        : (plan.usageRateCents / 100).toFixed(2)} per paid order`,
      collection: "deducted from each sale",
      processing: "Order fees are charged in your sales currency. Stripe processing fees are additional.",
    };
  }
  if (profile === "gallery_v2") {
    return {
      fee: plan.orderFeeScope === "production_orders"
        ? `${(plan.usageRateCents / 100).toFixed(2)} per qualifying school production order`
        : "No platform fee on ordinary gallery sales",
      collection: plan.orderFeeScope === "production_orders"
        ? "deducted from each qualifying sale"
        : null,
      processing: "Ordinary gallery sales have no platform fee. Order fees are charged in your sales currency. Stripe processing fees are additional.",
    };
  }
  return {
    fee: `${formatOrderFeeMoney(plan.usageRateCents)} per paid order`,
    collection: "deducted from each sale",
    processing: "Charged in your sales currency. Stripe processing fees are additional.",
  };
}

export function getOrderFeeCopy(profile: PricingProfile) {
  if (profile === "gallery_v3") {
    return {
      purpose: "Every paid order has a flat Studio OS fee: 0.55 on Gallery, or 0.45 on Core and Studio, charged in your studio’s sales currency. This applies to gallery, school, sports, event, print and digital orders.",
      billing: "Order fees are deducted automatically from each paid sale, including on annual plans. Subscription prices are in Canadian dollars (CAD). Stripe processing fees are paid by your studio and are additional. AI background credits are sold separately.",
    };
  }
  if (profile === "gallery_v2") {
    return {
      purpose: "On new paid plans, ordinary gallery sales have no Studio OS platform order fee. Core and Studio charge a flat 0.45 in your sales currency per qualifying paid school production order to support the connected production and delivery workflow.",
      billing: "The school production fee is deducted from each qualifying sale, including on annual plans. Stripe processing fees are paid by your studio and are additional. AI background credits are sold separately.",
    };
  }
  return { purpose: ORDER_FEE_PURPOSE, billing: ORDER_FEE_BILLING };
}

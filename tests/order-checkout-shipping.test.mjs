import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertStripePaymentMatches,
  reconcileStoredCheckoutItems,
  resolveStoredCheckoutCharge,
} from "../lib/order-checkout-total.ts";
import { resolveShipping } from "../lib/combine-orders.ts";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function order(overrides) {
  return {
    id: "order-a",
    order_group_id: "group-1",
    photographer_id: "photographer-1",
    subtotal_cents: 11_500,
    tax_cents: 1_495,
    total_cents: 12_995,
    total_amount: 129.95,
    currency: "cad",
    status: "payment_pending",
    payment_status: "pending",
    ...overrides,
  };
}

const groupedOrders = [
  order({}),
  order({
    id: "order-b",
    subtotal_cents: 5_700,
    tax_cents: 741,
    total_cents: 6_441,
    total_amount: 64.41,
  }),
];

const groupedItems = [
  {
    order_id: "order-a",
    line_total_cents: 10_000,
    unit_price_cents: 10_000,
    quantity: 1,
  },
  {
    order_id: "order-a",
    line_total_cents: 1_500,
    unit_price_cents: 1_500,
    quantity: 1,
  },
  {
    order_id: "order-b",
    line_total_cents: 6_000,
    unit_price_cents: 6_000,
    quantity: 1,
  },
  {
    order_id: "order-b",
    line_total_cents: -300,
    unit_price_cents: -300,
    quantity: 1,
  },
];

test("combined Stripe charge includes every grouped order, tax, shipping, and discount", () => {
  reconcileStoredCheckoutItems({ orders: groupedOrders, items: groupedItems });

  const fromPrimary = resolveStoredCheckoutCharge({
    seedOrderId: "order-a",
    orders: groupedOrders,
    requireUnpaid: true,
  });
  const fromSibling = resolveStoredCheckoutCharge({
    seedOrderId: "order-b",
    orders: groupedOrders,
    requireUnpaid: true,
  });

  assert.deepEqual(fromPrimary, fromSibling);
  assert.deepEqual(fromPrimary.orderIds, ["order-a", "order-b"]);
  assert.equal(fromPrimary.totalCents, 19_436);
  assert.equal(fromPrimary.currency, "cad");
  assertStripePaymentMatches({
    expected: fromPrimary,
    amountCents: 19_436,
    currency: "CAD",
  });
});

test("group checkout rejects mixed ownership, currency, and paid members", () => {
  assert.throws(
    () =>
      resolveStoredCheckoutCharge({
        seedOrderId: "order-a",
        orders: [groupedOrders[0], order({ id: "order-b", photographer_id: "other" })],
      }),
    /mixed photographers/,
  );
  assert.throws(
    () =>
      resolveStoredCheckoutCharge({
        seedOrderId: "order-a",
        orders: [groupedOrders[0], order({ id: "order-b", currency: "usd" })],
      }),
    /mixed currencies/,
  );
  assert.throws(
    () =>
      resolveStoredCheckoutCharge({
        seedOrderId: "order-a",
        orders: [groupedOrders[0], order({ id: "order-b", payment_status: "paid" })],
        requireUnpaid: true,
      }),
    /already been paid/,
  );
});

test("checkout rejects item, tax, Stripe amount, and currency mismatches", () => {
  assert.throws(
    () =>
      reconcileStoredCheckoutItems({
        orders: groupedOrders,
        items: groupedItems.map((item, index) =>
          index === 0 ? { ...item, line_total_cents: 9_900 } : item,
        ),
      }),
    /line items do not match/,
  );
  assert.throws(
    () =>
      reconcileStoredCheckoutItems({
        orders: [order({ total_cents: 12_900 })],
        items: groupedItems.filter((item) => item.order_id === "order-a"),
      }),
    /subtotal and tax do not match/,
  );

  const expected = resolveStoredCheckoutCharge({
    seedOrderId: "order-a",
    orders: groupedOrders,
  });
  assert.throws(
    () => assertStripePaymentMatches({ expected, amountCents: 12_995, currency: "cad" }),
    /amount does not match/,
  );
  assert.throws(
    () => assertStripePaymentMatches({ expected, amountCents: 19_436, currency: "usd" }),
    /currency does not match/,
  );
});

test("shipping preview charges the configured fee once and pickup stays free", () => {
  assert.deepEqual(
    resolveShipping(
      {
        requestedMethod: "shipping",
        shippingFeeCents: 1_500,
        lateHandlingFeePercent: 10,
        anyGroupLate: false,
      },
      1_367,
    ),
    {
      effectiveMethod: "shipping",
      shippingFeeCents: 1_500,
      handlingFeeCents: 0,
      forcedDueToLate: false,
    },
  );
  assert.equal(
    resolveShipping(
      {
        requestedMethod: "pickup",
        shippingFeeCents: 1_500,
        lateHandlingFeePercent: 10,
        anyGroupLate: false,
      },
      1_367,
    ).shippingFeeCents,
    0,
  );
});

test("checkout routes and parent UI preserve the authoritative shipping/group contract", () => {
  const checkoutSource = source("app/api/stripe/checkout/route.ts");
  const paymentsSource = source("lib/payments.ts");
  const confirmSource = source("app/api/stripe/checkout/confirm/route.ts");
  const webhookSource = source("app/api/stripe/webhook/route.ts");
  const combinedSource = source("app/api/portal/orders/create-combined/route.ts");
  const parentSource = source("app/parents/[pin]/page.tsx");
  const schoolAccessSource = source("app/api/portal/school-access/route.ts");
  const schoolSettingsSource = source(
    "app/dashboard/projects/schools/[schoolId]/settings/page.tsx",
  );

  assert.match(checkoutSource, /id,order_group_id,school_id/);
  assert.match(checkoutSource, /\.in\("order_id", charge\.orderIds\)/);
  assert.match(checkoutSource, /orderGroupId: charge\.orderGroupId/);
  assert.match(checkoutSource, /\.in\("id", charge\.orderIds\)/);
  assert.match(paymentsSource, /studio-os-order-group-session-/);
  assert.match(confirmSource, /assertStripePaymentMatches/);
  assert.match(webhookSource, /customer order payment blocked/);
  assert.match(combinedSource, /pickupAllowedForAllGroups/);
  assert.match(parentSource, /<span>Shipping<\/span>/);
  assert.match(
    parentSource,
    /checkoutMerchandiseCents \+\s*checkoutShipping\.shippingFeeCents \+\s*checkoutShipping\.handlingFeeCents/,
  );
  assert.match(schoolAccessSource, /lateOrderPolicy,/);
  assert.match(schoolAccessSource, /shipping_fee_cents,late_handling_fee_percent/);
  assert.match(schoolSettingsSource, /Checkout shipping fee/);
});

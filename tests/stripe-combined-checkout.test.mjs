import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  storedOrderTotalCents,
  sumStoredOrderItemTotalsCents,
  sumStoredOrderTotalsCents,
} from "../lib/order-checkout-totals.ts";
import { computeCombineTotals } from "../lib/combine-orders.ts";

const checkoutRouteSource = readFileSync(
  new URL("../app/api/stripe/checkout/route.ts", import.meta.url),
  "utf8",
);
const createCombinedRouteSource = readFileSync(
  new URL("../app/api/portal/orders/create-combined/route.ts", import.meta.url),
  "utf8",
);
const paymentsSource = readFileSync(
  new URL("../lib/payments.ts", import.meta.url),
  "utf8",
);

test("combined checkout charges the sum of every persisted member total", () => {
  const primaryWithShippingAndTax = {
    total_cents: 7_044,
    total_amount: 70.44,
  };
  const siblingAfterDiscountAndTax = {
    total_cents: 3_390,
    total_amount: 33.9,
  };

  assert.equal(storedOrderTotalCents(primaryWithShippingAndTax), 7_044);
  assert.equal(
    sumStoredOrderTotalsCents([
      primaryWithShippingAndTax,
      siblingAfterDiscountAndTax,
    ]),
    10_434,
  );
  assert.equal(
    sumStoredOrderTotalsCents([{ total_cents: null, total_amount: 12.34 }]),
    1_234,
  );
  assert.equal(sumStoredOrderTotalsCents([{ total_cents: 0 }]), null);
});

test("two-student combined checkout charges and persists shipping exactly once", () => {
  const shippingFeeCents = 1_500;
  const totals = computeCombineTotals({
    groups: [
      { key: "student-one", subtotalCents: 5_000 },
      { key: "student-two", subtotalCents: 3_000 },
    ],
    tiers: {},
    shipping: {
      requestedMethod: "shipping",
      shippingFeeCents,
      lateHandlingFeePercent: 0,
      anyGroupLate: false,
    },
  });

  assert.equal(totals.kidCount, 2);
  assert.equal(totals.productSubtotalCents, 8_000);
  assert.equal(totals.shipping.shippingFeeCents, shippingFeeCents);
  assert.equal(totals.grandTotalCents, 9_500);

  // The create route assigns that one group-level charge to the primary
  // member and emits the Shipping order-item only for that same member.
  // These guards keep a future refactor from charging/persisting it once per
  // student while the pure pricing assertion above still happens to pass.
  assert.match(
    createCombinedRouteSource,
    /const shippingPortion = isPrimary\s*\?[\s\S]*?combineTotals\.shipping\.shippingFeeCents[\s\S]*?: 0;/,
  );
  assert.match(
    createCombinedRouteSource,
    /if \(isPrimary && combineTotals\.shipping\.shippingFeeCents > 0\) \{/,
  );
});

test("combined member reconciliation includes negative sibling discounts", () => {
  assert.equal(
    sumStoredOrderItemTotalsCents([
      { line_total_cents: 3_000, unit_price_cents: 3_000, quantity: 1 },
      { line_total_cents: -150, unit_price_cents: -150, quantity: 1 },
    ]),
    2_850,
  );
  assert.equal(
    sumStoredOrderItemTotalsCents([
      { line_total_cents: null, unit_price_cents: 625, quantity: 2 },
    ]),
    1_250,
  );
});

test("Stripe checkout loads, validates, and labels the complete order group", () => {
  assert.match(
    checkoutRouteSource,
    /\.eq\("order_group_id", order\.order_group_id\)/,
  );
  assert.match(
    checkoutRouteSource,
    /\.order\("id", \{ ascending: true \}\)/,
  );
  assert.match(
    checkoutRouteSource,
    /sumStoredOrderTotalsCents\(checkoutOrders\)/,
  );
  assert.match(
    checkoutRouteSource,
    /\.eq\("order_id", checkoutOrder\.id\)/,
  );
  assert.match(checkoutRouteSource, /orderGroupId: order\.order_group_id/);
  assert.match(checkoutRouteSource, /orderId: checkoutAnchorOrder\.id/);
  assert.match(
    checkoutRouteSource,
    /checkoutOrders\.map\(\(member\) => member\.id\)/,
  );
  assert.match(
    paymentsSource,
    /idempotencyKey: `studio-os-order-session-\$\{input\.orderId\}`/,
  );
});

// Combine-orders pricing math.
//
// Pure functions only — no DB, no I/O. Easy to unit-test, easy to call from
// either the parent client (display preview) or the server checkout route
// (authoritative totals). The server is the only one whose result is
// trusted; client-side math is purely cosmetic.
//
// Spec: docs/design/combine-orders-and-recovery.md (sections 5 + 6 + 7).

// ── Types ────────────────────────────────────────────────────────────────

/** A "student group" inside a combined cart — one student's portion. */
export type CombineGroup = {
  /** Stable key (student_id for school mode, project_id for event mode). */
  key: string;
  /** The pre-discount sum of this group's line items, in cents. */
  subtotalCents: number;
};

/** Per-studio tiered sibling-discount config, stored as jsonb on photographers. */
export type SiblingDiscountTiers = Record<string, number>;

/** What gets passed in for shipping math. */
export type ShippingInput = {
  /** Parent's selected delivery preference. Server may override to "shipping" if past due date. */
  requestedMethod: "pickup" | "shipping";
  /** Studio shipping fee in cents (from photographers.shipping_fee_cents). */
  shippingFeeCents: number;
  /** Studio late-handling % from photographers.late_handling_fee_percent. */
  lateHandlingFeePercent: number;
  /**
   * If any group is past its school/event order_due_date, the parent loses
   * pickup as an option AND incurs the late-handling fee.  We compute this
   * once on the server from the per-school due dates and pass it in here.
   */
  anyGroupLate: boolean;
};

export type ResolvedShipping = {
  /** What the parent will actually be charged for delivery. May differ from requestedMethod when late. */
  effectiveMethod: "pickup" | "shipping";
  /** Shipping fee charged. 0 for pickup. */
  shippingFeeCents: number;
  /** Handling fee charged on top of shipping when late. 0 otherwise. */
  handlingFeeCents: number;
  /** True if we forced shipping because the parent missed the order_due_date. */
  forcedDueToLate: boolean;
};

export type CombineTotalsInput = {
  groups: CombineGroup[];
  tiers: SiblingDiscountTiers;
  shipping: ShippingInput;
};

export type GroupTotal = {
  key: string;
  /** Original group subtotal before any discount. */
  subtotalCents: number;
  /** Discount applied to THIS group, in cents. Always 0 for the highest-subtotal group. */
  discountCents: number;
  /** Discount % applied (0–100). */
  discountPercent: number;
  /** Group total after discount. */
  finalCents: number;
};

export type CombineTotals = {
  /** Per-group breakdown — same order as input.groups. */
  groupTotals: GroupTotal[];
  /** Number of groups (kids) — drives tier lookup. */
  kidCount: number;
  /** Tier % that applied to non-primary groups. 0 if only one group. */
  appliedTierPercent: number;
  /** Sum of all group subtotals before any discount. */
  productSubtotalCents: number;
  /** Sum of all sibling discounts applied across groups. */
  totalSiblingDiscountCents: number;
  /** Resolved shipping (after late-override + handling). */
  shipping: ResolvedShipping;
  /** Final amount the parent pays (in cents). */
  grandTotalCents: number;
};

// ── Pure helpers ─────────────────────────────────────────────────────────

/**
 * Pick the discount % to apply to non-primary groups based on the kid count.
 *
 * Tiers are stored as `{"2": 5, "3": 10}` — keys are kid counts, values
 * are percent-off applied to each additional kid. The lookup walks the
 * tiers in descending order so "3+ kids" wins over "2 kids" when both
 * are configured. Missing config → 0%.
 */
export function pickSiblingDiscountPercent(
  tiers: SiblingDiscountTiers | null | undefined,
  kidCount: number,
): number {
  if (!tiers || kidCount < 2) return 0;
  const numericKeys = Object.keys(tiers)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n) && n >= 2)
    .sort((a, b) => b - a);
  for (const tierKey of numericKeys) {
    if (kidCount >= tierKey) {
      const value = tiers[String(tierKey)];
      if (typeof value === "number" && value > 0 && value <= 100) {
        return value;
      }
    }
  }
  return 0;
}

/**
 * Apply the sibling discount to the input groups.
 *
 * Rule (locked decision #2): the group with the HIGHEST subtotal is treated
 * as the primary student and pays full price. Every other group gets the
 * tier % off its own subtotal. Reads cleanly on the receipt: "First kid
 * full price, additional kids discounted."
 *
 * Tie-breaker on equal subtotals is stable input order (so tests stay
 * deterministic). The "primary" choice is purely cosmetic anyway — the
 * total discount value is identical regardless of which group is primary.
 */
export function applySiblingDiscount(
  groups: CombineGroup[],
  tiers: SiblingDiscountTiers | null | undefined,
): { groupTotals: GroupTotal[]; appliedTierPercent: number } {
  if (groups.length === 0) {
    return { groupTotals: [], appliedTierPercent: 0 };
  }

  const tierPercent = pickSiblingDiscountPercent(tiers, groups.length);

  // Find the highest-subtotal group's index. We iterate forward so the
  // FIRST group at the max wins (stable for ties).
  let primaryIndex = 0;
  let primaryValue = groups[0].subtotalCents;
  for (let i = 1; i < groups.length; i++) {
    if (groups[i].subtotalCents > primaryValue) {
      primaryValue = groups[i].subtotalCents;
      primaryIndex = i;
    }
  }

  const groupTotals: GroupTotal[] = groups.map((group, i) => {
    if (i === primaryIndex || tierPercent === 0) {
      return {
        key: group.key,
        subtotalCents: group.subtotalCents,
        discountCents: 0,
        discountPercent: 0,
        finalCents: group.subtotalCents,
      };
    }
    // Round HALF-UP to the nearest cent so we never give a fractional cent away.
    const discountCents = Math.round(
      (group.subtotalCents * tierPercent) / 100,
    );
    return {
      key: group.key,
      subtotalCents: group.subtotalCents,
      discountCents,
      discountPercent: tierPercent,
      finalCents: group.subtotalCents - discountCents,
    };
  });

  return { groupTotals, appliedTierPercent: tierPercent };
}

/**
 * Decide the final shipping line based on the parent's selection + late state.
 *
 * Spec (locked decision #4):
 *   · Before the order_due_date — parent picks pickup (free) or shipping (paid).
 *   · After the order_due_date — pickup is disabled; shipping is forced AND
 *     a 10% (configurable) handling fee applies on top of the product subtotal.
 *
 * The handling fee % comes from the studio's `late_handling_fee_percent`.
 * It is applied to the AFTER-DISCOUNT product subtotal (the figure the
 * parent is actually paying for product), not raw subtotals — so a sibling
 * discount reduces the handling fee proportionally. That's the fairer read.
 */
export function resolveShipping(
  input: ShippingInput,
  productSubtotalAfterDiscountCents: number,
): ResolvedShipping {
  if (input.anyGroupLate) {
    const handlingFeeCents = Math.round(
      (productSubtotalAfterDiscountCents * input.lateHandlingFeePercent) / 100,
    );
    return {
      effectiveMethod: "shipping",
      shippingFeeCents: input.shippingFeeCents,
      handlingFeeCents,
      forcedDueToLate: true,
    };
  }
  if (input.requestedMethod === "pickup") {
    return {
      effectiveMethod: "pickup",
      shippingFeeCents: 0,
      handlingFeeCents: 0,
      forcedDueToLate: false,
    };
  }
  return {
    effectiveMethod: "shipping",
    shippingFeeCents: input.shippingFeeCents,
    handlingFeeCents: 0,
    forcedDueToLate: false,
  };
}

/**
 * One-shot total computation: discount + shipping + handling = grand total.
 *
 * Used by both:
 *   · /api/portal/orders/create (server, authoritative)
 *   · cart UI (client preview, cosmetic)
 *
 * The server runs this with prices it just looked up from the DB; the
 * client runs it with prices the gallery-context API returned. They should
 * always match — if they don't, the server wins.
 */
export function computeCombineTotals(input: CombineTotalsInput): CombineTotals {
  const { groupTotals, appliedTierPercent } = applySiblingDiscount(
    input.groups,
    input.tiers,
  );

  const productSubtotalCents = groupTotals.reduce(
    (sum, g) => sum + g.subtotalCents,
    0,
  );
  const totalSiblingDiscountCents = groupTotals.reduce(
    (sum, g) => sum + g.discountCents,
    0,
  );
  const productAfterDiscountCents =
    productSubtotalCents - totalSiblingDiscountCents;

  const shipping = resolveShipping(input.shipping, productAfterDiscountCents);

  const grandTotalCents =
    productAfterDiscountCents + shipping.shippingFeeCents + shipping.handlingFeeCents;

  return {
    groupTotals,
    kidCount: input.groups.length,
    appliedTierPercent,
    productSubtotalCents,
    totalSiblingDiscountCents,
    shipping,
    grandTotalCents,
  };
}

/**
 * Convenience: pick the next-tier carrot to show in the cart upsell strip.
 * "Add 1 more kid to unlock 10%" — returns the count needed and the % they'd unlock.
 *
 * Returns null when there's no higher tier (already at max or no tiers configured).
 */
export function nextSiblingTier(
  tiers: SiblingDiscountTiers | null | undefined,
  currentKidCount: number,
): { needed: number; nextPercent: number } | null {
  if (!tiers) return null;
  const sortedKeys = Object.keys(tiers)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n) && n > currentKidCount)
    .sort((a, b) => a - b);
  if (sortedKeys.length === 0) return null;
  const nextKey = sortedKeys[0];
  const value = tiers[String(nextKey)];
  if (typeof value !== "number" || value <= 0) return null;
  return { needed: nextKey - currentKidCount, nextPercent: value };
}

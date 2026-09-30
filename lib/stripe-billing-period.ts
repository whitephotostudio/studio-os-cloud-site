type StripePeriod = {
  current_period_start?: number | null;
  current_period_end?: number | null;
};

type SubscriptionPeriods = StripePeriod & {
  items?: { data?: StripePeriod[] } | null;
};

function validPeriod(period: StripePeriod | null | undefined) {
  return Boolean(
    period && Number.isFinite(period.current_period_start) &&
    Number.isFinite(period.current_period_end) &&
    Number(period.current_period_start) > 0 &&
    Number(period.current_period_end) > Number(period.current_period_start),
  );
}

/** Basil moved billing periods onto items; annual plans and monthly usage differ. */
export function resolveStripeBillingPeriod(
  subscription: SubscriptionPeriods,
  preferredItem?: StripePeriod | null,
) {
  let period: StripePeriod | null = validPeriod(preferredItem) ? preferredItem! : null;
  if (!period && validPeriod(subscription)) period = subscription;
  if (!period) {
    const items = (subscription.items?.data ?? []).filter(validPeriod);
    if (items.length) {
      period = {
        current_period_start: Math.max(...items.map((item) => Number(item.current_period_start))),
        current_period_end: Math.min(...items.map((item) => Number(item.current_period_end))),
      };
    }
  }
  if (!validPeriod(period)) return { start: null, end: null };
  return {
    start: new Date(Number(period!.current_period_start) * 1000).toISOString(),
    end: new Date(Number(period!.current_period_end) * 1000).toISOString(),
  };
}

type StripeId = string | { id: string } | null;

/** Accept both older webhook payloads and the invoice parent introduced in Basil. */
export function stripeInvoiceSubscriptionId(invoice: {
  subscription?: StripeId;
  parent?: {
    type?: string | null;
    subscription_details?: { subscription?: StripeId } | null;
  } | null;
}) {
  const reference = invoice.parent?.type === "subscription_details"
    ? invoice.parent.subscription_details?.subscription ?? invoice.subscription
    : invoice.subscription;
  return typeof reference === "string" ? reference : reference?.id ?? null;
}

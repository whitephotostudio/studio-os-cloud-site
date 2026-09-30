import { randomUUID } from "node:crypto";
import type { createDashboardServiceClient } from "@/lib/dashboard-auth";

type ServiceClient = ReturnType<typeof createDashboardServiceClient>;
type StripeRequest = <T>(path: string, options?: {
  method?: "GET" | "POST" | "DELETE";
  body?: URLSearchParams;
  idempotencyKey?: string;
}) => Promise<T>;

type OrderUsageFee = {
  order_id: string;
  photographer_id: string;
  stripe_customer_id: string;
  event_name: string;
  event_identifier: string;
  usage_timestamp: number;
  amount_cents: number;
  currency: string;
  billing_period: string;
  report_status: string;
  report_first_attempt_at: string | null;
  reported_at: string | null;
  refund_requested_at: string | null;
  refund_status: string;
  refund_strategy: string | null;
  refund_first_attempt_at: string | null;
};

const DAY_MS = 86_400_000;
// Stripe preserves idempotency for at least 24 hours. Leave clock-drift margin;
// uncertain older requests require review instead of risking a second charge.
const SAFE_RETRY_MS = 23 * 60 * 60 * 1000;

/** PostgREST caps ordinary selects; financial totals must include every page. */
export async function readAllBillingRows<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const result: T[] = [];
  const batchSize = 1000;
  for (let offset = 0; ; offset += batchSize) {
    const page = await query(offset, offset + batchSize - 1);
    if (page.error) throw page.error;
    const rows = page.data ?? [];
    result.push(...rows);
    if (rows.length < batchSize) return result;
  }
}

function uncertainRequestExpired(firstAttempt: string | null, now: number) {
  return Boolean(firstAttempt && now - Date.parse(firstAttempt) >= SAFE_RETRY_MS);
}

async function updateClaim(service: ServiceClient, orderId: string, token: string, values: Record<string, unknown>) {
  const { error } = await service.from("order_usage_fees").update({
    ...values, lock_token: null, lock_expires_at: null, updated_at: new Date().toISOString(),
  }).eq("order_id", orderId).eq("lock_token", token);
  if (error) throw error;
}

async function reportFee(service: ServiceClient, candidate: OrderUsageFee, request: StripeRequest, now: number) {
  const token = randomUUID();
  const { data, error } = await service.rpc("claim_order_usage_fee", {
    p_order_id: candidate.order_id, p_operation: "report", p_token: token,
  });
  if (error) throw error;
  const fee = data as OrderUsageFee | null;
  if (!fee) return;
  try {
    if (uncertainRequestExpired(fee.report_first_attempt_at, now) || now - Number(fee.usage_timestamp) * 1000 >= 35 * DAY_MS) {
      await updateClaim(service, fee.order_id, token, { report_status: "review_required" });
      return;
    }
    if (fee.refund_requested_at && !candidate.report_first_attempt_at) {
      await updateClaim(service, fee.order_id, token, { report_status: "waived", refund_status: "completed", refund_completed_at: new Date(now).toISOString() });
      return;
    }
    const result = await request<{ identifier: string; created?: number }>("billing/meter_events", {
      method: "POST",
      body: new URLSearchParams({
        event_name: fee.event_name,
        "payload[stripe_customer_id]": fee.stripe_customer_id,
        "payload[value]": "1",
        timestamp: String(fee.usage_timestamp),
        identifier: fee.event_identifier,
      }),
      idempotencyKey: fee.event_identifier,
    });
    if (result.identifier !== fee.event_identifier) throw new Error("Stripe returned a different service-fee event.");
    const completion = await service.rpc("complete_order_usage_fee_report", {
      p_order_id: fee.order_id, p_token: token,
      p_reported_at: new Date(result.created ? result.created * 1000 : now).toISOString(),
    });
    if (completion.error) throw completion.error;
  } catch (error) {
    await updateClaim(service, fee.order_id, token, {});
    throw error;
  }
}

/** Full refunds waive the fee; partial refunds still represent a paid order. */
export async function reconcileOrderUsageFeeRefunds(
  service: ServiceClient, photographerId: string, request: StripeRequest, now = Date.now(),
) {
  const { data, error } = await service.from("order_usage_fees").select("*")
    .eq("photographer_id", photographerId).eq("report_status", "reported")
    .in("refund_status", ["pending", "processing"]).order("created_at", { ascending: true }).limit(100);
  if (error) throw error;
  for (const candidate of (data ?? []) as OrderUsageFee[]) {
    const token = randomUUID();
    const reportedAt = candidate.reported_at ? Date.parse(candidate.reported_at) : NaN;
    const strategy = Number.isFinite(reportedAt) && now - reportedAt < SAFE_RETRY_MS
      ? "cancel_meter_event" : "invoice_credit";
    const claim = await service.rpc("claim_order_usage_fee", {
      p_order_id: candidate.order_id, p_operation: "refund", p_token: token, p_refund_strategy: strategy,
    });
    if (claim.error) throw claim.error;
    const fee = claim.data as OrderUsageFee | null;
    if (!fee) continue;
    try {
      // Never switch strategies after an uncertain request: a lost successful
      // cancellation followed by an invoice credit would waive the fee twice.
      if (uncertainRequestExpired(fee.refund_first_attempt_at, now) ||
          (fee.refund_strategy === "cancel_meter_event" && (!fee.reported_at || now - Date.parse(fee.reported_at) >= SAFE_RETRY_MS))) {
        await updateClaim(service, fee.order_id, token, { refund_status: "review_required" });
        continue;
      }
      let adjustmentReference: string;
      if (fee.refund_strategy === "cancel_meter_event") {
        const result = await request<{ event_name: string; type: string; status: string; cancel?: { identifier?: string } }>("billing/meter_event_adjustments", {
          method: "POST",
          body: new URLSearchParams({ event_name: fee.event_name, type: "cancel", "cancel[identifier]": fee.event_identifier }),
          idempotencyKey: `studio-os-usage-refund-cancel-${fee.order_id}`,
        });
        // v1 meter adjustments have no id. Verify the returned event reference
        // instead of expecting the invoice item's unrelated response shape.
        if (result.event_name !== fee.event_name || result.type !== "cancel" || result.cancel?.identifier !== fee.event_identifier ||
            !["pending", "complete"].includes(result.status)) throw new Error("Stripe did not accept this service-fee cancellation.");
        adjustmentReference = `cancel:${fee.event_identifier}`;
      } else {
        const result = await request<{ id: string }>("invoiceitems", {
          method: "POST",
          body: new URLSearchParams({
            customer: fee.stripe_customer_id, currency: fee.currency, amount: String(-fee.amount_cents),
            description: `Studio OS service fee waived for refunded order ${fee.order_id}`,
            "metadata[billing_flow]": "order_usage_refund",
            "metadata[order_id]": fee.order_id,
            "metadata[photographer_id]": fee.photographer_id,
            "metadata[original_meter_event]": fee.event_identifier,
          }),
          idempotencyKey: `studio-os-usage-refund-credit-${fee.order_id}`,
        });
        if (!result.id) throw new Error("Stripe returned no service-fee credit reference.");
        adjustmentReference = result.id;
      }
      await updateClaim(service, fee.order_id, token, {
        refund_status: "completed", refund_completed_at: new Date(now).toISOString(), stripe_adjustment_id: adjustmentReference,
      });
    } catch (error) {
      await updateClaim(service, fee.order_id, token, {});
      throw error;
    }
  }
}

export async function syncOrderUsageFees(service: ServiceClient, input: {
  photographerId: string;
  customerId: string;
  eventName: string;
  amountCents: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  billingPeriod: string;
}, request: StripeRequest, now = Date.now()) {
  const { data, error } = await service.from("orders")
    .select("id,paid_at,total_cents")
    .eq("photographer_id", input.photographerId)
    .in("payment_status", ["paid", "succeeded", "partially_refunded"])
    .eq("counted_for_monthly_usage", false)
    .gte("paid_at", input.periodStart).lt("paid_at", input.periodEnd)
    .or("is_test.is.false,is_test.is.null").order("paid_at", { ascending: true });
  if (error) throw error;
  for (const order of (data ?? []) as Array<{ id: string; paid_at: string; total_cents: number | null }>) {
    const staged = await service.rpc("stage_order_usage_fee", {
      p_order_id: order.id, p_photographer_id: input.photographerId, p_customer_id: input.customerId,
      p_event_name: input.eventName, p_usage_timestamp: Math.floor(Date.parse(order.paid_at) / 1000),
      p_amount_cents: input.amountCents, p_currency: input.currency, p_billing_period: input.billingPeriod,
    });
    if (staged.error) throw staged.error;
  }
  // Existing requests retain their original paid date, rate, customer and meter
  // after a plan change or renewal. They are never recalculated at today's rate.
  const outstanding = await service.from("order_usage_fees").select("*")
    .eq("photographer_id", input.photographerId).in("report_status", ["pending", "processing"])
    .order("created_at", { ascending: true }).limit(100);
  if (outstanding.error) throw outstanding.error;
  for (const candidate of (outstanding.data ?? []) as OrderUsageFee[]) await reportFee(service, candidate, request, now);
  await reconcileOrderUsageFeeRefunds(service, input.photographerId, request, now);
}

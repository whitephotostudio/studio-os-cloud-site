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

/** Full reported refunds queue a next-bill credit; partial refunds retain the fee. */
export async function reconcileOrderUsageFeeRefunds(
  service: ServiceClient, photographerId: string, request: StripeRequest, now = Date.now(),
) {
  // Older workers treated an accepted cancellation as a completed waiver. A
  // cancellation never corrects an already-finalized invoice, so those records
  // need review rather than a second, potentially duplicate financial request.
  const legacy = await service.from("order_usage_fees").select("order_id")
    .eq("photographer_id", photographerId).eq("report_status", "reported")
    .eq("refund_status", "completed").eq("refund_strategy", "cancel_meter_event")
    .order("created_at", { ascending: true }).limit(100);
  if (legacy.error) throw legacy.error;
  for (const fee of (legacy.data ?? []) as Array<{ order_id: string }>) {
    const reviewed = await service.from("order_usage_fees").update({
      refund_status: "review_required", updated_at: new Date(now).toISOString(),
    }).eq("order_id", fee.order_id).eq("photographer_id", photographerId)
      .eq("report_status", "reported").eq("refund_status", "completed")
      .eq("refund_strategy", "cancel_meter_event");
    if (reviewed.error) throw reviewed.error;
  }
  const { data, error } = await service.from("order_usage_fees").select("*")
    .eq("photographer_id", photographerId).eq("report_status", "reported")
    .in("refund_status", ["pending", "processing"]).order("created_at", { ascending: true }).limit(100);
  if (error) throw error;
  for (const candidate of (data ?? []) as OrderUsageFee[]) {
    const token = randomUUID();
    const claim = await service.rpc("claim_order_usage_fee", {
      p_order_id: candidate.order_id, p_operation: "refund", p_token: token, p_refund_strategy: "invoice_credit",
    });
    if (claim.error) throw claim.error;
    const fee = claim.data as OrderUsageFee | null;
    if (!fee) continue;
    try {
      // Age only controls safe retries, not whether Stripe finalized an invoice.
      // Never switch an older frozen cancellation to a credit: its provider
      // result may have succeeded even when our response was lost.
      if (uncertainRequestExpired(fee.refund_first_attempt_at, now) || fee.refund_strategy !== "invoice_credit") {
        await updateClaim(service, fee.order_id, token, { refund_status: "review_required" });
        continue;
      }
      const result = await request<{
        id: string; object: string; customer: string; currency: string; amount: number;
        invoice: string | null; metadata: Record<string, string>;
      }>("invoiceitems", {
        method: "POST",
        // Keep every field identical to previously frozen invoice-credit
        // requests, including the description, for Stripe idempotent retries.
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
      if (!result || typeof result.id !== "string" || !/^ii_[A-Za-z0-9]+$/.test(result.id) ||
          result.object !== "invoiceitem" || result.customer !== fee.stripe_customer_id ||
          result.currency !== fee.currency || !Number.isSafeInteger(result.amount) || result.amount !== -fee.amount_cents ||
          result.invoice !== null || result.metadata?.billing_flow !== "order_usage_refund" ||
          result.metadata?.order_id !== fee.order_id || result.metadata?.photographer_id !== fee.photographer_id ||
          result.metadata?.original_meter_event !== fee.event_identifier) {
        throw new Error("Stripe returned an unverified pending service-fee credit.");
      }
      // Completed means this exact next-subscription-bill credit was queued,
      // not that an existing invoice was amended or money was refunded.
      await updateClaim(service, fee.order_id, token, {
        refund_status: "completed", refund_completed_at: new Date(now).toISOString(), stripe_adjustment_id: result.id,
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
    .is("platform_fee_collection_method", null)
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

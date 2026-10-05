import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalCheckoutJson } from "@/lib/checkout-attempt";
import { sumStoredOrderTotalsCents } from "@/lib/order-checkout-totals";
import { finalizePaidOrderOrGroup, getConnectedAccountId, markOrderOrGroupPaymentFailure, recordStripeEvent, retrieveCheckoutSession } from "@/lib/payments";

export type CustomerOrderStripeEvent = {
  id: string; type: string; account?: string; livemode?: boolean;
  data: { object: Record<string, unknown> };
};
const eventTypes = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded", "payment_intent.succeeded", "payment_intent.payment_failed"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const metadataOf = (event: CustomerOrderStripeEvent) => event.data.object.metadata as Record<string, unknown> | null | undefined;

export function isCustomerOrderStripeEvent(event: CustomerOrderStripeEvent) {
  return Boolean(event.account && eventTypes.has(event.type) && clean(metadataOf(event)?.order_id));
}
class PaymentScopeError extends Error {}
type PaymentOrder = {
  id: string; photographer_id: string; order_group_id: string | null;
  total_cents: number | null; total_amount: number | null; currency: string | null;
  stripe_checkout_session_id: string | null; stripe_payment_intent_id: string | null;
};

async function verifiedOrderScope(service: SupabaseClient, event: CustomerOrderStripeEvent) {
  const metadata = metadataOf(event), orderId = clean(metadata?.order_id), object = event.data.object;
  const { data: seed, error: seedError } = await service.from("orders")
    .select("id,photographer_id,order_group_id,total_cents,total_amount,currency,stripe_checkout_session_id,stripe_payment_intent_id")
    .eq("id", orderId).maybeSingle<PaymentOrder>();
  if (seedError) throw seedError;
  if (!seed?.photographer_id) throw new PaymentScopeError("Customer payment order is unavailable.");
  const { data: photographer, error: photographerError } = await service.from("photographers")
    .select("id,stripe_account_id,stripe_connected_account_id").eq("id", seed.photographer_id).maybeSingle();
  if (photographerError) throw photographerError;
  if (!photographer || getConnectedAccountId(photographer) !== event.account || clean(metadata?.photographer_id) !== seed.photographer_id) {
    throw new PaymentScopeError("Customer payment account does not match the order owner.");
  }
  let orders: PaymentOrder[] = [seed];
  if (seed.order_group_id) {
    const { data, error, count } = await service.from("orders")
      .select("id,photographer_id,order_group_id,total_cents,total_amount,currency,stripe_checkout_session_id,stripe_payment_intent_id", { count: "exact" })
      .eq("order_group_id", seed.order_group_id).order("id", { ascending: true });
    if (error) throw error;
    orders = data ?? [];
    if (!orders.length || count == null || count !== orders.length || !orders.some(row => row.id === seed.id) ||
        orders.some(row => row.photographer_id !== seed.photographer_id || row.order_group_id !== seed.order_group_id) ||
        clean(metadata?.order_group_id) !== seed.order_group_id) throw new PaymentScopeError("Customer payment group is incomplete or changed.");
  } else if (clean(metadata?.order_group_id)) throw new PaymentScopeError("Customer payment group does not match the saved order.");
  const sessionEvent = event.type.startsWith("checkout.session.");
  const sessionId = sessionEvent ? clean(object.id) : null;
  const paymentIntentId = sessionEvent ? clean(object.payment_intent) || null : clean(object.id);
  if (!sessionId && !paymentIntentId || orders.some(row =>
    (sessionId && row.stripe_checkout_session_id && row.stripe_checkout_session_id !== sessionId) ||
    (paymentIntentId && row.stripe_payment_intent_id && row.stripe_payment_intent_id !== paymentIntentId))) {
    throw new PaymentScopeError("Customer payment references do not match the saved order.");
  }
  const currency = clean(object.currency).toLowerCase(), total = sumStoredOrderTotalsCents(orders);
  const amount = sessionEvent ? object.amount_total : object.amount;
  if (!currency || !Number.isSafeInteger(amount) || total == null || amount !== total ||
      orders.some(row => clean(row.currency || "cad").toLowerCase() !== currency)) throw new PaymentScopeError("Customer payment amount or currency does not match the saved order.");
  return { orderId, sessionId, paymentIntentId, ownerId: seed.photographer_id, groupId: seed.order_group_id, ids: orders.map(row => row.id) };
}

async function verifyPaidCompletion(service: SupabaseClient, scope: Awaited<ReturnType<typeof verifiedOrderScope>>) {
  let query = service.from("orders")
    .select("id,photographer_id,order_group_id,paid_at,payment_status,stripe_checkout_session_id,stripe_payment_intent_id", { count: "exact" });
  query = scope.groupId ? query.eq("order_group_id", scope.groupId) : query.in("id", scope.ids);
  const { data, error, count } = await query;
  if (error) throw error;
  if (count !== scope.ids.length || data?.length !== scope.ids.length || data.some(row =>
    !scope.ids.includes(row.id) || row.photographer_id !== scope.ownerId || row.order_group_id !== scope.groupId)) {
    throw new PaymentScopeError("Customer payment order scope changed during completion.");
  }
  if (data.some(row => !row.paid_at || !["paid", "succeeded", "no_payment_required", "partially_refunded", "refunded"].includes(clean(row.payment_status).toLowerCase()) ||
    (scope.sessionId && row.stripe_checkout_session_id !== scope.sessionId) ||
    (scope.paymentIntentId && row.stripe_payment_intent_id !== scope.paymentIntentId))) {
    throw new Error("Customer payment completion is incomplete; retry required.");
  }
}

/** A claimed event is complete only after the paid state and its outbox commit. */
export async function processCustomerOrderStripeEvent(service: SupabaseClient, event: CustomerOrderStripeEvent) {
  const orderId = clean(metadataOf(event)?.order_id), token = randomUUID();
  if (!isCustomerOrderStripeEvent(event) || !uuid.test(orderId) || !clean(event.id) || event.id.length > 255) {
    return { ok: false, status: 400, review: true };
  }
  const hash = createHash("sha256").update(canonicalCheckoutJson(event)).digest("hex");
  const { data: claim, error: claimError } = await service.rpc("claim_customer_order_webhook", {
    p_event_id: event.id, p_order_id: orderId, p_account: event.account,
    p_event_type: event.type, p_payload_hash: hash, p_payload: event, p_token: token,
  });
  if (claimError) throw claimError;
  if (claim === "processed") return { ok: true, status: 200, duplicate: true };
  if (claim === "review") return { ok: false, status: 400, review: true };
  if (claim !== "claimed") return { ok: false, status: 503, retry: true };
  const finish = async (result: "processed" | "pending" | "review") => {
    const { data, error } = await service.rpc("finish_customer_order_webhook", { p_event_id: event.id, p_token: token, p_result: result });
    if (error) throw error;
    if (!data) throw new Error("Customer payment event lease changed before completion.");
  };
  try {
    const scope = await verifiedOrderScope(service, event), object = event.data.object;
    if (event.type === "payment_intent.payment_failed") {
      await markOrderOrGroupPaymentFailure(service, { orderId: scope.orderId, paymentIntentId: scope.paymentIntentId, note: `[Stripe payment intent ${scope.paymentIntentId}] payment failed` });
    } else if ((event.type.startsWith("checkout.session.") && ["paid", "no_payment_required"].includes(clean(object.payment_status))) ||
      (event.type === "payment_intent.succeeded" && object.status === "succeeded")) {
      const finalized = await finalizePaidOrderOrGroup(service, {
        orderId: scope.orderId, checkoutSessionId: scope.sessionId, paymentIntentId: scope.paymentIntentId,
        paymentStatus: event.type === "payment_intent.succeeded" ? "succeeded" : clean(object.payment_status),
        note: `[Stripe ${event.type} ${clean(object.id)}] payment confirmed`, paidAt: new Date().toISOString(),
      });
      if (!finalized) throw new PaymentScopeError("Customer payment order disappeared during completion.");
      await verifyPaidCompletion(service, scope);
    }
    // Preserve the existing provider-event audit history after fulfillment.
    // Its insert-only dedupe never decides whether this leased work is done.
    await recordStripeEvent(service, event, event);
    await finish("processed");
    return { ok: true, status: 200 };
  } catch (error) {
    const review = error instanceof PaymentScopeError;
    try { await finish(review ? "review" : "pending"); }
    catch { console.error("[customer-order-webhook] Claim will become retryable after its lease expires."); }
    if (!review) console.error("[customer-order-webhook] Processing interrupted; retry scheduled.");
    return { ok: false, status: review ? 400 : 503, ...(review ? { review: true } : { retry: true }) };
  }
}

/** Stored signed events survive a worker termination and need no browser return. */
export async function recoverCustomerOrderWebhooks(service: SupabaseClient, limit = 50) {
  const { data, error } = await service.from("customer_order_webhooks").select("event_id,payload")
    .in("status", ["pending", "processing"]).lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true }).order("event_id", { ascending: true }).limit(Math.max(1, Math.min(100, limit)));
  if (error) throw error;
  let recovered = 0, retry = 0, review = 0;
  const rows = data ?? [];
  for (let index = 0; index < rows.length; index += 5) {
    await Promise.all(rows.slice(index, index + 5).map(async row => {
      try {
        const result = await processCustomerOrderStripeEvent(service, row.payload as CustomerOrderStripeEvent);
        if (result.ok) recovered++; else if (result.review) review++; else retry++;
      } catch { retry++; }
    }));
  }
  return { checked: rows.length, recovered, retry, review };
}

/** Reconcile a bounded page of old pending drafts against the studio's Stripe account. */
export async function reconcilePendingCustomerOrderPayments(service: SupabaseClient, limit = 10) {
  const { data, error } = await service.rpc("claim_pending_customer_order_payment_checks", { p_limit: Math.max(1, Math.min(20, limit)) });
  if (error) throw error;
  const seen = new Set<string>(), rows = ((data ?? []) as Array<{ id: string; photographer_id: string; order_group_id: string | null; stripe_checkout_session_id: string }>).filter(row => {
    const key = row.order_group_id || row.id;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  let recovered = 0, unpaid = 0, retry = 0;
  for (let index = 0; index < rows.length; index += 3) {
    await Promise.all(rows.slice(index, index + 3).map(async row => {
      try {
        const { data: owner, error: ownerError } = await service.from("photographers")
          .select("id,stripe_account_id,stripe_connected_account_id").eq("id", row.photographer_id).maybeSingle();
        if (ownerError) throw ownerError;
        const account = owner && getConnectedAccountId(owner);
        if (!account) throw new Error("Customer payment owner unavailable.");
        const session = await retrieveCheckoutSession(row.stripe_checkout_session_id!, account);
        if (!["paid", "no_payment_required"].includes(session.payment_status || "")) { unpaid++; return; }
        if (session.id !== row.stripe_checkout_session_id || session.metadata?.photographer_id !== row.photographer_id ||
          (!row.order_group_id && session.metadata?.order_id !== row.id) ||
          (row.order_group_id && session.metadata?.order_group_id !== row.order_group_id)) throw new Error("Recovered customer payment identity mismatch.");
        const event: CustomerOrderStripeEvent = {
          id: `customer-payment-recovery:${session.id}`, type: "checkout.session.completed", account,
          livemode: (session as unknown as Record<string, unknown>).livemode === true,
          // GET responses can gain presentation fields between checks. Keep
          // the recovery identity stable while retaining all financial proof.
          data: { object: {
            id: session.id, payment_intent: session.payment_intent, payment_status: session.payment_status,
            amount_total: session.amount_total, currency: session.currency,
            metadata: { order_id: session.metadata?.order_id, photographer_id: session.metadata?.photographer_id,
              ...(session.metadata?.order_group_id ? { order_group_id: session.metadata.order_group_id } : {}) },
          } },
        };
        const result = await processCustomerOrderStripeEvent(service, event);
        if (result.ok) recovered++; else retry++;
      } catch { retry++; }
    }));
  }
  return { checked: rows.length, recovered, unpaid, retry };
}

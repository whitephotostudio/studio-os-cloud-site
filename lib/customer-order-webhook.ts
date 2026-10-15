import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalCheckoutJson } from "@/lib/checkout-attempt";
import { finalizePaidOrderOrGroup, markOrderOrGroupPaymentFailure, recordStripeEvent, retrieveCheckoutSession } from "@/lib/payments";
import { resolveOrderPaymentAccount } from "@/lib/stripe-connect-history";
import { verifyOrderWebhookPayment } from "@/lib/order-webhook-payment";
import { lockOrderPayment } from "@/lib/order-payment-lock";

export type CustomerOrderStripeEvent = {
  id: string; type: string; account?: string; livemode?: boolean;
  data: { object: Record<string, unknown> };
};
const eventTypes = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded", "payment_intent.succeeded", "payment_intent.payment_failed"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const metadataOf = (event: CustomerOrderStripeEvent) => event.data.object.metadata as Record<string, unknown> | null | undefined;

function isLegacyInternalRecovery(event: CustomerOrderStripeEvent) {
  const objectId = clean(event.data.object.id);
  return event.type === "checkout.session.completed" && /^cs_[A-Za-z0-9_]+$/.test(objectId) &&
    event.id === `customer-payment-recovery:${objectId}` && metadataOf(event)?.billing_flow === undefined;
}
export function isCustomerOrderStripeEvent(event: CustomerOrderStripeEvent) {
  return Boolean(event.account && eventTypes.has(event.type) && clean(metadataOf(event)?.order_id) &&
    (metadataOf(event)?.billing_flow === "customer_order" || isLegacyInternalRecovery(event)));
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
  const originalAccount = await resolveOrderPaymentAccount(service, {
    photographerId: seed.photographer_id, orderId: seed.id, orderGroupId: seed.order_group_id,
    checkoutSessionId: seed.stripe_checkout_session_id,
    paymentIntentId: seed.stripe_payment_intent_id,
    livemode: event.livemode,
  });
  if (originalAccount !== event.account || clean(metadata?.photographer_id) !== seed.photographer_id) {
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
  // Payment proof also supports an explicitly saved zero-cost checkout. The
  // ordinary checkout helper intentionally accepts positive sale totals only.
  const amounts = orders.map(row => row.total_cents != null ? Number(row.total_cents)
    : row.total_amount != null ? Math.round(Number(row.total_amount) * 100) : Number.NaN);
  const total = amounts.reduce((sum, value) => sum + value, 0);
  const currency = clean(object.currency).toLowerCase(), amount = sessionEvent ? object.amount_total : object.amount;
  if (!currency || amounts.some(value => !Number.isSafeInteger(value) || value < 0) ||
      !Number.isSafeInteger(total) || !Number.isSafeInteger(amount) || amount !== total ||
      orders.some(row => clean(row.currency || "cad").toLowerCase() !== currency)) throw new PaymentScopeError("Customer payment amount or currency does not match the saved order.");
  return { orderId, sessionId, paymentIntentId, ownerId: seed.photographer_id, groupId: seed.order_group_id, ids: orders.map(row => row.id) };
}

async function verifyPaidCompletion(service: SupabaseClient, scope: Awaited<ReturnType<typeof verifiedOrderScope>>) {
  let query = service.from("orders")
    .select("id,photographer_id,order_group_id,status,paid_at,payment_status,stripe_checkout_session_id,stripe_payment_intent_id", { count: "exact" });
  query = scope.groupId ? query.eq("order_group_id", scope.groupId) : query.in("id", scope.ids);
  const { data, error, count } = await query;
  if (error) throw error;
  if (count !== scope.ids.length || data?.length !== scope.ids.length || data.some(row =>
    !scope.ids.includes(row.id) || row.photographer_id !== scope.ownerId || row.order_group_id !== scope.groupId)) {
    throw new PaymentScopeError("Customer payment order scope changed during completion.");
  }
  // The finalizer deliberately preserves terminal cancellation/refund states.
  // A provider-verified delayed payment delivery must acknowledge those states
  // without turning them paid or leaving an impossible completion retry.
  const terminal = new Set(["refunded", "refund_pending", "cancelled", "canceled", "cancel_pending"]);
  if (data.some(row => (!terminal.has(clean(row.status).toLowerCase()) && (!row.paid_at ||
      !["paid", "succeeded", "no_payment_required", "partially_refunded", "refunded"].includes(clean(row.payment_status).toLowerCase()))) ||
    (scope.sessionId && row.stripe_checkout_session_id !== scope.sessionId) ||
    (scope.paymentIntentId && row.stripe_payment_intent_id !== scope.paymentIntentId))) {
    throw new Error("Customer payment completion is incomplete; retry required.");
  }
}

/** A claimed event is complete only after the paid state and its outbox commit. */
export async function processCustomerOrderStripeEvent(service: SupabaseClient, event: CustomerOrderStripeEvent) {
  if (!isCustomerOrderStripeEvent(event)) return { ok: true, status: 200, ignored: true };
  const orderId = clean(metadataOf(event)?.order_id), token = randomUUID();
  if (!uuid.test(orderId) || !clean(event.id) || event.id.length > 255) {
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
    const failed = event.type === "payment_intent.payment_failed";
    const paid = (event.type.startsWith("checkout.session.") && ["paid", "no_payment_required"].includes(clean(object.payment_status))) ||
      (event.type === "payment_intent.succeeded" && object.status === "succeeded");
    if (failed || paid) {
      // A valid merchant webhook and editable metadata are not payment proof.
      // Preserve the saved-checkout/provider verification and order/group lock
      // used by checkout, refunds and the legacy webhook path.
      const proof = { accountId: event.account!, orderId: scope.orderId, checkoutSessionId: scope.sessionId,
        paymentIntentId: scope.paymentIntentId, livemode: event.livemode,
        // Pre-existing internal recovery hashes omitted the flow marker. Keep
        // their identity stable; provider GETs below still require customer_order.
        ...(!isLegacyInternalRecovery(event) ? {metadata: metadataOf(event)} : {}), outcome: failed ? "failed" as const : "paid" as const };
      const verified = await verifyOrderWebhookPayment(service, proof);
      if (!verified && paid) throw new PaymentScopeError("The saved payment order is no longer available.");
      if (verified) {
        const release = await lockOrderPayment(service, verified.lockKey);
        try {
          const current = await verifyOrderWebhookPayment(service, proof);
          if (!current || current.lockKey !== verified.lockKey) throw new Error("The saved payment changed during verification.");
          if (failed) {
            await markOrderOrGroupPaymentFailure(service, { orderId: scope.orderId, paymentIntentId: scope.paymentIntentId, note: `[Stripe payment intent ${scope.paymentIntentId}] payment failed` });
          } else {
            const finalized = await finalizePaidOrderOrGroup(service, {
              orderId: scope.orderId, checkoutSessionId: scope.sessionId, paymentIntentId: scope.paymentIntentId,
              paymentStatus: event.type === "payment_intent.succeeded" ? "succeeded" : clean(object.payment_status),
              note: `[Stripe ${event.type} ${clean(object.id)}] payment confirmed`, paidAt: new Date().toISOString(),
            });
            if (!finalized) throw new PaymentScopeError("Customer payment order disappeared during completion.");
            await verifyPaidCompletion(service, scope);
          }
        } finally { await release(); }
      }
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
        const account = await resolveOrderPaymentAccount(service, {
          photographerId: row.photographer_id, orderId: row.id,
          orderGroupId: row.order_group_id, checkoutSessionId: row.stripe_checkout_session_id,
        });
        if (!account) throw new Error("Customer payment owner unavailable.");
        const session = await retrieveCheckoutSession(row.stripe_checkout_session_id!, account);
        if (!["paid", "no_payment_required"].includes(session.payment_status || "")) { unpaid++; return; }
        if (session.id !== row.stripe_checkout_session_id || session.metadata?.billing_flow !== "customer_order" || session.metadata.photographer_id !== row.photographer_id ||
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
            metadata: { order_id: session.metadata.order_id, photographer_id: session.metadata.photographer_id,
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

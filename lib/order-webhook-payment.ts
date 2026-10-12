import type { SupabaseClient } from "@supabase/supabase-js";
import { getConnectedAccountId, retrieveCheckoutSession, retrievePaymentIntent } from "@/lib/payments";

type SavedOrder = {
  id: string;
  photographer_id: string | null;
  order_group_id: string | null;
  total_cents: number | null;
  total_amount: number | null;
  currency: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
};
const select = "id,photographer_id,order_group_id,total_cents,total_amount,currency,stripe_checkout_session_id,stripe_payment_intent_id";

/** Connected merchants control metadata; it is never proof of another order's payment. */
export async function verifyOrderWebhookPayment(service: SupabaseClient, input: {
  accountId: string;
  orderId: string;
  checkoutSessionId?: string | null;
  paymentIntentId?: string | null;
  outcome: "paid" | "failed";
}) {
  const fail = () => { throw new Error("Stripe webhook payment does not match its saved checkout."); };
  const seed = await service.from("orders").select(select).eq("id", input.orderId).maybeSingle<SavedOrder>();
  if (seed.error) throw seed.error;
  if (!seed.data) return false;
  let orders = [seed.data];
  if (seed.data.order_group_id) {
    const group = await service.from("orders").select(select, { count: "exact" }).eq("order_group_id", seed.data.order_group_id);
    if (group.error) throw group.error;
    orders = (group.data ?? []) as SavedOrder[];
    if (group.count == null || orders.length !== group.count) fail();
  }
  const owner = seed.data.photographer_id;
  const groupId = seed.data.order_group_id;
  const currency = (seed.data.currency || "cad").toLowerCase();
  if (!owner || !orders.length || !orders.some(order => order.id === seed.data!.id) ||
      new Set(orders.map(order => order.id)).size !== orders.length ||
      orders.some(order => order.photographer_id !== owner || order.order_group_id !== groupId ||
        (order.currency || "cad").toLowerCase() !== currency)) fail();
  const amounts = orders.map(order => order.total_cents != null ? Number(order.total_cents)
    : order.total_amount != null ? Math.round(Number(order.total_amount) * 100) : Number.NaN);
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  if (amounts.some(amount => !Number.isSafeInteger(amount) || amount < 0) || !Number.isSafeInteger(total) || total < 0) fail();
  const photographer = await service.from("photographers").select("stripe_account_id,stripe_connected_account_id").eq("id", owner).maybeSingle();
  if (photographer.error) throw photographer.error;
  if (!photographer.data || getConnectedAccountId(photographer.data) !== input.accountId) fail();
  const matchesMetadata = (metadata: Record<string, string> | null | undefined) =>
    metadata?.billing_flow === "customer_order" && metadata.photographer_id === owner &&
    orders.some(order => order.id === metadata.order_id) && (metadata.order_group_id || null) === groupId;
  const savedSessions = [...new Set(orders.map(order => order.stripe_checkout_session_id).filter((id): id is string => Boolean(id)))];
  const savedIntents = [...new Set(orders.map(order => order.stripe_payment_intent_id).filter((id): id is string => Boolean(id)))];
  if (savedSessions.length > 1 || savedIntents.length > 1 ||
      (input.checkoutSessionId && savedSessions.some(id => id !== input.checkoutSessionId)) ||
      (input.paymentIntentId && savedIntents.some(id => id !== input.paymentIntentId))) fail();

  const sessionId = input.checkoutSessionId || savedSessions[0];
  let intentId: string | undefined = input.paymentIntentId || savedIntents[0];
  if (sessionId) {
    const session = await retrieveCheckoutSession(sessionId, input.accountId);
    if (session.id !== sessionId || session.mode !== "payment" || session.amount_total !== total ||
        session.currency?.toLowerCase() !== currency || !matchesMetadata(session.metadata) ||
        (session.client_reference_id != null && session.client_reference_id !== session.metadata?.order_id) ||
        (intentId && session.payment_intent !== intentId)) fail();
    if (input.outcome === "paid" && (session.status !== "complete" ||
        !["paid", "no_payment_required"].includes(session.payment_status || "") ||
        (session.payment_status === "no_payment_required" && total !== 0))) fail();
    intentId = intentId || session.payment_intent || undefined;
    if (savedIntents.some(id => id !== intentId)) fail();
  }
  if (!intentId) {
    if (input.outcome === "paid" && sessionId && total === 0) return { lockKey: groupId || seed.data.id };
    fail();
  }
  const intent = await retrievePaymentIntent(intentId!, input.accountId);
  if (intent.id !== intentId || intent.amount !== total || intent.currency?.toLowerCase() !== currency ||
      !matchesMetadata(intent.metadata)) fail();
  if (input.outcome === "paid") {
    if (intent.status !== "succeeded" || intent.amount_received !== total) fail();
    return { lockKey: groupId || seed.data.id };
  }
  // A delayed failure delivery must not regress a payment that has since succeeded.
  return ["requires_payment_method", "canceled"].includes(intent.status)
    ? { lockKey: groupId || seed.data.id } : false;
}

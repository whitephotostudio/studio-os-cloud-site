import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildOrderRefundEmail } from "@/lib/order-refund-email";
import { resendConfigured, resolveReplyTo, sendResendEmail, type SendResendEmailInput } from "@/lib/resend";

export type ConfirmedRefund = { id: string; status: string; amount: number; currency: string; created: number };
export type RefundNotificationInput = { account: string; paymentIntentId: string; orderId: string; refunds: ConfirmedRefund[] };
const email = (value: string | null | undefined) => resolveReplyTo(value)?.toLowerCase() ?? null;

export async function queueOrderRefundEmails(service: SupabaseClient, input: RefundNotificationInput) {
  const refunds = input.refunds.filter(r => r.status === "succeeded" && r.amount > 0);
  if (!refunds.length) return [] as string[];
  const { data: seed, error: seedError } = await service.from("orders").select("id,order_group_id,photographer_id").eq("id", input.orderId).single();
  if (seedError || !seed) throw new Error("Refund notification order unavailable");
  let query = service.from("orders").select("id,photographer_id,stripe_payment_intent_id,customer_name,parent_name,customer_email,parent_email,currency,total_cents,total_amount");
  query = seed.order_group_id ? query.eq("order_group_id", seed.order_group_id) : query.eq("id", seed.id);
  const { data: orders, error: orderError } = await query.order("id");
  if (orderError || !orders?.length || orders.some(o => o.photographer_id !== seed.photographer_id || o.stripe_payment_intent_id !== input.paymentIntentId)) throw new Error("Refund notification payment scope mismatch");
  const { data: photographer, error: photographerError } = await service.from("photographers").select("id,user_id,business_name,billing_email,studio_email,stripe_connected_account_id,stripe_account_id").eq("id", seed.photographer_id).single();
  if (photographerError || !photographer || (photographer.stripe_connected_account_id || photographer.stripe_account_id) !== input.account) throw new Error("Refund notification studio mismatch");
  const buyers = [...new Set(orders.map(o => email(o.customer_email) || email(o.parent_email)))];
  // A combined payment has one buyer. Never expose another buyer's order.
  if (buyers.length !== 1 || !buyers[0]) throw new Error("Refund notification buyer unavailable or ambiguous");
  let photographerEmail = email(photographer.billing_email) || email(photographer.studio_email);
  if (!photographerEmail && photographer.user_id) {
    const { data, error } = await service.auth.admin.getUserById(photographer.user_id);
    if (error) throw new Error("Refund notification photographer unavailable");
    photographerEmail = email(data.user?.email);
  }
  if (!photographerEmail) throw new Error("Refund notification photographer email missing");
  const currency = (orders[0].currency || "cad").toLowerCase();
  const total = orders.reduce((sum,o) => sum + Number(o.total_cents ?? Math.round(Number(o.total_amount || 0)*100)), 0);
  if (!Number.isSafeInteger(total) || total <= 0 || orders.some(o => (o.currency || "cad").toLowerCase() !== currency) || refunds.some(r => !/^re_[A-Za-z0-9]+$/.test(r.id) || !Number.isSafeInteger(r.amount) || r.amount > total || r.currency?.toLowerCase() !== currency || !Number.isFinite(r.created) || r.created <= 0)) throw new Error("Refund notification amount or currency mismatch");
  const rows = refunds.flatMap(refund => (["client", "photographer"] as const).map(audience => {
    const key = createHash("sha256").update(`${input.account}:${refund.id}:${audience}`).digest("hex");
    const message = buildOrderRefundEmail({ audience, studioName: photographer.business_name?.trim() || "Your photography studio", customerName: orders[0].customer_name || orders[0].parent_name || "the customer", orderIds: orders.map(o=>o.id), amountCents: refund.amount, currency, refundId: refund.id, issuedAt: new Date(refund.created*1000).toISOString() });
    const payload: SendResendEmailInput = { ...message, to: audience === "client" ? buyers[0]! : photographerEmail!, fromName: photographer.business_name || "Studio OS", replyTo: email(photographer.studio_email) || photographerEmail, tags: [{ name: "type", value: "order-refund" }, {name:"audience",value:audience}], idempotencyKey: `order-refund-${key}`, timeoutMs: 15000 };
    return { dedupe_key: key, photographer_id: photographer.id, order_ids: orders.map(o=>o.id), stripe_account_id: input.account, stripe_refund_id: refund.id, audience, payload };
  }));
  // Freeze the original recipient and content even if a later retry sees edits.
  const { error } = await service.from("order_refund_emails").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
  if (error) throw error;
  const { data, error: readError } = await service.from("order_refund_emails").select("id").in("dedupe_key", rows.map(r=>r.dedupe_key));
  if (readError) throw readError;
  return (data ?? []).map(r=>r.id as string);
}

export async function deliverOrderRefundEmails(service: SupabaseClient, ids: string[] | null = null) {
  if (!resendConfigured()) throw new Error("Refund email provider is not configured");
  if (ids?.length === 0) return { sent: 0, failed: 0 };
  const { data, error } = await service.rpc("claim_order_refund_emails", { p_ids: ids, p_limit: 10 });
  if (error) throw error;
  let sent = 0; let failed = 0;
  for (const row of data ?? []) {
    try {
      const result = await sendResendEmail(row.payload as SendResendEmailInput);
      if (!result.id) throw new Error("Provider response missing receipt");
      const { error: updateError } = await service.from("order_refund_emails").update({ status: "sent", resend_email_id: result.id, sent_at: new Date().toISOString(), lease_token: null, lease_until: null, last_error: null }).eq("id", row.id).eq("lease_token", row.lease_token);
      if (updateError) throw updateError;
      sent += 1;
    } catch {
      // Never store raw provider errors or secrets. The frozen payload and
      // same provider idempotency key make an ambiguous send safe to retry.
      const retryAt = new Date(Date.now()+Math.min(1800,60*2**Math.min(row.attempts,5))*1000).toISOString();
      const { error: retryError } = await service.from("order_refund_emails").update({ status:"pending", next_attempt_at:retryAt, lease_token:null, lease_until:null, last_error:"Email delivery could not be confirmed; retry scheduled." }).eq("id",row.id).eq("lease_token",row.lease_token);
      if (retryError) console.error("[refund-email] Unable to release delivery lease", {id:row.id});
      failed += 1;
    }
    await delay(600);
  }
  return { sent, failed };
}

export async function scheduleOrderRefundEmails(service: SupabaseClient, input: RefundNotificationInput) {
  const ids = await queueOrderRefundEmails(service,input);
  if (ids.length) after(async () => {
    try { await deliverOrderRefundEmails(service,ids); }
    catch { console.error("[refund-email] Delivery deferred to retry worker"); }
  });
}

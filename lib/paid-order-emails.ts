import { setTimeout as delay } from "node:timers/promises";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildOrderNotificationEmail, type OrderNotificationOrder, type OrderNotificationItem, type OrderNotificationPhotographer } from "@/lib/order-notification-email";
import { buildOrderReceiptEmail, type OrderReceiptPhotographer } from "@/lib/order-receipt-email";
import { buildDigitalDeliveryEmailForOrder } from "@/lib/digital-delivery";
import { resendConfigured, resolveReplyTo, sendResendEmail, ResendRequestError, type SendResendEmailInput } from "@/lib/resend";

type FrozenOrder = OrderNotificationOrder & { project_id?: string | null };
type FrozenStudio = OrderNotificationPhotographer & OrderReceiptPhotographer;
type FrozenContext = { project_title?: string | null; school_name?: string | null; student_name?: string | null; project_pin?: string | null; student_pin?: string | null };
type PaidEmailRow = {
  id: string; order_id: string; photographer_id: string; kind: "receipt" | "photographer" | "digital";
  recipient_email: string | null; snapshot: { order: FrozenOrder; items: OrderNotificationItem[]; photographer: FrozenStudio; context: FrozenContext };
  payload: SendResendEmailInput | null; attempts: number; first_attempt_at: string | null; lease_token: string;
};
const email = (value: string | null | undefined) => resolveReplyTo(value)?.toLowerCase() ?? null;
class UnsendablePaidEmail extends Error {}

// The database trigger creates jobs in the same transaction as the paid order.
// This RPC deliberately discovers existing work only: replaying a historical
// paid order must never re-send receipts sent before the outbox was installed.
export async function queuePaidOrderEmails(service: SupabaseClient, orderId: string) {
  const { data, error } = await service.rpc("ensure_paid_order_emails", { p_order_id: orderId });
  if (error) throw error;
  return (data ?? []).map((row: { id: string }) => row.id);
}

async function buildPayload(service: SupabaseClient, row: PaidEmailRow): Promise<SendResendEmailInput | null> {
  const recipient = email(row.recipient_email);
  if (!recipient || recipient !== row.recipient_email) throw new UnsendablePaidEmail("Recipient unavailable");
  if (row.kind === "digital") {
    const prepared = await buildDigitalDeliveryEmailForOrder(service, row.order_id, { recipientEmail: recipient, force: false });
    if (prepared.skipped) return null;
    return { ...prepared.payload, timeoutMs: 15000 };
  }
  const { order, items, photographer, context } = row.snapshot;
  if (!order || order.id !== row.order_id) throw new UnsendablePaidEmail("Order snapshot unavailable");
  if (row.kind === "photographer") {
    return { ...buildOrderNotificationEmail({ order, items, photographer, context,
      dashboardUrl: "https://www.studiooscloud.com/dashboard/orders" }),
      to: recipient, fromName: "Studio OS Cloud", replyTo: recipient,
      tags: [{ name: "type", value: "order-notification" }], idempotencyKey: `order-notify-${row.order_id}`, timeoutMs: 15000 };
  }
  let ordersHistoryUrl: string | null = null;
  if (context.student_pin) {
    const params = new URLSearchParams({ email: recipient, tab: "orders" });
    ordersHistoryUrl = `https://www.studiooscloud.com/parents/${encodeURIComponent(context.student_pin)}?${params}`;
  } else if (context.project_pin && order.project_id) {
    const params = new URLSearchParams({ mode: "event", project: order.project_id, email: recipient, tab: "orders" });
    ordersHistoryUrl = `https://www.studiooscloud.com/parents/${encodeURIComponent(context.project_pin)}?${params}`;
  }
  return { ...buildOrderReceiptEmail({ order, items, photographer, context, ordersHistoryUrl }),
    to: recipient, fromName: photographer.business_name?.trim() || "Studio OS Cloud",
    replyTo: email(photographer.studio_email) || recipient,
    tags: [{ name: "type", value: "order-receipt" }], idempotencyKey: `order-receipt-${row.order_id}`, timeoutMs: 15000 };
}

async function updateLease(service: SupabaseClient, row: PaidEmailRow, changes: Record<string, unknown>) {
  const { data, error } = await service.from("paid_order_emails").update(changes)
    .eq("id", row.id).eq("lease_token", row.lease_token).select("id");
  if (error || data?.length !== 1) throw new Error("Paid email delivery lease changed");
}

async function recordDigitalDelivery(service: SupabaseClient, row: PaidEmailRow) {
  const { data: order, error } = await service.from("orders").select("notes")
    .eq("id", row.order_id).eq("photographer_id", row.photographer_id).maybeSingle();
  if (error || !order) throw new Error("Digital delivery record unavailable");
  const notes = typeof order.notes === "string" ? order.notes : "";
  if (notes.includes("Digital delivery link emailed")) return;
  const line = `Digital delivery link emailed ${new Date().toISOString()} to ${row.recipient_email}.`;
  let update = service.from("orders").update({ notes: notes ? `${notes}\n\n${line}` : line })
    .eq("id", row.order_id).eq("photographer_id", row.photographer_id);
  update = order.notes == null ? update.is("notes", null) : update.eq("notes", order.notes);
  const result = await update.select("id");
  if (result.error || result.data?.length !== 1) throw new Error("Digital delivery note changed; retry required");
}

export async function deliverPaidOrderEmails(service: SupabaseClient, ids: string[] | null = null) {
  if (!resendConfigured()) throw new Error("Paid order email provider is not configured");
  if (ids?.length === 0) return { sent: 0, failed: 0, deferred: 0 };
  const { data, error } = await service.rpc("claim_paid_order_emails", { p_ids: ids, p_limit: 200 });
  if (error) throw error;
  const rows = (data ?? []) as PaidEmailRow[];
  let sent = 0; let failed = 0; let deferred = 0;
  let providerPauseUntil = 0;
  const startedAt = Date.now();
  try {
    for (const row of rows) {
      // Leave ample time for provider timeout and ledger acknowledgement within
      // the 180-second worker budget and the three-minute database lease.
      if (Date.now() - startedAt > 110000 || providerPauseUntil > Date.now()) {
        await updateLease(service, row, { status: "pending", attempts: Math.max(0, row.attempts - 1),
          lease_token: null, lease_until: null,
          ...(providerPauseUntil > Date.now() ? { next_attempt_at: new Date(providerPauseUntil).toISOString() } : {}) });
        deferred += 1;
        continue;
      }
      try {
        if (row.kind === "digital" && row.payload) {
          const recorded = await service.from("orders").select("notes")
            .eq("id", row.order_id).eq("photographer_id", row.photographer_id).maybeSingle();
          if (recorded.error || !recorded.data) throw new Error("Digital delivery record unavailable");
          if (typeof recorded.data.notes === "string" && recorded.data.notes.includes("Digital delivery link emailed")) {
            await updateLease(service, row, { status: "sent", sent_at: new Date().toISOString(),
              lease_token: null, lease_until: null, last_error: "Digital delivery was already recorded." });
            sent += 1;
            continue;
          }
        }
        const payload = row.payload ?? await buildPayload(service, row);
        if (!payload) {
          // The pre-existing manual delivery marker is also respected during
          // migration, so manual and automatic delivery do not duplicate it.
          await updateLease(service, row, { status: "sent", sent_at: new Date().toISOString(),
            lease_token: null, lease_until: null, last_error: "Digital delivery was already recorded." });
          sent += 1;
          continue;
        }
        // The RPC freezes the payload before the first provider request and
        // re-checks the current paid order and owner. Retries use this returned
        // payload, including the original digital token, without regenerating it.
        const prepared = await service.rpc("prepare_paid_order_email", {
          p_id: row.id, p_lease_token: row.lease_token, p_payload: payload,
        });
        if (prepared.error) throw prepared.error;
        const frozen = (prepared.data as PaidEmailRow[] | null)?.[0]?.payload;
        // A missing result can also mean the lease expired during digital
        // preparation. Leave it retryable; the next claim cancels invalid
        // payment/owner scope without sending anything.
        if (!frozen) throw new Error("Paid email preparation lease or scope changed");
        const result = await sendResendEmail(frozen);
        if (!result.id) throw new Error("Provider response missing receipt");
        if (row.kind === "digital") await recordDigitalDelivery(service, row);
        await updateLease(service, row, { status: "sent", resend_email_id: result.id, sent_at: new Date().toISOString(),
          lease_token: null, lease_until: null, last_error: null });
        sent += 1;
      } catch (failure) {
        const permanent = failure instanceof UnsendablePaidEmail;
        const retryAfter = failure instanceof ResendRequestError ? failure.retryAfterMs ?? 0 : 0;
        if (failure instanceof ResendRequestError && failure.status === 429) {
          providerPauseUntil = Date.now() + Math.max(retryAfter, 1000);
        }
        const retryAt = new Date(Date.now() + Math.max(retryAfter, Math.min(1800, 60 * 2 ** Math.min(row.attempts, 5)) * 1000)).toISOString();
        try {
          await updateLease(service, row, { status: permanent ? "needs_review" : "pending", next_attempt_at: retryAt,
            lease_token: null, lease_until: null, last_error: permanent
              ? "Paid email recipient or payment scope requires review."
              : "Email delivery could not be confirmed; retry scheduled." });
        } catch { console.error("[paid-order-email] Delivery lease will expire for retry", { id: row.id }); }
        failed += 1;
      }
      // One global database worker lease prevents concurrent webhook and cron
      // calls from multiplying this paced stream of provider requests.
      await delay(250);
    }
  } finally {
    if (rows.length) {
      const released = await service.rpc("release_paid_order_email_worker", { p_lease_token: rows[0].lease_token });
      if (released.error) console.error("[paid-order-email] Worker lease will expire for retry");
    }
  }
  return { sent, failed, deferred };
}

export async function schedulePaidOrderEmails(service: SupabaseClient, orderId: string) {
  const ids = await queuePaidOrderEmails(service, orderId);
  if (ids.length) after(async () => {
    try { await deliverPaidOrderEmails(service, ids); }
    catch { console.error("[paid-order-email] Delivery deferred to retry worker"); }
  });
}

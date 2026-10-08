import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";
import { getConnectedAccountId, stripeRequest, markOrderOrGroupRefunded } from "@/lib/payments";
import { lockOrderPayment } from "@/lib/order-payment-lock";
import { assertPaymentBelongsToOrders, verifyPaymentConfirmation, verifyPaymentTarget, type ApplicationFeeCharge, type PaymentOrder, type PaymentSnapshot } from "@/lib/order-payment-policy";
import { completeDirectOrderApplicationFeeRefund, verifyDirectOrderApplicationFeeRefund, type DirectOrderFeeRefundState } from "@/lib/direct-order-fee-refund";
import { recordAudit } from "@/lib/audit";
import { scheduleOrderRefundEmails, type ConfirmedRefund } from "@/lib/order-refund-notifications";

export const dynamic = "force-dynamic";
const inputSchema = z.object({ orderId: z.string().uuid(), action: z.enum(["refund", "cancel"]),
  reason: z.string().trim().min(3).max(500), paymentId: z.string().nullable(),
  amountCents: z.number().int().nonnegative(), orderIds: z.array(z.string().uuid()).min(1).max(100) });
type Session = { id: string; status: string; payment_status: string; payment_intent: string | null; };
type Intent = { id: string; status: string; amount: number; amount_received: number; currency: string; latest_charge: string | null; metadata: Record<string,string>; };
type Charge = ApplicationFeeCharge & { amount_refunded: number };
type Refund = ConfirmedRefund;

async function context(request: NextRequest, orderId: string) {
  const { user, mfaSatisfied } = await resolveDashboardAuth(request);
  if (!user || !mfaSatisfied) throw new Error("Sign in to the studio account to manage payments.");
  const service = createDashboardServiceClient();
  const { data: photographer, error: pe } = await service.from("photographers").select("id,stripe_account_id,stripe_connected_account_id").eq("user_id", user.id).single();
  if (pe || !photographer) throw new Error("Studio account unavailable.");
  const { data: order, error } = await service.from("orders").select("*").eq("id", orderId).eq("photographer_id", photographer.id).single();
  if (error || !order) throw new Error("Order not found in your studio.");
  let orders = [order];
  if (order.order_group_id) {
    // Read all group members, then verify ownership; never silently operate on a partial group.
    const { data, error: ge } = await service.from("orders").select("*").eq("order_group_id", order.order_group_id).order("id");
    if (ge || !data?.length || data.some((o) => o.photographer_id !== photographer.id)) throw new Error("Combined order ownership could not be verified.");
    orders = data;
  }
  return { user, service, photographer, order, orders: orders as (PaymentOrder & { parent_name?: string; customer_name?: string })[], account: getConnectedAccountId(photographer) };
}

async function paymentState(ctx: Awaited<ReturnType<typeof context>>) {
  const { orders, account } = ctx;
  const sessions = [...new Set(orders.map((o) => o.stripe_checkout_session_id).filter(Boolean))];
  const paymentIds = [...new Set(orders.map((o) => o.stripe_payment_intent_id).filter(Boolean))];
  if (sessions.length > 1 || paymentIds.length > 1) throw new Error("Multiple payments are linked to this checkout. Review them in Stripe.");
  if ((sessions.length || paymentIds.length) && !account) throw new Error("Connect the studio Stripe account before managing this payment.");
  let session: Session | null = null;
  if (sessions[0]) session = await stripeRequest<Session>(`checkout/sessions/${encodeURIComponent(sessions[0])}`, { account: account! });
  const paymentId = paymentIds[0] || session?.payment_intent || null;
  let confirmedRefunds: Refund[] = [];
  let intent: Intent | null = null; let charge: Charge | null = null; let pending = false; let confirmedRefundCents = 0;
  let applicationFee: DirectOrderFeeRefundState = { refundApplicationFee: false, fullyRefunded: true, applicationFeeId: null, fee: null };
  if (paymentId) {
    intent = await stripeRequest<Intent>(`payment_intents/${encodeURIComponent(paymentId)}`, { account: account! });
    assertPaymentBelongsToOrders(orders, intent);
    if (intent.latest_charge) {
      charge = await stripeRequest<Charge>(`charges/${encodeURIComponent(intent.latest_charge)}`, { account: account! });
      if (intent.status === "succeeded" && intent.amount_received > 0) {
        applicationFee = await verifyDirectOrderApplicationFeeRefund({ orders, account: account!, payment: intent, charge });
      }
      const refunds = await stripeRequest<{ data: Refund[]; has_more: boolean }>("refunds", { account: account!, query: new URLSearchParams({ payment_intent: paymentId, limit: "100" }) });
      if (refunds.has_more) throw new Error("Review this payment’s refund history in Stripe.");
      confirmedRefunds = refunds.data.filter(r => r.status === "succeeded");
      confirmedRefundCents = refunds.data.filter((r) => r.status === "succeeded").reduce((sum, r) => sum + r.amount, 0);
      pending = refunds.data.some((r) => ["pending", "requires_action"].includes(r.status));
    }
  }
  const chargedCents = intent?.amount_received || 0;
  if (chargedCents > 0 && orders.some((row) => row.platform_fee_collection_method != null) && !charge) {
    throw new Error("The charged order service fee is still awaiting Stripe verification.");
  }
  const refundedCents = confirmedRefundCents;
  const remainingCents = Math.max(0, chargedCents - refundedCents);
  const customerRefundComplete = chargedCents > 0 && remainingCents === 0 && !pending;
  const applicationFeeRefundPending = customerRefundComplete && !applicationFee.fullyRefunded;
  const canCompleteApplicationFeeRefund = applicationFeeRefundPending && charge?.amount_refunded === charge?.amount;
  pending ||= applicationFeeRefundPending;
  const closed = orders.some((o) => ["cancelled", "canceled", "refunded"].includes(o.status || ""));
  const ambiguous = orders.some((o) => o.status === "checkout_starting");
  const databasePaid = orders.some((o) => o.paid_at || ["paid", "succeeded", "refunded", "partially_refunded"].includes(o.payment_status || ""));
  const canCancel = !closed && !ambiguous && !databasePaid && !chargedCents &&
    (!session || ["open", "expired"].includes(session.status)) &&
    (!intent || ["requires_payment_method", "requires_confirmation", "requires_action", "canceled"].includes(intent.status));
  const snapshot: PaymentSnapshot = { paymentId, currency: intent?.currency || orders[0].currency || "cad", chargedCents, refundedCents, remainingCents,
    pending, canRefund: intent?.status === "succeeded" && remainingCents > 0 && !pending,
    canCancel, orderIds: orders.map((o) => o.id),
    status: pending ? "Refund pending" : refundedCents >= chargedCents && chargedCents > 0 ? "Refunded" : closed ? "Cancelled" : ambiguous ? "Checkout recovery required" : chargedCents > 0 ? "Paid" : "Unpaid",
    customer: orders[0].parent_name || orders[0].customer_name || "Customer", applicationFeeRefundPending, canCompleteApplicationFeeRefund,
    applicationFeeRefundRemainingCents: applicationFee.fee ? applicationFee.fee.amount - applicationFee.fee.amount_refunded : 0,
    applicationFeeCurrency: applicationFee.fee?.currency ?? null };
  return { snapshot, session, intent, charge, applicationFee, customerRefundComplete, confirmedRefunds };
}

async function notifyRefunds(ctx: Awaited<ReturnType<typeof context>>, paymentIntentId: string | null, refunds: Refund[]) {
  if (!ctx.account || !paymentIntentId || !refunds.length) return;
  try { await scheduleOrderRefundEmails(ctx.service, { account: ctx.account, paymentIntentId, orderId: ctx.order.id, refunds }); }
  catch { console.error("[refund-email] Confirmation queue unavailable; Stripe webhook will retry"); }
}

export async function GET(request: NextRequest) {
  try {
    const id = z.string().uuid().parse(request.nextUrl.searchParams.get("orderId"));
    const ctx = await context(request, id);
    const { snapshot, confirmedRefunds, customerRefundComplete, applicationFee } = await paymentState(ctx);
    // Refresh also repairs a lost successful refund response or delayed webhook.
    // This only reconciles verified ledger state; it never moves money.
    if (customerRefundComplete && applicationFee.fullyRefunded && ctx.orders.some((o) => o.status !== "refunded")) {
      await markOrderOrGroupRefunded(ctx.service, { orderId: ctx.order.id, partial: false, refundAmountCents: snapshot.refundedCents, note: "Full Stripe refund verified during payment refresh." });
    } else if (customerRefundComplete && !applicationFee.fullyRefunded) {
      const { error } = await ctx.service.from("orders").update({ status: "refund_pending" }).in("id", snapshot.orderIds);
      if (error) throw error;
    }
    await notifyRefunds(ctx, snapshot.paymentId, confirmedRefunds);
    return NextResponse.json({ ok: true, ...snapshot });
  } catch { return NextResponse.json({ ok: false, message: "Could not verify this order with Stripe. Check your sign-in and connection, then refresh. No payment action was taken." }, { status: 409 }); }
}

export async function POST(request: NextRequest) {
  let release: (() => Promise<void>) | undefined;
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) throw new Error("Invalid request origin");
    const body = inputSchema.parse(await request.json());
    let ctx = await context(request, body.orderId);
    release = await lockOrderPayment(ctx.service, ctx.order.order_group_id || ctx.order.id);
    ctx = await context(request, body.orderId);
    const { snapshot, session, intent, charge, applicationFee, customerRefundComplete, confirmedRefunds } = await paymentState(ctx);
    // Successful repeated clicks are harmless; return the reconciled result.
    if (body.action === "refund" && customerRefundComplete) {
      verifyPaymentTarget(snapshot, body);
      let feeState = applicationFee;
      if (!feeState.fullyRefunded && intent && charge) {
        const { error } = await ctx.service.from("orders").update({ status: "refund_pending" }).in("id", snapshot.orderIds);
        if (error) throw error;
        feeState = await completeDirectOrderApplicationFeeRefund({ orders: ctx.orders, account: ctx.account!, payment: intent, charge });
        await recordAudit({ request, actorUserId: ctx.user.id, actorPhotographerId: ctx.photographer.id, targetPhotographerId: ctx.photographer.id,
          action: "order.refund_application_fee", entityType: "order", entityId: ctx.order.id, result: "ok",
          metadata: { orderIds: snapshot.orderIds, paymentId: snapshot.paymentId, applicationFeeId: feeState.applicationFeeId, confirmed: feeState.fullyRefunded } });
      }
      if (!feeState.fullyRefunded) return NextResponse.json({ ok: true, message: "Customer refund confirmed. The platform fee refund is still being verified; the order remains on hold.", status: "refund_pending", orderIds: snapshot.orderIds });
      await markOrderOrGroupRefunded(ctx.service, { orderId: ctx.order.id, partial: false, refundAmountCents: snapshot.refundedCents, note: "Full Stripe refund verified." });
      await notifyRefunds(ctx, snapshot.paymentId, confirmedRefunds);
      return NextResponse.json({ ok: true, message: "This payment has already been refunded.", status: "refunded", orderIds: snapshot.orderIds });
    }
    if (body.action === "cancel" && snapshot.chargedCents === 0 && ctx.orders.every((o) => ["cancelled", "canceled"].includes(o.status || ""))) return NextResponse.json({ ok: true, message: "This order is already cancelled.", status: "cancelled", orderIds: snapshot.orderIds });
    verifyPaymentConfirmation(snapshot, body);
    let status: string;
    let refundId: string | null = null;
    if (body.action === "refund") {
      // Persist the production hold BEFORE the external action. Lost replies
      // retain the hold; retry the same Stripe idempotency key to reconcile.
      const { error } = await ctx.service.from("orders").update({ status: "refund_pending" }).in("id", snapshot.orderIds);
      if (error) throw error;
      const refundBody = new URLSearchParams({ payment_intent: snapshot.paymentId!, "metadata[actor_user_id]": ctx.user.id, "metadata[order_id]": [...snapshot.orderIds].sort()[0] });
      if (applicationFee.refundApplicationFee && !applicationFee.fullyRefunded) refundBody.set("refund_application_fee", "true");
      const refund = await stripeRequest<Refund>("refunds", { method: "POST", account: ctx.account!,
        idempotencyKey: `studio-os-full-refund-${snapshot.paymentId}`,
        body: refundBody });
      refundId = refund.id;
      status = refund.status === "succeeded" ? "refunded" : "refund_pending";
      if (refund.status === "failed" || refund.status === "canceled") throw new Error("Refund was not completed. Review the payment in Stripe; the order remains on hold.");
      if (status === "refunded") {
        const confirmed = await paymentState(ctx);
        if (!confirmed.customerRefundComplete || !confirmed.applicationFee.fullyRefunded) status = "refund_pending";
        else {
          await markOrderOrGroupRefunded(ctx.service, { orderId: ctx.order.id, partial: false, refundAmountCents: confirmed.snapshot.refundedCents, note: `Full refund ${refund.id} requested by ${ctx.user.id}. Reason: ${body.reason}` });
          await notifyRefunds(ctx, snapshot.paymentId, confirmed.confirmedRefunds);
        }
      }
    } else {
      // Persist a cancellation hold before the external call. Even if the
      // process/lease expires, checkout must not create a replacement session.
      const { error: holdError } = await ctx.service.from("orders").update({ status: "cancel_pending" }).in("id", snapshot.orderIds);
      if (holdError) throw holdError;
      if (session?.status === "open") await stripeRequest(`checkout/sessions/${encodeURIComponent(session.id)}/expire`, { method: "POST", account: ctx.account!, idempotencyKey: `studio-os-expire-${session.id}` });
      // Checkout-owned intents are managed by expiring their session. Standalone
      // unpaid intents must be cancelled before the order can be closed.
      if (!session && intent && intent.status !== "canceled") await stripeRequest(`payment_intents/${encodeURIComponent(intent.id)}/cancel`, { method: "POST", account: ctx.account!, idempotencyKey: `studio-os-cancel-${intent.id}` });
      status = "cancelled";
      const { error } = await ctx.service.from("orders").update({ status, payment_status: "cancelled" }).in("id", snapshot.orderIds).is("paid_at", null);
      if (error) throw error;
    }
    await recordAudit({ request, actorUserId: ctx.user.id, actorPhotographerId: ctx.photographer.id, targetPhotographerId: ctx.photographer.id,
      action: `order.${body.action}`, entityType: "order", entityId: ctx.order.id, result: "ok",
      metadata: { reason: body.reason, orderIds: snapshot.orderIds, paymentId: snapshot.paymentId, amountCents: snapshot.remainingCents, refundId, status } });
    return NextResponse.json({ ok: true, status, orderIds: snapshot.orderIds,
      message: status === "refunded" ? "Refund confirmed. The order is closed." : status === "refund_pending" ? "Refund submitted. Stripe is processing it; the order is on hold." : "Order cancelled. Its checkout can no longer accept payment." });
  } catch {
    // Stripe error strings may contain credential fragments. Never send them to clients.
    return NextResponse.json({ ok: false, message: "Payment action could not be confirmed. Refresh to check its status before retrying. If a refund was submitted, the order stays on hold while it is verified." }, { status: 409 });
  } finally { await release?.(); }
}

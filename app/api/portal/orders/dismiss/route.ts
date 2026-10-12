import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { validateEventGalleryAccess } from "@/lib/event-gallery-access";
import { hasCalendarBoundaryPassed } from "@/lib/calendar-dates";
import { hasActiveSubscription } from "@/lib/subscription-gate";
import { getConnectedAccountId, stripeRequest } from "@/lib/payments";
import { lockOrderPayment } from "@/lib/order-payment-lock";
import { assertPaymentBelongsToOrders } from "@/lib/order-payment-policy";
import { recordAudit } from "@/lib/audit";
import {
  assertParentCheckoutScope, assertUnpaidStripeCheckout, checkoutScopeFingerprint,
  isUnfinishedCheckout, type ParentCheckoutOrder, type ParentCheckoutGrant,
} from "@/lib/parent-order-dismissal";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  orderId: z.string().uuid(),
  pin: z.string().trim().min(3).max(64),
  email: z.string().trim().email().max(320),
  schoolId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  confirmed: z.literal(true),
}).strict().refine(body => !!body.schoolId !== !!body.projectId, {
  message: "Exactly one gallery is required.",
});
type Input = z.infer<typeof inputSchema>;
type Service = ReturnType<typeof createDashboardServiceClient>;
type Session = { id: string; status: string; payment_status: string; payment_intent: string | null;
  amount_total: number; currency: string; metadata: Record<string, string>;
  customer_email?: string | null; customer_details?: { email?: string | null } | null };
type Intent = { id: string; status: string; amount_received: number; amount: number;
  currency: string; metadata: Record<string, string> };
const selectFields = "id,photographer_id,order_group_id,school_id,project_id,student_id,parent_email,customer_email,status,payment_status,paid_at,refund_status,refund_amount_cents,stripe_checkout_session_id,stripe_payment_intent_id,total_cents,currency,cart_snapshot,parent_dismissed_at";
const unpaidPaymentFilter = "payment_status.is.null,payment_status.in.(pending,unpaid,failed,cancelled,canceled,requires_payment_method,requires_confirmation,requires_action)";

function paymentGalleryMatches(metadata: Record<string, string> | undefined, grant: ParentCheckoutGrant) {
  return metadata?.billing_flow === "customer_order" && (grant.schoolId
    ? metadata.school_id === grant.schoolId && metadata.student_id === grant.studentId && !metadata.project_id
    : metadata?.project_id === grant.projectId && !metadata.school_id && !metadata.student_id);
}

async function context(service: Service, body: Input) {
  const email = body.email.toLowerCase();
  let grant: ParentCheckoutGrant;
  if (body.schoolId) {
    const { data: school, error } = await service.from("schools")
      .select("id,photographer_id,status,portal_status,expiration_date").eq("id", body.schoolId).maybeSingle();
    if (error || !school?.photographer_id || hasCalendarBoundaryPassed(school.expiration_date) ||
        ["inactive", "closed", "pre_release"].includes((school.portal_status || school.status || "").toLowerCase().replaceAll("-", "_"))) {
      throw new Error("School gallery access could not be verified.");
    }
    const { data: student, error: studentError } = await service.from("students")
      .select("id,school_id").eq("school_id", body.schoolId).eq("pin", body.pin).maybeSingle();
    if (studentError || !student) throw new Error("Student access could not be verified.");
    grant = { photographerId: school.photographer_id, schoolId: body.schoolId, studentId: student.id, email };
  } else {
    const access = await validateEventGalleryAccess({ projectId: body.projectId!, pin: body.pin, email });
    if (!access.ok || !access.project.photographer_id) throw new Error("Gallery access could not be verified.");
    grant = { photographerId: access.project.photographer_id, projectId: body.projectId!, email, collectionIds: access.collectionIds };
  }
  const { data: photographer, error: photographerError } = await service.from("photographers")
    .select("id,stripe_account_id,stripe_connected_account_id,is_platform_admin,subscription_status,trial_starts_at,trial_ends_at,created_at")
    .eq("id", grant.photographerId).maybeSingle();
  if (photographerError || !photographer || !hasActiveSubscription(photographer)) {
    throw new Error("The gallery studio could not be verified.");
  }
  const { data: seed, error: orderError } = await service.from("orders")
    .select(selectFields).eq("id", body.orderId).maybeSingle();
  if (orderError || !seed) throw new Error("Checkout could not be verified.");
  let orders = [seed] as ParentCheckoutOrder[];
  if (seed.order_group_id) {
    const { data, error: groupError, count } = await service.from("orders")
      .select(selectFields, { count: "exact" }).eq("order_group_id", seed.order_group_id).order("id");
    if (groupError || count == null || !data?.length || data.length !== count) {
      throw new Error("The complete checkout could not be verified.");
    }
    orders = data as ParentCheckoutOrder[];
  }
  assertParentCheckoutScope(orders, body.orderId, grant);
  return { orders, grant, account: getConnectedAccountId(photographer) };
}

async function paymentState(ctx: Awaited<ReturnType<typeof context>>) {
  if (ctx.orders.some(order => !isUnfinishedCheckout(order, true) ||
      !Number.isSafeInteger(order.total_cents) || order.total_cents < 0)) {
    throw new Error("Completed or processing orders cannot be discarded.");
  }
  const sessions = [...new Set(ctx.orders.map(order => order.stripe_checkout_session_id).filter(Boolean))];
  const payments = [...new Set(ctx.orders.map(order => order.stripe_payment_intent_id).filter(Boolean))];
  if (sessions.length > 1 || payments.length > 1 || ((sessions.length || payments.length) && !ctx.account)) {
    throw new Error("Checkout payment ownership could not be verified.");
  }
  let session: Session | null = null;
  if (sessions[0]) {
    session = await stripeRequest<Session>(`checkout/sessions/${encodeURIComponent(sessions[0])}`, { account: ctx.account! });
    const first = ctx.orders[0];
    const recipient = (session.customer_details?.email?.trim() || session.customer_email?.trim() || "").toLowerCase();
    if (session.id !== sessions[0] || session.metadata?.photographer_id !== first.photographer_id ||
        !paymentGalleryMatches(session.metadata, ctx.grant) || recipient !== ctx.grant.email ||
        !(ctx.orders.some(order => order.id === session!.metadata?.order_id) ||
          (first.order_group_id && session.metadata?.order_group_id === first.order_group_id)) ||
        session.amount_total !== ctx.orders.reduce((sum, order) => sum + order.total_cents, 0) ||
        ctx.orders.some(order => (order.currency || "cad").toLowerCase() !== session!.currency?.toLowerCase())) {
      throw new Error("The Stripe session does not belong to this checkout.");
    }
  }
  const paymentId = payments[0] || session?.payment_intent || null;
  if (payments[0] && session?.payment_intent && payments[0] !== session.payment_intent) {
    throw new Error("Checkout payment changed.");
  }
  let intent: Intent | null = null;
  if (paymentId) {
    intent = await stripeRequest<Intent>(`payment_intents/${encodeURIComponent(paymentId)}`, { account: ctx.account! });
    assertPaymentBelongsToOrders(ctx.orders, intent);
    if (!paymentGalleryMatches(intent.metadata, ctx.grant)) throw new Error("Payment gallery scope changed.");
  }
  assertUnpaidStripeCheckout(session, intent);
  return { session, intent };
}

async function updateScope(service: Service, ctx: Awaited<ReturnType<typeof context>>, status: "cancel_pending" | "cancelled") {
  const ids = ctx.orders.map(order => order.id);
  const { data, error } = await service.from("orders").update(
    status === "cancelled" ? { status, payment_status: "cancelled", parent_dismissed_at: new Date().toISOString() } : { status },
  ).eq("photographer_id", ctx.grant.photographerId).in("id", ids)
    .in("status", ["payment_pending", "cancel_pending", "cancelled", "canceled"])
    .is("paid_at", null).or(unpaidPaymentFilter).select("id");
  if (error || data?.length !== ids.length || data.some(row => !ids.includes(row.id))) {
    throw new Error("Checkout state changed; review its current status.");
  }
}

export async function POST(request: NextRequest) {
  let release: (() => Promise<void>) | undefined;
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) {
      return NextResponse.json({ ok: false, message: "Invalid request origin." }, { status: 403 });
    }
    const limit = await rateLimit(getClientIp(request), { namespace: "portal-order-dismiss", limit: 8, windowSeconds: 60 });
    if (!limit.allowed) return NextResponse.json({ ok: false, message: "Too many requests. Try again shortly." }, { status: 429 });
    const parsed = await parseJson(request, inputSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const service = createDashboardServiceClient();
    let ctx = await context(service, body);
    const lockKey = ctx.orders[0].order_group_id || body.orderId;
    release = await lockOrderPayment(service, lockKey);
    ctx = await context(service, body);
    if ((ctx.orders[0].order_group_id || body.orderId) !== lockKey) throw new Error("Checkout group changed.");
    const fingerprint = checkoutScopeFingerprint(ctx.orders);
    const { session, intent } = await paymentState(ctx);
    for (const order of ctx.orders) {
      const { data, error } = await service.rpc("stop_abandoned_cart_reminders", {
        p_order_id: order.id, p_recipient_email: body.email.toLowerCase(),
      });
      if (error || data !== true) throw new Error("Checkout reminder eligibility changed.");
    }
    if (ctx.orders.every(order => ["cancelled", "canceled"].includes(order.status || "")) &&
        session?.status !== "open" && (!intent || intent.status === "canceled" || session?.status === "expired")) {
      await updateScope(service, ctx, "cancelled");
      return NextResponse.json({ ok: true, cancelledOrderIds: ctx.orders.map(order => order.id), message: "This checkout was already deleted." });
    }
    // The hold suppresses reminders and prevents checkout retries before the
    // provider call. A failure keeps this hold, preserving a recoverable record.
    await updateScope(service, ctx, "cancel_pending");
    if (session?.status === "open") {
      const expired = await stripeRequest<Session>(`checkout/sessions/${encodeURIComponent(session.id)}/expire`, {
        method: "POST", account: ctx.account!, idempotencyKey: `studio-os-expire-${session.id}`,
      });
      if (expired.status !== "expired" || expired.payment_status !== "unpaid") throw new Error("Checkout expiration was not confirmed.");
    } else if (!session && intent && intent.status !== "canceled") {
      const cancelled = await stripeRequest<Intent>(`payment_intents/${encodeURIComponent(intent.id)}/cancel`, {
        method: "POST", account: ctx.account!, idempotencyKey: `studio-os-cancel-${intent.id}`,
      });
      assertUnpaidStripeCheckout(null, cancelled);
      if (cancelled.status !== "canceled") throw new Error("Payment cancellation was not confirmed.");
    }
    const final = await context(service, body);
    if (final.account !== ctx.account || checkoutScopeFingerprint(final.orders) !== fingerprint) {
      throw new Error("Checkout ownership or payment details changed.");
    }
    await paymentState(final);
    await updateScope(service, final, "cancelled");
    const cancelledOrderIds = final.orders.map(order => order.id);
    await recordAudit({ request, targetPhotographerId: final.grant.photographerId,
      action: "parent.checkout.discard", entityType: "order", entityId: body.orderId, result: "ok",
      before: { status: "payment_pending" }, after: { status: "cancelled" },
      metadata: { orderIds: cancelledOrderIds, orderGroupId: final.orders[0].order_group_id,
        reason: "Parent discarded an unfinished checkout and stopped its reminders." },
    });
    return NextResponse.json({ ok: true, cancelledOrderIds,
      message: "Unfinished checkout deleted from your Orders list. Its reminders have stopped. Completed orders stay available." });
  } catch {
    return NextResponse.json({ ok: false,
      message: "This checkout could not be safely discarded. Refresh its status or contact the studio. Completed orders were not cancelled." }, { status: 409 });
  } finally {
    await release?.();
  }
}

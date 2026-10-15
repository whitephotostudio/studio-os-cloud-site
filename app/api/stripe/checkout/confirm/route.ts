import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import {
  finalizePaidOrderOrGroup,
  retrieveCheckoutSession,
  type StripeCheckoutSession,
} from "@/lib/payments";
import { resolveOrderPaymentAccount } from "@/lib/stripe-connect-history";
import { getParentGalleryRequestScope, runParentGallerySessionRoute } from "@/lib/parent-gallery-session-request";
import { ParentGallerySessionError } from "@/lib/parent-gallery-session";
import { hasMappedParentCheckout, resolveParentCheckoutReturn, ParentCheckoutReturnError,
  parentCheckoutPrivateHeaders } from "@/lib/parent-checkout-return";
import { schoolCheckoutReturnContext } from "@/lib/school-parent-gallery-link";

export const dynamic = "force-dynamic";

type ConfirmBody = {
  sessionId?: string;
  orderId?: string;
  returnId?: string;
};

type OrderRow = {
  id: string;
  photographer_id: string | null;
  status: string | null;
  payment_status: string | null;
  paid_at: string | null;
  stripe_checkout_session_id: string | null;
  order_group_id: string | null;
  school_id: string | null;
  student_id: string | null;
  customer_email: string | null;
  parent_email: string | null;
  total_cents: number | null;
  total_amount: number | null;
  currency: string | null;
};
const ORDER_SELECT = "id,photographer_id,status,payment_status,paid_at,stripe_checkout_session_id,order_group_id,school_id,student_id,customer_email,parent_email,total_cents,total_amount,currency";

function service() {
  return createDashboardServiceClient();
}

async function confirmedGalleryUrl(sb: ReturnType<typeof service>, order: OrderRow, session: StripeCheckoutSession) {
  if (!order.school_id) return undefined;
  // A public orderId alone is not proof of access to gallery credentials.
  // This function is called only after an explicit, stored sessionId was read
  // back from the order's connected Stripe account.
  let orders = [order];
  if (order.order_group_id) {
    const group = await sb.from("orders").select(ORDER_SELECT, { count: "exact" })
      .eq("order_group_id", order.order_group_id);
    if (group.error) throw group.error;
    if (group.count == null || !group.data?.length || group.data.length !== group.count) throw new Error("Incomplete checkout group.");
    orders = group.data as OrderRow[];
  }
  const metadata = session.metadata ?? {};
  const cents = (row: OrderRow) => row.total_cents != null ? Number(row.total_cents)
    : row.total_amount != null && Number.isFinite(Number(row.total_amount)) && Number(row.total_amount) >= 0
      ? Math.round(Number(row.total_amount) * 100) : Number.NaN;
  const total = orders.reduce((sum, row) => sum + cents(row), 0);
  if (!orders.some(row => row.id === order.id) || new Set(orders.map(row => row.id)).size !== orders.length ||
      orders.some(row => row.photographer_id !== order.photographer_id || row.order_group_id !== order.order_group_id ||
        row.stripe_checkout_session_id !== session.id || (row.currency || "cad").toLowerCase() !== session.currency?.toLowerCase() ||
        !Number.isSafeInteger(cents(row)) || cents(row) < 0) ||
      session.mode !== "payment" || session.status !== "complete" ||
      !Number.isSafeInteger(total) || session.amount_total !== total ||
      (session.payment_status === "no_payment_required" && session.amount_total !== 0) ||
      metadata.billing_flow !== "customer_order" || metadata.photographer_id !== order.photographer_id ||
      !orders.some(row => row.id === metadata.order_id) ||
      (session.client_reference_id != null && session.client_reference_id !== metadata.order_id) ||
      (metadata.order_group_id || null) !== order.order_group_id) {
    throw new Error("Checkout session does not match its saved order.");
  }
  const preferredOrderId = metadata.portal_return_order_id || metadata.order_id;
  if (!orders.some(row => row.id === preferredOrderId && row.school_id)) throw new Error("Invalid school return scope.");
  const context = await schoolCheckoutReturnContext(sb, {
    orders, photographerId: order.photographer_id!, preferredOrderId,
    email: metadata.portal_return_email,
  });
  if (context.orderId !== preferredOrderId) throw new Error("The saved return student is no longer in this school.");
  const url = new URL(context.path, "https://www.studiooscloud.com");
  url.searchParams.set("checkout", "success");
  url.searchParams.set("session_id", session.id);
  return `${url.pathname}${url.search}`;
}

export async function POST(req: NextRequest) {
  if (req.headers.get("x-studio-parent-session") === "1" || new URL(req.url).searchParams.has("parentLaneId")) {
    return runParentGallerySessionRoute(req, POST);
  }
  try {
    const body = (await req.json()) as ConfirmBody;
    const sessionId = (body.sessionId ?? "").trim();
    const orderId = (body.orderId ?? "").trim();

    if (!sessionId && !orderId) {
      return NextResponse.json(
        { ok: false, message: "Missing sessionId or orderId." },
        { status: 400 },
      );
    }

    const sb = service();
    let orderQuery = sb
      .from("orders")
      .select(ORDER_SELECT)
      .limit(1);

    if (sessionId) {
      orderQuery = orderQuery.eq("stripe_checkout_session_id", sessionId);
    } else {
      orderQuery = orderQuery.eq("id", orderId);
    }

    const { data: order, error: orderError } = await orderQuery.maybeSingle<OrderRow>();
    if (orderError) throw orderError;
    if (!order) {
      return NextResponse.json({ ok: false, message: "Order not found." }, { status: 404 });
    }

    const mappedReturn = await hasMappedParentCheckout(sb, order.id, order.stripe_checkout_session_id);
    let privateGalleryUrl: string | undefined;
    if (mappedReturn || body.returnId !== undefined) {
      const scope = getParentGalleryRequestScope(req);
      if (!mappedReturn || !scope || !body.returnId || !sessionId) throw new ParentCheckoutReturnError(403);
      const returned = await resolveParentCheckoutReturn(req, body.returnId, scope.laneId);
      if (returned.status !== "success" || returned.sessionId !== sessionId || sessionId !== order.stripe_checkout_session_id) {
        throw new ParentCheckoutReturnError(403);
      }
      privateGalleryUrl = `/parents/view/${returned.laneId}?checkout=success&return=${returned.returnId}`;
    }

    const currentStatus = (order.status ?? "").toLowerCase();
    const currentPaymentStatus = (order.payment_status ?? "").toLowerCase();
    const alreadyPaid = (
      (currentStatus === "paid" || currentStatus === "digital_paid") &&
      (currentPaymentStatus === "paid" || currentPaymentStatus === "succeeded" || currentPaymentStatus === "no_payment_required")
    );
    let session: StripeCheckoutSession | null = null;
    let galleryUrl: string | undefined = privateGalleryUrl;
    if (!alreadyPaid || (sessionId && order.school_id)) {
      const resolvedSessionId = sessionId || order.stripe_checkout_session_id || "";
      const stripeAccountId = await resolveOrderPaymentAccount(sb, {
        photographerId: order.photographer_id!, orderId: order.id,
        orderGroupId: order.order_group_id, checkoutSessionId: resolvedSessionId,
      });
      if (!stripeAccountId) {
        return NextResponse.json({ ok: false, message: "Stripe account not available for this order." }, { status: 400 });
      }
      session = await retrieveCheckoutSession(resolvedSessionId, stripeAccountId);
      if (session.id !== resolvedSessionId || (sessionId && sessionId !== order.stripe_checkout_session_id)) throw new Error("Checkout session mismatch.");
      if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
        return NextResponse.json({ ok: false, message: "Payment is not completed yet." }, { status: 400 });
      }
      if (sessionId && !mappedReturn) galleryUrl = await confirmedGalleryUrl(sb, order, session);
    }

    if (alreadyPaid) {
      await finalizePaidOrderOrGroup(sb, {
        orderId: order.id,
        checkoutSessionId: order.stripe_checkout_session_id,
        paymentStatus: currentPaymentStatus || "paid",
        note: "[Stripe checkout confirm] order was already marked paid",
        paidAt: order.paid_at ?? new Date().toISOString(),
      });
      return NextResponse.json({
        ok: true,
        orderId: order.id,
        paymentStatus: currentPaymentStatus,
        status: currentStatus,
        ...(galleryUrl ? { galleryUrl } : {}),
      }, { headers: parentCheckoutPrivateHeaders });
    }
    if (!session) throw new Error("Checkout session unavailable.");

    await finalizePaidOrderOrGroup(sb, {
      orderId: order.id,
      checkoutSessionId: session.id,
      paymentIntentId: session.payment_intent ?? null,
      paymentStatus: session.payment_status ?? "paid",
      note: `[Stripe checkout ${session.id}] payment confirmed`,
      paidAt: new Date().toISOString(),
    });

    return NextResponse.json({
      ok: true,
      orderId: order.id,
      ...(sessionId && !mappedReturn ? { customerEmail: session.customer_details?.email || null } : {}),
      paymentStatus: session.payment_status,
      status: "paid",
      ...(galleryUrl ? { galleryUrl } : {}),
    }, { headers: parentCheckoutPrivateHeaders });
  } catch (error) {
    if (error instanceof ParentCheckoutReturnError || error instanceof ParentGallerySessionError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: error.status, headers: parentCheckoutPrivateHeaders });
    }
    console.error("[stripe:checkout:confirm]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to confirm Stripe checkout." },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import {
  finalizePaidOrderOrGroup,
  getConnectedAccountId,
  retrieveCheckoutSession,
} from "@/lib/payments";
import {
  assertStripePaymentMatches,
  resolveStoredCheckoutCharge,
  type StoredCheckoutOrder,
} from "@/lib/order-checkout-total";

export const dynamic = "force-dynamic";

type ConfirmBody = {
  sessionId?: string;
  orderId?: string;
};

type OrderRow = StoredCheckoutOrder & {
  paid_at: string | null;
  stripe_checkout_session_id: string | null;
};

type PhotographerRow = {
  id: string;
  stripe_account_id: string | null;
  stripe_connected_account_id: string | null;
};

function service() {
  return createDashboardServiceClient();
}

export async function POST(req: NextRequest) {
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
      .select("id,order_group_id,photographer_id,subtotal_cents,tax_cents,total_cents,total_amount,currency,status,payment_status,paid_at,stripe_checkout_session_id")
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

    let chargeOrders: OrderRow[] = [order];
    if (order.order_group_id) {
      const { data: groupOrders, error: groupError } = await sb
        .from("orders")
        .select("id,order_group_id,photographer_id,subtotal_cents,tax_cents,total_cents,total_amount,currency,status,payment_status,paid_at,stripe_checkout_session_id")
        .eq("order_group_id", order.order_group_id);
      if (groupError) throw groupError;
      chargeOrders = (groupOrders ?? []) as OrderRow[];
    }
    const charge = resolveStoredCheckoutCharge({
      seedOrderId: order.id,
      orders: chargeOrders,
    });

    const { data: photographer, error: photographerError } = await sb
      .from("photographers")
      .select("id,stripe_account_id,stripe_connected_account_id")
      .eq("id", charge.photographerId)
      .maybeSingle<PhotographerRow>();

    if (photographerError) throw photographerError;

    const stripeAccountId = photographer ? getConnectedAccountId(photographer) : null;
    if (!stripeAccountId) {
      return NextResponse.json(
        { ok: false, message: "Stripe account not available for this order." },
        { status: 400 },
      );
    }

    const resolvedSessionId = sessionId || order.stripe_checkout_session_id || "";
    const session = await retrieveCheckoutSession(resolvedSessionId, stripeAccountId);

    if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
      return NextResponse.json(
        { ok: false, message: "Payment is not completed yet." },
        { status: 400 },
      );
    }

    const metadataOrderId = session.metadata?.order_id ?? "";
    const metadataGroupId = session.metadata?.order_group_id ?? null;
    if (
      !charge.orderIds.includes(metadataOrderId) ||
      session.client_reference_id !== metadataOrderId ||
      session.metadata?.photographer_id !== charge.photographerId ||
      metadataGroupId !== charge.orderGroupId
    ) {
      return NextResponse.json(
        { ok: false, message: "Payment details do not match this order." },
        { status: 409 },
      );
    }
    try {
      assertStripePaymentMatches({
        expected: charge,
        amountCents: session.amount_total,
        currency: session.currency,
      });
    } catch (error) {
      console.error("[stripe:checkout:confirm] payment amount mismatch", {
        orderId: order.id,
        orderGroupId: charge.orderGroupId,
        error,
      });
      return NextResponse.json(
        { ok: false, message: "Payment amount does not match this order." },
        { status: 409 },
      );
    }

    await finalizePaidOrderOrGroup(sb, {
      orderId: metadataOrderId,
      checkoutSessionId: session.id,
      paymentIntentId: session.payment_intent ?? null,
      paymentStatus: session.payment_status ?? "paid",
      note: `[Stripe checkout ${session.id}] payment confirmed`,
      paidAt: new Date().toISOString(),
    });

    return NextResponse.json({
      ok: true,
      orderId: order.id,
      customerEmail: session.customer_details?.email || null,
      paymentStatus: session.payment_status,
      status: "paid",
    });
  } catch (error) {
    console.error("[stripe:checkout:confirm]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to confirm Stripe checkout." },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import {
  finalizePaidOrder,
  getConnectedAccountId,
  retrieveCheckoutSession,
} from "@/lib/payments";

export const dynamic = "force-dynamic";

type ConfirmBody = {
  sessionId?: string;
  orderId?: string;
};

type OrderRow = {
  id: string;
  photographer_id: string | null;
  status: string | null;
  payment_status: string | null;
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
      .select("id,photographer_id,status,payment_status,paid_at,stripe_checkout_session_id")
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

    const currentStatus = (order.status ?? "").toLowerCase();
    const currentPaymentStatus = (order.payment_status ?? "").toLowerCase();
    if (
      (currentStatus === "paid" || currentStatus === "digital_paid") &&
      (currentPaymentStatus === "paid" || currentPaymentStatus === "succeeded" || currentPaymentStatus === "no_payment_required")
    ) {
      return NextResponse.json({
        ok: true,
        orderId: order.id,
        paymentStatus: currentPaymentStatus,
        status: currentStatus,
      });
    }

    const { data: photographer, error: photographerError } = await sb
      .from("photographers")
      .select("id,stripe_account_id,stripe_connected_account_id")
      .eq("id", order.photographer_id)
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

    await finalizePaidOrder(sb, {
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

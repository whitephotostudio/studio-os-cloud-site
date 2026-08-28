import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { resolveOrderTotalCents, type OrderItemMoneyLike } from "@/lib/order-display";
import {
  finalizePaidOrderOrGroup,
  getConnectedAccountId,
  retrieveCheckoutSession,
} from "@/lib/payments";

export const dynamic = "force-dynamic";

type OrderItemRow = OrderItemMoneyLike & {
  id?: string | null;
  product_name?: string | null;
};

type OrderRow = {
  id: string;
  parent_name?: string | null;
  parent_email?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  status?: string | null;
  payment_status?: string | null;
  package_name?: string | null;
  paid_at?: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_checkout_session_id?: string | null;
  total_cents?: number | null;
  total_amount?: number | null;
  items?: OrderItemRow[] | null;
};

type PhotographerRow = {
  id: string;
  stripe_account_id: string | null;
  stripe_connected_account_id: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function hasBuyerEmail(order: OrderRow) {
  return !!clean(order.parent_email ?? order.customer_email);
}

function isPaidOrder(order: OrderRow) {
  const paymentStatus = clean(order.payment_status).toLowerCase();
  return (
    paymentStatus === "succeeded" ||
    paymentStatus === "paid" ||
    paymentStatus === "digital_paid" ||
    !!clean(order.paid_at) ||
    !!clean(order.stripe_payment_intent_id)
  );
}

function hasStartedCheckout(order: OrderRow) {
  return !isPaidOrder(order) && !!clean(order.stripe_checkout_session_id);
}

function looksDigital(value: string | null | undefined) {
  const text = clean(value).toLowerCase();
  if (!text || text.includes("retouch")) return false;
  return (
    text.includes("digital") ||
    text.includes("download") ||
    text.includes("file") ||
    text.includes("jpg") ||
    text.includes("jpeg") ||
    text.includes("png") ||
    text.includes("usb")
  );
}

function isDigitalOrder(order: OrderRow) {
  if (looksDigital(order.package_name) || looksDigital(order.status)) return true;
  return (order.items ?? []).some((item) => looksDigital(item.product_name));
}

function isInvalidPlaceholderOrder(order: OrderRow) {
  const totalCents = resolveOrderTotalCents(order, order.items);
  return (
    totalCents <= 0 &&
    !hasBuyerEmail(order) &&
    !clean(order.payment_status) &&
    !clean(order.paid_at) &&
    !clean(order.stripe_payment_intent_id) &&
    !clean(order.stripe_checkout_session_id)
  );
}

function shouldNormalizePaidStatus(order: OrderRow) {
  if (!isPaidOrder(order)) return false;
  const status = clean(order.status).toLowerCase();
  return !["paid", "digital_paid", "reviewed", "sent_to_print", "completed"].includes(status);
}

function shouldNormalizeCheckoutStatus(order: OrderRow) {
  if (!hasStartedCheckout(order)) return false;
  return clean(order.status).toLowerCase() !== "payment_pending";
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const service = createDashboardServiceClient();
    const { data: photographer, error: photographerError } = await service
      .from("photographers")
      .select("id,stripe_account_id,stripe_connected_account_id")
      .eq("user_id", user.id)
      .maybeSingle<PhotographerRow>();

    if (photographerError) throw photographerError;
    if (!photographer?.id) {
      return NextResponse.json(
        { ok: false, message: "Photographer not found." },
        { status: 404 },
      );
    }

    const { data: rows, error: ordersError } = await service
      .from("orders")
      .select(
        `
          id,
          parent_name, parent_email, customer_name, customer_email,
          status, payment_status, package_name, paid_at, stripe_payment_intent_id, stripe_checkout_session_id,
          total_cents, total_amount,
          items:order_items(id, product_name, quantity, price, unit_price_cents, line_total_cents, sku)
        `,
      )
      .eq("photographer_id", photographer.id);

    if (ordersError) throw ordersError;

    const orders = ((rows ?? []) as OrderRow[]);
    const placeholderIds = orders.filter(isInvalidPlaceholderOrder).map((order) => order.id);
    const paidOrders = orders.filter(shouldNormalizePaidStatus);
    const digitalPaidIds = paidOrders.filter(isDigitalOrder).map((order) => order.id);
    const paidIds = paidOrders.filter((order) => !isDigitalOrder(order)).map((order) => order.id);
    const checkoutOrders = orders.filter(shouldNormalizeCheckoutStatus);
    const recoveredStripePaidIds: string[] = [];
    const stripeAccountId = getConnectedAccountId(photographer);

    if (stripeAccountId) {
      for (const order of checkoutOrders) {
        const sessionId = clean(order.stripe_checkout_session_id);
        if (!sessionId) continue;
        try {
          const session = await retrieveCheckoutSession(sessionId, stripeAccountId);
          if (session.payment_status === "paid" || session.payment_status === "no_payment_required") {
            await finalizePaidOrderOrGroup(service, {
              orderId: order.id,
              checkoutSessionId: session.id,
              paymentIntentId: session.payment_intent ?? null,
              paymentStatus: session.payment_status ?? "paid",
              note: `[Order hygiene ${session.id}] recovered completed Stripe checkout`,
              paidAt: new Date().toISOString(),
            });
            recoveredStripePaidIds.push(order.id);
          }
        } catch (error) {
          console.warn("[dashboard:orders:hygiene] Stripe session check skipped", {
            orderId: order.id,
            sessionId,
            error,
          });
        }
      }
    }

    const recoveredStripePaid = new Set(recoveredStripePaidIds);
    const checkoutIds = checkoutOrders
      .filter((order) => !recoveredStripePaid.has(order.id))
      .map((order) => order.id);

    if (placeholderIds.length > 0) {
      const { error: itemDeleteError } = await service
        .from("order_items")
        .delete()
        .in("order_id", placeholderIds);
      if (itemDeleteError) throw itemDeleteError;

      const { error: orderDeleteError } = await service
        .from("orders")
        .delete()
        .eq("photographer_id", photographer.id)
        .in("id", placeholderIds);
      if (orderDeleteError) throw orderDeleteError;
    }

    if (paidIds.length > 0) {
      const { error: paidError } = await service
        .from("orders")
        .update({ status: "paid" })
        .eq("photographer_id", photographer.id)
        .in("id", paidIds);
      if (paidError) throw paidError;
    }

    if (digitalPaidIds.length > 0) {
      const { error: digitalPaidError } = await service
        .from("orders")
        .update({ status: "digital_paid" })
        .eq("photographer_id", photographer.id)
        .in("id", digitalPaidIds);
      if (digitalPaidError) throw digitalPaidError;
    }

    if (checkoutIds.length > 0) {
      const { error: checkoutError } = await service
        .from("orders")
        .update({ status: "payment_pending", payment_status: "pending" })
        .eq("photographer_id", photographer.id)
        .in("id", checkoutIds);
      if (checkoutError) throw checkoutError;
    }

    return NextResponse.json({
      ok: true,
      deletedPlaceholders: placeholderIds.length,
      normalizedPaid: paidIds.length,
      normalizedDigitalPaid: digitalPaidIds.length,
      recoveredStripePaid: recoveredStripePaidIds.length,
      normalizedCheckout: checkoutIds.length,
    });
  } catch (error) {
    console.error("[dashboard:orders:hygiene] failed", error);
    return NextResponse.json(
      { ok: false, message: "Failed to clean dashboard orders." },
      { status: 500 },
    );
  }
}

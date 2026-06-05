import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";
import {
  extractOrderPhotoUrls,
  resolveOrderItemDisplayCents,
  resolveOrderTotalCents,
  type OrderItemMoneyLike,
} from "@/lib/order-display";

export const dynamic = "force-dynamic";

const DeleteOrdersSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(100),
});

type OrderItemRow = OrderItemMoneyLike & {
  id?: string | null;
};

type OrderRow = {
  id: string;
  order_group_id?: string | null;
  school_id?: string | null;
  project_id?: string | null;
  class_id?: string | null;
  student_id?: string | null;
  parent_name?: string | null;
  parent_email?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  status?: string | null;
  payment_status?: string | null;
  paid_at?: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_checkout_session_id?: string | null;
  package_name?: string | null;
  package_price?: number | null;
  total_cents?: number | null;
  total_amount?: number | null;
  subtotal_cents?: number | null;
  special_notes?: string | null;
  notes?: string | null;
  items?: OrderItemRow[] | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function noteTextForOrder(order: OrderRow) {
  return [order.special_notes, order.notes].map(clean).filter(Boolean).join("\n");
}

function orderPhotoKey(order: OrderRow) {
  const noteUrls = extractOrderPhotoUrls(noteTextForOrder(order));
  const itemUrls = (order.items ?? [])
    .map((item) => clean(item.sku))
    .filter(Boolean);
  const urls = noteUrls.length > 0 ? noteUrls : itemUrls;
  return urls
    .map((url) => url.toLowerCase())
    .sort()
    .join("|");
}

function orderItemKey(order: OrderRow) {
  const orderTotalCents = resolveOrderTotalCents(order, order.items);
  return (order.items ?? [])
    .map((item, index) =>
      [
        clean(item.product_name).toLowerCase(),
        Number(item.quantity ?? 1),
        resolveOrderItemDisplayCents(item, order.items, orderTotalCents, index),
      ].join(":"),
    )
    .sort()
    .join("|");
}

function orderDuplicateFingerprint(order: OrderRow) {
  return [
    clean(order.school_id) || clean(order.project_id) || "gallery",
    clean(order.class_id) || "class",
    clean(order.student_id) || "student",
    clean(order.parent_email ?? order.customer_email ?? order.parent_name ?? order.customer_name).toLowerCase(),
    clean(order.package_name).toLowerCase(),
    resolveOrderTotalCents(order, order.items),
    orderPhotoKey(order) || orderItemKey(order),
  ].join("__");
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

function isUnpaidCheckoutShadow(order: OrderRow) {
  const paymentStatus = clean(order.payment_status).toLowerCase();
  const orderStatus = clean(order.status).toLowerCase();
  return (
    !isPaidOrder(order) &&
    (paymentStatus === "pending" ||
      orderStatus === "pending" ||
      (!!clean(order.stripe_checkout_session_id) &&
        !clean(order.stripe_payment_intent_id)))
  );
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

    const parsed = await parseJson(request, DeleteOrdersSchema);
    if (!parsed.ok) return parsed.response;

    const service = createDashboardServiceClient();
    const { data: photographer, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (photographerError) throw photographerError;
    if (!photographer?.id) {
      return NextResponse.json(
        { ok: false, message: "Photographer not found." },
        { status: 404 },
      );
    }

    const selectFields = `
      id, order_group_id, school_id, project_id, class_id, student_id,
      parent_name, parent_email, customer_name, customer_email,
      status, payment_status, paid_at, stripe_payment_intent_id, stripe_checkout_session_id,
      package_name, package_price, subtotal_cents, total_cents, total_amount,
      special_notes, notes,
      items:order_items(id, product_name, quantity, price, unit_price_cents, line_total_cents, sku)
    `;

    const requestedIds = Array.from(new Set(parsed.data.orderIds));
    const { data: seedRows, error: seedError } = await service
      .from("orders")
      .select(selectFields)
      .eq("photographer_id", photographer.id)
      .in("id", requestedIds);

    if (seedError) throw seedError;
    const seeds = (seedRows ?? []) as OrderRow[];
    if (seeds.length === 0) {
      return NextResponse.json(
        { ok: false, message: "No matching orders were found." },
        { status: 404 },
      );
    }

    const idsToDelete = new Set(seeds.map((order) => order.id));
    const groupIds = Array.from(
      new Set(seeds.map((order) => clean(order.order_group_id)).filter(Boolean)),
    );

    if (groupIds.length > 0) {
      const { data: groupRows, error: groupError } = await service
        .from("orders")
        .select("id")
        .eq("photographer_id", photographer.id)
        .in("order_group_id", groupIds);

      if (groupError) throw groupError;
      for (const row of groupRows ?? []) {
        idsToDelete.add((row as { id: string }).id);
      }
    }

    const seedFingerprints = new Set(seeds.map(orderDuplicateFingerprint));
    if (seedFingerprints.size > 0) {
      const { data: allRows, error: allError } = await service
        .from("orders")
        .select(selectFields)
        .eq("photographer_id", photographer.id);

      if (allError) throw allError;
      for (const order of ((allRows ?? []) as OrderRow[])) {
        if (
          seedFingerprints.has(orderDuplicateFingerprint(order)) &&
          (idsToDelete.has(order.id) || isUnpaidCheckoutShadow(order))
        ) {
          idsToDelete.add(order.id);
        }
      }
    }

    const finalIds = Array.from(idsToDelete);
    if (finalIds.length === 0) {
      return NextResponse.json({ ok: true, deletedOrderIds: [] });
    }

    const { error: itemsError } = await service
      .from("order_items")
      .delete()
      .in("order_id", finalIds);
    if (itemsError) throw itemsError;

    const { error: ordersError } = await service
      .from("orders")
      .delete()
      .eq("photographer_id", photographer.id)
      .in("id", finalIds);
    if (ordersError) throw ordersError;

    return NextResponse.json({
      ok: true,
      deletedOrderIds: finalIds,
      requestedOrderIds: requestedIds,
    });
  } catch (error) {
    console.error("[dashboard:orders:delete] failed", error);
    return NextResponse.json(
      { ok: false, message: "Failed to delete orders." },
      { status: 500 },
    );
  }
}

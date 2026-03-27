import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type StripeCheckoutSession = {
  id: string;
  payment_status?: string;
  client_reference_id?: string | null;
  customer_details?: { email?: string | null } | null;
  amount_total?: number | null;
  metadata?: Record<string, string> | null;
};

type OrderRow = {
  id: string;
  package_name: string | null;
  status: string | null;
  notes: string | null;
};

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function supabaseAdmin() {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
}

async function stripeGet<T>(path: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${env("STRIPE_SECRET_KEY")}` },
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `Stripe error calling ${path}`);
  return json as T;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { sessionId?: string };
    if (!body.sessionId) {
      return NextResponse.json({ ok: false, message: "Missing sessionId." }, { status: 400 });
    }

    const session = await stripeGet<StripeCheckoutSession>(`checkout/sessions/${body.sessionId}`);
    if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
      return NextResponse.json({ ok: false, message: "Payment is not completed yet." }, { status: 400 });
    }

    const orderId = session.client_reference_id || session.metadata?.order_id || "";
    if (!orderId) {
      return NextResponse.json({ ok: false, message: "No order was linked to this checkout." }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const { data: order, error: orderError } = await sb
      .from("orders")
      .select("id,package_name,status,notes")
      .eq("id", orderId)
      .maybeSingle<OrderRow>();

    if (orderError) throw orderError;
    if (!order) {
      return NextResponse.json({ ok: false, message: "Order not found." }, { status: 404 });
    }

    // ✅ FIX: Idempotency guard — if the order is already marked paid (e.g.
    // the user refreshed the success page), return success immediately without
    // re-writing the record or duplicating any downstream logic.
    if (order.status === "paid" || order.status === "digital_paid") {
      return NextResponse.json({
        ok: true,
        orderId,
        customerEmail: session.customer_details?.email || null,
        paymentStatus: session.payment_status,
        amountTotal: session.amount_total ?? null,
        status: order.status,
      });
    }

    const isDigital = (order.package_name || "").toLowerCase().includes("digital");
    const nextStatus = isDigital ? "digital_paid" : "paid";
    const paymentNote = `[Stripe checkout ${session.id}] payment confirmed`;
    const mergedNotes = order.notes?.includes(paymentNote)
      ? order.notes
      : [order.notes || "", paymentNote].filter(Boolean).join("\n\n");

    const { error: updateError } = await sb
      .from("orders")
      .update({
        status: nextStatus,
        notes: mergedNotes,
        seen_by_photographer: false,
      })
      .eq("id", orderId);

    if (updateError) throw updateError;

    return NextResponse.json({
      ok: true,
      orderId,
      customerEmail: session.customer_details?.email || null,
      paymentStatus: session.payment_status,
      amountTotal: session.amount_total ?? null,
      status: nextStatus,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Failed to confirm Stripe checkout." },
      { status: 500 },
    );
  }
}

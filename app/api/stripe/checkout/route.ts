import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type OrderRow = {
  id: string;
  school_id: string | null;
  student_id: string | null;
  photographer_id: string | null;
  parent_email: string | null;
  customer_email: string | null;
  package_name: string | null;
  total_cents: number | null;
  total_amount: number | null;
  currency: string | null;
  status: string | null;
};

type SchoolRow = {
  id: string;
  photographer_id: string | null;
  school_name: string | null;
};

type PhotographerRow = {
  id: string;
  business_name: string | null;
  stripe_account_id: string | null;
};

function env(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function supabaseAdmin() {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
}

function baseUrl(req: NextRequest) {
  const origin = new URL(req.url).origin;
  return origin.replace(/\/$/, "");
}

function platformFeePercent() {
  const raw = Number(process.env.STRIPE_PLATFORM_FEE_PERCENT ?? "10");
  if (!Number.isFinite(raw) || raw < 0) return 10;
  return raw;
}

function computeApplicationFee(totalCents: number) {
  const pct = platformFeePercent() / 100;
  const fee = Math.round(totalCents * pct);
  return Math.max(fee, 0);
}

async function stripePost<T>(path: string, body: URLSearchParams) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("STRIPE_SECRET_KEY")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message || `Stripe error calling ${path}`);
  }
  return json as T;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      orderId?: string;
      pin?: string;
      schoolId?: string;
      customerEmail?: string;
    };

    if (!body.orderId) {
      return NextResponse.json({ ok: false, message: "Missing orderId." }, { status: 400 });
    }

    const sb = supabaseAdmin();

    const { data: order, error: orderError } = await sb
      .from("orders")
      .select("id,school_id,student_id,photographer_id,parent_email,customer_email,package_name,total_cents,total_amount,currency,status")
      .eq("id", body.orderId)
      .maybeSingle<OrderRow>();

    if (orderError) throw orderError;
    if (!order) {
      return NextResponse.json({ ok: false, message: "Order draft not found." }, { status: 404 });
    }

    const effectiveSchoolId = order.school_id || body.schoolId || null;
    if (!effectiveSchoolId) {
      return NextResponse.json({ ok: false, message: "This order is missing a school link." }, { status: 400 });
    }

    const { data: school, error: schoolError } = await sb
      .from("schools")
      .select("id,photographer_id,school_name")
      .eq("id", effectiveSchoolId)
      .maybeSingle<SchoolRow>();

    if (schoolError) throw schoolError;
    if (!school?.photographer_id) {
      return NextResponse.json({ ok: false, message: "Photographer record not found for this school." }, { status: 404 });
    }

    const { data: photographer, error: photographerError } = await sb
      .from("photographers")
      .select("id,business_name,stripe_account_id")
      .eq("id", school.photographer_id)
      .maybeSingle<PhotographerRow>();

    if (photographerError) throw photographerError;
    if (!photographer?.stripe_account_id) {
      return NextResponse.json(
        { ok: false, message: "This photographer has not connected Stripe payouts yet." },
        { status: 400 },
      );
    }

    const totalCents = Number(order.total_cents ?? Math.round(Number(order.total_amount ?? 0) * 100));
    if (!Number.isFinite(totalCents) || totalCents <= 0) {
      return NextResponse.json({ ok: false, message: "This order total is invalid." }, { status: 400 });
    }

    const currency = (order.currency || "cad").toLowerCase();
    const appFee = computeApplicationFee(totalCents);
    const origin = baseUrl(req);
    const successUrl = `${origin}/parents/${encodeURIComponent(body.pin || "")}?school=${encodeURIComponent(
      effectiveSchoolId,
    )}&checkout=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}/parents/${encodeURIComponent(body.pin || "")}?school=${encodeURIComponent(
      effectiveSchoolId,
    )}&checkout=cancel`;

    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("success_url", successUrl);
    params.set("cancel_url", cancelUrl);
    params.set("client_reference_id", order.id);
    params.set("submit_type", "pay");
    params.set("payment_method_types[0]", "card");
    params.set("line_items[0][quantity]", "1");
    params.set("line_items[0][price_data][currency]", currency);
    params.set("line_items[0][price_data][unit_amount]", String(totalCents));
    params.set("line_items[0][price_data][product_data][name]", order.package_name || "Photo order");
    params.set(
      "line_items[0][price_data][product_data][description]",
      school.school_name ? `${school.school_name} gallery order` : "Studio OS photo order",
    );
    params.set("customer_email", order.customer_email || order.parent_email || body.customerEmail || "");
    params.set("payment_intent_data[application_fee_amount]", String(appFee));
    params.set("payment_intent_data[transfer_data][destination]", photographer.stripe_account_id);
    params.set("metadata[order_id]", order.id);
    params.set("metadata[school_id]", effectiveSchoolId);
    params.set("metadata[photographer_id]", photographer.id);
    if (order.student_id) params.set("metadata[student_id]", order.student_id);
    params.set("payment_intent_data[metadata][order_id]", order.id);
    params.set("payment_intent_data[metadata][photographer_id]", photographer.id);

    const session = await stripePost<{ id: string; url: string }>("checkout/sessions", params);

    return NextResponse.json({
      ok: true,
      url: session.url,
      sessionId: session.id,
      orderId: order.id,
      stripeAccountId: photographer.stripe_account_id,
      applicationFeeAmount: appFee,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Failed to create Stripe checkout." },
      { status: 500 },
    );
  }
}

// app/api/stripe/webhook/route.ts
//
// Stripe webhook handler — receives payment events directly from Stripe.
//
// This is the reliable fallback for payment confirmation. The client-side
// /confirm endpoint requires the browser to make a follow-up call after
// redirect, which can silently fail if the user closes the tab or loses
// connectivity. This webhook fires server-to-server and cannot be missed.
//
// Required env var: STRIPE_WEBHOOK_SECRET
// Set it in Vercel → Project Settings → Environment Variables.
// Get the value from: Stripe Dashboard → Webhooks → your endpoint → Signing secret
//
// Register this endpoint in Stripe Dashboard:
//   URL: https://your-domain.com/api/stripe/webhook
//   Events to listen for: checkout.session.completed

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function supabaseAdmin() {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
}

type StripeEvent = {
  type: string;
  data: {
    object: {
      id: string;
      payment_status?: string;
      client_reference_id?: string | null;
      customer_details?: { email?: string | null } | null;
      metadata?: Record<string, string> | null;
      amount_total?: number | null;
    };
  };
};

export async function POST(req: NextRequest) {
  // Verify the webhook came from Stripe using the signature header
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ ok: false, message: "Missing stripe-signature header." }, { status: 400 });
  }

  let webhookSecret: string;
  try {
    webhookSecret = env("STRIPE_WEBHOOK_SECRET");
  } catch {
    console.error("[Webhook] STRIPE_WEBHOOK_SECRET not set — cannot verify events");
    return NextResponse.json({ ok: false, message: "Webhook secret not configured." }, { status: 500 });
  }

  // Read raw body for signature verification
  const rawBody = await req.text();

  // Verify signature manually (avoids importing the full Stripe SDK)
  const isValid = await verifyStripeSignature(rawBody, signature, webhookSecret);
  if (!isValid) {
    console.error("[Webhook] Invalid Stripe signature — request rejected");
    return NextResponse.json({ ok: false, message: "Invalid signature." }, { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON body." }, { status: 400 });
  }

  // Only handle completed checkout sessions
  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ ok: true, message: `Ignored event type: ${event.type}` });
  }

  const session = event.data.object;

  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    return NextResponse.json({ ok: true, message: "Payment not complete — skipped." });
  }

  const orderId = session.client_reference_id || session.metadata?.order_id || "";
  if (!orderId) {
    console.error("[Webhook] checkout.session.completed received with no order_id");
    return NextResponse.json({ ok: false, message: "No order linked to session." }, { status: 400 });
  }

  try {
    const sb = supabaseAdmin();

    // Fetch order to check current status
    const { data: order, error: fetchError } = await sb
      .from("orders")
      .select("id, package_name, status, notes")
      .eq("id", orderId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!order) {
      console.error(`[Webhook] Order ${orderId} not found`);
      return NextResponse.json({ ok: false, message: "Order not found." }, { status: 404 });
    }

    // Idempotency: skip if already marked paid
    if (order.status === "paid" || order.status === "digital_paid") {
      return NextResponse.json({ ok: true, message: "Order already paid — no action needed." });
    }

    const isDigital = (order.package_name || "").toLowerCase().includes("digital");
    const nextStatus = isDigital ? "digital_paid" : "paid";
    const paymentNote = `[Stripe webhook ${session.id}] payment confirmed`;
    const mergedNotes = (order.notes || "").includes(paymentNote)
      ? order.notes
      : [(order.notes || ""), paymentNote].filter(Boolean).join("\n\n");

    const { error: updateError } = await sb
      .from("orders")
      .update({
        status: nextStatus,
        notes: mergedNotes,
        seen_by_photographer: false,
      })
      .eq("id", orderId);

    if (updateError) throw updateError;

    console.log(`[Webhook] Order ${orderId} marked ${nextStatus} via Stripe webhook`);
    return NextResponse.json({ ok: true, orderId, status: nextStatus });
  } catch (error) {
    console.error("[Webhook] Error processing event:", error);
    // Return 500 so Stripe retries the webhook
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Internal error" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Stripe signature verification (HMAC-SHA256, no SDK required)
// ---------------------------------------------------------------------------
async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string,
): Promise<boolean> {
  try {
    // sigHeader format: "t=timestamp,v1=sig1,v1=sig2,..."
    const parts = sigHeader.split(",");
    const tPart = parts.find((p) => p.startsWith("t="));
    const v1Parts = parts.filter((p) => p.startsWith("v1="));
    if (!tPart || v1Parts.length === 0) return false;

    const timestamp = tPart.slice(2);
    const signedPayload = `${timestamp}.${payload}`;

    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const msgData = encoder.encode(signedPayload);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const sig = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
    const computed = Buffer.from(sig).toString("hex");

    // Compare against all v1 signatures (Stripe may send multiple)
    return v1Parts.some((p) => p.slice(3) === computed);
  } catch {
    return false;
  }
}

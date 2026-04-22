import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { syncPhotographyKeysByPhotographerId } from "@/lib/studio-os-app";
import { resendConfigured, sendResendEmail } from "@/lib/resend";
import { r2DeletePrefix } from "@/lib/r2";
import { recordAudit } from "@/lib/audit";
import {
  asIsoTimestamp,
  finalizePaidOrder,
  getConnectedAccountId,
  handleCreditChargeRefunded,
  handleCreditPackCheckoutCompleted,
  markOrderPaymentFailure,
  markOrderRefunded,
  normalizeBillingInterval,
  normalizePlanCode,
  type PhotographerBillingRow,
  recordStripeEvent,
  retrieveStripeSubscription,
  syncConnectState,
  syncSubscriptionStateFromStripe,
  verifyStripeSignature,
} from "@/lib/payments";

export const dynamic = "force-dynamic";

type StripeEventEnvelope = {
  id: string;
  type: string;
  account?: string;
  livemode?: boolean;
  data: {
    object: Record<string, unknown>;
  };
};

type StripeCheckoutSession = {
  id: string;
  payment_status?: string | null;
  metadata?: Record<string, string> | null;
  customer?: string | null;
  subscription?: string | null;
  payment_intent?: string | null;
};

type StripePaymentIntent = {
  id: string;
  status?: string | null;
  metadata?: Record<string, string> | null;
};

type StripeCharge = {
  id: string;
  amount: number;
  amount_refunded: number;
  payment_intent?: string | null;
  metadata?: Record<string, string> | null;
};

type StripeAccount = {
  id: string;
  object: "account";
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  default_currency?: string | null;
  requirements?: {
    disabled_reason?: string | null;
  } | null;
};

type StripeSubscriptionObject = {
  id: string;
  customer?: string | null;
  status?: string | null;
  current_period_start?: number | null;
  current_period_end?: number | null;
  metadata?: Record<string, string> | null;
};

type StripeInvoiceLine = {
  description?: string | null;
  amount?: number | null;
  quantity?: number | null;
  period?: { start?: number | null; end?: number | null } | null;
  price?: { recurring?: { interval?: string | null } | null } | null;
};

type StripeInvoice = {
  id: string;
  number?: string | null;
  customer?: string | null;
  customer_email?: string | null;
  customer_name?: string | null;
  subscription?: string | null;
  status?: string | null;
  amount_paid?: number | null;
  amount_due?: number | null;
  total?: number | null;
  subtotal?: number | null;
  tax?: number | null;
  currency?: string | null;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  period_start?: number | null;
  period_end?: number | null;
  created?: number | null;
  billing_reason?: string | null;
  lines?: { data?: StripeInvoiceLine[] } | null;
};

type PhotographerRow = PhotographerBillingRow;

const PHOTOGRAPHER_SELECT =
  "id,user_id,business_name,brand_color,watermark_enabled,watermark_logo_url,studio_address,studio_phone,stripe_account_id,stripe_connected_account_id,stripe_connect_onboarding_complete,stripe_connect_charges_enabled,stripe_connect_payouts_enabled,stripe_platform_customer_id,stripe_subscription_id,stripe_subscription_item_base_id,stripe_subscription_item_extra_keys_id,stripe_subscription_item_usage_id,subscription_plan_code,subscription_billing_interval,subscription_status,subscription_current_period_start,subscription_current_period_end,billing_email,billing_currency,order_usage_rate_cents,extra_desktop_keys,studio_id,studio_email,logo_url,is_platform_admin,trial_starts_at,trial_ends_at";

function webhookSecrets() {
  return [
    process.env.STRIPE_WEBHOOK_SECRET,
    process.env.STRIPE_PLATFORM_WEBHOOK_SECRET,
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
  ].filter((value): value is string => Boolean(value && value.trim()));
}

async function findPhotographer(
  service: ReturnType<typeof createDashboardServiceClient>,
  column: "id" | "stripe_subscription_id" | "stripe_platform_customer_id" | "stripe_connected_account_id" | "stripe_account_id",
  value: string | null | undefined,
) {
  if (!value) return null;
  const { data, error } = await service
    .from("photographers")
    .select(PHOTOGRAPHER_SELECT)
    .eq(column, value)
    .maybeSingle();

  if (error) throw error;
  return (data as PhotographerRow | null) ?? null;
}

async function findPhotographerForSubscription(
  service: ReturnType<typeof createDashboardServiceClient>,
  subscription: StripeSubscriptionObject,
) {
  const fromSubscriptionId = await findPhotographer(service, "stripe_subscription_id", subscription.id);
  if (fromSubscriptionId) return fromSubscriptionId;

  const fromCustomerId = await findPhotographer(
    service,
    "stripe_platform_customer_id",
    subscription.customer ?? null,
  );
  if (fromCustomerId) return fromCustomerId;

  return findPhotographer(service, "id", subscription.metadata?.photographer_id ?? null);
}

/* ---------- Auto-invoice email on payment ---------- */

function formatInvoiceCurrency(amountCents: number, currency: string | null | undefined) {
  const code = (currency ?? "usd").toUpperCase();
  const dollars = (amountCents / 100).toFixed(2);
  if (code === "USD") return `$${dollars}`;
  return `${dollars} ${code}`;
}

function formatInvoiceDate(unix: number | null | undefined) {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

async function sendInvoicePaidEmail(
  invoice: StripeInvoice,
  photographer: PhotographerRow,
) {
  if (!resendConfigured()) return;

  const recipientEmail =
    (photographer.billing_email ?? "").trim() ||
    (photographer.studio_email ?? "").trim() ||
    (invoice.customer_email ?? "").trim();

  if (!recipientEmail) return;

  const invoiceNumber = invoice.number ?? invoice.id;
  const amountPaid = formatInvoiceCurrency(
    invoice.amount_paid ?? invoice.total ?? 0,
    invoice.currency,
  );
  const businessName = (photographer.business_name ?? "").trim() || "there";

  const lines = (invoice.lines?.data ?? []).map((line) => {
    const desc = (line.description ?? "Subscription").trim();
    const lineAmount = formatInvoiceCurrency(line.amount ?? 0, invoice.currency);
    return { description: desc, amount: lineAmount };
  });

  const linesHtml = lines.length > 0
    ? lines
        .map(
          (l) =>
            `<tr>
              <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#374151;">${l.description}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#111827;text-align:right;font-weight:600;">${l.amount}</td>
            </tr>`,
        )
        .join("")
    : `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#374151;">Subscription payment</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#111827;text-align:right;font-weight:600;">${amountPaid}</td>
      </tr>`;

  const viewInvoiceLink = invoice.hosted_invoice_url
    ? `<a href="${invoice.hosted_invoice_url}" style="display:inline-block;margin-top:12px;padding:10px 24px;background:#2563eb;color:#fff;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">View Invoice</a>`
    : "";

  const downloadPdfLink = invoice.invoice_pdf
    ? `<a href="${invoice.invoice_pdf}" style="display:inline-block;margin-top:8px;padding:8px 20px;background:#f3f4f6;color:#374151;border-radius:8px;font-size:13px;font-weight:500;text-decoration:none;border:1px solid #e5e7eb;">Download PDF</a>`
    : "";

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <!-- Header -->
      <div style="background:#0f172a;padding:28px 24px;text-align:center;">
        <h1 style="margin:0;font-size:20px;font-weight:700;color:#fff;">Studio OS Cloud</h1>
      </div>

      <!-- Body -->
      <div style="padding:28px 24px;">
        <p style="margin:0 0 4px;font-size:15px;color:#374151;">Hi ${businessName},</p>
        <p style="margin:0 0 20px;font-size:15px;color:#374151;">Your payment has been received. Here's your invoice summary.</p>

        <div style="background:#f9fafb;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="background:#f3f4f6;">
                <th style="padding:10px 12px;text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Description</th>
                <th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${linesHtml}
              <tr>
                <td style="padding:12px;font-size:14px;font-weight:700;color:#111827;">Total Paid</td>
                <td style="padding:12px;font-size:16px;font-weight:700;color:#059669;text-align:right;">${amountPaid}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <table style="margin-top:20px;font-size:13px;color:#6b7280;width:100%;">
          <tr><td style="padding:3px 0;">Invoice #</td><td style="text-align:right;font-weight:500;color:#374151;">${invoiceNumber}</td></tr>
          <tr><td style="padding:3px 0;">Date</td><td style="text-align:right;font-weight:500;color:#374151;">${formatInvoiceDate(invoice.created ?? invoice.period_start)}</td></tr>
          <tr><td style="padding:3px 0;">Period</td><td style="text-align:right;font-weight:500;color:#374151;">${formatInvoiceDate(invoice.period_start)} — ${formatInvoiceDate(invoice.period_end)}</td></tr>
        </table>

        <div style="text-align:center;margin-top:24px;">
          ${viewInvoiceLink}
          ${downloadPdfLink ? `<br/>${downloadPdfLink}` : ""}
        </div>
      </div>

      <!-- Footer -->
      <div style="padding:20px 24px;border-top:1px solid #f0f0f0;text-align:center;">
        <p style="margin:0;font-size:12px;color:#9ca3af;">This is an automated payment receipt from Studio OS Cloud.</p>
        <p style="margin:4px 0 0;font-size:12px;color:#9ca3af;">If you have questions, reply to this email or visit <a href="https://studiooscloud.com" style="color:#2563eb;text-decoration:none;">studiooscloud.com</a></p>
      </div>
    </div>
  </div>
</body>
</html>`.trim();

  const text = [
    `Hi ${businessName},`,
    "",
    "Your payment has been received.",
    "",
    ...lines.map((l) => `${l.description}: ${l.amount}`),
    `Total paid: ${amountPaid}`,
    "",
    `Invoice #: ${invoiceNumber}`,
    `Date: ${formatInvoiceDate(invoice.created ?? invoice.period_start)}`,
    `Period: ${formatInvoiceDate(invoice.period_start)} — ${formatInvoiceDate(invoice.period_end)}`,
    "",
    invoice.hosted_invoice_url ? `View invoice: ${invoice.hosted_invoice_url}` : "",
    invoice.invoice_pdf ? `Download PDF: ${invoice.invoice_pdf}` : "",
    "",
    "— Studio OS Cloud",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    await sendResendEmail({
      to: recipientEmail,
      subject: `Invoice ${invoiceNumber} — ${amountPaid} payment received`,
      html,
      text,
      fromName: "Studio OS Cloud Billing",
      tags: [
        { name: "category", value: "invoice" },
        { name: "invoice_id", value: invoice.id },
      ],
      idempotencyKey: `invoice-email-${invoice.id}`,
    });
  } catch (err) {
    console.error("[webhook] Failed to send invoice email:", err);
  }
}

async function syncDeletedSubscriptionState(
  service: ReturnType<typeof createDashboardServiceClient>,
  photographer: PhotographerRow,
  subscription: StripeSubscriptionObject,
) {
  const planCode =
    normalizePlanCode(subscription.metadata?.plan_code ?? null) ||
    normalizePlanCode(photographer.subscription_plan_code);
  const billingInterval =
    normalizeBillingInterval(subscription.metadata?.billing_interval ?? null) ||
    normalizeBillingInterval(photographer.subscription_billing_interval ?? null) ||
    "month";
  const currentPeriodStart = asIsoTimestamp(subscription.current_period_start);
  const currentPeriodEnd = asIsoTimestamp(subscription.current_period_end);

  const { error: photographerError } = await service
    .from("photographers")
    .update({
      stripe_subscription_id: subscription.id,
      stripe_subscription_item_base_id: null,
      stripe_subscription_item_extra_keys_id: null,
      stripe_subscription_item_usage_id: null,
      subscription_plan_code: planCode,
      subscription_billing_interval: billingInterval,
      subscription_status: subscription.status || "canceled",
      subscription_current_period_start: currentPeriodStart,
      subscription_current_period_end: currentPeriodEnd,
      extra_desktop_keys: 0,
    })
    .eq("id", photographer.id);

  if (photographerError) throw photographerError;

  const { error: subscriptionError } = await service.from("subscriptions").upsert(
    {
      user_id: photographer.user_id,
      photographer_id: photographer.id,
      status: "cancelled",
      plan: planCode,
      billing_interval: billingInterval,
      stripe_customer_id: subscription.customer ?? photographer.stripe_platform_customer_id,
      stripe_subscription_id: subscription.id,
      stripe_connected_account_id: getConnectedAccountId(photographer),
      current_period_start: currentPeriodStart,
      current_period_end: currentPeriodEnd,
      billing_email: photographer.billing_email,
      billing_currency: photographer.billing_currency,
      extra_desktop_keys: 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (subscriptionError) throw subscriptionError;

  await syncPhotographyKeysByPhotographerId(service, photographer.id);

  // ── Delete ALL photos from R2 when subscription is cancelled ──
  // Fetch all media storage paths belonging to this photographer's projects
  const { data: mediaRows } = await service
    .from("media")
    .select("storage_path, project_id")
    .in(
      "project_id",
      (
        await service
          .from("projects")
          .select("id")
          .eq("photographer_id", photographer.id)
      ).data?.map((p: { id: string }) => p.id) ?? [],
    );

  if (mediaRows && mediaRows.length > 0) {
    // Collect unique folder prefixes to delete from R2
    const prefixes = new Set<string>();
    for (const row of mediaRows) {
      if (row.storage_path) {
        const folder = row.storage_path.substring(0, row.storage_path.lastIndexOf("/") + 1);
        if (folder) prefixes.add(folder);
      }
    }
    // Fire-and-forget: delete all photo folders from R2
    Promise.allSettled(
      Array.from(prefixes).map((prefix) => r2DeletePrefix(prefix)),
    ).catch((err) => console.error("R2 cancellation cleanup error:", err));

    // Also delete media rows from database
    const projectIds = [...new Set(mediaRows.map((r) => r.project_id))].filter(Boolean);
    if (projectIds.length > 0) {
      await service.from("media").delete().in("project_id", projectIds);
      await service.from("collections").delete().in("project_id", projectIds);
      await service.from("projects").delete().eq("photographer_id", photographer.id);
    }
  }

  console.log(`[webhook] Subscription cancelled for photographer ${photographer.id} — all photos queued for R2 deletion.`);
}

async function markSubscriptionPaymentFailure(
  service: ReturnType<typeof createDashboardServiceClient>,
  photographer: PhotographerRow,
) {
  const { error: photographerError } = await service
    .from("photographers")
    .update({ subscription_status: "past_due" })
    .eq("id", photographer.id);

  if (photographerError) throw photographerError;

  const { error: subscriptionError } = await service
    .from("subscriptions")
    .update({ status: "inactive", updated_at: new Date().toISOString() })
    .eq("user_id", photographer.user_id);

  if (subscriptionError) throw subscriptionError;

  await syncPhotographyKeysByPhotographerId(service, photographer.id);
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ ok: false, message: "Missing stripe-signature header." }, { status: 400 });
  }

  const secrets = webhookSecrets();
  if (!secrets.length) {
    return NextResponse.json(
      { ok: false, message: "Stripe webhook secret is not configured." },
      { status: 500 },
    );
  }

  const rawBody = await req.text();
  const valid = await verifyStripeSignature(rawBody, signature, secrets);
  if (!valid) {
    return NextResponse.json({ ok: false, message: "Invalid Stripe signature." }, { status: 400 });
  }

  let event: StripeEventEnvelope;
  try {
    event = JSON.parse(rawBody) as StripeEventEnvelope;
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const service = createDashboardServiceClient();

  // Insert-first dedup: atomically claim this event.id before doing any work.
  // If another concurrent delivery already inserted it, recordStripeEvent
  // returns { inserted: false } (via unique-violation 23505) and we short-
  // circuit. This closes the race window in the previous "select then insert"
  // pattern where two parallel deliveries could both pass the existence check
  // and both run the handler.
  let dedupResult: { inserted: boolean };
  try {
    dedupResult = await recordStripeEvent(
      service,
      event,
      JSON.parse(rawBody) as Record<string, unknown>,
    );
  } catch (error) {
    console.error("[stripe:webhook:recordStripeEvent]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to record Stripe event." },
      { status: 500 },
    );
  }

  if (!dedupResult.inserted) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const object = event.data.object;

  try {
    switch (event.type) {
      case "account.updated": {
        const account = object as unknown as StripeAccount;
        const photographer =
          (await findPhotographer(service, "stripe_connected_account_id", account.id)) ||
          (await findPhotographer(service, "stripe_account_id", account.id)) ||
          (await findPhotographer(service, "stripe_connected_account_id", event.account ?? null));

        if (photographer) {
          await syncConnectState(service, photographer.id, account);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = object as unknown as StripeSubscriptionObject;
        const photographer = await findPhotographerForSubscription(service, subscription);
        if (photographer) {
          const liveSubscription = await retrieveStripeSubscription(subscription.id);
          await syncSubscriptionStateFromStripe(service, photographer, liveSubscription);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = object as unknown as StripeSubscriptionObject;
        const photographer = await findPhotographerForSubscription(service, subscription);
        if (photographer) {
          await syncDeletedSubscriptionState(service, photographer, subscription);
        }
        break;
      }

      case "invoice.paid": {
        const invoice = object as unknown as StripeInvoice;
        if (invoice.subscription) {
          const photographer =
            (await findPhotographer(service, "stripe_subscription_id", invoice.subscription)) ||
            (await findPhotographer(
              service,
              "stripe_platform_customer_id",
              invoice.customer ?? null,
            ));

          if (photographer) {
            const liveSubscription = await retrieveStripeSubscription(invoice.subscription);
            await syncSubscriptionStateFromStripe(service, photographer, liveSubscription);

            // Send automatic invoice/receipt email to the subscriber.
            await sendInvoicePaidEmail(invoice, photographer);
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = object as unknown as StripeInvoice;
        if (invoice.subscription) {
          const photographer =
            (await findPhotographer(service, "stripe_subscription_id", invoice.subscription)) ||
            (await findPhotographer(
              service,
              "stripe_platform_customer_id",
              invoice.customer ?? null,
            ));

          if (photographer) {
            try {
              const liveSubscription = await retrieveStripeSubscription(invoice.subscription);
              await syncSubscriptionStateFromStripe(service, photographer, liveSubscription);
            } catch {
              await markSubscriptionPaymentFailure(service, photographer);
            }
          }
        }
        break;
      }

      case "checkout.session.completed": {
        const session = object as unknown as StripeCheckoutSession;
        const billingFlow = session.metadata?.billing_flow ?? null;

        if (billingFlow === "credit_pack") {
          await handleCreditPackCheckoutCompleted(service, session);
          break;
        }

        if (billingFlow === "plan_subscription" && session.subscription) {
          const photographer =
            (await findPhotographer(service, "id", session.metadata?.photographer_id ?? null)) ||
            (await findPhotographer(service, "stripe_platform_customer_id", session.customer ?? null));

          if (photographer) {
            const liveSubscription = await retrieveStripeSubscription(session.subscription);
            await syncSubscriptionStateFromStripe(service, photographer, liveSubscription);
          }
          break;
        }

        if (event.account && (billingFlow === "customer_order" || session.metadata?.order_id)) {
          if (session.payment_status === "paid" || session.payment_status === "no_payment_required") {
            await finalizePaidOrder(service, {
              orderId: session.metadata?.order_id ?? "",
              checkoutSessionId: session.id,
              paymentIntentId: session.payment_intent ?? null,
              paymentStatus: session.payment_status ?? "paid",
              note: `[Stripe webhook ${session.id}] payment confirmed`,
              paidAt: new Date().toISOString(),
            });
          }
        }
        break;
      }

      case "payment_intent.succeeded": {
        const paymentIntent = object as unknown as StripePaymentIntent;
        if (event.account && paymentIntent.metadata?.order_id) {
          await finalizePaidOrder(service, {
            orderId: paymentIntent.metadata.order_id,
            paymentIntentId: paymentIntent.id,
            paymentStatus: paymentIntent.status ?? "succeeded",
            note: `[Stripe payment intent ${paymentIntent.id}] payment confirmed`,
            paidAt: new Date().toISOString(),
          });
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = object as unknown as StripePaymentIntent;
        if (event.account && paymentIntent.metadata?.order_id) {
          await markOrderPaymentFailure(service, {
            paymentIntentId: paymentIntent.id,
            orderId: paymentIntent.metadata.order_id,
            note: `[Stripe payment intent ${paymentIntent.id}] payment failed`,
          });
        }
        break;
      }

      case "charge.refunded": {
        const charge = object as unknown as StripeCharge;
        if (charge.metadata?.pack_code) {
          await handleCreditChargeRefunded(service, charge);
        } else if (event.account && (charge.metadata?.order_id || charge.payment_intent)) {
          const partial = charge.amount_refunded < charge.amount;
          const refundResult = await markOrderRefunded(service, {
            paymentIntentId: charge.payment_intent ?? null,
            orderId: charge.metadata?.order_id ?? null,
            partial,
            refundAmountCents: charge.amount_refunded,
            note: `[Stripe charge ${charge.id}] refund recorded`,
          });

          if (refundResult) {
            await recordAudit({
              request: req,
              actorUserId: null,
              actorPhotographerId: null,
              action: "order.refund",
              entityType: "order",
              entityId: refundResult.orderId,
              targetPhotographerId: refundResult.photographerId,
              before: refundResult.before,
              after: refundResult.after,
              metadata: {
                source: "stripe.charge.refunded",
                stripeEventId: event.id,
                stripeChargeId: charge.id,
                stripeAccount: event.account ?? null,
                paymentIntentId: charge.payment_intent ?? null,
                chargeAmountCents: charge.amount,
                amountRefundedCents: charge.amount_refunded,
                fullyRefunded: refundResult.fullyRefunded,
              },
              result: "ok",
            });
          }
        }
        break;
      }

      default:
        break;
    }

    // Event already recorded above via insert-first dedup — nothing more to do.
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[stripe-webhook] handler failed", {
      eventId: event.id,
      type: event.type,
      error,
    });
    // The insert-first dedup row would permanently block Stripe retries if we
    // left it in place after a handler failure. Roll it back so the next
    // retry can reprocess this event cleanly. If the delete itself fails,
    // log it and move on — operators can replay manually from the Stripe
    // dashboard if needed.
    try {
      await service.from("stripe_events").delete().eq("id", event.id);
    } catch (rollbackError) {
      console.error("[stripe-webhook] failed to roll back dedup row", {
        eventId: event.id,
        rollbackError,
      });
    }
    return NextResponse.json(
      {
        ok: false,
        message: "Failed to process Stripe webhook.",
      },
      { status: 500 },
    );
  }
}

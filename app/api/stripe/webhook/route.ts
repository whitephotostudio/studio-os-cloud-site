import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { syncPhotographyKeysByPhotographerId } from "@/lib/studio-os-app";
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

type StripeInvoice = {
  id: string;
  customer?: string | null;
  subscription?: string | null;
};

type PhotographerRow = PhotographerBillingRow;

const PHOTOGRAPHER_SELECT =
  "id,user_id,business_name,brand_color,watermark_enabled,watermark_logo_url,studio_address,studio_phone,stripe_account_id,stripe_connected_account_id,stripe_connect_onboarding_complete,stripe_connect_charges_enabled,stripe_connect_payouts_enabled,stripe_platform_customer_id,stripe_subscription_id,stripe_subscription_item_base_id,stripe_subscription_item_extra_keys_id,stripe_subscription_item_usage_id,subscription_plan_code,subscription_billing_interval,subscription_status,subscription_current_period_start,subscription_current_period_end,billing_email,billing_currency,order_usage_rate_cents,extra_desktop_keys,studio_id,studio_email,logo_url,is_platform_admin";

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
  const { data: existingEvent, error: existingEventError } = await service
    .from("stripe_events")
    .select("id")
    .eq("id", event.id)
    .maybeSingle();

  if (existingEventError) {
    return NextResponse.json(
      { ok: false, message: existingEventError.message },
      { status: 500 },
    );
  }

  if (existingEvent) {
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
          await markOrderRefunded(service, {
            paymentIntentId: charge.payment_intent ?? null,
            orderId: charge.metadata?.order_id ?? null,
            partial: charge.amount_refunded < charge.amount,
            note: `[Stripe charge ${charge.id}] refund recorded`,
          });
        }
        break;
      }

      default:
        break;
    }

    await recordStripeEvent(service, event, JSON.parse(rawBody) as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to process Stripe webhook.",
      },
      { status: 500 },
    );
  }
}

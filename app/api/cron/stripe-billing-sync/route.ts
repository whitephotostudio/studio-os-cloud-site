import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import {
  isStripeBillingActive,
  retrieveStripeSubscription,
  syncSubscriptionStateFromStripe,
  type PhotographerBillingRow,
} from "@/lib/payments";

export const dynamic = "force-dynamic";

const PHOTOGRAPHER_SELECT =
  "id,user_id,business_name,brand_color,watermark_enabled,watermark_logo_url,studio_address,studio_phone,stripe_account_id,stripe_connected_account_id,stripe_connect_onboarding_complete,stripe_connect_charges_enabled,stripe_connect_payouts_enabled,stripe_platform_customer_id,stripe_subscription_id,stripe_subscription_item_base_id,stripe_subscription_item_extra_keys_id,stripe_subscription_item_usage_id,subscription_plan_code,subscription_billing_interval,subscription_status,subscription_current_period_start,subscription_current_period_end,billing_email,billing_currency,order_usage_rate_cents,extra_desktop_keys,studio_id,studio_email,logo_url,is_platform_admin";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function isAuthorized(request: NextRequest) {
  const expected = clean(process.env.CRON_SECRET);
  if (!expected) return true;
  const header = clean(request.headers.get("authorization"));
  return header === `Bearer ${expected}`;
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

    const service = createDashboardServiceClient();
    const { data, error } = await service
      .from("photographers")
      .select(PHOTOGRAPHER_SELECT)
      .not("stripe_subscription_id", "is", null)
      .limit(200);

    if (error) throw error;

    let processed = 0;
    let synced = 0;
    let failed = 0;

    for (const photographer of ((data ?? []) as PhotographerBillingRow[])) {
      if (!photographer.stripe_subscription_id) continue;
      processed += 1;

      try {
        const subscription = await retrieveStripeSubscription(photographer.stripe_subscription_id);
        await syncSubscriptionStateFromStripe(service, photographer, subscription);
        if (isStripeBillingActive(subscription.status)) {
          synced += 1;
        }
      } catch {
        failed += 1;
      }
    }

    return NextResponse.json({ ok: true, processed, synced, failed });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Unable to sync Stripe billing state.",
      },
      { status: 500 },
    );
  }
}

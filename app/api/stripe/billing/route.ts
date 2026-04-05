import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import {
  billingReturnUrl,
  createBillingPortalSession,
  createCreditsCheckoutSession,
  createPlanCheckoutSession,
  ensureCreditPackageCatalog,
  ensurePlatformCustomer,
  getOrCreatePhotographerByUser,
  normalizeBillingInterval,
  normalizeCreditPackCode,
  normalizePlanCode,
  retrieveStripeSubscription,
  syncSubscriptionStateFromStripe,
  updateStripeSubscriptionConfiguration,
} from "@/lib/payments";

export const dynamic = "force-dynamic";

type BillingAction =
  | "subscribe"
  | "update_plan"
  | "update_extra_keys"
  | "buy_credits"
  | "portal";

type BillingBody = {
  action?: BillingAction;
  planCode?: string | null;
  billingInterval?: string | null;
  extraDesktopKeys?: number | string | null;
  packCode?: string | null;
};

function requestOrigin(request: NextRequest) {
  return new URL(request.url).origin.replace(/\/$/, "");
}

function parseExtraDesktopKeys(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.round(numeric);
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again before opening billing." },
        { status: 401 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as BillingBody;
    const action = body.action;

    if (!action) {
      return NextResponse.json(
        { ok: false, message: "Billing action is required." },
        { status: 400 },
      );
    }

    const service = createDashboardServiceClient();
    let photographer = await getOrCreatePhotographerByUser(service, user);

    if (photographer.stripe_subscription_id) {
      try {
        const subscription = await retrieveStripeSubscription(photographer.stripe_subscription_id);
        const synced = await syncSubscriptionStateFromStripe(service, photographer, subscription);
        photographer = synced.photographer;
      } catch {
        // A stale local subscription id should not block opening billing.
      }
    }

    const origin = requestOrigin(request);
    const customerId = await ensurePlatformCustomer(service, photographer, user);

    if (action === "portal") {
      const session = await createBillingPortalSession(
        customerId,
        billingReturnUrl(origin, "portal"),
      );

      return NextResponse.json({
        ok: true,
        url: session.url,
        customerId,
      });
    }

    if (action === "buy_credits") {
      const packCode = normalizeCreditPackCode(body.packCode);
      if (!packCode) {
        return NextResponse.json(
          { ok: false, message: "A valid credit pack is required." },
          { status: 400 },
        );
      }

      const creditPacks = await ensureCreditPackageCatalog(service);
      const pack = creditPacks.find((entry) => entry.code === packCode);

      if (!pack) {
        return NextResponse.json(
          { ok: false, message: "Credit pack not found." },
          { status: 404 },
        );
      }

      const session = await createCreditsCheckoutSession({
        customerId,
        photographerId: photographer.id,
        userId: user.id,
        packCode,
        creditPackageId: pack.id,
        successUrl: billingReturnUrl(origin, "credits_success"),
        cancelUrl: billingReturnUrl(origin, "credits_cancel"),
      });

      return NextResponse.json({
        ok: true,
        url: session.url,
        sessionId: session.id,
        packCode,
      });
    }

    const planCode = normalizePlanCode(body.planCode);
    if (!planCode) {
      return NextResponse.json(
        { ok: false, message: "A valid Studio OS plan is required." },
        { status: 400 },
      );
    }
    const billingInterval = normalizeBillingInterval(body.billingInterval) ?? "month";

    const extraDesktopKeys =
      planCode === "studio" ? parseExtraDesktopKeys(body.extraDesktopKeys) : 0;

    if (
      photographer.stripe_subscription_id &&
      !["canceled", "incomplete_expired"].includes(
        (photographer.subscription_status ?? "").toLowerCase(),
      )
    ) {
      const subscription = await updateStripeSubscriptionConfiguration({
        subscriptionId: photographer.stripe_subscription_id,
        photographerId: photographer.id,
        planCode,
        billingInterval,
        extraDesktopKeys,
      });

      const synced = await syncSubscriptionStateFromStripe(service, photographer, subscription);

      return NextResponse.json({
        ok: true,
        updated: true,
        subscriptionId: synced.subscription.id,
        subscriptionStatus: synced.subscription.status,
        subscriptionPlanCode: synced.planCode,
        subscriptionBillingInterval: billingInterval,
        extraDesktopKeys: synced.extraDesktopKeys,
      });
    }

    const session = await createPlanCheckoutSession({
      customerId,
      photographerId: photographer.id,
      userId: user.id,
      planCode,
      billingInterval,
      extraDesktopKeys,
      successUrl: billingReturnUrl(origin, "subscription_success"),
      cancelUrl: billingReturnUrl(origin, "subscription_cancel"),
    });

    return NextResponse.json({
      ok: true,
      url: session.url,
      sessionId: session.id,
      customerId,
      planCode,
      billingInterval,
      extraDesktopKeys,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Unable to update Stripe billing.",
      },
      { status: 500 },
    );
  }
}

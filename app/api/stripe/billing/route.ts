import { NextRequest, NextResponse } from "next/server";
import { creditMaintenanceActive } from "@/lib/credit-maintenance";
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
  resolveSubscriptionCurrency,
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
  returnTo?: string | null;
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
    if (creditMaintenanceActive()) {
      return NextResponse.json({
        ok: false, maintenance: true,
        message: "Studio OS billing is briefly paused for an upgrade. Please try again in a few minutes.",
      }, { status: 503, headers: { "Retry-After": "120", "Cache-Control": "no-store" } });
    }

    const body = (await request.json().catch(() => ({}))) as BillingBody;
    const action = body.action;

    if (!action || !["subscribe", "update_plan", "update_extra_keys", "buy_credits", "portal"].includes(action)) {
      return NextResponse.json(
        { ok: false, message: "A valid billing action is required." },
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
    if (action === "portal") {
      const customerId = await ensurePlatformCustomer(service, photographer, user);
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

      const customerId = await ensurePlatformCustomer(service, photographer, user);
      const session = await createCreditsCheckoutSession({
        customerId,
        photographerId: photographer.id,
        userId: user.id,
        packCode,
        creditPackageId: pack.id,
        successUrl: body.returnTo === "credits" ? `${origin}/credits?billing=credits_success` : billingReturnUrl(origin, "credits_success"),
        cancelUrl: body.returnTo === "credits" ? `${origin}/credits?billing=credits_cancel` : billingReturnUrl(origin, "credits_cancel"),
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
    const hasExistingContract = Boolean(photographer.stripe_subscription_id &&
      !["canceled", "incomplete_expired"].includes((photographer.subscription_status ?? "").toLowerCase()));

    // This is subscription billing, not the studio's independently selected
    // customer-sales currency. Resolve before creating any new customer or
    // Checkout so a missing country or unverified old contract fails safely.
    const subscriptionCurrency = await resolveSubscriptionCurrency(photographer);
    const country = (photographer.business_country || photographer.stripe_connect_country || "").toUpperCase();
    if (!hasExistingContract && ["AU", "GB"].includes(country)) {
      return NextResponse.json({ ok: false,
        message: "Subscriptions for Australian and UK photographers will open with their Stripe payment rollout. No subscription was created.",
      }, { status: 409 });
    }
    const customerId = await ensurePlatformCustomer(service, photographer, user);

    if (hasExistingContract && photographer.stripe_subscription_id) {
      // Flush paid orders at their original plan rate before replacing the
      // subscription's usage meter. A failed refresh must block this mutation.
      const existing = await retrieveStripeSubscription(photographer.stripe_subscription_id);
      await syncSubscriptionStateFromStripe(service, photographer, existing);
      const subscription = await updateStripeSubscriptionConfiguration({
        subscriptionId: photographer.stripe_subscription_id,
        customerId,
        photographerId: photographer.id,
        planCode,
        billingInterval,
        extraDesktopKeys,
        preserveBasePlan: action === "update_extra_keys",
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
        subscriptionCurrency,
      });
    }

    const session = await createPlanCheckoutSession({
      customerId,
      photographerId: photographer.id,
      userId: user.id,
      planCode,
      billingInterval,
      extraDesktopKeys,
      subscriptionCurrency,
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
      subscriptionCurrency,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "SubscriptionCurrencyError") {
      return NextResponse.json({ ok: false, message: error.message }, {
        status: (error as Error & { status?: number }).status || 409,
      });
    }
    console.error("[stripe:billing]", error);
    return NextResponse.json(
      { ok: false, message: "Unable to update Stripe billing." },
      { status: 500 },
    );
  }
}

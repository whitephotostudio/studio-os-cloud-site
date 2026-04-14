import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import {
  ANNUAL_DISCOUNT_PERCENT,
  CREDIT_PACK_DEFS,
  DEFAULT_BILLING_CURRENCY,
  EXTRA_DESKTOP_KEY_ANNUAL_CENTS,
  EXTRA_DESKTOP_KEY_MONTHLY_CENTS,
  FREE_TRIAL_DAYS,
  ORDER_USAGE_RATE_CENTS,
  PLAN_DEFS,
  describeConnectStatus,
  ensureCreditPackageCatalog,
  getConnectedAccountId,
  getCreditBalance,
  getDefaultPaymentMethod,
  getOrCreatePhotographerByUser,
  getFreeTrialDaysRemaining,
  getUsageSummaryForCurrentPeriod,
  isFreeTrialActive,
  isFreeTrialExpired,
  isStripeBillingActive,
  listRecentStripeInvoices,
  resolveFreeTrialEndsAt,
  retrieveStripeAccount,
  retrieveStripeSubscription,
  syncConnectState,
  syncSubscriptionStateFromStripe,
} from "@/lib/payments";

export const dynamic = "force-dynamic";

const EMPTY_PROFILE = {
  ok: false,
  signedIn: false,
  businessName: "WhitePhoto",
  studioName: "Studio OS Cloud",
  brandColor: "#0f172a",
  logoUrl: "",
  stripeAccountId: null,
  detailsSubmitted: false,
  chargesEnabled: false,
  payoutsEnabled: false,
  onboardingComplete: false,
  connectStatusLabel: "Not connected",
  connectStatusMessage: "Connect Stripe before parents can complete checkout.",
  connectReadyForPayments: false,
  photographerId: null,
  studioId: null,
  watermarkEnabled: true,
  watermarkLogoUrl: "",
  studioAddress: "",
  studioPhone: "",
  studioEmail: "",
  billingEmail: "",
  billingCurrency: DEFAULT_BILLING_CURRENCY,
  isPlatformAdmin: false,
  subscriptionPlanCode: null,
  subscriptionBillingInterval: "month",
  subscriptionStatus: "inactive",
  subscriptionCurrentPeriodStart: null,
  subscriptionCurrentPeriodEnd: null,
  extraDesktopKeys: 0,
  orderUsageRateCents: ORDER_USAGE_RATE_CENTS,
  creditBalance: 0,
  studioUsage: {
    countedOrders: 0,
    billableOrders: 0,
    unreportedOrders: 0,
    estimatedChargeCents: 0,
    billingPeriodKey: null,
  },
  recentInvoices: [],
  defaultPaymentMethod: null,
  trialStartsAt: null,
  trialEndsAt: null,
  trialActive: false,
  trialExpired: false,
  trialDaysRemaining: 0,
  freeTrialDays: FREE_TRIAL_DAYS,
  billingCatalog: {
    annualDiscountPercent: ANNUAL_DISCOUNT_PERCENT,
    plans: Object.values(PLAN_DEFS),
    extraDesktopKeyMonthlyCents: EXTRA_DESKTOP_KEY_MONTHLY_CENTS,
    extraDesktopKeyAnnualCents: EXTRA_DESKTOP_KEY_ANNUAL_CENTS,
    orderUsageRateCents: ORDER_USAGE_RATE_CENTS,
    creditPacks: Object.values(CREDIT_PACK_DEFS),
  },
};

export async function GET(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        {
          ...EMPTY_PROFILE,
          message: "Please sign in again before opening billing settings.",
        },
        { status: 401 },
      );
    }

    const service = createDashboardServiceClient();
    let photographer = await getOrCreatePhotographerByUser(service, user);
    const warnings: string[] = [];

    let studioName = "Studio OS Cloud";
    if (photographer.studio_id) {
      const { data: studio, error: studioError } = await service
        .from("studios")
        .select("id,name")
        .eq("id", photographer.studio_id)
        .maybeSingle();

      if (studioError) throw studioError;
      if (studio?.name) studioName = studio.name;
    }

    const stripeAccountId = getConnectedAccountId(photographer);
    let detailsSubmitted = Boolean(photographer.stripe_connect_onboarding_complete);
    let chargesEnabled = Boolean(photographer.stripe_connect_charges_enabled);
    let payoutsEnabled = Boolean(photographer.stripe_connect_payouts_enabled);
    let connectDisabledReason: string | null = null;

    if (stripeAccountId) {
      try {
        const account = await retrieveStripeAccount(stripeAccountId);
        await syncConnectState(service, photographer.id, account);
        photographer = {
          ...photographer,
          stripe_account_id: account.id,
          stripe_connected_account_id: account.id,
          stripe_connect_onboarding_complete:
            account.details_submitted && account.charges_enabled && account.payouts_enabled,
          stripe_connect_charges_enabled: account.charges_enabled,
          stripe_connect_payouts_enabled: account.payouts_enabled,
          billing_currency: account.default_currency || photographer.billing_currency,
        };
        detailsSubmitted = Boolean(account.details_submitted);
        chargesEnabled = Boolean(account.charges_enabled);
        payoutsEnabled = Boolean(account.payouts_enabled);
        connectDisabledReason = account.requirements?.disabled_reason ?? null;
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? error.message
            : "Unable to refresh Stripe Connect account status.",
        );
      }
    }

    if (photographer.stripe_subscription_id) {
      try {
        const subscription = await retrieveStripeSubscription(photographer.stripe_subscription_id);
        const synced = await syncSubscriptionStateFromStripe(service, photographer, subscription);
        photographer = synced.photographer;
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? error.message
            : "Unable to refresh Stripe Billing subscription status.",
        );
      }
    }

    const creditBalance = await getCreditBalance(service, user.id, photographer.id, {
      isPlatformAdmin: photographer.is_platform_admin,
    });
    const creditPacks = await ensureCreditPackageCatalog(service);
    const usageSummary = await getUsageSummaryForCurrentPeriod(service, photographer);
    const connectStatus = describeConnectStatus({
      accountId: stripeAccountId,
      detailsSubmitted,
      chargesEnabled,
      payoutsEnabled,
      disabledReason: connectDisabledReason,
    });

    let recentInvoices: Awaited<ReturnType<typeof listRecentStripeInvoices>> = [];
    let defaultPaymentMethod: { brand: string; last4: string; expMonth: number; expYear: number } | null = null;
    if (photographer.stripe_platform_customer_id) {
      try {
        defaultPaymentMethod = await getDefaultPaymentMethod(photographer.stripe_platform_customer_id);
      } catch { /* ignore */ }
      try {
        recentInvoices = await listRecentStripeInvoices(photographer.stripe_platform_customer_id);
      } catch (error) {
        warnings.push(
          error instanceof Error ? error.message : "Unable to load recent Stripe invoices.",
        );
      }
    }

    return NextResponse.json({
      ok: true,
      signedIn: true,
      businessName: photographer.business_name || "WhitePhoto",
      studioName,
      brandColor: photographer.brand_color || "#0f172a",
      logoUrl: photographer.logo_url || "",
      stripeAccountId,
      detailsSubmitted,
      chargesEnabled,
      payoutsEnabled,
      onboardingComplete: detailsSubmitted && chargesEnabled && payoutsEnabled,
      connectStatusLabel: connectStatus.label,
      connectStatusMessage: connectStatus.message,
      connectReadyForPayments: connectStatus.readyForPayments,
      connectDisabledReason,
      photographerId: photographer.id,
      studioId: photographer.studio_id,
      watermarkEnabled: photographer.watermark_enabled !== false,
      watermarkLogoUrl: photographer.watermark_logo_url || "",
      studioAddress: photographer.studio_address || "",
      studioPhone: photographer.studio_phone || "",
      studioEmail: photographer.studio_email || "",
      billingEmail:
        photographer.billing_email || photographer.studio_email || user.email || "",
      billingCurrency: photographer.billing_currency || DEFAULT_BILLING_CURRENCY,
      isPlatformAdmin: Boolean(photographer.is_platform_admin),
      stripePlatformCustomerId: photographer.stripe_platform_customer_id,
      stripeSubscriptionId: photographer.stripe_subscription_id,
      subscriptionPlanCode: photographer.subscription_plan_code,
      subscriptionBillingInterval: photographer.subscription_billing_interval || "month",
      subscriptionStatus: photographer.subscription_status || "inactive",
      subscriptionIsActive: isStripeBillingActive(photographer.subscription_status),
      subscriptionCurrentPeriodStart: photographer.subscription_current_period_start,
      subscriptionCurrentPeriodEnd: photographer.subscription_current_period_end,
      extraDesktopKeys: photographer.extra_desktop_keys ?? 0,
      orderUsageRateCents: photographer.order_usage_rate_cents ?? ORDER_USAGE_RATE_CENTS,
      trialStartsAt: photographer.trial_starts_at ?? photographer.created_at ?? null,
      trialEndsAt: resolveFreeTrialEndsAt(photographer),
      trialActive: isFreeTrialActive(photographer),
      trialExpired: isFreeTrialExpired(photographer),
      trialDaysRemaining: getFreeTrialDaysRemaining(photographer),
      freeTrialDays: FREE_TRIAL_DAYS,
      creditBalance,
      studioUsage: usageSummary,
      recentInvoices,
      billingCatalog: {
        annualDiscountPercent: ANNUAL_DISCOUNT_PERCENT,
        plans: Object.values(PLAN_DEFS),
        extraDesktopKeyMonthlyCents: EXTRA_DESKTOP_KEY_MONTHLY_CENTS,
        extraDesktopKeyAnnualCents: EXTRA_DESKTOP_KEY_ANNUAL_CENTS,
        orderUsageRateCents: ORDER_USAGE_RATE_CENTS,
        creditPacks,
      },
      defaultPaymentMethod,
      warnings,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ...EMPTY_PROFILE,
        signedIn: true,
        message:
          error instanceof Error ? error.message : "Unable to load Stripe billing status.",
      },
      { status: 500 },
    );
  }
}

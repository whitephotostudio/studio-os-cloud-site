import { NextRequest, NextResponse } from "next/server";
import { creditMaintenanceActive } from "@/lib/credit-maintenance";
import { hasR2Config } from "@/lib/r2";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import {
  CREDIT_PACK_DEFS,
  DEFAULT_BILLING_CURRENCY,
  FREE_TRIAL_DAYS,
  ORDER_USAGE_RATE_CENTS,
  describeConnectStatus,
  ensureCreditPackageCatalog,
  getConnectedAccountId,
  getCreditBalanceDetails,
  getDefaultPaymentMethod,
  getOrCreatePhotographerByUser,
  getFreeTrialDaysRemaining,
  getUsageSummaryForCurrentPeriod,
  isFreeTrialActive,
  isFreeTrialExpired,
  isStripeBillingActive,
  listRecentStripeInvoices,
  resolveFreeTrialEndsAt,
  resolveSubscriptionCurrency,
  retrieveStripeAccount,
  retrieveStripeSubscription,
  syncConnectState,
  syncSubscriptionStateFromStripe,
  type PhotographerBillingRow,
} from "@/lib/payments";
import { verifiedConnectCountry } from "@/lib/stripe-connect-country";
import { getPricingCatalogSnapshot } from "@/lib/studio-pricing";
import { refreshStandardSignupForPhotographer } from "@/lib/stripe-standard-signup";

export const dynamic = "force-dynamic";
const pricingCatalog = getPricingCatalogSnapshot();
type ConnectedAccountStatus = Awaited<ReturnType<typeof retrieveStripeAccount>> & {
  type?: string;
  controller?: { fees?: { payer?: string }; losses?: { payments?: string }; requirement_collection?: string; stripe_dashboard?: { type?: string } };
  capabilities?: Record<string, string>;
  future_requirements?: Record<string, unknown> | null;
};

const EMPTY_PROFILE = {
  ok: false,
  signedIn: false,
  businessName: "WhitePhoto",
  studioName: "Studio OS Cloud",
  brandColor: "#0f172a",
  logoUrl: "",
  stripeAccountId: null,
  stripeAccountType: null,
  stripeDashboardType: null,
  stripePendingAccountId: null,
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
  subscriptionCurrency: null,
  subscriptionCountryRequired: false,
  creditCurrency: "cad",
  businessCountry: null,
  businessCountryLocked: false,
  stripeAccountCountry: null,
  salesCurrencyConfigured: false,
  isPlatformAdmin: false,
  subscriptionPlanCode: null,
  subscriptionBillingInterval: "month",
  subscriptionStatus: "inactive",
  subscriptionCurrentPeriodStart: null,
  subscriptionCurrentPeriodEnd: null,
  extraDesktopKeys: 0,
  orderUsageRateCents: ORDER_USAGE_RATE_CENTS,
  creditBalance: 0,
  creditExpiresAt: null,
  creditDebt: 0,
  premiumCloudAvailable: false,
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
    ...pricingCatalog,
    currency: DEFAULT_BILLING_CURRENCY,
    creditCurrency: "cad",
    plans: Object.values(pricingCatalog.plans),
    orderUsageRateCents: ORDER_USAGE_RATE_CENTS,
    creditPacks: Object.values(CREDIT_PACK_DEFS),
  },
};

export async function GET(request: NextRequest) {
  try {
    const { user, mfaSatisfied } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        {
          ...EMPTY_PROFILE,
          message: "Please sign in again before opening billing settings.",
        },
        { status: 401 },
      );
    }
    if (mfaSatisfied === false) return NextResponse.json({ ...EMPTY_PROFILE, signedIn: true, message: "Complete two-factor sign-in before opening billing settings." }, { status: 403 });
    if (creditMaintenanceActive()) {
      return NextResponse.json({
        ...EMPTY_PROFILE, signedIn: true, maintenance: true,
        message: "Studio OS billing is briefly paused for an upgrade. Please try again in a few minutes.",
      }, { status: 503, headers: { "Retry-After": "120", "Cache-Control": "no-store" } });
    }

    const service = createDashboardServiceClient();
    let photographer = await getOrCreatePhotographerByUser(service, user);
    const warnings: string[] = [];
    let signup: Awaited<ReturnType<typeof refreshStandardSignupForPhotographer<PhotographerBillingRow>>> | null = null;
    let signupRefreshError: string | null = null;
    // A previously reserved Standard account can finish onboarding with new
    // creation disabled. The helper only GET-verifies and atomically registers
    // or first-activates the exact authenticated owner's existing intent.
    if (mfaSatisfied === true) {
      try {
        signup = await refreshStandardSignupForPhotographer(service, { photographer, userId: user.id });
        if (signup.handled) photographer = signup.photographer;
      } catch {
        signupRefreshError = "Your Stripe setup needs verification before customer payments can continue.";
        warnings.push(signupRefreshError);
      }
    }

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
    let stripeAccountCountry: string | null = null;
    let connectCountryError: string | null = signupRefreshError;
    let stripeAccountType: "express" | "standard" | null = null;
    let stripeDashboardType: "express" | "full" | null = null;
    const stripePendingAccountId = signup?.handled && signup.pending && signup.account ? signup.account.id : null;
    let standardReady: boolean | null = null;
    const strictStandardReady = (account: ConnectedAccountStatus) => {
      const clean = (requirements: object | null | undefined) => {
        const fields = requirements as Record<string, unknown> | null | undefined;
        return Boolean(fields) && !fields?.disabled_reason && ["currently_due", "eventually_due", "past_due", "pending_verification", "errors"]
          .every(key => Array.isArray(fields?.[key]) && (fields?.[key] as unknown[]).length === 0);
      };
      return account?.type === "standard" && account.controller?.fees?.payer === "account" && account.controller?.losses?.payments === "stripe" &&
        account.controller?.requirement_collection === "stripe" && account.controller?.stripe_dashboard?.type === "full" &&
        account.details_submitted === true && account.charges_enabled === true && account.payouts_enabled === true &&
        account.capabilities?.card_payments === "active" && account.capabilities?.transfers === "active" &&
        clean(account.requirements) && clean(account.future_requirements);
    };
    if (signup?.handled && signup.account) {
      stripeAccountCountry = signup.account.country || null;
      stripeAccountType = signup.account.type === "standard" ? "standard" : null;
      stripeDashboardType = signup.account.controller?.stripe_dashboard?.type === "full" ? "full" : null;
      detailsSubmitted = signup.account.details_submitted === true;
      chargesEnabled = signup.account.charges_enabled === true;
      payoutsEnabled = signup.account.payouts_enabled === true;
      standardReady = signup.active && !signup.blocked && strictStandardReady(signup.account as ConnectedAccountStatus);
    }
    if (signup?.blocked) connectCountryError = "This Stripe connection was disconnected. Contact Studio OS support before reconnecting.";
    if (signupRefreshError || signup?.blocked) detailsSubmitted = chargesEnabled = payoutsEnabled = false;

    if (stripeAccountId && !connectCountryError) {
      try {
        const account = (signup?.handled && signup.active && signup.account?.id === stripeAccountId
          ? signup.account : await retrieveStripeAccount(stripeAccountId)) as ConnectedAccountStatus;
        stripeAccountType = account.type === "standard" || account.type === "express" ? account.type : null;
        stripeDashboardType = account.controller?.stripe_dashboard?.type === "full" ? "full"
          : account.controller?.stripe_dashboard?.type === "express" ? "express" : null;
        standardReady = account.type === "standard" ? strictStandardReady(account) : null;
        stripeAccountCountry = account.country || null;
        verifiedConnectCountry(account, photographer.business_country || photographer.stripe_connect_country);
        await syncConnectState(service, photographer.id, account);
        photographer = {
          ...photographer,
          stripe_account_id: account.id,
          stripe_connected_account_id: account.id,
          stripe_connect_onboarding_complete:
            account.details_submitted && account.charges_enabled && account.payouts_enabled,
          stripe_connect_charges_enabled: account.charges_enabled,
          stripe_connect_payouts_enabled: account.payouts_enabled,
        };
        detailsSubmitted = Boolean(account.details_submitted);
        chargesEnabled = Boolean(account.charges_enabled);
        payoutsEnabled = Boolean(account.payouts_enabled);
        connectDisabledReason = account.requirements?.disabled_reason ?? null;
      } catch (error) {
        // A cached enabled flag cannot establish that the correct merchant
        // country was verified when the current provider read failed.
        detailsSubmitted = false;
        chargesEnabled = false;
        payoutsEnabled = false;
        connectCountryError = error instanceof Error ? error.message : "Unable to verify your Stripe account. Refresh its status before continuing.";
        warnings.push(
          error instanceof Error
            ? error.message
            : "Unable to refresh Stripe Connect account status.",
        );
      }
    }

    let verifiedSubscription: Awaited<ReturnType<typeof retrieveStripeSubscription>> | undefined;
    if (photographer.stripe_subscription_id) {
      try {
        const subscription = await retrieveStripeSubscription(photographer.stripe_subscription_id);
        const synced = await syncSubscriptionStateFromStripe(service, photographer, subscription);
        photographer = synced.photographer;
        verifiedSubscription = synced.subscription || subscription;
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? error.message
            : "Unable to refresh Stripe Billing subscription status.",
        );
      }
    }

    let subscriptionCurrency: "cad" | "usd" | "aud" | "gbp" | null = "cad";
    let subscriptionCountryRequired = false;
    // Rollback must still display an already-agreed foreign subscription in
    // its actual currency. New offers require an explicit saved country.
    try {
      subscriptionCurrency = await resolveSubscriptionCurrency(photographer, verifiedSubscription);
    } catch (error) {
      subscriptionCurrency = null;
      subscriptionCountryRequired = !photographer.stripe_subscription_id &&
        !photographer.business_country && !photographer.stripe_connect_country;
      warnings.push(error instanceof Error ? error.message : "Unable to verify your subscription currency.");
    }
    const subscriptionCatalog = getPricingCatalogSnapshot(subscriptionCurrency || "cad");

    const credits = await getCreditBalanceDetails(service, user.id, photographer.id, {
      isPlatformAdmin: photographer.is_platform_admin,
    });
    const creditPacks = await ensureCreditPackageCatalog(service);
    const usageSummary = await getUsageSummaryForCurrentPeriod(service, photographer);
    const connectStatus = connectCountryError ? { label: "Needs review", message: connectCountryError, readyForPayments: false }
      : signup?.pending ? { label: "Setup in progress", message: "Continue Stripe setup to finish verification. Customer payments stay unavailable until Stripe is ready.", readyForPayments: false }
      : standardReady === false ? { label: "Needs verification", message: "Stripe still needs verification or payment capabilities before this Standard account can accept customer orders.", readyForPayments: false }
      : describeConnectStatus({
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
        console.error("[stripe:status:listInvoices]", error);
        warnings.push("Unable to load recent Stripe invoices.");
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
      stripeAccountType,
      stripeDashboardType,
      stripePendingAccountId,
      detailsSubmitted,
      chargesEnabled,
      payoutsEnabled,
      onboardingComplete: Boolean(stripeAccountId) && connectStatus.readyForPayments && detailsSubmitted && chargesEnabled && payoutsEnabled,
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
      subscriptionCurrency,
      subscriptionCountryRequired,
      creditCurrency: "cad",
      businessCountry: photographer.business_country || (["CA", "US", "AU", "GB"].includes(stripeAccountCountry || "") ? stripeAccountCountry : null),
      businessCountryLocked: Boolean(stripeAccountId || photographer.stripe_connect_country),
      stripeAccountCountry,
      salesCurrencyConfigured: photographer.sales_currency_configured !== false,
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
      creditBalance: credits.balance,
      creditExpiresAt: credits.expiresAt,
      creditDebt: credits.creditDebt,
      premiumCloudAvailable: Boolean(process.env.PHOTOROOM_API_KEY?.trim()) && hasR2Config(),
      studioUsage: usageSummary,
      recentInvoices,
      billingCatalog: {
        ...subscriptionCatalog,
        currency: subscriptionCatalog.currency,
        creditCurrency: "cad",
        plans: Object.values(subscriptionCatalog.plans),
        orderUsageRateCents: ORDER_USAGE_RATE_CENTS,
        creditPacks,
      },
      defaultPaymentMethod,
      warnings,
    });
  } catch (error) {
    console.error("[stripe:status]", error);
    return NextResponse.json(
      {
        ...EMPTY_PROFILE,
        signedIn: true,
        message: "Unable to load Stripe billing status.",
      },
      { status: 500 },
    );
  }
}

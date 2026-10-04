import { resolveSubscriptionAccess, type SubscriptionAccessRow } from "@/lib/subscription-access";
import { normalizePlanCode } from "@/lib/studio-pricing";

export type AdminTrialStatus = "active" | "expired" | "none" | "converted" | "owner" | "incomplete";

/** Reporting must distinguish initialized accounts from legacy entitlement fallbacks. */
export function resolveAdminSignupStatus(
  photographer: SubscriptionAccessRow & { stripe_subscription_id?: string | null },
  now = Date.now(),
) {
  const access = resolveSubscriptionAccess(photographer, now);
  const hasStripeSubscription = Boolean(photographer.stripe_subscription_id);
  const signupIncomplete = !access.isOwner && !hasStripeSubscription &&
    photographer.subscription_status?.trim().toLowerCase() === "trial" &&
    (!photographer.subscription_plan_code?.trim() || !photographer.trial_starts_at || !photographer.trial_ends_at);
  const trialStatus: AdminTrialStatus = access.isOwner ? "owner"
    : signupIncomplete ? "incomplete"
    : hasStripeSubscription && access.billingActive ? "converted"
    : access.trialActive ? "active"
    : access.trialExpired ? "expired" : "none";
  return {
    signupIncomplete,
    subscriptionPlanCode: signupIncomplete ? normalizePlanCode(photographer.subscription_plan_code) : access.planCode,
    trialEndsAt: signupIncomplete ? photographer.trial_ends_at ?? null : access.trialEndsAt,
    trialStatus,
    trialDaysRemaining: signupIncomplete ? 0 : access.trialDaysRemaining,
  };
}

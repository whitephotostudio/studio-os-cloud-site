import { FREE_TRIAL_DAYS } from "@/lib/trial-config";
import { normalizePlanCode } from "@/lib/studio-pricing";

/** Shared by browser, gallery gates, desktop entitlements and admin reporting. */
export type SubscriptionAccessRow = {
  is_platform_admin?: boolean | null;
  subscription_status?: string | null;
  subscription_plan_code?: string | null;
  trial_starts_at?: string | null;
  trial_ends_at?: string | null;
  created_at?: string | null;
};

export function isStripeBillingActive(status: string | null | undefined) {
  const normalized = (status ?? "").trim().toLowerCase();
  return normalized === "active" || normalized === "trialing";
}

export function isTrialStatus(status: string | null | undefined) {
  const normalized = (status ?? "").trim().toLowerCase();
  return normalized === "trial" || normalized === "trialing";
}

export function resolveFreeTrialEndsAt(photographer: SubscriptionAccessRow) {
  if (photographer.trial_ends_at) return photographer.trial_ends_at;
  if (!isTrialStatus(photographer.subscription_status)) return null;
  const anchor = photographer.trial_starts_at ?? photographer.created_at;
  if (!anchor) return null;
  // Legacy created_at is timestamp-without-time-zone, stored in UTC.
  // Browsers must not reinterpret it in the photographer's local timezone.
  const utcAnchor = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(anchor)
    ? `${anchor}Z` : anchor;
  const parsed = new Date(utcAnchor);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getTime() + FREE_TRIAL_DAYS * 86_400_000).toISOString();
}

export function getFreeTrialDaysRemaining(photographer: SubscriptionAccessRow, now = Date.now()) {
  const end = resolveFreeTrialEndsAt(photographer);
  const endTime = end ? Date.parse(end) : NaN;
  return Number.isFinite(endTime) ? Math.max(0, Math.ceil((endTime - now) / 86_400_000)) : 0;
}

export function isFreeTrialActive(photographer: SubscriptionAccessRow, now = Date.now()) {
  if (photographer.is_platform_admin || isStripeBillingActive(photographer.subscription_status)) return false;
  if (!isTrialStatus(photographer.subscription_status)) return false;
  const end = resolveFreeTrialEndsAt(photographer);
  return Boolean(end && Date.parse(end) > now);
}

export function isFreeTrialExpired(photographer: SubscriptionAccessRow, now = Date.now()) {
  if (photographer.is_platform_admin || isStripeBillingActive(photographer.subscription_status)) return false;
  if (!isTrialStatus(photographer.subscription_status)) return false;
  const end = resolveFreeTrialEndsAt(photographer);
  return Boolean(end && Date.parse(end) <= now);
}

export function resolveSubscriptionAccess(photographer: SubscriptionAccessRow, now = Date.now()) {
  const isOwner = Boolean(photographer.is_platform_admin);
  const billingActive = isStripeBillingActive(photographer.subscription_status);
  const trialActive = isFreeTrialActive(photographer, now);
  return {
    isOwner,
    billingActive,
    trialActive,
    trialExpired: isFreeTrialExpired(photographer, now),
    trialEndsAt: resolveFreeTrialEndsAt(photographer),
    trialDaysRemaining: trialActive ? getFreeTrialDaysRemaining(photographer, now) : 0,
    accessEnabled: isOwner || billingActive || trialActive,
    planCode: isOwner || trialActive ? "studio" as const : normalizePlanCode(photographer.subscription_plan_code),
  };
}

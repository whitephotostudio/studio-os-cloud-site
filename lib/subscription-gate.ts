import type { SupabaseClient } from "@supabase/supabase-js";
import { isFreeTrialActive, isStripeBillingActive } from "@/lib/payments";

/**
 * Defense-in-depth check for portal (public gallery) routes.
 *
 * Our Stripe webhook deletes the photographer's projects and media when
 * their subscription ends. But webhook processing is eventually-consistent:
 * it can fail, it can be in-flight, or a race can leave galleries partially
 * accessible for a window. This helper gives us a synchronous gate at read
 * time so visitors never hit a cancelled photographer's content, even if
 * the cleanup hasn't landed yet.
 *
 * Platform admins (is_platform_admin) always pass. Trial users pass while
 * their trial is still live. Everyone else must have an active or trialing
 * Stripe subscription.
 */
export type SubscriptionGateRow = {
  id?: string;
  is_platform_admin?: boolean | null;
  subscription_status?: string | null;
  trial_starts_at?: string | null;
  trial_ends_at?: string | null;
  created_at?: string | null;
};

export function hasActiveSubscription(photographer: SubscriptionGateRow | null | undefined) {
  if (!photographer) return false;
  if (photographer.is_platform_admin) return true;
  if (isStripeBillingActive(photographer.subscription_status)) return true;
  if (isFreeTrialActive(photographer)) return true;
  return false;
}

/**
 * Fetch the photographer's subscription state and return whether their
 * galleries should be served. Returns `null` if the photographer row
 * can't be found — callers treat that the same as "not active".
 */
export async function photographerHasActiveSubscription(
  service: SupabaseClient,
  photographerId: string | null | undefined,
) {
  if (!photographerId) return false;
  const { data } = await service
    .from("photographers")
    .select(
      "id,is_platform_admin,subscription_status,trial_starts_at,trial_ends_at,created_at",
    )
    .eq("id", photographerId)
    .maybeSingle<SubscriptionGateRow>();
  return hasActiveSubscription(data);
}

type TrialAccount = {
  is_platform_admin?: boolean | null;
  stripe_subscription_id?: string | null;
  subscription_status: string;
  trial_starts_at?: string | null;
  trial_ends_at?: string | null;
};

export function buildAdminTrialChange(account: TrialAccount, action: "extend_trial" | "revoke_trial", days = 30, now = Date.now()) {
  if (account.is_platform_admin || account.stripe_subscription_id || ["active", "trialing"].includes(account.subscription_status)) {
    throw new Error("Trial actions apply only to free trial accounts. Manage paid subscriptions through billing.");
  }
  const parsedEnd = Date.parse(account.trial_ends_at ?? "");
  const end = action === "revoke_trial" ? now : Math.max(now, Number.isFinite(parsedEnd) ? parsedEnd : now) + days * 86400000;
  return {
    // Keep the supported trial status with an expired date when revoking.
    // 'inactive' is not a valid photographer subscription status.
    subscription_status: "trial",
    subscription_plan_code: "studio",
    trial_starts_at: account.trial_starts_at ?? new Date(now).toISOString(),
    trial_ends_at: new Date(end).toISOString(),
  };
}

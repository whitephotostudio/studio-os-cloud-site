export type OwnerAccount = {
  id: string; name: string; business_name: string | null; email: string | null; is_owner: boolean;
  subscription_status: string | null; subscription_plan_code: string | null; has_subscription: boolean;
  trial_starts_at: string | null; trial_ends_at: string | null; created_at: string;
  email_confirmed_at: string | null; last_sign_in_at: string | null;
  auth_missing: boolean; signup_incomplete: boolean; billing_problem: boolean; needs_attention: boolean;
  email_problems: number; payment_problems: number; recent_errors: number;
  available_keys: number; active_devices: number; last_device_seen: string | null; first_activation_at: string | null;
  gallery_count: number; first_gallery_at: string | null; photo_records: number;
  first_photo_at: string | null; last_photo_at: string | null; last_roster_sync_at: string | null; order_count: number;
};
export type OwnerSnapshot = {
  checked_at: string; page: number; page_size: number; total: number; unlinked_confirmed_accounts: number;
  unlinked_accounts: { name: string; email: string | null; email_confirmed_at: string }[];
  summary: { accounts: number; needs_attention: number; active_trials: number; active_subscriptions: number };
  accounts: OwnerAccount[];
  subscription_receipts: { currency: string; amount_cents: number; invoices: number }[];
};
export type OwnerHistory = {
  checked_at: string; page: number; has_more: boolean;
  attention_entries: OwnerHistory["entries"];
  entries: { id: string; at: string; kind: string; title: string; state: string; recipient: string | null; author: string | null; detail: string | null }[];
  devices: { device_name: string | null; platform: string | null; app_version: string | null; last_seen_at: string | null }[];
  sales: { currency: string; paid_orders: number; paid_cents: number; refunded_cents: number; pending_adjustments: number }[];
};

export function accountAttention(account: OwnerAccount): { title: string; action: string }[] {
  const items = [];
  if (account.auth_missing) items.push({ title: "Login account missing", action: "Review this profile and its login account before changing access." });
  if (account.signup_incomplete) items.push({ title: "Signup setup incomplete", action: "Email is confirmed, but trial setup is incomplete. Review access in Admin Users." });
  if (account.billing_problem) items.push({ title: `Subscription: ${account.subscription_status}`, action: "Review the subscription in Stripe and contact the photographer if payment is needed." });
  if (account.payment_problems) items.push({ title: `${account.payment_problems} payment / refund issues`, action: "Check the order and Stripe status before retrying a payment or refund." });
  if (account.email_problems) items.push({ title: `${account.email_problems} notifications need review`, action: "Review email history and the provider before retrying a notification." });
  if (account.recent_errors) items.push({ title: `${account.recent_errors} recorded errors in 7 days`, action: "Review the timeline. These events may already be resolved." });
  return items;
}

export function accountAccess(account: OwnerAccount, now = Date.now()): string {
  if (account.is_owner) return "Owner";
  if (account.signup_incomplete) return "Setup incomplete";
  if (account.has_subscription) return `Subscription · ${account.subscription_status || "unknown"}`;
  if (account.subscription_status === "trial" && account.trial_ends_at) {
    return Date.parse(account.trial_ends_at) > now ? "Trial active" : "Trial expired";
  }
  return account.subscription_status || "Access unverified";
}

export function emailState(state: string): string {
  if (state === "sent" || state === "provider_accepted") return "Sent · delivery unverified";
  if (state === "opened" || state === "clicked") return `${state} · provider reported`;
  return state.replaceAll("_", " ");
}

export function historyTitle(title: string): string {
  const labels: Record<string, string> = {
    "device.release": "Desktop device released",
    "admin.extend_trial": "Trial extended by owner",
    "admin.revoke_trial": "Trial ended by owner",
    "trial.onboarding_recovery_20260924": "Signup access restored and trial refreshed",
    "mfa.verify": "Two-factor verification",
    "roster.snapshot_write": "Roster saved",
    "order.refund": "Order refund",
  };
  if (labels[title]) return labels[title];
  const readable = title.replaceAll(/[._]/g, " ");
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

export function ownerMoney(cents: number, currency: string): string {
  try { return new Intl.NumberFormat("en-CA", { style: "currency", currency, currencyDisplay: "code" }).format(cents / 100); }
  catch { return `${currency} ${(cents / 100).toFixed(2)}`; }
}

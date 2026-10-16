import { Capacitor } from "@capacitor/core";

const blockedPaths = new Set(["/dashboard", "/pricing", "/prices", "/signup", "/sign-up", "/credits", "/dashboard/membership", "/api/stripe/billing"]);
const platformActions = new Set(["subscribe", "update_plan", "update_extra_keys", "buy_credits", "portal"]);
const platformReturns = new Set(["subscription_success", "subscription_cancel", "credits_success", "credits_cancel", "portal"]);

export function isNativeCompanion(): boolean {
  return Capacitor.getPlatform() === "ios" && Capacitor.isNativePlatform();
}

// Photographer merchant setup and customer photo-order payments use different
// routes. This policy applies only to Studio OS subscriptions and AI credits.
export function isPlatformPurchaseRoute(href: string): boolean {
  try {
    const url = new URL(href, "https://www.studiooscloud.com");
    const host = url.hostname.toLowerCase();
    if (host !== "studiooscloud.com" && !host.endsWith(".studiooscloud.com")) return false;
    let decoded = url.pathname;
    for (let count = 0; count < 3; count += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    const parts: string[] = [];
    for (const part of decoded.replace(/\\/g, "/").toLowerCase().split("/")) {
      if (part === "..") parts.pop();
      else if (part && part !== ".") parts.push(part);
    }
    const path = `/${parts.join("/")}`;
    if (blockedPaths.has(path) || [...blockedPaths].some((root) => root !== "/dashboard" && path.startsWith(`${root}/`))) return true;
    return [...url.searchParams.entries()].some(([key, value]) => key.toLowerCase() === "billing" && platformReturns.has(value.toLowerCase()));
  } catch { return true; }
}

export function nativeBillingActionBlocked(action: unknown): boolean {
  return isNativeCompanion() && typeof action === "string" && platformActions.has(action);
}

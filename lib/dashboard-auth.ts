import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient, isAuthRetryableFetchError, type AuthError } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export type DashboardAuthContext = {
  user: { id: string; email?: string | null } | null;
  mfaSatisfied?: boolean;
};

function assertAuthAvailable(error: AuthError | null) {
  if (error && (isAuthRetryableFetchError(error) || error.status == null || error.status === 429 || error.status >= 500)) {
    // An unavailable provider is not evidence that a saved session is invalid.
    throw new Error("Authentication is temporarily unavailable. Please try again.");
  }
}

/** Native clients do not send Origin; browsers must act from this exact origin. */
export function isTrustedDashboardRequest(request: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes((request.method || "GET").toUpperCase())) return true;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }
  // Fetch Metadata also catches cross-site forms when an Origin is omitted.
  const site = request.headers.get("sec-fetch-site");
  return site !== "cross-site" && site !== "same-site";
}

function requiresAdminMfaEnrollment(request: NextRequest) {
  try {
    const pathname = new URL(request.url).pathname;
    // Recovery administration belongs to an individual studio. All other
    // dashboard/admin handlers are platform-owner tools, including bookings.
    const adminPrefix = "/api/dashboard/admin";
    const recoveryPrefix = `${adminPrefix}/recovery`;
    const studioRecovery = pathname === recoveryPrefix || pathname.startsWith(`${recoveryPrefix}/`);
    return ((pathname === adminPrefix || pathname.startsWith(`${adminPrefix}/`)) && !studioRecovery) ||
      pathname === "/api/studio-os-app/admin";
  } catch {
    return false;
  }
}

function verifiedContext(user: DashboardAuthContext["user"], mfaSatisfied: boolean): DashboardAuthContext {
  // Callers must never receive an actionable user before enrolled MFA completes.
  // Keeping the denial here protects older routes that only check `user`.
  return { user: mfaSatisfied ? user : null, mfaSatisfied };
}

async function unenrolledSessionAllowed(user: DashboardAuthContext["user"], request: NextRequest, requireEnrollment: boolean) {
  if (!user) return true;
  if (requireEnrollment) return false;
  // MFA management has its own provider-authenticated enrollment/challenge API.
  // It must remain reachable before an owner has enrolled their first factor.
  if (new URL(request.url).pathname === "/api/dashboard/mfa") return true;
  const service = createDashboardServiceClient();
  const [profile, subscription] = await Promise.all([
    service.from("photographers").select("is_platform_admin").eq("user_id", user.id).maybeSingle(),
    service.from("subscriptions").select("is_admin").eq("user_id", user.id).eq("is_admin", true).limit(1).maybeSingle(),
  ]);
  if (profile.error || subscription.error) {
    throw new Error("Account security is temporarily unavailable. Please try again.");
  }
  return !profile.data?.is_platform_admin && !subscription.data?.is_admin;
}

export async function resolveDashboardAuth(
  request: NextRequest,
  options: { requireMfaEnrollment?: boolean } = {},
): Promise<DashboardAuthContext> {
  if (!isTrustedDashboardRequest(request)) return { user: null };
  const requireEnrollment = options.requireMfaEnrollment || requiresAdminMfaEnrollment(request);
  const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const authHeader = request.headers.get("authorization") || "";
  const bearer = /^Bearer\s+/i.test(authHeader) ? authHeader.replace(/^Bearer\s+/i, "").trim() : null;

  const anonClient = createSupabaseClient(supabaseUrl, anonKey);

  if (bearer) {
    const { data, error } = await anonClient.auth.getUser(bearer);
    assertAuthAvailable(error);
    if (data.user) {
      const hasMfa = data.user.factors?.some((factor) => factor.status === "verified") ?? false;
      let aal = "";
      try { aal = JSON.parse(Buffer.from(bearer.split(".")[1], "base64url").toString()).aal; } catch { /* fail closed for MFA */ }
      return verifiedContext(data.user, hasMfa ? aal === "aal2" : await unenrolledSessionAllowed(data.user, request, requireEnrollment));
    }
  }

  const cookieStore = await cookies();
  const serverClient = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      // ✅ FIX: was a no-op — tokens could never be refreshed server-side,
      // causing users to appear logged out after token expiry.
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component — safe to ignore; middleware
          // handles session refresh in that context.
        }
      },
    },
  });

  const {
    data: { user },
    error,
  } = await serverClient.auth.getUser();
  assertAuthAvailable(error);

  const hasMfa = user?.factors?.some((factor) => factor.status === "verified") ?? false;
  const { data: assurance, error: assuranceError } = hasMfa
    ? await serverClient.auth.mfa.getAuthenticatorAssuranceLevel() : { data: null, error: null };
  assertAuthAvailable(assuranceError);
  return verifiedContext(user, hasMfa ? assurance?.currentLevel === "aal2" : await unenrolledSessionAllowed(user, request, requireEnrollment));
}

export function createDashboardServiceClient() {
  return createSupabaseClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

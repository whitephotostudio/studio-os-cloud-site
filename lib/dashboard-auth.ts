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

export async function resolveDashboardAuth(
  request: NextRequest,
): Promise<DashboardAuthContext> {
  const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  const anonClient = createSupabaseClient(supabaseUrl, anonKey);

  if (bearer) {
    const { data, error } = await anonClient.auth.getUser(bearer);
    assertAuthAvailable(error);
    if (data.user) {
      const hasMfa = data.user.factors?.some((factor) => factor.status === "verified") ?? false;
      let aal = "";
      try { aal = JSON.parse(Buffer.from(bearer.split(".")[1], "base64url").toString()).aal; } catch { /* fail closed for MFA */ }
      return { user: data.user, mfaSatisfied: !hasMfa || aal === "aal2" };
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
  return { user, mfaSatisfied: !hasMfa || assurance?.currentLevel === "aal2" };
}

export function createDashboardServiceClient() {
  return createSupabaseClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

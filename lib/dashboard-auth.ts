import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export type DashboardAuthContext = {
  user: { id: string; email?: string | null } | null;
};

export async function resolveDashboardAuth(
  request: NextRequest,
): Promise<DashboardAuthContext> {
  const supabaseUrl = env("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  const anonClient = createSupabaseClient(supabaseUrl, anonKey);

  if (bearer) {
    const { data } = await anonClient.auth.getUser(bearer);
    if (data.user) {
      return { user: data.user };
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
  } = await serverClient.auth.getUser();

  return { user };
}

export function createDashboardServiceClient() {
  return createSupabaseClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

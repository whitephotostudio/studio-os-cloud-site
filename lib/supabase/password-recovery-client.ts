import { AuthClient } from "@supabase/supabase-js";
import {
  combineChunks,
  isChunkLike,
  parseCookieHeader,
  serializeCookieHeader,
  stringFromBase64URL,
} from "@supabase/ssr";

/** Recovery sessions stay in memory and never replace dashboard cookies. */
export function createPasswordRecoveryClient(allowLegacyPkce = true) {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const storageKey = `sb-${new URL(projectUrl).hostname.split(".")[0]}-auth-token`;
  const verifierKey = `${storageKey}-code-verifier`;
  const legacyPkce = allowLegacyPkce && typeof window !== "undefined" &&
    new URL(window.location.href).searchParams.has("code");
  const memory = new Map<string, string>();
  const legacyStorage = {
    async getItem(key: string) {
      if (memory.has(key)) return memory.get(key)!;
      if (key !== verifierKey || typeof document === "undefined") return null;
      const cookies = parseCookieHeader(document.cookie);
      const value = await combineChunks(key, async (name) =>
        cookies.find((cookie) => cookie.name === name)?.value ?? null,
      );
      return value?.startsWith("base64-")
        ? stringFromBase64URL(value.slice(7))
        : value;
    },
    setItem(key: string, value: string) { memory.set(key, value); },
    removeItem(key: string) {
      memory.delete(key);
      if (key !== verifierKey || typeof document === "undefined") return;
      for (const cookie of parseCookieHeader(document.cookie)) {
        if (isChunkLike(cookie.name, key)) {
          document.cookie = serializeCookieHeader(cookie.name, "", {
            path: "/", maxAge: 0, sameSite: "lax",
          });
        }
      }
    },
  };

  // SSR forces PKCE and the Supabase wrapper drops skipAutoInitialize. Use
  // the public AuthClient directly so the page subscribes before verification.
  // Old website PKCE links may read/remove only their original verifier;
  // neither path reads or persists an existing dashboard session.
  return {
    auth: new AuthClient({
      url: `${projectUrl}/auth/v1`,
      headers: { apikey: publicKey, Authorization: `Bearer ${publicKey}` },
      storageKey,
      flowType: legacyPkce ? "pkce" : "implicit",
      persistSession: legacyPkce,
      ...(legacyPkce ? { storage: legacyStorage } : {}),
      autoRefreshToken: false,
      detectSessionInUrl: true,
      skipAutoInitialize: true,
    }),
  };
}

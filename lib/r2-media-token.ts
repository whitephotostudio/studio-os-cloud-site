import { createHmac, timingSafeEqual } from "node:crypto";
import { isServerOnlyR2Key, normalizeR2Key } from "@/lib/r2-access-security";

const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function secret() {
  const value = process.env.R2_MEDIA_TOKEN_SECRET || process.env.DOWNLOAD_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error("Private photo authorization is unavailable.");
  return value;
}
function signature(encoded: string) {
  return createHmac("sha256", secret()).update(`studio-os-r2-media-v1:${encoded}`).digest();
}

/** A capability does not grant storage access until the gateway checks its owner. */
export function signedR2MediaUrl(key: string, ttlSeconds: number, photographerId: string | null | undefined) {
  const safe = normalizeR2Key(key, { allowQueryCharacters: true });
  if (!safe || isServerOnlyR2Key(safe) || !photographerId || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return "";
  const encoded = Buffer.from(JSON.stringify({ v: 1, key: safe, photographerId, exp: Date.now() + Math.min(ttlSeconds * 1000, MAX_TTL_MS) })).toString("base64url");
  const token = `${encoded}.${signature(encoded).toString("base64url")}`;
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.SITE_URL || "https://www.studiooscloud.com";
  return `${new URL(configured).origin}/api/r2/img/${safe.split("/").map(encodeURIComponent).join("/")}?mediaToken=${encodeURIComponent(token)}`;
}

export function verifyR2MediaToken(token: string, expectedKey: string): string | null {
  const [encoded, supplied, extra] = token.split(".");
  if (!encoded || !supplied || extra || encoded.length > 4096 || supplied.length > 64) return null;
  const digest = signature(encoded), actual = Buffer.from(supplied, "base64url");
  if (actual.length !== digest.length || !timingSafeEqual(actual, digest)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return payload.v === 1 && payload.key === expectedKey && typeof payload.photographerId === "string" && !!payload.photographerId &&
      Number.isFinite(payload.exp) && payload.exp > Date.now() && payload.exp <= Date.now() + MAX_TTL_MS
      ? payload.photographerId : null;
  } catch { return null; }
}

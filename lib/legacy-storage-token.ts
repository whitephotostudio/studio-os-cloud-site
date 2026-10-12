import { createHmac, timingSafeEqual } from "node:crypto";
import { legacyStorageProxyUrl, legacyStorageReference, type LegacyPrivateStorageReference } from "@/lib/photo-url";

function secret() {
  const value = process.env.LEGACY_STORAGE_TOKEN_SECRET || process.env.DOWNLOAD_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error("Legacy media signing is unavailable.");
  return value;
}
function signature(encoded: string) {
  return createHmac("sha256", secret()).update(`studio-os-legacy-storage-v1:${encoded}`).digest();
}

/** Called only after the enclosing server workflow has authorized its media. */
export function signedLegacyStorageUrl(reference: LegacyPrivateStorageReference, ttlSeconds: number, photographerId: string | null | undefined) {
  const safe = legacyStorageReference(reference.bucket, reference.key);
  if (!safe || !photographerId || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return "";
  const encoded = Buffer.from(JSON.stringify({ v: 1, ...safe, photographerId, exp: Date.now() + Math.min(ttlSeconds, 7 * 24 * 60 * 60) * 1000 })).toString("base64url");
  const token = `${encoded}.${signature(encoded).toString("base64url")}`;
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.SITE_URL || "https://www.studiooscloud.com";
  return `${new URL(configured).origin}${legacyStorageProxyUrl(safe)}?token=${encodeURIComponent(token)}`;
}

export function verifyLegacyStorageToken(token: string, expected: LegacyPrivateStorageReference) {
  const [encoded, supplied, extra] = token.split(".");
  if (!encoded || !supplied || extra || encoded.length > 4096) return false;
  const actual = Buffer.from(supplied, "base64url"), digest = signature(encoded);
  if (actual.length !== digest.length || !timingSafeEqual(actual, digest)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return payload.v === 1 && payload.bucket === expected.bucket && payload.key === expected.key &&
      typeof payload.photographerId === "string" && !!payload.photographerId &&
      Number.isFinite(payload.exp) && payload.exp > Date.now() && payload.exp <= Date.now() + 7 * 24 * 60 * 60 * 1000
      ? payload.photographerId as string : null;
  } catch { return false; }
}

import {
  r2KeyFromAnyUrl,
} from "@/lib/r2-signed-urls";
import { privateSupabaseStorageReference } from "@/lib/photo-url";
import { signedLegacyStorageUrl } from "@/lib/legacy-storage-token";
import { signedR2MediaUrl } from "@/lib/r2-media-token";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function isBareMediaKey(value: string) {
  return (
    !!value &&
    !value.startsWith("/") &&
    !/^[a-z][a-z0-9+.-]*:\/\//i.test(value) &&
    value.includes("/") &&
    /\.(png|jpe?g|webp|gif|avif|heic|heif|tiff?)(?:[?#].*)?$/i.test(value)
  );
}

function isRecognizedR2Reference(value: string) {
  if (isBareMediaKey(value) || value.startsWith("/api/r2/img/")) return true;

  try {
    const parsed = new URL(value);
    return (
      parsed.pathname.startsWith("/api/r2/img/") ||
      /\.r2\.dev$/i.test(parsed.host) ||
      /\.r2\.cloudflarestorage\.com$/i.test(parsed.host)
    );
  } catch {
    return false;
  }
}

function safeR2Key(value: string) {
  if (!isRecognizedR2Reference(value)) return "";
  const key = r2KeyFromAnyUrl(value)
    .replace(/^\/+/, "")
    .split("?")[0]
    .split("#")[0];
  if (
    !key ||
    key.includes("..") ||
    key.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(key)
  ) {
    return "";
  }
  return key;
}

export function privateMediaKeyFromReference(
  input: string | null | undefined,
) {
  const raw = clean(input);
  return raw ? safeR2Key(raw) : "";
}

/**
 * Convert any recognized historical/private R2 reference to its durable key.
 * External HTTPS and Supabase references retain their durable stored form.
 */
export function durablePrivateMediaReference(
  input: string | null | undefined,
) {
  const raw = clean(input);
  if (!raw) return "";
  return safeR2Key(raw) || raw;
}

/**
 * Resolve private R2 or legacy Supabase references to authorized, expiring reads.
 * Legacy Supabase capabilities require the enclosing workflow tenant.
 * External HTTPS and intentionally public brand/backdrop assets are unchanged.
 */
export function signedPrivateMediaReference(
  input: string | null | undefined,
  ttlSeconds: number,
  photographerId?: string | null,
) {
  const raw = clean(input);
  if (!raw) return "";
  const legacy = privateSupabaseStorageReference(raw);
  if (legacy) return signedLegacyStorageUrl(legacy, ttlSeconds, photographerId);
  const key = safeR2Key(raw);
  if (!key) return raw;
  return photographerId
    ? signedR2MediaUrl(key, ttlSeconds, photographerId)
    : `/api/r2/img/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Clone JSON-compatible data and refresh recognized private media references.
 * Strict media-key recognition prevents ordinary labels, IDs, or notes from
 * being treated as storage paths.
 */
export function signPrivateMediaReferencesDeep<T>(
  value: T,
  ttlSeconds: number,
  photographerId?: string | null,
): T {
  if (typeof value === "string") {
    return signedPrivateMediaReference(value, ttlSeconds, photographerId) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      signPrivateMediaReferencesDeep(item, ttlSeconds, photographerId),
    ) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        signPrivateMediaReferencesDeep(item, ttlSeconds, photographerId),
      ]),
    ) as T;
  }
  return value;
}

export function signPhotoUrlRows<T extends { photo_url?: string | null }>(
  rows: T[],
  ttlSeconds: number,
  photographerId?: string | null,
) {
  return rows.map((row) => ({
    ...row,
    photo_url: signedPrivateMediaReference(row.photo_url, ttlSeconds, photographerId) || null,
  }));
}

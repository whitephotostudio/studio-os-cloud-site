// Client-safe helpers for recognizing Studio OS photo-storage URLs.
//
// Photos are stored in S3-compatible object storage. Historically that was a
// single Cloudflare R2 bucket; photographers can now be homed in a regional
// bucket (Backblaze B2 Canada/US, Wasabi UK/Australia, or AWS S3) so their
// photos stay in their own country. Nothing in this module reads env vars or
// Node APIs, so it can be imported from browser components as well as the
// server. The server-side registry lives in `@/lib/storage-regions`.

/** Hosts of every storage provider Studio OS can be configured with. */
const KNOWN_STORAGE_HOST_PATTERN =
  /(^|\.)(r2\.cloudflarestorage\.com|r2\.dev|backblazeb2\.com|wasabisys\.com|amazonaws\.com)$/i;

/** Legacy public R2 development hosts (`pub-<id>.r2.dev`). */
const LEGACY_PUBLIC_R2_HOST_PATTERN = /\.r2\.dev$/i;

export function isKnownStorageHost(host: string | null | undefined) {
  const value = (host ?? "").trim().toLowerCase();
  return !!value && KNOWN_STORAGE_HOST_PATTERN.test(value);
}

export function isLegacyPublicStorageHost(host: string | null | undefined) {
  const value = (host ?? "").trim().toLowerCase();
  return !!value && LEGACY_PUBLIC_R2_HOST_PATTERN.test(value);
}

/**
 * Whether a storage host addresses the bucket in the path (`host/bucket/key`)
 * rather than as a sub-domain (`bucket.host/key`).
 *
 * - Backblaze, Wasabi and AWS path-style endpoints start with `s3.`
 *   (`s3.ca-east-006.backblazeb2.com`); a bucket sub-domain adds a label in
 *   front of that.
 * - Cloudflare R2 path-style endpoints are `<account>.r2.cloudflarestorage.com`
 *   (four labels); a bucket sub-domain makes five.
 */
export function isPathStyleStorageHost(host: string | null | undefined) {
  const value = (host ?? "").trim().toLowerCase();
  if (!value || !isKnownStorageHost(value) || isLegacyPublicStorageHost(value)) return false;
  if (/\.r2\.cloudflarestorage\.com$/.test(value)) return value.split(".").length === 4;
  return value.startsWith("s3.");
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Extract the object key from a direct storage URL (signed or legacy public).
 * Returns "" for URLs that are not on a known storage host, so callers can
 * fall back to their own handling of custom domains or bare keys.
 */
export function storageKeyFromUrl(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
  if (!isKnownStorageHost(parsed.host)) return "";
  const path = parsed.pathname.replace(/^\/+/, "");
  if (!path) return "";
  if (isLegacyPublicStorageHost(parsed.host)) return safeDecode(path);
  if (isPathStyleStorageHost(parsed.host)) {
    const slash = path.indexOf("/");
    return slash >= 0 ? safeDecode(path.slice(slash + 1)) : "";
  }
  return safeDecode(path);
}

/**
 * Whether a URL points at a direct (presigned/expiring) storage object. Such
 * URLs must never be stored durably; callers convert them back to a key.
 */
export function isDirectStorageUrl(value: string | null | undefined) {
  const raw = (value ?? "").trim();
  if (!/^https?:\/\//i.test(raw)) return false;
  try {
    const host = new URL(raw).host;
    return isKnownStorageHost(host) && !isLegacyPublicStorageHost(host);
  } catch {
    return false;
  }
}

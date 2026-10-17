// Shared photo-URL helper for the mobile (/m) pages.
//
// Studio OS photos live in S3-compatible storage (Cloudflare R2 originally, now
// regional Backblaze B2 / Wasabi / AWS buckets). The OLD public host
// (pub-*.r2.dev) is dead, and direct bucket URLs are signed/expiring.
// So — exactly like the desktop dashboard — we route every image through the
// same-origin proxy /api/r2/img/<key>, which serves the object reliably.

// NOTE: this file is imported directly by Node test files, so it must stay
// free of path-alias imports. The storage host rules mirror lib/storage-hosts.ts.
const KNOWN_STORAGE_HOST_PATTERN =
  /(^|\.)(r2\.cloudflarestorage\.com|r2\.dev|backblazeb2\.com|wasabisys\.com|amazonaws\.com)$/i;

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Object key of a direct storage URL (legacy public or signed bucket URL). */
function storageKeyFromUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "";
  }
  const host = parsed.host.toLowerCase();
  if (!KNOWN_STORAGE_HOST_PATTERN.test(host)) return "";
  const path = parsed.pathname.replace(/^\/+/, "");
  if (!path) return "";
  if (/\.r2\.dev$/.test(host)) return safeDecode(path);
  // Path-style endpoints (<account>.r2.cloudflarestorage.com, s3.<region>.<provider>)
  // carry the bucket as the first path segment; bucket sub-domains do not.
  const pathStyle = /\.r2\.cloudflarestorage\.com$/.test(host) ? host.split(".").length === 4 : host.startsWith("s3.");
  if (!pathStyle) return safeDecode(path);
  const slash = path.indexOf("/");
  return slash >= 0 ? safeDecode(path.slice(slash + 1)) : "";
}
export const LEGACY_PRIVATE_STORAGE_BUCKETS = ["photos", "thumbs", "nobg-photos"] as const;
export type LegacyPrivateStorageReference = { bucket: typeof LEGACY_PRIVATE_STORAGE_BUCKETS[number]; key: string };

export function legacyStorageReference(bucket: string, key: string): LegacyPrivateStorageReference | null {
  if (!(LEGACY_PRIVATE_STORAGE_BUCKETS as readonly string[]).includes(bucket) || !key || key.length > 1024 ||
      /[\\\u0000-\u001f\u007f]/.test(key) || key.split("/").some(part => !part || part === "." || part === "..")) return null;
  return { bucket: bucket as LegacyPrivateStorageReference["bucket"], key };
}

/** Only our configured Supabase origin and student-media buckets qualify. */
export function privateSupabaseStorageReference(value: string | null | undefined): LegacyPrivateStorageReference | null {
  try {
    const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!configured) return null;
    const source = new URL((value ?? "").trim()), expected = new URL(configured);
    if (source.origin !== expected.origin || !["https:", "http:"].includes(source.protocol)) return null;
    const match = source.pathname.match(/^\/storage\/v1\/(?:object|render\/image)\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
    return match ? legacyStorageReference(decodeURIComponent(match[1]), decodeURIComponent(match[2])) : null;
  } catch { return null; }
}

export function legacyStorageProxyUrl(reference: LegacyPrivateStorageReference): string {
  const safe = legacyStorageReference(reference.bucket, reference.key);
  if (!safe) return "";
  return `/api/storage/legacy-media/${safe.bucket}/${safe.key.split("/").map(encodeURIComponent).join("/")}`;
}

function encodeStoragePath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
    .join("/");
}

function r2KeyFromBrowserUrl(url: string): string {
  try {
    const parsed = new URL(
      url,
      typeof window === "undefined"
        ? "https://www.studiooscloud.com"
        : window.location.origin,
    );
    if (parsed.pathname.startsWith("/api/r2/img/")) {
      return decodeURIComponent(parsed.pathname.slice("/api/r2/img/".length));
    }
    const storageKey = storageKeyFromUrl(parsed.href);
    if (storageKey) return storageKey;
  } catch {
    return "";
  }
  return "";
}

function isWebImageUrl(url: string): boolean {
  return /\.(png|jpe?g|webp|gif|avif)(?:[?#].*)?$/i.test(url);
}

function encodeExternalImageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.pathname = parsed.pathname
      .split("/")
      .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
      .join("/");
    return parsed.toString();
  } catch {
    return url.replace(/ /g, "%20");
  }
}

/** Convert any stored photo URL or storage key into a working same-origin image
 *  src. Returns "" when there is nothing usable. */
export function proxiedPhotoUrl(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("/api/storage/legacy-media/")) return raw;
  // Workflow capabilities must survive display normalization, including when
  // an email/parent response supplies an absolute gateway URL.
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      if (parsed.pathname.startsWith("/api/r2/img/") || parsed.pathname.startsWith("/api/storage/legacy-media/")) {
        return `${parsed.pathname}${parsed.search}`;
      }
    } catch { return ""; }
  }
  const legacy = privateSupabaseStorageReference(raw);
  if (legacy) return legacyStorageProxyUrl(legacy);
  if (raw.startsWith("/api/r2/img/")) return raw;
  if (!/^https?:\/\//i.test(raw)) {
    const key = raw.replace(/^\/+/, "");
    return isWebImageUrl(key) ? `/api/r2/img/${encodeStoragePath(key)}` : "";
  }
  const key = r2KeyFromBrowserUrl(raw);
  if (key) return `/api/r2/img/${encodeStoragePath(key)}`;
  return isWebImageUrl(raw) ? encodeExternalImageUrl(raw) : "";
}

// Shared photo-URL helper for the mobile (/m) pages.
//
// Studio OS photos live in Cloudflare R2. The OLD public host (pub-*.r2.dev) is
// dead, and direct bucket URLs (*.r2.cloudflarestorage.com) are signed/expiring.
// So — exactly like the desktop dashboard — we route every image through the
// same-origin proxy /api/r2/img/<key>, which serves the object reliably.

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
    if (/\.r2\.dev$/i.test(parsed.host)) {
      return decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    }
    if (/\.r2\.cloudflarestorage\.com$/i.test(parsed.host)) {
      const stripped = parsed.pathname.replace(/^\/+/, "");
      const slash = stripped.indexOf("/");
      return slash >= 0 ? decodeURIComponent(stripped.slice(slash + 1)) : "";
    }
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

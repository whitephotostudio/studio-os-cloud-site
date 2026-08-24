// Shared photo-URL helper for the mobile (/m) pages.
//
// Studio OS photos live in Cloudflare R2. The OLD public host (pub-*.r2.dev) is
// dead, and direct bucket URLs (*.r2.cloudflarestorage.com) are signed/expiring.
// So — exactly like the desktop dashboard — we route every image through the
// same-origin proxy /api/r2/img/<key>, which serves the object reliably.

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
  if (raw.startsWith("/api/r2/img/")) return raw;
  if (!/^https?:\/\//i.test(raw)) {
    const key = raw.replace(/^\/+/, "");
    return isWebImageUrl(key) ? `/api/r2/img/${encodeStoragePath(key)}` : "";
  }
  const key = r2KeyFromBrowserUrl(raw);
  if (key) return `/api/r2/img/${encodeStoragePath(key)}`;
  return isWebImageUrl(raw) ? encodeExternalImageUrl(raw) : "";
}

/** Add a stable display revision to same-origin proxy URLs without changing
 * the durable R2 reference saved in the database. External image URLs are
 * intentionally left alone. */
export function versionedProxiedPhotoUrl(
  value: string | null | undefined,
  revision: string,
): string {
  const url = proxiedPhotoUrl(value);
  const cleanRevision = revision.trim();
  if (!url.startsWith("/api/r2/img/") || !cleanRevision) return url;

  const parsed = new URL(url, "https://www.studiooscloud.com");
  parsed.searchParams.set("v", cleanRevision);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

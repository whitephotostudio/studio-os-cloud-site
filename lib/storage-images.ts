import { r2KeyFromAnyUrl } from "@/lib/storage-hosts";
import { legacyStorageProxyUrl, privateSupabaseStorageReference } from "@/lib/photo-url";
import { signedLegacyStorageUrl } from "@/lib/legacy-storage-token";
import { signedR2MediaUrl } from "@/lib/r2-media-token";

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const R2_PUBLIC_URL = (
  process.env.NEXT_PUBLIC_R2_PUBLIC_URL ||
  process.env.R2_PUBLIC_URL ||
  ""
).replace(/\/$/, "");

export const MEDIA_BUCKET = "thumbs";

// 2026-04-30 — Default TTLs for buildSignedMediaUrls().  Dashboard
// views are short (photographer is actively browsing); parents
// portal sessions stay open for hours during shopping/checkout.
export const SIGNED_URL_TTL_DASHBOARD_SECONDS = 60 * 60;
export const SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS = 60 * 60 * 6;

type ResizeMode = "cover" | "contain" | "fill";

type TransformOptions = {
  width?: number;
  height?: number;
  quality?: number;
  resize?: ResizeMode;
};

type StoredMediaInput = {
  storagePath?: string | null;
  previewUrl?: string | null;
  thumbnailUrl?: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function isBareMediaKey(value: string) {
  return (
    !!value &&
    !value.startsWith("/") &&
    !/^[a-z][a-z0-9+.-]*:\/\//i.test(value) &&
    /\.(png|jpe?g|webp|gif|avif|heic|heif|tiff?)(?:[?#].*)?$/i.test(value)
  );
}

function browserUrlForStoredReference(
  value: string | null | undefined,
  bucket: string,
) {
  const candidate = clean(value);
  if (!candidate) return "";
  const legacy = privateSupabaseStorageReference(candidate);
  if (legacy) return legacyStorageProxyUrl(legacy);
  return isBareMediaKey(candidate)
    ? publicStorageUrl(candidate.split("?")[0].split("#")[0], bucket)
    : candidate;
}

function encodeStoragePath(path: string) {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildQueryString(options: TransformOptions) {
  const params = new URLSearchParams();

  if (options.width) params.set("width", String(options.width));
  if (options.height) params.set("height", String(options.height));
  if (options.quality) params.set("quality", String(options.quality));
  if (options.resize) params.set("resize", options.resize);

  const query = params.toString();
  return query ? `?${query}` : "";
}

export function publicStorageUrl(
  storagePath: string | null | undefined,
  bucket = MEDIA_BUCKET,
) {
  const safePath = clean(storagePath);
  if (!safePath) return "";
  const legacy = privateSupabaseStorageReference(safePath);
  if (legacy) return legacyStorageProxyUrl(legacy);
  // 2026-04-30 — Route through the auth-gated /api/r2/img redirect
  // endpoint instead of the dead R2 public URL.  The endpoint signs
  // the request server-side and 302s to a short-lived signed URL, so
  // photographers see images on client-rendered pages without ever
  // exposing the R2 secret in the browser bundle.  Server-side render
  // paths use owner-bound workflow capabilities through the same gateway.
  //
  // Studio logos are intentionally public Supabase assets. R2 backdrops use
  // the `backdrops/<photographerId>/...` namespace and must go through the
  // authenticated proxy like every other private R2 object.
  if (safePath.startsWith("studio-logos/")) {
    if (!SUPABASE_URL) return "";
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${encodeStoragePath(safePath)}`;
  }
  return `/api/r2/img/${encodeStoragePath(safePath)}`;
}

/**
 * Rewrite any Supabase Image Transformation URL (/storage/v1/render/image/...)
 * into the raw public object URL (/storage/v1/object/...), stripping any
 * transform query string (width, quality, resize, etc.).  Safe for non-
 * transform URLs — passes them through unchanged.
 *
 * Each unique transform URL counts against the plan's Image Transformation
 * quota, so every ingestion point that stores a URL must route it through
 * this helper.
 */
export function normalizeStorageUrl(url: string | null | undefined) {
  const candidate = clean(url);
  if (!candidate) return "";

  // Fast path: no render/image segment and no query string → unchanged.
  if (!candidate.includes("/render/image/") && !candidate.includes("?")) {
    return candidate;
  }

  try {
    const parsed = new URL(candidate);
    parsed.search = "";
    parsed.hash = "";
    if (parsed.pathname.includes("/storage/v1/render/image/public/")) {
      parsed.pathname = parsed.pathname.replace(
        "/storage/v1/render/image/public/",
        "/storage/v1/object/public/",
      );
    }
    return parsed.toString();
  } catch {
    // Fall back to a string-level rewrite for malformed inputs.
    const withoutQuery = candidate.split("?")[0].split("#")[0];
    return withoutQuery.replace(
      "/storage/v1/render/image/public/",
      "/storage/v1/object/public/",
    );
  }
}

export function extractStoragePathFromSupabaseUrl(
  url: string | null | undefined,
  bucket = MEDIA_BUCKET,
) {
  const candidate = clean(url);
  if (!candidate) return null;

  if (isBareMediaKey(candidate)) {
    return decodeURIComponent(candidate.split("?")[0].split("#")[0]);
  }

  const authenticatedR2Marker = "/api/r2/img/";
  if (candidate.startsWith(authenticatedR2Marker)) {
    const nextPath = candidate
      .slice(authenticatedR2Marker.length)
      .split("?")[0]
      .split("#")[0];
    if (nextPath) return decodeURIComponent(nextPath);
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.pathname.startsWith(authenticatedR2Marker)) {
      const nextPath = parsed.pathname.slice(authenticatedR2Marker.length);
      if (nextPath) return decodeURIComponent(nextPath);
    }
  } catch {
    // Relative proxy URLs are handled above; continue with legacy shapes.
  }

  if (R2_PUBLIC_URL && candidate.startsWith(`${R2_PUBLIC_URL}/`)) {
    try {
      const parsed = new URL(candidate);
      return decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    } catch {
      return decodeURIComponent(candidate.slice(R2_PUBLIC_URL.length + 1));
    }
  }

  const markers = [
    `/storage/v1/object/public/${bucket}/`,
    `/storage/v1/object/sign/${bucket}/`,
    `/storage/v1/render/image/public/${bucket}/`,
  ];

  for (const marker of markers) {
    const markerIndex = candidate.indexOf(marker);
    if (markerIndex === -1) continue;

    const nextPath = candidate.slice(markerIndex + marker.length).split("?")[0].split("#")[0];
    if (!nextPath) continue;
    return decodeURIComponent(nextPath);
  }

  try {
    const parsed = new URL(candidate);
    const pathname = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    if (pathname && /\.(png|jpe?g|webp|gif|avif)$/i.test(pathname)) {
      return pathname;
    }
  } catch {
    // Ignore invalid URLs.
  }

  return null;
}

export function isOriginalStorageUrl(
  url: string | null | undefined,
  bucket = MEDIA_BUCKET,
) {
  const candidate = clean(url);
  return !!candidate && (
    candidate.includes(`/storage/v1/object/public/${bucket}/`) ||
    (R2_PUBLIC_URL ? candidate.startsWith(`${R2_PUBLIC_URL}/`) : false)
  );
}

export function buildStoredMediaUrls(
  input: StoredMediaInput,
  bucket = MEDIA_BUCKET,
) {
  const storagePath = clean(input.storagePath);
  const originalUrl = publicStorageUrl(storagePath, bucket);

  const existingThumbnailUrl = browserUrlForStoredReference(
    input.thumbnailUrl,
    bucket,
  );
  const existingPreviewUrl = browserUrlForStoredReference(
    input.previewUrl,
    bucket,
  );

  // Use pre-generated thumbnails if they exist; otherwise fall back to the
  // original public URL.  We no longer generate Supabase transform URLs
  // (/render/image/) because each unique transform counts against the
  // plan's Image Transformations quota.
  const thumbnailUrl =
    existingThumbnailUrl && existingThumbnailUrl !== originalUrl && !isOriginalStorageUrl(existingThumbnailUrl, bucket)
      ? existingThumbnailUrl
      : originalUrl;

  const previewUrl =
    existingPreviewUrl && existingPreviewUrl !== originalUrl && !isOriginalStorageUrl(existingPreviewUrl, bucket)
      ? existingPreviewUrl
      : originalUrl;

  return {
    originalUrl,
    previewUrl: previewUrl || thumbnailUrl || originalUrl,
    thumbnailUrl: thumbnailUrl || previewUrl || originalUrl,
  };
}

/**
 * 2026-04-30 — Signed-URL variant of buildStoredMediaUrls.  Use this
 * for gallery images on R2 (the public dev URL is dead).  Returns
 * time-limited presigned GET URLs derived from `storage_path`
 * (preferred) or falling back to the legacy preview_url/thumbnail_url
 * if storage_path is empty.
 *
 * SERVER-SIDE ONLY.  Never import from a client component — the
 * capability signer reads server-only secrets. Galleries should call this
 * inside their server-component data layer or API route, then send
 * the resolved URLs to the client.
 *
 * Behaviour:
 * - Original key: `<storage_path>` (if it ends in .jpg) or derived
 *   from filename pattern.
 * - Preview key:  `<basename>_preview.jpg`
 * - Thumbnail key: `<basename>_thumbnail.jpg`
 * - Each URL binds the workflow owner and supplied TTL; the gateway checks
 *   retained namespace ownership before signing native storage access.
 *
 * Empty inputs yield empty strings (graceful fallback for legacy
 * rows that never got a storage_path written).
 */
export function buildSignedMediaUrls(
  input: StoredMediaInput,
  options?: { ttlSeconds?: number; deriveDerivatives?: boolean; photographerId?: string | null },
) {
  const ttl = options?.ttlSeconds ?? SIGNED_URL_TTL_DASHBOARD_SECONDS;
  const deriveDerivatives = options?.deriveDerivatives !== false;
  const authorizedRead = (key: string) => options?.photographerId
    ? signedR2MediaUrl(key, ttl, options.photographerId)
    : `/api/r2/img/${encodeStoragePath(key)}`;
  const legacyUrl = (value: string | null | undefined) => {
    const reference = privateSupabaseStorageReference(value);
    if (!reference) return "";
    return options?.photographerId
      ? signedLegacyStorageUrl(reference, ttl, options.photographerId)
      : legacyStorageProxyUrl(reference);
  };
  const legacyOriginal = legacyUrl(input.storagePath);
  const legacyPreview = legacyUrl(input.previewUrl);
  const legacyThumbnail = legacyUrl(input.thumbnailUrl);
  if (legacyOriginal || (!clean(input.storagePath) && (legacyPreview || legacyThumbnail))) {
    const originalUrl = legacyOriginal || legacyPreview || legacyThumbnail;
    return {
      originalUrl,
      previewUrl: legacyPreview || legacyOriginal || legacyThumbnail,
      thumbnailUrl: legacyThumbnail || legacyPreview || legacyOriginal,
    };
  }

  // Prefer storage_path; fall back to extracting key from a stored
  // legacy URL.  Both lead to the same key shape for R2 objects
  // uploaded by the desktop.
  const rawKey =
    clean(input.storagePath) ||
    r2KeyFromAnyUrl(input.previewUrl) ||
    r2KeyFromAnyUrl(input.thumbnailUrl);

  if (!rawKey) {
    return { originalUrl: "", previewUrl: "", thumbnailUrl: "" };
  }

  if (!deriveDerivatives) {
    const originalUrl = authorizedRead(rawKey);
    return {
      originalUrl,
      previewUrl: originalUrl,
      thumbnailUrl: originalUrl,
    };
  }

  // Normalize: original key should end in .jpg.  Some legacy rows
  // pointed at _preview.jpg / _thumbnail.jpg in storage_path, which
  // we don't want to use as the original.
  const cleaned = rawKey.replace(/_(preview|thumbnail)\.[^.]+$/i, ".jpg");
  const baseNoExt = cleaned.replace(/\.[^./]+$/i, "");

  const originalKey = `${baseNoExt}.jpg`;
  const previewKey = `${baseNoExt}_preview.jpg`;
  const thumbnailKey = `${baseNoExt}_thumbnail.jpg`;

  return {
    originalUrl: authorizedRead(originalKey),
    previewUrl: legacyPreview || authorizedRead(previewKey),
    thumbnailUrl: legacyThumbnail || authorizedRead(thumbnailKey),
  };
}

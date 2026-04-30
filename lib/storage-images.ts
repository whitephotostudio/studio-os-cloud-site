import { r2PresignedGetUrl, r2KeyFromAnyUrl } from "./r2-signed-urls";

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
  if (R2_PUBLIC_URL) return `${R2_PUBLIC_URL}/${encodeStoragePath(safePath)}`;
  if (!SUPABASE_URL) return "";
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${encodeStoragePath(safePath)}`;
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

  const existingThumbnailUrl = clean(input.thumbnailUrl);
  const existingPreviewUrl = clean(input.previewUrl);

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
 * presigner reads R2 secret env vars.  Galleries should call this
 * inside their server-component data layer or API route, then send
 * the resolved URLs to the client.
 *
 * Behaviour:
 * - Original key: `<storage_path>` (if it ends in .jpg) or derived
 *   from filename pattern.
 * - Preview key:  `<basename>_preview.jpg`
 * - Thumbnail key: `<basename>_thumbnail.jpg`
 * - Each URL is signed with the supplied TTL.
 *
 * Empty inputs yield empty strings (graceful fallback for legacy
 * rows that never got a storage_path written).
 */
export function buildSignedMediaUrls(
  input: StoredMediaInput,
  options?: { ttlSeconds?: number },
) {
  const ttl = options?.ttlSeconds ?? SIGNED_URL_TTL_DASHBOARD_SECONDS;

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

  // Normalize: original key should end in .jpg.  Some legacy rows
  // pointed at _preview.jpg / _thumbnail.jpg in storage_path, which
  // we don't want to use as the original.
  const cleaned = rawKey.replace(/_(preview|thumbnail)\.[^.]+$/i, ".jpg");
  const baseNoExt = cleaned.replace(/\.[^./]+$/i, "");

  const originalKey = `${baseNoExt}.jpg`;
  const previewKey = `${baseNoExt}_preview.jpg`;
  const thumbnailKey = `${baseNoExt}_thumbnail.jpg`;

  return {
    originalUrl: r2PresignedGetUrl(originalKey, ttl),
    previewUrl: r2PresignedGetUrl(previewKey, ttl),
    thumbnailUrl: r2PresignedGetUrl(thumbnailKey, ttl),
  };
}

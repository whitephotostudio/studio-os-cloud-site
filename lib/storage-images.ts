const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");

export const MEDIA_BUCKET = "thumbs";

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
  if (!SUPABASE_URL || !safePath) return "";
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${encodeStoragePath(safePath)}`;
}

export function transformedStorageUrl(
  storagePath: string | null | undefined,
  options: TransformOptions,
  bucket = MEDIA_BUCKET,
) {
  const safePath = clean(storagePath);
  if (!SUPABASE_URL || !safePath) return "";
  return `${SUPABASE_URL}/storage/v1/render/image/public/${bucket}/${encodeStoragePath(safePath)}${buildQueryString(options)}`;
}

export function extractStoragePathFromSupabaseUrl(
  url: string | null | undefined,
  bucket = MEDIA_BUCKET,
) {
  const candidate = clean(url);
  if (!candidate) return null;

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

  return null;
}

export function isOriginalStorageUrl(
  url: string | null | undefined,
  bucket = MEDIA_BUCKET,
) {
  const candidate = clean(url);
  return !!candidate && candidate.includes(`/storage/v1/object/public/${bucket}/`);
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

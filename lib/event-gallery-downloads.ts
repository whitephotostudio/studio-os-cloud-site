export type EventGalleryDownloadResolution = "original" | "large" | "web";

export type EventGalleryDownloadBatch = {
  id: string;
  label: string;
  fileName: string;
  photoCount: number;
  token: string;
};

export type EventGalleryDownloadManifest = {
  id: string;
  galleryName: string;
  archiveBaseName: string;
  requestedPhotoCount: number;
  photoCount: number;
  batchCount: number;
  createdAt: string;
  expiresAt: string;
  downloadsUsed: number;
  downloadsRemaining: number | null;
  batches: EventGalleryDownloadBatch[];
  returnUrl?: string;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

export function buildArchiveBaseName(value: string | null | undefined, fallback: string) {
  const cleaned = clean(value)
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

export function galleryZipBatchSize(
  resolution: EventGalleryDownloadResolution,
  applyWatermark: boolean,
) {
  const baseSize =
    resolution === "original"
      ? 32
      : resolution === "large"
        ? 48
        : 72;
  return applyWatermark ? Math.max(18, baseSize - 10) : baseSize;
}

export function splitIntoBatches<T>(values: T[], batchSize: number) {
  const safeBatchSize = Math.max(1, Math.floor(batchSize) || 1);
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += safeBatchSize) {
    batches.push(values.slice(index, index + safeBatchSize));
  }
  return batches;
}

export function eventGalleryDownloadManifestStorageKey(manifestId: string) {
  const safeManifestId = clean(manifestId);
  return safeManifestId ? `event-gallery-download-manifest:${safeManifestId}` : "";
}

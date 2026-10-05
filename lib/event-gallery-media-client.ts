// Browser-safe helpers: display URLs are never delivery authorization or order identity.
export type EventPhotoReference = {
  id: string; storagePath?: string | null; url: string; previewUrl?: string | null;
  thumbnailUrl?: string | null; downloadUrl?: string | null;
};
export type EventFileDelivery = { mediaId: string; url: string; resolution: "original" | "large" | "web"; watermarked: boolean };

export function authorizedEventDownloadImages<T extends EventPhotoReference>(images: T[], response: { allowedMediaIds?: string[]; deliveries?: EventFileDelivery[] }) {
  const allowed = new Set(response.allowedMediaIds ?? []);
  const deliveries = new Map((response.deliveries ?? []).filter(value => allowed.has(value.mediaId) && /^\/api\/portal\/(?:event|school)-download-file\?token=[^\s]+$/.test(value.url)).map(value => [value.mediaId, value]));
  const selected = images.filter(image => allowed.has(image.id));
  if (!selected.length || selected.some(image => !deliveries.has(image.id))) throw new Error("Please prepare a fresh photo download from the gallery.");
  return selected.map(image => ({ ...image, deliveryUrl: deliveries.get(image.id)!.url, deliveryWatermarked: deliveries.get(image.id)!.watermarked }));
}


function durableSchoolPhotoReference(value: string | null | undefined) {
  const safeKey = (key: unknown) => typeof key === "string" && !key.startsWith("/") && key.includes("/") && /\.(jpe?g|png|webp|avif)$/i.test(key) && !key.includes("..") && !key.includes("\\") && !key.includes("://") && !/[\u0000-\u001f\u007f]/.test(key) ? key : null;
  if (safeKey(value)) return safeKey(value);
  try {
    const url = new URL(value || "", "https://gallery.invalid");
    if (!/^\/api\/portal\/school-preview\/[a-f0-9]{64}\.jpg$/.test(url.pathname)) return null;
    const encoded = (url.searchParams.get("token") || "").split(".")[0];
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0))));
    return payload.kind === "school-gallery-preview" ? safeKey(payload.mediaKey) : null;
  } catch { return null; }
}

export function canonicalEventPhotoReference(value: string | null | undefined, images: EventPhotoReference[], mediaId?: string) {
  if (!value && !mediaId) return null;
  let previewId = "";
  try { previewId = new URL(value || "", "https://gallery.invalid").pathname.match(/^\/api\/portal\/event-preview\/([0-9a-f-]+)\.jpg$/i)?.[1] || ""; } catch {}
  const id = mediaId || previewId;
  let schoolPreviewPath = "";
  try { const path = new URL(value || "", "https://gallery.invalid").pathname; if (path.startsWith("/api/portal/school-preview/")) schoolPreviewPath = path; } catch {}
  const schoolImage = schoolPreviewPath ? images.find(row => [row.url, row.previewUrl, row.thumbnailUrl].some(reference => { try { return new URL(reference || "", "https://gallery.invalid").pathname === schoolPreviewPath; } catch { return false; } })) : null;
  const image = schoolImage || (id ? images.find(row => row.id === id) : images.find(row => [row.url, row.previewUrl, row.thumbnailUrl, row.downloadUrl, row.storagePath].some(reference => reference && reference === value)));
  if (!image?.storagePath) {
    const savedKey = durableSchoolPhotoReference(value);
    if (savedKey) return savedKey;
    throw new Error("A selected event photo is no longer available. Reopen the gallery and choose it again.");
  }
  return image.storagePath;
}

export function canonicalEventOrderEntry<T extends {
  selectedImageUrl: string | null; slots: Array<{ assignedImageUrl: string | null }>;
  retouchSelections?: Array<{ imageUrl: string; notes: string }>;
  digitalSelections?: Array<{ mediaId: string; url: string | null }>;
}>(entry: T, images: EventPhotoReference[]) {
  return {
    ...entry,
    selectedImageUrl: canonicalEventPhotoReference(entry.selectedImageUrl, images),
    slots: entry.slots.map(slot => ({ ...slot, assignedImageUrl: canonicalEventPhotoReference(slot.assignedImageUrl, images) })),
    retouchSelections: entry.retouchSelections?.map(selection => ({ ...selection, imageUrl: canonicalEventPhotoReference(selection.imageUrl, images)! })),
    digitalSelections: entry.digitalSelections?.map(selection => ({ ...selection, url: canonicalEventPhotoReference(selection.url, images, selection.mediaId) })),
  };
}

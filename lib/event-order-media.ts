import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchEventGalleryMediaRows } from "@/lib/event-download-scope";
import { durablePrivateMediaReference } from "@/lib/private-media-references";

type EventOrderEntry = {
  selectedImageUrl: string | null; slots: Array<{ assignedImageUrl: string | null }>;
  retouchSelections: Array<{ imageUrl: string; notes: string }>;
  digitalSelections: Array<{ mediaId: string; url: string | null }>;
};

export async function resolveEventOrderMediaReferences<T extends EventOrderEntry>(service: SupabaseClient, projectId: string, collectionIds: string[], entries: T[]) {
  if (!entries.some(entry => entry.selectedImageUrl || entry.slots.some(slot => slot.assignedImageUrl) || entry.retouchSelections.length || entry.digitalSelections.length)) return;
  const media = await fetchEventGalleryMediaRows<{ id: string; collection_id: string | null; storage_path: string | null }>(service, projectId, collectionIds, "id,collection_id,storage_path");
  const byId = new Map(media.map(row => [row.id, row]));
  const byKey = new Map(media.filter(row => row.storage_path).map(row => [row.storage_path!, row]));
  const resolve = (value: string | null, mediaId?: string) => {
    if (!value && !mediaId) return null;
    const key = durablePrivateMediaReference(value).replace(/_(preview|thumbnail)\.[^/.]+$/i, ".jpg");
    let previewId = "";
    try { previewId = new URL(value || "", "https://gallery.invalid").pathname.match(/^\/api\/portal\/event-preview\/([0-9a-f-]+)\.jpg$/i)?.[1] || ""; } catch {}
    const row = mediaId || previewId ? byId.get(mediaId || previewId) : byKey.get(key);
    if (!row?.storage_path || (mediaId && value && key !== row.storage_path && previewId !== mediaId)) throw new Error("A selected photo is outside the event gallery access scope. Reopen the gallery and choose it again.");
    return row.storage_path;
  };
  for (const entry of entries) {
    entry.selectedImageUrl = resolve(entry.selectedImageUrl);
    for (const slot of entry.slots) slot.assignedImageUrl = resolve(slot.assignedImageUrl);
    for (const selection of entry.retouchSelections) selection.imageUrl = resolve(selection.imageUrl)!;
    for (const selection of entry.digitalSelections) selection.url = resolve(selection.url, selection.mediaId);
  }
}

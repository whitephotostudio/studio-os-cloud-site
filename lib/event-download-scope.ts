import type { SupabaseClient } from "@supabase/supabase-js";
import { validateUuid } from "@/lib/request-validation";

export type EventDownloadCollection = {
  id: string;
  title?: string | null;
  kind?: string | null;
  slug: string | null;
  access_mode: string | null;
  access_pin: string | null;
};

const PAGE_SIZE = 500;
export const MAX_EVENT_GALLERY_PHOTOS = 5000;

export class EventGallerySizeLimitError extends Error {
  constructor() {
    super("This gallery exceeds the supported 5000-photo limit. Please ask the photographer for smaller galleries.");
  }
}

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

export function eventCollectionAccessMode(value: string | null | undefined) {
  const mode = clean(value).toLowerCase();
  if (!mode) return "public";
  if (["pin", "protected", "private"].includes(mode)) return "pin";
  if (["inherit", "inherit_project", "project"].includes(mode)) return "inherit_project";
  return mode;
}

export function matchesEventCollectionPin(row: EventDownloadCollection, pin: string) {
  const mode = eventCollectionAccessMode(row.access_mode);
  // A public collection slug is an entry link, never a substitute for a
  // separately protected album's PIN.
  return mode === "pin"
    ? !!pin && clean(row.access_pin) === pin
    : ["public", "inherit_project"].includes(mode) && !!pin && clean(row.slug) === pin;
}

export function accessibleEventCollections<T extends EventDownloadCollection>(
  rows: T[], pin: string, matchingCollectionId?: string | null,
) {
  return rows.filter(row => {
    if (matchingCollectionId && row.id !== matchingCollectionId) return false;
    if (clean(row.kind) && !["album", "gallery"].includes(clean(row.kind).toLowerCase())) return false;
    const mode = eventCollectionAccessMode(row.access_mode);
    return mode === "pin" ? !!pin && clean(row.access_pin) === pin : ["public", "inherit_project"].includes(mode);
  });
}

export async function fetchEventProjectCollections<T extends EventDownloadCollection>(
  service: SupabaseClient, projectId: string, select: string,
) {
  const rows: T[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset <= MAX_EVENT_GALLERY_PHOTOS; offset += PAGE_SIZE) {
    const end = Math.min(offset + PAGE_SIZE - 1, MAX_EVENT_GALLERY_PHOTOS);
    const { data, error } = await service.from("collections").select(select)
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true }).order("created_at", { ascending: true })
      .order("id", { ascending: true }).range(offset, end);
    if (error) throw error;
    const page = (data ?? []) as unknown as T[];
    for (const row of page) {
      if (seen.has(row.id)) throw new Error("Gallery collections changed while loading. Please retry.");
      seen.add(row.id); rows.push(row);
    }
    if (rows.length > MAX_EVENT_GALLERY_PHOTOS) throw new EventGallerySizeLimitError();
    if (page.length < end - offset + 1) return rows;
  }
  return rows;
}

export async function resolveEventDownloadScope(params: {
  service: SupabaseClient;
  projectId: string;
  collectionIds: string[];
  pin: string;
  collectionId: unknown;
}) {
  let collectionId: string | null = null;
  if (params.collectionId !== undefined && params.collectionId !== null && params.collectionId !== "") {
    const validated = validateUuid(params.collectionId, "collectionId");
    if (!validated.ok) return { ok: false as const, status: 400, message: validated.message };
    collectionId = validated.value;
  }
  const rows = await fetchEventProjectCollections(params.service, params.projectId, "id,title,kind,slug,access_mode,access_pin");
  const accessibleIds = new Set(params.collectionIds);
  const collections = accessibleEventCollections(rows, clean(params.pin))
    .filter(row => accessibleIds.has(row.id) && (!collectionId || row.id === collectionId));
  if (!collections.length) {
    return { ok: false as const, status: 403, message: "That album is not available for download with this access PIN." };
  }
  return { ok: true as const, collectionId, collectionName: collectionId ? clean(collections[0].title) || "Album" : null, collections, collectionIds: collections.map(row => row.id) };
}

export async function authorizedEventMediaIds(
  service: SupabaseClient, projectId: string, requestedIds: string[], collectionIds: string[],
) {
  const requested = [...new Set(requestedIds)];
  const allowedCollections = new Set(collectionIds);
  const confirmed = new Set<string>();
  for (let offset = 0; offset < requested.length; offset += 100) {
    const { data, error } = await service.from("media").select("id,collection_id")
      .eq("project_id", projectId).in("id", requested.slice(offset, offset + 100));
    if (error) throw error;
    for (const row of (data ?? []) as { id: string; collection_id: string | null }[]) {
      if (row.collection_id && allowedCollections.has(row.collection_id)) confirmed.add(row.id);
    }
  }
  return requested.filter(id => confirmed.has(id));
}

export async function fetchEventGalleryMediaRows<T extends { id: string; collection_id: string | null }>(
  service: SupabaseClient, projectId: string, collectionIds: string[], select: string,
) {
  if (!collectionIds.length) return [] as T[];
  const rows: T[] = [];
  const seen = new Set<string>();
  let expectedCount: number | null = null;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error, count } = await service.from("media").select(select, { count: "exact" })
      .eq("project_id", projectId).in("collection_id", collectionIds)
      .order("sort_order", { ascending: true }).order("created_at", { ascending: true })
      .order("id", { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (count === null || !Number.isInteger(count) || count < 0) {
      throw new Error("Gallery photo count could not be verified. Please retry.");
    }
    if (count > MAX_EVENT_GALLERY_PHOTOS) throw new EventGallerySizeLimitError();
    if (expectedCount !== null && expectedCount !== count) throw new Error("Gallery photos changed while loading. Please retry.");
    expectedCount = count;
    const page = (data ?? []) as unknown as T[];
    for (const row of page) {
      if (seen.has(row.id) || !row.collection_id || !collectionIds.includes(row.collection_id)) {
        throw new Error("Gallery photos changed while loading. Please retry.");
      }
      seen.add(row.id); rows.push(row);
    }
    if (rows.length === count) return rows;
    if (rows.length > count || page.length !== PAGE_SIZE) {
      throw new Error("Not all gallery photos could be loaded. Please retry.");
    }
  }
}

export async function eventGalleryDownloadsUsed(service: SupabaseClient, projectId: string, email: string) {
  let total = 0;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await service.from("event_gallery_downloads").select("id,download_count")
      .eq("project_id", projectId).eq("viewer_email", email).eq("download_type", "gallery")
      .order("id", { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      if (error.code === "42P01") return 0;
      throw error;
    }
    const page = (data ?? []) as { download_count: number | null }[];
    for (const row of page) total += Math.max(0, Number(row.download_count ?? 0)) || 0;
    if (page.length < PAGE_SIZE) return total;
    // Fail closed instead of an unbounded public request or a partial quota.
    if (offset >= 99500) throw new Error("Download history is too large to verify safely.");
  }
}

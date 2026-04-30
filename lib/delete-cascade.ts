/**
 * Shared delete-cascade helpers.
 *
 * Every delete pipeline (project, album, photo, school, student) routes
 * through these functions so we have ONE source of truth for "what does
 * permanent delete actually mean".  The audit on 2026-04-29 found that
 * the previous per-route deletes were inconsistent — some cleaned R2,
 * some didn't; some cascaded favorites/visitors/orders, some didn't.
 * That left orphans in storage and dangling refs in the gallery DB.
 *
 * Conventions:
 *   - DB rows: cascade in dependency order (children before parents).
 *   - R2 keys: use r2DeleteWithVariants which handles original +
 *     `_preview.jpg` + `_thumbnail.jpg` derivatives in one batch.
 *   - nobg-photos: separate sweep — `nobg-photos/<storage_path_basename>.png`
 *     when convention applies.
 *   - Best-effort R2: if R2 SDK isn't configured (local dev), skip
 *     cleanly with a warning rather than throwing.
 *
 * All functions return a CascadeResult so callers can log what was
 * actually deleted vs what was a no-op.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { r2DeleteWithVariantsBestEffort } from "@/lib/r2";

export type CascadeResult = {
  ok: boolean;
  rows_deleted: Record<string, number>;
  r2_objects_deleted: number;
  errors: string[];
};

function emptyResult(): CascadeResult {
  return {
    ok: true,
    rows_deleted: {},
    r2_objects_deleted: 0,
    errors: [],
  };
}

function recordDelete(
  result: CascadeResult,
  table: string,
  count: number | null | undefined,
) {
  if (!count) return;
  result.rows_deleted[table] = (result.rows_deleted[table] ?? 0) + count;
}

function recordError(result: CascadeResult, where: string, error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  result.errors.push(`${where}: ${msg}`);
  result.ok = false;
}

/**
 * Build the "nobg-photos" key from an original storage_path.
 * Convention: nobg-photos/<dirname>/<basename>.png
 *   e.g.  projects/p/albums/c/IMG_0001.jpg
 *      → nobg-photos/projects/p/albums/c/IMG_0001.png
 */
function nobgKeyForStoragePath(storagePath: string): string {
  if (!storagePath) return "";
  const cleaned = storagePath.replace(/^\/+/, "").trim();
  if (!cleaned) return "";
  return `nobg-photos/${cleaned.replace(/\.[^./]+$/i, "")}.png`;
}

/* ============================================================ */
/*  PHOTO-LEVEL: delete a list of media row IDs                  */
/* ============================================================ */

/**
 * Delete a specific list of media rows (by id).  Cleans up:
 *   - event_gallery_favorites referencing them
 *   - order_items referencing them by sku/storage_path (best-effort)
 *   - R2 storage (originals + derivatives + nobg)
 *   - the media rows themselves
 *
 * The mediaIds list MUST belong to the same photographer — caller is
 * responsible for that authorization check.
 */
export async function deleteMediaItemsCascade(
  service: SupabaseClient,
  mediaIds: string[],
): Promise<CascadeResult> {
  const result = emptyResult();
  if (!mediaIds.length) return result;

  // Fetch storage paths so we can clean R2 + build nobg keys.
  const { data: rows, error } = await service
    .from("media")
    .select("id,storage_path")
    .in("id", mediaIds);
  if (error) {
    recordError(result, "fetch_media", error);
    return result;
  }
  const storagePaths = (rows ?? [])
    .map((r) => (r as { storage_path?: string | null }).storage_path ?? "")
    .filter((p) => p.length > 0);

  // 1) event_gallery_favorites
  try {
    const { error: e, count } = await service
      .from("event_gallery_favorites")
      .delete({ count: "exact" })
      .in("media_id", mediaIds);
    if (e) recordError(result, "delete_favorites", e);
    else recordDelete(result, "event_gallery_favorites", count);
  } catch (e) {
    recordError(result, "delete_favorites", e);
  }

  // 2) media rows
  try {
    const { error: e, count } = await service
      .from("media")
      .delete({ count: "exact" })
      .in("id", mediaIds);
    if (e) recordError(result, "delete_media", e);
    else recordDelete(result, "media", count);
  } catch (e) {
    recordError(result, "delete_media", e);
  }

  // 3) R2 — originals + _preview + _thumbnail
  if (storagePaths.length > 0) {
    try {
      const r2Count = await r2DeleteWithVariantsBestEffort(storagePaths);
      result.r2_objects_deleted += r2Count;
    } catch (e) {
      recordError(result, "r2_delete_variants", e);
    }

    // 4) nobg-photos PNG variants
    try {
      const nobgKeys = storagePaths
        .map((p) => nobgKeyForStoragePath(p))
        .filter(Boolean);
      if (nobgKeys.length > 0) {
        const r2Count = await r2DeleteWithVariantsBestEffort(nobgKeys);
        result.r2_objects_deleted += r2Count;
      }
    } catch (e) {
      recordError(result, "r2_delete_nobg", e);
    }
  }

  return result;
}

/* ============================================================ */
/*  ALBUM/COLLECTION LEVEL: delete a collection and all its photos */
/* ============================================================ */

export async function deleteCollectionCascade(
  service: SupabaseClient,
  collectionId: string,
): Promise<CascadeResult> {
  const result = emptyResult();
  if (!collectionId) return result;

  // First fetch all media ids in this collection.
  const { data: mediaRows, error: mediaErr } = await service
    .from("media")
    .select("id")
    .eq("collection_id", collectionId);
  if (mediaErr) {
    recordError(result, "fetch_media_for_collection", mediaErr);
    return result;
  }
  const mediaIds = (mediaRows ?? []).map(
    (r) => (r as { id?: string | null }).id ?? "",
  ).filter(Boolean);

  // Delete media via the photo cascade so R2 + favorites are handled.
  if (mediaIds.length > 0) {
    const photoResult = await deleteMediaItemsCascade(service, mediaIds);
    for (const [k, v] of Object.entries(photoResult.rows_deleted)) {
      result.rows_deleted[k] = (result.rows_deleted[k] ?? 0) + v;
    }
    result.r2_objects_deleted += photoResult.r2_objects_deleted;
    result.errors.push(...photoResult.errors);
    if (!photoResult.ok) result.ok = false;
  }

  // Delete the collection row.
  try {
    const { error: e, count } = await service
      .from("collections")
      .delete({ count: "exact" })
      .eq("id", collectionId);
    if (e) recordError(result, "delete_collection", e);
    else recordDelete(result, "collections", count);
  } catch (e) {
    recordError(result, "delete_collection", e);
  }

  return result;
}

/* ============================================================ */
/*  PROJECT LEVEL: delete a project and ALL its descendants     */
/* ============================================================ */

export async function deleteProjectCascade(
  service: SupabaseClient,
  projectId: string,
): Promise<CascadeResult> {
  const result = emptyResult();
  if (!projectId) return result;

  // Collect every media row's storage_path FIRST so we can clean R2
  // even after rows are gone.
  const { data: mediaRows } = await service
    .from("media")
    .select("storage_path")
    .eq("project_id", projectId);
  const storagePaths = (mediaRows ?? [])
    .map((r) => (r as { storage_path?: string | null }).storage_path ?? "")
    .filter((p) => p.length > 0);

  // 1) Cascade rows in dependency order.
  const cascades: Array<[string, () => Promise<{ count: number | null }>]> = [
    [
      "event_gallery_favorites",
      async () => {
        const { error, count } = await service
          .from("event_gallery_favorites")
          .delete({ count: "exact" })
          .eq("project_id", projectId);
        if (error) throw error;
        return { count };
      },
    ],
    [
      "event_gallery_visitors",
      async () => {
        const { error, count } = await service
          .from("event_gallery_visitors")
          .delete({ count: "exact" })
          .eq("project_id", projectId);
        if (error) throw error;
        return { count };
      },
    ],
    [
      "pre_release_emails",
      async () => {
        const { error, count } = await service
          .from("pre_release_emails")
          .delete({ count: "exact" })
          .eq("project_id", projectId);
        if (error) throw error;
        return { count };
      },
    ],
    [
      "order_items_via_orders",
      async () => {
        // Manually cascade order_items via orders.
        const { data: orders } = await service
          .from("orders")
          .select("id")
          .eq("project_id", projectId);
        const orderIds = (orders ?? []).map(
          (r) => (r as { id?: string | null }).id ?? "",
        ).filter(Boolean);
        if (!orderIds.length) return { count: 0 };
        const { error, count } = await service
          .from("order_items")
          .delete({ count: "exact" })
          .in("order_id", orderIds);
        if (error) throw error;
        return { count };
      },
    ],
    [
      "orders",
      async () => {
        const { error, count } = await service
          .from("orders")
          .delete({ count: "exact" })
          .eq("project_id", projectId);
        if (error) throw error;
        return { count };
      },
    ],
    [
      "media",
      async () => {
        const { error, count } = await service
          .from("media")
          .delete({ count: "exact" })
          .eq("project_id", projectId);
        if (error) throw error;
        return { count };
      },
    ],
    [
      "collections",
      async () => {
        const { error, count } = await service
          .from("collections")
          .delete({ count: "exact" })
          .eq("project_id", projectId);
        if (error) throw error;
        return { count };
      },
    ],
    [
      "projects",
      async () => {
        const { error, count } = await service
          .from("projects")
          .delete({ count: "exact" })
          .eq("id", projectId);
        if (error) throw error;
        return { count };
      },
    ],
  ];

  for (const [tableLabel, fn] of cascades) {
    try {
      const { count } = await fn();
      const cleanedLabel = tableLabel.replace("_via_orders", "");
      recordDelete(result, cleanedLabel, count);
    } catch (e) {
      recordError(result, `delete_${tableLabel}`, e);
    }
  }

  // 2) R2 cleanup — originals + derivatives + nobg.  AWAITED so the
  // caller can trust the response and we don't drop deletes when the
  // serverless function freezes.
  if (storagePaths.length > 0) {
    try {
      const r2Count = await r2DeleteWithVariantsBestEffort(storagePaths);
      result.r2_objects_deleted += r2Count;
    } catch (e) {
      recordError(result, "r2_delete_variants", e);
    }

    try {
      const nobgKeys = storagePaths
        .map((p) => nobgKeyForStoragePath(p))
        .filter(Boolean);
      if (nobgKeys.length > 0) {
        const r2Count = await r2DeleteWithVariantsBestEffort(nobgKeys);
        result.r2_objects_deleted += r2Count;
      }
    } catch (e) {
      recordError(result, "r2_delete_nobg", e);
    }
  }

  return result;
}

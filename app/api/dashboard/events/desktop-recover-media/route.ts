import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { listR2FolderImages, r2PublicUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";

// 2026-04-29 — One-shot recovery endpoint.
//
// Usage from desktop or curl:
//   POST /api/dashboard/events/desktop-recover-media
//   { "cloudProjectId": "<uuid>" }
//
// What it does:
//   1. For every collection on the project, lists R2 objects under
//      `projects/<projectId>/albums/<collectionId>/`.
//   2. For every .jpg key that has no corresponding `media` row,
//      inserts one.
//   3. Returns counts so the caller can confirm.
//
// Why it exists:
//   The previous force-reupload flow deleted DB rows BEFORE re-
//   uploading, so cancellations or partial failures left projects
//   at "0 of N rows" even though all the JPEGs were already
//   sitting in R2.  This endpoint restores those rows from R2
//   without needing the desktop to re-process every photo.
//
// Idempotent.  Safe to call multiple times.

export async function POST(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      cloudProjectId?: string;
    };
    const cloudProjectId = (body.cloudProjectId ?? "").trim();
    if (!cloudProjectId) {
      return NextResponse.json(
        { ok: false, message: "cloudProjectId is required." },
        { status: 400 },
      );
    }

    const service = createDashboardServiceClient();

    // ── tenant guard ──
    const { data: photographerRow } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!photographerRow?.id) {
      return NextResponse.json(
        { ok: false, message: "Photographer profile not found." },
        { status: 404 },
      );
    }

    const { data: projectRow } = await service
      .from("projects")
      .select("id")
      .eq("id", cloudProjectId)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle();
    if (!projectRow) {
      return NextResponse.json(
        { ok: false, message: "Project not found for this photographer." },
        { status: 404 },
      );
    }

    // ── collections on the project ──
    const { data: collectionRows, error: collectionError } = await service
      .from("collections")
      .select("id,kind")
      .eq("project_id", cloudProjectId)
      .is("deleted_at", null);
    if (collectionError) throw collectionError;

    // Roster collections shouldn't get photo recovery; skip them.
    const eligibleCollections = (collectionRows ?? []).filter(
      (c) => (c as { kind?: string | null }).kind !== "roster",
    );

    if (eligibleCollections.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No eligible collections on this project.",
        inserted: 0,
        scanned: 0,
        per_collection: [],
      });
    }

    // ── existing media rows (so we don't dup) ──
    const { data: existingMedia } = await service
      .from("media")
      .select("collection_id,storage_path")
      .eq("project_id", cloudProjectId);

    const existingKeySet = new Set<string>();
    for (const row of (existingMedia ?? []) as Array<{
      collection_id?: string | null;
      storage_path?: string | null;
    }>) {
      const cid = (row.collection_id ?? "").trim();
      const sp = (row.storage_path ?? "").trim();
      if (cid && sp) existingKeySet.add(`${cid}::${sp}`);
    }

    // ── for each collection, list R2 and prepare inserts ──
    let totalInserted = 0;
    let totalScanned = 0;
    const perCollection: Array<{
      collection_id: string;
      scanned: number;
      inserted: number;
      skipped_existing: number;
    }> = [];

    for (const c of eligibleCollections) {
      const collectionId = (c as { id?: string | null }).id ?? "";
      if (!collectionId) continue;
      const prefix = `projects/${cloudProjectId}/albums/${collectionId}`;

      const r2Items = await listR2FolderImages(prefix);
      totalScanned += r2Items.length;

      // Determine the next sort_order for this collection.
      const { data: maxRow } = await service
        .from("media")
        .select("sort_order")
        .eq("project_id", cloudProjectId)
        .eq("collection_id", collectionId)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      let nextSort =
        (Number((maxRow as { sort_order?: number | null } | null)?.sort_order) ||
          -1) + 1;

      const inserts: Array<Record<string, string | number | boolean | null>> =
        [];
      let skippedExisting = 0;

      for (const item of r2Items) {
        // R2 storage_path matches the listed key.
        const storagePath = item.key;
        const filename = item.name;

        // Skip already-registered.
        if (existingKeySet.has(`${collectionId}::${storagePath}`)) {
          skippedExisting += 1;
          continue;
        }

        // Build derivative URLs the desktop would have set.
        const baseKey = storagePath.replace(/\.[^./]+$/i, "");
        const previewKey = `${baseKey}_preview.jpg`;
        const thumbnailKey = `${baseKey}_thumbnail.jpg`;

        inserts.push({
          project_id: cloudProjectId,
          collection_id: collectionId,
          storage_path: storagePath,
          filename,
          mime_type: "image/jpeg",
          preview_url: r2PublicUrl(previewKey),
          thumbnail_url: r2PublicUrl(thumbnailKey),
          sort_order: nextSort,
          is_cover: false,
        });
        existingKeySet.add(`${collectionId}::${storagePath}`);
        nextSort += 1;
      }

      let insertedHere = 0;
      if (inserts.length > 0) {
        // Insert in chunks of 200 to stay well under any limits.
        for (let i = 0; i < inserts.length; i += 200) {
          const chunk = inserts.slice(i, i + 200);
          const { data, error } = await service
            .from("media")
            .insert(chunk)
            .select("id");
          if (error) {
            console.error(
              "[desktop-recover-media] insert error for collection %s: %o",
              collectionId,
              error,
            );
            throw error;
          }
          insertedHere += (data ?? []).length;
        }
      }

      totalInserted += insertedHere;
      perCollection.push({
        collection_id: collectionId,
        scanned: r2Items.length,
        inserted: insertedHere,
        skipped_existing: skippedExisting,
      });
    }

    return NextResponse.json({
      ok: true,
      cloudProjectId,
      scanned: totalScanned,
      inserted: totalInserted,
      per_collection: perCollection,
      message: `Recovered ${totalInserted} media rows across ${perCollection.length} collection(s).`,
    });
  } catch (error: unknown) {
    console.error("[desktop-recover-media POST]", error);
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Recovery failed.",
      },
      { status: 500 },
    );
  }
}

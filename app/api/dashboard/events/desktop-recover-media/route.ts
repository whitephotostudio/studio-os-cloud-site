import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { r2PublicUrl } from "@/lib/r2";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 2026-04-29 — Recovery endpoint, v2 (no R2 listing).
//
// The previous version used `listR2FolderImages` which depends on
// R2 SDK env vars being available at runtime; that was failing
// silently on Vercel and returning generic 500s.
//
// New design: the DESKTOP walks its local filesystem (which is
// already the source of truth for "which photos exist") and POSTs
// the list of filenames to this endpoint.  We just insert media
// rows for each.  No R2 SDK, no env-var dependency, no listing.
//
// Body shape:
//   {
//     "cloudProjectId": "<uuid>",
//     "files": [
//       { "filename": "DX3_9755.jpg", "collectionId": "<uuid>" },
//       ...
//     ]
//   }
//
// For each file, we construct the canonical storage_path:
//   projects/<cloudProjectId>/albums/<collectionId>/<filename>
// and insert a media row (or skip if it already exists).
//
// Idempotent.  Safe to call multiple times.

type RecoverFile = {
  filename?: string | null;
  collectionId?: string | null;
};

type RecoverBody = {
  cloudProjectId?: string | null;
  files?: RecoverFile[] | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as RecoverBody;
    const cloudProjectId = clean(body.cloudProjectId);
    if (!cloudProjectId) {
      return NextResponse.json(
        { ok: false, message: "cloudProjectId is required." },
        { status: 400 },
      );
    }

    const incomingFiles = Array.isArray(body.files) ? body.files : [];
    if (incomingFiles.length === 0) {
      return NextResponse.json({
        ok: true,
        cloudProjectId,
        scanned: 0,
        inserted: 0,
        skipped: 0,
        message: "No files supplied — nothing to recover.",
      });
    }

    const service = createDashboardServiceClient();

    // ── tenant guard ──
    const { data: photographerRow, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (photographerError) throw photographerError;
    if (!photographerRow?.id) {
      return NextResponse.json(
        { ok: false, message: "Photographer profile not found." },
        { status: 404 },
      );
    }

    const { data: projectRow, error: projectError } = await service
      .from("projects")
      .select("id")
      .eq("id", cloudProjectId)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle();
    if (projectError) throw projectError;
    if (!projectRow) {
      return NextResponse.json(
        { ok: false, message: "Project not found for this photographer." },
        { status: 404 },
      );
    }

    // Normalize incoming files.
    const cleanedFiles = incomingFiles
      .map((f) => ({
        filename: clean(f?.filename),
        collectionId: clean(f?.collectionId),
      }))
      .filter((f) => f.filename && f.collectionId);

    if (cleanedFiles.length === 0) {
      return NextResponse.json({
        ok: true,
        cloudProjectId,
        scanned: incomingFiles.length,
        inserted: 0,
        skipped: 0,
        message: "All supplied files were missing filename or collectionId.",
      });
    }

    // ── Validate the supplied collectionIds all belong to this project ──
    const collectionIdSet = new Set(cleanedFiles.map((f) => f.collectionId));
    const { data: validCollections, error: vcError } = await service
      .from("collections")
      .select("id")
      .eq("project_id", cloudProjectId)
      .in("id", Array.from(collectionIdSet));
    if (vcError) throw vcError;
    const validCollectionIds = new Set(
      (validCollections ?? []).map((c) =>
        clean((c as { id?: string | null }).id),
      ),
    );

    const validFiles = cleanedFiles.filter((f) =>
      validCollectionIds.has(f.collectionId),
    );

    if (validFiles.length === 0) {
      return NextResponse.json({
        ok: true,
        cloudProjectId,
        scanned: incomingFiles.length,
        inserted: 0,
        skipped: cleanedFiles.length,
        message:
          "None of the supplied collectionIds match collections on this project.",
        diagnostic: {
          received_collection_ids: Array.from(collectionIdSet),
          valid_collection_ids: Array.from(validCollectionIds),
        },
      });
    }

    // ── Existing media rows for this project (full set, so dedup
    //    works regardless of which collection they came from) ──
    const { data: existingMedia, error: existingError } = await service
      .from("media")
      .select("collection_id,storage_path,sort_order")
      .eq("project_id", cloudProjectId);
    if (existingError) throw existingError;

    const existingKeySet = new Set<string>();
    const nextSortByCollection = new Map<string, number>();
    for (const row of (existingMedia ?? []) as Array<{
      collection_id?: string | null;
      storage_path?: string | null;
      sort_order?: number | string | null;
    }>) {
      const cid = clean(row.collection_id);
      const sp = clean(row.storage_path);
      if (cid && sp) existingKeySet.add(`${cid}::${sp}`);
      const so =
        typeof row.sort_order === "number"
          ? row.sort_order
          : Number.parseInt(`${row.sort_order ?? ""}`, 10);
      const cur = nextSortByCollection.get(cid) ?? 0;
      if (Number.isFinite(so)) {
        nextSortByCollection.set(cid, Math.max(cur, so + 1));
      }
    }

    // ── Build insert rows ──
    const inserts: Array<Record<string, string | number | boolean | null>> = [];
    let skipped = 0;
    for (const f of validFiles) {
      const baseName = f.filename.replace(/\.[^./]+$/i, "");
      const safeFilename = `${baseName}.jpg`; // desktop normalizes to jpg
      const storagePath = `projects/${cloudProjectId}/albums/${f.collectionId}/${safeFilename}`;
      const key = `${f.collectionId}::${storagePath}`;
      if (existingKeySet.has(key)) {
        skipped += 1;
        continue;
      }
      const previewKey = `projects/${cloudProjectId}/albums/${f.collectionId}/${baseName}_preview.jpg`;
      const thumbKey = `projects/${cloudProjectId}/albums/${f.collectionId}/${baseName}_thumbnail.jpg`;
      const sortOrder = nextSortByCollection.get(f.collectionId) ?? 0;
      nextSortByCollection.set(f.collectionId, sortOrder + 1);
      existingKeySet.add(key);
      inserts.push({
        project_id: cloudProjectId,
        collection_id: f.collectionId,
        storage_path: storagePath,
        filename: safeFilename,
        mime_type: "image/jpeg",
        preview_url: r2PublicUrl(previewKey),
        thumbnail_url: r2PublicUrl(thumbKey),
        sort_order: sortOrder,
        is_cover: false,
      });
    }

    let inserted = 0;
    if (inserts.length > 0) {
      // Insert in chunks of 200 to stay well under any row limits.
      for (let i = 0; i < inserts.length; i += 200) {
        const chunk = inserts.slice(i, i + 200);
        const { data, error } = await service
          .from("media")
          .insert(chunk)
          .select("id");
        if (error) {
          console.error("[desktop-recover-media] insert error:", error);
          throw error;
        }
        inserted += (data ?? []).length;
      }
    }

    return NextResponse.json({
      ok: true,
      cloudProjectId,
      scanned: incomingFiles.length,
      inserted,
      skipped,
      message: `Recovered ${inserted} media rows. Skipped ${skipped} already-registered.`,
    });
  } catch (error: unknown) {
    console.error("[desktop-recover-media POST]", error);
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? `recover-media failed: ${error.message}`
            : "Recovery failed (no message).",
      },
      { status: 500 },
    );
  }
}

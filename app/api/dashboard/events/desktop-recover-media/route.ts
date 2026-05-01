import { NextRequest, NextResponse } from "next/server";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { r2PublicUrl, getR2Client, R2_BUCKET, hasR2Config } from "@/lib/r2";

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

    // ── Build candidate rows ──
    type Candidate = {
      row: Record<string, string | number | boolean | null>;
      storagePath: string;
    };
    const candidates: Candidate[] = [];
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
      candidates.push({
        storagePath,
        row: {
          project_id: cloudProjectId,
          collection_id: f.collectionId,
          storage_path: storagePath,
          filename: safeFilename,
          mime_type: "image/jpeg",
          preview_url: r2PublicUrl(previewKey),
          thumbnail_url: r2PublicUrl(thumbKey),
          sort_order: sortOrder,
          is_cover: false,
        },
      });
    }

    // ── 2026-04-30 — VERIFY R2 EXISTS BEFORE INSERTING ──
    //
    // Previously this endpoint trusted the desktop's file list and
    // inserted media rows for every supplied path.  When R2 PUTs
    // failed silently (revoked token), the desktop's auto-heal would
    // call recover-media → 139 rows landed in DB pointing at R2
    // objects that didn't exist.  Galleries then served signed URLs
    // that 404'd because the underlying file wasn't there.
    //
    // Now: HEAD each candidate object in parallel (capped at 16 in
    // flight to avoid hammering R2).  Drop any candidate whose object
    // is missing.  Report the dropped count back so the desktop sees
    // a real failure signal instead of a fake "139 inserted" success.
    const inserts: Array<Record<string, string | number | boolean | null>> = [];
    const skippedMissingFromR2: string[] = [];

    if (candidates.length > 0 && hasR2Config()) {
      const r2 = getR2Client();
      const concurrency = 16;
      let cursor = 0;
      async function worker() {
        while (cursor < candidates.length) {
          const idx = cursor++;
          const candidate = candidates[idx];
          try {
            await r2.send(
              new HeadObjectCommand({
                Bucket: R2_BUCKET,
                Key: candidate.storagePath,
              }),
            );
            inserts.push(candidate.row);
          } catch (err: unknown) {
            const status = (err as { $metadata?: { httpStatusCode?: number } })
              ?.$metadata?.httpStatusCode;
            const name = (err as { name?: string })?.name;
            if (status === 404 || name === "NotFound") {
              skippedMissingFromR2.push(candidate.storagePath);
            } else {
              // Network blip / transient: treat as missing rather than
              // inserting a row we can't verify.  Better to under-report
              // than to create a ghost row.
              console.warn(
                "[desktop-recover-media] HEAD failed for %s: %s",
                candidate.storagePath,
                (err as Error)?.message ?? err,
              );
              skippedMissingFromR2.push(candidate.storagePath);
            }
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(concurrency, candidates.length) }, () => worker()),
      );
    } else if (candidates.length > 0) {
      // R2 not configured → cannot verify.  Fall back to old (trusting)
      // behavior with a loud warning so the next debug session sees it.
      console.warn(
        "[desktop-recover-media] R2 not configured — falling back to UNVERIFIED inserts.  Configure R2_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY to enable verification.",
      );
      for (const candidate of candidates) inserts.push(candidate.row);
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

    const message =
      skippedMissingFromR2.length > 0
        ? `Recovered ${inserted} media rows.  Skipped ${skipped} already-registered + ${skippedMissingFromR2.length} whose R2 file is missing (desktop upload failed for those — re-upload).`
        : `Recovered ${inserted} media rows. Skipped ${skipped} already-registered.`;

    return NextResponse.json({
      ok: true,
      cloudProjectId,
      scanned: incomingFiles.length,
      inserted,
      skipped: skipped + skippedMissingFromR2.length,
      skippedMissingFromR2: skippedMissingFromR2.length,
      message,
      diagnostic:
        skippedMissingFromR2.length > 0
          ? {
              reason: "missing_from_r2",
              sample_paths: skippedMissingFromR2.slice(0, 5),
            }
          : undefined,
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

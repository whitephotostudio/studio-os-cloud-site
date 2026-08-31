import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";
import {
  ensureSchoolCollectionId,
  findSyncedSchoolProjectId,
} from "@/lib/school-sync";
import { normalizeStorageUrl } from "@/lib/storage-images";
import { guardAgreement } from "@/lib/require-agreement";
import { r2DeleteWithVariantsBestEffort } from "@/lib/r2";

export const dynamic = "force-dynamic";

const CompositeItemPayloadSchema = z.object({
  class_name: z.string().max(500).nullable().optional(),
  storage_path: z.string().max(2000).nullable().optional(),
  filename: z.string().max(500).nullable().optional(),
  mime_type: z.string().max(128).nullable().optional(),
  preview_url: z.string().max(2000).nullable().optional(),
  thumbnail_url: z.string().max(2000).nullable().optional(),
  is_cover: z.boolean().nullable().optional(),
});

const DesktopCompositesBodySchema = z.object({
  schoolId: z.string().min(1).max(128).nullable().optional(),
  items: z.array(CompositeItemPayloadSchema).max(5000).nullable().optional(),
  deleteItems: z
    .array(CompositeItemPayloadSchema)
    .max(5000)
    .nullable()
    .optional(),
});

type SchoolRow = {
  id: string;
  school_name?: string | null;
  local_school_id?: string | null;
  photographer_id?: string | null;
  portal_status?: string | null;
  status?: string | null;
};

type ExistingMediaRow = {
  id?: string | null;
  collection_id?: string | null;
  storage_path?: string | null;
  sort_order?: number | string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function classKey(value: string) {
  return clean(value).toLowerCase();
}

function collectionSlug(value: string) {
  return (
    clean(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "composite"
  );
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

    const parsed = await parseJson(request, DesktopCompositesBodySchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const schoolId = clean(body.schoolId);
    if (!schoolId) {
      return NextResponse.json(
        { ok: false, message: "schoolId is required." },
        { status: 400 },
      );
    }

    const items = Array.isArray(body.items) ? body.items : [];
    const deleteItems = Array.isArray(body.deleteItems) ? body.deleteItems : [];
    if (items.length === 0 && deleteItems.length === 0) {
      return NextResponse.json({
        ok: true,
        processed: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
      });
    }

    const dedupedDeleteInput = new Map<
      string,
      {
        class_name: string;
        storage_path: string;
      }
    >();
    for (const item of deleteItems) {
      const normalized = {
        class_name: clean(item.class_name),
        storage_path: clean(item.storage_path),
      };
      if (!normalized.class_name || !normalized.storage_path) continue;
      dedupedDeleteInput.set(
        `${classKey(normalized.class_name)}::${normalized.storage_path}`,
        normalized,
      );
    }
    const normalizedDeleteItems = Array.from(dedupedDeleteInput.values());

    const dedupedInput = new Map<
      string,
      {
        class_name: string;
        storage_path: string;
        filename: string;
        mime_type: string;
        preview_url: string;
        thumbnail_url: string;
        is_cover: boolean;
      }
    >();
    for (const item of items) {
      const normalized = {
        class_name: clean(item.class_name),
        storage_path: clean(item.storage_path),
        filename: clean(item.filename),
        mime_type: clean(item.mime_type) || "image/jpeg",
        preview_url: normalizeStorageUrl(item.preview_url),
        thumbnail_url: normalizeStorageUrl(item.thumbnail_url),
        is_cover: item.is_cover === true,
      };
      if (!normalized.class_name || !normalized.storage_path) continue;
      dedupedInput.set(
        `${classKey(normalized.class_name)}::${normalized.storage_path}`,
        normalized,
      );
    }
    const normalizedItems = Array.from(dedupedInput.values());

    if (normalizedItems.length === 0 && normalizedDeleteItems.length === 0) {
      return NextResponse.json({
        ok: true,
        processed: 0,
        inserted: 0,
        updated: 0,
        skipped: items.length + deleteItems.length,
      });
    }

    const service = createDashboardServiceClient();

    // Agreement gate — refuse to act for users who haven't accepted the
    // Studio OS Cloud legal agreement. Defense in depth behind the client
    // modal. Same pattern as upload-to-r2 / generate-thumbnails.
    {
      const guard = await guardAgreement({ service, userId: user.id });
      if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });
    }

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

    const { data: schoolData, error: schoolError } = await service
      .from("schools")
      .select("id,school_name,local_school_id,photographer_id,portal_status,status")
      .eq("id", schoolId)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle();

    if (schoolError) throw schoolError;
    if (!schoolData) {
      return NextResponse.json(
        { ok: false, message: "School not found." },
        { status: 404 },
      );
    }

    const school = schoolData as SchoolRow;
    const collectionIdByClass = new Map<string, string>();
    let cloudProjectId = "";

    for (const className of Array.from(
      new Set(normalizedItems.map((item) => item.class_name)),
    )) {
      const target = await ensureSchoolCollectionId(service, {
        schoolId,
        school,
        kind: "composite",
        title: className,
        slugFallback: "composite",
      });
      const collectionId = clean(target.collectionId);
      if (!collectionId) continue;
      collectionIdByClass.set(classKey(className), collectionId);
      if (!cloudProjectId) {
        cloudProjectId = clean(target.projectId);
      }
    }

    if (!cloudProjectId && normalizedDeleteItems.length > 0) {
      cloudProjectId = clean(
        await findSyncedSchoolProjectId(service, schoolId, {
          localSchoolId: school.local_school_id,
          photographerId: school.photographer_id,
        }),
      );
    }

    if (cloudProjectId && normalizedDeleteItems.length > 0) {
      const { data: collectionRows, error: collectionError } = await service
        .from("collections")
        .select("id,title,slug")
        .eq("project_id", cloudProjectId)
        .eq("kind", "composite");
      if (collectionError) throw collectionError;

      const existingCompositeCollections = (collectionRows ?? []) as Array<{
        id?: string | null;
        title?: string | null;
        slug?: string | null;
      }>;
      for (const className of Array.from(
        new Set(normalizedDeleteItems.map((item) => item.class_name)),
      )) {
        if (collectionIdByClass.has(classKey(className))) continue;
        const targetSlug = collectionSlug(className);
        const row = existingCompositeCollections.find(
          (candidate) =>
            clean(candidate.slug) === targetSlug ||
            classKey(candidate.title ?? "") === classKey(className),
        );
        const collectionId = clean(row?.id);
        if (collectionId) {
          collectionIdByClass.set(classKey(className), collectionId);
        }
      }
    }

    if (!cloudProjectId || collectionIdByClass.size === 0) {
      if (normalizedItems.length === 0) {
        return NextResponse.json({
          ok: true,
          projectId: cloudProjectId || null,
          processed: 0,
          inserted: 0,
          updated: 0,
          deleted: 0,
          r2Deleted: 0,
          skipped: deleteItems.length,
        });
      }
      return NextResponse.json(
        { ok: false, message: "School project could not be prepared." },
        { status: 500 },
      );
    }

    const collectionIds = Array.from(new Set(collectionIdByClass.values()));
    const { data: existingRows, error: existingError } = await service
      .from("media")
      .select("id,collection_id,storage_path,sort_order")
      .eq("project_id", cloudProjectId)
      .in("collection_id", collectionIds);

    if (existingError) throw existingError;

    const existingByKey = new Map<string, ExistingMediaRow>();
    const nextSortOrderByCollection = new Map<string, number>();

    for (const raw of (existingRows ?? []) as ExistingMediaRow[]) {
      const collectionId = clean(raw.collection_id);
      const storagePath = clean(raw.storage_path);
      if (!collectionId || !storagePath) continue;

      existingByKey.set(`${collectionId}::${storagePath}`, raw);
      const asInt =
        typeof raw.sort_order === "number"
          ? raw.sort_order
          : Number.parseInt(`${raw.sort_order ?? ""}`, 10);
      const currentMax = nextSortOrderByCollection.get(collectionId) ?? 0;
      if (Number.isFinite(asInt)) {
        nextSortOrderByCollection.set(collectionId, Math.max(currentMax, asInt + 1));
      } else {
        nextSortOrderByCollection.set(collectionId, currentMax);
      }
    }

    const now = new Date().toISOString();
    const collectionCoverUpdates = new Map<string, string>();
    let inserted = 0;
    let updated = 0;
    let deleted = 0;
    let r2Deleted = 0;
    let skipped = 0;

    const deletedCollectionIds = new Set<string>();
    const deletedStoragePaths: string[] = [];

    for (const item of normalizedDeleteItems) {
      const collectionId = collectionIdByClass.get(classKey(item.class_name));
      if (!collectionId) {
        skipped += 1;
        continue;
      }

      const { data: deletedRows, error } = await service
        .from("media")
        .delete()
        .eq("project_id", cloudProjectId)
        .eq("collection_id", collectionId)
        .eq("storage_path", item.storage_path)
        .select("id,storage_path");
      if (error) throw error;

      const rows = (deletedRows ?? []) as Array<{
        storage_path?: string | null;
      }>;
      deleted += rows.length;
      if (rows.length > 0) {
        deletedCollectionIds.add(collectionId);
        for (const row of rows) {
          const storagePath = clean(row.storage_path);
          if (storagePath) deletedStoragePaths.push(storagePath);
        }
      }
    }

    if (deletedStoragePaths.length > 0) {
      r2Deleted = await r2DeleteWithVariantsBestEffort(deletedStoragePaths);
    }

    for (const item of normalizedItems) {
      const collectionId = collectionIdByClass.get(classKey(item.class_name));
      if (!collectionId) {
        skipped += 1;
        continue;
      }

      const payload = {
        project_id: cloudProjectId,
        collection_id: collectionId,
        storage_path: item.storage_path,
        filename: item.filename || null,
        mime_type: item.mime_type,
        preview_url: item.preview_url || null,
        thumbnail_url: item.thumbnail_url || null,
        is_cover: item.is_cover,
        updated_at: now,
      };

      const existing = existingByKey.get(`${collectionId}::${item.storage_path}`);
      if (existing?.id) {
        const { error } = await service
          .from("media")
          .update(payload)
          .eq("id", existing.id)
          .eq("project_id", cloudProjectId);
        if (error) throw error;
        updated += 1;
      } else {
        const nextSort = nextSortOrderByCollection.get(collectionId) ?? 0;
        nextSortOrderByCollection.set(collectionId, nextSort + 1);
        const { error } = await service.from("media").insert({
          ...payload,
          sort_order: nextSort,
        });
        if (error) throw error;
        existingByKey.set(`${collectionId}::${item.storage_path}`, {
          collection_id: collectionId,
          storage_path: item.storage_path,
          sort_order: nextSort,
        });
        inserted += 1;
      }

      const coverUrl = normalizeStorageUrl(item.preview_url || item.thumbnail_url);
      if (coverUrl) {
        collectionCoverUpdates.set(collectionId, coverUrl);
      }
    }

    for (const [collectionId, coverUrl] of collectionCoverUpdates.entries()) {
      const { error } = await service
        .from("collections")
        .update({
          cover_photo_url: coverUrl,
          updated_at: now,
        })
        .eq("id", collectionId)
        .eq("project_id", cloudProjectId);
      if (error) throw error;
    }

    for (const collectionId of deletedCollectionIds) {
      if (collectionCoverUpdates.has(collectionId)) continue;
      const { data: nextMedia, error: nextMediaError } = await service
        .from("media")
        .select("preview_url,thumbnail_url")
        .eq("project_id", cloudProjectId)
        .eq("collection_id", collectionId)
        .order("sort_order", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (nextMediaError) throw nextMediaError;

      const nextMediaRow = nextMedia as {
        preview_url?: string | null;
        thumbnail_url?: string | null;
      } | null;
      const nextCover = normalizeStorageUrl(
        nextMediaRow?.preview_url || nextMediaRow?.thumbnail_url,
      );
      const { error } = await service
        .from("collections")
        .update({
          cover_photo_url: nextCover || null,
          updated_at: now,
        })
        .eq("id", collectionId)
        .eq("project_id", cloudProjectId);
      if (error) throw error;
    }

    const { data: projectRow, error: projectError } = await service
      .from("projects")
      .select("cover_photo_url")
      .eq("id", cloudProjectId)
      .maybeSingle();

    if (projectError) throw projectError;

    const existingProjectCover = clean(
      (projectRow as { cover_photo_url?: string | null } | null)
        ?.cover_photo_url,
    );
    if (existingProjectCover.length === 0 && collectionCoverUpdates.size > 0) {
      const projectCoverUrl = collectionCoverUpdates.values().next().value ?? "";
      if (!projectCoverUrl) {
        return NextResponse.json({
          ok: true,
          projectId: cloudProjectId,
          processed: normalizedItems.length,
          inserted,
          updated,
          deleted,
          r2Deleted,
          skipped,
        });
      }
      const { error } = await service
        .from("projects")
        .update({
          cover_photo_url: projectCoverUrl,
          updated_at: now,
        })
        .eq("id", cloudProjectId)
        .eq("photographer_id", photographerRow.id);
      if (error) throw error;
    }

    return NextResponse.json({
      ok: true,
      projectId: cloudProjectId,
      processed: normalizedItems.length,
      inserted,
      updated,
      deleted,
      r2Deleted,
      skipped,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to register school composites.",
      },
      { status: 500 },
    );
  }
}

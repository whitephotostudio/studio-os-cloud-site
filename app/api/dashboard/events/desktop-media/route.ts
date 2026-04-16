import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";
import { listR2FolderImages } from "@/lib/r2";

export const dynamic = "force-dynamic";

type MediaItemPayload = {
  collection_id?: string | null;
  storage_path?: string | null;
  filename?: string | null;
  mime_type?: string | null;
  preview_url?: string | null;
  thumbnail_url?: string | null;
  is_cover?: boolean | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function extensionOf(value: string | null | undefined) {
  const match = clean(value).toLowerCase().match(/\.([a-z0-9]+)$/i);
  return match?.[1] ?? "";
}

function withExtension(value: string, nextExtension: string) {
  const trimmed = clean(value);
  if (!trimmed) return trimmed;
  if (/\.[^.\/]+$/.test(trimmed)) {
    return trimmed.replace(/\.[^.\/]+$/, nextExtension);
  }
  return `${trimmed}${nextExtension}`;
}

function folderPrefixOf(value: string) {
  const trimmed = clean(value);
  const slashIndex = trimmed.lastIndexOf("/");
  return slashIndex >= 0 ? trimmed.slice(0, slashIndex) : "";
}

function inferMimeType(value: string | null | undefined) {
  const extension = extensionOf(value);
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "avif") return "image/avif";
  return "";
}

function isProjectAlbumJpeg(storagePath: string, filename: string) {
  return (
    /^projects\/[^/]+\/albums\/[^/]+\//i.test(clean(storagePath)) &&
    (extensionOf(filename) === "jpg" || extensionOf(filename) === "jpeg")
  );
}

type NormalizedMediaItem = {
  collection_id: string;
  storage_path: string;
  filename: string;
  mime_type: string;
  preview_url: string;
  thumbnail_url: string;
  is_cover: boolean;
};

function preferredCoverUrl(item: Pick<NormalizedMediaItem, "preview_url" | "thumbnail_url">) {
  return clean(item.preview_url) || clean(item.thumbnail_url) || null;
}

function chooseCoverCandidate(
  items: NormalizedMediaItem[],
  source: "first_valid" | "newest" | "oldest" | "manual",
) {
  if (!items.length || source === "manual") return null;

  const flagged = items.find((item) => item.is_cover && preferredCoverUrl(item));
  if (flagged) return flagged;

  const ordered =
    source === "newest"
      ? [...items].reverse()
      : items;

  return ordered.find((item) => preferredCoverUrl(item)) ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const cloudProjectId = clean(searchParams.get("cloudProjectId"));
    if (!cloudProjectId) {
      return NextResponse.json(
        { ok: false, message: "Cloud project id is required." },
        { status: 400 },
      );
    }

    const collectionIds = Array.from(
      new Set(
        (searchParams.get("collectionIds") ?? "")
          .split(",")
          .map((value) => clean(value))
          .filter((value) => value.length > 0),
      ),
    );

    const service = createDashboardServiceClient();

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
        { ok: false, message: "Project not found." },
        { status: 404 },
      );
    }

    let mediaQuery = service
      .from("media")
      .select("collection_id,storage_path")
      .eq("project_id", cloudProjectId);

    if (collectionIds.length > 0) {
      mediaQuery = mediaQuery.in("collection_id", collectionIds);
    }

    const { data: mediaRows, error: mediaError } = await mediaQuery;
    if (mediaError) throw mediaError;

    return NextResponse.json({
      ok: true,
      items: mediaRows ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to load desktop media history.",
      },
      { status: 500 },
    );
  }
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

    const body = (await request.json().catch(() => ({}))) as {
      cloudProjectId?: string | null;
      items?: MediaItemPayload[] | null;
    };

    const cloudProjectId = clean(body.cloudProjectId);
    if (!cloudProjectId) {
      return NextResponse.json(
        { ok: false, message: "Cloud project id is required." },
        { status: 400 },
      );
    }

    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0, skipped: 0, items: [] });
    }

    const normalizedItems: NormalizedMediaItem[] = items
      .map((item) => ({
        collection_id: clean(item.collection_id),
        storage_path: clean(item.storage_path),
        filename: clean(item.filename),
        mime_type: clean(item.mime_type),
        preview_url: clean(item.preview_url),
        thumbnail_url: clean(item.thumbnail_url),
        is_cover: item.is_cover === true,
      }))
      .filter((item) => item.collection_id && item.storage_path);

    if (normalizedItems.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0, skipped: items.length, items: [] });
    }

    const service = createDashboardServiceClient();

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
      .select("id,cover_photo_url,gallery_settings")
      .eq("id", cloudProjectId)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle();

    if (projectError) throw projectError;
    if (!projectRow) {
      return NextResponse.json(
        { ok: false, message: "Project not found." },
        { status: 404 },
      );
    }

    const collectionIds = Array.from(
      new Set(normalizedItems.map((item) => item.collection_id)),
    );

    const { data: collectionRows, error: collectionError } = await service
      .from("collections")
      .select("id,project_id,cover_photo_url")
      .eq("project_id", cloudProjectId)
      .in("id", collectionIds);

    if (collectionError) throw collectionError;

    const validCollectionIds = new Set(
      (collectionRows ?? []).map((row) => clean((row as { id?: string | null }).id)),
    );

    const filteredItems = normalizedItems.filter((item) =>
      validCollectionIds.has(item.collection_id),
    );

    if (filteredItems.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0, skipped: normalizedItems.length, items: [] });
    }

    const folderKeyCache = new Map<string, Promise<Set<string>>>();
    async function folderKeys(prefix: string) {
      const normalizedPrefix = clean(prefix);
      if (!normalizedPrefix) return new Set<string>();
      let pending = folderKeyCache.get(normalizedPrefix);
      if (!pending) {
        pending = listR2FolderImages(normalizedPrefix).then(
          (items) => new Set(items.map((item) => item.key)),
        );
        folderKeyCache.set(normalizedPrefix, pending);
      }
      return pending;
    }

    const resolvedItems = await Promise.all(
      filteredItems.map(async (item) => {
        let storagePath = item.storage_path;

        if (isProjectAlbumJpeg(storagePath, item.filename) && extensionOf(storagePath) === "png") {
          const jpegPath = withExtension(storagePath, ".jpg");
          const folderPrefix = folderPrefixOf(storagePath);
          if (folderPrefix) {
            const keys = await folderKeys(folderPrefix);
            if (keys.has(jpegPath)) {
              storagePath = jpegPath;
            }
          }
        }

        const inferredMimeType = inferMimeType(item.filename) || inferMimeType(storagePath);
        const incomingMimeType = clean(item.mime_type).toLowerCase();
        const mimeType = isProjectAlbumJpeg(storagePath, item.filename)
          ? "image/jpeg"
          : incomingMimeType || inferredMimeType || "image/jpeg";

        return {
          ...item,
          storage_path: storagePath,
          mime_type: mimeType,
        };
      }),
    );

    const { data: existingRows, error: existingError } = await service
      .from("media")
      .select("id,collection_id,storage_path,sort_order")
      .eq("project_id", cloudProjectId)
      .in("collection_id", Array.from(validCollectionIds));

    if (existingError) throw existingError;

    const existingKeys = new Set<string>();
    const nextSortOrderByCollection = new Map<string, number>();

    for (const raw of existingRows ?? []) {
      const row = raw as {
        collection_id?: string | null;
        storage_path?: string | null;
        sort_order?: number | string | null;
      };
      const collectionId = clean(row.collection_id);
      const storagePath = clean(row.storage_path);
      if (!collectionId || !storagePath) continue;
      existingKeys.add(`${collectionId}::${storagePath}`);

      const asInt =
        typeof row.sort_order === "number"
          ? row.sort_order
          : Number.parseInt(`${row.sort_order ?? ""}`, 10);
      const currentMax = nextSortOrderByCollection.get(collectionId) ?? 0;
      if (Number.isFinite(asInt)) {
        nextSortOrderByCollection.set(collectionId, Math.max(currentMax, asInt + 1));
      } else {
        nextSortOrderByCollection.set(collectionId, currentMax);
      }
    }

    const inserts: Array<Record<string, string | number | boolean | null>> = [];
    let skipped = normalizedItems.length - resolvedItems.length;

    for (const item of resolvedItems) {
      const key = `${item.collection_id}::${item.storage_path}`;
      if (existingKeys.has(key)) {
        skipped += 1;
        continue;
      }

      const nextSort = nextSortOrderByCollection.get(item.collection_id) ?? 0;
      nextSortOrderByCollection.set(item.collection_id, nextSort + 1);
      existingKeys.add(key);

      inserts.push({
        project_id: cloudProjectId,
        collection_id: item.collection_id,
        storage_path: item.storage_path,
        filename: item.filename || null,
        mime_type: item.mime_type,
        preview_url: item.preview_url || null,
        thumbnail_url: item.thumbnail_url || null,
        sort_order: nextSort,
        is_cover: item.is_cover,
      });
    }

    let insertedRows: unknown[] = [];
    if (inserts.length > 0) {
      const { data, error } = await service
        .from("media")
        .insert(inserts)
        .select("id,collection_id,storage_path,sort_order");

      if (error) throw error;
      insertedRows = (data ?? []) as unknown[];
    }

    const normalizedSettings = normalizeEventGallerySettings(
      (projectRow as { gallery_settings?: unknown } | null)?.gallery_settings,
    );
    const coverSource = normalizedSettings.extras.coverSource;

    if (coverSource !== "manual" && resolvedItems.length > 0) {
      const collectionRowsTyped = (collectionRows ?? []) as Array<{
        id?: string | null;
        cover_photo_url?: string | null;
      }>;

      if (normalizedSettings.extras.autoChooseAlbumCover) {
        const collectionCoverUpdates: Array<{ id: string; cover_photo_url: string }> = [];

        for (const collection of collectionRowsTyped) {
          const collectionId = clean(collection.id);
          if (!collectionId || clean(collection.cover_photo_url)) continue;

          const candidate = chooseCoverCandidate(
            resolvedItems.filter((item) => item.collection_id === collectionId),
            coverSource,
          );
          const candidateUrl = candidate ? preferredCoverUrl(candidate) : null;
          if (!candidateUrl) continue;

          collectionCoverUpdates.push({
            id: collectionId,
            cover_photo_url: candidateUrl,
          });
        }

        for (const update of collectionCoverUpdates) {
          const { error } = await service
            .from("collections")
            .update({
              cover_photo_url: update.cover_photo_url,
              updated_at: new Date().toISOString(),
            })
            .eq("id", update.id)
            .eq("project_id", cloudProjectId);

          if (error) throw error;
        }
      }

      if (
        normalizedSettings.extras.autoChooseProjectCover &&
        !clean((projectRow as { cover_photo_url?: string | null } | null)?.cover_photo_url)
      ) {
        const candidate = chooseCoverCandidate(resolvedItems, coverSource);
        const candidateUrl = candidate ? preferredCoverUrl(candidate) : null;

        if (candidateUrl) {
          const { error } = await service
            .from("projects")
            .update({
              cover_photo_url: candidateUrl,
              updated_at: new Date().toISOString(),
            })
            .eq("id", cloudProjectId)
            .eq("photographer_id", photographerRow.id);

          if (error) throw error;
        }
      }
    }

    return NextResponse.json({
      ok: true,
      inserted: inserts.length,
      skipped,
      items: insertedRows,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to register desktop media.",
      },
      { status: 500 },
    );
  }
}

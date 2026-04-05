import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

type FavoriteRow = {
  media_id: string | null;
  collection_id: string | null;
  viewer_email: string | null;
  created_at: string | null;
};

type VisitorRow = {
  viewer_email: string | null;
  last_opened_at: string | null;
};

type PreReleaseEmailRow = {
  email: string | null;
};

type CollectionRow = {
  id: string;
  title: string | null;
  cover_photo_url: string | null;
};

type MediaRow = {
  id: string;
  collection_id: string | null;
  storage_path: string | null;
  preview_url: string | null;
  thumbnail_url: string | null;
  filename: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function numericTime(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareRecent(a: string | null | undefined, b: string | null | undefined) {
  return numericTime(b) - numericTime(a);
}

function isMissingTable(error: unknown, table: string) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "42P01" &&
    (!(error as { message?: string }).message ||
      (error as { message?: string }).message?.includes(table))
  );
}

function emptySummary(warning = "") {
  return {
    ordersCount: 0,
    totalFavorites: 0,
    uniqueViewers: 0,
    albumsWithFavorites: 0,
    viewers: [] as Array<{
      viewerEmail: string;
      favoritesCount: number;
      lastActivityAt: string | null;
      albums: string[];
      preRegistered: boolean;
      openedGallery: boolean;
    }>,
    albums: [] as Array<{
      collectionId: string;
      title: string;
      favoritesCount: number;
      lastFavoritedAt: string | null;
      previewUrl: string;
    }>,
    recentFavorites: [] as Array<{
      mediaId: string;
      collectionId: string | null;
      collectionTitle: string;
      viewerEmail: string;
      createdAt: string | null;
      previewUrl: string;
      filename: string;
    }>,
    favoriteMedia: [] as Array<{
      mediaId: string;
      collectionId: string | null;
      collectionTitle: string;
      favoritesCount: number;
      latestFavoritedAt: string | null;
      previewUrl: string;
      filename: string;
      storagePath: string | null;
    }>,
    preRegisteredCount: 0,
    warning: clean(warning) || null,
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const { id: projectId } = await context.params;
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
      .eq("id", projectId)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle();

    if (projectError) throw projectError;
    if (!projectRow?.id) {
      return NextResponse.json(
        { ok: false, message: "Project not found." },
        { status: 404 },
      );
    }

    const [
      { count: ordersCount, error: ordersError },
      { data: collectionRows, error: collectionsError },
      favoritesResult,
      visitorsResult,
      { data: preReleaseRows, error: preReleaseError },
    ] = await Promise.all([
      service.from("orders").select("id", { head: true, count: "exact" }).eq("project_id", projectId),
      service
        .from("collections")
        .select("id,title,cover_photo_url")
        .eq("project_id", projectId),
      service
        .from("event_gallery_favorites")
        .select("media_id,collection_id,viewer_email,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
      service
        .from("event_gallery_visitors")
        .select("viewer_email,last_opened_at")
        .eq("project_id", projectId)
        .order("last_opened_at", { ascending: false }),
      service.from("pre_release_emails").select("email").eq("project_id", projectId),
    ]);

    if (ordersError) throw ordersError;
    if (collectionsError) throw collectionsError;
    if (preReleaseError) throw preReleaseError;

    const warnings: string[] = [];
    if (favoritesResult.error) {
      if (isMissingTable(favoritesResult.error, "event_gallery_favorites")) {
        warnings.push(
          "Event favorites will appear here after the new database table is applied.",
        );
      } else {
        throw favoritesResult.error;
      }
    }
    if (visitorsResult.error) {
      if (isMissingTable(visitorsResult.error, "event_gallery_visitors")) {
        warnings.push(
          "Gallery open tracking will appear here after the new visitors table is applied.",
        );
      } else {
        throw visitorsResult.error;
      }
    }

    const favorites = ((favoritesResult.data ?? []) as FavoriteRow[]);
    const visitors = ((visitorsResult.data ?? []) as VisitorRow[]);
    const collections = (collectionRows ?? []) as CollectionRow[];
    const preRegisteredEmails = Array.from(
      new Set(
        ((preReleaseRows ?? []) as PreReleaseEmailRow[])
          .map((row) => clean(row.email).toLowerCase())
          .filter(Boolean),
      ),
    );
    const preRegisteredSet = new Set(preRegisteredEmails);
    const collectionMap = new Map(
      collections.map((row) => [row.id, row] as const),
    );

    const mediaIds = Array.from(
      new Set(
        favorites
          .map((row) => clean(row.media_id))
          .filter((value) => value.length > 0),
      ),
    );

    const mediaRows = mediaIds.length
      ? (
          await service
            .from("media")
            .select("id,collection_id,storage_path,preview_url,thumbnail_url,filename")
            .eq("project_id", projectId)
            .in("id", mediaIds)
        )
      : { data: [] as MediaRow[], error: null };

    if (mediaRows.error) throw mediaRows.error;

    const mediaMap = new Map(
      ((mediaRows.data ?? []) as MediaRow[]).map((row) => [row.id, row] as const),
    );

    const viewerMap = new Map<
      string,
      {
        viewerEmail: string;
        favoritesCount: number;
        lastActivityAt: string | null;
        albums: Set<string>;
        preRegistered: boolean;
        openedGallery: boolean;
      }
    >();
    const albumMap = new Map<
      string,
      {
        collectionId: string;
        title: string;
        favoritesCount: number;
        lastFavoritedAt: string | null;
        previewUrl: string;
      }
    >();
    const favoriteMediaMap = new Map<
      string,
      {
        mediaId: string;
        collectionId: string | null;
        collectionTitle: string;
        favoritesCount: number;
        latestFavoritedAt: string | null;
        previewUrl: string;
        filename: string;
        storagePath: string | null;
      }
    >();

    const recentFavorites = favorites.slice(0, 8).map((row) => {
      const mediaId = clean(row.media_id);
      const mediaRow = mediaMap.get(mediaId);
      const collectionId = clean(row.collection_id) || clean(mediaRow?.collection_id) || null;
      const collectionRow = collectionId ? collectionMap.get(collectionId) : null;
      return {
        mediaId,
        collectionId,
        collectionTitle: clean(collectionRow?.title) || "Unassigned Album",
        viewerEmail: clean(row.viewer_email) || "Unknown viewer",
        createdAt: clean(row.created_at) || null,
        previewUrl:
          clean(mediaRow?.preview_url) ||
          clean(mediaRow?.thumbnail_url) ||
          clean(collectionRow?.cover_photo_url),
        filename: clean(mediaRow?.filename) || "Photo",
      };
    });

    for (const row of favorites) {
      const viewerEmail = clean(row.viewer_email).toLowerCase();
      const mediaId = clean(row.media_id);
      const mediaRow = mediaMap.get(mediaId);
      const collectionId = clean(row.collection_id) || clean(mediaRow?.collection_id);
      const collectionRow = collectionId ? collectionMap.get(collectionId) : null;
      const albumTitle = clean(collectionRow?.title) || "Unassigned Album";
      const createdAt = clean(row.created_at) || null;

      if (viewerEmail) {
        const existingViewer = viewerMap.get(viewerEmail);
        if (existingViewer) {
          existingViewer.favoritesCount += 1;
          if (compareRecent(existingViewer.lastActivityAt, createdAt) > 0) {
            existingViewer.lastActivityAt = createdAt;
          }
          existingViewer.albums.add(albumTitle);
        } else {
          viewerMap.set(viewerEmail, {
            viewerEmail,
            favoritesCount: 1,
            lastActivityAt: createdAt,
            albums: new Set([albumTitle]),
            preRegistered: preRegisteredSet.has(viewerEmail),
            openedGallery: true,
          });
        }
      }

      if (collectionId) {
        const previewUrl =
          clean(mediaRow?.preview_url) ||
          clean(mediaRow?.thumbnail_url) ||
          clean(collectionRow?.cover_photo_url);
        const existingAlbum = albumMap.get(collectionId);
        if (existingAlbum) {
          existingAlbum.favoritesCount += 1;
          if (compareRecent(existingAlbum.lastFavoritedAt, createdAt) > 0) {
            existingAlbum.lastFavoritedAt = createdAt;
          }
          if (!existingAlbum.previewUrl && previewUrl) {
            existingAlbum.previewUrl = previewUrl;
          }
        } else {
          albumMap.set(collectionId, {
            collectionId,
            title: clean(collectionRow?.title) || "Album",
            favoritesCount: 1,
            lastFavoritedAt: createdAt,
            previewUrl,
          });
        }
      }

      if (mediaId) {
        const previewUrl =
          clean(mediaRow?.preview_url) ||
          clean(mediaRow?.thumbnail_url) ||
          clean(collectionRow?.cover_photo_url);
        const existingMedia = favoriteMediaMap.get(mediaId);
        if (existingMedia) {
          existingMedia.favoritesCount += 1;
          if (compareRecent(existingMedia.latestFavoritedAt, createdAt) > 0) {
            existingMedia.latestFavoritedAt = createdAt;
          }
          if (!existingMedia.previewUrl && previewUrl) {
            existingMedia.previewUrl = previewUrl;
          }
          if (!existingMedia.storagePath && clean(mediaRow?.storage_path)) {
            existingMedia.storagePath = clean(mediaRow?.storage_path);
          }
        } else {
          favoriteMediaMap.set(mediaId, {
            mediaId,
            collectionId: collectionId || null,
            collectionTitle: albumTitle,
            favoritesCount: 1,
            latestFavoritedAt: createdAt,
            previewUrl,
            filename: clean(mediaRow?.filename) || "Photo",
            storagePath: clean(mediaRow?.storage_path) || null,
          });
        }
      }
    }

    for (const row of visitors) {
      const viewerEmail = clean(row.viewer_email).toLowerCase();
      const lastOpenedAt = clean(row.last_opened_at) || null;
      if (!viewerEmail) continue;
      const existingViewer = viewerMap.get(viewerEmail);
      if (existingViewer) {
        if (compareRecent(existingViewer.lastActivityAt, lastOpenedAt) > 0) {
          existingViewer.lastActivityAt = lastOpenedAt;
        }
        existingViewer.openedGallery = true;
        existingViewer.preRegistered = existingViewer.preRegistered || preRegisteredSet.has(viewerEmail);
      } else {
        viewerMap.set(viewerEmail, {
          viewerEmail,
          favoritesCount: 0,
          lastActivityAt: lastOpenedAt,
          albums: new Set<string>(),
          preRegistered: preRegisteredSet.has(viewerEmail),
          openedGallery: true,
        });
      }
    }

    for (const email of preRegisteredEmails) {
      if (!viewerMap.has(email)) {
        viewerMap.set(email, {
          viewerEmail: email,
          favoritesCount: 0,
          lastActivityAt: null,
          albums: new Set<string>(),
          preRegistered: true,
          openedGallery: false,
        });
      }
    }

    const viewers = Array.from(viewerMap.values())
      .map((row) => ({
        viewerEmail: row.viewerEmail,
        favoritesCount: row.favoritesCount,
        lastActivityAt: row.lastActivityAt,
        albums: Array.from(row.albums).sort((a, b) => a.localeCompare(b)).slice(0, 3),
        preRegistered: row.preRegistered,
        openedGallery: row.openedGallery,
      }))
      .sort((a, b) => {
        if (b.favoritesCount !== a.favoritesCount) {
          return b.favoritesCount - a.favoritesCount;
        }
        const recentDelta = compareRecent(a.lastActivityAt, b.lastActivityAt);
        if (recentDelta !== 0) return recentDelta;
        return a.viewerEmail.localeCompare(b.viewerEmail);
      })
      .slice(0, 25);

    const albums = Array.from(albumMap.values())
      .sort((a, b) => {
        if (b.favoritesCount !== a.favoritesCount) {
          return b.favoritesCount - a.favoritesCount;
        }
        const recentDelta = compareRecent(a.lastFavoritedAt, b.lastFavoritedAt);
        if (recentDelta !== 0) return recentDelta;
        return a.title.localeCompare(b.title, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });
    const favoriteMedia = Array.from(favoriteMediaMap.values()).sort((a, b) => {
      if (b.favoritesCount !== a.favoritesCount) {
        return b.favoritesCount - a.favoritesCount;
      }
      const recentDelta = compareRecent(a.latestFavoritedAt, b.latestFavoritedAt);
      if (recentDelta !== 0) return recentDelta;
      return a.filename.localeCompare(b.filename, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

    return NextResponse.json({
      ok: true,
      summary: {
        ordersCount: ordersCount ?? 0,
        totalFavorites: favorites.length,
        uniqueViewers: viewerMap.size,
        albumsWithFavorites: albumMap.size,
        viewers,
        albums,
        recentFavorites,
        favoriteMedia,
        preRegisteredCount: preRegisteredEmails.length,
        warning: warnings.length ? warnings.join(" ") : null,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to load favorite activity.",
      },
      { status: 500 },
    );
  }
}

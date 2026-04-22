import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";
import { buildStoredMediaUrls } from "@/lib/storage-images";
import { r2DeleteWithVariantsBestEffort } from "@/lib/r2";

export const dynamic = "force-dynamic";

const AlbumPatchBodySchema = z.object({
  title: z.string().max(500).nullable().optional(),
  cover_photo_url: z.string().max(2000).nullable().optional(),
  access_mode: z.string().max(32).nullable().optional(),
  access_pin: z.string().max(64).nullable().optional(),
});

const AlbumDeleteBodySchema = z.object({
  ids: z.array(z.string().max(128)).max(5000).optional(),
});

type CollectionRow = {
  id: string;
  project_id?: string | null;
  title?: string | null;
  kind?: string | null;
  slug?: string | null;
  cover_photo_url?: string | null;
  sort_order?: number | null;
  created_at?: string | null;
  access_mode?: string | null;
  access_pin?: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "album"
  );
}

function normalizeAccessMode(value: string | null | undefined) {
  const mode = clean(value).toLowerCase();
  if (!mode || mode === "inherit" || mode === "inherit_project" || mode === "project") {
    return "inherit";
  }
  if (mode === "public") return "public";
  if (mode === "pin" || mode === "protected" || mode === "private") return "pin";
  return "";
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; albumId: string }> },
) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const { id: projectId, albumId } = await context.params;
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

    const { data: projectData, error: projectError } = await service
      .from("projects")
      .select("id,title,client_name,status,portal_status,event_date,shoot_date")
      .eq("id", projectId)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle();

    if (projectError) throw projectError;
    if (!projectData) {
      return NextResponse.json(
        { ok: false, message: "Project not found." },
        { status: 404 },
      );
    }

    const { data: albumData, error: albumError } = await service
      .from("collections")
      .select("id,project_id,title,kind,access_mode,access_pin")
      .eq("id", albumId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (albumError) throw albumError;
    if (!albumData) {
      return NextResponse.json(
        { ok: false, message: "Album not found." },
        { status: 404 },
      );
    }

    const { data: mediaData, error: mediaError } = await service
      .from("media")
      .select("id,storage_path,thumbnail_url,preview_url,filename,mime_type,created_at,sort_order")
      .eq("project_id", projectId)
      .eq("collection_id", albumId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (mediaError) throw mediaError;

    const normalizedMedia = (mediaData ?? []).map((row) => {
      const mediaUrls = buildStoredMediaUrls({
        storagePath: row.storage_path,
        previewUrl: row.preview_url,
        thumbnailUrl: row.thumbnail_url,
      });

      return {
        ...row,
        download_url: mediaUrls.originalUrl || null,
        preview_url: mediaUrls.previewUrl || null,
        thumbnail_url: mediaUrls.thumbnailUrl || null,
      };
    });

    return NextResponse.json({
      ok: true,
      project: projectData,
      album: albumData,
      media: normalizedMedia,
    });
  } catch (error) {
    console.error("[dashboard:events:album:GET]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to load album." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; albumId: string }> },
) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const { id: projectId, albumId } = await context.params;
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

    const { data: projectData, error: projectError } = await service
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle();

    if (projectError) throw projectError;
    if (!projectData) {
      return NextResponse.json(
        { ok: false, message: "Project not found." },
        { status: 404 },
      );
    }

    const parsed = await parseJson(request, AlbumPatchBodySchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const updatePayload: Record<string, string | null> = {
      updated_at: new Date().toISOString(),
    };
    let hasUpdate = false;

    if (Object.prototype.hasOwnProperty.call(body, "title")) {
      const title = clean(body.title);
      if (!title) {
        return NextResponse.json(
          { ok: false, message: "Album name is required." },
          { status: 400 },
        );
      }

      updatePayload.title = title;
      updatePayload.slug = slugify(title);
      hasUpdate = true;
    }

    if (Object.prototype.hasOwnProperty.call(body, "cover_photo_url")) {
      updatePayload.cover_photo_url = clean(body.cover_photo_url) || null;
      hasUpdate = true;
    }

    if (Object.prototype.hasOwnProperty.call(body, "access_mode")) {
      const normalizedMode = normalizeAccessMode(body.access_mode);
      if (!normalizedMode) {
        return NextResponse.json(
          { ok: false, message: "Invalid album access mode." },
          { status: 400 },
        );
      }

      updatePayload.access_mode = normalizedMode;
      updatePayload.access_pin =
        normalizedMode === "pin" ? clean(body.access_pin) || null : null;
      updatePayload.access_updated_at = new Date().toISOString();
      updatePayload.access_updated_source = "cloud";
      hasUpdate = true;
    }

    if (!hasUpdate) {
      return NextResponse.json(
        { ok: false, message: "No album changes were provided." },
        { status: 400 },
      );
    }

    const { data: albumData, error: albumError } = await service
      .from("collections")
      .update(updatePayload)
      .eq("id", albumId)
      .eq("project_id", projectId)
      .select(
        "id,project_id,title,kind,slug,cover_photo_url,sort_order,created_at,access_mode,access_pin",
      )
      .maybeSingle();

    if (albumError) throw albumError;
    if (!albumData) {
      return NextResponse.json(
        { ok: false, message: "Album not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      album: albumData as CollectionRow,
    });
  } catch (error) {
    console.error("[dashboard:events:album:PATCH]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to update album." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; albumId: string }> },
) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const { id: projectId, albumId } = await context.params;
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

    const { data: projectData, error: projectError } = await service
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle();

    if (projectError) throw projectError;
    if (!projectData) {
      return NextResponse.json(
        { ok: false, message: "Project not found." },
        { status: 404 },
      );
    }

    const { data: albumData, error: albumError } = await service
      .from("collections")
      .select("id")
      .eq("id", albumId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (albumError) throw albumError;
    if (!albumData) {
      return NextResponse.json(
        { ok: false, message: "Album not found." },
        { status: 404 },
      );
    }

    const parsed = await parseJson(request, AlbumDeleteBodySchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;
    const deleteIds = Array.isArray(body.ids)
      ? body.ids.map((value) => clean(String(value))).filter(Boolean)
      : [];

    if (!deleteIds.length) {
      return NextResponse.json(
        { ok: false, message: "Select at least one photo to delete." },
        { status: 400 },
      );
    }

    const { data: mediaRows, error: mediaError } = await service
      .from("media")
      .select("id,storage_path")
      .eq("project_id", projectId)
      .eq("collection_id", albumId)
      .in("id", deleteIds);

    if (mediaError) throw mediaError;

    const storagePaths = Array.from(
      new Set(
        ((mediaRows ?? []) as Array<{ storage_path?: string | null }>)
          .map((row) => clean(row.storage_path))
          .filter(Boolean),
      ),
    );

    if (storagePaths.length) {
      await r2DeleteWithVariantsBestEffort(storagePaths);
    }

    const { error: deleteError } = await service
      .from("media")
      .delete()
      .eq("project_id", projectId)
      .eq("collection_id", albumId)
      .in("id", deleteIds);

    if (deleteError) throw deleteError;

    return NextResponse.json({ ok: true, deletedIds: deleteIds });
  } catch (error) {
    console.error("[dashboard:events:album:DELETE]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to delete photo(s)." },
      { status: 500 },
    );
  }
}

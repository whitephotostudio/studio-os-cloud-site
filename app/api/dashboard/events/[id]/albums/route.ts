import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { r2DeleteWithVariants } from "@/lib/r2";

export const dynamic = "force-dynamic";

type CollectionRow = {
  id: string;
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

async function resolveAuthorizedProject(
  request: NextRequest,
  projectId: string,
) {
  const { user } = await resolveDashboardAuth(request);
  if (!user) {
    return {
      response: NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      ),
    };
  }

  const service = createDashboardServiceClient();

  const { data: photographerRow, error: photographerError } = await service
    .from("photographers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (photographerError) throw photographerError;
  if (!photographerRow?.id) {
    return {
      response: NextResponse.json(
        { ok: false, message: "Photographer profile not found." },
        { status: 404 },
      ),
    };
  }

  const { data: projectData, error: projectError } = await service
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("photographer_id", photographerRow.id)
    .maybeSingle();

  if (projectError) throw projectError;
  if (!projectData) {
    return {
      response: NextResponse.json(
        { ok: false, message: "Project not found." },
        { status: 404 },
      ),
    };
  }

  return { service };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await context.params;
    const auth = await resolveAuthorizedProject(request, projectId);
    if ("response" in auth) return auth.response;

    const body = (await request.json().catch(() => ({}))) as {
      title?: string | null;
    };
    const title = clean(body.title);

    if (!title) {
      return NextResponse.json(
        { ok: false, message: "Album name is required." },
        { status: 400 },
      );
    }

    const { data: lastCollection, error: sortError } = await auth.service
      .from("collections")
      .select("sort_order")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sortError) throw sortError;

    const nextSortOrder = Number(lastCollection?.sort_order ?? -1) + 1;

    const { data: albumData, error: insertError } = await auth.service
      .from("collections")
      .insert({
        project_id: projectId,
        kind: "album",
        title,
        slug: slugify(title),
        sort_order: nextSortOrder,
        visibility: "public",
      })
      .select(
        "id,title,kind,slug,cover_photo_url,sort_order,created_at,access_mode,access_pin",
      )
      .single();

    if (insertError) throw insertError;

    return NextResponse.json({
      ok: true,
      album: albumData as CollectionRow,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Failed to create album.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await context.params;
    const auth = await resolveAuthorizedProject(request, projectId);
    if ("response" in auth) return auth.response;

    const body = (await request.json().catch(() => ({}))) as {
      ids?: string[];
    };
    const ids = Array.from(
      new Set((body.ids ?? []).map((value) => clean(value)).filter(Boolean)),
    );

    if (!ids.length) {
      return NextResponse.json(
        { ok: false, message: "Select at least one album to delete." },
        { status: 400 },
      );
    }

    const { data: albumRows, error: albumsError } = await auth.service
      .from("collections")
      .select("id")
      .eq("project_id", projectId)
      .in("id", ids);

    if (albumsError) throw albumsError;

    const deleteIds = Array.from(
      new Set(
        ((albumRows ?? []) as Array<{ id?: string | null }>)
          .map((row) => clean(row.id))
          .filter(Boolean),
      ),
    );

    if (!deleteIds.length) {
      return NextResponse.json(
        { ok: false, message: "Album not found." },
        { status: 404 },
      );
    }

    const { data: mediaRows, error: mediaFetchError } = await auth.service
      .from("media")
      .select("id,storage_path,collection_id")
      .eq("project_id", projectId)
      .in("collection_id", deleteIds);

    if (mediaFetchError) throw mediaFetchError;

    const storagePaths = Array.from(
      new Set(
        ((mediaRows ?? []) as Array<{ storage_path?: string | null }>)
          .map((row) => clean(row.storage_path))
          .filter(Boolean),
      ),
    );

    if (storagePaths.length > 0) {
      await r2DeleteWithVariants(storagePaths);
    }

    const { error: mediaDeleteError } = await auth.service
      .from("media")
      .delete()
      .eq("project_id", projectId)
      .in("collection_id", deleteIds);

    if (mediaDeleteError) throw mediaDeleteError;

    const { error: collectionDeleteError } = await auth.service
      .from("collections")
      .delete()
      .eq("project_id", projectId)
      .in("id", deleteIds);

    if (collectionDeleteError) throw collectionDeleteError;

    return NextResponse.json({
      ok: true,
      deletedIds: deleteIds,
      deletedMediaCount: mediaRows?.length ?? 0,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Failed to delete album.",
      },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

type ProjectRow = {
  id: string;
  title: string | null;
  client_name: string | null;
  linked_local_school_id: string | null;
  access_mode: string | null;
  access_pin: string | null;
  access_updated_at: string | null;
  access_updated_source: string | null;
  updated_at: string | null;
  event_date: string | null;
  shoot_date: string | null;
  order_due_date: string | null;
  expiration_date: string | null;
};

type CollectionRow = {
  id: string;
  title: string | null;
  local_id: string | null;
  kind: string | null;
  access_mode: string | null;
  access_pin: string | null;
  access_updated_at: string | null;
  access_updated_source: string | null;
  updated_at: string | null;
};

type AlbumPayload = {
  name?: string | null;
  localId?: string | null;
  accessMode?: string | null;
  accessPin?: string | null;
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

function normalizeProjectMode(value: string | null | undefined) {
  const mode = clean(value).toLowerCase();
  if (mode === "pin" || mode === "protected" || mode === "private") return "pin";
  return "public";
}

function normalizeAlbumMode(value: string | null | undefined) {
  const mode = clean(value).toLowerCase();
  if (!mode || mode === "inherit" || mode === "inherit_project" || mode === "project") {
    return "inherit";
  }
  if (mode === "public") return "public";
  if (mode === "pin" || mode === "protected" || mode === "private") return "pin";
  return "inherit";
}

function normalizeAlbumKey(value: string) {
  return clean(value).toLowerCase();
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
    const localProjectId = clean(searchParams.get("localProjectId"));
    const cloudProjectId = clean(searchParams.get("cloudProjectId"));
    const title = clean(searchParams.get("title"));

    if (!localProjectId && !cloudProjectId && !title) {
      return NextResponse.json(
        { ok: false, message: "A project lookup value is required." },
        { status: 400 },
      );
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

    const photographerId = photographerRow.id as string;
    let projectRow: ProjectRow | null = null;

    if (cloudProjectId) {
      const { data } = await service
        .from("projects")
        .select(
          "id,title,client_name,linked_local_school_id,access_mode,access_pin,access_updated_at,access_updated_source,updated_at,event_date,shoot_date,order_due_date,expiration_date",
        )
        .eq("id", cloudProjectId)
        .eq("workflow_type", "event")
        .eq("photographer_id", photographerId)
        .maybeSingle();
      projectRow = (data as ProjectRow | null) ?? null;
    }

    if (!projectRow && localProjectId) {
      const { data } = await service
        .from("projects")
        .select(
          "id,title,client_name,linked_local_school_id,access_mode,access_pin,access_updated_at,access_updated_source,updated_at,event_date,shoot_date,order_due_date,expiration_date",
        )
        .eq("workflow_type", "event")
        .eq("photographer_id", photographerId)
        .eq("linked_local_school_id", localProjectId)
        .maybeSingle();
      projectRow = (data as ProjectRow | null) ?? null;
    }

    if (!projectRow && title) {
      const { data } = await service
        .from("projects")
        .select(
          "id,title,client_name,linked_local_school_id,access_mode,access_pin,access_updated_at,access_updated_source,updated_at,event_date,shoot_date,order_due_date,expiration_date",
        )
        .eq("workflow_type", "event")
        .eq("photographer_id", photographerId)
        .ilike("title", title)
        .order("created_at", { ascending: false })
        .limit(1);
      projectRow = ((data ?? [])[0] as ProjectRow | undefined) ?? null;
    }

    if (!projectRow) {
      return NextResponse.json(
        { ok: false, message: "Project not found." },
        { status: 404 },
      );
    }

    const { data: collectionRows, error: collectionError } = await service
      .from("collections")
      .select(
        "id,title,local_id,kind,access_mode,access_pin,access_updated_at,access_updated_source,updated_at",
      )
      .eq("project_id", projectRow.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (collectionError) throw collectionError;

    return NextResponse.json({
      ok: true,
      project: projectRow,
      collections: (collectionRows ?? []) as CollectionRow[],
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to load desktop project access.",
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
      localProjectId?: string | null;
      cloudProjectId?: string | null;
      title?: string | null;
      clientName?: string | null;
      createdAt?: string | null;
      accessMode?: string | null;
      accessPin?: string | null;
      albums?: AlbumPayload[] | null;
    };

    const localProjectId = clean(body.localProjectId);
    const title = clean(body.title);
    if (!localProjectId) {
      return NextResponse.json(
        { ok: false, message: "Local project id is required." },
        { status: 400 },
      );
    }
    if (!title) {
      return NextResponse.json(
        { ok: false, message: "Project name is required." },
        { status: 400 },
      );
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

    const photographerId = photographerRow.id as string;
    const desiredProjectMode = normalizeProjectMode(body.accessMode);
    const desiredProjectPin =
      desiredProjectMode === "pin" ? clean(body.accessPin) || null : null;
    const normalizedDate =
      clean(body.createdAt).slice(0, 10) || new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();

    let projectRow: ProjectRow | null = null;
    const cloudProjectId = clean(body.cloudProjectId);

    if (cloudProjectId) {
      const { data } = await service
        .from("projects")
        .select(
          "id,title,client_name,linked_local_school_id,access_mode,access_pin,access_updated_at,access_updated_source,updated_at,event_date,shoot_date,order_due_date,expiration_date",
        )
        .eq("id", cloudProjectId)
        .eq("workflow_type", "event")
        .eq("photographer_id", photographerId)
        .maybeSingle();
      projectRow = (data as ProjectRow | null) ?? null;
    }

    if (!projectRow) {
      const { data } = await service
        .from("projects")
        .select(
          "id,title,client_name,linked_local_school_id,access_mode,access_pin,access_updated_at,access_updated_source,updated_at,event_date,shoot_date,order_due_date,expiration_date",
        )
        .eq("workflow_type", "event")
        .eq("photographer_id", photographerId)
        .eq("linked_local_school_id", localProjectId)
        .maybeSingle();
      projectRow = (data as ProjectRow | null) ?? null;
    }

    if (!projectRow) {
      const { data } = await service
        .from("projects")
        .select(
          "id,title,client_name,linked_local_school_id,access_mode,access_pin,access_updated_at,access_updated_source,updated_at,event_date,shoot_date,order_due_date,expiration_date",
        )
        .eq("workflow_type", "event")
        .eq("photographer_id", photographerId)
        .ilike("title", title)
        .order("created_at", { ascending: false })
        .limit(1);
      projectRow = ((data ?? [])[0] as ProjectRow | undefined) ?? null;
    }

    if (!projectRow) {
      const { data, error } = await service
        .from("projects")
        .insert({
          photographer_id: photographerId,
          workflow_type: "event",
          source_type: "cloud_only",
          status: "active",
          linked_local_school_id: localProjectId,
          title,
          client_name: clean(body.clientName) || null,
          event_date: normalizedDate,
          access_mode: desiredProjectMode,
          access_pin: desiredProjectPin,
          access_updated_at: nowIso,
          access_updated_source: "desktop_app",
          updated_at: nowIso,
        })
        .select(
          "id,title,client_name,linked_local_school_id,access_mode,access_pin,access_updated_at,access_updated_source,updated_at,event_date,shoot_date,order_due_date,expiration_date",
        )
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return NextResponse.json(
          { ok: false, message: "Unable to create cloud project." },
          { status: 500 },
        );
      }
      projectRow = data as ProjectRow;
    } else {
      const { data, error } = await service
        .from("projects")
        .update({
          linked_local_school_id: localProjectId,
          title,
          client_name: clean(body.clientName) || null,
          access_mode: desiredProjectMode,
          access_pin: desiredProjectPin,
          access_updated_at: nowIso,
          access_updated_source: "desktop_app",
          updated_at: nowIso,
        })
        .eq("id", projectRow.id)
        .eq("photographer_id", photographerId)
        .select(
          "id,title,client_name,linked_local_school_id,access_mode,access_pin,access_updated_at,access_updated_source,updated_at,event_date,shoot_date,order_due_date,expiration_date",
        )
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return NextResponse.json(
          { ok: false, message: "Cloud project is not editable for this account." },
          { status: 403 },
        );
      }
      projectRow = data as ProjectRow;
    }

    const { data: existingCollectionRows, error: existingCollectionsError } =
      await service
        .from("collections")
        .select(
          "id,title,local_id,kind,access_mode,access_pin,access_updated_at,access_updated_source,updated_at",
        )
        .eq("project_id", projectRow.id)
        .order("created_at", { ascending: true });

    if (existingCollectionsError) throw existingCollectionsError;

    const existingCollections = (existingCollectionRows ?? []) as CollectionRow[];
    const existingByLocalId = new Map<string, CollectionRow>();
    const existingByTitle = new Map<string, CollectionRow>();

    for (const row of existingCollections) {
      const localId = clean(row.local_id);
      const key = normalizeAlbumKey(row.title ?? "");
      if (localId) existingByLocalId.set(localId, row);
      if (key && !existingByTitle.has(key)) existingByTitle.set(key, row);
    }

    const syncedCollections: CollectionRow[] = [];
    const albums = Array.isArray(body.albums) ? body.albums : [];

    for (const album of albums) {
      const albumName = clean(album.name);
      if (!albumName) continue;

      const localId = clean(album.localId);
      const normalizedAlbumMode = normalizeAlbumMode(album.accessMode);
      const albumPin =
        normalizedAlbumMode === "pin" ? clean(album.accessPin) || null : null;
      const existing =
        (localId ? existingByLocalId.get(localId) : undefined) ??
        existingByTitle.get(normalizeAlbumKey(albumName));

      const collectionPayload = {
        title: albumName,
        slug: slugify(albumName),
        kind: existing?.kind || "album",
        local_id: localId || existing?.local_id || null,
        access_mode: normalizedAlbumMode,
        access_pin: albumPin,
        access_updated_at: nowIso,
        access_updated_source: "desktop_app",
        updated_at: nowIso,
      };

      if (existing) {
        const { data, error } = await service
          .from("collections")
          .update(collectionPayload)
          .eq("id", existing.id)
          .eq("project_id", projectRow.id)
          .select(
            "id,title,local_id,kind,access_mode,access_pin,access_updated_at,access_updated_source,updated_at",
          )
          .maybeSingle();

        if (error) throw error;
        if (data) syncedCollections.push(data as CollectionRow);
        continue;
      }

      const { data, error } = await service
        .from("collections")
        .insert({
          project_id: projectRow.id,
          ...collectionPayload,
        })
        .select(
          "id,title,local_id,kind,access_mode,access_pin,access_updated_at,access_updated_source,updated_at",
        )
        .maybeSingle();

      if (error) throw error;
      if (data) syncedCollections.push(data as CollectionRow);
    }

    return NextResponse.json({
      ok: true,
      message: `Project synced to cloud. Albums: ${syncedCollections.length}`,
      project: projectRow,
      collections: syncedCollections,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to sync desktop project access.",
      },
      { status: 500 },
    );
  }
}

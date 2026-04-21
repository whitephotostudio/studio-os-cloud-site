import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function slugify(value: string, fallback = "gallery") {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

// Valid gallery statuses matching the web dashboard
const VALID_STATUSES = ["active", "inactive", "pre_released", "closed"];

function normalizeGalleryStatus(value: string | null | undefined): string {
  const raw = clean(value).toLowerCase().replace("-", "_");
  return VALID_STATUSES.includes(raw) ? raw : "active";
}

function normalizeAccessMode(value: string | null | undefined): string {
  const raw = clean(value).toLowerCase();
  if (raw === "pin" || raw === "protected" || raw === "private") return "pin";
  return "public";
}

function buildGalleryUrl(
  projectId: string,
  slug: string | null | undefined,
  title: string,
): string {
  const effectiveSlug = clean(slug) || slugify(title);
  return `https://www.studiooscloud.com/gallery/${effectiveSlug}`;
}

// ─── POST: Sync access settings from desktop app to cloud ───────────
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
      galleryStatus?: string | null;
      albums?: Array<{
        name?: string | null;
        localId?: string | null;
        accessMode?: string | null;
        accessPin?: string | null;
      }> | null;
    };

    const service = createDashboardServiceClient();

    // ── Resolve photographer ──
    const { data: photographerRow, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (photographerError) throw photographerError;
    const photographerId = clean(photographerRow?.id);
    if (!photographerId) {
      return NextResponse.json(
        { ok: false, message: "Photographer profile not found." },
        { status: 404 },
      );
    }

    // ── Find or create project ──
    const cloudProjectId = clean(body.cloudProjectId);
    const localProjectId = clean(body.localProjectId);
    const title = clean(body.title) || "Untitled Project";
    const clientName = clean(body.clientName);
    const accessMode = normalizeAccessMode(body.accessMode);
    const accessPin = accessMode === "pin" ? clean(body.accessPin) : null;
    const galleryStatus = normalizeGalleryStatus(body.galleryStatus);
    const preRelease = galleryStatus === "pre_released";

    let projectId = cloudProjectId;

    if (projectId) {
      // Verify the project belongs to this photographer
      const { data: existing } = await service
        .from("projects")
        .select("id")
        .eq("id", projectId)
        .eq("photographer_id", photographerId)
        .maybeSingle();

      if (!existing?.id) projectId = "";
    }

    if (!projectId && localProjectId) {
      // Try to find by linked_local_school_id
      const { data: linked } = await service
        .from("projects")
        .select("id")
        .eq("linked_local_school_id", localProjectId)
        .eq("photographer_id", photographerId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (linked?.id) projectId = linked.id;
    }

    if (!projectId) {
      // Create new project
      const slug = slugify(title);
      const { data: inserted, error: insertError } = await service
        .from("projects")
        .insert({
          photographer_id: photographerId,
          // DB check constraints:
          //   workflow_type ∈ {school, event}
          //   source_type   ∈ {local_school_sync, cloud_only, hybrid}
          // Desktop-synced galleries are recorded as cloud_only events.
          workflow_type: "event",
          source_type: "cloud_only",
          title,
          client_name: clientName || null,
          linked_local_school_id: localProjectId || null,
          access_mode: accessMode,
          access_pin: accessPin,
          access_updated_at: new Date().toISOString(),
          access_updated_source: "desktop",
          portal_status: galleryStatus,
          pre_release: preRelease,
          gallery_slug: slug,
        })
        .select("id,gallery_slug")
        .single();

      if (insertError) throw insertError;
      projectId = clean(inserted?.id);
    } else {
      // Update existing project
      const { error: updateError } = await service
        .from("projects")
        .update({
          title,
          client_name: clientName || null,
          access_mode: accessMode,
          access_pin: accessPin,
          access_updated_at: new Date().toISOString(),
          access_updated_source: "desktop",
          portal_status: galleryStatus,
          pre_release: preRelease,
          updated_at: new Date().toISOString(),
        })
        .eq("id", projectId);

      if (updateError) throw updateError;
    }

    // ── Read back project for response ──
    const { data: projectRow, error: projectReadError } = await service
      .from("projects")
      .select(
        "id,title,client_name,shoot_date,event_date,order_due_date,expiration_date,portal_status,pre_release,gallery_slug,access_mode,access_pin,access_updated_at,access_updated_source,updated_at",
      )
      .eq("id", projectId)
      .single();

    if (projectReadError) throw projectReadError;

    const galleryUrl = buildGalleryUrl(
      projectId,
      projectRow?.gallery_slug,
      projectRow?.title ?? title,
    );

    // ── Sync album/collection access ──
    const albums = Array.isArray(body.albums) ? body.albums : [];
    const collectionResults: Array<Record<string, unknown>> = [];

    for (const album of albums) {
      const albumName = clean(album.name);
      if (!albumName) continue;

      const albumLocalId = clean(album.localId);
      const albumSlug = slugify(albumName);
      const albumAccessMode = clean(album.accessMode) || "inherit_project";
      const albumAccessPin =
        albumAccessMode === "pin" ? clean(album.accessPin) : null;

      // Find existing collection by local_id or slug/title
      let collectionId = "";

      if (albumLocalId) {
        const { data: byLocalId } = await service
          .from("collections")
          .select("id")
          .eq("project_id", projectId)
          .eq("local_id", albumLocalId)
          .is("deleted_at", null)
          .maybeSingle();

        if (byLocalId?.id) collectionId = byLocalId.id;
      }

      if (!collectionId) {
        const { data: bySlug } = await service
          .from("collections")
          .select("id")
          .eq("project_id", projectId)
          .eq("kind", "gallery")
          .or(`slug.eq.${albumSlug},title.ilike.${albumName}`)
          .is("deleted_at", null)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (bySlug?.id) collectionId = bySlug.id;
      }

      if (!collectionId) {
        // Get next sort_order
        const { data: lastRow } = await service
          .from("collections")
          .select("sort_order")
          .eq("project_id", projectId)
          .is("deleted_at", null)
          .order("sort_order", { ascending: false })
          .limit(1)
          .maybeSingle();

        const nextSort = (Number(lastRow?.sort_order ?? -1)) + 1;

        const { data: inserted, error: insertErr } = await service
          .from("collections")
          .insert({
            project_id: projectId,
            kind: "gallery",
            title: albumName,
            slug: albumSlug,
            sort_order: nextSort,
            visibility: "public",
            local_id: albumLocalId || null,
            sync_source: "desktop",
            access_mode: albumAccessMode,
            access_pin: albumAccessPin,
            access_updated_at: new Date().toISOString(),
            access_updated_source: "desktop",
          })
          .select("id")
          .single();

        if (insertErr) throw insertErr;
        collectionId = clean(inserted?.id);
      } else {
        // Update existing collection
        const updatePayload: Record<string, unknown> = {
          title: albumName,
          access_mode: albumAccessMode,
          access_pin: albumAccessPin,
          access_updated_at: new Date().toISOString(),
          access_updated_source: "desktop",
          updated_at: new Date().toISOString(),
        };
        if (albumLocalId) updatePayload.local_id = albumLocalId;

        const { error: updateErr } = await service
          .from("collections")
          .update(updatePayload)
          .eq("id", collectionId);

        if (updateErr) throw updateErr;
      }

      collectionResults.push({
        id: collectionId,
        title: albumName,
        local_id: albumLocalId,
        access_mode: albumAccessMode,
        access_pin: albumAccessPin,
        access_updated_at: new Date().toISOString(),
        access_updated_source: "desktop",
      });
    }

    return NextResponse.json({
      ok: true,
      project: {
        id: projectId,
        title: projectRow?.title ?? title,
        client_name: projectRow?.client_name ?? clientName,
        shoot_date: projectRow?.shoot_date ?? "",
        event_date: projectRow?.event_date ?? "",
        order_due_date: projectRow?.order_due_date ?? "",
        expiration_date: projectRow?.expiration_date ?? "",
        portal_status: projectRow?.portal_status ?? galleryStatus,
        gallery_status: projectRow?.portal_status ?? galleryStatus,
        pre_release: projectRow?.pre_release ?? preRelease,
        gallery_url: galleryUrl,
        gallery_slug: projectRow?.gallery_slug ?? "",
        access_mode: projectRow?.access_mode ?? accessMode,
        access_pin: projectRow?.access_pin ?? "",
        access_updated_at: projectRow?.access_updated_at ?? "",
        access_updated_source: projectRow?.access_updated_source ?? "desktop",
        updated_at: projectRow?.updated_at ?? "",
      },
      collections: collectionResults,
      message: `Access settings synced. Gallery is ${galleryStatus.replace("_", "-")}.`,
    });
  } catch (error: unknown) {
    console.error("[desktop-access POST]", error);
    return NextResponse.json(
      { ok: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}

// ─── GET: Pull access settings from cloud to desktop app ────────────
export async function GET(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const service = createDashboardServiceClient();

    // ── Resolve photographer ──
    const { data: photographerRow, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (photographerError) throw photographerError;
    const photographerId = clean(photographerRow?.id);
    if (!photographerId) {
      return NextResponse.json(
        { ok: false, message: "Photographer profile not found." },
        { status: 404 },
      );
    }

    const url = new URL(request.url);
    const mode = url.searchParams.get("mode");

    // ── mode=all: return all projects ──
    if (mode === "all") {
      const { data: allProjects, error: allError } = await service
        .from("projects")
        .select(
          "id,title,client_name,shoot_date,event_date,order_due_date,expiration_date,portal_status,pre_release,gallery_slug,access_mode,access_pin,access_updated_at,access_updated_source,linked_local_school_id,updated_at",
        )
        .eq("photographer_id", photographerId)
        .order("created_at", { ascending: false });

      if (allError) throw allError;

      const results = [];
      for (const proj of allProjects ?? []) {
        const { data: collections } = await service
          .from("collections")
          .select(
            "id,title,slug,local_id,access_mode,access_pin,access_updated_at,access_updated_source,sort_order",
          )
          .eq("project_id", proj.id)
          .is("deleted_at", null)
          .order("sort_order", { ascending: true });

        results.push({
          project: {
            ...proj,
            gallery_status: proj.portal_status,
            gallery_url: buildGalleryUrl(proj.id, proj.gallery_slug, proj.title),
          },
          collections: collections ?? [],
        });
      }

      return NextResponse.json({ ok: true, projects: results });
    }

    // ── Single project pull ──
    const cloudProjectId = clean(url.searchParams.get("cloudProjectId"));
    const localProjectId = clean(url.searchParams.get("localProjectId"));
    const titleHint = clean(url.searchParams.get("title"));

    let projectId = cloudProjectId;

    if (!projectId && localProjectId) {
      const { data: linked } = await service
        .from("projects")
        .select("id")
        .eq("linked_local_school_id", localProjectId)
        .eq("photographer_id", photographerId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (linked?.id) projectId = linked.id;
    }

    if (!projectId) {
      return NextResponse.json(
        { ok: false, message: "Cloud project not found." },
        { status: 404 },
      );
    }

    const { data: projectRow, error: projectError } = await service
      .from("projects")
      .select(
        "id,title,client_name,shoot_date,event_date,order_due_date,expiration_date,portal_status,pre_release,gallery_slug,access_mode,access_pin,access_updated_at,access_updated_source,linked_local_school_id,updated_at",
      )
      .eq("id", projectId)
      .eq("photographer_id", photographerId)
      .single();

    if (projectError) throw projectError;

    const { data: collections, error: collError } = await service
      .from("collections")
      .select(
        "id,title,slug,local_id,access_mode,access_pin,access_updated_at,access_updated_source,sort_order",
      )
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true });

    if (collError) throw collError;

    const galleryUrl = buildGalleryUrl(
      projectId,
      projectRow?.gallery_slug,
      projectRow?.title ?? titleHint,
    );

    return NextResponse.json({
      ok: true,
      project: {
        ...projectRow,
        gallery_status: projectRow?.portal_status,
        gallery_url: galleryUrl,
      },
      collections: collections ?? [],
    });
  } catch (error: unknown) {
    console.error("[desktop-access GET]", error);
    return NextResponse.json(
      { ok: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}

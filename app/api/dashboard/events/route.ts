import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

type ProjectRow = {
  id: string;
  title?: string | null;
  client_name?: string | null;
  workflow_type?: string | null;
  status?: string | null;
  portal_status?: string | null;
  shoot_date?: string | null;
  event_date?: string | null;
  cover_photo_url?: string | null;
};

type CollectionRow = {
  id: string;
  project_id?: string | null;
  kind?: string | null;
};

type MediaRow = {
  id: string;
  project_id?: string | null;
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

    const body = (await request.json().catch(() => ({}))) as {
      title?: string | null;
      clientName?: string | null;
      eventDate?: string | null;
      accessMode?: string | null;
      accessPin?: string | null;
    };

    const title = clean(body.title);
    if (!title) {
      return NextResponse.json(
        { ok: false, message: "Event name is required." },
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
    const accessMode = (clean(body.accessMode) || "public").toLowerCase() === "pin" ? "pin" : "public";
    const accessPin = accessMode === "pin" ? clean(body.accessPin) || null : null;
    const eventDate = clean(body.eventDate).slice(0, 10) || new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();

    // Generate a unique local id for web-created projects
    const localId = `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const { data, error } = await service
      .from("projects")
      .insert({
        photographer_id: photographerId,
        workflow_type: "event",
        source_type: "cloud_only",
        status: "active",
        linked_local_school_id: localId,
        title,
        client_name: clean(body.clientName) || null,
        event_date: eventDate,
        access_mode: accessMode,
        access_pin: accessPin,
        access_updated_at: nowIso,
        access_updated_source: "cloud",
        updated_at: nowIso,
      })
      .select("id,title,client_name,event_date,access_mode,status")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { ok: false, message: "Unable to create event." },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, project: data });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to create event.",
      },
      { status: 500 },
    );
  }
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

    const service = createDashboardServiceClient();

    const { data: photographerRow, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (photographerError) throw photographerError;
    if (!photographerRow?.id) {
      return NextResponse.json({
        ok: true,
        projects: [],
        albumCounts: {},
        imageCounts: {},
      });
    }

    const { data: projectRows, error: projectsError } = await service
      .from("projects")
      .select(
        "id,title,client_name,workflow_type,status,portal_status,shoot_date,event_date,cover_photo_url",
      )
      .eq("photographer_id", photographerRow.id)
      .eq("workflow_type", "event")
      .order("event_date", { ascending: false })
      .order("shoot_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (projectsError) throw projectsError;

    const projects = (projectRows ?? []) as ProjectRow[];
    const ids = projects.map((row) => row.id);

    if (!ids.length) {
      return NextResponse.json({
        ok: true,
        projects,
        albumCounts: {},
        imageCounts: {},
      });
    }

    const [collectionsRes, mediaRes] = await Promise.all([
      service.from("collections").select("id,project_id,kind").in("project_id", ids),
      service.from("media").select("id,project_id").in("project_id", ids),
    ]);

    if (collectionsRes.error) throw collectionsRes.error;
    if (mediaRes.error) throw mediaRes.error;

    const albumCounts: Record<string, number> = {};
    for (const row of (collectionsRes.data ?? []) as CollectionRow[]) {
      const projectId = clean(row.project_id);
      if (!projectId) continue;
      const kind = clean(row.kind).toLowerCase();
      if (kind && kind !== "album" && kind !== "gallery") continue;
      albumCounts[projectId] = (albumCounts[projectId] ?? 0) + 1;
    }

    const imageCounts: Record<string, number> = {};
    for (const row of (mediaRes.data ?? []) as MediaRow[]) {
      const projectId = clean(row.project_id);
      if (!projectId) continue;
      imageCounts[projectId] = (imageCounts[projectId] ?? 0) + 1;
    }

    return NextResponse.json({
      ok: true,
      projects,
      albumCounts,
      imageCounts,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to load events.",
      },
      { status: 500 },
    );
  }
}

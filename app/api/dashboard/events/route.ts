import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";
import { guardAgreement } from "@/lib/require-agreement";

export const dynamic = "force-dynamic";

const CreateEventBodySchema = z.object({
  title: z.string().max(500).nullable().optional(),
  clientName: z.string().max(500).nullable().optional(),
  eventDate: z.string().max(64).nullable().optional(),
  accessMode: z.string().max(32).nullable().optional(),
  accessPin: z.string().max(64).nullable().optional(),
});

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
  cover_focal_x?: number | null;
  cover_focal_y?: number | null;
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

    const parsed = await parseJson(request, CreateEventBodySchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const title = clean(body.title);
    if (!title) {
      return NextResponse.json(
        { ok: false, message: "Event name is required." },
        { status: 400 },
      );
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
      .select("id,default_package_profile_id")
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
    const defaultProfileId = ((photographerRow as Record<string, unknown>).default_package_profile_id as string | null) ?? null;
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
        ...(defaultProfileId ? { package_profile_id: defaultProfileId } : {}),
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
    console.error("[dashboard:events:POST]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to create event." },
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

    // Pagination params — defaults: page 1, 50 projects per page
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: projectRows, error: projectsError, count: totalCount } = await service
      .from("projects")
      .select(
        "id,title,client_name,workflow_type,status,portal_status,shoot_date,event_date,cover_photo_url,cover_focal_x,cover_focal_y,gallery_slug",
        { count: "exact" },
      )
      .eq("photographer_id", photographerRow.id)
      .eq("workflow_type", "event")
      .order("event_date", { ascending: false })
      .order("shoot_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (projectsError) throw projectsError;

    const projects = (projectRows ?? []) as ProjectRow[];
    const ids = projects.map((row) => row.id);

    if (!ids.length) {
      return NextResponse.json({
        ok: true,
        projects,
        albumCounts: {},
        imageCounts: {},
        page,
        totalCount: totalCount ?? 0,
      });
    }

    // Use lightweight count queries instead of fetching all rows
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
      page,
      totalCount: totalCount ?? 0,
    });
  } catch (error) {
    console.error("[dashboard:events:GET]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to load events." },
      { status: 500 },
    );
  }
}

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

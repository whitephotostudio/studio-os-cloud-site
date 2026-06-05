import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

type SchoolRow = {
  id: string;
  school_name: string | null;
};

type ProjectRow = {
  id: string;
  title: string | null;
  client_name: string | null;
};

type DownloadRow = {
  id: string;
  viewer_email: string | null;
  download_type: string | null;
  download_count: number | null;
  media_ids: string[] | null;
  created_at: string | null;
  school_id?: string | null;
  project_id?: string | null;
};

type DownloadActivity = {
  id: string;
  kind: "school" | "event";
  galleryName: string;
  viewerEmail: string;
  downloadType: string;
  downloadCount: number;
  mediaCount: number;
  createdAt: string | null;
  href: string;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function isDownloadActivity(value: DownloadActivity | null): value is DownloadActivity {
  return value !== null;
}

function latestFirst(a: DownloadActivity, b: DownloadActivity) {
  return (
    (b.createdAt ? new Date(b.createdAt).getTime() : 0) -
    (a.createdAt ? new Date(a.createdAt).getTime() : 0)
  );
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
    const { data: photographer, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (photographerError) throw photographerError;
    if (!photographer?.id) {
      return NextResponse.json(
        { ok: false, message: "Photographer not found." },
        { status: 404 },
      );
    }

    const [
      { data: schoolRows, error: schoolsError },
      { data: projectRows, error: projectsError },
    ] = await Promise.all([
      service
        .from("schools")
        .select("id,school_name")
        .eq("photographer_id", photographer.id),
      service
        .from("projects")
        .select("id,title,client_name")
        .eq("photographer_id", photographer.id),
    ]);

    if (schoolsError) throw schoolsError;
    if (projectsError) throw projectsError;

    const schools = (schoolRows ?? []) as SchoolRow[];
    const projects = (projectRows ?? []) as ProjectRow[];
    const schoolIds = schools.map((row) => row.id);
    const projectIds = projects.map((row) => row.id);
    const schoolById = new Map(schools.map((row) => [row.id, row]));
    const projectById = new Map(projects.map((row) => [row.id, row]));

    const [schoolDownloadResult, eventDownloadResult] = await Promise.all([
      schoolIds.length
        ? service
            .from("school_gallery_downloads")
            .select("id,school_id,viewer_email,download_type,download_count,media_ids,created_at")
            .in("school_id", schoolIds)
            .order("created_at", { ascending: false })
            .limit(40)
        : Promise.resolve({ data: [], error: null }),
      projectIds.length
        ? service
            .from("event_gallery_downloads")
            .select("id,project_id,viewer_email,download_type,download_count,media_ids,created_at")
            .in("project_id", projectIds)
            .order("created_at", { ascending: false })
            .limit(40)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (schoolDownloadResult.error) throw schoolDownloadResult.error;
    if (eventDownloadResult.error) throw eventDownloadResult.error;

    const schoolActivities: DownloadActivity[] = ((schoolDownloadResult.data ?? []) as DownloadRow[])
      .map((row): DownloadActivity | null => {
        const school = row.school_id ? schoolById.get(row.school_id) : null;
        if (!school) return null;
        return {
          id: row.id,
          kind: "school" as const,
          galleryName: clean(school.school_name) || "School gallery",
          viewerEmail: clean(row.viewer_email),
          downloadType: clean(row.download_type) || "gallery",
          downloadCount:
            Number(row.download_count ?? 0) ||
            (Array.isArray(row.media_ids) ? row.media_ids.length : 0),
          mediaCount: Array.isArray(row.media_ids) ? row.media_ids.length : 0,
          createdAt: row.created_at,
          href: `/dashboard/projects/schools/${school.id}/visitors`,
        };
      })
      .filter(isDownloadActivity);

    const eventActivities: DownloadActivity[] = ((eventDownloadResult.data ?? []) as DownloadRow[])
      .map((row): DownloadActivity | null => {
        const project = row.project_id ? projectById.get(row.project_id) : null;
        if (!project) return null;
        return {
          id: row.id,
          kind: "event" as const,
          galleryName:
            clean(project.title) || clean(project.client_name) || "Event gallery",
          viewerEmail: clean(row.viewer_email),
          downloadType: clean(row.download_type) || "gallery",
          downloadCount:
            Number(row.download_count ?? 0) ||
            (Array.isArray(row.media_ids) ? row.media_ids.length : 0),
          mediaCount: Array.isArray(row.media_ids) ? row.media_ids.length : 0,
          createdAt: row.created_at,
          href: `/dashboard/projects/${project.id}/visitors`,
        };
      })
      .filter(isDownloadActivity);

    const activities = [...schoolActivities, ...eventActivities]
      .sort(latestFirst)
      .slice(0, 12);

    return NextResponse.json({ ok: true, activities });
  } catch (error) {
    console.error("[dashboard:download-activity]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to load download activity." },
      { status: 500 },
    );
  }
}

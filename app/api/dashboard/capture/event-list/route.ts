import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

type MediaRow = {
  id: string;
  storage_path: string | null;
  filename: string | null;
  collection_id: string | null;
};

// Event photo list (mobile Sort panel).
//
// Returns an event/project's photos (from the `media` table) so the mobile Sort
// view can show them with delete. Read-only, scoped to a project the
// authenticated photographer owns.
export async function POST(request: NextRequest) {
  const auth = await resolveDashboardAuth(request);
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createDashboardServiceClient();

  const { data: photographer } = await service
    .from("photographers")
    .select("id")
    .eq("user_id", auth.user.id)
    .maybeSingle<{ id: string }>();
  if (!photographer?.id) {
    return NextResponse.json(
      { error: "Photographer profile not found." },
      { status: 403 },
    );
  }

  let body: { projectId?: string };
  try {
    body = (await request.json()) as { projectId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const projectId = clean(body.projectId);
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required." }, { status: 400 });
  }

  const { data: project } = await service
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("photographer_id", photographer.id)
    .maybeSingle<{ id: string }>();
  if (!project?.id) {
    return NextResponse.json(
      { error: "Event not found for this account." },
      { status: 404 },
    );
  }

  const { data: mediaData, error } = await service
    .from("media")
    .select("id, storage_path, filename, collection_id")
    .eq("project_id", projectId)
    .order("filename", { ascending: true })
    .limit(2000);
  if (error) {
    console.error("[capture/event-list] media query failed", error);
    return NextResponse.json({ error: "Could not load photos." }, { status: 502 });
  }

  const photos = ((mediaData ?? []) as MediaRow[])
    .filter((m) => clean(m.storage_path))
    .map((m) => ({
      id: m.id,
      key: clean(m.storage_path),
      name: clean(m.filename) || "Photo",
      albumId: clean(m.collection_id),
    }));

  return NextResponse.json({ ok: true, photos, count: photos.length });
}

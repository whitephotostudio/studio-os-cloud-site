import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { guardAgreement } from "@/lib/require-agreement";
import { r2DeleteWithVariantsBestEffort } from "@/lib/r2";

export const dynamic = "force-dynamic";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

type MediaRow = {
  id: string;
  project_id: string | null;
  storage_path: string | null;
};

// Event photo delete (mobile Sort panel).
//
// Deletes one event/project photo: removes its R2 object (+ variants) and the
// `media` row. Scoped to a project the authenticated photographer owns.
export async function POST(request: NextRequest) {
  const auth = await resolveDashboardAuth(request);
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createDashboardServiceClient();

  const guard = await guardAgreement({ service, userId: auth.user.id });
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

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

  let body: { projectId?: string; mediaId?: string };
  try {
    body = (await request.json()) as { projectId?: string; mediaId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const projectId = clean(body.projectId);
  const mediaId = clean(body.mediaId);
  if (!projectId || !mediaId) {
    return NextResponse.json(
      { error: "projectId and mediaId are required." },
      { status: 400 },
    );
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

  const { data: media } = await service
    .from("media")
    .select("id, project_id, storage_path")
    .eq("id", mediaId)
    .eq("project_id", projectId)
    .maybeSingle<MediaRow>();
  if (!media?.id) {
    return NextResponse.json(
      { error: "Photo not found in this event." },
      { status: 404 },
    );
  }

  const storagePath = clean(media.storage_path);
  if (storagePath) {
    await r2DeleteWithVariantsBestEffort([storagePath]);
  }

  const { error: delErr } = await service
    .from("media")
    .delete()
    .eq("id", mediaId)
    .eq("project_id", projectId);
  if (delErr) {
    console.error("[capture/event-photo-delete] db delete failed", delErr);
    return NextResponse.json(
      { error: "Could not delete the photo." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}

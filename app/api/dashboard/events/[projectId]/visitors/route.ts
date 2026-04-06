import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/events/[projectId]/visitors
 * Returns visitors with their orders, downloads, favorites for an event gallery.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { user } = await resolveDashboardAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;
  const service = createDashboardServiceClient();

  // Verify photographer owns this project
  const { data: pgRow } = await service
    .from("photographers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!pgRow) {
    return NextResponse.json({ error: "Photographer not found" }, { status: 403 });
  }

  const { data: project } = await service
    .from("projects")
    .select("id, photographer_id, name")
    .eq("id", projectId)
    .maybeSingle();

  if (!project || project.photographer_id !== pgRow.id) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Fetch visitors
  const { data: visitors } = await service
    .from("event_gallery_visitors")
    .select("*")
    .eq("project_id", projectId)
    .order("last_opened_at", { ascending: false });

  // Fetch downloads
  const { data: downloads } = await service
    .from("event_gallery_downloads")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  // Fetch favorites
  const { data: favorites } = await service
    .from("event_gallery_favorites")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  // Fetch orders for this event project
  const { data: orders } = await service
    .from("orders")
    .select("id, status, total_cents, created_at, parent_email, customer_email, special_notes")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  // Build enriched visitor list
  const visitorList = (visitors ?? []).map((v: Record<string, unknown>) => {
    const email = (v.viewer_email as string || "").toLowerCase();

    const visitorOrders = (orders ?? []).filter((o: Record<string, unknown>) => {
      const pe = (o.parent_email as string || "").toLowerCase();
      const ce = (o.customer_email as string || "").toLowerCase();
      return pe === email || ce === email;
    }).map((o: Record<string, unknown>) => ({
      id: o.id,
      status: o.status,
      totalCents: o.total_cents,
      createdAt: o.created_at,
    }));

    const visitorDownloads = (downloads ?? []).filter((d: Record<string, unknown>) =>
      (d.viewer_email as string || "").toLowerCase() === email
    ).map((d: Record<string, unknown>) => ({
      id: d.id,
      downloadType: d.download_type,
      downloadCount: d.download_count,
      mediaIds: d.media_ids,
      createdAt: d.created_at,
    }));

    const visitorFavorites = (favorites ?? []).filter((f: Record<string, unknown>) =>
      (f.viewer_email as string || "").toLowerCase() === email
    ).map((f: Record<string, unknown>) => ({
      id: f.id,
      mediaId: f.media_id,
      createdAt: f.created_at,
    }));

    return {
      id: v.id,
      email: v.viewer_email,
      firstVisit: v.created_at,
      lastVisit: v.last_opened_at,
      orders: visitorOrders,
      downloads: visitorDownloads,
      favorites: visitorFavorites,
      orderCount: visitorOrders.length,
      downloadCount: visitorDownloads.reduce((sum, d) => sum + (Number(d.downloadCount) || 0), 0 as number),
      favoriteCount: visitorFavorites.length,
    };
  });

  return NextResponse.json({
    projectName: project.name,
    visitors: visitorList,
    totalVisitors: visitorList.length,
  });
}

/**
 * PATCH /api/dashboard/events/[projectId]/visitors
 * Update a visitor's email address.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { user } = await resolveDashboardAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;
  const service = createDashboardServiceClient();

  const { data: pgRow } = await service
    .from("photographers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!pgRow) return NextResponse.json({ error: "Photographer not found" }, { status: 403 });

  const { data: project } = await service
    .from("projects")
    .select("id, photographer_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project || project.photographer_id !== pgRow.id) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await request.json();
  const { visitorId, newEmail } = body as { visitorId: string; newEmail: string };

  if (!visitorId || !newEmail) {
    return NextResponse.json({ error: "Missing visitorId or newEmail" }, { status: 400 });
  }

  const { error } = await service
    .from("event_gallery_visitors")
    .update({ viewer_email: newEmail.trim().toLowerCase() })
    .eq("id", visitorId)
    .eq("project_id", projectId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

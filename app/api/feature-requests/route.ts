import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";
import {
  createFeatureRequest,
  listFeatureRequests,
  listVotesByPhotographer,
  updateFeatureRequestStatus,
  type FeatureRequestStatus,
} from "@/lib/feature-requests";

export const dynamic = "force-dynamic";

/** GET — list all feature requests with vote info for the current user. */
export async function GET(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json({ ok: false, message: "Sign in required." }, { status: 401 });
    }

    const service = createDashboardServiceClient();

    // Get photographer id
    const { data: pg } = await service
      .from("photographers")
      .select("id, is_platform_admin")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!pg) {
      return NextResponse.json({ ok: false, message: "Photographer not found." }, { status: 404 });
    }

    // Check if admin
    const isAdmin = pg.is_platform_admin || user.email?.toLowerCase() === "harout@me.com";

    const statusFilter = request.nextUrl.searchParams.get("status") as FeatureRequestStatus | null;
    const requests = await listFeatureRequests(service, statusFilter ? { status: statusFilter } : undefined);
    const votedSet = await listVotesByPhotographer(service, pg.id);

    // If admin, fetch author emails for each request
    let authorEmails: Record<string, string> = {};
    if (isAdmin && requests.length > 0) {
      const photographerIds = [...new Set(requests.map((r) => r.photographer_id))];
      const { data: photographers } = await service
        .from("photographers")
        .select("id, user_id")
        .in("id", photographerIds);

      if (photographers && photographers.length > 0) {
        const userIds = photographers.map((p: { user_id: string }) => p.user_id);
        const { data: { users } } = await service.auth.admin.listUsers();
        const userMap = new Map(
          (users ?? []).map((u: { id: string; email?: string }) => [u.id, u.email ?? ""])
        );
        for (const p of photographers) {
          authorEmails[p.id] = (userMap.get(p.user_id) as string) ?? "";
        }
      }
    }

    const enriched = requests.map((r) => ({
      ...r,
      has_voted: votedSet.has(r.id),
      ...(isAdmin ? { author_email: authorEmails[r.photographer_id] ?? "" } : {}),
    }));

    return NextResponse.json({ ok: true, data: enriched });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Failed to load requests." },
      { status: 500 },
    );
  }
}

/** POST — create a new feature request or update status (admin). */
export async function POST(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json({ ok: false, message: "Sign in required." }, { status: 401 });
    }

    const service = createDashboardServiceClient();
    const body = await request.json();

    // Get photographer
    const { data: pg } = await service
      .from("photographers")
      .select("id, is_platform_admin")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!pg) {
      return NextResponse.json({ ok: false, message: "Photographer not found." }, { status: 404 });
    }

    // Admin update
    if (body.action === "update_status") {
      const isAdmin = pg.is_platform_admin || user.email?.toLowerCase() === "harout@me.com";
      if (!isAdmin) {
        return NextResponse.json({ ok: false, message: "Admin access required." }, { status: 403 });
      }

      const updated = await updateFeatureRequestStatus(
        service,
        body.request_id,
        body.status,
        body.admin_note,
      );
      return NextResponse.json({ ok: true, data: updated });
    }

    // Create new request
    const title = (body.title ?? "").trim();
    const description = (body.description ?? "").trim();

    if (!title) {
      return NextResponse.json({ ok: false, message: "Title is required." }, { status: 400 });
    }

    if (title.length > 200) {
      return NextResponse.json({ ok: false, message: "Title must be under 200 characters." }, { status: 400 });
    }

    const created = await createFeatureRequest(service, pg.id, title, description);
    return NextResponse.json({ ok: true, data: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Failed to create request." },
      { status: 500 },
    );
  }
}

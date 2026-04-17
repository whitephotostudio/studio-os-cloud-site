// GET /api/dashboard/admin/badge
//
// Lightweight count of photographers who registered after the platform
// admin's last visit to /dashboard/admin/users. Used by the sidebar to
// render a small "N" badge on the Admin link. The count clears when the
// admin opens the users page (the GET there stamps admin_seen_users_at).

import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { getOrCreatePhotographerByUser } from "@/lib/payments";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, count: 0, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const service = createDashboardServiceClient();
    const photographer = await getOrCreatePhotographerByUser(service, user);
    if (!photographer.is_platform_admin) {
      // Non-admins always get count: 0 with a 200, so the sidebar component
      // can render unconditionally without leaking admin status.
      return NextResponse.json({ ok: true, count: 0 });
    }

    const { data: adminRow } = await service
      .from("photographers")
      .select("admin_seen_users_at")
      .eq("id", photographer.id)
      .maybeSingle();

    const seenAt = adminRow?.admin_seen_users_at as string | null;

    let query = service
      .from("photographers")
      .select("id", { count: "exact", head: true });

    if (seenAt) {
      query = query.gt("created_at", seenAt);
    }

    const { count, error } = await query;
    if (error) {
      return NextResponse.json({ ok: true, count: 0 });
    }

    return NextResponse.json({ ok: true, count: count ?? 0 });
  } catch {
    // Badge is non-critical — never throw an error to the client.
    return NextResponse.json({ ok: true, count: 0 });
  }
}

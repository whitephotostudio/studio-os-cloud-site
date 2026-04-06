import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/dashboard/schools/[schoolId]/visitors
 * Returns visitors with their orders, downloads, favorites for a school gallery.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ schoolId: string }> },
) {
  const { user } = await resolveDashboardAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { schoolId } = await params;
  const service = createDashboardServiceClient();

  // Verify photographer owns this school
  const { data: pgRow } = await service
    .from("photographers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!pgRow) {
    return NextResponse.json({ error: "Photographer not found" }, { status: 403 });
  }

  const { data: school } = await service
    .from("schools")
    .select("id, photographer_id, school_name")
    .eq("id", schoolId)
    .maybeSingle();

  if (!school || school.photographer_id !== pgRow.id) {
    return NextResponse.json({ error: "School not found" }, { status: 404 });
  }

  // Fetch visitors
  const { data: visitors } = await service
    .from("school_gallery_visitors")
    .select("*")
    .eq("school_id", schoolId)
    .order("last_opened_at", { ascending: false });

  // Fetch downloads for this school
  const { data: downloads } = await service
    .from("school_gallery_downloads")
    .select("*")
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false });

  // Fetch orders for this school
  const { data: orders } = await service
    .from("orders")
    .select("id, status, total_cents, created_at, parent_email, customer_email, special_notes, student:students(first_name, last_name, class_name)")
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false });

  // Build enriched visitor list
  const visitorList = (visitors ?? []).map((v: Record<string, unknown>) => {
    const email = (v.viewer_email as string || "").toLowerCase();

    // Find orders by this visitor
    const visitorOrders = (orders ?? []).filter((o: Record<string, unknown>) => {
      const pe = (o.parent_email as string || "").toLowerCase();
      const ce = (o.customer_email as string || "").toLowerCase();
      return pe === email || ce === email;
    }).map((o: Record<string, unknown>) => ({
      id: o.id,
      status: o.status,
      totalCents: o.total_cents,
      createdAt: o.created_at,
      studentName: (() => {
        const s = o.student as Record<string, unknown> | null;
        if (!s) return "";
        return `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim();
      })(),
      className: (() => {
        const s = o.student as Record<string, unknown> | null;
        return (s?.class_name as string) ?? "";
      })(),
    }));

    // Find downloads by this visitor
    const visitorDownloads = (downloads ?? []).filter((d: Record<string, unknown>) =>
      (d.viewer_email as string || "").toLowerCase() === email
    ).map((d: Record<string, unknown>) => ({
      id: d.id,
      downloadType: d.download_type,
      downloadCount: d.download_count,
      mediaIds: d.media_ids,
      createdAt: d.created_at,
    }));

    return {
      id: v.id,
      email: v.viewer_email,
      firstVisit: v.created_at,
      lastVisit: v.last_opened_at,
      orders: visitorOrders,
      downloads: visitorDownloads,
      orderCount: visitorOrders.length,
      downloadCount: visitorDownloads.reduce((sum, d) => sum + (Number(d.downloadCount) || 0), 0 as number),
    };
  });

  return NextResponse.json({
    schoolName: school.school_name,
    visitors: visitorList,
    totalVisitors: visitorList.length,
    totalOrders: (orders ?? []).length,
  });
}

/**
 * PATCH /api/dashboard/schools/[schoolId]/visitors
 * Update a visitor's email address.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ schoolId: string }> },
) {
  const { user } = await resolveDashboardAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { schoolId } = await params;
  const service = createDashboardServiceClient();

  const { data: pgRow } = await service
    .from("photographers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!pgRow) return NextResponse.json({ error: "Photographer not found" }, { status: 403 });

  const { data: school } = await service
    .from("schools")
    .select("id, photographer_id")
    .eq("id", schoolId)
    .maybeSingle();
  if (!school || school.photographer_id !== pgRow.id) {
    return NextResponse.json({ error: "School not found" }, { status: 404 });
  }

  const body = await request.json();
  const { visitorId, newEmail } = body as { visitorId: string; newEmail: string };

  if (!visitorId || !newEmail) {
    return NextResponse.json({ error: "Missing visitorId or newEmail" }, { status: 400 });
  }

  const { error } = await service
    .from("school_gallery_visitors")
    .update({ viewer_email: newEmail.trim().toLowerCase() })
    .eq("id", visitorId)
    .eq("school_id", schoolId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

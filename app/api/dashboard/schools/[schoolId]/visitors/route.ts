import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";

export const dynamic = "force-dynamic";

const VisitorPatchBodySchema = z.object({
  visitorId: z.string().min(1).max(128),
  newEmail: z.string().email().max(320),
});

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

  // ✅ Also fetch pre-release email registrations so the photographer can
  // see (and contact) parents who registered before the gallery went live.
  // Without this, pre-release signups were saved silently and never surfaced
  // in the admin UI, which made the "notify me when ready" flow feel broken.
  const { data: preReleaseRegs } = await service
    .from("pre_release_registrations")
    .select("id, email, created_at")
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
      id: (v.id as string) ?? "",
      // ✅ Coerce to string up front. `v` is typed Record<string, unknown>
      // so without this the downstream `.toLowerCase()` calls below fail
      // TypeScript compilation on Vercel ("Property 'toLowerCase' does not
      // exist on type '{}'").
      email: typeof v.viewer_email === "string" ? v.viewer_email : "",
      firstVisit: typeof v.created_at === "string" ? v.created_at : "",
      lastVisit: typeof v.last_opened_at === "string" ? v.last_opened_at : "",
      orders: visitorOrders,
      downloads: visitorDownloads,
      orderCount: visitorOrders.length,
      downloadCount: visitorDownloads.reduce((sum, d) => sum + (Number(d.downloadCount) || 0), 0 as number),
      preRelease: false as boolean,
    };
  });

  // Append pre-release registrants that don't already appear as real
  // visitors. If the same email shows up in both tables (parent registered
  // pre-release AND later opened the gallery), we keep the visitor row and
  // flag it with `alsoPreRelease: true` so the UI can show both badges.
  const existingEmails = new Set(
    visitorList.map((row) => (row.email ?? "").toLowerCase()),
  );
  const existingByEmail = new Map(
    visitorList.map((row) => [(row.email ?? "").toLowerCase(), row]),
  );
  const preReleaseOnly = ((preReleaseRegs ?? []) as Array<{ id: string; email: string | null; created_at: string | null }>)
    .map((row) => ({
      id: `pre_${row.id}`,
      email: row.email ?? "",
      firstVisit: row.created_at ?? "",
      lastVisit: row.created_at ?? "",
      orders: [] as VisitorOrder[],
      downloads: [] as VisitorDownload[],
      orderCount: 0,
      downloadCount: 0,
      preRelease: true as boolean,
    }))
    .filter((row) => {
      const key = row.email.toLowerCase();
      if (!key) return false;
      if (existingEmails.has(key)) {
        // Flag the existing visitor entry as also-pre-release so the UI
        // can render a small "Pre-release" chip next to their name.
        const existing = existingByEmail.get(key);
        if (existing) (existing as { alsoPreRelease?: boolean }).alsoPreRelease = true;
        return false;
      }
      return true;
    });

  const combined = [...visitorList, ...preReleaseOnly];

  return NextResponse.json({
    schoolName: school.school_name,
    visitors: combined,
    totalVisitors: combined.length,
    totalOrders: (orders ?? []).length,
    preReleaseCount: preReleaseOnly.length,
  });
}

type VisitorOrder = {
  id: string;
  status: string;
  totalCents: number;
  createdAt: string;
  studentName: string;
  className: string;
};

type VisitorDownload = {
  id: string;
  downloadType: string;
  downloadCount: number;
  mediaIds: string[];
  createdAt: string;
};

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

  const parsed = await parseJson(request, VisitorPatchBodySchema);
  if (!parsed.ok) return parsed.response;
  const { visitorId, newEmail } = parsed.data;

  // ✅ Pre-release registrant IDs are returned from GET prefixed with `pre_`
  // so we can distinguish them from school_gallery_visitors rows. Route the
  // update to the right table.
  if (visitorId.startsWith("pre_")) {
    const realId = visitorId.slice("pre_".length);
    const { error } = await service
      .from("pre_release_registrations")
      .update({ email: newEmail.trim().toLowerCase() })
      .eq("id", realId)
      .eq("school_id", schoolId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
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

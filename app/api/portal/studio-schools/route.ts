// GET /api/portal/studio-schools?photographerId=...
//
// Anonymous read of every active school under a studio.  Used by the
// CombineOrdersDrawer to populate the school dropdowns for sibling combine
// + past-year flows.  Returns ONLY public-safe fields: id, school_name,
// shoot_date (year), archive_date.  No PINs, no parent_emails, no roster.
//
// We don't gate this — the photographer_id is something the parent already
// has via their current gallery's context payload, and exposing the list
// of school names a studio has shot does not constitute a privacy leak
// (school names are listed publicly on parents login pages already).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  photographerId: z.string().uuid(),
});

export async function GET(request: NextRequest) {
  const photographerId = request.nextUrl.searchParams.get("photographerId");
  const parsed = QuerySchema.safeParse({ photographerId });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "photographerId is required." },
      { status: 400 },
    );
  }

  const sb = createDashboardServiceClient();
  const { data, error } = await sb
    .from("schools")
    .select("id, school_name, shoot_date, archive_date")
    .eq("photographer_id", parsed.data.photographerId)
    .order("shoot_date", { ascending: false, nullsFirst: false });
  if (error) {
    return NextResponse.json(
      { ok: false, message: "Could not load schools." },
      { status: 500 },
    );
  }

  const schools = (data ?? []).map((row) => {
    const shootDate = (row.shoot_date as string | null) ?? null;
    const year = shootDate ? Number(shootDate.slice(0, 4)) : null;
    return {
      id: row.id as string,
      schoolName: ((row.school_name as string | null) ?? "").trim() || "School",
      shootYear: Number.isFinite(year) ? year : null,
      archiveDate: (row.archive_date as string | null) ?? null,
    };
  });

  return NextResponse.json({ ok: true, schools });
}

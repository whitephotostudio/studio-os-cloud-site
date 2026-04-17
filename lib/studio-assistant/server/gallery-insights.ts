// Studio Assistant — Phase 6 gallery + sales optimization.
//
// All functions are READ-ONLY and photographer-scoped.  They rely only on
// columns that are proven to exist in the current codebase:
//   students:               id, school_id, first_name, last_name,
//                           photo_url, class_name, folder_name
//   orders:                 id, photographer_id, school_id, student_id,
//                           total_cents, status, created_at
//   order_items:            id, order_id, product_name, quantity,
//                           unit_price_cents, line_total_cents, sku
//   event_gallery_favorites:id, project_id, media_id, viewer_key
//   media:                  id, project_id
//   schools:                id, school_name, photographer_id, cover_photo_url
//
// We intentionally avoid any computer-vision or ML claims.  All "best" and
// "popular" labels are derived from explicit user signals (orders placed,
// parent favorites) so the results are transparent and trustworthy.

import type { SupabaseClient } from "@supabase/supabase-js";

type Ctx = {
  service: SupabaseClient;
  photographerId: string;
};

type SchoolLite = {
  id: string;
  school_name: string | null;
  cover_photo_url?: string | null;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Resolve a single school from a name query, or return structured error info. */
async function resolveSchool(
  ctx: Ctx,
  name: string,
): Promise<
  | { ok: true; school: SchoolLite }
  | { ok: false; status: 404 | 409 | 422; message: string }
> {
  if (!name) {
    return { ok: false, status: 422, message: "Tell me which school to check." };
  }
  const like = `%${escapeLike(name)}%`;
  const { data, error } = await ctx.service
    .from("schools")
    .select("id,school_name,cover_photo_url")
    .eq("photographer_id", ctx.photographerId)
    .ilike("school_name", like)
    .limit(5);
  if (error) {
    return { ok: false, status: 422, message: error.message };
  }
  const rows = (data ?? []) as SchoolLite[];
  if (!rows.length) {
    return {
      ok: false,
      status: 404,
      message: `No school found matching “${name}”.`,
    };
  }
  if (rows.length > 1) {
    return {
      ok: false,
      status: 409,
      message: `Multiple schools match “${name}”. Be more specific.`,
    };
  }
  return { ok: true, school: rows[0] };
}

/* -------------------------------------------------------------------------- */
/*  1. Gallery coverage — who has a photo and who is missing one              */
/* -------------------------------------------------------------------------- */

export async function reviewGalleryCoverage(ctx: Ctx, schoolName: string) {
  const resolved = await resolveSchool(ctx, schoolName);
  if (!resolved.ok) return resolved;
  const school = resolved.school;

  const { data, error } = await ctx.service
    .from("students")
    .select("id,first_name,last_name,class_name,photo_url")
    .eq("school_id", school.id)
    .limit(5000);
  if (error) {
    return { ok: false as const, status: 500 as const, message: error.message };
  }
  const rows = (data ?? []) as Array<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    class_name: string | null;
    photo_url: string | null;
  }>;

  const withPhoto = rows.filter((r) => clean(r.photo_url)).length;
  const missing = rows.length - withPhoto;
  const missingByClass = new Map<string, number>();
  for (const r of rows) {
    if (clean(r.photo_url)) continue;
    const key = clean(r.class_name) || "(no class)";
    missingByClass.set(key, (missingByClass.get(key) ?? 0) + 1);
  }
  const missingGroups = Array.from(missingByClass.entries())
    .map(([class_name, count]) => ({ class_name, missing: count }))
    .sort((a, b) => b.missing - a.missing);

  const coveragePct =
    rows.length > 0 ? Math.round((withPhoto / rows.length) * 100) : 100;

  const sampleMissing = rows
    .filter((r) => !clean(r.photo_url))
    .slice(0, 8)
    .map((r) => ({
      id: r.id,
      name: `${clean(r.first_name)} ${clean(r.last_name)}`.trim() || "Unnamed",
      class_name: clean(r.class_name) || null,
    }));

  return {
    ok: true as const,
    data: {
      school: {
        id: school.id,
        school_name: school.school_name,
      },
      counts: {
        total_students: rows.length,
        with_photo: withPhoto,
        missing_photo: missing,
        coverage_pct: coveragePct,
      },
      missing_by_class: missingGroups.slice(0, 10),
      sample_missing: sampleMissing,
    },
    message:
      rows.length === 0
        ? `No students loaded for “${school.school_name}”.`
        : missing === 0
          ? `${school.school_name} has 100% photo coverage.`
          : `${missing} of ${rows.length} students still need a photo (${coveragePct}% coverage).`,
  };
}

/* -------------------------------------------------------------------------- */
/*  2. Popular media — ranked by real signals (orders + favorites)            */
/* -------------------------------------------------------------------------- */

export async function highlightPopularMedia(ctx: Ctx, schoolName: string) {
  const resolved = await resolveSchool(ctx, schoolName);
  if (!resolved.ok) return resolved;
  const school = resolved.school;

  // Count orders per student for this school.
  const { data: orders, error: ordersError } = await ctx.service
    .from("orders")
    .select("student_id,total_cents,created_at")
    .eq("photographer_id", ctx.photographerId)
    .eq("school_id", school.id)
    .not("student_id", "is", null)
    .limit(5000);
  if (ordersError) {
    return { ok: false as const, status: 500 as const, message: ordersError.message };
  }

  const byStudent = new Map<
    string,
    { order_count: number; total_cents: number; last_ordered_at: string | null }
  >();
  for (const o of (orders ?? []) as Array<{
    student_id: string | null;
    total_cents: number | null;
    created_at: string | null;
  }>) {
    if (!o.student_id) continue;
    const b = byStudent.get(o.student_id) ?? {
      order_count: 0,
      total_cents: 0,
      last_ordered_at: null,
    };
    b.order_count += 1;
    b.total_cents += Number(o.total_cents ?? 0);
    if (!b.last_ordered_at || (o.created_at && o.created_at > b.last_ordered_at)) {
      b.last_ordered_at = o.created_at;
    }
    byStudent.set(o.student_id, b);
  }

  const studentIds = Array.from(byStudent.keys());
  if (!studentIds.length) {
    return {
      ok: true as const,
      data: {
        school: { id: school.id, school_name: school.school_name },
        counts: { popular_students: 0 },
        items: [],
      },
      message: `No order signals yet for ${school.school_name}.`,
    };
  }

  const { data: students } = await ctx.service
    .from("students")
    .select("id,first_name,last_name,class_name,photo_url")
    .in("id", studentIds)
    .limit(studentIds.length);

  const nameById = new Map<string, Record<string, unknown>>();
  for (const s of (students ?? []) as Array<Record<string, unknown>>) {
    if (s.id && typeof s.id === "string") nameById.set(s.id, s);
  }

  const ranked = Array.from(byStudent.entries())
    .map(([studentId, b]) => {
      const info = nameById.get(studentId);
      const name = info
        ? `${clean(info.first_name)} ${clean(info.last_name)}`.trim() || "Student"
        : "Student";
      return {
        student_id: studentId,
        name,
        class_name:
          info && typeof info.class_name === "string" ? info.class_name : null,
        photo_url:
          info && typeof info.photo_url === "string" ? info.photo_url : null,
        order_count: b.order_count,
        total_cents: b.total_cents,
        last_ordered_at: b.last_ordered_at,
      };
    })
    .sort((a, b) => b.order_count - a.order_count);

  return {
    ok: true as const,
    data: {
      school: { id: school.id, school_name: school.school_name },
      counts: { popular_students: ranked.length },
      items: ranked.slice(0, 10),
    },
    message: `${ranked.length} student${ranked.length === 1 ? " has" : "s have"} order-based popularity signals at ${school.school_name}.`,
  };
}

/* -------------------------------------------------------------------------- */
/*  3. Upsell sizes — top-selling order_items.product_name for this school    */
/* -------------------------------------------------------------------------- */

export async function suggestUpsellSizes(ctx: Ctx, schoolName: string | null) {
  // School filter is optional — if none, we give a studio-wide view.
  let school: SchoolLite | null = null;
  if (schoolName && schoolName.trim()) {
    const resolved = await resolveSchool(ctx, schoolName);
    if (!resolved.ok) return resolved;
    school = resolved.school;
  }

  // First pull the photographer's orders in the last 90 days (scoped to a
  // school if requested), then pull their order_items.
  const sinceIso = new Date(
    Date.now() - 90 * 24 * 60 * 60 * 1000,
  ).toISOString();

  let orderQuery = ctx.service
    .from("orders")
    .select("id,school_id,total_cents,created_at")
    .eq("photographer_id", ctx.photographerId)
    .gte("created_at", sinceIso)
    .limit(2000);
  if (school) orderQuery = orderQuery.eq("school_id", school.id);

  const { data: orderRows, error: ordersError } = await orderQuery;
  if (ordersError) {
    return { ok: false as const, status: 500 as const, message: ordersError.message };
  }
  const orderIds = (orderRows ?? [])
    .map((r) => r.id as string)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (!orderIds.length) {
    return {
      ok: true as const,
      data: {
        school: school ? { id: school.id, school_name: school.school_name } : null,
        since: sinceIso.slice(0, 10),
        counts: { items: 0 },
        items: [],
      },
      message: school
        ? `No order items at ${school.school_name} in the last 90 days.`
        : `No recent order items in the last 90 days.`,
    };
  }

  const { data: items, error: itemsError } = await ctx.service
    .from("order_items")
    .select("product_name,quantity,line_total_cents,order_id")
    .in("order_id", orderIds)
    .limit(8000);
  if (itemsError) {
    return { ok: false as const, status: 500 as const, message: itemsError.message };
  }

  const byName = new Map<string, { count: number; revenue_cents: number }>();
  for (const row of (items ?? []) as Array<{
    product_name: string | null;
    quantity: number | null;
    line_total_cents: number | null;
  }>) {
    const label = clean(row.product_name) || "Unlabeled";
    const bucket = byName.get(label) ?? { count: 0, revenue_cents: 0 };
    bucket.count += Number(row.quantity ?? 1);
    bucket.revenue_cents += Number(row.line_total_cents ?? 0);
    byName.set(label, bucket);
  }

  const ranked = Array.from(byName.entries())
    .map(([product_name, b]) => ({ product_name, ...b }))
    .sort((a, b) => b.count - a.count);

  return {
    ok: true as const,
    data: {
      school: school ? { id: school.id, school_name: school.school_name } : null,
      since: sinceIso.slice(0, 10),
      counts: { items: ranked.length },
      items: ranked.slice(0, 10),
    },
    message:
      ranked.length === 0
        ? "No sold items in the last 90 days."
        : `${ranked[0].product_name} leads${school ? ` at ${school.school_name}` : ""} with ${ranked[0].count} sold.`,
  };
}

/* -------------------------------------------------------------------------- */
/*  4. Cover photo suggestions — signal-based, no CV                          */
/* -------------------------------------------------------------------------- */

type CoverCandidate = {
  source: "most_ordered_student" | "existing_cover" | "first_student";
  reason: string;
  student_id?: string;
  name?: string;
  photo_url?: string | null;
  order_count?: number;
};

export async function suggestGalleryCover(ctx: Ctx, schoolName: string) {
  const resolved = await resolveSchool(ctx, schoolName);
  if (!resolved.ok) return resolved;
  const school = resolved.school;

  // Grab top-ordered students as the strongest signal.
  const popular = await highlightPopularMedia(ctx, school.school_name ?? "");
  const candidates: CoverCandidate[] = [];

  if (school.cover_photo_url) {
    candidates.push({
      source: "existing_cover",
      reason: "Already set as the gallery cover.",
      photo_url: school.cover_photo_url,
    });
  }

  if (popular.ok) {
    const items = (popular.data.items as Array<Record<string, unknown>>) ?? [];
    for (const item of items.slice(0, 3)) {
      if (!item.photo_url) continue;
      candidates.push({
        source: "most_ordered_student",
        reason: `Appeared in ${item.order_count} order${item.order_count === 1 ? "" : "s"}.`,
        student_id: item.student_id as string | undefined,
        name: item.name as string | undefined,
        photo_url: item.photo_url as string | null,
        order_count: item.order_count as number | undefined,
      });
    }
  }

  // Final fallback: the newest student with a photo.
  if (candidates.filter((c) => c.photo_url).length < 2) {
    const { data } = await ctx.service
      .from("students")
      .select("id,first_name,last_name,photo_url,created_at")
      .eq("school_id", school.id)
      .not("photo_url", "is", null)
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(3);
    for (const s of (data ?? []) as Array<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      photo_url: string | null;
    }>) {
      if (!s.photo_url) continue;
      candidates.push({
        source: "first_student",
        reason: "Recently added student with a synced photo.",
        student_id: s.id,
        name: `${clean(s.first_name)} ${clean(s.last_name)}`.trim() || "Student",
        photo_url: s.photo_url,
      });
    }
  }

  return {
    ok: true as const,
    data: {
      school: { id: school.id, school_name: school.school_name },
      counts: { candidates: candidates.length },
      candidates: candidates.slice(0, 5),
    },
    message:
      candidates.length === 0
        ? `No candidate cover photos found for ${school.school_name}.`
        : `${candidates.length} cover candidate${candidates.length === 1 ? "" : "s"} ranked by real order + catalog signals.`,
  };
}

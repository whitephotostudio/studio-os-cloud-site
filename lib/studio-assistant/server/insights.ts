// Studio Assistant — Phase 5 business insights.
//
// All functions in this module are READ-ONLY and photographer-scoped.  They
// rely only on columns confirmed to exist in the current schema:
//   schools:  id, school_name, photographer_id, status, shoot_date,
//             order_due_date, expiration_date, package_profile_id,
//             gallery_settings, gallery_slug
//   orders:   id, photographer_id, school_id?, project_id?, customer_name,
//             total_cents, status, payment_status, created_at, package_name
//   pre_release_registrations: id, school_id, email, created_at
//   package_profiles: id, name, photographer_id
//
// No new tables or columns are introduced.  Every computation is transparent
// and conservative — if data is missing we return an empty/zero result
// rather than inferring a value.

import type { SupabaseClient } from "@supabase/supabase-js";

/* -------------------------------------------------------------------------- */
/*  Shared helpers                                                            */
/* -------------------------------------------------------------------------- */

type Ctx = {
  service: SupabaseClient;
  photographerId: string;
};

type SchoolRow = {
  id: string;
  school_name: string | null;
  status: string | null;
  shoot_date: string | null;
  order_due_date: string | null;
  expiration_date: string | null;
  package_profile_id: string | null;
};

type OrderRow = {
  id: string;
  school_id: string | null;
  project_id: string | null;
  customer_name: string | null;
  total_cents: number | null;
  status: string | null;
  payment_status: string | null;
  package_name: string | null;
  created_at: string | null;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function startOfToday(): string {
  return `${today()}T00:00:00Z`;
}

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isLiveStatus(status: string | null | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  return s === "active" || s === "public" || s === "live" || s === "open";
}

function isArchived(status: string | null | undefined): boolean {
  return (status ?? "").toLowerCase() === "archived";
}

/** Pull the caller's schools once and reuse for several summaries. */
async function fetchSchools(ctx: Ctx): Promise<SchoolRow[]> {
  const { data, error } = await ctx.service
    .from("schools")
    .select(
      "id,school_name,status,shoot_date,order_due_date,expiration_date,package_profile_id",
    )
    .eq("photographer_id", ctx.photographerId)
    .order("shoot_date", { ascending: false, nullsFirst: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as SchoolRow[];
}

async function fetchRecentOrders(ctx: Ctx, days: number): Promise<OrderRow[]> {
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await ctx.service
    .from("orders")
    .select(
      "id,school_id,project_id,customer_name,total_cents,status,payment_status,package_name,created_at",
    )
    .eq("photographer_id", ctx.photographerId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as OrderRow[];
}

async function fetchPreregCountsBySchool(
  ctx: Ctx,
  schoolIds: string[],
): Promise<Map<string, number>> {
  if (!schoolIds.length) return new Map();
  const { data, error } = await ctx.service
    .from("pre_release_registrations")
    .select("school_id")
    .in("school_id", schoolIds);
  if (error) {
    // Table might be scoped strictly; treat as empty rather than failing.
    console.warn("[insights] preregistration lookup failed:", error.message);
    return new Map();
  }
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ school_id: string | null }>) {
    const id = clean(row.school_id);
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

async function fetchPackageNames(
  ctx: Ctx,
  profileIds: string[],
): Promise<Map<string, string>> {
  if (!profileIds.length) return new Map();
  const { data, error } = await ctx.service
    .from("package_profiles")
    .select("id,name")
    .eq("photographer_id", ctx.photographerId)
    .in("id", profileIds);
  if (error) {
    console.warn("[insights] package profile lookup failed:", error.message);
    return new Map();
  }
  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ id: string; name: string | null }>) {
    if (row.id) map.set(row.id, row.name ?? row.id);
  }
  return map;
}

/* -------------------------------------------------------------------------- */
/*  Pending digital / order backlog helpers                                   */
/* -------------------------------------------------------------------------- */

/**
 * Heuristic for "digital pending": a paid order whose status is still
 * 'digital_paid' (payment cleared, delivery not marked complete) OR status
 * 'paid' whose package_name mentions "digital".  This is intentionally
 * conservative — we only surface what the schema tells us.
 */
function isDigitalPending(row: OrderRow): boolean {
  const status = (row.status ?? "").toLowerCase();
  const pkg = (row.package_name ?? "").toLowerCase();
  if (status === "digital_paid") return true;
  if (status === "paid" && pkg.includes("digital")) return true;
  return false;
}

function isCompleted(row: OrderRow): boolean {
  const s = (row.status ?? "").toLowerCase();
  return s === "completed" || s === "fulfilled" || s === "delivered";
}

function isPending(row: OrderRow): boolean {
  const s = (row.status ?? "").toLowerCase();
  if (!s) return true;
  return s === "pending" || s === "needs_attention" || s === "ready";
}

/* -------------------------------------------------------------------------- */
/*  Insight implementations                                                   */
/* -------------------------------------------------------------------------- */

export type AttentionItem = {
  school_id: string;
  school_name: string;
  reasons: string[];
  suggested_actions: string[];
  urgency: "high" | "medium" | "low";
};

export async function summarizeAttentionItems(ctx: Ctx) {
  const [schools, pendingOrders] = await Promise.all([
    fetchSchools(ctx),
    fetchRecentOrders(ctx, 30),
  ]);
  const schoolIds = schools.map((s) => s.id);
  const preregs = await fetchPreregCountsBySchool(ctx, schoolIds);

  const now = Date.now();
  const fiveDays = now + 5 * 24 * 60 * 60 * 1000;

  const items: AttentionItem[] = [];
  let highUrgent = 0;
  let expiringSoon = 0;
  let unreleasedWithInterest = 0;
  let missingPackage = 0;

  for (const school of schools) {
    if (isArchived(school.status)) continue;
    const reasons: string[] = [];
    const actions: string[] = [];
    let urgency: AttentionItem["urgency"] = "low";

    const preregCount = preregs.get(school.id) ?? 0;

    if (!school.shoot_date) {
      reasons.push("missing shoot date");
      actions.push(`Update ${school.school_name ?? "school"} shoot date`);
      urgency = "medium";
    }

    if (!school.package_profile_id) {
      reasons.push("missing package profile");
      actions.push(`Assign a package profile to ${school.school_name ?? "school"}`);
      missingPackage += 1;
      urgency = "medium";
    }

    if (
      !isLiveStatus(school.status) &&
      preregCount > 0
    ) {
      reasons.push(`${preregCount} preregistration${preregCount === 1 ? "" : "s"} collected, gallery not released`);
      actions.push(`Release ${school.school_name ?? "school"} gallery`);
      unreleasedWithInterest += 1;
      urgency = "high";
    }

    if (school.expiration_date) {
      const t = new Date(school.expiration_date).getTime();
      if (!Number.isNaN(t) && t < fiveDays && t > now - 24 * 60 * 60 * 1000) {
        reasons.push("gallery expires within 5 days");
        actions.push(`Review ${school.school_name ?? "school"} gallery expiration`);
        if (isLiveStatus(school.status)) expiringSoon += 1;
        urgency = "high";
      }
    }

    if (reasons.length) {
      if (urgency === "high") highUrgent += 1;
      items.push({
        school_id: school.id,
        school_name: school.school_name ?? "Untitled school",
        reasons,
        suggested_actions: actions,
        urgency,
      });
    }
  }

  // Sort by urgency (high first), then by reason count desc.
  const urgencyRank = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => {
    const ur = urgencyRank[a.urgency] - urgencyRank[b.urgency];
    if (ur !== 0) return ur;
    return b.reasons.length - a.reasons.length;
  });

  const digitalPending = pendingOrders.filter(isDigitalPending).length;
  const backlog = pendingOrders.filter(isPending).length;

  return {
    counts: {
      needs_attention: items.length,
      high_urgency: highUrgent,
      expiring_soon: expiringSoon,
      unreleased_with_preregistrations: unreleasedWithInterest,
      missing_package_profile: missingPackage,
      digital_pending: digitalPending,
      order_backlog: backlog,
    },
    items: items.slice(0, 15),
  };
}

export async function summarizePendingDigitalOrders(ctx: Ctx) {
  const orders = await fetchRecentOrders(ctx, 60);
  const pending = orders.filter(isDigitalPending);
  return await groupOrdersBySchool(ctx, pending);
}

export async function summarizeOrderBacklog(ctx: Ctx) {
  const orders = await fetchRecentOrders(ctx, 60);
  const backlog = orders.filter(
    (o) => isPending(o) && !isCompleted(o),
  );
  return await groupOrdersBySchool(ctx, backlog);
}

async function groupOrdersBySchool(ctx: Ctx, rows: OrderRow[]) {
  const bySchool = new Map<string, OrderRow[]>();
  for (const row of rows) {
    const key = row.school_id ?? "__no_school__";
    if (!bySchool.has(key)) bySchool.set(key, []);
    bySchool.get(key)!.push(row);
  }
  const schoolIds = Array.from(bySchool.keys()).filter((k) => k !== "__no_school__");
  const schoolNames = new Map<string, string>();
  if (schoolIds.length) {
    const { data, error } = await ctx.service
      .from("schools")
      .select("id,school_name")
      .eq("photographer_id", ctx.photographerId)
      .in("id", schoolIds);
    if (!error) {
      for (const s of (data ?? []) as Array<{ id: string; school_name: string | null }>) {
        if (s.id) schoolNames.set(s.id, s.school_name ?? "Untitled school");
      }
    }
  }

  const groups = Array.from(bySchool.entries()).map(([schoolId, items]) => ({
    school_id: schoolId === "__no_school__" ? null : schoolId,
    school_name:
      schoolId === "__no_school__"
        ? "Direct / event orders"
        : schoolNames.get(schoolId) ?? "Unknown school",
    total_cents: items.reduce((sum, r) => sum + (r.total_cents ?? 0), 0),
    order_count: items.length,
    samples: items.slice(0, 3).map((r) => ({
      id: r.id,
      customer_name: r.customer_name,
      total_cents: r.total_cents,
      status: r.status,
      created_at: r.created_at,
      package_name: r.package_name,
    })),
  }));
  groups.sort((a, b) => b.order_count - a.order_count);

  return {
    counts: {
      total_orders: rows.length,
      schools_with_orders: groups.filter((g) => g.school_id !== null).length,
    },
    groups: groups.slice(0, 10),
  };
}

export async function summarizeSalesBySchool(
  ctx: Ctx,
  opts: { since?: string | null } = {},
) {
  const sinceIso = opts.since
    ? `${opts.since}T00:00:00Z`
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await ctx.service
    .from("orders")
    .select("id,school_id,total_cents,status,payment_status,created_at")
    .eq("photographer_id", ctx.photographerId)
    .gte("created_at", sinceIso)
    .limit(2000);
  if (error) throw error;
  const rows = (data ?? []) as Array<Partial<OrderRow>>;

  type Bucket = { order_count: number; total_cents: number; paid_cents: number };
  const bySchool = new Map<string, Bucket>();
  for (const row of rows) {
    const key = (row.school_id as string | null) ?? "__no_school__";
    const bucket = bySchool.get(key) ?? {
      order_count: 0,
      total_cents: 0,
      paid_cents: 0,
    };
    bucket.order_count += 1;
    bucket.total_cents += Number(row.total_cents ?? 0);
    if ((row.payment_status ?? "").toLowerCase() === "paid") {
      bucket.paid_cents += Number(row.total_cents ?? 0);
    }
    bySchool.set(key, bucket);
  }

  const schoolIds = Array.from(bySchool.keys()).filter((k) => k !== "__no_school__");
  const nameById = new Map<string, string>();
  if (schoolIds.length) {
    const { data: schools, error: schoolsError } = await ctx.service
      .from("schools")
      .select("id,school_name")
      .eq("photographer_id", ctx.photographerId)
      .in("id", schoolIds);
    if (!schoolsError) {
      for (const s of (schools ?? []) as Array<{ id: string; school_name: string | null }>) {
        nameById.set(s.id, s.school_name ?? "Untitled school");
      }
    }
  }

  const groups = Array.from(bySchool.entries())
    .map(([school_id, bucket]) => ({
      school_id: school_id === "__no_school__" ? null : school_id,
      school_name:
        school_id === "__no_school__"
          ? "Direct / event orders"
          : nameById.get(school_id) ?? "Unknown school",
      ...bucket,
    }))
    .sort((a, b) => b.order_count - a.order_count);

  return {
    since: sinceIso.slice(0, 10),
    counts: {
      schools: groups.length,
      orders: rows.length,
      total_cents: rows.reduce((s, r) => s + Number(r.total_cents ?? 0), 0),
    },
    groups: groups.slice(0, 10),
  };
}

export async function summarizePackagePerformance(
  ctx: Ctx,
  opts: { since?: string | null } = {},
) {
  const sinceIso = opts.since
    ? `${opts.since}T00:00:00Z`
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await ctx.service
    .from("orders")
    .select("id,package_name,total_cents,status,payment_status,created_at")
    .eq("photographer_id", ctx.photographerId)
    .gte("created_at", sinceIso)
    .limit(2000);
  if (error) throw error;
  const rows = (data ?? []) as Array<Partial<OrderRow>>;

  const buckets = new Map<string, { order_count: number; total_cents: number }>();
  for (const row of rows) {
    const key = clean(row.package_name) || "Unlabeled";
    const b = buckets.get(key) ?? { order_count: 0, total_cents: 0 };
    b.order_count += 1;
    b.total_cents += Number(row.total_cents ?? 0);
    buckets.set(key, b);
  }
  const groups = Array.from(buckets.entries())
    .map(([package_name, b]) => ({ package_name, ...b }))
    .sort((a, b) => b.order_count - a.order_count);

  return {
    since: sinceIso.slice(0, 10),
    counts: {
      packages: groups.length,
      orders: rows.length,
    },
    groups: groups.slice(0, 10),
  };
}

export async function reviewReleaseWarnings(ctx: Ctx) {
  const schools = await fetchSchools(ctx);
  const profileIds = Array.from(
    new Set(
      schools
        .map((s) => s.package_profile_id)
        .filter((v): v is string => Boolean(v)),
    ),
  );
  const profileNames = await fetchPackageNames(ctx, profileIds);

  const warnings = schools
    .filter((s) => !isArchived(s.status))
    .map((s) => {
      const issues: string[] = [];
      if (!s.shoot_date) issues.push("missing shoot date");
      if (!s.order_due_date) issues.push("missing order due date");
      if (!s.package_profile_id) issues.push("missing package profile");
      else if (!profileNames.get(s.package_profile_id))
        issues.push("package profile not found");
      return {
        school_id: s.id,
        school_name: s.school_name ?? "Untitled school",
        status: s.status ?? "",
        issues,
      };
    })
    .filter((w) => w.issues.length > 0)
    .sort((a, b) => b.issues.length - a.issues.length);

  return {
    counts: { schools: warnings.length },
    items: warnings.slice(0, 20),
  };
}

export async function reviewExpiringGalleries(
  ctx: Ctx,
  opts: { within_days?: number | null } = {},
) {
  const withinDays = Math.min(90, Math.max(1, opts.within_days ?? 7));
  const endIso = isoDaysFromNow(withinDays);
  const startIso = today();

  const schools = await fetchSchools(ctx);
  const rows = schools
    .filter((s) => isLiveStatus(s.status))
    .filter((s) => !!s.expiration_date)
    .filter((s) => {
      const exp = s.expiration_date as string;
      return exp >= startIso && exp <= endIso;
    })
    .map((s) => ({
      school_id: s.id,
      school_name: s.school_name ?? "Untitled school",
      status: s.status,
      expiration_date: s.expiration_date,
    }))
    .sort((a, b) =>
      (a.expiration_date ?? "").localeCompare(b.expiration_date ?? ""),
    );

  return {
    within_days: withinDays,
    counts: { schools: rows.length },
    items: rows.slice(0, 20),
  };
}

export async function reviewUnreleasedWithPreregistrations(ctx: Ctx) {
  const schools = await fetchSchools(ctx);
  const unreleasedSchools = schools.filter(
    (s) => !isArchived(s.status) && !isLiveStatus(s.status),
  );
  const preregs = await fetchPreregCountsBySchool(
    ctx,
    unreleasedSchools.map((s) => s.id),
  );

  const rows = unreleasedSchools
    .map((s) => ({
      school_id: s.id,
      school_name: s.school_name ?? "Untitled school",
      status: s.status,
      shoot_date: s.shoot_date,
      preregistration_count: preregs.get(s.id) ?? 0,
    }))
    .filter((r) => r.preregistration_count > 0)
    .sort((a, b) => b.preregistration_count - a.preregistration_count);

  return {
    counts: { schools: rows.length },
    items: rows,
  };
}

export async function summarizeToday(ctx: Ctx) {
  const todayIso = today();
  const startOfDay = startOfToday();
  const [ordersToday, schools] = await Promise.all([
    ctx.service
      .from("orders")
      .select("id,status,total_cents")
      .eq("photographer_id", ctx.photographerId)
      .gte("created_at", startOfDay)
      .limit(500)
      .then((r) => (r.data ?? []) as OrderRow[]),
    fetchSchools(ctx),
  ]);
  const attention = await summarizeAttentionItems(ctx);

  const expiringToday = schools.filter(
    (s) =>
      isLiveStatus(s.status) &&
      s.expiration_date &&
      s.expiration_date >= todayIso &&
      s.expiration_date <= isoDaysFromNow(3),
  ).length;

  return {
    date: todayIso,
    counts: {
      new_orders_today: ordersToday.length,
      revenue_today_cents: ordersToday.reduce(
        (sum, r) => sum + Number(r.total_cents ?? 0),
        0,
      ),
      needs_attention: attention.counts.needs_attention,
      expiring_within_3_days: expiringToday,
    },
  };
}

export async function summarizeWeek(ctx: Ctx) {
  const startIso = isoDaysFromNow(-7);
  const [ordersWeek, schools] = await Promise.all([
    ctx.service
      .from("orders")
      .select("id,status,total_cents,school_id")
      .eq("photographer_id", ctx.photographerId)
      .gte("created_at", `${startIso}T00:00:00Z`)
      .limit(1000)
      .then((r) => (r.data ?? []) as OrderRow[]),
    fetchSchools(ctx),
  ]);
  const attention = await summarizeAttentionItems(ctx);
  const expiring = schools.filter(
    (s) =>
      isLiveStatus(s.status) &&
      s.expiration_date &&
      s.expiration_date >= today() &&
      s.expiration_date <= isoDaysFromNow(7),
  ).length;

  return {
    since: startIso,
    counts: {
      orders_this_week: ordersWeek.length,
      revenue_week_cents: ordersWeek.reduce(
        (sum, r) => sum + Number(r.total_cents ?? 0),
        0,
      ),
      needs_attention: attention.counts.needs_attention,
      expiring_within_7_days: expiring,
      digital_pending: attention.counts.digital_pending,
    },
  };
}

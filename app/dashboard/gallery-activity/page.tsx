"use client";

/**
 * /dashboard/gallery-activity
 * -----------------------------------------------------------------------
 * Detailed "Recent Gallery Activity" table — inspired by the ShootProof
 * Reports view Harout likes. Shows every school + event project the
 * photographer has, with their key engagement metrics at a glance:
 *
 *   • Gallery name
 *   • Type chip (school vs. event)
 *   • Date (most recent: event_date || created_at)
 *   • Students / photos (schools only)
 *   • Orders count
 *   • Pending orders count
 *   • Revenue tracked
 *
 * Every row is a Link into the underlying school or project page so the
 * user can drill in. A search + type filter sit above the table.
 *
 * Data is loaded the same way the main dashboard does it — all scoped to
 * the signed-in photographer — so RLS takes care of tenant isolation.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-is-mobile";
import {
  ArrowUpRight,
  Calendar,
  FolderOpen,
  GraduationCap,
  Images,
  Search,
  ShoppingBag,
} from "lucide-react";

/* ----------------------------------- types ----------------------------------- */

type SchoolRow = {
  id: string;
  school_name: string;
  local_school_id: string | null;
  created_at: string | null;
};

type ProjectRow = {
  id: string;
  title: string | null;
  workflow_type: string | null;
  client_name: string | null;
  event_date: string | null;
  created_at: string | null;
  status: string | null;
};

type StudentRow = {
  id: string;
  school_id: string;
  photo_url: string | null;
};

type OrderRow = {
  id: string;
  school_id: string | null;
  project_id: string | null;
  total_cents: number | null;
  status: string | null;
};

type EventsPayload = {
  ok?: boolean;
  message?: string;
  projects?: ProjectRow[];
};

type GalleryRow = {
  key: string;
  id: string;
  kind: "school" | "event";
  name: string;
  href: string;
  dateISO: string | null;
  students: number | null; // null for events
  photos: number | null;
  orders: number;
  pending: number;
  revenueCents: number;
  status: string | null;
};

/* ---------------------------------- helpers ---------------------------------- */

const pageBg = "#ffffff";
const textPrimary = "#111827";
const textMuted = "#667085";
const borderSoft = "#e5e7eb";
const accent = "#cc0000";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function moneyFromCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format((cents || 0) / 100);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function isPendingStatus(status: string | null | undefined) {
  const s = clean(status).toLowerCase();
  return s === "pending" || s === "needs_attention";
}

/* --------------------------------- component --------------------------------- */

function GalleryActivityPageContent() {
  const supabase = useMemo(() => createClient(), []);
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [events, setEvents] = useState<ProjectRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);

  // Filters
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "school" | "event">("all");
  const [sortKey, setSortKey] = useState<"recent" | "orders" | "revenue" | "name">(
    "recent",
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!user) {
        window.location.href = "/sign-in";
        return;
      }

      const { data: photographer, error: pgErr } = await supabase
        .from("photographers")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (pgErr) throw pgErr;
      if (!photographer) {
        setSchools([]);
        setEvents([]);
        setStudents([]);
        setOrders([]);
        setLoading(false);
        return;
      }

      const [schoolRes, orderRes, eventRes] = await Promise.all([
        supabase
          .from("schools")
          .select("id,school_name,local_school_id,created_at")
          .eq("photographer_id", photographer.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("orders")
          .select("id,school_id,project_id,total_cents,status")
          .eq("photographer_id", photographer.id),
        fetch("/api/dashboard/events", { method: "GET", cache: "no-store" }),
      ]);
      if (schoolRes.error) throw schoolRes.error;
      if (orderRes.error) throw orderRes.error;

      const eventPayload = (await eventRes.json()) as EventsPayload;
      if (!eventRes.ok || eventPayload.ok === false) {
        throw new Error(eventPayload.message || "Failed to load events");
      }

      const schoolRows = (schoolRes.data ?? []) as SchoolRow[];
      setSchools(schoolRows);
      setEvents(eventPayload.projects ?? []);
      setOrders((orderRes.data ?? []) as OrderRow[]);

      if (schoolRows.length > 0) {
        const { data: studentRows, error: studentErr } = await supabase
          .from("students")
          .select("id,school_id,photo_url")
          .in(
            "school_id",
            schoolRows.map((s) => s.id),
          );
        if (studentErr) throw studentErr;
        setStudents((studentRows ?? []) as StudentRow[]);
      } else {
        setStudents([]);
      }
    } catch (err) {
      console.error("[gallery-activity] load error:", err);
      setError(err instanceof Error ? err.message : "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  /* --------------------------- build unified rows --------------------------- */

  const rows = useMemo<GalleryRow[]>(() => {
    const bySchool = new Map<string, { orders: number; pending: number; revenue: number }>();
    const byProject = new Map<string, { orders: number; pending: number; revenue: number }>();
    for (const order of orders) {
      const bucket = order.school_id
        ? (bySchool.get(order.school_id) ??
            (bySchool.set(order.school_id, { orders: 0, pending: 0, revenue: 0 }).get(order.school_id)!))
        : order.project_id
          ? (byProject.get(order.project_id) ??
              (byProject.set(order.project_id, { orders: 0, pending: 0, revenue: 0 }).get(order.project_id)!))
          : null;
      if (!bucket) continue;
      bucket.orders += 1;
      if (isPendingStatus(order.status)) bucket.pending += 1;
      bucket.revenue += order.total_cents || 0;
    }

    const studentsBySchool = new Map<string, { total: number; withPhoto: number }>();
    for (const s of students) {
      const cur =
        studentsBySchool.get(s.school_id) ??
        studentsBySchool.set(s.school_id, { total: 0, withPhoto: 0 }).get(s.school_id)!;
      cur.total += 1;
      if (clean(s.photo_url)) cur.withPhoto += 1;
    }

    const schoolRows: GalleryRow[] = schools.map((s) => {
      const agg = bySchool.get(s.id) ?? { orders: 0, pending: 0, revenue: 0 };
      const studs = studentsBySchool.get(s.id) ?? { total: 0, withPhoto: 0 };
      return {
        key: `school:${s.id}`,
        id: s.id,
        kind: "school",
        name: clean(s.school_name) || "Untitled school",
        href: `/dashboard/projects/schools/${s.id}`,
        dateISO: s.created_at,
        students: studs.total,
        photos: studs.withPhoto,
        orders: agg.orders,
        pending: agg.pending,
        revenueCents: agg.revenue,
        status: null,
      };
    });

    const eventRows: GalleryRow[] = events.map((p) => {
      const agg = byProject.get(p.id) ?? { orders: 0, pending: 0, revenue: 0 };
      return {
        key: `event:${p.id}`,
        id: p.id,
        kind: "event",
        name: clean(p.title) || clean(p.client_name) || "Untitled event",
        href: `/dashboard/projects/${p.id}`,
        dateISO: p.event_date || p.created_at,
        students: null,
        photos: null,
        orders: agg.orders,
        pending: agg.pending,
        revenueCents: agg.revenue,
        status: p.status,
      };
    });

    return [...schoolRows, ...eventRows];
  }, [schools, events, students, orders]);

  /* ------------------------------ filter & sort ----------------------------- */

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows;
    if (kindFilter !== "all") out = out.filter((r) => r.kind === kindFilter);
    if (q) out = out.filter((r) => r.name.toLowerCase().includes(q));
    out = [...out].sort((a, b) => {
      switch (sortKey) {
        case "orders":
          return b.orders - a.orders;
        case "revenue":
          return b.revenueCents - a.revenueCents;
        case "name":
          return a.name.localeCompare(b.name);
        case "recent":
        default: {
          const ax = a.dateISO ? new Date(a.dateISO).getTime() : 0;
          const bx = b.dateISO ? new Date(b.dateISO).getTime() : 0;
          return bx - ax;
        }
      }
    });
    return out;
  }, [rows, search, kindFilter, sortKey]);

  /* ---------------------------------- render --------------------------------- */

  return (
    <div style={{ minHeight: "100vh", background: pageBg }}>
      <main style={{ padding: isMobile ? 14 : 32 }}>
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          {/* Breadcrumb */}
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: textMuted,
              letterSpacing: "0.08em",
              marginBottom: 10,
            }}
          >
            <Link
              href="/dashboard"
              style={{ color: textMuted, textDecoration: "none" }}
            >
              DASHBOARD
            </Link>
            <span style={{ margin: "0 8px" }}>›</span>
            <span style={{ color: textPrimary }}>GALLERY ACTIVITY</span>
          </div>

          {/* Header */}
          <div
            style={{
              display: "flex",
              flexDirection: isMobile ? "column" : "row",
              alignItems: isMobile ? "flex-start" : "flex-end",
              justifyContent: "space-between",
              gap: 16,
              marginBottom: 22,
            }}
          >
            <div>
              <h1
                style={{
                  fontSize: isMobile ? 26 : 32,
                  lineHeight: 1.1,
                  margin: 0,
                  color: textPrimary,
                  fontWeight: 900,
                }}
              >
                Recent Gallery Activity
              </h1>
              <p
                style={{
                  margin: "8px 0 0",
                  color: textMuted,
                  fontSize: 14,
                  lineHeight: 1.6,
                }}
              >
                Every school and event project, with photo coverage, orders, and
                revenue. Tap any row to open it.
              </p>
            </div>

            {!loading ? (
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  color: textMuted,
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                <span>
                  {rows.length} galler{rows.length === 1 ? "y" : "ies"}
                </span>
                <span>•</span>
                <span>
                  {orders.length} order{orders.length === 1 ? "" : "s"} tracked
                </span>
              </div>
            ) : null}
          </div>

          {/* Filters */}
          <div
            style={{
              display: "flex",
              flexDirection: isMobile ? "column" : "row",
              gap: 10,
              marginBottom: 18,
              alignItems: isMobile ? "stretch" : "center",
            }}
          >
            <div
              style={{
                flex: 1,
                position: "relative",
                display: "flex",
                alignItems: "center",
                background: "#fff",
                border: `1px solid ${borderSoft}`,
                borderRadius: 14,
                padding: "0 12px",
              }}
            >
              <Search size={15} color={textMuted} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search galleries…"
                aria-label="Search galleries"
                style={{
                  flex: 1,
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  padding: "12px 10px",
                  fontSize: 14,
                  color: textPrimary,
                  fontWeight: 600,
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(
                [
                  { v: "all", label: "All" },
                  { v: "school", label: "Schools" },
                  { v: "event", label: "Events" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setKindFilter(opt.v)}
                  style={{
                    border: `1px solid ${kindFilter === opt.v ? "#0f172a" : borderSoft}`,
                    background: kindFilter === opt.v ? "#0f172a" : "#fff",
                    color: kindFilter === opt.v ? "#fff" : textPrimary,
                    padding: "10px 14px",
                    borderRadius: 14,
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: "pointer",
                    transition: "background 0.15s, border-color 0.15s",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <select
              value={sortKey}
              onChange={(e) =>
                setSortKey(e.target.value as typeof sortKey)
              }
              aria-label="Sort galleries"
              style={{
                border: `1px solid ${borderSoft}`,
                background: "#fff",
                padding: "12px 14px",
                borderRadius: 14,
                fontSize: 13,
                fontWeight: 800,
                color: textPrimary,
                cursor: "pointer",
                colorScheme: "light",
              }}
            >
              <option value="recent">Most recent</option>
              <option value="orders">Most orders</option>
              <option value="revenue">Top revenue</option>
              <option value="name">Name (A–Z)</option>
            </select>
          </div>

          {error ? (
            <div
              style={{
                marginBottom: 14,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#991b1b",
                padding: "12px 14px",
                borderRadius: 12,
                fontSize: 13,
              }}
            >
              {error}
            </div>
          ) : null}

          {/* Table */}
          <div
            style={{
              background: "#fff",
              border: `1px solid ${borderSoft}`,
              borderRadius: 20,
              overflow: "hidden",
              boxShadow: "0 10px 30px rgba(17,24,39,0.04)",
            }}
          >
            {/* Desktop table */}
            {!isMobile ? (
              <div style={{ overflow: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "separate",
                    borderSpacing: 0,
                    minWidth: 920,
                  }}
                >
                  <thead>
                    <tr style={{ background: "#fafafa" }}>
                      <Th>Gallery name</Th>
                      <Th>Type</Th>
                      <Th>Date</Th>
                      <Th align="right">Students</Th>
                      <Th align="right">Photos</Th>
                      <Th align="right">Orders</Th>
                      <Th align="right">Pending</Th>
                      <Th align="right">Revenue</Th>
                      <Th align="right"> </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      [0, 1, 2, 3].map((i) => (
                        <tr key={`skel-${i}`}>
                          <Td colSpan={9}>
                            <div
                              style={{
                                height: 14,
                                borderRadius: 8,
                                background: "#f3f4f6",
                                width: `${70 - i * 10}%`,
                              }}
                            />
                          </Td>
                        </tr>
                      ))
                    ) : visible.length === 0 ? (
                      <tr>
                        <Td colSpan={9}>
                          <EmptyState />
                        </Td>
                      </tr>
                    ) : (
                      visible.map((r) => <TableRow key={r.key} row={r} />)
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              /* Mobile: card list */
              <div style={{ display: "grid", gap: 0 }}>
                {loading ? (
                  [0, 1, 2].map((i) => (
                    <div
                      key={i}
                      style={{
                        padding: 16,
                        borderBottom: `1px solid ${borderSoft}`,
                      }}
                    >
                      <div
                        style={{
                          height: 14,
                          borderRadius: 8,
                          background: "#f3f4f6",
                          width: "60%",
                          marginBottom: 8,
                        }}
                      />
                      <div
                        style={{
                          height: 10,
                          borderRadius: 6,
                          background: "#f3f4f6",
                          width: "40%",
                        }}
                      />
                    </div>
                  ))
                ) : visible.length === 0 ? (
                  <div style={{ padding: 24 }}>
                    <EmptyState />
                  </div>
                ) : (
                  visible.map((r) => <MobileCard key={r.key} row={r} />)
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/* ------------------------------- table helpers ------------------------------- */

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      style={{
        textAlign: align,
        padding: "12px 16px",
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: "0.08em",
        color: textMuted,
        borderBottom: `1px solid ${borderSoft}`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  colSpan,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      style={{
        textAlign: align,
        padding: "14px 16px",
        fontSize: 14,
        color: textPrimary,
        borderBottom: `1px solid ${borderSoft}`,
        verticalAlign: "middle",
      }}
    >
      {children}
    </td>
  );
}

function TypeChip({ kind }: { kind: "school" | "event" }) {
  const isSchool = kind === "school";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 800,
        color: isSchool ? "#1d4ed8" : "#9a3412",
        background: isSchool ? "#eff6ff" : "#fff7ed",
      }}
    >
      {isSchool ? <GraduationCap size={11} /> : <FolderOpen size={11} />}
      {isSchool ? "School" : "Event"}
    </span>
  );
}

function TableRow({ row }: { row: GalleryRow }) {
  return (
    <tr
      style={{ cursor: "pointer", transition: "background 0.15s" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#fafafa")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      onClick={() => (window.location.href = row.href)}
    >
      <Td>
        <div style={{ fontWeight: 800, color: textPrimary }}>{row.name}</div>
      </Td>
      <Td>
        <TypeChip kind={row.kind} />
      </Td>
      <Td>
        <span style={{ color: textMuted, fontSize: 13 }}>
          {formatDate(row.dateISO)}
        </span>
      </Td>
      <Td align="right">
        {row.students != null ? (
          <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            {row.students}
          </span>
        ) : (
          <span style={{ color: textMuted }}>—</span>
        )}
      </Td>
      <Td align="right">
        {row.photos != null ? (
          <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            {row.photos}
          </span>
        ) : (
          <span style={{ color: textMuted }}>—</span>
        )}
      </Td>
      <Td align="right">
        <span
          style={{
            color: row.orders > 0 ? textPrimary : textMuted,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {row.orders}
        </span>
      </Td>
      <Td align="right">
        {row.pending > 0 ? (
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 800,
              color: "#c2410c",
              background: "#fff7ed",
            }}
          >
            {row.pending}
          </span>
        ) : (
          <span style={{ color: textMuted }}>—</span>
        )}
      </Td>
      <Td align="right">
        <span
          style={{
            fontWeight: 800,
            color: row.revenueCents > 0 ? textPrimary : textMuted,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {moneyFromCents(row.revenueCents)}
        </span>
      </Td>
      <Td align="right">
        <ArrowUpRight size={16} color={accent} />
      </Td>
    </tr>
  );
}

function MobileCard({ row }: { row: GalleryRow }) {
  return (
    <Link
      href={row.href}
      style={{
        display: "block",
        padding: 16,
        borderBottom: `1px solid ${borderSoft}`,
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 10,
          marginBottom: 8,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 800, color: textPrimary }}>
          {row.name}
        </div>
        <TypeChip kind={row.kind} />
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          fontSize: 12,
          color: textMuted,
          fontWeight: 700,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Calendar size={12} /> {formatDate(row.dateISO)}
        </span>
        {row.students != null ? (
          <span>• {row.students} students</span>
        ) : null}
        {row.photos != null ? <span>• {row.photos} photos</span> : null}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <ShoppingBag size={12} /> {row.orders}
        </span>
        {row.pending > 0 ? (
          <span style={{ color: "#c2410c" }}>• {row.pending} pending</span>
        ) : null}
        <span style={{ color: row.revenueCents > 0 ? textPrimary : textMuted }}>
          • {moneyFromCents(row.revenueCents)}
        </span>
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "36px 16px",
        color: textMuted,
      }}
    >
      <Images size={30} color="#d1d5db" style={{ marginBottom: 10 }} />
      <div style={{ fontSize: 14, fontWeight: 800, color: textPrimary }}>
        No galleries match your filter
      </div>
      <div style={{ fontSize: 13, marginTop: 6 }}>
        Try clearing the search or switching the type filter.
      </div>
    </div>
  );
}

/* --------------------------------- default --------------------------------- */

export default function GalleryActivityPage() {
  return (
    <Suspense
      fallback={<div style={{ minHeight: "100vh", background: pageBg }} />}
    >
      <GalleryActivityPageContent />
    </Suspense>
  );
}

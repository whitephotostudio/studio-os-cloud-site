"use client";

// Mobile home — /m
//
// The landing screen when Harout opens Studio OS on his phone.  Three jobs:
//   1. Tell him at a glance: new orders today, how many schools are live.
//   2. Give him a Spotlight-style search he can tap once and find a student,
//      order, school, or event across everything.
//   3. Big thumb-reach tiles for the subpages.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck,
  ChevronRight,
  GraduationCap,
  PartyPopper,
  Search,
  ShoppingBag,
  Sparkles,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// ── Types ────────────────────────────────────────────────────────────

type SearchHit =
  | {
      kind: "student";
      id: string;
      title: string;
      subtitle: string;
      href: string;
    }
  | {
      kind: "order";
      id: string;
      title: string;
      subtitle: string;
      href: string;
    }
  | {
      kind: "school";
      id: string;
      title: string;
      subtitle: string;
      href: string;
    }
  | {
      kind: "event";
      id: string;
      title: string;
      subtitle: string;
      href: string;
    };

type StatsOrderRow = {
  id: string;
  created_at: string | null;
  status: string | null;
  parent_email: string | null;
  customer_email: string | null;
  total_cents: number | null;
  total_amount: number | null;
  currency: string | null;
  payment_status: string | null;
  paid_at: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
};

// ── Helpers ──────────────────────────────────────────────────────────

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function orderTotalCents(order: StatsOrderRow) {
  return order.total_cents != null
    ? order.total_cents
    : order.total_amount != null
      ? Math.round(order.total_amount * 100)
      : 0;
}

function isPaidOrder(order: StatsOrderRow) {
  const paymentStatus = clean(order.payment_status).toLowerCase();
  return (
    paymentStatus === "paid" ||
    paymentStatus === "succeeded" ||
    paymentStatus === "digital_paid" ||
    !!clean(order.paid_at) ||
    !!clean(order.stripe_payment_intent_id)
  );
}

function hasStartedCheckout(order: StatsOrderRow) {
  return !isPaidOrder(order) && !!clean(order.stripe_checkout_session_id);
}

function isCustomerOrder(order: StatsOrderRow) {
  const buyerEmail = clean(order.parent_email ?? order.customer_email);
  const paymentStatus = clean(order.payment_status);
  return (
    !!buyerEmail ||
    orderTotalCents(order) > 0 ||
    !!paymentStatus ||
    !!clean(order.paid_at) ||
    !!clean(order.stripe_checkout_session_id) ||
    !!clean(order.stripe_payment_intent_id)
  );
}

function isMainWorkflowOrder(order: StatsOrderRow) {
  return !hasStartedCheckout(order);
}

function moneyFromCents(cents: number, currency = "CAD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: cents >= 1000000 ? 0 : 2,
  }).format(cents / 100);
}

export default function MobileHomePage() {
  const [supabase] = useState(() => createClient());
  const [photographerId, setPhotographerId] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [todaysOrders, setTodaysOrders] = useState(0);
  const [unreadOrders, setUnreadOrders] = useState(0);
  const [activeSchools, setActiveSchools] = useState(0);
  const [visibleRevenueCents, setVisibleRevenueCents] = useState(0);
  const [monthRevenueCents, setMonthRevenueCents] = useState(0);
  const [statsCurrency, setStatsCurrency] = useState("CAD");

  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  // ── Bootstrap: user, stats ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data: photog } = await supabase
        .from("photographers")
        .select("id, business_name")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!photog?.id || cancelled) return;
      setPhotographerId(photog.id);
      setFirstName(
        clean(
          (photog as { business_name?: string | null }).business_name ?? "",
        ).split(" ")[0] ?? "",
      );

      const now = new Date();
      const startOfTodayDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      const startOfMonthDate = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfMonth = startOfMonthDate.toISOString();
      const orderStatsSelect = `
        id, created_at, status, parent_email, customer_email,
        total_cents, total_amount, currency, payment_status, paid_at,
        stripe_checkout_session_id, stripe_payment_intent_id
      `;
      const [recentOrders, monthOrders, ordersUnread, schools] = await Promise.all([
        supabase
          .from("orders")
          .select(orderStatsSelect)
          .eq("photographer_id", photog.id)
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("orders")
          .select(orderStatsSelect)
          .eq("photographer_id", photog.id)
          .or(`created_at.gte.${startOfMonth},paid_at.gte.${startOfMonth}`)
          .order("created_at", { ascending: false })
          .limit(1000),
        supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("photographer_id", photog.id)
          .eq("seen_by_photographer", false),
        supabase
          .from("schools")
          .select("id", { count: "exact", head: true })
          .eq("photographer_id", photog.id),
      ]);
      if (cancelled) return;
      const visibleOrders = ((recentOrders.data ?? []) as StatsOrderRow[])
        .filter(isCustomerOrder);
      const monthOrderRows = ((monthOrders.data ?? []) as StatsOrderRow[])
        .filter(isCustomerOrder);
      const resolvedCurrency =
        clean(visibleOrders.find((order) => clean(order.currency))?.currency) ||
        clean(monthOrderRows.find((order) => clean(order.currency))?.currency) ||
        "CAD";
      setStatsCurrency(resolvedCurrency.toUpperCase());
      setTodaysOrders(
        visibleOrders.filter((order) => {
          if (!order.created_at || !isMainWorkflowOrder(order)) return false;
          const createdAt = new Date(order.created_at);
          return createdAt >= startOfTodayDate;
        }).length,
      );
      setUnreadOrders(ordersUnread.count ?? 0);
      setActiveSchools(schools.count ?? 0);
      setVisibleRevenueCents(
        visibleOrders
          .filter(isPaidOrder)
          .reduce((sum, order) => sum + orderTotalCents(order), 0),
      );
      setMonthRevenueCents(
        monthOrderRows
          .filter((order) => {
            if (!isPaidOrder(order)) return false;
            const revenueDate = clean(order.paid_at) || clean(order.created_at);
            if (!revenueDate) return false;
            return new Date(revenueDate) >= startOfMonthDate;
          })
          .reduce((sum, order) => sum + orderTotalCents(order), 0),
      );
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // ── Search: debounced cross-table Spotlight ───────────────────────
  //
  // Matches the desktop ⌘K palette (components/spotlight-search.tsx).
  // Every hit deep-links all the way to the object:
  //   - student → /m/schools/<schoolId>?student=<studentId>   (highlights the student card)
  //   - school  → /m/schools/<schoolId>
  //   - event   → /m/events/<eventId>
  //   - order   → /m/orders/<orderId>                         (opens the detail page)
  useEffect(() => {
    const term = search.trim();
    if (!photographerId) return;
    if (term.length < 2) {
      const resetHandle = window.setTimeout(() => {
        setHits([]);
        setSearching(false);
      }, 0);
      return () => window.clearTimeout(resetHandle);
    }

    let cancelled = false;
    const handle = window.setTimeout(async () => {
      setSearching(true);
      try {
        // Order-id lookup is only useful when the term looks like a
        // uuid fragment (hex + dashes).  Skips the query for plain names
        // like "Ethan" so we don't waste a round-trip.
        const looksLikeOrderId = /^[0-9a-f-]{4,}$/i.test(term);

        const queries: PromiseLike<unknown>[] = [
          // students has no photographer_id column — filter through the
          // schools !inner join so ownership resolves via school_id.
          supabase
            .from("students")
            .select(
              "id, first_name, last_name, photo_url, school_id, class_id, class_name, role, schools!inner(school_name, photographer_id)",
            )
            .eq("schools.photographer_id", photographerId)
            // Match name OR role so typing "coach" surfaces every coach.
            // Teachers + coaches live in the same students table with a
            // non-null role value.
            .or(
              `first_name.ilike.%${term}%,last_name.ilike.%${term}%,role.ilike.%${term}%`,
            )
            .limit(8),
          supabase
            .from("schools")
            .select("id, school_name")
            .eq("photographer_id", photographerId)
            .ilike("school_name", `%${term}%`)
            .limit(6),
          supabase
            .from("projects")
            .select("id, title, client_name, workflow_type")
            .eq("photographer_id", photographerId)
            .eq("workflow_type", "event")
            .ilike("title", `%${term}%`)
            .limit(6),
        ];

        if (looksLikeOrderId) {
          queries.push(
            supabase
              .from("orders")
              .select(
                "id, status, parent_name, customer_name, package_name, student:students(first_name,last_name)",
              )
              .eq("photographer_id", photographerId)
              .ilike("id", `${term}%`)
              .limit(6),
          );
        }

        const results = (await Promise.all(queries)) as Array<{
          data: unknown;
          error: unknown;
        }>;

        if (cancelled) return;

        const [studentsRes, schoolsRes, projectsRes, ordersRes] = results;

        const next: SearchHit[] = [];

        for (const s of (studentsRes.data ?? []) as Array<{
          id: string;
          first_name: string | null;
          last_name: string | null;
          school_id: string | null;
          class_id: string | null;
          class_name: string | null;
          role: string | null;
          schools:
            | { school_name: string | null }
            | { school_name: string | null }[]
            | null;
        }>) {
          const schoolRow = Array.isArray(s.schools) ? s.schools[0] : s.schools;
          // Mobile has no class-level page — the deepest leaf for a student
          // is /m/schools/[id].  The `?student=` param tells that page to
          // scroll to the student card and highlight it.
          const href = s.school_id
            ? `/m/schools/${s.school_id}?student=${encodeURIComponent(s.id)}`
            : `/m/orders?student=${encodeURIComponent(s.id)}`;
          const name =
            [clean(s.first_name), clean(s.last_name)]
              .filter(Boolean)
              .join(" ") || "Person";
          // Subtitle prefers school · class; falls back to school · role
          // for teachers / coaches so the hit row says what they are.
          const context = clean(s.class_name) || clean(s.role);
          const subtitle = [
            clean(schoolRow?.school_name) || "School",
            context,
          ]
            .filter(Boolean)
            .join(" · ");
          next.push({
            kind: "student",
            id: s.id,
            title: name,
            subtitle,
            href,
          });
        }
        for (const school of (schoolsRes.data ?? []) as Array<{
          id: string;
          school_name: string | null;
        }>) {
          next.push({
            kind: "school",
            id: school.id,
            title: clean(school.school_name) || "School",
            subtitle: "School",
            href: `/m/schools/${school.id}`,
          });
        }
        for (const proj of (projectsRes.data ?? []) as Array<{
          id: string;
          title: string | null;
          client_name: string | null;
        }>) {
          next.push({
            kind: "event",
            id: proj.id,
            title: clean(proj.title) || "Event",
            subtitle: clean(proj.client_name) || "Event",
            href: `/m/events/${proj.id}`,
          });
        }
        if (ordersRes) {
          for (const o of (ordersRes.data ?? []) as Array<{
            id: string;
            status: string | null;
            parent_name: string | null;
            customer_name: string | null;
            package_name: string | null;
            student:
              | { first_name: string | null; last_name: string | null }
              | { first_name: string | null; last_name: string | null }[]
              | null;
          }>) {
            const stu = Array.isArray(o.student) ? o.student[0] : o.student;
            const who =
              [clean(stu?.first_name), clean(stu?.last_name)]
                .filter(Boolean)
                .join(" ") ||
              clean(o.parent_name) ||
              clean(o.customer_name) ||
              "Customer";
            next.push({
              kind: "order",
              id: o.id,
              title: `#${o.id.slice(0, 8).toUpperCase()} · ${who}`,
              subtitle:
                clean(o.package_name) || clean(o.status) || "Order",
              href: `/m/orders/${o.id}`,
            });
          }
        }

        setHits(next);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [search, supabase, photographerId]);

  const tiles = useMemo(
    () => [
      {
        href: "/m/orders",
        label: "Orders",
        icon: <ShoppingBag size={22} />,
        accent: "#cc0000",
        note: unreadOrders > 0 ? `${unreadOrders} new` : "All caught up",
      },
      {
        href: "/m/schools",
        label: "Schools",
        icon: <GraduationCap size={22} />,
        accent: "#1d4ed8",
        note: `${activeSchools} active`,
      },
      {
        href: "/m/calendar",
        label: "Calendar",
        icon: <CalendarCheck size={22} />,
        accent: "#cc0000",
        note: "Dates + notes",
      },
      {
        href: "/m/events",
        label: "Events",
        icon: <PartyPopper size={22} />,
        accent: "#b45309",
        note: "Gallery + PIN",
      },
      {
        href: "/dashboard",
        label: "Full desktop",
        icon: <Sparkles size={22} />,
        accent: "#6b7280",
        note: "Open on web",
      },
    ],
    [unreadOrders, activeSchools],
  );

  return (
    <div>
      {/* Greeting */}
      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            fontWeight: 800,
            color: "#6b7280",
          }}
        >
          {greeting()}
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 900,
            color: "#111827",
            marginTop: 2,
          }}
        >
          {firstName ? `Hi ${firstName} 👋` : "Studio OS"}
        </div>
      </div>

      {/* 3-stat strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 8,
          marginBottom: 14,
        }}
      >
        <MiniStat label="New Orders Today" value={todaysOrders} tone="red" />
        <MiniStat
          label="Visible Revenue"
          value={moneyFromCents(visibleRevenueCents, statsCurrency)}
          tone="amber"
        />
        <MiniStat
          label="Revenue This Month"
          value={moneyFromCents(monthRevenueCents, statsCurrency)}
          tone="blue"
        />
      </div>

      {/* Search */}
      <div style={{ position: "relative", marginBottom: 14 }}>
        <Search
          size={16}
          style={{
            position: "absolute",
            left: 12,
            top: "50%",
            transform: "translateY(-50%)",
            color: "#6b7280",
            pointerEvents: "none",
          }}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search students, schools, events…"
          aria-label="Spotlight search"
          inputMode="search"
          style={{
            width: "100%",
            boxSizing: "border-box",
            borderRadius: 14,
            border: "1px solid #e5e7eb",
            background: "#fff",
            color: "#111827",
            padding: "13px 40px 13px 38px",
            fontSize: 15,
            fontWeight: 600,
            outline: "none",
          }}
        />
        {search ? (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Clear search"
            style={{
              position: "absolute",
              right: 6,
              top: "50%",
              transform: "translateY(-50%)",
              width: 30,
              height: 30,
              borderRadius: 999,
              background: "#f3f4f6",
              border: "none",
              cursor: "pointer",
              color: "#6b7280",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      {/* Results (inline when user is typing) */}
      {search.trim().length >= 2 ? (
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            overflow: "hidden",
            background: "#fff",
            marginBottom: 16,
          }}
        >
          {searching && hits.length === 0 ? (
            <div
              style={{
                padding: 16,
                color: "#6b7280",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Searching…
            </div>
          ) : hits.length === 0 ? (
            <div
              style={{
                padding: 16,
                color: "#6b7280",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              No results for &quot;{search}&quot;.
            </div>
          ) : (
            hits.map((hit, idx) => (
              <Link
                key={`${hit.kind}-${hit.id}-${idx}`}
                href={hit.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "12px 14px",
                  borderTop: idx === 0 ? undefined : "1px solid #f3f4f6",
                  textDecoration: "none",
                  color: "#111827",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 800,
                      color: "#111827",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {hit.title}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#6b7280",
                      fontWeight: 600,
                      marginTop: 2,
                    }}
                  >
                    {kindLabel(hit.kind)} · {hit.subtitle}
                  </div>
                </div>
                <ChevronRight size={15} color="#9ca3af" />
              </Link>
            ))
          )}
        </div>
      ) : null}

      {/* Quick tiles */}
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          fontWeight: 800,
          color: "#6b7280",
          margin: "6px 2px 10px",
        }}
      >
        Jump to
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 10,
        }}
      >
        {tiles.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 16,
              padding: 14,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              textDecoration: "none",
              color: "#111827",
              boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                background: `${tile.accent}14`,
                color: tile.accent,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {tile.icon}
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 900,
                color: "#111827",
              }}
            >
              {tile.label}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "#6b7280",
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              {tile.note} <ArrowRight size={12} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: "red" | "amber" | "blue";
}) {
  const bg =
    tone === "red" ? "#fff5f5" : tone === "amber" ? "#fffbeb" : "#eff6ff";
  const fg =
    tone === "red" ? "#cc0000" : tone === "amber" ? "#b45309" : "#1d4ed8";
  return (
    <div
      style={{
        background: bg,
        borderRadius: 14,
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          fontWeight: 800,
          color: fg,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: typeof value === "string" && value.length > 8 ? 17 : 20,
          fontWeight: 900,
          color: "#111827",
          marginTop: 2,
          lineHeight: 1.1,
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function kindLabel(kind: SearchHit["kind"]): string {
  switch (kind) {
    case "student":
      return "Student";
    case "order":
      return "Order";
    case "school":
      return "School";
    case "event":
      return "Event";
  }
}

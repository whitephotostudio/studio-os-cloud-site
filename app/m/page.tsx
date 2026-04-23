"use client";

// Mobile home — /m
//
// The landing screen when Harout opens Studio OS on his phone.  Three jobs:
//   1. Tell him at a glance: new orders today, how many schools are live.
//   2. Give him a Spotlight-style search he can tap once and find a student,
//      order, school, or event across everything.
//   3. Four fat tiles for the subpages — thumb-reach navigation.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  GraduationCap,
  Search,
  ShoppingBag,
  Sparkles,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// ── Types ────────────────────────────────────────────────────────────

type SearchHit =
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

export default function MobileHomePage() {
  const [supabase] = useState(() => createClient());
  const [photographerId, setPhotographerId] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [todaysOrders, setTodaysOrders] = useState(0);
  const [unreadOrders, setUnreadOrders] = useState(0);
  const [activeSchools, setActiveSchools] = useState(0);

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
        .select("id, first_name, business_name")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!photog?.id || cancelled) return;
      setPhotographerId(photog.id);
      setFirstName(
        clean(
          (photog as { first_name?: string | null }).first_name ??
            (photog as { business_name?: string | null }).business_name ??
            "",
        ).split(" ")[0] ?? "",
      );

      const now = new Date();
      const startOfToday = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      ).toISOString();

      const [ordersToday, ordersUnread, schools] = await Promise.all([
        supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("photographer_id", photog.id)
          .gte("created_at", startOfToday),
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
      setTodaysOrders(ordersToday.count ?? 0);
      setUnreadOrders(ordersUnread.count ?? 0);
      setActiveSchools(schools.count ?? 0);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // ── Search: debounced cross-table Spotlight ───────────────────────
  useEffect(() => {
    const term = search.trim();
    if (!photographerId) return;
    if (term.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const handle = window.setTimeout(async () => {
      try {
        const [students, schools, projects] = await Promise.all([
          supabase
            .from("students")
            .select("id, first_name, last_name, photo_url, school_id, schools(school_name)")
            .eq("photographer_id", photographerId)
            .or(
              `first_name.ilike.%${term}%,last_name.ilike.%${term}%`,
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
        ]);

        if (cancelled) return;

        const next: SearchHit[] = [];

        for (const s of (students.data ?? []) as Array<{
          id: string;
          first_name: string | null;
          last_name: string | null;
          school_id: string | null;
          schools: { school_name: string | null } | { school_name: string | null }[] | null;
        }>) {
          const schoolRow = Array.isArray(s.schools) ? s.schools[0] : s.schools;
          next.push({
            kind: "order",
            id: s.id,
            title:
              [clean(s.first_name), clean(s.last_name)]
                .filter(Boolean)
                .join(" ") || "Student",
            subtitle: clean(schoolRow?.school_name) || "Student",
            href: s.school_id
              ? `/m/schools/${s.school_id}?student=${s.id}`
              : `/m/orders?student=${s.id}`,
          });
        }
        for (const school of (schools.data ?? []) as Array<{
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
        for (const proj of (projects.data ?? []) as Array<{
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
        href: "/m/events",
        label: "Events",
        icon: <CalendarDays size={22} />,
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
        <MiniStat label="New today" value={todaysOrders} tone="red" />
        <MiniStat label="Unread" value={unreadOrders} tone="amber" />
        <MiniStat label="Schools" value={activeSchools} tone="blue" />
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
              No results for "{search}".
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
  value: number;
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
          fontSize: 20,
          fontWeight: 900,
          color: "#111827",
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function kindLabel(kind: SearchHit["kind"]): string {
  switch (kind) {
    case "order":
      return "Student";
    case "school":
      return "School";
    case "event":
      return "Event";
  }
}

"use client";

// Sort & Review — picker (/m/sort)
//
// Pick a school (roster-based review → /m/sort/[schoolId]) or an event
// (album-based photo grid → /m/sort/event/[id]).

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, GraduationCap, PartyPopper, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Item = { id: string; name: string };

function clean(v: string | null | undefined) {
  return (v ?? "").trim();
}

export default function SortPickPage() {
  const [supabase] = useState(() => createClient());
  const [schools, setSchools] = useState<Item[]>([]);
  const [events, setEvents] = useState<Item[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data: pg } = await supabase
        .from("photographers")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!pg?.id || cancelled) return;

      const [{ data: schoolData }, { data: eventData }] = await Promise.all([
        supabase
          .from("schools")
          .select("id, school_name")
          .eq("photographer_id", pg.id)
          .order("school_name"),
        supabase
          .from("projects")
          .select("id, title")
          .eq("photographer_id", pg.id)
          .eq("workflow_type", "event")
          .order("title"),
      ]);
      if (cancelled) return;
      setSchools(
        ((schoolData ?? []) as Array<{ id: string; school_name: string | null }>).map(
          (s) => ({ id: s.id, name: clean(s.school_name) || "Untitled school" }),
        ),
      );
      setEvents(
        ((eventData ?? []) as Array<{ id: string; title: string | null }>).map((p) => ({
          id: p.id,
          name: clean(p.title) || "Untitled event",
        })),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const q = filter.trim().toLowerCase();
  const filteredSchools = schools.filter((s) => s.name.toLowerCase().includes(q));
  const filteredEvents = events.filter((s) => s.name.toLowerCase().includes(q));

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    padding: "14px 16px",
    fontSize: 15,
    fontWeight: 800,
    color: "#111827",
    textDecoration: "none",
  };
  const headerStyle: React.CSSProperties = {
    fontSize: 11,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    fontWeight: 800,
    color: "#6b7280",
    margin: "4px 2px 8px",
  };

  return (
    <div>
      <Link
        href="/m"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "#6b7280",
          fontSize: 13,
          fontWeight: 700,
          textDecoration: "none",
          marginBottom: 10,
        }}
      >
        <ArrowLeft size={15} /> Home
      </Link>
      <div style={{ fontSize: 22, fontWeight: 900, color: "#111827" }}>
        Sort &amp; Review
      </div>
      <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2, marginBottom: 14 }}>
        Pick a school or event to review and clean up photos.
      </div>

      <div style={{ position: "relative", marginBottom: 14 }}>
        <Search
          size={16}
          style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#6b7280" }}
        />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search schools & events…"
          style={{
            width: "100%",
            boxSizing: "border-box",
            borderRadius: 14,
            border: "1px solid #e5e7eb",
            padding: "12px 14px 12px 38px",
            fontSize: 15,
            fontWeight: 600,
            outline: "none",
          }}
        />
      </div>

      {loading ? (
        <div style={{ color: "#6b7280", fontSize: 13, padding: 12 }}>Loading…</div>
      ) : (
        <>
          {filteredEvents.length > 0 ? (
            <div style={{ marginBottom: 18 }}>
              <div style={headerStyle}>Events · {filteredEvents.length}</div>
              <div style={{ display: "grid", gap: 8 }}>
                {filteredEvents.map((s) => (
                  <Link key={s.id} href={`/m/sort/event/${s.id}`} style={rowStyle}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <PartyPopper size={18} color="#b45309" />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {s.name}
                      </span>
                    </span>
                    <ChevronRight size={18} color="#9ca3af" />
                  </Link>
                ))}
              </div>
            </div>
          ) : null}

          <div style={headerStyle}>Schools · {filteredSchools.length}</div>
          <div style={{ display: "grid", gap: 8 }}>
            {filteredSchools.map((s) => (
              <Link key={s.id} href={`/m/sort/${s.id}`} style={rowStyle}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <GraduationCap size={18} color="#1d4ed8" />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.name}
                  </span>
                </span>
                <ChevronRight size={18} color="#9ca3af" />
              </Link>
            ))}
          </div>

          {filteredSchools.length === 0 && filteredEvents.length === 0 ? (
            <div style={{ color: "#6b7280", fontSize: 13, padding: 12 }}>
              {schools.length + events.length === 0
                ? "No schools or events yet."
                : "Nothing matches that search."}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

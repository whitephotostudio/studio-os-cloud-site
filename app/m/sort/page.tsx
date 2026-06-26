"use client";

// Sort & Review — school picker (/m/sort)
//
// Mirrors the desktop Sort panel's first step: pick a school, then review each
// student's photos. Drills into /m/sort/[schoolId].

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, GraduationCap, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type SchoolOption = { id: string; name: string };

function clean(v: string | null | undefined) {
  return (v ?? "").trim();
}

export default function SortPickSchoolPage() {
  const [supabase] = useState(() => createClient());
  const [schools, setSchools] = useState<SchoolOption[]>([]);
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
      const { data } = await supabase
        .from("schools")
        .select("id, school_name")
        .eq("photographer_id", pg.id)
        .order("school_name");
      if (cancelled) return;
      setSchools(
        ((data ?? []) as Array<{ id: string; school_name: string | null }>).map(
          (s) => ({ id: s.id, name: clean(s.school_name) || "Untitled school" }),
        ),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const filtered = schools.filter((s) =>
    s.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

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
        Pick a school to review and clean up each student&apos;s photos.
      </div>

      <div style={{ position: "relative", marginBottom: 12 }}>
        <Search
          size={16}
          style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#6b7280" }}
        />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search schools…"
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

      <div style={{ display: "grid", gap: 8 }}>
        {filtered.map((s) => (
          <Link
            key={s.id}
            href={`/m/sort/${s.id}`}
            style={{
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
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <GraduationCap size={18} color="#1d4ed8" />
              {s.name}
            </span>
            <ChevronRight size={18} color="#9ca3af" />
          </Link>
        ))}
        {!loading && filtered.length === 0 ? (
          <div style={{ color: "#6b7280", fontSize: 13, padding: 12 }}>
            {schools.length === 0 ? "No schools yet." : "No schools match that search."}
          </div>
        ) : null}
        {loading ? (
          <div style={{ color: "#6b7280", fontSize: 13, padding: 12 }}>Loading schools…</div>
        ) : null}
      </div>
    </div>
  );
}

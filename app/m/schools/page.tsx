"use client";

// Mobile schools list — /m/schools
//
// Harout opens this when a parent calls and says "what's my login?" or when
// he's about to send out a school's gallery link.  Every row shows the school
// name, student count, order count, and a quick "Share" action that copies
// the gallery URL + triggers navigator.share if available.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  GraduationCap,
  Search,
  Share2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type SchoolRow = {
  id: string;
  school_name: string | null;
  local_school_id: string | null;
  gallery_slug: string | null;
  created_at: string | null;
};

type CountRow = { school_id: string; n: number };

type StudentPhotoRow = { school_id: string; photo_url: string | null };

function clean(v: string | null | undefined): string {
  return (v ?? "").trim();
}

function buildShareUrl(origin: string, school: SchoolRow): string {
  const slug = clean(school.gallery_slug);
  if (slug) return `${origin}/g/${slug}`;
  const params = new URLSearchParams({ mode: "school", school: school.id });
  return `${origin}/parents?${params.toString()}`;
}

async function shareOrCopy(
  url: string,
  label: string,
  onToast: (s: string) => void,
) {
  const nav = typeof navigator !== "undefined" ? navigator : null;
  try {
    if (nav && "share" in nav && typeof nav.share === "function") {
      await nav.share({ title: label, text: label, url });
      return;
    }
  } catch {
    // User cancelled — fall through to copy.
  }
  try {
    await navigator.clipboard.writeText(url);
    onToast("Link copied");
  } catch {
    onToast("Could not copy");
  }
}

export default function MobileSchoolsPage() {
  const [supabase] = useState(() => createClient());
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [studentsBySchool, setStudentsBySchool] = useState<Record<string, number>>({});
  const [coversBySchool, setCoversBySchool] = useState<Record<string, string>>({});
  const [ordersBySchool, setOrdersBySchool] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError("");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data: photog } = await supabase
        .from("photographers")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!photog?.id || cancelled) return;

      const { data: schoolRows, error: sErr } = await supabase
        .from("schools")
        .select("id, school_name, local_school_id, gallery_slug, created_at")
        .eq("photographer_id", photog.id)
        .order("created_at", { ascending: false });

      if (cancelled) return;
      if (sErr) {
        setError(sErr.message);
        setSchools([]);
        setLoading(false);
        return;
      }
      setSchools((schoolRows ?? []) as SchoolRow[]);

      if (!schoolRows?.length) {
        setLoading(false);
        return;
      }

      const schoolIds = schoolRows.map((s) => s.id);

      const [studentsRes, ordersRes] = await Promise.all([
        // Pull photo_url too so we can paint a hero cover on each card —
        // driven by the reference mockup Harout shared.  First student with
        // a photo wins as the school's cover.
        supabase
          .from("students")
          .select("school_id, photo_url")
          .in("school_id", schoolIds),
        supabase
          .from("orders")
          .select("school_id")
          .eq("photographer_id", photog.id)
          .in("school_id", schoolIds),
      ]);

      if (cancelled) return;

      const stuCounts: Record<string, number> = {};
      const covers: Record<string, string> = {};
      for (const row of (studentsRes.data ?? []) as StudentPhotoRow[]) {
        if (!row.school_id) continue;
        stuCounts[row.school_id] = (stuCounts[row.school_id] ?? 0) + 1;
        const url = clean(row.photo_url);
        if (url && !covers[row.school_id]) covers[row.school_id] = url;
      }
      setStudentsBySchool(stuCounts);
      setCoversBySchool(covers);

      const ordCounts: Record<string, number> = {};
      for (const row of (ordersRes.data ?? []) as CountRow[]) {
        if (!row.school_id) continue;
        ordCounts[row.school_id] = (ordCounts[row.school_id] ?? 0) + 1;
      }
      setOrdersBySchool(ordCounts);

      setLoading(false);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return schools;
    return schools.filter((s) =>
      clean(s.school_name).toLowerCase().includes(term) ||
      clean(s.local_school_id).toLowerCase().includes(term),
    );
  }, [schools, search]);

  function triggerShare(school: SchoolRow, evt: React.MouseEvent) {
    evt.preventDefault();
    evt.stopPropagation();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = buildShareUrl(origin, school);
    const label = clean(school.school_name) || "Gallery";
    void shareOrCopy(url, `${label} — parent gallery`, (s) => {
      setToast(s);
      window.setTimeout(() => setToast(""), 2200);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.12em", fontWeight: 800, color: "#6b7280" }}>
          SCHOOLS
        </div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "#111827" }}>
          All schools
        </h1>
      </header>

      {/* Search */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "#f3f4f6",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: "10px 12px",
        }}
      >
        <Search size={16} color="#6b7280" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="School name or local id…"
          inputMode="search"
          autoComplete="off"
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: 14,
            fontWeight: 600,
            color: "#111827",
            minWidth: 0,
          }}
        />
        {search ? (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Clear search"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "#9ca3af",
              padding: 2,
              display: "inline-flex",
            }}
          >
            <X size={15} />
          </button>
        ) : null}
      </div>

      {error ? (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            padding: "10px 12px",
            borderRadius: 10,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      {/* List */}
      {loading ? (
        <div style={{ display: "grid", gap: 10 }}>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 14,
                padding: 14,
                background: "#fff",
              }}
            >
              <div
                style={{
                  height: 12,
                  width: "60%",
                  borderRadius: 6,
                  background: "#f3f4f6",
                  marginBottom: 8,
                }}
              />
              <div
                style={{
                  height: 10,
                  width: "40%",
                  borderRadius: 6,
                  background: "#f3f4f6",
                }}
              />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "40px 20px",
            color: "#6b7280",
          }}
        >
          <GraduationCap size={28} color="#d1d5db" style={{ marginBottom: 10 }} />
          <div style={{ fontWeight: 800, color: "#111827", fontSize: 14 }}>
            {search ? "No matches" : "No schools yet"}
          </div>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            {search
              ? "Try a shorter or different search term."
              : "Sync your first school from the desktop app."}
          </div>
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 14 }}>
          {filtered.map((school) => {
            const students = studentsBySchool[school.id] ?? 0;
            const orderCt = ordersBySchool[school.id] ?? 0;
            const cover = coversBySchool[school.id];
            // Mockup-inspired status pill: Gallery Released when there's
            // a slug + students, Pending when students exist but no slug,
            // Setup when there are no students yet.
            const status: { label: string; bg: string; fg: string } =
              !students
                ? { label: "Setup", bg: "#fff7ed", fg: "#c2410c" }
                : clean(school.gallery_slug)
                  ? { label: "Gallery Released", bg: "#dcfce7", fg: "#15803d" }
                  : { label: "Pending Delivery", bg: "#fef3c7", fg: "#92400e" };
            return (
              <li key={school.id}>
                <Link
                  href={`/m/schools/${school.id}`}
                  style={{
                    display: "block",
                    borderRadius: 16,
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    textDecoration: "none",
                    color: "inherit",
                    overflow: "hidden",
                    boxShadow: "0 2px 6px rgba(15,23,42,0.04)",
                  }}
                >
                  {/* Cover band — student photo if available, else gradient */}
                  <div
                    style={{
                      position: "relative",
                      height: 120,
                      background: cover
                        ? "#f3f4f6"
                        : "linear-gradient(135deg,#1e293b 0%,#0f172a 100%)",
                      overflow: "hidden",
                    }}
                  >
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={cover}
                        alt=""
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          filter: "brightness(0.85)",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "rgba(255,255,255,0.5)",
                        }}
                      >
                        <GraduationCap size={34} />
                      </div>
                    )}
                    {/* Status pill over the cover */}
                    <span
                      style={{
                        position: "absolute",
                        top: 10,
                        left: 10,
                        padding: "4px 10px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 800,
                        background: status.bg,
                        color: status.fg,
                        boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
                      }}
                    >
                      {status.label}
                    </span>
                    {/* Share shortcut, absolute top-right */}
                    <button
                      type="button"
                      aria-label="Share gallery"
                      onClick={(e) => triggerShare(school, e)}
                      style={{
                        position: "absolute",
                        top: 10,
                        right: 10,
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        background: "rgba(255,255,255,0.94)",
                        border: "1px solid rgba(0,0,0,0.06)",
                        color: "#111827",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        backdropFilter: "blur(6px)",
                      }}
                    >
                      <Share2 size={15} />
                    </button>
                  </div>

                  {/* Body */}
                  <div
                    style={{
                      padding: "12px 14px",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 900,
                          color: "#111827",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {clean(school.school_name) || "Untitled school"}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "#6b7280",
                          marginTop: 3,
                        }}
                      >
                        {students} student{students === 1 ? "" : "s"} ·{" "}
                        <strong
                          style={{
                            color: orderCt > 0 ? "#111827" : "#9ca3af",
                          }}
                        >
                          Orders: {orderCt}
                        </strong>
                      </div>
                    </div>
                    <ChevronRight size={16} color="#9ca3af" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {toast ? (
        <div
          style={{
            position: "fixed",
            bottom: 90,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#111827",
            color: "#fff",
            padding: "10px 18px",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 700,
            zIndex: 50,
            boxShadow: "0 10px 24px rgba(0,0,0,0.2)",
          }}
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}

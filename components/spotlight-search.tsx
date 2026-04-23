"use client";

// Spotlight Search — Cmd+K / Ctrl+K global finder.
//
// Why this exists: Harout kept saying the most useful thing he could
// have on his phone is "type 'Ethan' or '3e92', instantly see matching
// students, orders, or schools across everything."  Then he asked for
// the same thing on desktop.  So this component is the single shared
// search palette that powers both surfaces.
//
// Usage:
//   <SpotlightLauncher /> — renders the visible "Search…" button.
//   The launcher contains the modal portal, so mounting it anywhere in
//   the page tree is enough.
//
// Global shortcut: Cmd/Ctrl + K toggles the palette from any dashboard
// page.  ESC closes.  Clicking a result navigates.
//
// Data sources (all filtered by the logged-in photographer via RLS +
// explicit photographer_id check):
//   - students: first/last name match → routes to school page
//   - schools:  name match → /dashboard/projects/schools/[id]
//   - projects: event title match → /dashboard/projects/[id]
//   - orders:   first 8 chars of UUID (order short ID) → /dashboard/orders

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  ChevronRight,
  GraduationCap,
  Receipt,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// ── Types ────────────────────────────────────────────────────────────

type SpotlightHit =
  | {
      kind: "student";
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
    }
  | {
      kind: "order";
      id: string;
      title: string;
      subtitle: string;
      href: string;
    };

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function isShortOrderId(term: string): boolean {
  // Orders are uuids; the user typically types the first 8 chars.
  return /^[0-9a-f-]{4,}$/i.test(term);
}

// ── Shared hook: cross-table search ──────────────────────────────────

function useSpotlight(term: string, enabled: boolean) {
  const [supabase] = useState(() => createClient());
  const [photographerId, setPhotographerId] = useState<string | null>(null);
  const [hits, setHits] = useState<SpotlightHit[]>([]);
  const [loading, setLoading] = useState(false);

  // Resolve photographer id once per mount.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data } = await supabase
        .from("photographers")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled && data?.id) setPhotographerId(data.id as string);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (!enabled || !photographerId) {
      setHits([]);
      setLoading(false);
      return;
    }
    const trimmed = term.trim();
    if (trimmed.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const handle = window.setTimeout(async () => {
      try {
        // Supabase query builders are PromiseLike (thenable), not real Promises.
        // Declaring as PromiseLike<unknown>[] lets us stack them in Promise.all
        // without extra `.then()` wrappers.
        const promises: PromiseLike<unknown>[] = [
          supabase
            .from("students")
            .select(
              "id, first_name, last_name, photo_url, school_id, class_name, schools(school_name)",
            )
            .eq("photographer_id", photographerId)
            .or(
              `first_name.ilike.%${trimmed}%,last_name.ilike.%${trimmed}%`,
            )
            .limit(8),
          supabase
            .from("schools")
            .select("id, school_name")
            .eq("photographer_id", photographerId)
            .ilike("school_name", `%${trimmed}%`)
            .limit(6),
          supabase
            .from("projects")
            .select("id, title, client_name, workflow_type")
            .eq("photographer_id", photographerId)
            .eq("workflow_type", "event")
            .or(
              `title.ilike.%${trimmed}%,client_name.ilike.%${trimmed}%`,
            )
            .limit(6),
        ];

        // Orders lookup by short id — only when the term looks hex-ish.
        if (isShortOrderId(trimmed)) {
          promises.push(
            supabase
              .from("orders")
              .select(
                "id, package_name, total_cents, total_amount, currency, student:students(first_name,last_name), school:schools(school_name)",
              )
              .eq("photographer_id", photographerId)
              .ilike("id", `${trimmed.toLowerCase()}%`)
              .limit(5),
          );
        }

        const results = await Promise.all(promises);
        if (cancelled) return;

        const next: SpotlightHit[] = [];

        const students = results[0] as {
          data?: Array<{
            id: string;
            first_name: string | null;
            last_name: string | null;
            school_id: string | null;
            class_name: string | null;
            schools:
              | { school_name: string | null }
              | { school_name: string | null }[]
              | null;
          }> | null;
        };
        // Remember which students matched so we can pull their orders too —
        // typing "Ethan" should surface Ethan AND Ethan's orders.
        const matchedStudentIds: string[] = [];
        const matchedStudentNames: Record<string, string> = {};
        for (const s of students.data ?? []) {
          const schoolRow = Array.isArray(s.schools) ? s.schools[0] : s.schools;
          const studentName =
            [clean(s.first_name), clean(s.last_name)]
              .filter(Boolean)
              .join(" ") || "Student";
          matchedStudentIds.push(s.id);
          matchedStudentNames[s.id] = studentName;
          next.push({
            kind: "student",
            id: s.id,
            title: studentName,
            subtitle: [
              clean(schoolRow?.school_name) || "Student",
              clean(s.class_name),
            ]
              .filter(Boolean)
              .join(" · "),
            href: s.school_id
              ? `/dashboard/projects/schools/${s.school_id}`
              : "/dashboard/schools",
          });
        }

        const schools = results[1] as {
          data?: Array<{ id: string; school_name: string | null }> | null;
        };
        for (const school of schools.data ?? []) {
          next.push({
            kind: "school",
            id: school.id,
            title: clean(school.school_name) || "School",
            subtitle: "School",
            href: `/dashboard/projects/schools/${school.id}`,
          });
        }

        const projects = results[2] as {
          data?: Array<{
            id: string;
            title: string | null;
            client_name: string | null;
          }> | null;
        };
        for (const proj of projects.data ?? []) {
          next.push({
            kind: "event",
            id: proj.id,
            title: clean(proj.title) || "Event",
            subtitle: clean(proj.client_name) || "Event",
            href: `/dashboard/projects/${proj.id}`,
          });
        }

        // Orders attached to matched students.  Deduped by order.id so we
        // don't double-count if the short-id branch below also matched.
        const seenOrderIds = new Set<string>();
        if (matchedStudentIds.length > 0) {
          const { data: studentOrders } = await supabase
            .from("orders")
            .select(
              "id, package_name, total_cents, total_amount, currency, student_id, created_at, school:schools(school_name)",
            )
            .eq("photographer_id", photographerId)
            .in("student_id", matchedStudentIds)
            .order("created_at", { ascending: false })
            .limit(8);
          if (!cancelled && studentOrders) {
            for (const order of studentOrders as Array<{
              id: string;
              package_name: string | null;
              student_id: string | null;
              school:
                | { school_name: string | null }
                | { school_name: string | null }[]
                | null;
            }>) {
              if (seenOrderIds.has(order.id)) continue;
              seenOrderIds.add(order.id);
              const school = Array.isArray(order.school)
                ? order.school[0]
                : order.school;
              const name = matchedStudentNames[clean(order.student_id)] || "Student";
              next.push({
                kind: "order",
                id: order.id,
                title: `Order ${order.id.slice(0, 8)} · ${name}`,
                subtitle:
                  [clean(order.package_name), clean(school?.school_name)]
                    .filter(Boolean)
                    .join(" · ") || "Order",
                href: `/dashboard/orders?focus=${order.id}`,
              });
            }
          }
        }

        if (isShortOrderId(trimmed) && results[3]) {
          const ordersResult = results[3] as {
            data?: Array<{
              id: string;
              package_name: string | null;
              total_cents: number | null;
              total_amount: number | null;
              currency: string | null;
              student:
                | { first_name: string | null; last_name: string | null }
                | { first_name: string | null; last_name: string | null }[]
                | null;
              school:
                | { school_name: string | null }
                | { school_name: string | null }[]
                | null;
            }> | null;
          };
          for (const order of ordersResult.data ?? []) {
            if (seenOrderIds.has(order.id)) continue;
            seenOrderIds.add(order.id);
            const student = Array.isArray(order.student)
              ? order.student[0]
              : order.student;
            const school = Array.isArray(order.school)
              ? order.school[0]
              : order.school;
            const studentName =
              [clean(student?.first_name), clean(student?.last_name)]
                .filter(Boolean)
                .join(" ") || "Customer";
            next.push({
              kind: "order",
              id: order.id,
              title: `Order ${order.id.slice(0, 8)} · ${studentName}`,
              subtitle:
                [clean(order.package_name), clean(school?.school_name)]
                  .filter(Boolean)
                  .join(" · ") || "Order",
              href: `/dashboard/orders?focus=${order.id}`,
            });
          }
        }

        setHits(next);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [term, supabase, photographerId, enabled]);

  return { hits, loading };
}

// ── Modal ────────────────────────────────────────────────────────────

type SpotlightModalProps = {
  open: boolean;
  onClose: () => void;
};

export function SpotlightModal({ open, onClose }: SpotlightModalProps) {
  const [term, setTerm] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { hits, loading } = useSpotlight(term, open);

  // Reset + autofocus on open.
  useEffect(() => {
    if (open) {
      setTerm("");
      setActiveIndex(0);
      // Autofocus after the modal transition.
      window.setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [hits.length, term]);

  const canShowResults = term.trim().length >= 2;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (!canShowResults || hits.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((idx) => (idx + 1) % hits.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((idx) => (idx - 1 + hits.length) % hits.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const hit = hits[activeIndex];
        if (hit) {
          router.push(hit.href);
          onClose();
        }
      }
    },
    [canShowResults, hits, activeIndex, onClose, router],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Spotlight search"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.45)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "14vh 20px 20px",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 620,
          background: "#ffffff",
          borderRadius: 18,
          boxShadow:
            "0 24px 64px rgba(15,23,42,0.28), 0 2px 8px rgba(15,23,42,0.08)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          maxHeight: "70vh",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 16px",
            borderBottom: "1px solid #eef2f7",
          }}
        >
          <Search size={18} color="#6b7280" />
          <input
            ref={inputRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Search students, schools, events, or order "3e92dbe3"…'
            aria-label="Search everything"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 16,
              fontWeight: 600,
              color: "#111827",
            }}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            style={{
              width: 30,
              height: 30,
              borderRadius: 999,
              background: "#f3f4f6",
              color: "#6b7280",
              border: "none",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ overflow: "auto" }}>
          {!canShowResults ? (
            <div
              style={{
                padding: 20,
                fontSize: 13,
                color: "#6b7280",
                fontWeight: 600,
              }}
            >
              Start typing — 2 characters or more. Try a student name, a school
              name, or the first few characters of an order number.
            </div>
          ) : loading && hits.length === 0 ? (
            <div
              style={{
                padding: 20,
                fontSize: 13,
                color: "#6b7280",
                fontWeight: 600,
              }}
            >
              Searching…
            </div>
          ) : hits.length === 0 ? (
            <div
              style={{
                padding: 20,
                fontSize: 13,
                color: "#6b7280",
                fontWeight: 600,
              }}
            >
              No matches for "{term}".
            </div>
          ) : (
            hits.map((hit, idx) => (
              <Link
                key={`${hit.kind}-${hit.id}-${idx}`}
                href={hit.href}
                onClick={onClose}
                onMouseEnter={() => setActiveIndex(idx)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 16px",
                  textDecoration: "none",
                  color: "#111827",
                  background: idx === activeIndex ? "#fff5f5" : "#fff",
                  borderTop: idx === 0 ? undefined : "1px solid #f3f4f6",
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    background: kindBg(hit.kind),
                    color: kindFg(hit.kind),
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {kindIcon(hit.kind)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
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

        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid #eef2f7",
            background: "#fafafa",
            fontSize: 11,
            color: "#6b7280",
            fontWeight: 700,
            letterSpacing: "0.04em",
            display: "flex",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <span>↑ ↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

// ── Launcher button + Cmd/Ctrl+K shortcut ────────────────────────────

type SpotlightLauncherProps = {
  /** Compact icon-only variant for narrow headers. */
  compact?: boolean;
};

export function SpotlightLauncher({ compact = false }: SpotlightLauncherProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isCmdK =
        (e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey);
      if (isCmdK) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open search (Cmd+K)"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          padding: compact ? "8px 10px" : "10px 14px",
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          color: "#6b7280",
          fontWeight: 700,
          fontSize: 13,
          cursor: "pointer",
          minWidth: compact ? undefined : 240,
          width: compact ? undefined : "100%",
          justifyContent: compact ? "center" : "space-between",
          boxShadow: "0 2px 6px rgba(15,23,42,0.04)",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            color: "#6b7280",
          }}
        >
          <Search size={15} />
          {!compact ? <span>Search everything…</span> : null}
        </span>
        {!compact ? (
          <span
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              fontSize: 11,
              fontWeight: 800,
              color: "#9ca3af",
              background: "#f3f4f6",
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              padding: "2px 6px",
              letterSpacing: "0.04em",
            }}
          >
            ⌘K
          </span>
        ) : null}
      </button>

      <SpotlightModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// ── Kind styling helpers ────────────────────────────────────────────

function kindLabel(kind: SpotlightHit["kind"]): string {
  switch (kind) {
    case "student":
      return "Student";
    case "school":
      return "School";
    case "event":
      return "Event";
    case "order":
      return "Order";
  }
}

function kindBg(kind: SpotlightHit["kind"]): string {
  switch (kind) {
    case "student":
      return "#eef2ff";
    case "school":
      return "#eff6ff";
    case "event":
      return "#fff7ed";
    case "order":
      return "#fff5f5";
  }
}

function kindFg(kind: SpotlightHit["kind"]): string {
  switch (kind) {
    case "student":
      return "#4338ca";
    case "school":
      return "#1d4ed8";
    case "event":
      return "#b45309";
    case "order":
      return "#cc0000";
  }
}

function kindIcon(kind: SpotlightHit["kind"]): React.ReactNode {
  switch (kind) {
    case "student":
      return <UserRound size={16} />;
    case "school":
      return <GraduationCap size={16} />;
    case "event":
      return <CalendarDays size={16} />;
    case "order":
      return <Receipt size={16} />;
  }
}

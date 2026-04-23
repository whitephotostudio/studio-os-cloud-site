"use client";

// Inline Spotlight results for Studio Assistant.
//
// Reuses the shared `useSpotlight` hook that powers the ⌘K palette so
// the command bar doubles as a search box.  Type "Ethan" and this
// component shows matching students / schools / events / orders
// underneath the bar — clicking a row navigates directly, same as
// Spotlight.  Pressing "Ask" still runs the intent parser untouched.

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  SpotlightHit,
  kindBg,
  kindFg,
  kindIcon,
  kindLabel,
  useSpotlight,
} from "@/components/spotlight-search";

type InlineSpotlightResultsProps = {
  /** The current command-bar text.  Results render when it's ≥ 2 chars. */
  term: string;
  /** Called when the user clicks a result (so the host can clear / collapse). */
  onSelect?: () => void;
};

type SpotlightKind = SpotlightHit["kind"];

export function InlineSpotlightResults({
  term,
  onSelect,
}: InlineSpotlightResultsProps) {
  const [kindFilter, setKindFilter] = useState<SpotlightKind | null>(null);
  const { hits, loading } = useSpotlight(term, true);

  const canShow = term.trim().length >= 2;

  const countsByKind = useMemo(() => {
    const m: Record<SpotlightKind, number> = {
      student: 0,
      school: 0,
      event: 0,
      order: 0,
    };
    for (const h of hits) m[h.kind] += 1;
    return m;
  }, [hits]);

  const visibleHits = useMemo(
    () => (kindFilter ? hits.filter((h) => h.kind === kindFilter) : hits),
    [hits, kindFilter],
  );

  if (!canShow) return null;

  return (
    <div
      style={{
        marginTop: 10,
        background: "#ffffff",
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        boxShadow: "0 14px 40px rgba(15,23,42,0.06)",
        overflow: "hidden",
        maxHeight: 360,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {hits.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            padding: "10px 14px",
            borderBottom: "1px solid #eef2f7",
            background: "#fafafa",
          }}
        >
          <Pill
            label="All"
            count={hits.length}
            active={kindFilter === null}
            onClick={() => setKindFilter(null)}
            color="#111827"
            background="#fff"
          />
          {(
            [
              { kind: "student" as const, label: "Students" },
              { kind: "school" as const, label: "Schools" },
              { kind: "event" as const, label: "Events" },
              { kind: "order" as const, label: "Orders" },
            ]
          )
            .filter((p) => countsByKind[p.kind] > 0)
            .map((p) => (
              <Pill
                key={p.kind}
                label={p.label}
                count={countsByKind[p.kind]}
                active={kindFilter === p.kind}
                onClick={() =>
                  setKindFilter((prev) => (prev === p.kind ? null : p.kind))
                }
                color={kindFg(p.kind)}
                background={kindBg(p.kind)}
              />
            ))}
        </div>
      ) : null}

      <div style={{ overflowY: "auto" }}>
        {loading && visibleHits.length === 0 ? (
          <div
            style={{
              padding: 16,
              fontSize: 13,
              color: "#6b7280",
              fontWeight: 600,
            }}
          >
            Searching…
          </div>
        ) : visibleHits.length === 0 ? (
          <div
            style={{
              padding: 16,
              fontSize: 13,
              color: "#6b7280",
              fontWeight: 600,
            }}
          >
            {hits.length === 0
              ? `No matches for "${term}". Try pressing Ask to run it as a command.`
              : `No ${kindLabel(kindFilter!).toLowerCase()}s for "${term}". Try another filter.`}
          </div>
        ) : (
          visibleHits.map((hit, idx) => (
            <Link
              key={`${hit.kind}-${hit.id}-${idx}`}
              href={hit.href}
              onClick={onSelect}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                textDecoration: "none",
                color: "#111827",
                borderTop: idx === 0 ? "none" : "1px solid #f3f4f6",
                background: "#fff",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#fff5f5";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#fff";
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
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
    </div>
  );
}

type PillProps = {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  color: string;
  background: string;
};

function Pill({ label, count, active, onClick, color, background }: PillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        borderRadius: 999,
        border: active ? `1.5px solid ${color}` : "1px solid #e5e7eb",
        background: active ? color : background,
        color: active ? "#fff" : color,
        fontSize: 12,
        fontWeight: 800,
        letterSpacing: "0.02em",
        cursor: "pointer",
      }}
    >
      <span>{label}</span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 800,
          padding: "1px 6px",
          borderRadius: 999,
          background: active ? "rgba(255,255,255,0.24)" : "rgba(15,23,42,0.06)",
          color: active ? "#fff" : color,
        }}
      >
        {count}
      </span>
    </button>
  );
}

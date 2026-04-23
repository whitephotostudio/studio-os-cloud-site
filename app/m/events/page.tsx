"use client";

// Mobile events list — /m/events
//
// Harout opens this while driving between shoots or when a client asks
// "where's my gallery?".  Each card shows the event title, event date,
// client, cover photo, order count, and a one-tap share.  Status pill
// ("Gallery Released / Pending Delivery / Setup") is derived the same way
// the schools list derives it so the visual language matches.
//
// Events are rows in `projects` where workflow_type = 'event'.  Unlike
// schools, events have one access_pin on the project itself (not per
// student), and the cover comes straight from projects.cover_photo_url.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  Search,
  Share2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type EventRow = {
  id: string;
  title: string | null;
  client_name: string | null;
  workflow_type: string | null;
  event_date: string | null;
  shoot_date: string | null;
  gallery_slug: string | null;
  cover_photo_url: string | null;
  status: string | null;
  portal_status: string | null;
  created_at: string | null;
};

type OrderCountRow = { project_id: string | null };
type MediaCountRow = { project_id: string | null };

function clean(v: string | null | undefined): string {
  return (v ?? "").trim();
}

function formatEventDate(value: string | null | undefined): string {
  const raw = clean(value);
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function buildShareUrl(origin: string, event: EventRow): string {
  const slug = clean(event.gallery_slug);
  if (slug) return `${origin}/g/${slug}`;
  const params = new URLSearchParams({ mode: "event", project: event.id });
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

export default function MobileEventsPage() {
  const [supabase] = useState(() => createClient());
  const [events, setEvents] = useState<EventRow[]>([]);
  const [ordersByEvent, setOrdersByEvent] = useState<Record<string, number>>({});
  const [mediaByEvent, setMediaByEvent] = useState<Record<string, number>>({});
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

      const { data: rows, error: eErr } = await supabase
        .from("projects")
        .select(
          "id, title, client_name, workflow_type, event_date, shoot_date, gallery_slug, cover_photo_url, status, portal_status, created_at",
        )
        .eq("photographer_id", photog.id)
        .eq("workflow_type", "event")
        .order("event_date", { ascending: false, nullsFirst: false });

      if (cancelled) return;
      if (eErr) {
        setError(eErr.message);
        setEvents([]);
        setLoading(false);
        return;
      }
      setEvents((rows ?? []) as EventRow[]);

      if (!rows?.length) {
        setLoading(false);
        return;
      }

      const ids = rows.map((r) => r.id);

      // In parallel: order counts per event, and "has any media" counts so the
      // status pill can tell the difference between "uploaded, not released"
      // and "nothing uploaded yet".
      const [ordersRes, mediaRes] = await Promise.all([
        supabase
          .from("orders")
          .select("project_id")
          .eq("photographer_id", photog.id)
          .in("project_id", ids),
        supabase
          .from("media")
          .select("project_id")
          .in("project_id", ids)
          .limit(2000),
      ]);

      if (cancelled) return;

      const ordCounts: Record<string, number> = {};
      for (const row of (ordersRes.data ?? []) as OrderCountRow[]) {
        const pid = clean(row.project_id);
        if (!pid) continue;
        ordCounts[pid] = (ordCounts[pid] ?? 0) + 1;
      }
      setOrdersByEvent(ordCounts);

      const mediaCounts: Record<string, number> = {};
      for (const row of (mediaRes.data ?? []) as MediaCountRow[]) {
        const pid = clean(row.project_id);
        if (!pid) continue;
        mediaCounts[pid] = (mediaCounts[pid] ?? 0) + 1;
      }
      setMediaByEvent(mediaCounts);

      setLoading(false);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return events;
    return events.filter((e) => {
      return (
        clean(e.title).toLowerCase().includes(term) ||
        clean(e.client_name).toLowerCase().includes(term)
      );
    });
  }, [events, search]);

  function triggerShare(event: EventRow, evt: React.MouseEvent) {
    evt.preventDefault();
    evt.stopPropagation();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = buildShareUrl(origin, event);
    const label = clean(event.title) || "Event gallery";
    void shareOrCopy(url, `${label} — event gallery`, (s) => {
      setToast(s);
      window.setTimeout(() => setToast(""), 2200);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.12em", fontWeight: 800, color: "#6b7280" }}>
          EVENTS
        </div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "#111827" }}>
          All events
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
          placeholder="Event or client name…"
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
          <CalendarDays size={28} color="#d1d5db" style={{ marginBottom: 10 }} />
          <div style={{ fontWeight: 800, color: "#111827", fontSize: 14 }}>
            {search ? "No matches" : "No events yet"}
          </div>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            {search
              ? "Try a shorter or different search term."
              : "Create your first event from the desktop app."}
          </div>
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 14 }}>
          {filtered.map((event) => {
            const orderCt = ordersByEvent[event.id] ?? 0;
            const mediaCt = mediaByEvent[event.id] ?? 0;
            const cover = clean(event.cover_photo_url);
            const date = formatEventDate(event.event_date || event.shoot_date);
            const client = clean(event.client_name);
            // Mockup-inspired status pill:
            //   - Setup  → nothing uploaded yet
            //   - Pending Delivery  → has photos but no gallery slug
            //   - Gallery Released  → slug set (parents can find it via /g/...)
            const status: { label: string; bg: string; fg: string } =
              !mediaCt
                ? { label: "Setup", bg: "#fff7ed", fg: "#c2410c" }
                : clean(event.gallery_slug)
                  ? { label: "Gallery Released", bg: "#dcfce7", fg: "#15803d" }
                  : { label: "Pending Delivery", bg: "#fef3c7", fg: "#92400e" };
            return (
              <li key={event.id}>
                <Link
                  href={`/m/events/${event.id}`}
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
                  {/* Cover band */}
                  <div
                    style={{
                      position: "relative",
                      height: 120,
                      background: cover
                        ? "#111"
                        : "linear-gradient(135deg,#7c2d12 0%,#b45309 100%)",
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
                          color: "rgba(255,255,255,0.55)",
                        }}
                      >
                        <CalendarDays size={34} />
                      </div>
                    )}
                    {/* Status pill */}
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
                    {/* Share shortcut */}
                    <button
                      type="button"
                      aria-label="Share event gallery"
                      onClick={(e) => triggerShare(event, e)}
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
                    {/* Event date chip — tucked bottom-left over the cover */}
                    {date ? (
                      <span
                        style={{
                          position: "absolute",
                          bottom: 10,
                          left: 10,
                          padding: "3px 8px",
                          borderRadius: 8,
                          fontSize: 11,
                          fontWeight: 800,
                          background: "rgba(17,24,39,0.8)",
                          color: "#fff",
                          letterSpacing: "0.02em",
                          backdropFilter: "blur(4px)",
                        }}
                      >
                        {date}
                      </span>
                    ) : null}
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
                        {clean(event.title) || "Untitled event"}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "#6b7280",
                          marginTop: 3,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {client ? `${client} · ` : ""}
                        {mediaCt} photo{mediaCt === 1 ? "" : "s"} ·{" "}
                        <strong
                          style={{
                            color: orderCt > 0 ? "#111827" : "#9ca3af",
                          }}
                        >
                          Orders: {orderCt}
                        </strong>
                      </div>
                    </div>
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

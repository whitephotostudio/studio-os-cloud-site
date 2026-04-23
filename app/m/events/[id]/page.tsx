"use client";

// Mobile event detail — /m/events/[id]
//
// Inspired by the HH Studio OS Cloud reference mockups Harout shared:
//   - Hero cover band (cover_photo_url) + "Gallery Released / Pending
//     Delivery / Setup" status pill + event title + date.
//   - Parent-gallery share block with native-share and copy-link buttons.
//   - Single PIN card (events use one access_pin on the project itself,
//     not per-student like schools do).
//   - Recent orders strip drilling into /m/orders/[id] or the full
//     /dashboard/projects/[id]/orders page.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Lock,
  Share2,
  ShoppingBag,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type EventProject = {
  id: string;
  title: string | null;
  client_name: string | null;
  workflow_type: string | null;
  event_date: string | null;
  shoot_date: string | null;
  gallery_slug: string | null;
  cover_photo_url: string | null;
  access_mode: string | null;
  access_pin: string | null;
  status: string | null;
  portal_status: string | null;
};

type OrderPreview = {
  id: string;
  created_at: string | null;
  status: string | null;
  total_cents: number | null;
  total_amount: number | null;
  currency: string | null;
  parent_name: string | null;
  customer_name: string | null;
  student:
    | { first_name: string | null; last_name: string | null }
    | { first_name: string | null; last_name: string | null }[]
    | null;
};

function clean(v: string | null | undefined): string {
  return (v ?? "").trim();
}

function single<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

function money(order: OrderPreview): string {
  const cents =
    order.total_cents != null
      ? order.total_cents
      : order.total_amount != null
        ? Math.round(order.total_amount * 100)
        : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: order.currency || "USD",
  }).format(cents / 100);
}

function relativeTime(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatEventDate(value: string | null | undefined): string {
  const raw = clean(value);
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function shareOrCopy(
  url: string,
  title: string,
  onToast: (s: string) => void,
) {
  const nav = typeof navigator !== "undefined" ? navigator : null;
  try {
    if (nav && "share" in nav && typeof nav.share === "function") {
      await nav.share({ title, text: title, url });
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

export default function MobileEventDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [supabase] = useState(() => createClient());
  const [event, setEvent] = useState<EventProject | null>(null);
  const [photoCount, setPhotoCount] = useState(0);
  const [orders, setOrders] = useState<OrderPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pinRevealed, setPinRevealed] = useState(false);
  const [copied, setCopied] = useState<string>("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError("");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data: row, error: projErr } = await supabase
        .from("projects")
        .select(
          "id, title, client_name, workflow_type, event_date, shoot_date, gallery_slug, cover_photo_url, access_mode, access_pin, status, portal_status",
        )
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      if (projErr) {
        setError(projErr.message);
        setLoading(false);
        return;
      }
      setEvent((row as EventProject | null) ?? null);

      const [mediaRes, ordersRes] = await Promise.all([
        supabase
          .from("media")
          .select("id", { count: "exact", head: true })
          .eq("project_id", id),
        supabase
          .from("orders")
          .select(
            `id, created_at, status, total_cents, total_amount, currency,
             parent_name, customer_name,
             student:students(first_name,last_name)`,
          )
          .eq("project_id", id)
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

      if (cancelled) return;

      if (typeof mediaRes.count === "number") {
        setPhotoCount(mediaRes.count);
      }

      if (!ordersRes.error) {
        setOrders((ordersRes.data ?? []) as OrderPreview[]);
      }

      setLoading(false);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [id, supabase]);

  const cover = clean(event?.cover_photo_url);

  const status = useMemo(() => {
    if (!photoCount) return { label: "Setup", bg: "#fff7ed", fg: "#c2410c" };
    if (clean(event?.gallery_slug))
      return { label: "Gallery Released", bg: "#dcfce7", fg: "#15803d" };
    return { label: "Pending Delivery", bg: "#fef3c7", fg: "#92400e" };
  }, [photoCount, event?.gallery_slug]);

  const accessLocked =
    clean(event?.access_mode).toLowerCase() === "pin" &&
    clean(event?.access_pin).length > 0;

  function showToast(s: string) {
    setToast(s);
    window.setTimeout(() => setToast(""), 2200);
  }

  function galleryUrl(): string {
    if (!event) return "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const slug = clean(event.gallery_slug);
    if (slug) return `${origin}/g/${slug}`;
    const params = new URLSearchParams({ mode: "event", project: event.id });
    return `${origin}/parents?${params.toString()}`;
  }

  async function shareGallery() {
    const url = galleryUrl();
    if (!url) return;
    const label = `${clean(event?.title) || "Event"} — parent gallery`;
    await shareOrCopy(url, label, showToast);
  }

  async function copyGallery() {
    const url = galleryUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied("gallery");
      window.setTimeout(() => setCopied(""), 1500);
    } catch {
      showToast("Could not copy");
    }
  }

  async function shareFullAccess() {
    if (!event) return;
    const url = galleryUrl();
    if (!url) return;
    const title = clean(event.title) || "Event";
    const pin = clean(event.access_pin);
    const msg = accessLocked
      ? `${title} gallery is live. Visit ${url} and enter access PIN ${pin} to view the photos.`
      : `${title} gallery is live. Visit ${url} to view the photos.`;
    await shareOrCopy(url, msg, showToast);
  }

  async function copyPin() {
    if (!event) return;
    const pin = clean(event.access_pin);
    if (!pin) return;
    try {
      await navigator.clipboard.writeText(pin);
      setCopied("pin");
      window.setTimeout(() => setCopied(""), 1500);
    } catch {
      showToast("Could not copy PIN");
    }
  }

  if (loading) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <div
          style={{
            height: 160,
            borderRadius: 16,
            background: "#f3f4f6",
          }}
        />
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              height: 64,
              borderRadius: 12,
              background: "#f3f4f6",
            }}
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          background: "#fef2f2",
          border: "1px solid #fecaca",
          color: "#991b1b",
          padding: "12px 14px",
          borderRadius: 12,
          fontSize: 14,
        }}
      >
        {error}
      </div>
    );
  }

  if (!event) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px", color: "#6b7280" }}>
        <CalendarDays size={28} color="#d1d5db" style={{ marginBottom: 10 }} />
        <div style={{ fontWeight: 800, color: "#111827", fontSize: 14 }}>
          Event not found
        </div>
        <Link
          href="/m/events"
          style={{
            display: "inline-flex",
            marginTop: 16,
            padding: "10px 16px",
            borderRadius: 999,
            background: "#111827",
            color: "#fff",
            textDecoration: "none",
            fontWeight: 800,
            fontSize: 13,
          }}
        >
          Back to events
        </Link>
      </div>
    );
  }

  const date = formatEventDate(event.event_date || event.shoot_date);
  const client = clean(event.client_name);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Link
        href="/m/events"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "#6b7280",
          textDecoration: "none",
          fontWeight: 700,
          fontSize: 13,
        }}
      >
        <ArrowLeft size={14} /> All events
      </Link>

      {/* Hero */}
      <section
        style={{
          borderRadius: 18,
          background: "#fff",
          border: "1px solid #e5e7eb",
          overflow: "hidden",
          boxShadow: "0 4px 12px rgba(15,23,42,0.05)",
        }}
      >
        <div
          style={{
            position: "relative",
            height: 160,
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
                filter: "brightness(0.78)",
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
              <CalendarDays size={40} />
            </div>
          )}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.6) 100%)",
            }}
          />
          <span
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              padding: "4px 10px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 800,
              background: status.bg,
              color: status.fg,
              boxShadow: "0 2px 6px rgba(0,0,0,0.18)",
            }}
          >
            {status.label}
          </span>
          <div
            style={{
              position: "absolute",
              bottom: 12,
              left: 14,
              right: 14,
              color: "#fff",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", opacity: 0.9 }}>
              EVENT
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 900,
                marginTop: 2,
                lineHeight: 1.15,
                textShadow: "0 1px 3px rgba(0,0,0,0.5)",
              }}
            >
              {clean(event.title) || "Untitled event"}
            </div>
            {(date || client) ? (
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  marginTop: 4,
                  opacity: 0.9,
                  textShadow: "0 1px 3px rgba(0,0,0,0.5)",
                }}
              >
                {[date, client].filter(Boolean).join(" · ")}
              </div>
            ) : null}
          </div>
        </div>

        {/* Gallery share block */}
        <div style={{ padding: 14, display: "grid", gap: 10 }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.12em",
              fontWeight: 800,
              color: "#6b7280",
            }}
          >
            PARENT GALLERY LINK
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#111827",
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              padding: "10px 12px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: "ui-monospace, monospace",
            }}
          >
            {galleryUrl() || "—"}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
            }}
          >
            <button
              type="button"
              onClick={shareGallery}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "12px 14px",
                borderRadius: 12,
                background: "#111827",
                color: "#fff",
                border: "none",
                fontWeight: 800,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              <Share2 size={15} /> Share
            </button>
            <button
              type="button"
              onClick={copyGallery}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "12px 14px",
                borderRadius: 12,
                background: "#fff5f5",
                border: "1px solid #fecaca",
                color: "#cc0000",
                fontWeight: 800,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              {copied === "gallery" ? <Check size={15} /> : <Copy size={15} />}
              {copied === "gallery" ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
      </section>

      {/* Access PIN card — single PIN per event (unlike schools, which have
          a PIN per student). */}
      {accessLocked ? (
        <section
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 16,
            padding: 14,
            display: "grid",
            gap: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 10,
              letterSpacing: "0.12em",
              fontWeight: 800,
              color: "#6b7280",
            }}
          >
            <Lock size={12} /> ACCESS PIN
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                flex: 1,
                fontFamily: "ui-monospace, monospace",
                fontSize: 20,
                fontWeight: 900,
                color: "#111827",
                letterSpacing: "0.18em",
                padding: "10px 14px",
                background: "#f9fafb",
                border: "1px solid #e5e7eb",
                borderRadius: 10,
              }}
            >
              {pinRevealed ? clean(event.access_pin) : "• • • •"}
            </div>
            <button
              type="button"
              aria-label={pinRevealed ? "Hide PIN" : "Show PIN"}
              onClick={() => setPinRevealed((v) => !v)}
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: "#fff",
                border: "1px solid #e5e7eb",
                color: "#374151",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {pinRevealed ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
            }}
          >
            <button
              type="button"
              onClick={copyPin}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "10px 14px",
                borderRadius: 12,
                background: "#f3f4f6",
                border: "1px solid #e5e7eb",
                color: "#111827",
                fontWeight: 800,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {copied === "pin" ? <Check size={14} /> : <Copy size={14} />}
              {copied === "pin" ? "Copied" : "Copy PIN"}
            </button>
            <button
              type="button"
              onClick={() => void shareFullAccess()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "10px 14px",
                borderRadius: 12,
                background: "#111827",
                border: "none",
                color: "#fff",
                fontWeight: 800,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              <Share2 size={14} /> Share link + PIN
            </button>
          </div>
        </section>
      ) : (
        <section
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 16,
            padding: 14,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "#f3f4f6",
              color: "#6b7280",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Lock size={15} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>
              No PIN set
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
              This gallery is open — parents can view it with just the link.
            </div>
          </div>
        </section>
      )}

      {/* Stats strip */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
        }}
      >
        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            padding: 12,
          }}
        >
          <div style={{ fontSize: 10, letterSpacing: "0.12em", fontWeight: 800, color: "#6b7280" }}>
            PHOTOS
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 900,
              color: "#111827",
              marginTop: 4,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {photoCount}
          </div>
        </div>
        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            padding: 12,
          }}
        >
          <div style={{ fontSize: 10, letterSpacing: "0.12em", fontWeight: 800, color: "#6b7280" }}>
            ORDERS
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 900,
              color: "#111827",
              marginTop: 4,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {orders.length > 0 ? orders.length : 0}
          </div>
        </div>
      </section>

      {/* Recent orders strip */}
      {orders.length > 0 ? (
        <section
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 16,
            padding: 4,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "8px 12px 4px",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 900, color: "#111827" }}>
              Recent orders
            </div>
            <Link
              href={`/dashboard/projects/${event.id}/orders`}
              style={{ fontSize: 12, fontWeight: 800, color: "#cc0000", textDecoration: "none" }}
            >
              View all
            </Link>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {orders.map((order, i) => {
              const s = single(order.student);
              const who =
                [clean(s?.first_name), clean(s?.last_name)]
                  .filter(Boolean)
                  .join(" ") ||
                clean(order.parent_name) ||
                clean(order.customer_name) ||
                "Customer";
              return (
                <li key={order.id}>
                  <Link
                    href={`/m/orders/${order.id}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      textDecoration: "none",
                      color: "inherit",
                      borderTop: i === 0 ? undefined : "1px solid #f3f4f6",
                    }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 10,
                        background: "#fff5f5",
                        color: "#cc0000",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <ShoppingBag size={15} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 800,
                          color: "#111827",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {who}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "#6b7280",
                          marginTop: 2,
                        }}
                      >
                        #{shortId(order.id)} · {relativeTime(order.created_at)}
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 900,
                        color: "#111827",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {money(order)}
                    </div>
                    <ChevronRight size={14} color="#9ca3af" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Open in full dashboard (desktop) */}
      <Link
        href={`/dashboard/projects/${event.id}`}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          borderRadius: 12,
          background: "#fff",
          border: "1px solid #e5e7eb",
          textDecoration: "none",
          color: "#111827",
          fontWeight: 800,
          fontSize: 13,
        }}
      >
        Open full project page
        <ChevronRight size={16} color="#9ca3af" />
      </Link>

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

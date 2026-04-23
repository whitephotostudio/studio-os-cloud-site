"use client";

// Mobile orders list — /m/orders
//
// Thumb-friendly list of every order on the photographer's account.  This is
// the screen Harout opens when a parent calls and says "did you get my
// order?" — he taps a filter chip, scans, and drills in.
//
// Features:
//   - Search box (student name, short order id, parent email, package)
//   - Filter chips: All / Unread / Pending / Completed
//   - Cards show student name, order #, relative time, total, status chip
//   - Tapping a card → /m/orders/[id] detail

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronRight,
  Clock3,
  Search,
  ShoppingBag,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type OrderRow = {
  id: string;
  created_at: string | null;
  status: string | null;
  parent_name: string | null;
  parent_email: string | null;
  customer_name: string | null;
  customer_email: string | null;
  package_name: string | null;
  total_cents: number | null;
  total_amount: number | null;
  currency: string | null;
  seen_by_photographer: boolean | null;
  student_id: string | null;
  student:
    | { first_name: string | null; last_name: string | null; photo_url: string | null }
    | { first_name: string | null; last_name: string | null; photo_url: string | null }[]
    | null;
};

type FilterKind = "all" | "unread" | "pending" | "completed";

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function moneyFromOrder(order: OrderRow): string {
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

function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
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

function studentName(order: OrderRow): string {
  const s = Array.isArray(order.student) ? order.student[0] : order.student;
  const name = [clean(s?.first_name), clean(s?.last_name)].filter(Boolean).join(" ");
  return name || clean(order.parent_name) || clean(order.customer_name) || "Customer";
}

function statusPillStyle(status: string): React.CSSProperties {
  const s = (status || "").toLowerCase();
  if (s === "completed" || s === "paid" || s === "digital_paid" || s === "sent_to_print")
    return { background: "#dcfce7", color: "#15803d" };
  if (s === "pending" || s === "new" || s === "needs_attention" || s === "payment_pending")
    return { background: "#fff7ed", color: "#c2410c" };
  if (s === "ready")
    return { background: "#eff6ff", color: "#1d4ed8" };
  return { background: "#f3f4f6", color: "#374151" };
}

function isPendingStatus(s: string | null | undefined): boolean {
  const v = (s ?? "").toLowerCase();
  return v === "pending" || v === "new" || v === "needs_attention" || v === "payment_pending";
}

function isCompletedStatus(s: string | null | undefined): boolean {
  const v = (s ?? "").toLowerCase();
  return v === "completed" || v === "paid" || v === "digital_paid" || v === "sent_to_print";
}

export default function MobileOrdersPage() {
  const [supabase] = useState(() => createClient());
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKind>("all");

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

      const { data, error: qErr } = await supabase
        .from("orders")
        .select(
          `id, created_at, status, parent_name, parent_email,
           customer_name, customer_email, package_name,
           total_cents, total_amount, currency,
           seen_by_photographer, student_id,
           student:students(first_name,last_name,photo_url)`,
        )
        .eq("photographer_id", photog.id)
        .order("created_at", { ascending: false })
        .limit(300);
      if (cancelled) return;
      if (qErr) {
        setError(qErr.message);
        setOrders([]);
      } else {
        setOrders((data ?? []) as OrderRow[]);
      }
      setLoading(false);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const filtered = useMemo(() => {
    let list = orders;
    if (filter === "unread") list = list.filter((o) => o.seen_by_photographer === false);
    if (filter === "pending") list = list.filter((o) => isPendingStatus(o.status));
    if (filter === "completed") list = list.filter((o) => isCompletedStatus(o.status));

    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter((o) => {
      const name = studentName(o).toLowerCase();
      const short = shortId(o.id).toLowerCase();
      const email = (o.parent_email ?? o.customer_email ?? "").toLowerCase();
      const pkg = (o.package_name ?? "").toLowerCase();
      return (
        name.includes(term) ||
        short.includes(term) ||
        o.id.toLowerCase().includes(term) ||
        email.includes(term) ||
        pkg.includes(term)
      );
    });
  }, [orders, search, filter]);

  const counts = useMemo(() => {
    return {
      all: orders.length,
      unread: orders.filter((o) => o.seen_by_photographer === false).length,
      pending: orders.filter((o) => isPendingStatus(o.status)).length,
      completed: orders.filter((o) => isCompletedStatus(o.status)).length,
    };
  }, [orders]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.12em", fontWeight: 800, color: "#6b7280" }}>
          ORDERS
        </div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: "#111827" }}>
          All orders
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
          placeholder="Student, order #, email, package…"
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

      {/* Filter chips */}
      <div
        style={{
          display: "flex",
          gap: 6,
          overflowX: "auto",
          paddingBottom: 2,
          WebkitOverflowScrolling: "touch",
        }}
      >
        {(
          [
            { key: "all", label: "All", n: counts.all },
            { key: "unread", label: "Unread", n: counts.unread },
            { key: "pending", label: "Pending", n: counts.pending },
            { key: "completed", label: "Completed", n: counts.completed },
          ] as Array<{ key: FilterKind; label: string; n: number }>
        ).map((chip) => {
          const active = filter === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => setFilter(chip.key)}
              style={{
                flexShrink: 0,
                padding: "8px 12px",
                borderRadius: 999,
                border: active ? "1px solid #cc0000" : "1px solid #e5e7eb",
                background: active ? "#fff5f5" : "#fff",
                color: active ? "#cc0000" : "#374151",
                fontSize: 13,
                fontWeight: 800,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {chip.label}
              <span
                style={{
                  minWidth: 20,
                  padding: "0 6px",
                  height: 18,
                  borderRadius: 999,
                  background: active ? "#cc0000" : "#f3f4f6",
                  color: active ? "#fff" : "#6b7280",
                  fontSize: 11,
                  fontWeight: 800,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {chip.n}
              </span>
            </button>
          );
        })}
      </div>

      {/* List */}
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
          <ShoppingBag size={28} color="#d1d5db" style={{ marginBottom: 10 }} />
          <div style={{ fontWeight: 800, color: "#111827", fontSize: 14 }}>
            {search || filter !== "all"
              ? "No matches"
              : "No orders yet"}
          </div>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            {search || filter !== "all"
              ? "Try a different filter or search term."
              : "Orders will land here when parents check out."}
          </div>
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
          {filtered.map((order) => {
            const unread = order.seen_by_photographer === false;
            const student = Array.isArray(order.student) ? order.student[0] : order.student;
            const photoUrl = clean(student?.photo_url);
            return (
              <li key={order.id}>
                <Link
                  href={`/m/orders/${order.id}`}
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: 12,
                    borderRadius: 14,
                    background: "#fff",
                    border: unread ? "1px solid #fecaca" : "1px solid #e5e7eb",
                    boxShadow: unread ? "0 0 0 3px #fff5f5" : "0 2px 4px rgba(15,23,42,0.03)",
                    textDecoration: "none",
                    color: "inherit",
                    alignItems: "center",
                    position: "relative",
                  }}
                >
                  {/* Student photo */}
                  <div
                    style={{
                      width: 44,
                      height: 56,
                      borderRadius: 8,
                      background: "#f3f4f6",
                      overflow: "hidden",
                      flexShrink: 0,
                    }}
                  >
                    {photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photoUrl}
                        alt=""
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : null}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginBottom: 4,
                      }}
                    >
                      {unread ? (
                        <span
                          aria-hidden
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 999,
                            background: "#cc0000",
                            flexShrink: 0,
                          }}
                        />
                      ) : null}
                      <span
                        style={{
                          fontSize: 15,
                          fontWeight: 900,
                          color: "#111827",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {studentName(order)}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 800,
                          color: "#6b7280",
                          fontFamily: "ui-monospace, monospace",
                          letterSpacing: "0.04em",
                        }}
                      >
                        #{shortId(order.id)}
                      </span>
                      <span style={{ color: "#d1d5db" }}>·</span>
                      <span style={{ fontSize: 11, color: "#6b7280" }}>
                        {relativeTime(order.created_at)}
                      </span>
                    </div>
                    <div
                      style={{
                        marginTop: 6,
                        display: "flex",
                        gap: 6,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 999,
                          fontSize: 10,
                          fontWeight: 800,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          ...statusPillStyle(order.status ?? ""),
                        }}
                      >
                        {isCompletedStatus(order.status) ? (
                          <CheckCircle2 size={10} />
                        ) : (
                          <Clock3 size={10} />
                        )}
                        {clean(order.status) || "pending"}
                      </span>
                      {order.package_name ? (
                        <span
                          style={{
                            fontSize: 11,
                            color: "#374151",
                            fontWeight: 700,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            maxWidth: 160,
                          }}
                        >
                          {order.package_name}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: 4,
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 15,
                        fontWeight: 900,
                        color: "#111827",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {moneyFromOrder(order)}
                    </span>
                    <ChevronRight size={16} color="#9ca3af" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

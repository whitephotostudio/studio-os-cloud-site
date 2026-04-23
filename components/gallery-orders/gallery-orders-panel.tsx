"use client";

// Gallery Orders Panel — reusable per-school / per-event orders view.
//
// Why this exists: Harout needs to resolve "did they order digitals, or just
// retouching?" style questions in-context on the school/event page instead of
// hunting through the global Orders list. Matches the ShootProof mini-order
// layout: student + line items + total, with a search box and status chip.
//
// Scope for this slice (per user decision 2026-04-22):
//   [x] per-school orders tab w/ search by student name or order number
//   [x] full line-item breakdown (prints vs digitals vs retouching)
//   [ ] "Printed in-studio" source badge — next round
//   [ ] one-click "email summary to parent" — next round

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  ExternalLink,
  Mail,
  Phone,
  Receipt,
  Search,
  ShoppingBag,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-is-mobile";

// ── Types ────────────────────────────────────────────────────────────
// Kept deliberately narrow to what this panel actually renders.  If we
// ever move this to a shared types module we can expand.

type OrderItem = {
  id?: string;
  product_name: string | null;
  quantity: number | null;
  price: number | null;
  unit_price_cents: number | null;
  line_total_cents: number | null;
  sku: string | null;
};

type OrderRow = {
  id: string;
  created_at: string;
  status: string;
  parent_name: string | null;
  parent_email: string | null;
  parent_phone: string | null;
  customer_name: string | null;
  customer_email: string | null;
  package_name: string | null;
  subtotal_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  total_amount: number | null;
  currency: string | null;
  special_notes: string | null;
  notes: string | null;
  student_id: string | null;
  school_id: string | null;
  project_id: string | null;
  class_id: string | null;
  student:
    | {
        first_name: string | null;
        last_name: string | null;
        photo_url: string | null;
        class_name: string | null;
      }
    | null;
  class: { class_name: string | null } | null;
  items: OrderItem[];
};

type RelatedRow<T> = T | T[] | null | undefined;

function singleRelation<T>(value: RelatedRow<T>): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return value as T;
}

// ── Formatters ───────────────────────────────────────────────────────

function moneyFromCents(cents: number | null | undefined, currency = "CAD") {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: currency || "CAD",
  }).format(((cents ?? 0) || 0) / 100);
}

function moneyFromAmount(amount: number | null | undefined, currency = "CAD") {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: currency || "CAD",
  }).format(Number(amount || 0));
}

function orderTotalLabel(order: OrderRow): string {
  const currency = (order.currency || "CAD").toUpperCase();
  if (order.total_cents != null) return moneyFromCents(order.total_cents, currency);
  if (order.total_amount != null) return moneyFromAmount(order.total_amount, currency);
  return moneyFromCents(0, currency);
}

function formatOrderDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function studentDisplayName(order: OrderRow): string {
  const first = (order.student?.first_name ?? "").trim();
  const last = (order.student?.last_name ?? "").trim();
  const fromStudent = [first, last].filter(Boolean).join(" ");
  if (fromStudent) return fromStudent;
  const customer = (order.customer_name ?? "").trim();
  if (customer) return customer;
  const parent = (order.parent_name ?? "").trim();
  if (parent) return parent;
  return "Customer";
}

function shortOrderNumber(id: string): string {
  return id.slice(0, 8);
}

// ── Status colours (parity with /dashboard/orders) ──────────────────

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  new: { bg: "#fef2f2", color: "#ef4444", label: "New" },
  reviewed: { bg: "#fffbeb", color: "#d97706", label: "Reviewed" },
  sent_to_print: { bg: "#fff5f5", color: "#cc0000", label: "Sent to Print" },
  completed: { bg: "#f0fdf4", color: "#16a34a", label: "Completed" },
  payment_pending: { bg: "#fff7ed", color: "#ea580c", label: "Payment Pending" },
  paid: { bg: "#ecfeff", color: "#0891b2", label: "Paid" },
  digital_paid: { bg: "#eef2ff", color: "#4f46e5", label: "Digital Paid" },
};

const BORDER = "#e5e7eb";
const TEXT_PRIMARY = "#111827";
const TEXT_MUTED = "#6b7280";

// ── Component ────────────────────────────────────────────────────────

type GalleryOrdersPanelProps = {
  /** Scope orders by school. Mutually exclusive with projectId. */
  schoolId?: string;
  /** Scope orders by event/project. Mutually exclusive with schoolId. */
  projectId?: string;
};

export function GalleryOrdersPanel({ schoolId, projectId }: GalleryOrdersPanelProps) {
  const supabase = useMemo(() => createClient(), []);
  const isMobile = useIsMobile();

  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Only one of schoolId/projectId should be set.  If both are missing we
  // short-circuit with an empty list — this is a dev-time misuse guard.
  const scopeKey = schoolId ?? projectId ?? null;
  const scopeColumn: "school_id" | "project_id" | null = schoolId
    ? "school_id"
    : projectId
      ? "project_id"
      : null;

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!scopeColumn || !scopeKey) {
        setOrders([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      // Tenant isolation: we rely on RLS to prevent cross-photographer
      // reads, but we also verify we have a session to fail fast with a
      // cleaner error than RLS returns on its own.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) {
          setError("You're signed out. Refresh and sign back in to see orders.");
          setLoading(false);
        }
        return;
      }

      const { data, error: queryError } = await supabase
        .from("orders")
        .select(
          `
            id, created_at, status,
            parent_name, parent_email, parent_phone,
            customer_name, customer_email,
            package_name,
            subtotal_cents, tax_cents, total_cents, total_amount, currency,
            special_notes, notes,
            student_id, school_id, class_id, project_id,
            student:students(first_name, last_name, photo_url, class_name),
            class:classes(class_name),
            items:order_items(id, product_name, quantity, price, unit_price_cents, line_total_cents, sku)
          `,
        )
        .eq(scopeColumn, scopeKey)
        .order("created_at", { ascending: false });

      if (cancelled) return;

      if (queryError) {
        setError(queryError.message);
        setOrders([]);
        setLoading(false);
        return;
      }

      type RawRow = Omit<OrderRow, "student" | "class" | "items"> & {
        student?: RelatedRow<OrderRow["student"]>;
        class?: RelatedRow<OrderRow["class"]>;
        items?: OrderItem[] | null;
      };

      const rows = ((data as RawRow[] | null) ?? []).map<OrderRow>((row) => ({
        ...row,
        student: singleRelation(row.student),
        class: singleRelation(row.class),
        items: row.items ?? [],
      }));

      setOrders(rows);
      setLoading(false);
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [supabase, scopeColumn, scopeKey]);

  // ── Filtering + derived stats ──────────────────────────────────────

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return orders;
    return orders.filter((order) => {
      const name = studentDisplayName(order).toLowerCase();
      const shortId = shortOrderNumber(order.id).toLowerCase();
      const fullId = order.id.toLowerCase();
      const parentEmail = (order.parent_email ?? order.customer_email ?? "").toLowerCase();
      const packageName = (order.package_name ?? "").toLowerCase();
      return (
        name.includes(term) ||
        shortId.includes(term) ||
        fullId.includes(term) ||
        parentEmail.includes(term) ||
        packageName.includes(term)
      );
    });
  }, [orders, search]);

  const stats = useMemo(() => {
    const revenueCents = orders.reduce((sum, order) => {
      if (order.total_cents != null) return sum + order.total_cents;
      if (order.total_amount != null) return sum + Math.round(order.total_amount * 100);
      return sum;
    }, 0);
    const pending = orders.filter(
      (o) => o.status === "new" || o.status === "payment_pending",
    ).length;
    const completed = orders.filter(
      (o) => o.status === "completed" || o.status === "sent_to_print",
    ).length;
    return { revenueCents, pending, completed };
  }, [orders]);

  // ── Render ─────────────────────────────────────────────────────────

  if (!scopeColumn) {
    return (
      <div style={emptyBoxStyle}>
        Provide a <code>schoolId</code> or <code>projectId</code> to load orders.
      </div>
    );
  }

  return (
    <div>
      {/* Stats row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile
            ? "repeat(2, minmax(0, 1fr))"
            : "repeat(4, minmax(0, 1fr))",
          gap: isMobile ? 10 : 14,
          marginBottom: 16,
        }}
      >
        <StatCard
          label="Total orders"
          value={String(orders.length)}
          icon={<ShoppingBag size={16} />}
        />
        <StatCard
          label="Revenue"
          value={moneyFromCents(stats.revenueCents, "CAD")}
          icon={<Receipt size={16} />}
        />
        <StatCard label="Pending" value={String(stats.pending)} tone="amber" />
        <StatCard label="Completed" value={String(stats.completed)} tone="green" />
      </div>

      {/* Search */}
      <div
        style={{
          position: "relative",
          marginBottom: 14,
          maxWidth: 520,
        }}
      >
        <Search
          size={16}
          style={{
            position: "absolute",
            left: 12,
            top: "50%",
            transform: "translateY(-50%)",
            color: TEXT_MUTED,
            pointerEvents: "none",
          }}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by student name, order #, or parent email…"
          aria-label="Search orders"
          style={{
            width: "100%",
            boxSizing: "border-box",
            borderRadius: 12,
            border: `1px solid ${BORDER}`,
            background: "#fff",
            color: TEXT_PRIMARY,
            padding: "11px 40px 11px 38px",
            fontSize: 14,
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
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              width: 26,
              height: 26,
              borderRadius: 999,
              background: "#f3f4f6",
              border: "none",
              cursor: "pointer",
              color: TEXT_MUTED,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      {search ? (
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: TEXT_MUTED,
            marginBottom: 12,
            letterSpacing: "0.04em",
          }}
        >
          {filtered.length} of {orders.length} orders match "{search}"
        </div>
      ) : null}

      {/* Results */}
      {loading ? (
        <div style={emptyBoxStyle}>Loading orders…</div>
      ) : error ? (
        <div style={{ ...emptyBoxStyle, color: "#b91c1c" }}>{error}</div>
      ) : orders.length === 0 ? (
        <div style={emptyBoxStyle}>
          No orders yet for this {schoolId ? "school" : "event"}. They'll appear
          here the moment parents place one.
        </div>
      ) : filtered.length === 0 ? (
        <div style={emptyBoxStyle}>
          No orders match "{search}". Try a different name or order number.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filtered.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              expanded={expandedId === order.id}
              onToggle={() =>
                setExpandedId((prev) => (prev === order.id ? null : order.id))
              }
              isMobile={isMobile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone?: "amber" | "green";
}) {
  const toneBg =
    tone === "amber" ? "#fffbeb" : tone === "green" ? "#f0fdf4" : "#fff5f5";
  const toneFg =
    tone === "amber" ? "#b45309" : tone === "green" ? "#15803d" : "#cc0000";
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        padding: 14,
      }}
    >
      <div
        style={{
          display: "inline-flex",
          width: 32,
          height: 32,
          borderRadius: 10,
          background: toneBg,
          color: toneFg,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 8,
        }}
      >
        {icon ?? <Receipt size={16} />}
      </div>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          fontWeight: 800,
          color: TEXT_MUTED,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 900, color: TEXT_PRIMARY, marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}

function OrderCard({
  order,
  expanded,
  onToggle,
  isMobile,
}: {
  order: OrderRow;
  expanded: boolean;
  onToggle: () => void;
  isMobile: boolean;
}) {
  const statusCfg =
    STATUS_COLORS[order.status] ??
    ({ bg: "#f3f4f6", color: "#374151", label: order.status || "Unknown" } as const);
  const student = studentDisplayName(order);
  const currency = (order.currency || "CAD").toUpperCase();
  const total = orderTotalLabel(order);
  const parentEmail = order.parent_email ?? order.customer_email ?? "";
  const parentPhone = order.parent_phone ?? "";
  const className = order.student?.class_name ?? order.class?.class_name ?? "";

  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${BORDER}`,
        borderRadius: 16,
        padding: isMobile ? 12 : 16,
        boxShadow: "0 4px 14px rgba(15,23,42,0.04)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "56px 1fr" : "72px 1fr auto",
          gap: isMobile ? 10 : 14,
          alignItems: "start",
        }}
      >
        {/* Student photo */}
        <div
          style={{
            width: isMobile ? 56 : 72,
            height: isMobile ? 70 : 90,
            borderRadius: 10,
            overflow: "hidden",
            background: "#f3f4f6",
            border: `1px solid ${BORDER}`,
            flexShrink: 0,
          }}
        >
          {order.student?.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={order.student.photo_url}
              alt={student}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: TEXT_MUTED,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.04em",
              }}
            >
              NO PHOTO
            </div>
          )}
        </div>

        {/* Middle column — name + meta */}
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 4,
            }}
          >
            <div
              style={{
                fontSize: isMobile ? 15 : 17,
                fontWeight: 800,
                color: TEXT_PRIMARY,
              }}
            >
              {student}
            </div>
            <span
              style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.04em",
                padding: "3px 8px",
                borderRadius: 999,
                background: statusCfg.bg,
                color: statusCfg.color,
                whiteSpace: "nowrap",
              }}
            >
              {statusCfg.label}
            </span>
          </div>
          <div style={{ fontSize: 12, color: TEXT_MUTED, fontWeight: 600 }}>
            {className ? `${className} · ` : ""}Order #{shortOrderNumber(order.id)} ·{" "}
            {formatOrderDate(order.created_at)}
          </div>
          {order.package_name ? (
            <div
              style={{
                fontSize: 13,
                color: TEXT_PRIMARY,
                marginTop: 6,
                fontWeight: 700,
              }}
            >
              {order.package_name}
            </div>
          ) : null}
          {parentEmail || parentPhone ? (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                marginTop: 6,
                fontSize: 12,
                color: TEXT_MUTED,
                fontWeight: 600,
              }}
            >
              {parentEmail ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Mail size={12} /> {parentEmail}
                </span>
              ) : null}
              {parentPhone ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Phone size={12} /> {parentPhone}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Right column (desktop) — total */}
        {!isMobile ? (
          <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontWeight: 800,
                color: TEXT_MUTED,
              }}
            >
              Order total
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 900,
                color: TEXT_PRIMARY,
                marginTop: 2,
              }}
            >
              {total}
            </div>
          </div>
        ) : null}
      </div>

      {/* Mobile total (below row, right aligned) */}
      {isMobile ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginTop: 10,
            paddingTop: 10,
            borderTop: `1px solid ${BORDER}`,
          }}
        >
          <span style={{ fontSize: 12, color: TEXT_MUTED, fontWeight: 700 }}>
            Order total
          </span>
          <span style={{ fontSize: 18, fontWeight: 900, color: TEXT_PRIMARY }}>
            {total}
          </span>
        </div>
      ) : null}

      {/* Toggle + actions */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <button
          type="button"
          onClick={onToggle}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: expanded ? "#111827" : "#fff",
            color: expanded ? "#fff" : TEXT_PRIMARY,
            border: `1px solid ${expanded ? "#111827" : BORDER}`,
            borderRadius: 10,
            padding: "8px 12px",
            fontSize: 13,
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          {expanded ? "Hide items" : `Show ${order.items.length} item${order.items.length === 1 ? "" : "s"}`}
          <ChevronRight
            size={14}
            style={{
              transform: expanded ? "rotate(90deg)" : "none",
              transition: "transform 0.15s ease",
            }}
          />
        </button>
        <Link
          href={`/dashboard/orders?focus=${order.id}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "#fff",
            color: "#cc0000",
            border: "1px solid #fecaca",
            borderRadius: 10,
            padding: "8px 12px",
            fontSize: 13,
            fontWeight: 800,
            textDecoration: "none",
          }}
        >
          Open full details <ExternalLink size={13} />
        </Link>
      </div>

      {/* Line items */}
      {expanded ? (
        <div
          style={{
            marginTop: 14,
            border: `1px solid ${BORDER}`,
            borderRadius: 12,
            overflow: "hidden",
            background: "#fafafa",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr 64px 88px" : "2fr 80px 110px 110px",
              gap: 12,
              padding: "10px 14px",
              background: "#f3f4f6",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: TEXT_MUTED,
            }}
          >
            <span>Item</span>
            <span style={{ textAlign: "center" }}>Qty</span>
            {!isMobile ? <span style={{ textAlign: "right" }}>Unit</span> : null}
            <span style={{ textAlign: "right" }}>Line total</span>
          </div>
          {order.items.length === 0 ? (
            <div
              style={{
                padding: 16,
                fontSize: 13,
                color: TEXT_MUTED,
                fontWeight: 600,
              }}
            >
              This order has no itemized lines — total only: {total}.
            </div>
          ) : (
            order.items.map((item, idx) => {
              const lineTotal =
                item.line_total_cents != null
                  ? moneyFromCents(item.line_total_cents, currency)
                  : moneyFromAmount(item.price, currency);
              const unit =
                item.unit_price_cents != null
                  ? moneyFromCents(item.unit_price_cents, currency)
                  : item.price != null
                    ? moneyFromAmount(item.price, currency)
                    : "—";
              const qty = item.quantity ?? 1;
              return (
                <div
                  key={item.id ?? idx}
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile
                      ? "1fr 64px 88px"
                      : "2fr 80px 110px 110px",
                    gap: 12,
                    padding: "12px 14px",
                    borderTop: `1px solid ${BORDER}`,
                    fontSize: 13,
                    color: TEXT_PRIMARY,
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontWeight: 700 }}>
                    {item.product_name ?? "Item"}
                  </span>
                  <span style={{ textAlign: "center", fontWeight: 700 }}>{qty}</span>
                  {!isMobile ? (
                    <span style={{ textAlign: "right", color: TEXT_MUTED }}>{unit}</span>
                  ) : null}
                  <span style={{ textAlign: "right", fontWeight: 800 }}>{lineTotal}</span>
                </div>
              );
            })
          )}
          {order.special_notes ? (
            <div
              style={{
                borderTop: `1px solid ${BORDER}`,
                padding: "10px 14px",
                background: "#fff",
                fontSize: 12,
                color: TEXT_MUTED,
              }}
            >
              <span style={{ fontWeight: 800, color: TEXT_PRIMARY }}>Client note: </span>
              {order.special_notes}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const emptyBoxStyle: React.CSSProperties = {
  border: `1px dashed ${BORDER}`,
  borderRadius: 16,
  padding: 24,
  textAlign: "center",
  color: TEXT_MUTED,
  fontSize: 14,
  fontWeight: 600,
  background: "#fff",
};

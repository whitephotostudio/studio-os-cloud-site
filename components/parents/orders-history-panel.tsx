// 2026-04-25 — Orders history panel for the parents portal.
//
// Renders inside /parents/[pin] when the parent picks the "Orders" tab.
// Shows every order this parent has placed in this gallery, complete with
// thumbnails of the poses, sizes, quantities, totals.  Each row carries
// a Reorder button that re-hydrates the live cart from `cart_snapshot`
// and bounces the parent into the checkout flow.
"use client";

import { useEffect, useMemo, useState } from "react";

export type OrderHistoryItem = {
  productName: string;
  quantity: number;
  lineTotalCents: number;
  unitPriceCents: number;
  sku: string | null;
};

export type OrderHistoryRow = {
  id: string;
  shortId: string;
  createdAt: string | null;
  paidAt: string | null;
  status: string;
  totalCents: number;
  subtotalCents?: number | null;
  taxCents?: number | null;
  currency: string;
  packageName: string | null;
  items: OrderHistoryItem[];
  cartSnapshot: unknown;
  schoolId: string | null;
  projectId: string | null;
  studentId: string | null;
  orderGroupId: string | null;
  studentName: string | null;
  parentName?: string | null;
  parentEmail?: string | null;
  parentPhone?: string | null;
  specialNotes?: string | null;
};

type Props = {
  pin: string;
  email: string;
  schoolId?: string | null;
  projectId?: string | null;
  /** Tone — matches the rest of the gallery's styling. */
  tone: {
    text: string;
    mutedText: string;
    accent: string;
    border: string;
    surface: string;
  };
  /** Compact viewport flag from the parent page's useIsMobile hook. */
  compact?: boolean;
  /** Called when the panel discovers how many orders this parent has,
   *  so the parent page can render an "(N)" badge on the tab label. */
  onCountChange?: (count: number) => void;
  /** Called when a parent clicks Reorder on a row.  Parent page
   *  re-hydrates the cart from the cart_snapshot JSON and switches to
   *  the checkout drawer. */
  onReorder?: (snapshot: unknown, sourceOrderId: string) => void;
};

function formatCurrency(cents: number, currency: string) {
  const amount = (cents / 100).toFixed(2);
  const sym = currency.toLowerCase() === "usd" ? "US$" : "$";
  return `${sym}${amount}`;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function statusPill(status: string) {
  const s = status.toLowerCase();
  if (s === "paid" || s === "digital_paid") {
    return { label: "Paid", color: "#0f7a4a", bg: "rgba(15,122,74,0.14)" };
  }
  if (s === "payment_pending" || s === "pending") {
    return { label: "Pending", color: "#a36b00", bg: "rgba(163,107,0,0.14)" };
  }
  if (s === "refunded") {
    return { label: "Refunded", color: "#7a4a0f", bg: "rgba(122,74,15,0.14)" };
  }
  if (s === "cancelled" || s === "canceled") {
    return { label: "Cancelled", color: "#a8112a", bg: "rgba(168,17,42,0.14)" };
  }
  return { label: status, color: "#666", bg: "rgba(0,0,0,0.06)" };
}

export default function OrdersHistoryPanel({
  pin,
  email,
  schoolId,
  projectId,
  tone,
  compact = false,
  onCountChange,
  onReorder,
}: Props) {
  const [orders, setOrders] = useState<OrderHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Track which order card the parent has expanded.  Single-select so the
  // panel doesn't bloat into 6 expanded sheets at once.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchHistory() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/portal/orders/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pin,
            email,
            schoolId: schoolId || undefined,
            projectId: projectId || undefined,
          }),
        });
        const json = (await res.json()) as
          | { ok: true; orders: OrderHistoryRow[] }
          | { ok: false; message?: string };
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setError(
            ("message" in json ? json.message : null) ||
              "Couldn't load your orders.",
          );
          setOrders([]);
        } else {
          setOrders(json.orders);
        }
      } catch {
        if (cancelled) return;
        setError("Couldn't reach the server. Try again.");
        setOrders([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (pin && email) fetchHistory();
    return () => {
      cancelled = true;
    };
  }, [pin, email, schoolId, projectId]);

  // 2026-04-26: Tell the parent page how many orders we have so it can
  // render an "(N)" count badge on the Orders tab label.
  useEffect(() => {
    if (onCountChange) onCountChange(orders.length);
  }, [orders.length, onCountChange]);

  const totalSpend = useMemo(
    () =>
      orders
        .filter((o) =>
          ["paid", "digital_paid"].includes(o.status.toLowerCase()),
        )
        .reduce((sum, o) => sum + o.totalCents, 0),
    [orders],
  );

  const containerStyle: React.CSSProperties = {
    flex: 1,
    overflow: "auto",
    display: "flex",
    justifyContent: "center",
    padding: compact ? "20px 14px 60px" : "32px 20px 80px",
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={{ maxWidth: 720, width: "100%", textAlign: "center" }}>
          <div style={{ color: tone.mutedText, fontSize: 14, marginTop: 60 }}>
            Loading your orders…
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={{ maxWidth: 720, width: "100%", textAlign: "center" }}>
          <div
            style={{
              color: "#b54343",
              background: "rgba(181,67,67,0.08)",
              border: "1px solid rgba(181,67,67,0.2)",
              borderRadius: 12,
              padding: "16px 20px",
              fontSize: 14,
              marginTop: 40,
            }}
          >
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div style={containerStyle}>
        <div style={{ maxWidth: 720, width: "100%", textAlign: "center", marginTop: 40 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: tone.mutedText,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: 12,
            }}
          >
            Your Orders
          </div>
          <h2 style={{ margin: 0, color: tone.text, fontSize: 26, fontWeight: 800 }}>
            No orders yet
          </h2>
          <p
            style={{
              margin: "12px 0 0",
              color: tone.mutedText,
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            Once you place an order on this gallery, it&apos;ll show up here with thumbnails,
            sizes, totals — and a one-click reorder button.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={{ maxWidth: 720, width: "100%" }}>
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: tone.mutedText,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            Your Orders
          </div>
          <h2
            style={{
              margin: 0,
              color: tone.text,
              fontSize: compact ? 22 : 26,
              fontWeight: 800,
            }}
          >
            {orders.length} order{orders.length === 1 ? "" : "s"}
            {totalSpend > 0 && (
              <span
                style={{
                  color: tone.mutedText,
                  fontSize: compact ? 12 : 14,
                  fontWeight: 500,
                  marginLeft: 10,
                }}
              >
                · {formatCurrency(totalSpend, orders[0]?.currency || "cad")} total
              </span>
            )}
          </h2>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: compact ? 12 : 14 }}>
          {orders.map((order) => {
            const pill = statusPill(order.status);
            const visibleItems = order.items.filter((i) => i.lineTotalCents >= 0);
            const discountItems = order.items.filter((i) => i.lineTotalCents < 0);
            const reorderable = !!order.cartSnapshot;
            const expanded = expandedId === order.id;
            return (
              <div
                key={order.id}
                style={{
                  background: tone.surface,
                  border: `1px solid ${tone.border}`,
                  borderRadius: 14,
                  padding: compact ? 14 : 18,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                    gap: 10,
                    marginBottom: compact ? 10 : 14,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 4,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontSize: compact ? 14 : 16,
                          fontWeight: 800,
                          color: tone.text,
                          fontFamily: "'SF Mono', Menlo, monospace",
                          letterSpacing: "0.02em",
                        }}
                      >
                        #{order.shortId}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: pill.color,
                          background: pill.bg,
                          padding: "3px 10px",
                          borderRadius: 999,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {pill.label}
                      </span>
                    </div>
                    <div style={{ fontSize: compact ? 11 : 12, color: tone.mutedText }}>
                      {formatDate(order.paidAt || order.createdAt)}
                      {order.studentName ? ` · ${order.studentName}` : ""}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: compact ? 16 : 18,
                      fontWeight: 800,
                      color: tone.text,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatCurrency(order.totalCents, order.currency)}
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {visibleItems.map((item, idx) => (
                    <div
                      key={`${order.id}:${idx}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: compact ? "8px 10px" : "10px 12px",
                        background: "rgba(255,255,255,0.04)",
                        borderRadius: 10,
                      }}
                    >
                      {item.sku ? (
                        <img
                          src={item.sku}
                          alt=""
                          style={{
                            width: compact ? 38 : 44,
                            height: compact ? 48 : 56,
                            objectFit: "cover",
                            borderRadius: 6,
                            background: "#0a0a0a",
                            flexShrink: 0,
                            border: `1px solid ${tone.border}`,
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: compact ? 38 : 44,
                            height: compact ? 48 : 56,
                            borderRadius: 6,
                            background: "#0a0a0a",
                            flexShrink: 0,
                            border: `1px solid ${tone.border}`,
                          }}
                        />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: compact ? 12 : 13,
                            fontWeight: 700,
                            color: tone.text,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {item.productName}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: tone.mutedText,
                            marginTop: 2,
                          }}
                        >
                          Qty {item.quantity}
                          {item.lineTotalCents > 0
                            ? ` · ${formatCurrency(item.lineTotalCents, order.currency)}`
                            : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Click-to-expand: shipping + notes + subtotal/tax/total breakdown.
                    Hidden by default to keep the card scannable; one-tap reveal. */}
                <div style={{ marginTop: compact ? 12 : 14, display: "flex", flexDirection: "column", gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : order.id)}
                    style={{
                      background: "transparent",
                      border: `1px solid ${tone.border}`,
                      color: tone.mutedText,
                      borderRadius: 999,
                      padding: "7px 14px",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      alignSelf: "flex-start",
                    }}
                  >
                    {expanded ? "Hide details" : "View details"}
                  </button>

                  {expanded && (
                    <div
                      style={{
                        background: "rgba(0,0,0,0.18)",
                        border: `1px solid ${tone.border}`,
                        borderRadius: 10,
                        padding: compact ? "10px 12px" : "12px 14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        fontSize: 12,
                        color: tone.mutedText,
                      }}
                    >
                      {(typeof order.subtotalCents === "number" || discountItems.length > 0) && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {typeof order.subtotalCents === "number" && (
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span>Subtotal</span>
                              <span style={{ color: tone.text }}>
                                {formatCurrency(order.subtotalCents, order.currency)}
                              </span>
                            </div>
                          )}
                          {discountItems.map((item, idx) => (
                            <div key={`d:${order.id}:${idx}`} style={{ display: "flex", justifyContent: "space-between", color: "#4ade80" }}>
                              <span>{item.productName}</span>
                              <span>−{formatCurrency(Math.abs(item.lineTotalCents), order.currency)}</span>
                            </div>
                          ))}
                          {typeof order.taxCents === "number" && order.taxCents > 0 && (
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span>Tax</span>
                              <span style={{ color: tone.text }}>
                                {formatCurrency(order.taxCents, order.currency)}
                              </span>
                            </div>
                          )}
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              borderTop: `1px solid ${tone.border}`,
                              paddingTop: 6,
                              marginTop: 4,
                              color: tone.text,
                              fontWeight: 700,
                            }}
                          >
                            <span>Total paid</span>
                            <span>{formatCurrency(order.totalCents, order.currency)}</span>
                          </div>
                        </div>
                      )}

                      {(order.parentName || order.parentEmail || order.parentPhone) && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 4 }}>
                          <div
                            style={{
                              fontSize: 10,
                              fontWeight: 800,
                              color: tone.mutedText,
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                              marginBottom: 2,
                            }}
                          >
                            Contact
                          </div>
                          {order.parentName ? <div style={{ color: tone.text }}>{order.parentName}</div> : null}
                          {order.parentEmail ? <div>{order.parentEmail}</div> : null}
                          {order.parentPhone ? <div>{order.parentPhone}</div> : null}
                        </div>
                      )}

                      {order.specialNotes ? (
                        <div style={{ paddingTop: 4 }}>
                          <div
                            style={{
                              fontSize: 10,
                              fontWeight: 800,
                              color: tone.mutedText,
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                              marginBottom: 4,
                            }}
                          >
                            Notes
                          </div>
                          <div
                            style={{
                              color: tone.text,
                              whiteSpace: "pre-line",
                              fontSize: 12,
                              lineHeight: 1.6,
                            }}
                          >
                            {order.specialNotes}
                          </div>
                        </div>
                      ) : null}

                      <div
                        style={{
                          paddingTop: 4,
                          fontSize: 10,
                          color: tone.mutedText,
                          fontFamily: "'SF Mono', Menlo, monospace",
                        }}
                      >
                        Reference: {order.id}
                      </div>
                    </div>
                  )}

                  {reorderable && onReorder && (
                    <button
                      type="button"
                      onClick={() => onReorder(order.cartSnapshot, order.id)}
                      style={{
                        width: "100%",
                        padding: compact ? "10px 14px" : "12px 18px",
                        background: tone.text,
                        color: tone.surface,
                        border: "none",
                        borderRadius: 999,
                        fontSize: compact ? 12 : 13,
                        fontWeight: 800,
                        cursor: "pointer",
                        letterSpacing: "0.02em",
                      }}
                    >
                      Reorder these items
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            marginTop: 20,
            fontSize: 11,
            color: tone.mutedText,
            textAlign: "center",
          }}
        >
          Showing your last {orders.length} order{orders.length === 1 ? "" : "s"} from this gallery.
        </div>
      </div>
    </div>
  );
}

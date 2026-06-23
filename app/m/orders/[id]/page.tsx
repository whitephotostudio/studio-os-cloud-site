"use client";

// Mobile order detail — /m/orders/[id]
//
// The screen Harout opens when he needs to answer the "what did I actually
// order?" question from a parent — same real-world case that sparked the
// per-school orders pages.  On phone it's even more valuable because he's
// usually in transit when the call comes in.
//
// Features:
//   - Student photo + name + class context
//   - Parent block with BIG tap-to-call and tap-to-email buttons
//   - Line items as a mini-table (product / qty / line total)
//   - Client note if the parent left one
//   - Jump-into-gallery-context links (school or event)
//   - On mount we flip seen_by_photographer = true so the red dot clears.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Mail,
  Phone,
  ShoppingBag,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { proxiedPhotoUrl } from "@/lib/photo-url";
import {
  cartSnapshotToOrderItems,
  cleanOrderCustomerNote,
  isWebImageUrl,
  parseOrderPhotoSelections,
  parsePackageSlotLabel,
  resolveLineItemCents,
  resolveOrderSubtotalCents,
  resolveOrderTotalCents,
} from "@/lib/order-display";

type Row = {
  id: string;
  created_at: string | null;
  status: string | null;
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
  package_price: number | null;
  cart_snapshot?: unknown;
  currency: string | null;
  payment_status?: string | null;
  paid_at?: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_checkout_session_id?: string | null;
  special_notes: string | null;
  notes: string | null;
  student_id: string | null;
  school_id: string | null;
  class_id: string | null;
  project_id: string | null;
  student:
    | { first_name: string | null; last_name: string | null; photo_url: string | null; class_name: string | null }
    | { first_name: string | null; last_name: string | null; photo_url: string | null; class_name: string | null }[]
    | null;
  class:
    | { class_name: string | null }
    | { class_name: string | null }[]
    | null;
  school:
    | { id: string; school_name: string | null }
    | { id: string; school_name: string | null }[]
    | null;
  project:
    | { id: string; title: string | null }
    | { id: string; title: string | null }[]
    | null;
  items:
    | Array<{
        id: string;
        product_name: string | null;
        quantity: number | null;
        price: number | null;
        unit_price_cents: number | null;
        line_total_cents: number | null;
        sku?: string | null;
      }>
    | null;
};

type DetailItem = {
  id: string;
  product_name: string | null;
  quantity: number | null;
  price: number | null;
  unit_price_cents: number | null;
  line_total_cents: number | null;
  sku: string | null;
  included: boolean;
};

type PoseGroup = {
  key: string;
  url: string | null;
  fileName: string;
  items: DetailItem[];
};

type ComponentSummary = {
  key: string;
  label: string;
  assignedSlots: number;
  slotTotal: number | null;
  poseCount: number;
  assignments: Array<{ poseIndex: number; fileName: string; slotText: string }>;
};

function clean(s: string | null | undefined): string {
  return (s ?? "").trim();
}

function single<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function money(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function fileNameFromUrl(url: string | null | undefined, fallback: string) {
  const raw = clean(url);
  if (!raw) return fallback;
  try {
    const pathname = new URL(raw).pathname;
    const parts = pathname.split("/");
    return decodeURIComponent(parts[parts.length - 1] || fallback);
  } catch {
    return raw.split("/").pop() || fallback;
  }
}

function itemQuantity(item: Pick<DetailItem, "quantity">) {
  const qty = Number(item.quantity ?? 1);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
}

function itemBaseLabel(item: Pick<DetailItem, "product_name">) {
  const parsed = parsePackageSlotLabel(item.product_name);
  return parsed.baseLabel || clean(item.product_name) || "Item";
}

function itemSlotText(item: Pick<DetailItem, "product_name">) {
  const parsed = parsePackageSlotLabel(item.product_name);
  if (parsed.slotIndex == null || parsed.slotTotal == null) return "";
  return `${parsed.slotIndex} of ${parsed.slotTotal}`;
}

function poseLabel(index: number, total: number) {
  return `Pose ${index + 1}${total > 1 ? ` of ${total}` : ""}`;
}

function isNonProductionLineItem(item: Pick<DetailItem, "product_name">) {
  const name = clean(item.product_name).toLowerCase();
  return (
    name.includes("shipping") ||
    name.includes("handling") ||
    name.includes("discount") ||
    name.includes("premium backdrop")
  );
}

function resolveDisplayItems(order: Row): DetailItem[] {
  const dbItems = order.items ?? [];
  const snapshotItems = cartSnapshotToOrderItems(order.cart_snapshot);
  const notesText = clean(order.special_notes) || clean(order.notes);
  const noteSelections = parseOrderPhotoSelections(notesText);
  const imageDbItems = dbItems.filter((item) => isWebImageUrl(item.sku));

  if (snapshotItems.length > imageDbItems.length) {
    return snapshotItems.map((item, index) => ({
      id: `${order.id}-snapshot-${index}`,
      product_name: item.product_name,
      quantity: item.quantity,
      price: null,
      unit_price_cents: null,
      line_total_cents: 0,
      sku: item.sku,
      included: true,
    }));
  }

  if (dbItems.length > 0) {
    return dbItems.map((item, index) => {
      const noteSelection =
        noteSelections.find((entry) => entry.itemIndex === index) ?? noteSelections[index];
      return {
        id: item.id,
        product_name: item.product_name ?? noteSelection?.label ?? "Item",
        quantity: item.quantity,
        price: item.price,
        unit_price_cents: item.unit_price_cents,
        line_total_cents: item.line_total_cents,
        sku: isWebImageUrl(item.sku) ? item.sku ?? null : noteSelection?.url ?? null,
        included: (item.line_total_cents ?? 0) === 0,
      };
    });
  }

  return noteSelections.map((entry, index) => ({
    id: `${order.id}-note-${index}`,
    product_name: entry.label || "Item",
    quantity: 1,
    price: null,
    unit_price_cents: null,
    line_total_cents: 0,
    sku: entry.url,
    included: true,
  }));
}

function buildPoseGroups(items: DetailItem[]): PoseGroup[] {
  const groups = new Map<string, PoseGroup>();
  items.forEach((item, index) => {
    const url = isWebImageUrl(item.sku) ? item.sku : null;
    const key = url || `no-photo-${index}`;
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      return;
    }
    groups.set(key, {
      key,
      url,
      fileName: fileNameFromUrl(url, `photo-${index + 1}.jpg`),
      items: [item],
    });
  });
  return Array.from(groups.values());
}

function buildComponentSummary(groups: PoseGroup[]): ComponentSummary[] {
  const map = new Map<ComponentSummary["key"], ComponentSummary & { poseKeys: Set<string> }>();

  groups.forEach((group, groupIndex) => {
    for (const item of group.items) {
      if (isNonProductionLineItem(item)) continue;
      const parsed = parsePackageSlotLabel(item.product_name);
      const label = parsed.baseLabel || clean(item.product_name) || "Item";
      const key = `${label}__${parsed.slotTotal ?? "qty"}`;
      const existing = map.get(key) ?? {
        key,
        label,
        assignedSlots: 0,
        slotTotal: parsed.slotTotal,
        poseCount: 0,
        assignments: [],
        poseKeys: new Set<string>(),
      };
      const slotText =
        parsed.slotIndex != null && parsed.slotTotal != null
          ? `${parsed.slotIndex} of ${parsed.slotTotal}`
          : "";
      existing.assignedSlots += itemQuantity(item);
      const poseKey = `${groupIndex}-${group.fileName}-${slotText}`;
      if (!existing.poseKeys.has(poseKey)) {
        existing.assignments.push({ poseIndex: groupIndex, fileName: group.fileName, slotText });
        existing.poseKeys.add(poseKey);
      }
      existing.poseCount = new Set(existing.assignments.map((assignment) => assignment.poseIndex)).size;
      if (parsed.slotTotal != null) existing.slotTotal = parsed.slotTotal;
      map.set(key, existing);
    }
  });

  return Array.from(map.values()).map((summary) => ({
    key: summary.key,
    label: summary.label,
    assignedSlots: summary.assignedSlots,
    slotTotal: summary.slotTotal,
    poseCount: summary.poseCount,
    assignments: summary.assignments,
  }));
}

function orderTotalCents(r: Row): number {
  return resolveOrderTotalCents(r, r.items);
}

function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

function dateLabel(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusPillStyle(s: string): React.CSSProperties {
  const v = s.toLowerCase();
  if (v === "completed" || v === "paid" || v === "digital_paid" || v === "sent_to_print")
    return { background: "#dcfce7", color: "#15803d" };
  if (v === "pending" || v === "new" || v === "needs_attention" || v === "payment_pending")
    return { background: "#fff7ed", color: "#c2410c" };
  if (v === "ready") return { background: "#eff6ff", color: "#1d4ed8" };
  return { background: "#f3f4f6", color: "#374151" };
}

function isPaidOrder(order: Row): boolean {
  const paymentStatus = clean(order.payment_status).toLowerCase();
  return (
    paymentStatus === "paid" ||
    paymentStatus === "succeeded" ||
    paymentStatus === "digital_paid" ||
    !!clean(order.paid_at) ||
    !!clean(order.stripe_payment_intent_id)
  );
}

function hasStartedCheckout(order: Row): boolean {
  return !isPaidOrder(order) && !!clean(order.stripe_checkout_session_id);
}

function displayStatus(order: Row): string {
  const status = clean(order.status).toLowerCase();
  if (hasStartedCheckout(order)) return "payment_pending";
  if (isPaidOrder(order)) {
    if (status === "digital_paid") return "digital_paid";
    if (status === "reviewed" || status === "sent_to_print" || status === "completed") return status;
    return "paid";
  }
  return status || "pending";
}

function displayStatusLabel(order: Row): string {
  const status = displayStatus(order);
  if (status === "payment_pending") return "Cart / Pending";
  if (status === "paid") return "Processed";
  if (status === "digital_paid") return "Digital Paid";
  if (status === "sent_to_print") return "Sent to Print";
  return status.replace(/_/g, " ");
}

function isCompletedStatus(order: Row): boolean {
  const v = displayStatus(order);
  return v === "completed" || v === "paid" || v === "digital_paid" || v === "sent_to_print";
}

export default function MobileOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [supabase] = useState(() => createClient());
  const [order, setOrder] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

      const { data, error: qErr } = await supabase
        .from("orders")
        .select(
          `id, created_at, status, parent_name, parent_email, parent_phone,
           customer_name, customer_email, package_name,
           subtotal_cents, tax_cents, total_cents, total_amount, package_price, currency,
           cart_snapshot,
           payment_status, paid_at, stripe_payment_intent_id, stripe_checkout_session_id,
           special_notes, notes,
           student_id, school_id, class_id, project_id,
           student:students(first_name,last_name,photo_url,class_name),
           class:classes(class_name),
           school:schools(id, school_name),
           project:projects(id, title),
           items:order_items(id, product_name, quantity, price, unit_price_cents, line_total_cents, sku)`,
        )
        .eq("id", id)
        .maybeSingle();

      if (cancelled) return;
      if (qErr) {
        setError(qErr.message);
        setOrder(null);
        setLoading(false);
        return;
      }
      setOrder((data as Row | null) ?? null);
      setLoading(false);

      // Mark as seen — best-effort; not blocking the UI.
      if (data?.id) {
        void supabase
          .from("orders")
          .update({ seen_by_photographer: true })
          .eq("id", data.id);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [id, supabase]);

  if (loading) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 14,
              padding: 16,
              background: "#fff",
            }}
          >
            <div
              style={{
                height: 12,
                width: "55%",
                borderRadius: 6,
                background: "#f3f4f6",
                marginBottom: 8,
              }}
            />
            <div
              style={{
                height: 10,
                width: "35%",
                borderRadius: 6,
                background: "#f3f4f6",
              }}
            />
          </div>
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

  if (!order) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "40px 20px",
          color: "#6b7280",
        }}
      >
        <ShoppingBag size={28} color="#d1d5db" style={{ marginBottom: 10 }} />
        <div style={{ fontWeight: 800, color: "#111827", fontSize: 14 }}>
          Order not found
        </div>
        <div style={{ fontSize: 13, marginTop: 6 }}>
          It may have been deleted, or belongs to another account.
        </div>
        <Link
          href="/m/orders"
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
          Back to orders
        </Link>
      </div>
    );
  }

  const student = single(order.student);
  const klass = single(order.class);
  const school = single(order.school);
  const project = single(order.project);
  const parentName = clean(order.parent_name) || clean(order.customer_name);
  const parentEmail = clean(order.parent_email) || clean(order.customer_email);
  const parentPhone = clean(order.parent_phone);
  const currency = clean(order.currency) || "USD";
  const studentFullName =
    [clean(student?.first_name), clean(student?.last_name)].filter(Boolean).join(" ") ||
    parentName ||
    "Customer";
  const classLabel = clean(klass?.class_name) || clean(student?.class_name);
  const clientNote = cleanOrderCustomerNote(clean(order.special_notes) || clean(order.notes));
  const items = resolveDisplayItems(order);
  const poseGroups = buildPoseGroups(items.filter((item) => !isNonProductionLineItem(item)));
  const componentSummary = buildComponentSummary(poseGroups);
  const subtotalCents = resolveOrderSubtotalCents(order, order.items);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Link
        href="/m/orders"
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
        <ArrowLeft size={14} /> Back to orders
      </Link>

      {/* Order summary card */}
      <section
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 16,
          background: "#fff",
          padding: 14,
          display: "flex",
          gap: 12,
        }}
      >
        <div
          style={{
            width: 64,
            height: 82,
            borderRadius: 10,
            background: "#f3f4f6",
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          {proxiedPhotoUrl(student?.photo_url) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={proxiedPhotoUrl(student?.photo_url)}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : null}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              fontWeight: 800,
              color: "#6b7280",
              fontFamily: "ui-monospace, monospace",
              marginBottom: 2,
            }}
          >
            #{shortId(order.id)}
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 900,
              color: "#111827",
              lineHeight: 1.25,
            }}
          >
            {studentFullName}
          </h1>
          {classLabel ? (
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
              {classLabel}
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
              marginTop: 8,
            }}
          >
            <span
              style={{
                padding: "3px 8px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 800,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                ...statusPillStyle(displayStatus(order)),
              }}
            >
              {isCompletedStatus(order) ? (
                <CheckCircle2 size={11} />
              ) : (
                <Clock3 size={11} />
              )}
              {displayStatusLabel(order)}
            </span>
            <span style={{ fontSize: 11, color: "#6b7280" }}>
              {dateLabel(order.created_at)}
            </span>
          </div>
        </div>
      </section>

      {/* Parent contact block — big tap-to-call / tap-to-email buttons */}
      {(parentName || parentEmail || parentPhone) ? (
        <section
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 16,
            background: "#fff",
            padding: 14,
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.12em",
              fontWeight: 800,
              color: "#6b7280",
              marginBottom: 8,
            }}
          >
            PARENT / CUSTOMER
          </div>
          {parentName ? (
            <div style={{ fontSize: 15, fontWeight: 800, color: "#111827" }}>
              {parentName}
            </div>
          ) : null}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: parentEmail && parentPhone ? "1fr 1fr" : "1fr",
              gap: 8,
              marginTop: 10,
            }}
          >
            {parentPhone ? (
              <a
                href={`tel:${parentPhone}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: "#111827",
                  color: "#fff",
                  textDecoration: "none",
                  fontWeight: 800,
                  fontSize: 14,
                }}
              >
                <Phone size={15} /> Call
              </a>
            ) : null}
            {parentEmail ? (
              <a
                href={`mailto:${parentEmail}?subject=Your%20order%20%23${shortId(
                  order.id,
                )}`}
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
                  textDecoration: "none",
                  fontWeight: 800,
                  fontSize: 14,
                }}
              >
                <Mail size={15} /> Email
              </a>
            ) : null}
          </div>
          {parentPhone || parentEmail ? (
            <div
              style={{
                marginTop: 10,
                display: "grid",
                gap: 4,
                fontSize: 12,
                color: "#6b7280",
              }}
            >
              {parentPhone ? <div>{parentPhone}</div> : null}
              {parentEmail ? <div>{parentEmail}</div> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Package + items */}
      <section
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 16,
          background: "#fff",
          padding: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 10,
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.12em",
              fontWeight: 800,
              color: "#6b7280",
            }}
          >
            ORDER
          </div>
          {order.package_name ? (
            <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>
              {order.package_name}
            </div>
          ) : null}
        </div>

        {componentSummary.length > 0 ? (
          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 14,
              padding: 12,
              background: "#f8fafc",
              marginBottom: 12,
            }}
          >
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.12em",
                fontWeight: 900,
                color: "#6b7280",
                marginBottom: 10,
              }}
            >
              PACKAGE BREAKDOWN
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {componentSummary.map((component) => (
                <div key={component.key}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "flex-start",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 900,
                          color: "#111827",
                          lineHeight: 1.25,
                        }}
                      >
                        {component.label}
                      </div>
                      <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                        {component.slotTotal && component.assignedSlots <= component.slotTotal
                          ? `${component.assignedSlots} of ${component.slotTotal} slot${component.slotTotal === 1 ? "" : "s"}`
                          : `${component.assignedSlots} slot${component.assignedSlots === 1 ? "" : "s"}`}
                      </div>
                    </div>
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 11,
                        color: "#0f766e",
                        background: "#ecfeff",
                        border: "1px solid #a5f3fc",
                        borderRadius: 999,
                        padding: "3px 8px",
                        fontWeight: 900,
                      }}
                    >
                      {component.poseCount} pose{component.poseCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div style={{ display: "grid", gap: 3, marginTop: 6 }}>
                    {component.assignments.slice(0, 5).map((assignment, index) => (
                      <div
                        key={`${component.key}-${assignment.poseIndex}-${index}`}
                        style={{
                          fontSize: 11,
                          color: "#6b7280",
                          lineHeight: 1.35,
                          wordBreak: "break-word",
                        }}
                      >
                        <strong style={{ color: "#111827" }}>
                          {poseLabel(assignment.poseIndex, poseGroups.length)}
                        </strong>
                        {assignment.slotText ? ` slot ${assignment.slotText}` : ""} ·{" "}
                        {assignment.fileName}
                      </div>
                    ))}
                    {component.assignments.length > 5 ? (
                      <div style={{ fontSize: 11, color: "#6b7280" }}>
                        + {component.assignments.length - 5} more assignment
                        {component.assignments.length - 5 === 1 ? "" : "s"}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {poseGroups.length > 0 ? (
          <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.12em",
                fontWeight: 900,
                color: "#6b7280",
              }}
            >
              POSE ASSIGNMENTS
            </div>
            {poseGroups.map((group, groupIndex) => (
              <div
                key={group.key}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "10px 0",
                  borderBottom: "1px dashed #e5e7eb",
                }}
              >
                <div
                  style={{
                    width: 58,
                    height: 76,
                    borderRadius: 10,
                    background: "#f3f4f6",
                    overflow: "hidden",
                    flexShrink: 0,
                    border: "1px solid #e5e7eb",
                  }}
                >
                  {proxiedPhotoUrl(group.url) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={proxiedPhotoUrl(group.url)}
                      alt=""
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : null}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 900, color: "#111827" }}>
                      {poseLabel(groupIndex, poseGroups.length)}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "#6b7280",
                        background: "#f3f4f6",
                        borderRadius: 999,
                        padding: "3px 7px",
                        fontWeight: 800,
                      }}
                    >
                      {group.items.length} item{group.items.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "#6b7280",
                      marginTop: 2,
                      wordBreak: "break-word",
                    }}
                  >
                    {group.fileName}
                  </div>
                  <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                    {group.items.map((item, itemIndex) => {
                      const slotText = itemSlotText(item);
                      return (
                        <div
                          key={`${group.key}-${item.id}-${itemIndex}`}
                          style={{
                            border: "1px solid #e5e7eb",
                            borderRadius: 10,
                            padding: "8px 10px",
                            background: "#fff",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 8,
                              alignItems: "flex-start",
                            }}
                          >
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 800,
                                color: "#111827",
                                lineHeight: 1.3,
                              }}
                            >
                              {itemBaseLabel(item)}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                fontWeight: 900,
                                color: "#16a34a",
                                whiteSpace: "nowrap",
                              }}
                            >
                              Included
                            </div>
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
                            <span
                              style={{
                                fontSize: 10,
                                color: "#6b7280",
                                background: "#f9fafb",
                                border: "1px solid #e5e7eb",
                                borderRadius: 999,
                                padding: "2px 7px",
                                fontWeight: 800,
                              }}
                            >
                              Qty {itemQuantity(item)}
                            </span>
                            {slotText ? (
                              <span
                                style={{
                                  fontSize: 10,
                                  color: "#6b7280",
                                  background: "#f9fafb",
                                  border: "1px solid #e5e7eb",
                                  borderRadius: 999,
                                  padding: "2px 7px",
                                  fontWeight: 800,
                                }}
                              >
                                Slot {slotText}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {items.length === 0 ? (
          <div
            style={{
              fontSize: 13,
              color: "#6b7280",
              padding: "10px 0",
            }}
          >
            No itemized breakdown recorded.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {/* header row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto auto",
                gap: 10,
                fontSize: 10,
                letterSpacing: "0.08em",
                fontWeight: 800,
                color: "#9ca3af",
                padding: "0 0 6px",
                borderBottom: "1px solid #f3f4f6",
              }}
            >
              <span>ITEM</span>
              <span style={{ textAlign: "right" }}>QTY</span>
              <span style={{ textAlign: "right" }}>LINE</span>
            </div>
            {items.map((it) => {
              const qty = it.quantity ?? 1;
              const lineCents = resolveLineItemCents(it) ?? 0;
              const included = it.included || lineCents === 0;
              return (
                <div
                  key={it.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    gap: 10,
                    padding: "8px 0",
                    borderBottom: "1px dashed #f3f4f6",
                    alignItems: "baseline",
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#111827",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {itemBaseLabel(it)}
                  </span>
                  <span
                    style={{
                      textAlign: "right",
                      fontSize: 13,
                      color: "#374151",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    ×{qty}
                  </span>
                  <span
                    style={{
                      textAlign: "right",
                      fontSize: 13,
                      fontWeight: 800,
                      color: "#111827",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {included ? "Included" : money(lineCents, currency)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Totals */}
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px solid #e5e7eb",
            display: "grid",
            gap: 4,
          }}
        >
          {subtotalCents > 0 ? (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                color: "#6b7280",
              }}
            >
              <span>Subtotal</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {money(subtotalCents, currency)}
              </span>
            </div>
          ) : null}
          {order.tax_cents != null && order.tax_cents > 0 ? (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                color: "#6b7280",
              }}
            >
              <span>Tax</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                {money(order.tax_cents, currency)}
              </span>
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 15,
              fontWeight: 900,
              color: "#111827",
              marginTop: 4,
            }}
          >
            <span>Total</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {money(orderTotalCents(order), currency)}
            </span>
          </div>
        </div>
      </section>

      {/* Client note */}
      {clientNote ? (
        <section
          style={{
            border: "1px solid #fed7aa",
            background: "#fff7ed",
            borderRadius: 16,
            padding: 14,
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.12em",
              fontWeight: 800,
              color: "#c2410c",
              marginBottom: 6,
            }}
          >
            CLIENT NOTE
          </div>
          <div
            style={{
              fontSize: 14,
              color: "#7c2d12",
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
            }}
          >
            {clientNote}
          </div>
        </section>
      ) : null}

      {/* Jump into gallery context */}
      {(school?.id || project?.id) ? (
        <section
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 16,
            background: "#fff",
            padding: 4,
          }}
        >
          {school?.id ? (
            <Link
              href={`/m/schools/${school.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 12px",
                textDecoration: "none",
                color: "#111827",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.12em",
                    fontWeight: 800,
                    color: "#6b7280",
                  }}
                >
                  SCHOOL
                </span>
                <span style={{ fontSize: 14, fontWeight: 800 }}>
                  {clean(school.school_name) || "Open school"}
                </span>
              </div>
              <ChevronRight size={16} color="#9ca3af" />
            </Link>
          ) : null}
          {project?.id ? (
            <Link
              href={`/m/events/${project.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 12px",
                textDecoration: "none",
                color: "#111827",
                borderTop: school?.id ? "1px solid #f3f4f6" : undefined,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.12em",
                    fontWeight: 800,
                    color: "#6b7280",
                  }}
                >
                  EVENT
                </span>
                <span style={{ fontSize: 14, fontWeight: 800 }}>
                  {clean(project.title) || "Open event"}
                </span>
              </div>
              <ChevronRight size={16} color="#9ca3af" />
            </Link>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FolderOpen,
  GraduationCap,
  Image as ImageIcon,
  Images,
  LogOut,
  Mail,
  Monitor,
  Package2,
  Palette,
  Pencil,
  Printer,
  RefreshCw,
  School2,
  Settings,
  ShoppingBag,
  Sun,
  Trash2,
  UserCircle2,
  Users,
  WalletCards,
  Wrench,
  X,
  BarChart3,
  ClipboardList,
  Receipt,
  FileDown,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";

type OrderItem = {
  id?: string;
  product_name: string | null;
  quantity: number | null;
  price: number | null;
  unit_price_cents: number | null;
  line_total_cents: number | null;
  sku: string | null;
};

type Order = {
  id: string;
  created_at: string;
  status: string;
  seen_by_photographer: boolean;
  parent_name: string | null;
  parent_email: string | null;
  parent_phone: string | null;
  customer_name: string | null;
  customer_email: string | null;
  package_name: string;
  package_price: number;
  subtotal_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  total_amount: number | null;
  currency: string | null;
  special_notes: string | null;
  notes: string | null;
  student_id: string | null;
  school_id: string | null;
  class_id: string | null;
  student:
    | {
        first_name: string;
        last_name: string | null;
        photo_url: string | null;
        folder_name?: string | null;
        class_name?: string | null;
      }
    | null;
  school: { school_name: string } | null;
  class: { class_name: string } | null;
  items?: OrderItem[] | null;
};

type RelatedRow<T> = T | T[] | null | undefined;

type RawOrder = Omit<Order, "student" | "school" | "class"> & {
  student?: RelatedRow<NonNullable<Order["student"]>>;
  school?: RelatedRow<NonNullable<Order["school"]>>;
  class?: RelatedRow<NonNullable<Order["class"]>>;
};


type CombinedOrderGroup = {
  key: string;
  representative: Order;
  orders: Order[];
  imageUrls: string[];
  totalCents: number;
  itemsCount: number;
  orderCount: number;
  combinedStatus: string;
  packageSummary: string;
  isAnyNew: boolean;
};

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  new: { bg: "#fef2f2", color: "#ef4444", label: "New" },
  reviewed: { bg: "#fffbeb", color: "#d97706", label: "Reviewed" },
  sent_to_print: { bg: "#fff5f5", color: "#cc0000", label: "Sent to Print" },
  completed: { bg: "#f0fdf4", color: "#16a34a", label: "Completed" },
  payment_pending: { bg: "#fff7ed", color: "#ea580c", label: "Payment Pending" },
  paid: { bg: "#ecfeff", color: "#0891b2", label: "Paid" },
  digital_paid: { bg: "#eef2ff", color: "#4f46e5", label: "Digital Paid" },
};

const STATUS_FLOW = ["new", "reviewed", "sent_to_print", "completed"];
const pageBg = "#f3f4f6";
const cardBg = "#ffffff";
const borderColor = "#e5e7eb";
const textPrimary = "#111827";
const textMuted = "#6b7280";

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

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function singleRelation<T>(value: RelatedRow<T>): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function slug(value: string | null | undefined, fallback: string) {
  const cleaned = clean(value)
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fallback;
  return cleaned;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fileNameFromUrl(url: string, fallback: string) {
  try {
    const pathname = new URL(url).pathname;
    const name = pathname.split("/").pop();
    return name && name.trim() ? decodeURIComponent(name) : fallback;
  } catch {
    const parts = url.split("?")[0].split("/");
    return parts[parts.length - 1] || fallback;
  }
}

function extractImageUrls(order: Order | null) {
  if (!order) return [] as string[];
  const urls = new Set<string>();
  if (clean(order.student?.photo_url)) urls.add(order.student?.photo_url as string);
  for (const item of order.items ?? []) {
    if (clean(item.sku)) urls.add(item.sku as string);
  }
  return Array.from(urls);
}

async function triggerDownload(url: string, filename?: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  if (filename) anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

function downloadBlob(filename: string, type: string, content: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function buildManifest(order: Order) {
  const schoolName = slug(order.school?.school_name, "School");
  const className = slug(order.class?.class_name, "Class");
  const studentName = slug(`${order.student?.first_name ?? "Student"} ${order.student?.last_name ?? ""}`, "Student");
  const folderRoot = `${schoolName}/${className}/${studentName}`;
  const urls = extractImageUrls(order);

  const lines = [
    `Studio OS Lab Export`,
    `Order ID: ${order.id}`,
    `Order Date: ${formatDate(order.created_at)}`,
    `School: ${order.school?.school_name ?? "—"}`,
    `Class: ${order.class?.class_name ?? "—"}`,
    `Student: ${order.student?.first_name ?? ""} ${order.student?.last_name ?? ""}`.trim(),
    `Parent: ${order.parent_name ?? order.customer_name ?? "—"}`,
    `Email: ${order.parent_email ?? order.customer_email ?? "—"}`,
    `Package: ${order.package_name || "Package"}`,
    `Total: ${moneyFromCents(order.total_cents ?? Math.round((order.total_amount ?? 0) * 100), order.currency?.toUpperCase() || "CAD")}`,
    `Suggested Folder: ${folderRoot}`,
    ``,
    `Order Items`,
    ...(order.items?.length
      ? order.items.map((item, index) => {
          const qty = item.quantity ?? 0;
          const total = item.line_total_cents != null ? moneyFromCents(item.line_total_cents, order.currency?.toUpperCase() || "CAD") : moneyFromAmount(item.price, order.currency?.toUpperCase() || "CAD");
          return `${index + 1}. ${item.product_name ?? "Item"} | Qty: ${qty} | Total: ${total}`;
        })
      : [`1. ${order.package_name || "Package"} | Qty: 1 | Total: ${moneyFromAmount(order.package_price, order.currency?.toUpperCase() || "CAD")}`]),
    ``,
    `Original Files`,
    ...(urls.length ? urls.map((url, index) => `${index + 1}. ${fileNameFromUrl(url, `image-${index + 1}.jpg`)}\n   ${url}`) : ["No image URLs found."]),
    ``,
    `Special Notes`,
    order.special_notes || order.notes || "—",
  ];

  return { folderRoot, content: lines.join("\n") };
}

function combinedStudentKey(order: Order) {
  const studentPart = clean(order.student_id) || slug(`${order.student?.first_name ?? "Student"} ${order.student?.last_name ?? ""}`, "student");
  const schoolPart = clean(order.school_id) || slug(order.school?.school_name, "school");
  const classPart = clean(order.class_id) || slug(order.class?.class_name, "class");
  const parentPart = slug(order.parent_email ?? order.customer_email ?? order.parent_name ?? order.customer_name, "parent");
  return `${schoolPart}__${classPart}__${studentPart}__${parentPart}`;
}

function buildCombinedPackageSummary(orders: Order[]) {
  const uniquePackages = Array.from(new Set(orders.map((order) => clean(order.package_name)).filter(Boolean)));
  if (uniquePackages.length <= 2) return uniquePackages.join(" + ") || "Package";
  return `${uniquePackages.slice(0, 2).join(" + ")} +${uniquePackages.length - 2} more`;
}

function buildOrderSummaryHtml(order: Order) {
  const manifest = buildManifest(order);
  const currency = order.currency?.toUpperCase() || "CAD";
  const items = order.items?.length ? order.items : [{ product_name: order.package_name, quantity: 1, price: order.package_price, unit_price_cents: null, line_total_cents: Math.round((order.total_amount ?? order.package_price) * 100), sku: order.student?.photo_url ?? null }];
  const imageUrls = extractImageUrls(order);

  const rows = items
    .map((item) => {
      const qty = item.quantity ?? 0;
      const total = item.line_total_cents != null ? moneyFromCents(item.line_total_cents, currency) : moneyFromAmount(item.price, currency);
      return `<tr>
        <td>${item.product_name ?? "Item"}</td>
        <td>${qty}</td>
        <td>${total}</td>
        <td>${item.sku ? `<a href="${item.sku}" target="_blank" rel="noopener">Open original</a>` : "—"}</td>
      </tr>`;
    })
    .join("");

  const thumbs = imageUrls
    .map(
      (url) => `
      <div class="thumb">
        <img src="${url}" alt="" />
        <div class="thumb-name">${fileNameFromUrl(url, "image.jpg")}</div>
      </div>`,
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Studio OS Order ${order.id}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:32px;color:#111827}
.header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:28px}
.card{border:1px solid #e5e7eb;border-radius:18px;padding:18px;background:#fff}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-bottom:18px}
.small{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;font-weight:700;margin-bottom:6px}
.value{font-size:15px;font-weight:700;color:#111827}
table{width:100%;border-collapse:collapse;margin-top:10px}
th,td{border:1px solid #e5e7eb;padding:10px 12px;text-align:left;font-size:13px}
th{background:#f9fafb}
.thumbs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:16px}
.thumb{border:1px solid #e5e7eb;border-radius:14px;padding:10px}
.thumb img{width:100%;height:220px;object-fit:cover;border-radius:10px;background:#f3f4f6}
.thumb-name{margin-top:8px;font-size:12px;color:#6b7280;word-break:break-word}
pre{white-space:pre-wrap;line-height:1.55;font-size:12px;background:#f9fafb;border-radius:16px;padding:18px;border:1px solid #e5e7eb}
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1 style="margin:0 0 8px;font-size:32px;">Order ${order.id}</h1>
      <div style="color:#6b7280;font-size:14px;">Generated by Studio OS Lab Export</div>
    </div>
    <div class="card" style="min-width:240px;">
      <div class="small">Total</div>
      <div class="value" style="font-size:26px;">${moneyFromCents(order.total_cents ?? Math.round((order.total_amount ?? 0) * 100), currency)}</div>
      <div style="margin-top:10px;color:#6b7280;font-size:13px;">Status: ${STATUS_COLORS[order.status]?.label ?? order.status}</div>
      <div style="color:#6b7280;font-size:13px;">Created: ${formatDate(order.created_at)}</div>
    </div>
  </div>

  <div class="grid">
    <div class="card"><div class="small">School</div><div class="value">${order.school?.school_name ?? "—"}</div></div>
    <div class="card"><div class="small">Class</div><div class="value">${order.class?.class_name ?? "—"}</div></div>
    <div class="card"><div class="small">Student</div><div class="value">${`${order.student?.first_name ?? ""} ${order.student?.last_name ?? ""}`.trim() || "—"}</div></div>
    <div class="card"><div class="small">Parent</div><div class="value">${order.parent_name ?? order.customer_name ?? "—"}</div></div>
    <div class="card"><div class="small">Email</div><div class="value">${order.parent_email ?? order.customer_email ?? "—"}</div></div>
    <div class="card"><div class="small">Suggested Folder</div><div class="value">${manifest.folderRoot}</div></div>
  </div>

  <div class="card" style="margin-bottom:18px;">
    <div class="small">Items</div>
    <table>
      <thead><tr><th>Item</th><th>Qty</th><th>Total</th><th>Original</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <div class="card" style="margin-bottom:18px;">
    <div class="small">Original Photos</div>
    <div class="thumbs">${thumbs || "<div>No original photos found.</div>"}</div>
  </div>

  <div class="card">
    <div class="small">Manifest / Notes</div>
    <pre>${manifest.content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
  </div>
</body>
</html>`;
}

export default function OrdersPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<string>("new");
  const [selected, setSelected] = useState<Order | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [pgId, setPgId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState<Record<string, boolean>>({
    galleries: true,
    store: true,
    studio: true,
    reports: true,
  });
  const [expandedPhotos, setExpandedPhotos] = useState<Record<string, boolean>>({});
  const [schoolFilter, setSchoolFilter] = useState<string | null>(null); // null=all, school_id=school, "event"=no school
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState<{
    parentName: string;
    parentEmail: string;
    parentPhone: string;
    notes: string;
    items: Array<{ id?: string; productName: string; sku: string }>;
  }>({ parentName: "", parentEmail: "", parentPhone: "", notes: "", items: [] });

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pgId) return;
    const channel = supabase
      .channel("orders-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `photographer_id=eq.${pgId}` },
        () => {
          load();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [pgId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoading(false);
      return;
    }

    setUserEmail(user.email ?? "");

    const { data: photographer } = await supabase.from("photographers").select("id").eq("user_id", user.id).maybeSingle();
    if (!photographer?.id) {
      setLoading(false);
      return;
    }

    setPgId(photographer.id);

    const { data: rows } = await supabase
      .from("orders")
      .select(
        `
          id, created_at, status, seen_by_photographer,
          parent_name, parent_email, parent_phone,
          customer_name, customer_email,
          package_name, package_price,
          subtotal_cents, tax_cents, total_cents, total_amount, currency,
          special_notes, notes,
          student_id, school_id, class_id,
          student:students(first_name, last_name, photo_url, folder_name, class_name),
          school:schools(school_name),
          class:classes(class_name),
          items:order_items(id, product_name, quantity, price, unit_price_cents, line_total_cents, sku)
        `,
      )
      .eq("photographer_id", photographer.id)
      .order("created_at", { ascending: false });

    const nextOrders = ((rows as RawOrder[] | null) ?? []).map((order) => ({
      ...order,
      student: singleRelation(order.student),
      school: singleRelation(order.school),
      class: singleRelation(order.class),
      items: order.items ?? [],
    }));

    setOrders(nextOrders);
    setSelected((prev) => nextOrders.find((row) => row.id === prev?.id) ?? null);
    setLoading(false);
  }

  async function markSeen(orderId: string) {
    await supabase.from("orders").update({ seen_by_photographer: true }).eq("id", orderId);
  }

  async function updateStatus(orderId: string, newStatus: string) {
    setUpdatingId(orderId);
    await supabase.from("orders").update({ status: newStatus, seen_by_photographer: true }).eq("id", orderId);
    await load();
    setUpdatingId(null);
  }

  function openOrder(order: Order) {
    const isSameOpenOrder = selected?.id === order.id;
    if (isSameOpenOrder) {
      setSelected(null);
      return;
    }

    setSelected(order);
    if (!order.seen_by_photographer) {
      markSeen(order.id);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/sign-in";
  }

  function toggleSidebar(group: string) {
    setSidebarOpen((prev) => ({ ...prev, [group]: !prev[group] }));
  }

  function toggleExpandedPhotos(orderId: string) {
    setExpandedPhotos((prev) => ({ ...prev, [orderId]: !prev[orderId] }));
  }

  async function exportOrderSummary(order: Order) {
    setExportingId(order.id);
    try {
      const schoolName = slug(order.school?.school_name, "School");
      const className = slug(order.class?.class_name, "Class");
      const studentName = slug(`${order.student?.first_name ?? "Student"} ${order.student?.last_name ?? ""}`, "Student");
      const base = `${schoolName}__${className}__${studentName}__${order.id}`;
      downloadBlob(`${base}__lab-summary.html`, "text/html;charset=utf-8", buildOrderSummaryHtml(order));
      downloadBlob(`${base}__manifest.txt`, "text/plain;charset=utf-8", buildManifest(order).content);
    } finally {
      setExportingId(null);
    }
  }

  async function downloadOriginals(order: Order) {
    const urls = extractImageUrls(order);
    if (!urls.length) return;
    for (let i = 0; i < urls.length; i += 1) {
      const url = urls[i];
      const filename = fileNameFromUrl(url, `image-${i + 1}.jpg`);
      await triggerDownload(url, filename);
      await new Promise((resolve) => window.setTimeout(resolve, 220));
    }
  }

  async function exportAllVisible() {
    const rows = filtered;
    if (!rows.length) return;
    const manifest = rows
      .map((order) => buildManifest(order).content)
      .join("\n\n----------------------------------------\n\n");
    downloadBlob(`studio-os-orders-${filter}-manifest.txt`, "text/plain;charset=utf-8", manifest);
  }

  async function deleteOrder(orderId: string) {
    await supabase.from("order_items").delete().eq("order_id", orderId);
    await supabase.from("orders").delete().eq("id", orderId);
    setDeleteConfirmId(null);
    if (selected?.id === orderId) setSelected(null);
    await load();
  }

  function openEdit(order: Order) {
    setEditForm({
      parentName: order.parent_name ?? order.customer_name ?? "",
      parentEmail: order.parent_email ?? order.customer_email ?? "",
      parentPhone: order.parent_phone ?? "",
      notes: order.special_notes ?? order.notes ?? "",
      items: (order.items ?? []).map((item) => ({
        id: item.id,
        productName: item.product_name ?? "",
        sku: item.sku ?? "",
      })),
    });
    setEditingOrder(order);
  }

  async function saveOrderEdit() {
    if (!editingOrder) return;
    setSaving(true);
    try {
      await supabase.from("orders").update({
        parent_name: editForm.parentName || null,
        customer_name: editForm.parentName || null,
        parent_email: editForm.parentEmail || null,
        customer_email: editForm.parentEmail || null,
        parent_phone: editForm.parentPhone || null,
        special_notes: editForm.notes || null,
      }).eq("id", editingOrder.id);
      for (const item of editForm.items) {
        if (item.id) {
          await supabase.from("order_items").update({ sku: item.sku || null }).eq("id", item.id);
        }
      }
    } finally {
      setSaving(false);
      setEditingOrder(null);
      await load();
    }
  }

  const uniqueSchools = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of orders) {
      if (o.school_id && o.school?.school_name) map.set(o.school_id, o.school.school_name);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [orders]);

  const hasEventOrders = useMemo(() => orders.some((o) => !o.school_id), [orders]);

  const filtered = useMemo(() => {
    let result = filter === "all" ? orders : orders.filter((o) => o.status === filter);
    if (schoolFilter === "event") result = result.filter((o) => !o.school_id);
    else if (schoolFilter) result = result.filter((o) => o.school_id === schoolFilter);
    return result;
  }, [orders, filter, schoolFilter]);


  const selectedOrderedPhotoGroups = useMemo(() => {
    if (!selected) return [] as Array<{ url: string | null; fileName: string; items: OrderItem[] }>;

    const buckets = new Map<string, { url: string | null; fileName: string; items: OrderItem[] }>();
    const sourceItems = selected.items?.length
      ? selected.items
      : [{
          id: `${selected.id}-package`,
          product_name: selected.package_name,
          quantity: 1,
          price: selected.package_price,
          unit_price_cents: null,
          line_total_cents: Math.round((selected.total_amount ?? selected.package_price) * 100),
          sku: selected.student?.photo_url ?? null,
        } as OrderItem];

    for (const item of sourceItems) {
      const rawUrl = clean(item.sku);
      const key = rawUrl || `no-image-${selected.id}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.items.push(item);
      } else {
        buckets.set(key, {
          url: rawUrl || null,
          fileName: rawUrl ? fileNameFromUrl(rawUrl, selected.student?.folder_name || 'photo.jpg') : selected.student?.folder_name || `${selected.student?.first_name ?? 'student'}-${selected.id.slice(0, 6)}.jpg`,
          items: [item],
        });
      }
    }

    return Array.from(buckets.values());
  }, [selected]);

  const combinedRows = useMemo<CombinedOrderGroup[]>(() => {
    const groups = new Map<string, Order[]>();
    for (const order of filtered) {
      const key = combinedStudentKey(order);
      const existing = groups.get(key) ?? [];
      existing.push(order);
      groups.set(key, existing);
    }

    return Array.from(groups.entries()).map(([key, groupOrders]) => {
      const representative = groupOrders[0];
      const imageUrls = Array.from(new Set(groupOrders.flatMap((order) => extractImageUrls(order))));
      const totalCents = groupOrders.reduce((sum, order) => sum + (order.total_cents ?? Math.round((order.total_amount ?? order.package_price) * 100)), 0);
      const itemsCount = groupOrders.reduce((sum, order) => sum + ((order.items?.length || 0) > 0 ? order.items!.length : 1), 0);
      const statuses = Array.from(new Set(groupOrders.map((order) => order.status)));

      return {
        key,
        representative,
        orders: groupOrders,
        imageUrls,
        totalCents,
        itemsCount,
        orderCount: groupOrders.length,
        combinedStatus: statuses.length === 1 ? statuses[0] : representative.status,
        packageSummary: buildCombinedPackageSummary(groupOrders),
        isAnyNew: groupOrders.some((order) => !order.seen_by_photographer),
      };
    });
  }, [filtered]);

  async function exportCombinedSummary(group: CombinedOrderGroup) {
    setExportingId(group.key);
    try {
      for (const order of group.orders) {
        const schoolName = slug(order.school?.school_name, "School");
        const className = slug(order.class?.class_name, "Class");
        const studentName = slug(`${order.student?.first_name ?? "Student"} ${order.student?.last_name ?? ""}`, "Student");
        const base = `${schoolName}__${className}__${studentName}__${order.id}`;
        downloadBlob(`${base}__lab-summary.html`, "text/html;charset=utf-8", buildOrderSummaryHtml(order));
        downloadBlob(`${base}__manifest.txt`, "text/plain;charset=utf-8", buildManifest(order).content);
        await new Promise((resolve) => window.setTimeout(resolve, 120));
      }
    } finally {
      setExportingId(null);
    }
  }

  async function downloadCombinedOriginals(group: CombinedOrderGroup) {
    if (!group.imageUrls.length) return;
    for (let i = 0; i < group.imageUrls.length; i += 1) {
      const url = group.imageUrls[i];
      const filename = fileNameFromUrl(url, `image-${i + 1}.jpg`);
      await triggerDownload(url, filename);
      await new Promise((resolve) => window.setTimeout(resolve, 220));
    }
  }

  const newCount = useMemo(() => orders.filter((o) => !o.seen_by_photographer).length, [orders]);
  const totalRevenue = useMemo(() => filtered.reduce((sum, order) => sum + (order.total_cents ?? Math.round((order.total_amount ?? 0) * 100)), 0), [filtered]);
  const totalImages = useMemo(() => filtered.reduce((sum, order) => sum + extractImageUrls(order).length, 0), [filtered]);

  const navSectionTitle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    color: "#f9fafb",
    padding: "14px 18px 10px",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  };

  const navLinkStyle = (active = false): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    margin: "2px 10px",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 14,
    fontWeight: active ? 700 : 500,
    color: active ? "#ffffff" : "#d1d5db",
    textDecoration: "none",
    background: active ? "rgba(239,68,68,0.16)" : "transparent",
    boxShadow: active ? "inset 3px 0 0 #ef4444" : "none",
  });

  const sidebarGroup = (
    key: string,
    title: string,
    items: Array<{ label: string; href: string; icon: React.ReactNode; active?: boolean; soon?: boolean }>,
  ) => (
    <div>
      <button
        type="button"
        onClick={() => toggleSidebar(key)}
        style={{
          ...navSectionTitle,
          width: "100%",
          background: "transparent",
          border: "none",
          cursor: "pointer",
        }}
      >
        <span>{title}</span>
        {sidebarOpen[key] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {sidebarOpen[key] && (
        <div style={{ paddingBottom: 6 }}>
          {items.map((item) => (
            <Link key={item.label} href={item.href} style={navLinkStyle(item.active)}>
              <span style={{ display: "inline-flex", width: 18, justifyContent: "center" }}>{item.icon}</span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.soon ? (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 900,
                    letterSpacing: "0.08em",
                    color: "#9ca3af",
                    textTransform: "uppercase",
                  }}
                >
                  Soon
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: pageBg }}>
      <style>{`
        @keyframes pulse-soft { 0%,100%{opacity:1} 50%{opacity:.62} }
      `}</style>

      <aside
        style={{
          width: 280,
          flexShrink: 0,
          background: "#111111",
          color: "#fff",
          display: "flex",
          flexDirection: "column",
          position: "sticky",
          top: 0,
          height: "100vh",
          overflowY: "auto",
          borderRight: "1px solid #262626",
        }}
      >
        <div style={{ padding: "18px 18px 8px" }}>
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e5e7eb",
              borderRadius: 16,
              padding: "14px 16px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "flex-start" }}><Logo /></div>
          </div>
        </div>

        <div style={{ padding: "8px 14px 4px" }}>
          <Link
            href="/dashboard/projects"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              background: "#ffffff",
              color: "#111111",
              borderRadius: 12,
              padding: "12px 14px",
              fontWeight: 800,
              fontSize: 14,
              textDecoration: "none",
            }}
          >
            <FolderOpen size={16} /> Create Gallery
          </Link>
        </div>

        <nav style={{ flex: 1, paddingTop: 8, paddingBottom: 12 }}>
          <Link href="/dashboard" style={navLinkStyle(false)}>
            <BarChart3 size={18} />
            <span>Dashboard</span>
          </Link>

          {sidebarGroup("galleries", "Galleries", [
            { label: "All Galleries", href: "/dashboard/projects", icon: <Images size={18} /> },
            { label: "Gallery Visitors", href: "#", icon: <Users size={18} />, soon: true },
            { label: "Music for Galleries", href: "#", icon: <Monitor size={18} />, soon: true },
            { label: "Watermarks", href: "#", icon: <ImageIcon size={18} />, soon: true },
            { label: "Mobile Apps", href: "#", icon: <Monitor size={18} />, soon: true },
            { label: "Gallery Tools", href: "#", icon: <Wrench size={18} />, soon: true },
          ])}

          {sidebarGroup("store", "Store", [
            { label: "Orders", href: "/dashboard/orders", icon: <ClipboardList size={18} />, active: true },
            { label: "Price Sheets", href: "/dashboard/packages", icon: <WalletCards size={18} /> },
          ])}

          {sidebarGroup("studio", "Studio", [
            { label: "Clients", href: "#", icon: <Users size={18} />, soon: true },
            { label: "Contracts", href: "#", icon: <FileSpreadsheet size={18} />, soon: true },
            { label: "Invoices", href: "#", icon: <Receipt size={18} />, soon: true },
            { label: "Booking", href: "#", icon: <School2 size={18} />, soon: true },
            { label: "Themes", href: "#", icon: <Palette size={18} />, soon: true },
            { label: "Email", href: "#", icon: <Mail size={18} />, soon: true },
            { label: "Portfolio Website", href: "#", icon: <Monitor size={18} />, soon: true },
          ])}

          {sidebarGroup("reports", "Reports", [
            { label: "Sales Report", href: "#", icon: <BarChart3 size={18} />, soon: true },
            { label: "Orders Report", href: "#", icon: <ShoppingBag size={18} />, soon: true },
            { label: "Order Files Report", href: "#", icon: <FileDown size={18} />, soon: true },
            { label: "Products Report", href: "#", icon: <Package2 size={18} />, soon: true },
            { label: "Invoices Report", href: "#", icon: <Receipt size={18} />, soon: true },
          ])}
        </nav>

        <div style={{ borderTop: "1px solid #262626", padding: 12 }}>
          <Link href="/dashboard/settings" style={navLinkStyle(false)}>
            <Settings size={18} />
            <span>Settings</span>
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            style={{
              ...navLinkStyle(false),
              width: "100%",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <LogOut size={18} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 20,
            background: "rgba(255,255,255,0.9)",
            backdropFilter: "blur(16px)",
            borderBottom: `1px solid ${borderColor}`,
            padding: "14px 28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: textMuted, fontSize: 13 }}>
              <Link href="/dashboard" style={{ color: textMuted, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <ArrowLeft size={14} /> Dashboard
              </Link>
              <span>/</span>
              <span style={{ color: textPrimary, fontWeight: 700 }}>Orders</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: textPrimary }}>Orders Lab Center</h1>
              {newCount > 0 ? (
                <span
                  style={{
                    background: "#ef4444",
                    color: "#fff",
                    borderRadius: 999,
                    padding: "4px 10px",
                    fontSize: 12,
                    fontWeight: 800,
                    animation: "pulse-soft 1.7s infinite",
                  }}
                >
                  {newCount} new
                </span>
              ) : null}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={exportAllVisible}
              style={{
                background: "#111827",
                color: "#fff",
                border: "none",
                borderRadius: 12,
                padding: "10px 14px",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <Download size={16} /> Export visible manifest
            </button>
            <button
              type="button"
              onClick={load}
              style={{
                background: "#fff",
                color: textPrimary,
                border: `1px solid ${borderColor}`,
                borderRadius: 12,
                padding: "10px 14px",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              <RefreshCw size={16} /> Refresh
            </button>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "#fff",
                border: `1px solid ${borderColor}`,
                borderRadius: 999,
                padding: "8px 12px",
              }}
            >
              <UserCircle2 size={18} color="#9ca3af" />
              <span style={{ fontSize: 13, color: textPrimary, fontWeight: 600 }}>{userEmail}</span>
            </div>
          </div>
        </header>

        <main style={{ padding: 28, display: "flex", gap: 24, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: 16,
                marginBottom: 18,
              }}
            >
              {[
                { label: "Visible Orders", value: filtered.length, icon: <ShoppingBag size={18} />, note: "Filtered order count" },
                { label: "Visible Revenue", value: moneyFromCents(totalRevenue, "CAD"), icon: <WalletCards size={18} />, note: "Totals from visible list" },
                { label: "Original Files", value: totalImages, icon: <Images size={18} />, note: "URLs attached to visible orders" },
                { label: "Lab Ready", value: filtered.filter((o) => o.status === "sent_to_print").length, icon: <Printer size={18} />, note: "Orders already sent to print" },
              ].map((card) => (
                <div
                  key={card.label}
                  style={{
                    background: cardBg,
                    border: `1px solid ${borderColor}`,
                    borderRadius: 22,
                    padding: 18,
                    boxShadow: "0 8px 24px rgba(15,23,42,0.05)",
                  }}
                >
                  <div style={{ display: "inline-flex", width: 40, height: 40, borderRadius: 14, background: "#f5f5f5", alignItems: "center", justifyContent: "center", color: "#cc0000", marginBottom: 12 }}>
                    {card.icon}
                  </div>
                  <div style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 900, color: textMuted }}>{card.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 900, color: textPrimary, marginTop: 8 }}>{card.value}</div>
                  <div style={{ marginTop: 8, fontSize: 13, color: textMuted }}>{card.note}</div>
                </div>
              ))}
            </div>

            {/* ── School / Event filter ───────────────────────────────── */}
            {(uniqueSchools.length > 0 || hasEventOrders) ? (
              <div
                style={{
                  background: cardBg,
                  border: `1px solid ${borderColor}`,
                  borderRadius: 24,
                  padding: "14px 18px",
                  boxShadow: "0 8px 24px rgba(15,23,42,0.04)",
                  marginBottom: 14,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: textMuted, marginRight: 4 }}>Filter by</div>
                {[
                  { id: null, label: "All Orders", count: orders.length },
                  ...uniqueSchools.map((s) => ({ id: s.id, label: s.name, count: orders.filter((o) => o.school_id === s.id).length })),
                  ...(hasEventOrders ? [{ id: "event", label: "Events", count: orders.filter((o) => !o.school_id).length }] : []),
                ].map((opt) => {
                  const isActive = schoolFilter === opt.id;
                  return (
                    <button
                      key={String(opt.id)}
                      type="button"
                      onClick={() => setSchoolFilter(opt.id)}
                      style={{
                        borderRadius: 999,
                        padding: "8px 14px",
                        border: isActive ? "2px solid #cc0000" : `1px solid ${borderColor}`,
                        background: isActive ? "#cc0000" : "#fff",
                        color: isActive ? "#fff" : textPrimary,
                        fontSize: 13,
                        fontWeight: 800,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      {opt.id === "event" ? <FolderOpen size={13} /> : opt.id ? <GraduationCap size={13} /> : <ShoppingBag size={13} />}
                      {opt.label}
                      <span style={{ background: isActive ? "rgba(255,255,255,0.25)" : "#f3f4f6", borderRadius: 999, padding: "1px 7px", fontSize: 11, fontWeight: 900 }}>{opt.count}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div
              style={{
                background: cardBg,
                border: `1px solid ${borderColor}`,
                borderRadius: 24,
                padding: 18,
                boxShadow: "0 8px 24px rgba(15,23,42,0.04)",
                marginBottom: 18,
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {["all", "new", "reviewed", "sent_to_print", "completed", "payment_pending", "paid", "digital_paid"].map((statusKey) => {
                    const isActive = filter === statusKey;
                    const cfg = statusKey === "all" ? { label: "All Orders" } : STATUS_COLORS[statusKey] ?? { label: statusKey };
                    const count = statusKey === "all" ? orders.length : orders.filter((order) => order.status === statusKey).length;
                    return (
                      <button
                        key={statusKey}
                        type="button"
                        onClick={() => setFilter(statusKey)}
                        style={{
                          borderRadius: 999,
                          padding: "10px 14px",
                          border: isActive ? "1px solid #111827" : `1px solid ${borderColor}`,
                          background: isActive ? "#111827" : "#fff",
                          color: isActive ? "#fff" : textPrimary,
                          fontSize: 13,
                          fontWeight: 800,
                          cursor: "pointer",
                        }}
                      >
                        {cfg.label} ({count})
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: 13, color: textMuted }}>Photographer export flow: summary + manifest + originals</div>
              </div>
            </div>

            {loading ? (
              <div style={{ color: textMuted, fontSize: 14 }}>Loading orders…</div>
            ) : combinedRows.length === 0 ? (
              <div
                style={{
                  background: cardBg,
                  border: `2px dashed ${borderColor}`,
                  borderRadius: 24,
                  padding: "64px 24px",
                  textAlign: "center",
                }}
              >
                <ShoppingBag size={42} color="#cbd5e1" style={{ margin: "0 auto 12px" }} />
                <div style={{ fontSize: 18, fontWeight: 900, color: textPrimary }}>No orders here yet</div>
                <div style={{ fontSize: 14, color: textMuted, marginTop: 6 }}>Orders placed by parents will appear in this lab-ready workflow.</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {combinedRows.map((group) => {
                  const order = group.representative;
                  const cfg = STATUS_COLORS[group.combinedStatus] ?? STATUS_COLORS.new;
                  const isNew = group.isAnyNew;
                  const currency = order.currency?.toUpperCase() || "CAD";
                  const imageUrls = group.imageUrls;
                  const primaryImageUrl = imageUrls[0] ?? order.student?.photo_url ?? "";
                  const isPhotosExpanded = !!expandedPhotos[group.key];
                  const orderTotal = group.totalCents;
                  return (
                    <div
                      key={group.key}
                      onClick={() => openOrder(order)}
                      style={{
                        background: cardBg,
                        border: isNew ? "2px solid #ef4444" : `1px solid ${borderColor}`,
                        borderRadius: 24,
                        padding: 18,
                        boxShadow: isNew ? "0 0 0 4px rgba(239,68,68,0.08)" : "0 10px 24px rgba(15,23,42,0.04)",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", gap: 16, alignItems: "stretch" }}>
                        <div style={{ width: 110, flexShrink: 0 }}>
                          <div
                            style={{
                              width: 110,
                              height: 138,
                              borderRadius: 18,
                              overflow: "hidden",
                              background: "#f3f4f6",
                              border: `1px solid ${borderColor}`,
                            }}
                          >
                            {clean(primaryImageUrl) ? (
                              <img src={primaryImageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            ) : (
                              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af" }}>
                                <Users size={26} />
                              </div>
                            )}
                          </div>
                        </div>

                        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                                <h3 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: textPrimary }}>
                                  {`${order.student?.first_name ?? "Student"} ${order.student?.last_name ?? ""}`.trim()}
                                </h3>
                                {isNew ? (
                                  <span
                                    style={{
                                      background: "#ef4444",
                                      color: "#fff",
                                      borderRadius: 999,
                                      padding: "4px 8px",
                                      fontSize: 11,
                                      fontWeight: 900,
                                      letterSpacing: "0.06em",
                                      animation: "pulse-soft 1.7s infinite",
                                    }}
                                  >
                                    NEW
                                  </span>
                                ) : null}
                                <span style={{ background: cfg.bg, color: cfg.color, borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 800 }}>
                                  {cfg.label}
                                </span>
                                {group.orderCount > 1 ? (
                                  <span style={{ background: "#111827", color: "#ffffff", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 800 }}>
                                    {group.orderCount} orders combined
                                  </span>
                                ) : null}
                              </div>
                              <div style={{ fontSize: 14, color: textMuted, lineHeight: 1.6 }}>
                                {order.school?.school_name ?? "—"} · {order.class?.class_name ?? "—"} · {group.orderCount > 1 ? `Latest order ${order.id.slice(0, 8)}` : `Order ${order.id.slice(0, 8)}`}
                              </div>
                              <div style={{ fontSize: 14, color: textMuted, lineHeight: 1.6 }}>
                                Parent: {order.parent_name ?? order.customer_name ?? "—"} {clean(order.parent_email ?? order.customer_email) ? `· ${order.parent_email ?? order.customer_email}` : ""}
                              </div>
                            </div>

                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <div style={{ fontSize: 12, color: textMuted, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>Order Total</div>
                              <div style={{ fontSize: 24, fontWeight: 900, color: textPrimary, marginTop: 4 }}>{moneyFromCents(orderTotal, currency)}</div>
                              <div style={{ fontSize: 12, color: textMuted, marginTop: 4 }}>{formatDate(order.created_at)}</div>
                            </div>
                          </div>

                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr) minmax(0,1fr)",
                              gap: 12,
                            }}
                          >
                            <div style={{ background: "#f9fafb", border: `1px solid ${borderColor}`, borderRadius: 18, padding: 14 }}>
                              <div style={{ fontSize: 11, color: textMuted, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Package</div>
                              <div style={{ fontSize: 16, fontWeight: 800, color: textPrimary }}>{group.packageSummary}</div>
                              <div style={{ fontSize: 13, color: textMuted, marginTop: 6 }}>
                                {`${group.itemsCount} line item${group.itemsCount === 1 ? "" : "s"} across ${group.orderCount} order${group.orderCount === 1 ? "" : "s"}`}
                              </div>
                            </div>

                            <div style={{ background: "#f9fafb", border: `1px solid ${borderColor}`, borderRadius: 18, padding: 14 }}>
                              <div style={{ fontSize: 11, color: textMuted, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Original Files</div>
                              <div style={{ fontSize: 18, fontWeight: 900, color: textPrimary }}>{imageUrls.length}</div>
                              <div style={{ fontSize: 13, color: textMuted, marginTop: 6 }}>Ready for lab export</div>
                            </div>

                            <div style={{ background: "#f9fafb", border: `1px solid ${borderColor}`, borderRadius: 18, padding: 14 }}>
                              <div style={{ fontSize: 11, color: textMuted, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Export Flow</div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: textPrimary, lineHeight: 1.6 }}>Summary sheet + manifest + originals</div>
                            </div>
                          </div>

                          {imageUrls.length > 1 ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpandedPhotos(group.key);
                              }}
                              style={{
                                width: "100%",
                                background: isPhotosExpanded ? "#fff5f5" : "#f8fafc",
                                border: isPhotosExpanded ? "1px solid #cc0000" : `1px solid ${borderColor}`,
                                borderRadius: 16,
                                padding: 14,
                                cursor: "pointer",
                                textAlign: "left",
                                display: "flex",
                                flexDirection: "column",
                                gap: 12,
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                                  <div style={{ width: 34, height: 34, borderRadius: 12, background: isPhotosExpanded ? "#fde8e8" : "#e5e7eb", color: isPhotosExpanded ? "#cc0000" : textMuted, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                    <Images size={16} />
                                  </div>
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 900, color: textPrimary }}>
                                      {imageUrls.length} ordered photo{imageUrls.length === 1 ? "" : "s"}
                                    </div>
                                    <div style={{ fontSize: 12, color: textMuted }}>
                                      Click to {isPhotosExpanded ? "collapse" : "expand"} and review all photo thumbnails
                                    </div>
                                  </div>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, color: isPhotosExpanded ? "#cc0000" : textMuted, fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
                                  {isPhotosExpanded ? "Hide photos" : "Show photos"}
                                  {isPhotosExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                </div>
                              </div>

                              {isPhotosExpanded ? (
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))", gap: 10 }}>
                                  {imageUrls.map((url, index) => (
                                    <div key={`${group.key}-photo-${index}`} style={{ background: "#fff", border: `1px solid ${borderColor}`, borderRadius: 14, padding: 8 }}>
                                      <div style={{ width: "100%", aspectRatio: "3 / 4", overflow: "hidden", borderRadius: 10, background: "#f3f4f6", marginBottom: 6 }}>
                                        <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                      </div>
                                      <div style={{ fontSize: 11, color: textMuted, lineHeight: 1.35, wordBreak: "break-word" }}>{fileNameFromUrl(url, `photo-${index + 1}.jpg`)}</div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
                                  {imageUrls.slice(0, 4).map((url, index) => (
                                    <div key={`${group.key}-photo-preview-${index}`} style={{ width: 46, height: 58, borderRadius: 10, overflow: "hidden", border: `1px solid ${borderColor}`, background: "#fff", flexShrink: 0 }}>
                                      <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                    </div>
                                  ))}
                                  {imageUrls.length > 4 ? (
                                    <div style={{ minWidth: 46, height: 58, borderRadius: 10, border: `1px dashed ${borderColor}`, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 10px", color: textMuted, fontSize: 12, fontWeight: 800 }}>
                                      +{imageUrls.length - 4}
                                    </div>
                                  ) : null}
                                </div>
                              )}
                            </button>
                          ) : null}

                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                exportCombinedSummary(group);
                              }}
                              style={{
                                background: "#111827",
                                color: "#fff",
                                border: "none",
                                borderRadius: 12,
                                padding: "10px 14px",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 8,
                                fontWeight: 800,
                                cursor: "pointer",
                              }}
                            >
                              <Download size={16} /> {exportingId === group.key ? "Exporting..." : group.orderCount > 1 ? "Export all summaries" : "Export summary"}
                            </button>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                downloadCombinedOriginals(group);
                              }}
                              style={{
                                background: "#fff",
                                color: textPrimary,
                                border: `1px solid ${borderColor}`,
                                borderRadius: 12,
                                padding: "10px 14px",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 8,
                                fontWeight: 800,
                                cursor: "pointer",
                              }}
                            >
                              <FolderOpen size={16} /> Download originals
                            </button>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openOrder(order);
                              }}
                              style={{
                                background: "#fff5f5",
                                color: "#cc0000",
                                border: "1px solid #cc0000",
                                borderRadius: 12,
                                padding: "10px 14px",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 8,
                                fontWeight: 800,
                                cursor: "pointer",
                              }}
                            >
                              {selected?.id === order.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />} {selected?.id === order.id ? "Close details" : group.orderCount > 1 ? "Open latest details" : "Open details"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {selected ? (
            <div
              style={{
                width: 420,
                flexShrink: 0,
                position: "sticky",
                top: 96,
                maxHeight: "calc(100vh - 120px)",
                overflowY: "auto",
                background: cardBg,
                border: `1px solid ${borderColor}`,
                borderRadius: 28,
                padding: 20,
                boxShadow: "0 14px 40px rgba(15,23,42,0.08)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 900, color: textMuted }}>Order Details</div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: textPrimary, marginTop: 4 }}>#{selected.id.slice(0, 8)}</div>
                </div>
                <button type="button" onClick={() => setSelected(null)} style={{ background: "#f3f4f6", border: "none", width: 36, height: 36, borderRadius: 12, cursor: "pointer", color: textMuted }}>
                  <X size={16} />
                </button>
              </div>

              {clean(selected.student?.photo_url) ? (
                <img src={selected.student?.photo_url ?? ""} alt="" style={{ width: "100%", height: 260, objectFit: "cover", borderRadius: 22, border: `1px solid ${borderColor}`, marginBottom: 16 }} />
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12, marginBottom: 16 }}>
                {[
                  { label: "Student", value: `${selected.student?.first_name ?? ""} ${selected.student?.last_name ?? ""}`.trim() || "—", icon: <GraduationCap size={16} /> },
                  { label: "School", value: selected.school?.school_name ?? "—", icon: <School2 size={16} /> },
                  { label: "Class", value: selected.class?.class_name ?? "—", icon: <Users size={16} /> },
                  { label: "Total", value: moneyFromCents(selected.total_cents ?? Math.round((selected.total_amount ?? 0) * 100), selected.currency?.toUpperCase() || "CAD"), icon: <WalletCards size={16} /> },
                ].map((block) => (
                  <div key={block.label} style={{ background: "#f9fafb", border: `1px solid ${borderColor}`, borderRadius: 18, padding: 14 }}>
                    <div style={{ display: "inline-flex", width: 30, height: 30, borderRadius: 10, background: "#f5f5f5", color: "#cc0000", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>{block.icon}</div>
                    <div style={{ fontSize: 11, color: textMuted, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>{block.label}</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: textPrimary, marginTop: 6, lineHeight: 1.45 }}>{block.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: "#f9fafb", border: `1px solid ${borderColor}`, borderRadius: 18, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: textMuted, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Parent</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: textPrimary }}>{selected.parent_name ?? selected.customer_name ?? "—"}</div>
                <div style={{ fontSize: 13, color: textMuted, marginTop: 4 }}>{selected.parent_email ?? selected.customer_email ?? "—"}</div>
                <div style={{ fontSize: 13, color: textMuted, marginTop: 4 }}>{selected.parent_phone ?? "—"}</div>
              </div>

              <div style={{ background: "#f9fafb", border: `1px solid ${borderColor}`, borderRadius: 18, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: textMuted, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Package</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: textPrimary }}>{selected.package_name}</div>
                <div style={{ fontSize: 14, color: textMuted, marginTop: 6 }}>Created {formatDate(selected.created_at)}</div>
              </div>

              <div style={{ background: "#f9fafb", border: `1px solid ${borderColor}`, borderRadius: 18, padding: 16, marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: textMuted, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>Ordered Photos</div>
                  <div style={{ fontSize: 12, color: textMuted }}>{selectedOrderedPhotoGroups.length} photo{selectedOrderedPhotoGroups.length === 1 ? "" : "s"}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {selectedOrderedPhotoGroups.map((photoGroup, groupIndex) => (
                    <div key={`${photoGroup.fileName}-${groupIndex}`} style={{ border: `1px solid ${borderColor}`, borderRadius: 16, padding: 12, background: "#fff" }}>
                      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                        <div style={{ width: 72, flexShrink: 0 }}>
                          <div style={{ width: 72, height: 92, borderRadius: 12, overflow: "hidden", border: `1px solid ${borderColor}`, background: "#f3f4f6" }}>
                            {photoGroup.url ? (
                              <img src={photoGroup.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            ) : (
                              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af" }}>
                                <ImageIcon size={20} />
                              </div>
                            )}
                          </div>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color: textPrimary, wordBreak: "break-word" }}>{photoGroup.fileName}</div>
                          <div style={{ fontSize: 12, color: textMuted, marginTop: 4 }}>
                            {photoGroup.items.length} ordered item{photoGroup.items.length === 1 ? "" : "s"}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                            {photoGroup.items.map((item, itemIndex) => (
                              <div key={`${photoGroup.fileName}-${item.product_name}-${itemIndex}`} style={{ borderRadius: 12, border: `1px solid ${borderColor}`, padding: 10, background: "#f9fafb" }}>
                                <div style={{ fontSize: 13, fontWeight: 800, color: textPrimary }}>{item.product_name ?? "Item"}</div>
                                <div style={{ fontSize: 12, color: textMuted, marginTop: 4 }}>
                                  Qty: {item.quantity ?? 0} · Total: {item.line_total_cents != null ? moneyFromCents(item.line_total_cents, selected.currency?.toUpperCase() || "CAD") : moneyFromAmount(item.price, selected.currency?.toUpperCase() || "CAD")}
                                </div>
                              </div>
                            ))}
                          </div>
                          {photoGroup.url ? (
                            <div style={{ marginTop: 8 }}>
                              <a href={photoGroup.url} target="_blank" rel="noopener noreferrer" style={{ color: "#cc0000", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
                                Open original file
                              </a>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {clean(selected.special_notes || selected.notes) ? (
                <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 18, padding: 16, marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: "#92400e", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Notes</div>
                  <div style={{ fontSize: 13, color: "#78350f", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{selected.special_notes || selected.notes}</div>
                </div>
              ) : null}

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
                <button
                  type="button"
                  onClick={() => exportOrderSummary(selected)}
                  style={{
                    background: "#111827",
                    color: "#fff",
                    border: "none",
                    borderRadius: 12,
                    padding: "10px 14px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  <Download size={16} /> Export summary
                </button>
                <button
                  type="button"
                  onClick={() => downloadOriginals(selected)}
                  style={{
                    background: "#fff",
                    color: textPrimary,
                    border: `1px solid ${borderColor}`,
                    borderRadius: 12,
                    padding: "10px 14px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  <FolderOpen size={16} /> Download originals
                </button>
              </div>

              {/* Edit & Delete */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
                <button
                  type="button"
                  onClick={() => openEdit(selected)}
                  style={{
                    flex: 1,
                    background: "#cc0000",
                    color: "#fff",
                    border: "none",
                    borderRadius: 12,
                    padding: "10px 14px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  <Pencil size={15} /> Edit Order
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteConfirmId(selected.id)}
                  style={{
                    flex: 1,
                    background: "#fff",
                    color: "#cc0000",
                    border: "1px solid #cc0000",
                    borderRadius: 12,
                    padding: "10px 14px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  <Trash2 size={15} /> Delete
                </button>
              </div>

              <div style={{ borderTop: `1px solid ${borderColor}`, paddingTop: 16 }}>
                <div style={{ fontSize: 11, color: textMuted, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>Update Status</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {STATUS_FLOW.map((statusKey, index) => {
                    const cfg = STATUS_COLORS[statusKey];
                    const currentIndex = STATUS_FLOW.indexOf(selected.status);
                    const isCurrent = selected.status === statusKey;
                    const isDone = currentIndex > index;
                    return (
                      <button
                        key={statusKey}
                        type="button"
                        disabled={isCurrent || updatingId === selected.id}
                        onClick={() => updateStatus(selected.id, statusKey)}
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "12px 14px",
                          borderRadius: 14,
                          border: isCurrent ? `2px solid ${cfg.color}` : `1px solid ${borderColor}`,
                          background: isCurrent ? cfg.bg : isDone ? "#f9fafb" : "#fff",
                          cursor: isCurrent ? "default" : "pointer",
                          opacity: updatingId === selected.id ? 0.5 : 1,
                        }}
                      >
                        <div style={{ width: 24, height: 24, borderRadius: 999, background: isCurrent || isDone ? cfg.color : "#e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {isCurrent || isDone ? <Check size={14} color="#fff" strokeWidth={3} /> : null}
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 800, color: isCurrent ? cfg.color : textPrimary }}>
                          {cfg.label}
                        </span>
                        {statusKey === "sent_to_print" ? <Printer size={16} color="#cc0000" style={{ marginLeft: "auto" }} /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </main>
      </div>

      {/* ── Edit Order Modal ──────────────────────────────────────────────── */}
      {editingOrder ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "#fff", borderRadius: 24, width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto", padding: 28, boxShadow: "0 24px 60px rgba(0,0,0,0.25)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 11, color: textMuted, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase" }}>Edit Order</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: textPrimary, marginTop: 4 }}>#{editingOrder.id.slice(0, 8)}</div>
              </div>
              <button type="button" onClick={() => setEditingOrder(null)} style={{ background: "#f3f4f6", border: "none", width: 36, height: 36, borderRadius: 12, cursor: "pointer", color: textMuted, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <X size={16} />
              </button>
            </div>

            {/* Contact Info */}
            <div style={{ fontSize: 11, color: textMuted, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>Contact Information</div>
            <div style={{ display: "grid", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Parent / Customer Name", key: "parentName" as const, placeholder: "Full name" },
                { label: "Email", key: "parentEmail" as const, placeholder: "email@example.com" },
                { label: "Phone", key: "parentPhone" as const, placeholder: "+1 (xxx) xxx-xxxx" },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: textMuted, marginBottom: 6 }}>{label}</div>
                  <input
                    type="text"
                    value={editForm[key]}
                    onChange={(e) => setEditForm((f) => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    style={{ width: "100%", border: `1px solid ${borderColor}`, borderRadius: 10, padding: "10px 12px", fontSize: 14, color: textPrimary, outline: "none", boxSizing: "border-box" }}
                  />
                </div>
              ))}
              <div>
                <div style={{ fontSize: 12, fontWeight: 800, color: textMuted, marginBottom: 6 }}>Special Notes</div>
                <textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Any special instructions..."
                  rows={3}
                  style={{ width: "100%", border: `1px solid ${borderColor}`, borderRadius: 10, padding: "10px 12px", fontSize: 14, color: textPrimary, outline: "none", resize: "vertical", boxSizing: "border-box" }}
                />
              </div>
            </div>

            {/* Pose / Photo changes */}
            {editForm.items.length > 0 ? (
              <>
                <div style={{ fontSize: 11, color: textMuted, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>Pose / Photo Changes</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
                  {editForm.items.map((item, idx) => (
                    <div key={idx} style={{ border: `1px solid ${borderColor}`, borderRadius: 14, padding: 14 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: textPrimary, marginBottom: 8 }}>{item.productName || `Item ${idx + 1}`}</div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: textMuted, marginBottom: 6 }}>Photo URL (Pose)</div>
                      <input
                        type="text"
                        value={item.sku}
                        onChange={(e) => {
                          const updated = [...editForm.items];
                          updated[idx] = { ...updated[idx], sku: e.target.value };
                          setEditForm((f) => ({ ...f, items: updated }));
                        }}
                        placeholder="https://... photo URL or leave blank"
                        style={{ width: "100%", border: `1px solid ${borderColor}`, borderRadius: 10, padding: "9px 12px", fontSize: 13, color: textPrimary, outline: "none", boxSizing: "border-box" }}
                      />
                      {item.sku ? (
                        <div style={{ marginTop: 10 }}>
                          <img src={item.sku} alt="" style={{ width: 72, height: 92, objectFit: "cover", borderRadius: 10, border: `1px solid ${borderColor}` }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={saveOrderEdit}
                disabled={saving}
                style={{ flex: 1, background: "#cc0000", color: "#fff", border: "none", borderRadius: 12, padding: "12px 16px", fontWeight: 800, fontSize: 14, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1 }}
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
              <button
                type="button"
                onClick={() => setEditingOrder(null)}
                style={{ flex: 1, background: "#fff", color: textPrimary, border: `1px solid ${borderColor}`, borderRadius: 12, padding: "12px 16px", fontWeight: 800, fontSize: 14, cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Delete Confirm Modal ──────────────────────────────────────────── */}
      {deleteConfirmId ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "#fff", borderRadius: 24, width: "100%", maxWidth: 420, padding: 28, boxShadow: "0 24px 60px rgba(0,0,0,0.25)" }}>
            <div style={{ width: 48, height: 48, borderRadius: 16, background: "#fff0f0", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
              <Trash2 size={22} color="#cc0000" />
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: textPrimary, marginBottom: 8 }}>Delete this order?</div>
            <div style={{ fontSize: 14, color: textMuted, lineHeight: 1.6, marginBottom: 24 }}>
              This will permanently delete the order and all its items. This cannot be undone.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={() => deleteOrder(deleteConfirmId)}
                style={{ flex: 1, background: "#cc0000", color: "#fff", border: "none", borderRadius: 12, padding: "12px 16px", fontWeight: 800, fontSize: 14, cursor: "pointer" }}
              >
                Delete permanently
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirmId(null)}
                style={{ flex: 1, background: "#fff", color: textPrimary, border: `1px solid ${borderColor}`, borderRadius: 12, padding: "12px 16px", fontWeight: 800, fontSize: 14, cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}

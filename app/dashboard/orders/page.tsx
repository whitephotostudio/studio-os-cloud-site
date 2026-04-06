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
  LayoutGrid,
  List,
  Pencil,
  Printer,
  RefreshCw,
  School2,
  Settings,
  ShoppingBag,
  Square,
  CheckSquare,
  Sun,
  Table2,
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

type EventProject = {
  id: string;
  title: string;
  client_name: string | null;
  event_date: string | null;
  portal_status: string | null;
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
  project_id: string | null;
  project: { id: string; title: string } | null;
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

type RawOrder = Omit<Order, "student" | "school" | "class" | "project"> & {
  student?: RelatedRow<NonNullable<Order["student"]>>;
  school?: RelatedRow<NonNullable<Order["school"]>>;
  class?: RelatedRow<NonNullable<Order["class"]>>;
  project?: RelatedRow<NonNullable<Order["project"]>>;
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
const pageBg = "#ffffff";
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
  const [eventProjects, setEventProjects] = useState<EventProject[]>([]);
  const [schoolFilter, setSchoolFilter] = useState<string | null>(null); // null=all, school_id=school, "event"=all events, "event:{uuid}"=specific event
  const [schoolDropdownOpen, setSchoolDropdownOpen] = useState(false);
  const [eventDropdownOpen, setEventDropdownOpen] = useState(false);
  const [schoolSearch, setSchoolSearch] = useState("");
  const [eventSearch, setEventSearch] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid" | "table">("list");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState({ done: 0, total: 0 });
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadingBulk, setDownloadingBulk] = useState(false);
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

    // Fetch event projects for this photographer
    const { data: projectRows } = await supabase
      .from("projects")
      .select("id, title, client_name, event_date, portal_status")
      .eq("photographer_id", photographer.id)
      .eq("workflow_type", "event")
      .order("created_at", { ascending: false });
    setEventProjects((projectRows as EventProject[] | null) ?? []);

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
          student_id, school_id, class_id, project_id,
          student:students(first_name, last_name, photo_url, folder_name, class_name),
          school:schools(school_name),
          class:classes(class_name),
          project:projects(id, title),
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
      project: singleRelation(order.project),
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

  async function downloadOrderZip(order: Order) {
    setDownloadingId(order.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/dashboard/orders/download?ids=${order.id}`, {
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Download failed" }));
        alert(err.message || "Download failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="(.+?)"/);
      const filename = match?.[1] ?? `order-${order.id.slice(0, 8)}.zip`;
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingId(null);
    }
  }

  async function downloadOriginals(order: Order) {
    await downloadOrderZip(order);
  }

  async function exportAllVisible() {
    const rows = filtered;
    if (!rows.length) return;
    setDownloadingBulk(true);
    try {
      const ids = rows.map((o) => o.id).join(",");
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/dashboard/orders/download?ids=${ids}`, {
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Download failed" }));
        alert(err.message || "Bulk download failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="(.+?)"/);
      const filename = match?.[1] ?? `studio-os-orders.zip`;
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingBulk(false);
    }
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

  function toggleSelect(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleSelectAll(rows: typeof combinedRows) {
    if (selectedKeys.size === rows.length && rows.length > 0) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(rows.map((g) => g.key)));
    }
  }

  async function bulkDelete(rows: typeof combinedRows) {
    setBulkDeleting(true);
    try {
      const orderIds = rows
        .filter((g) => selectedKeys.has(g.key))
        .flatMap((g) => g.orders.map((o) => o.id));
      setBulkDeleteProgress({ done: 0, total: orderIds.length });

      // Delete in batches of 10 for speed
      const batchSize = 10;
      for (let i = 0; i < orderIds.length; i += batchSize) {
        const batch = orderIds.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (id) => {
            await supabase.from("order_items").delete().eq("order_id", id);
            await supabase.from("orders").delete().eq("id", id);
          })
        );
        setBulkDeleteProgress({ done: Math.min(i + batchSize, orderIds.length), total: orderIds.length });
      }

      setSelectedKeys(new Set());
      setBulkDeleteConfirm(false);
      if (selected && orderIds.includes(selected.id)) setSelected(null);
      await load();
    } finally {
      setBulkDeleting(false);
      setBulkDeleteProgress({ done: 0, total: 0 });
    }
  }

  const uniqueSchools = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of orders) {
      if (o.school_id && o.school?.school_name) map.set(o.school_id, o.school.school_name);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [orders]);

  const hasEventOrders = useMemo(() => orders.some((o) => !o.school_id) || eventProjects.length > 0, [orders, eventProjects]);

  const filtered = useMemo(() => {
    let result = filter === "all" ? orders : orders.filter((o) => o.status === filter);
    if (schoolFilter === "event") {
      result = result.filter((o) => !o.school_id);
    } else if (schoolFilter?.startsWith("event:")) {
      const pid = schoolFilter.slice(6);
      result = result.filter((o) => o.project_id === pid);
    } else if (schoolFilter) {
      result = result.filter((o) => o.school_id === schoolFilter);
    }
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
    const ids = group.orders.map((o) => o.id).join(",");
    setDownloadingId(group.key);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/dashboard/orders/download?ids=${ids}`, {
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Download failed" }));
        alert(err.message || "Download failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="(.+?)"/);
      const filename = match?.[1] ?? `order-${group.key.slice(0, 8)}.zip`;
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingId(null);
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
          width: 220,
          flexShrink: 0,
          background: "#000000",
          color: "#fff",
          display: "flex",
          flexDirection: "column",
          position: "sticky",
          top: 0,
          height: "100vh",
          overflowY: "auto",
        }}
      >
        <div style={{ padding: "18px", background: "#ffffff", borderBottom: "1px solid #e5e7eb" }}>
          <div style={{ background: "#ffffff", borderRadius: 16, padding: "14px 16px" }}>
            <div style={{ display: "flex", justifyContent: "flex-start" }}><Link href="/" style={{ display: "inline-flex" }}><Logo small /></Link></div>
          </div>
        </div>

        <nav style={{ flex: 1, paddingTop: 16 }}>
          <Link
            href="/dashboard"
            style={{
              padding: "12px 24px",
              fontSize: 14,
              color: "#ccc",
              textDecoration: "none",
              display: "block",
            }}
          >
            Dashboard
          </Link>
          <Link
            href="/dashboard/schools"
            style={{
              padding: "12px 24px",
              fontSize: 14,
              color: "#ccc",
              textDecoration: "none",
              display: "block",
            }}
          >
            Schools
          </Link>
          <Link
            href="/dashboard/projects/events"
            style={{
              padding: "12px 24px",
              fontSize: 14,
              color: "#ccc",
              textDecoration: "none",
              display: "block",
            }}
          >
            Events
          </Link>
          <Link
            href="/dashboard/orders"
            style={{
              padding: "12px 24px",
              fontSize: 14,
              color: "#fff",
              background: "#1a1a1a",
              textDecoration: "none",
              display: "block",
            }}
          >
            Orders
          </Link>
          <Link
            href="/dashboard/packages"
            style={{
              padding: "12px 24px",
              fontSize: 14,
              color: "#ccc",
              textDecoration: "none",
              display: "block",
            }}
          >
            Packages
          </Link>
          <Link
            href="/dashboard/settings"
            style={{
              padding: "12px 24px",
              fontSize: 14,
              color: "#ccc",
              textDecoration: "none",
              display: "block",
            }}
          >
            Settings
          </Link>
        </nav>

        <div style={{ padding: "0 16px 8px", color: "#8f8f8f", fontSize: 12 }}>{userEmail}</div>
        <button
          type="button"
          onClick={handleSignOut}
          style={{
            margin: 16,
            padding: "10px",
            background: "transparent",
            border: "1px solid #333",
            borderRadius: 8,
            color: "#ccc",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
          }}
        >
          <LogOut size={14} /> Sign Out
        </button>
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
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: textPrimary }}>Orders</h1>
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
            {/* View mode toggle */}
            <div style={{ display: "inline-flex", border: `1px solid ${borderColor}`, borderRadius: 12, overflow: "hidden" }}>
              {([["list", <List size={15} />], ["grid", <LayoutGrid size={15} />], ["table", <Table2 size={15} />]] as const).map(([mode, icon]) => (
                <button
                  key={mode}
                  type="button"
                  title={`${mode.charAt(0).toUpperCase() + mode.slice(1)} view`}
                  onClick={() => setViewMode(mode)}
                  style={{ padding: "9px 13px", background: viewMode === mode ? "#111827" : "#fff", color: viewMode === mode ? "#fff" : textMuted, border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center" }}
                >
                  {icon}
                </button>
              ))}
            </div>

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
              <Download size={16} /> {downloadingBulk ? "Downloading…" : "Download All Orders"}
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

            {/* ── School / Event dropdowns ─────────────────────────────── */}
            {(uniqueSchools.length > 0 || hasEventOrders) ? (
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14, position: "relative", zIndex: 30 }}>

                {/* Backdrop to close dropdowns */}
                {(schoolDropdownOpen || eventDropdownOpen) && (
                  <div style={{ position: "fixed", inset: 0, zIndex: 28 }} onClick={() => { setSchoolDropdownOpen(false); setEventDropdownOpen(false); }} />
                )}

                {/* Schools dropdown */}
                {uniqueSchools.length > 0 && (
                  <div style={{ position: "relative", zIndex: 30 }}>
                    <button
                      type="button"
                      onClick={() => { setSchoolDropdownOpen((v) => !v); setEventDropdownOpen(false); }}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 8,
                        background: schoolFilter && schoolFilter !== "event" && !schoolFilter.startsWith("event:") ? "#cc0000" : "#fff",
                        color: schoolFilter && schoolFilter !== "event" && !schoolFilter.startsWith("event:") ? "#fff" : textPrimary,
                        border: schoolFilter && schoolFilter !== "event" && !schoolFilter.startsWith("event:") ? "2px solid #cc0000" : `1px solid ${borderColor}`,
                        borderRadius: 12, padding: "10px 14px", fontWeight: 800, fontSize: 13, cursor: "pointer",
                      }}
                    >
                      <GraduationCap size={14} />
                      {schoolFilter && schoolFilter !== "event" && !schoolFilter.startsWith("event:")
                        ? (uniqueSchools.find((s) => s.id === schoolFilter)?.name ?? "School")
                        : "Schools"}
                      <ChevronDown size={13} />
                    </button>

                    {schoolDropdownOpen && (
                      <div style={{
                        position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 30,
                        background: "#fff", border: `1px solid ${borderColor}`, borderRadius: 16,
                        boxShadow: "0 16px 40px rgba(0,0,0,0.13)", width: 280,
                      }}>
                        {/* Search */}
                        <div style={{ padding: "10px 12px", borderBottom: `1px solid ${borderColor}` }}>
                          <input
                            type="text"
                            value={schoolSearch}
                            onChange={(e) => setSchoolSearch(e.target.value)}
                            placeholder="Search schools…"
                            autoFocus
                            style={{ width: "100%", border: `1px solid ${borderColor}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, outline: "none", boxSizing: "border-box", color: textPrimary }}
                          />
                        </div>
                        {/* Options */}
                        <div style={{ maxHeight: 260, overflowY: "auto" }}>
                          <button
                            type="button"
                            onClick={() => { setSchoolFilter(null); setSchoolDropdownOpen(false); setSchoolSearch(""); }}
                            style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", background: !schoolFilter || schoolFilter === "event" || schoolFilter.startsWith("event:") ? "#fff5f5" : "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: !schoolFilter || schoolFilter === "event" || schoolFilter.startsWith("event:") ? 800 : 500, color: !schoolFilter || schoolFilter === "event" || schoolFilter.startsWith("event:") ? "#cc0000" : textPrimary, textAlign: "left" }}
                          >
                            <span>All Schools</span>
                            <span style={{ fontSize: 11, background: "#f3f4f6", borderRadius: 999, padding: "1px 8px", color: textMuted }}>{orders.filter((o) => !!o.school_id).length}</span>
                          </button>
                          {uniqueSchools
                            .filter((s) => s.name.toLowerCase().includes(schoolSearch.toLowerCase()))
                            .map((school) => (
                              <button
                                key={school.id}
                                type="button"
                                onClick={() => { setSchoolFilter(school.id); setSchoolDropdownOpen(false); setSchoolSearch(""); }}
                                style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", background: schoolFilter === school.id ? "#fff5f5" : "#fff", border: "none", borderTop: `1px solid #f5f5f5`, cursor: "pointer", fontSize: 13, fontWeight: schoolFilter === school.id ? 800 : 500, color: schoolFilter === school.id ? "#cc0000" : textPrimary, textAlign: "left" }}
                              >
                                <span>{school.name}</span>
                                <span style={{ fontSize: 11, background: "#f3f4f6", borderRadius: 999, padding: "1px 8px", color: textMuted }}>{orders.filter((o) => o.school_id === school.id).length}</span>
                              </button>
                            ))}
                          {uniqueSchools.filter((s) => s.name.toLowerCase().includes(schoolSearch.toLowerCase())).length === 0 && (
                            <div style={{ padding: "12px 14px", fontSize: 13, color: textMuted }}>No schools match "{schoolSearch}"</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Events dropdown */}
                {hasEventOrders && (
                  <div style={{ position: "relative", zIndex: 30 }}>
                    {(() => {
                      const isEventActive = schoolFilter === "event" || schoolFilter?.startsWith("event:");
                      const activeProjectId = schoolFilter?.startsWith("event:") ? schoolFilter.slice(6) : null;
                      const activeProjectName = activeProjectId ? eventProjects.find((p) => p.id === activeProjectId)?.title : null;
                      return (
                        <>
                          <button
                            type="button"
                            onClick={() => { setEventDropdownOpen((v) => !v); setSchoolDropdownOpen(false); }}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 8,
                              background: isEventActive ? "#cc0000" : "#fff",
                              color: isEventActive ? "#fff" : textPrimary,
                              border: isEventActive ? "2px solid #cc0000" : `1px solid ${borderColor}`,
                              borderRadius: 12, padding: "10px 14px", fontWeight: 800, fontSize: 13, cursor: "pointer",
                            }}
                          >
                            <FolderOpen size={14} />
                            {activeProjectName ?? "Events"}
                            <span style={{ background: isEventActive ? "rgba(255,255,255,0.25)" : "#f3f4f6", borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 900, color: isEventActive ? "#fff" : textMuted }}>
                              {activeProjectId
                                ? orders.filter((o) => o.project_id === activeProjectId).length
                                : orders.filter((o) => !o.school_id).length}
                            </span>
                            <ChevronDown size={13} />
                          </button>

                          {eventDropdownOpen && (
                            <div style={{
                              position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 30,
                              background: "#fff", border: `1px solid ${borderColor}`, borderRadius: 16,
                              boxShadow: "0 16px 40px rgba(0,0,0,0.13)", width: 300,
                            }}>
                              {/* Search */}
                              <div style={{ padding: "10px 12px", borderBottom: `1px solid ${borderColor}` }}>
                                <input
                                  type="text"
                                  value={eventSearch}
                                  onChange={(e) => setEventSearch(e.target.value)}
                                  placeholder="Search events…"
                                  autoFocus
                                  style={{ width: "100%", border: `1px solid ${borderColor}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, outline: "none", boxSizing: "border-box", color: textPrimary }}
                                />
                              </div>
                              <div style={{ maxHeight: 280, overflowY: "auto" }}>
                                {/* All Events option */}
                                {"All Event Orders".toLowerCase().includes(eventSearch.toLowerCase()) && (
                                  <button
                                    type="button"
                                    onClick={() => { setSchoolFilter("event"); setEventDropdownOpen(false); setEventSearch(""); }}
                                    style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", background: schoolFilter === "event" ? "#fff5f5" : "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: schoolFilter === "event" ? 800 : 500, color: schoolFilter === "event" ? "#cc0000" : textPrimary, textAlign: "left" }}
                                  >
                                    <span>All Event Orders</span>
                                    <span style={{ fontSize: 11, background: "#f3f4f6", borderRadius: 999, padding: "1px 8px", color: textMuted }}>{orders.filter((o) => !o.school_id).length}</span>
                                  </button>
                                )}
                                {/* Individual event projects */}
                                {eventProjects
                                  .filter((p) => {
                                    const label = [p.title, p.client_name].filter(Boolean).join(" ");
                                    return label.toLowerCase().includes(eventSearch.toLowerCase());
                                  })
                                  .map((proj) => {
                                    const isSelected = schoolFilter === `event:${proj.id}`;
                                    const orderCount = orders.filter((o) => o.project_id === proj.id).length;
                                    return (
                                      <button
                                        key={proj.id}
                                        type="button"
                                        onClick={() => { setSchoolFilter(`event:${proj.id}`); setEventDropdownOpen(false); setEventSearch(""); }}
                                        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", background: isSelected ? "#fff5f5" : "#fff", border: "none", borderTop: `1px solid #f5f5f5`, cursor: "pointer", fontSize: 13, fontWeight: isSelected ? 800 : 500, color: isSelected ? "#cc0000" : textPrimary, textAlign: "left", gap: 8 }}
                                      >
                                        <div style={{ minWidth: 0 }}>
                                          <div style={{ fontWeight: isSelected ? 800 : 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proj.title}</div>
                                          {proj.client_name && <div style={{ fontSize: 11, color: textMuted, marginTop: 1 }}>{proj.client_name}</div>}
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                                          <span style={{ fontSize: 11, background: "#f3f4f6", borderRadius: 999, padding: "1px 8px", color: textMuted }}>{orderCount}</span>
                                          {proj.portal_status === "active" && <span style={{ fontSize: 10, background: "#f0fdf4", color: "#16a34a", borderRadius: 999, padding: "1px 7px", fontWeight: 700 }}>Live</span>}
                                        </div>
                                      </button>
                                    );
                                  })}
                                {eventProjects.filter((p) => [p.title, p.client_name].filter(Boolean).join(" ").toLowerCase().includes(eventSearch.toLowerCase())).length === 0 &&
                                  !("All Event Orders".toLowerCase().includes(eventSearch.toLowerCase())) && (
                                  <div style={{ padding: "12px 14px", fontSize: 13, color: textMuted }}>No events match "{eventSearch}"</div>
                                )}
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* Clear filter */}
                {schoolFilter && (
                  <button
                    type="button"
                    onClick={() => setSchoolFilter(null)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: textMuted, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, padding: "10px 4px" }}
                  >
                    <X size={14} /> Clear filter
                  </button>
                )}
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

            {/* Select-all bar */}
            {combinedRows.length > 0 && !loading && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <button
                  type="button"
                  onClick={() => toggleSelectAll(combinedRows)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "transparent", border: "none", cursor: "pointer", color: textMuted, fontSize: 13, fontWeight: 700, padding: "4px 0" }}
                >
                  {selectedKeys.size === combinedRows.length ? <CheckSquare size={16} color="#cc0000" /> : <Square size={16} />}
                  {selectedKeys.size === combinedRows.length ? "Deselect all" : `Select all (${combinedRows.length})`}
                </button>
                {selectedKeys.size > 0 && (
                  <span style={{ fontSize: 13, color: "#cc0000", fontWeight: 800 }}>{selectedKeys.size} selected</span>
                )}
              </div>
            )}

            {loading ? (
              <div style={{ color: textMuted, fontSize: 14 }}>Loading orders…</div>
            ) : combinedRows.length === 0 ? (
              <div style={{ background: cardBg, border: `2px dashed ${borderColor}`, borderRadius: 24, padding: "64px 24px", textAlign: "center" }}>
                <ShoppingBag size={42} color="#cbd5e1" style={{ margin: "0 auto 12px" }} />
                <div style={{ fontSize: 18, fontWeight: 900, color: textPrimary }}>No orders here yet</div>
                <div style={{ fontSize: 14, color: textMuted, marginTop: 6 }}>Orders placed by parents will appear in this lab-ready workflow.</div>
              </div>

            /* ── GRID VIEW ─────────────────────────────────────── */
            ) : viewMode === "grid" ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 14 }}>
                {combinedRows.map((group) => {
                  const order = group.representative;
                  const cfg = STATUS_COLORS[group.combinedStatus] ?? STATUS_COLORS.new;
                  const primaryUrl = group.imageUrls[0] ?? order.student?.photo_url ?? "";
                  const isSelected = selectedKeys.has(group.key);
                  const currency = order.currency?.toUpperCase() || "CAD";
                  return (
                    <div
                      key={group.key}
                      style={{ background: cardBg, border: isSelected ? "2px solid #cc0000" : `1px solid ${borderColor}`, borderRadius: 18, overflow: "hidden", boxShadow: isSelected ? "0 0 0 3px rgba(204,0,0,0.1)" : "0 4px 12px rgba(15,23,42,0.05)", cursor: "pointer", transition: "border-color 0.15s" }}
                      onClick={() => openOrder(order)}
                    >
                      <div style={{ position: "relative" }}>
                        <div style={{ width: "100%", aspectRatio: "3/4", background: "#f3f4f6", overflow: "hidden" }}>
                          {clean(primaryUrl)
                            ? <img src={primaryUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#d1d5db" }}><Users size={28} /></div>}
                        </div>
                        {/* Checkbox */}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggleSelect(group.key); }}
                          style={{ position: "absolute", top: 8, left: 8, background: isSelected ? "#cc0000" : "rgba(255,255,255,0.9)", border: isSelected ? "2px solid #cc0000" : "2px solid #e5e7eb", borderRadius: 6, width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}
                        >
                          {isSelected && <Check size={13} color="#fff" strokeWidth={3} />}
                        </button>
                        {/* Status badge */}
                        <div style={{ position: "absolute", top: 8, right: 8, background: cfg.bg, color: cfg.color, fontSize: 10, fontWeight: 900, borderRadius: 999, padding: "3px 7px" }}>{cfg.label}</div>
                        {group.isAnyNew && <div style={{ position: "absolute", bottom: 8, left: 8, background: "#ef4444", color: "#fff", fontSize: 10, fontWeight: 900, borderRadius: 999, padding: "3px 7px" }}>NEW</div>}
                      </div>
                      <div style={{ padding: "10px 12px" }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {`${order.student?.first_name ?? "Student"} ${order.student?.last_name ?? ""}`.trim()}
                        </div>
                        <div style={{ fontSize: 11, color: textMuted, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{order.school?.school_name ?? "Event"}</div>
                        <div style={{ fontSize: 13, fontWeight: 900, color: textPrimary, marginTop: 6 }}>{moneyFromCents(group.totalCents, currency)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

            /* ── TABLE VIEW ────────────────────────────────────── */
            ) : viewMode === "table" ? (
              <div style={{ background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 20, overflow: "hidden" }}>
                {/* Table header */}
                <div style={{ display: "grid", gridTemplateColumns: "36px 56px 1fr 1fr 1fr 90px 100px 36px", gap: 0, background: "#f9fafb", borderBottom: `1px solid ${borderColor}`, padding: "10px 14px", fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase", color: textMuted }}>
                  <div><button type="button" onClick={() => toggleSelectAll(combinedRows)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: textMuted, display: "flex" }}>{selectedKeys.size === combinedRows.length ? <CheckSquare size={14} color="#cc0000" /> : <Square size={14} />}</button></div>
                  <div>Photo</div>
                  <div>Student</div>
                  <div>School / Event</div>
                  <div>Package</div>
                  <div>Total</div>
                  <div>Status</div>
                  <div />
                </div>
                {combinedRows.map((group, idx) => {
                  const order = group.representative;
                  const cfg = STATUS_COLORS[group.combinedStatus] ?? STATUS_COLORS.new;
                  const primaryUrl = group.imageUrls[0] ?? order.student?.photo_url ?? "";
                  const isSelected = selectedKeys.has(group.key);
                  const currency = order.currency?.toUpperCase() || "CAD";
                  return (
                    <div
                      key={group.key}
                      style={{ display: "grid", gridTemplateColumns: "36px 56px 1fr 1fr 1fr 90px 100px 36px", gap: 0, alignItems: "center", padding: "10px 14px", borderTop: idx === 0 ? "none" : `1px solid #f5f5f5`, background: isSelected ? "#fff9f9" : "#fff", cursor: "pointer" }}
                      onClick={() => openOrder(order)}
                    >
                      <div onClick={(e) => e.stopPropagation()}>
                        <button type="button" onClick={() => toggleSelect(group.key)} style={{ background: isSelected ? "#cc0000" : "transparent", border: isSelected ? "2px solid #cc0000" : "2px solid #e5e7eb", borderRadius: 5, width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}>
                          {isSelected && <Check size={11} color="#fff" strokeWidth={3} />}
                        </button>
                      </div>
                      <div>
                        <div style={{ width: 40, height: 52, borderRadius: 8, overflow: "hidden", background: "#f3f4f6", border: `1px solid ${borderColor}` }}>
                          {clean(primaryUrl) ? <img src={primaryUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#d1d5db" }}><Users size={14} /></div>}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: textPrimary }}>{`${order.student?.first_name ?? "Student"} ${order.student?.last_name ?? ""}`.trim()}</div>
                        <div style={{ fontSize: 12, color: textMuted, marginTop: 2 }}>{formatDate(order.created_at)}</div>
                      </div>
                      <div style={{ fontSize: 13, color: textMuted }}>{order.school?.school_name ?? "Event"}</div>
                      <div style={{ fontSize: 13, color: textPrimary, fontWeight: 600 }}>{group.packageSummary}</div>
                      <div style={{ fontSize: 14, fontWeight: 900, color: textPrimary }}>{moneyFromCents(group.totalCents, currency)}</div>
                      <div><span style={{ background: cfg.bg, color: cfg.color, fontSize: 11, fontWeight: 800, borderRadius: 999, padding: "4px 9px" }}>{cfg.label}</span></div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <button type="button" onClick={() => openOrder(order)} style={{ background: "none", border: "none", cursor: "pointer", color: textMuted, display: "flex", padding: 4 }}><ChevronRight size={16} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>

            /* ── LIST VIEW (default) ────────────────────────────── */
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
                  const isSelected = selectedKeys.has(group.key);
                  return (
                    <div
                      key={group.key}
                      onClick={() => openOrder(order)}
                      style={{
                        background: cardBg,
                        border: isSelected ? "2px solid #cc0000" : isNew ? "2px solid #ef4444" : `1px solid ${borderColor}`,
                        borderRadius: 24,
                        padding: 18,
                        boxShadow: isSelected ? "0 0 0 4px rgba(204,0,0,0.08)" : isNew ? "0 0 0 4px rgba(239,68,68,0.08)" : "0 10px 24px rgba(15,23,42,0.04)",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", gap: 16, alignItems: "stretch" }}>
                        {/* Checkbox */}
                        <div style={{ display: "flex", alignItems: "flex-start", paddingTop: 4 }} onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => toggleSelect(group.key)}
                            style={{ background: isSelected ? "#cc0000" : "transparent", border: isSelected ? "2px solid #cc0000" : "2px solid #d1d5db", borderRadius: 7, width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, padding: 0 }}
                          >
                            {isSelected && <Check size={13} color="#fff" strokeWidth={3} />}
                          </button>
                        </div>
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
                              <FolderOpen size={16} /> {downloadingId === group.key ? "Downloading…" : "Download ZIP"}
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
                  <FolderOpen size={16} /> {downloadingId === selected.id ? "Downloading…" : "Download ZIP"}
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

      {/* ── Bulk action bar ───────────────────────────────────────────────── */}
      {selectedKeys.size > 0 && (
        <div style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", zIndex: 90, background: "#111827", borderRadius: 20, padding: "14px 20px", display: "flex", alignItems: "center", gap: 16, boxShadow: "0 20px 50px rgba(0,0,0,0.3)", minWidth: 340 }}>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 14 }}>
            {selectedKeys.size} order{selectedKeys.size === 1 ? "" : "s"} selected
          </div>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => setSelectedKeys(new Set())}
            style={{ background: "transparent", color: "#9ca3af", border: "1px solid #374151", borderRadius: 10, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
          >
            Deselect
          </button>
          <button
            type="button"
            onClick={() => setBulkDeleteConfirm(true)}
            style={{ background: "#cc0000", color: "#fff", border: "none", borderRadius: 10, padding: "8px 16px", fontSize: 13, fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            <Trash2 size={14} /> Delete {selectedKeys.size}
          </button>
        </div>
      )}

      {/* ── Bulk delete confirmation ──────────────────────────────────────── */}
      {bulkDeleteConfirm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "#fff", borderRadius: 24, width: "100%", maxWidth: 420, padding: 28, boxShadow: "0 24px 60px rgba(0,0,0,0.25)" }}>
            <div style={{ width: 48, height: 48, borderRadius: 16, background: "#fff0f0", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
              <Trash2 size={22} color="#cc0000" />
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: textPrimary, marginBottom: 8 }}>Delete {selectedKeys.size} order{selectedKeys.size === 1 ? "" : "s"}?</div>
            <div style={{ fontSize: 14, color: textMuted, lineHeight: 1.6, marginBottom: 24 }}>
              This will permanently delete the selected orders and all their items. This cannot be undone.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={() => bulkDelete(combinedRows)}
                disabled={bulkDeleting}
                style={{ flex: 1, background: "#cc0000", color: "#fff", border: "none", borderRadius: 12, padding: "12px 16px", fontWeight: 800, fontSize: 14, cursor: bulkDeleting ? "default" : "pointer", opacity: bulkDeleting ? 0.7 : 1 }}
              >
                {bulkDeleting
                  ? `Deleting ${bulkDeleteProgress.done} / ${bulkDeleteProgress.total}…`
                  : `Delete ${selectedKeys.size} permanently`}
              </button>
              <button
                type="button"
                onClick={() => setBulkDeleteConfirm(false)}
                style={{ flex: 1, background: "#fff", color: textPrimary, border: `1px solid ${borderColor}`, borderRadius: 12, padding: "12px 16px", fontWeight: 800, fontSize: 14, cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

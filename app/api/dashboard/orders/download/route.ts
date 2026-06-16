import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import {
  cartSnapshotToOrderItems,
  cleanOrderCustomerNote,
  type CartSnapshotBackdropLike,
  isWebImageUrl,
  parsePackageSlotLabel,
  parseOrderPhotoSelections,
  resolveOrderSubtotalCents,
  resolveOrderTotalCents,
} from "@/lib/order-display";
import { r2KeyFromAnyUrl, r2PresignedGetUrl } from "@/lib/r2-signed-urls";
import {
  backdropCompositeFileName,
  composeBackdropImage,
  hasBackdropCompositeSelection,
  type BackdropCompositeSelection,
} from "@/lib/backdrop-composites";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // allow up to 2 minutes for large downloads

/* ────────────────────────────────────────────────────────────────────────────
 *  Tiny ZIP builder – pure JS, no dependencies.
 *  Produces a valid ZIP file (store method, no compression – keeps it simple
 *  and fast since photos are already compressed JPEGs).
 * ──────────────────────────────────────────────────────────────────────────── */

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

type ZipEntry = { name: string; data: Uint8Array };

function buildZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const centralDir: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    // Local file header
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lh = new DataView(localHeader.buffer);
    lh.setUint32(0, 0x04034b50, true); // signature
    lh.setUint16(4, 20, true); // version needed
    lh.setUint16(6, 0, true); // flags
    lh.setUint16(8, 0, true); // compression: store
    lh.setUint16(10, 0, true); // mod time
    lh.setUint16(12, 0, true); // mod date
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true); // compressed size
    lh.setUint32(22, size, true); // uncompressed size
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true); // extra length
    localHeader.set(nameBytes, 30);

    parts.push(localHeader, entry.data);

    // Central directory entry
    const cdEntry = new Uint8Array(46 + nameBytes.length);
    const cd = new DataView(cdEntry.buffer);
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true); // version made by
    cd.setUint16(6, 20, true); // version needed
    cd.setUint16(8, 0, true);
    cd.setUint16(10, 0, true); // store
    cd.setUint16(12, 0, true);
    cd.setUint16(14, 0, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint16(30, 0, true);
    cd.setUint16(32, 0, true);
    cd.setUint16(34, 0, true);
    cd.setUint16(36, 0, true);
    cd.setUint32(38, 0, true);
    cd.setUint32(42, offset, true); // local header offset
    cdEntry.set(nameBytes, 46);
    centralDir.push(cdEntry);

    offset += localHeader.length + entry.data.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const cd of centralDir) cdSize += cd.length;

  // End of central directory
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdOffset, true);
  ev.setUint16(20, 0, true);

  const allParts = [...parts, ...centralDir, eocd];
  let totalLen = 0;
  for (const p of allParts) totalLen += p.length;
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of allParts) {
    result.set(p, pos);
    pos += p.length;
  }
  return result;
}

/* ────────────────────────────────────────────────────────────────────────────
 *  Order summary PDF-like HTML content (embedded in the ZIP)
 * ──────────────────────────────────────────────────────────────────────────── */

function clean(v: string | null | undefined) {
  return (v ?? "").trim();
}

function slug(v: string | null | undefined, fallback: string) {
  const s = clean(v);
  return s ? s.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "") : fallback;
}

/** Parse structured order info from special_notes text when order_items table is empty */
function parseNotesItems(notes: string): { productName: string; photoUrl: string; quantity: number }[] {
  if (!notes) return [];
  return parseOrderPhotoSelections(notes).map((entry) => ({
    productName: entry.label || "Item",
    photoUrl: entry.url,
    quantity: 1,
  }));
}

function fileNameFromUrl(url: string, fallback: string) {
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split("/");
    return parts[parts.length - 1] || fallback;
  } catch {
    const parts = url.split("?")[0].split("/");
    return parts[parts.length - 1] || fallback;
  }
}

type StudioBranding = {
  businessName: string;
  email: string;
  phone: string;
  website: string;
};

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Encode a URL for use in HTML src attributes — handles spaces in paths */
function encodePhotoUrl(url: string): string {
  try {
    const u = new URL(url);
    // Re-encode the pathname to handle spaces, keep the rest
    u.pathname = u.pathname.split("/").map(seg => encodeURIComponent(decodeURIComponent(seg))).join("/");
    return u.toString();
  } catch {
    // Fallback: just encode spaces
    return url.replace(/ /g, "%20");
  }
}

function downloadPhotoUrl(url: string): string {
  const raw = clean(url);
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    if (/\.r2\.dev$/i.test(parsed.host)) {
      const key = r2KeyFromAnyUrl(raw);
      const signed = key ? r2PresignedGetUrl(key, 60 * 60) : "";
      return signed || encodePhotoUrl(raw);
    }
    if (/\.r2\.cloudflarestorage\.com$/i.test(parsed.host) || parsed.pathname.startsWith("/api/r2/img/")) {
      const key = r2KeyFromAnyUrl(raw);
      const signed = key ? r2PresignedGetUrl(key, 60 * 60) : "";
      return signed || encodePhotoUrl(raw);
    }
  } catch {
    return "";
  }

  return encodePhotoUrl(raw);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "numeric", day: "numeric" });
}

function shortOrderId(id: string) {
  return id.replace(/-/g, "").slice(0, 6).toUpperCase();
}

function moneyFromCents(cents: number | null | undefined, currency = "CAD") {
  const amount = (Number(cents ?? 0) || 0) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount);
}

function taxLabelForOrder(order: { subtotal_cents?: number | null; tax_cents?: number | null; currency?: string | null }) {
  const subtotal = Number(order.subtotal_cents ?? 0);
  const tax = Number(order.tax_cents ?? 0);
  const rate = subtotal > 0 && tax > 0 ? (tax / subtotal) * 100 : 0;
  const rounded = rate > 0 ? Math.round(rate * 10) / 10 : 0;
  const isCad = clean(order.currency).toLowerCase() === "cad";
  const label = isCad && rounded >= 12.5 && rounded <= 13.5 ? "HST" : "Tax";
  return rounded > 0 ? `${label} (${rounded.toFixed(rounded % 1 === 0 ? 0 : 1)}%)` : label;
}

function isBackdropOrderItem(item: { product_name?: string | null }) {
  const name = clean(item.product_name).toLowerCase();
  return name.startsWith("★") || name.includes("premium backdrop") || name.includes("backdrop:");
}

function financialLineAmountCents(item: {
  quantity?: number | null;
  price?: number | null;
  unit_price_cents?: number | null;
  line_total_cents?: number | null;
}) {
  const line = Number(item.line_total_cents);
  if (Number.isFinite(line) && line !== 0) return Math.round(line);
  const qty = itemQuantity(item.quantity);
  const unit = Number(item.unit_price_cents);
  if (Number.isFinite(unit) && unit !== 0) return Math.round(unit * qty);
  const price = Number(item.price);
  if (Number.isFinite(price) && price !== 0) return Math.round(price * 100 * qty);
  return 0;
}

function cartSnapshotEntries(snapshot: unknown) {
  return Array.isArray(snapshot) ? snapshot as Array<Record<string, unknown>> : [];
}

function snapshotEntryImageUrls(entry: Record<string, unknown>) {
  const urls: string[] = [];
  const slots = Array.isArray(entry.slots) ? entry.slots as Array<Record<string, unknown>> : [];
  for (const slot of slots) {
    const url = clean(slot.assignedImageUrl as string);
    if (url) urls.push(url);
  }
  const selections = Array.isArray(entry.digitalSelections) ? entry.digitalSelections as Array<Record<string, unknown>> : [];
  for (const selection of selections) {
    const url = clean(selection.url as string) || clean(selection.thumbnailUrl as string);
    if (url) urls.push(url);
  }
  const selectedUrl = clean(entry.selectedImageUrl as string);
  if (selectedUrl && urls.length === 0) urls.push(selectedUrl);
  return urls;
}

function snapshotEntrySlotLabels(entry: Record<string, unknown>) {
  const slots = Array.isArray(entry.slots) ? entry.slots as Array<Record<string, unknown>> : [];
  return slots.map((slot) => clean(slot.label as string)).filter(Boolean);
}

function shortPrintLabel(label: string) {
  return clean(label)
    .replace(/\s+Lustre$/i, "")
    .replace(/\s+Glossy$/i, "")
    .replace(/\s+Matte$/i, "");
}

function packageLabelFromSlotLabels(labels: string[]) {
  if (labels.length === 0) return "Package";
  if (labels.length === 1) return parsePackageSlotLabel(labels[0]).baseLabel || labels[0];

  const counts = new Map<string, number>();
  for (const label of labels) {
    const parsed = parsePackageSlotLabel(label);
    const base = shortPrintLabel(parsed.baseLabel || label);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => `${count}-${label}`)
    .join(" + ");
}

function orderPaymentBreakdownLines(order: {
  id: string;
  package_name?: string | null;
  subtotal_cents?: number | null;
  cart_snapshot?: unknown;
  items?: Array<{
    id?: string | null;
    product_name?: string | null;
    quantity?: number | null;
    price?: number | null;
    unit_price_cents?: number | null;
    line_total_cents?: number | null;
    sku?: string | null;
  }> | null;
}) {
  const items = order.items ?? [];
  const usedItemIds = new Set<string>();
  const lines: Array<{ key: string; label: string; detail: string; cents: number }> = [];

  cartSnapshotEntries(order.cart_snapshot).forEach((entry, entryIndex) => {
    const urls = snapshotEntryImageUrls(entry);
    const matchedItems: typeof items = [];
    for (const url of urls) {
      const match = items.find((item) =>
        !usedItemIds.has(item.id ?? "") &&
        !isBackdropOrderItem(item) &&
        clean(item.sku) === url
      );
      if (match) {
        if (match.id) usedItemIds.add(match.id);
        matchedItems.push(match);
      }
    }

    const label =
      clean(entry.packageName as string) ||
      packageLabelFromSlotLabels(snapshotEntrySlotLabels(entry)) ||
      `Package ${entryIndex + 1}`;
    const cents = matchedItems.reduce((sum, item) => sum + financialLineAmountCents(item), 0);
    if (cents > 0 || matchedItems.length > 0) {
      lines.push({
        key: `${order.id}-snapshot-payment-${entryIndex}`,
        label,
        detail: matchedItems.length > 0
          ? `${matchedItems.length} photo${matchedItems.length === 1 ? "" : "s"}`
          : "Package",
        cents,
      });
    }
  });

  for (const item of items) {
    if (item.id && usedItemIds.has(item.id)) continue;
    if (isBackdropOrderItem(item)) {
      lines.push({
        key: item.id ?? `${order.id}-backdrop-payment`,
        label: "Premium Backdrop",
        detail: clean(item.product_name).replace(/^★\s*/, ""),
        cents: financialLineAmountCents(item),
      });
      continue;
    }
    if (lines.length === 0 || financialLineAmountCents(item) > 0) {
      lines.push({
        key: item.id ?? `${order.id}-${item.product_name}`,
        label: parsePackageSlotLabel(item.product_name).baseLabel || clean(item.product_name) || "Item",
        detail: `Qty ${itemQuantity(item.quantity)}`,
        cents: financialLineAmountCents(item),
      });
    }
  }

  if (lines.length > 0) return lines;
  return [{
    key: `${order.id}-package`,
    label: order.package_name || "Package",
    detail: "Package",
    cents: resolveOrderSubtotalCents(order, items),
  }];
}

/** Resolve display items for an order (from DB items, parsed notes, or student photo) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OrderDisplayItem = {
  productName: string;
  photoUrl: string;
  quantity: number;
  backdrop?: CartSnapshotBackdropLike | null;
  orientation?: "portrait" | "landscape";
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveOrderDisplayItems(order: any): OrderDisplayItem[] {
  const dbItems = order.items ?? [];
  const snapshotItems = cartSnapshotToOrderItems(order.cart_snapshot);
  const notesText = clean(order.special_notes) || clean(order.notes);
  const parsedFromNotes = parseNotesItems(notesText);
  const imageDbItems = dbItems.filter((item: { sku?: string }) => isWebImageUrl(item.sku));
  const snapshotHasBackdrop = snapshotItems.some((item) => item.backdrop);
  const sourceItems = snapshotHasBackdrop || snapshotItems.length > imageDbItems.length
    ? snapshotItems
    : dbItems;

  if (sourceItems.length > 0) {
    return sourceItems.map((item: { product_name?: string; quantity?: number; sku?: string; backdrop?: CartSnapshotBackdropLike | null; orientation?: "portrait" | "landscape" }, index: number) => ({
      productName: item.product_name ?? parsedFromNotes[index]?.productName ?? "Item",
      photoUrl: isWebImageUrl(item.sku) ? (item.sku ?? "") : (parsedFromNotes[index]?.photoUrl ?? ""),
      quantity: item.quantity ?? 1,
      backdrop: item.backdrop ?? null,
      orientation: item.orientation ?? "portrait",
    }));
  }
  if (parsedFromNotes.length > 0) return parsedFromNotes;
  if (clean(order.student?.photo_url)) {
    return [{ productName: order.package_name ?? "Package", photoUrl: order.student.photo_url, quantity: 1 }];
  }
  return [];
}

async function resolveBackdropForDownload(
  service: { from: (table: string) => any },
  photographerId: string,
  backdrop: BackdropCompositeSelection | null | undefined,
) {
  if (!backdrop) return null;
  if (hasBackdropCompositeSelection(backdrop)) return backdrop;
  const id = clean(backdrop.id);
  if (!id) return backdrop;
  const { data, error } = await service
    .from("backdrop_catalog")
    .select("id,name,image_url,tier,price_cents")
    .eq("photographer_id", photographerId)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return backdrop;
  return {
    ...backdrop,
    id: clean((data as Record<string, unknown>).id as string),
    name: clean((data as Record<string, unknown>).name as string),
    image_url: clean((data as Record<string, unknown>).image_url as string),
    tier: clean((data as Record<string, unknown>).tier as string),
    price_cents: Number((data as Record<string, unknown>).price_cents ?? 0) || 0,
  };
}

function itemQuantity(value: number | null | undefined) {
  const qty = Number(value ?? 1);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
}

/**
 * Build the order summary HTML.
 * photoFileMap maps original photo URLs → local filenames in the ZIP
 * so the HTML references local files that work when extracted.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildOrderSummaryHtml(order: any, branding: StudioBranding, photoFileMap: Map<string, string>): string {
  const studentName = `${clean(order.student?.first_name)} ${clean(order.student?.last_name)}`.trim() || "Student";
  const schoolName = order.school?.school_name ?? "—";
  const className = order.class?.class_name || order.student?.class_name || "";
  const parentName = order.parent_name ?? order.customer_name ?? "—";
  const parentEmail = order.parent_email ?? order.customer_email ?? "—";
  const parentPhone = order.parent_phone ?? "";
  const orderDate = formatDate(order.created_at);
  const orderId = shortOrderId(order.id);
  const status = (order.status ?? "new").toUpperCase().replace(/_/g, " ");
  const rawNotes = clean(order.special_notes) || clean(order.notes);
  const cleanedNotes = cleanOrderCustomerNote(rawNotes);
  const currency = clean(order.currency).toUpperCase() || "CAD";
  const subtotalCents = resolveOrderSubtotalCents(order, order.items);
  const taxCents = Number(order.tax_cents ?? 0) || 0;
  const totalCents = resolveOrderTotalCents(order, order.items);

  const displayItems = resolveOrderDisplayItems(order);
  const paymentLines = orderPaymentBreakdownLines(order);

  // Build photo cards — reference local files from the ZIP
  let photoCardsHtml = "";
  displayItems.forEach((item: { productName: string; photoUrl: string; quantity: number; backdrop?: CartSnapshotBackdropLike | null }, i: number) => {
    // Look up local filename; fall back to encoded remote URL
    const localFile = photoFileMap.get(item.photoUrl) ?? "";
    const imgSrc = localFile || (item.photoUrl ? encodePhotoUrl(item.photoUrl) : "");
    const parsedLabel = parsePackageSlotLabel(item.productName);
    const productName = parsedLabel.baseLabel || item.productName;
    const slotLabel =
      parsedLabel.slotIndex != null && parsedLabel.slotTotal != null
        ? `Package slot ${parsedLabel.slotIndex} of ${parsedLabel.slotTotal}`
        : "";
    const poseFile = localFile || (item.photoUrl ? fileNameFromUrl(item.photoUrl, `photo-${i + 1}.jpg`) : "");
    photoCardsHtml += `
      <div style="display:inline-block;vertical-align:top;margin:0 24px 24px 0;text-align:center;width:200px;">
        ${imgSrc ? `<img src="${esc(imgSrc)}" style="width:190px;height:230px;object-fit:cover;border-radius:4px;border:1px solid #ddd;background:#f5f5f5;" />` : `<div style="width:190px;height:230px;background:#f5f5f5;border-radius:4px;border:1px solid #ddd;display:flex;align-items:center;justify-content:center;color:#999;font-size:13px;">No photo</div>`}
        <div style="margin-top:8px;font-size:14px;font-weight:700;color:#111;">Pose ${i + 1}</div>
        <div style="font-size:13px;font-weight:600;color:#333;line-height:1.35;">${esc(productName)}</div>
        ${item.backdrop ? `<div style="font-size:12px;color:#111;font-weight:800;">Backdrop applied · print-ready</div>` : ""}
        ${slotLabel ? `<div style="font-size:12px;color:#0f766e;font-weight:700;">${esc(slotLabel)}</div>` : ""}
        ${poseFile ? `<div style="font-size:11px;color:#777;word-break:break-word;">${esc(poseFile)}</div>` : ""}
        <div style="font-size:13px;color:#555;">Qty ${itemQuantity(item.quantity)}</div>
      </div>`;
  });

  const itemRowsHtml = displayItems.map((item, index) => {
    const parsedLabel = parsePackageSlotLabel(item.productName);
    const productName = parsedLabel.baseLabel || item.productName;
    const slotLabel =
      parsedLabel.slotIndex != null && parsedLabel.slotTotal != null
        ? `Package slot ${parsedLabel.slotIndex} of ${parsedLabel.slotTotal}`
        : "—";
    const localFile = photoFileMap.get(item.photoUrl) ?? "";
    const poseFile = localFile || (item.photoUrl ? fileNameFromUrl(item.photoUrl, `photo-${index + 1}.jpg`) : "—");
    return `<tr>
      <td>${esc(productName)}</td>
      <td>${itemQuantity(item.quantity)}</td>
      <td>${esc(slotLabel)}</td>
      <td>Pose ${index + 1}</td>
      <td>${esc(poseFile)}${item.backdrop ? " · backdrop applied" : ""}</td>
    </tr>`;
  }).join("");

  const financialRowsHtml = paymentLines.map((line) => {
    return `<tr>
      <td style="padding:7px 0;color:#111;font-weight:700;">${esc(line.label)}<div style="font-size:11px;color:#777;font-weight:500;">${esc(line.detail)}</div></td>
      <td style="padding:7px 0;text-align:right;color:#111;font-weight:800;">${esc(moneyFromCents(line.cents, currency))}</td>
    </tr>`;
  }).join("");

  // Delivery note
  const deliveryMatch = rawNotes.match(/Delivery:\s*(\w+)/i);
  const delivery = deliveryMatch ? deliveryMatch[1] : "";

  // Status badge color
  const statusColor = status.includes("PAID") || status === "COMPLETED" ? "#111"
    : status.includes("PENDING") ? "#c0392b"
    : "#555";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Order #${orderId} — ${esc(studentName)}</title>
<style>
  @media print { body { margin: 0; } }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #fff; color: #111; max-width: 900px; }
</style>
</head>
<body>
  <!-- Header -->
  <div style="background:#111;color:#fff;padding:28px 36px;display:flex;justify-content:space-between;align-items:flex-start;">
    <div>
      <div style="font-size:14px;color:#999;font-weight:700;">${esc(schoolName)}</div>
      <div style="font-size:34px;font-weight:800;margin-top:4px;letter-spacing:-0.01em;">${esc(studentName)}</div>
      ${className ? `<div style="font-size:16px;font-weight:600;color:#ccc;margin-top:4px;">Class: ${esc(className)}</div>` : ""}
    </div>
    <div style="text-align:right;">
      <div style="font-size:22px;font-weight:900;color:#fff;letter-spacing:0.02em;">${esc(branding.businessName)}</div>
      <div style="font-size:12px;color:#888;margin-top:8px;line-height:1.7;">
        ${branding.phone ? `${esc(branding.phone)}<br/>` : ""}
        ${branding.email ? `${esc(branding.email)}<br/>` : ""}
        ${branding.website ? esc(branding.website) : ""}
      </div>
    </div>
  </div>

  <!-- Order info bar -->
  <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 36px;background:#f5f5f5;border-bottom:1px solid #e0e0e0;">
    <span style="font-size:13px;color:#555;">Order #${orderId} &middot; ${orderDate}</span>
    <span style="display:inline-block;padding:4px 16px;background:${statusColor};color:#fff;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.05em;">${esc(status)}</span>
  </div>

  <!-- Photo cards -->
  <div style="padding:28px 36px;">
    ${photoCardsHtml || '<div style="color:#999;font-size:14px;">No photos in this order.</div>'}
  </div>

  <!-- Production breakdown -->
  <div style="margin:0 36px 24px;border:1px solid #e0e0e0;border-radius:10px;overflow:hidden;">
    <div style="padding:10px 14px;background:#f8fafc;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#555;font-weight:800;">Package / Pose Breakdown</div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead>
        <tr style="background:#fff;">
          <th style="text-align:left;padding:9px 12px;border-top:1px solid #e0e0e0;border-bottom:1px solid #e0e0e0;">Item</th>
          <th style="text-align:left;padding:9px 12px;border-top:1px solid #e0e0e0;border-bottom:1px solid #e0e0e0;">Qty</th>
          <th style="text-align:left;padding:9px 12px;border-top:1px solid #e0e0e0;border-bottom:1px solid #e0e0e0;">Package slot</th>
          <th style="text-align:left;padding:9px 12px;border-top:1px solid #e0e0e0;border-bottom:1px solid #e0e0e0;">Pose</th>
          <th style="text-align:left;padding:9px 12px;border-top:1px solid #e0e0e0;border-bottom:1px solid #e0e0e0;">File</th>
        </tr>
      </thead>
      <tbody>${itemRowsHtml || '<tr><td colspan="5" style="padding:12px;color:#999;">No item rows found.</td></tr>'}</tbody>
    </table>
  </div>

  <!-- Payment breakdown -->
  <div style="margin:0 36px 24px;border:1px solid #e0e0e0;border-radius:10px;overflow:hidden;">
    <div style="padding:10px 14px;background:#f8fafc;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#555;font-weight:800;">Payment Breakdown</div>
    <div style="padding:12px 16px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tbody>
          ${financialRowsHtml || `<tr><td style="padding:7px 0;color:#777;">${esc(order.package_name || "Package")}</td><td style="padding:7px 0;text-align:right;">${moneyFromCents(subtotalCents, currency)}</td></tr>`}
          <tr><td colspan="2" style="border-top:1px solid #e5e7eb;padding-top:8px;"></td></tr>
          <tr>
            <td style="padding:4px 0;color:#555;">Subtotal</td>
            <td style="padding:4px 0;text-align:right;color:#111;font-weight:800;">${moneyFromCents(subtotalCents, currency)}</td>
          </tr>
          ${taxCents > 0 ? `<tr>
            <td style="padding:4px 0;color:#555;">${esc(taxLabelForOrder(order))}</td>
            <td style="padding:4px 0;text-align:right;color:#111;font-weight:800;">${moneyFromCents(taxCents, currency)}</td>
          </tr>` : ""}
          <tr>
            <td style="padding:8px 0 0;color:#111;font-weight:900;font-size:15px;border-top:1px solid #e5e7eb;">Total paid</td>
            <td style="padding:8px 0 0;text-align:right;color:#111;font-weight:900;font-size:15px;border-top:1px solid #e5e7eb;">${moneyFromCents(totalCents, currency)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Customer / Parent info -->
  <div style="padding:16px 36px;border-top:1px solid #e0e0e0;display:flex;gap:48px;flex-wrap:wrap;">
    <div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#999;font-weight:700;margin-bottom:3px;">Parent / Customer</div>
      <div style="font-size:14px;font-weight:600;color:#111;">${esc(parentName)}</div>
      ${parentEmail !== "—" ? `<div style="font-size:12px;color:#555;">${esc(parentEmail)}</div>` : ""}
      ${parentPhone ? `<div style="font-size:12px;color:#555;">${esc(parentPhone)}</div>` : ""}
    </div>
    ${delivery ? `<div>
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#999;font-weight:700;margin-bottom:3px;">Delivery</div>
      <div style="font-size:14px;font-weight:600;color:#111;">${esc(delivery)}</div>
    </div>` : ""}
  </div>

  <!-- Notes (only if there are human-written notes beyond the structured order data) -->
  ${cleanedNotes ? `<div style="margin:0 36px 16px;padding:12px 16px;background:#fafafa;border-left:3px solid #333;border-radius:2px;">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#888;font-weight:700;margin-bottom:6px;">Notes</div>
    <div style="font-size:13px;color:#333;white-space:pre-wrap;line-height:1.5;">${esc(cleanedNotes)}</div>
  </div>` : ""}

  <!-- Footer -->
  <div style="padding:10px 36px;background:#f5f5f5;border-top:1px solid #e0e0e0;text-align:right;">
    <span style="font-size:11px;color:#999;">Studio OS Cloud</span>
  </div>
</body>
</html>`;
}

/* ────────────────────────────────────────────────────────────────────────────
 *  GET /api/dashboard/orders/download?ids=id1,id2,...
 *  Returns a ZIP file with photos + order summary for each order.
 *  If a single order, the folder is flat. If multiple, each order
 *  gets its own subfolder.
 * ──────────────────────────────────────────────────────────────────────────── */

export async function GET(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json({ ok: false, message: "Please sign in again." }, { status: 401 });
    }

    const service = createDashboardServiceClient();

    // Get photographer with branding
    const { data: pgRow } = await service
      .from("photographers")
      .select("id,business_name,billing_email,studio_email")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!pgRow?.id) {
      return NextResponse.json({ ok: false, message: "Photographer not found." }, { status: 404 });
    }

    const branding: StudioBranding = {
      businessName: clean((pgRow as Record<string, unknown>).business_name as string) || "Studio OS",
      email: clean((pgRow as Record<string, unknown>).studio_email as string) || clean((pgRow as Record<string, unknown>).billing_email as string) || "",
      phone: "",
      website: "",
    };

    const ids = (request.nextUrl.searchParams.get("ids") ?? "").split(",").map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      return NextResponse.json({ ok: false, message: "No order IDs provided." }, { status: 400 });
    }

    // Fetch orders
    const { data: ordersRaw, error: ordersErr } = await service
      .from("orders")
      .select(`
        id, created_at, status, parent_name, parent_email, parent_phone,
        customer_name, customer_email,
        package_name, package_price,
        subtotal_cents, tax_cents, total_cents, total_amount, currency,
        special_notes, notes, cart_snapshot, student_id, school_id, class_id, project_id,
        student:students(first_name, last_name, photo_url, folder_name, class_name),
        school:schools(school_name),
        class:classes(class_name),
        project:projects(id, title),
        items:order_items(id, product_name, quantity, price, unit_price_cents, line_total_cents, sku)
      `)
      .eq("photographer_id", pgRow.id)
      .in("id", ids);

    if (ordersErr) throw ordersErr;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orders = (ordersRaw ?? []) as any[];
    if (orders.length === 0) {
      return NextResponse.json({ ok: false, message: "No orders found." }, { status: 404 });
    }

    const multiOrder = orders.length > 1;
    const zipEntries: ZipEntry[] = [];

    for (const order of orders) {
      const studentName = slug(
        `${clean(order.student?.first_name)} ${clean(order.student?.last_name)}`.trim(),
        "Student"
      );
      const schoolName = slug(order.school?.school_name, "School");
      const prefix = multiOrder ? `${schoolName}_${studentName}_${order.id.slice(0, 8)}/` : "";

      const displayItems = resolveOrderDisplayItems(order);
      if (displayItems.length === 0 && clean(order.student?.photo_url)) {
        displayItems.push({
          productName: order.package_name ?? "Package",
          photoUrl: order.student.photo_url,
          quantity: 1,
        });
      }

      // Download photos FIRST, track URL → local filename mapping
      const photoFileMap = new Map<string, string>();
      let photoIndex = 0;
      for (const item of displayItems) {
        const url = item.photoUrl;
        if (!url) continue;
        photoIndex++;
        try {
          const backdrop = await resolveBackdropForDownload(service, pgRow.id, item.backdrop);
          const composite = backdrop
            ? await composeBackdropImage({
                originalUrlOrKey: url,
                backdrop,
                orientation: item.orientation,
              })
            : null;
          const fileName = composite
            ? backdropCompositeFileName(fileNameFromUrl(url, `photo-${photoIndex}.jpg`), backdrop)
            : fileNameFromUrl(url, `photo-${photoIndex}.jpg`);
          let data: Uint8Array | null = composite?.buffer ?? null;
          if (!data) {
            const fetchUrl = downloadPhotoUrl(url);
            if (!fetchUrl) continue;
            const resp = await fetch(fetchUrl);
            if (!resp.ok) {
              console.error(`Failed to download photo ${url}: ${resp.status}`);
              continue;
            }
            data = new Uint8Array(await resp.arrayBuffer());
          }
          zipEntries.push({
            name: `${prefix}${fileName}`,
            data,
          });
          // Map original URL → local filename (relative to HTML in same folder)
          photoFileMap.set(url, multiOrder ? fileName : fileName);
        } catch (err) {
          console.error(`Error downloading photo ${url}:`, err);
        }
      }

      // Now build HTML with local file references
      const summaryHtml = buildOrderSummaryHtml(order, branding, photoFileMap);
      const enc = new TextEncoder();
      zipEntries.push({
        name: `${prefix}order-summary.html`,
        data: enc.encode(summaryHtml),
      });
    }

    if (zipEntries.length === 0) {
      return NextResponse.json({ ok: false, message: "No files to download." }, { status: 404 });
    }

    const zipData = buildZip(zipEntries);

    const zipFileName = multiOrder
      ? `studio-os-orders-${orders.length}.zip`
      : `order-${orders[0].id.slice(0, 8)}-${slug(
          `${clean(orders[0].student?.first_name)} ${clean(orders[0].student?.last_name)}`.trim(),
          "Student"
        )}.zip`;

    return new NextResponse(zipData as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipFileName}"`,
        "Content-Length": String(zipData.length),
      },
    });
  } catch (error) {
    console.error("Order download error:", error);
    return NextResponse.json(
      { ok: false, message: "Download failed." },
      { status: 500 },
    );
  }
}

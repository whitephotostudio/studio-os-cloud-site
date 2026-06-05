/**
 * Build an HTML email to notify the photographer of a new paid order.
 * Design: Studio OS Cloud branded, clean & modern — inspired by ShootProof
 * but elevated with our own palette.
 */

import {
  cleanOrderCustomerNote,
  isPackageComponentItem,
  isWebImageUrl,
  parseOrderPhotoSelections,
  resolveOrderItemDisplayCents,
  resolveOrderSubtotalCents,
  resolveOrderTotalCents,
} from "./order-display";
import { r2KeyFromAnyUrl, r2PresignedGetUrl } from "./r2-signed-urls";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type OrderNotificationOrder = {
  id: string;
  package_name?: string | null;
  total_cents?: number | null;
  total_amount?: number | null;
  subtotal_cents?: number | null;
  tax_cents?: number | null;
  currency?: string | null;
  parent_email?: string | null;
  customer_email?: string | null;
  special_notes?: string | null;
  created_at?: string | null;
  paid_at?: string | null;
  status?: string | null;
};

export type OrderNotificationItem = {
  product_name?: string | null;
  quantity?: number | null;
  unit_price_cents?: number | null;
  line_total_cents?: number | null;
  sku?: string | null;
};

export type OrderNotificationPhotographer = {
  business_name?: string | null;
  studio_email?: string | null;
  billing_email?: string | null;
  logo_url?: string | null;
};

export type OrderNotificationContext = {
  project_title?: string | null;
  school_name?: string | null;
  student_name?: string | null;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function clean(v: string | null | undefined) {
  return (v ?? "").trim();
}

function esc(v: string) {
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatCurrency(cents: number, currency = "cad") {
  const amount = (cents / 100).toFixed(2);
  const sym = currency.toLowerCase() === "usd" ? "US$" : "$";
  return `${sym}${amount}`;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function emailImageUrl(url: string | null | undefined) {
  const raw = clean(url);
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    if (
      /\.r2\.dev$/i.test(parsed.host) ||
      /\.r2\.cloudflarestorage\.com$/i.test(parsed.host) ||
      parsed.pathname.startsWith("/api/r2/img/")
    ) {
      const key = r2KeyFromAnyUrl(raw);
      const signed = key ? r2PresignedGetUrl(key, 60 * 60 * 24 * 7) : "";
      return signed || raw;
    }
  } catch {
    // Keep non-URL values out of email image tags.
  }

  return isWebImageUrl(raw) ? raw : "";
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

function resolveOrderedPhotos(
  notes: string | null | undefined,
  items: OrderNotificationItem[],
) {
  const parsed = parseOrderPhotoSelections(notes);
  const rawSources = parsed.length > 0
    ? parsed.map((entry) => ({ label: entry.label, url: entry.url }))
    : items
        .map((item) => ({
          label: clean(item.product_name) || "Photo",
          url: clean(item.sku),
        }))
        .filter((item) => isWebImageUrl(item.url));

  const seen = new Set<string>();
  return rawSources
    .map((entry, index) => {
      const displayUrl = emailImageUrl(entry.url);
      if (!displayUrl || seen.has(displayUrl)) return null;
      seen.add(displayUrl);
      return {
        label: entry.label || `Photo ${index + 1}`,
        originalUrl: entry.url,
        displayUrl,
        fileName: fileNameFromUrl(entry.url, `photo-${index + 1}.jpg`),
      };
    })
    .filter(Boolean) as Array<{
      label: string;
      originalUrl: string;
      displayUrl: string;
      fileName: string;
    }>;
}

/* ------------------------------------------------------------------ */
/*  Email builder                                                      */
/* ------------------------------------------------------------------ */

export function buildOrderNotificationEmail(input: {
  order: OrderNotificationOrder;
  items: OrderNotificationItem[];
  photographer: OrderNotificationPhotographer;
  context: OrderNotificationContext;
  dashboardUrl: string;
}) {
  const { order, items, photographer, context, dashboardUrl } = input;

  const currency = clean(order.currency) || "cad";
  const totalCents = resolveOrderTotalCents(order, items);
  const subtotalCents = resolveOrderSubtotalCents(order, items);
  const taxCents = order.tax_cents ?? 0;
  const buyerEmail = clean(order.customer_email || order.parent_email) || "—";
  const packageName = clean(order.package_name) || "Photo Order";
  const studioName = clean(photographer.business_name) || "Your Studio";
  const orderId = clean(order.id).slice(0, 8).toUpperCase();
  const orderedPhotos = resolveOrderedPhotos(order.special_notes, items);
  const customerNote = cleanOrderCustomerNote(order.special_notes);

  const contextLabel = clean(context.project_title)
    || clean(context.school_name)
    || "Gallery";
  const studentLabel = clean(context.student_name);

  // Subject line
  const subject = `New Order #${orderId} — ${formatCurrency(totalCents, currency)} from ${contextLabel}`;

  // Build item rows
  const itemRowsHtml = items.map((item, index) => {
    const name = clean(item.product_name) || "Item";
    const qty = item.quantity ?? 1;
    const lineTotal = resolveOrderItemDisplayCents(item, items, totalCents, index);
    const totalLabel = isPackageComponentItem(order, item, items)
      ? "Included"
      : formatCurrency(lineTotal, currency);
    return `
      <tr>
        <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;">${esc(name)}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;text-align:center;">${qty}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;text-align:right;">${totalLabel}</td>
      </tr>`;
  }).join("");

  const photoRowsHtml = Array.from({ length: Math.ceil(orderedPhotos.length / 2) })
    .map((_, rowIndex) => `
      <tr>
        ${orderedPhotos.slice(rowIndex * 2, rowIndex * 2 + 2).map((photo) => `
      <td width="50%" style="width:50%;padding:0 8px 16px;vertical-align:top;">
        <div style="border:1px solid #eeeeee;border-radius:10px;padding:10px;background:#fafafa;">
          <img src="${esc(photo.displayUrl)}" alt="${esc(photo.label)}" width="220" style="display:block;width:100%;max-width:220px;height:260px;object-fit:cover;border-radius:8px;background:#f3f4f6;margin:0 auto;" />
          <p style="margin:8px 0 0;font-size:12px;font-weight:700;color:#333;line-height:1.35;">${esc(photo.label)}</p>
          <p style="margin:3px 0 0;font-size:11px;color:#888;line-height:1.35;word-break:break-word;">${esc(photo.fileName)}</p>
        </div>
      </td>`).join("")}
      </tr>`)
    .join("");

  // Build the HTML
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>New Order</title></head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">

<!-- Preheader -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
  New order ${formatCurrency(totalCents, currency)} from ${esc(buyerEmail)} for ${esc(contextLabel)}
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;">
<tr><td align="center" style="padding:32px 16px;">

<!-- Card -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">

  <!-- Header bar -->
  <tr>
    <td style="background:#111111;padding:28px 32px;text-align:center;">
      ${photographer.logo_url
        ? `<img src="${esc(photographer.logo_url)}" alt="${esc(studioName)}" width="140" style="max-width:140px;max-height:48px;display:inline-block;margin-bottom:8px;" /><br/>`
        : ""}
      <span style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.7);">${esc(studioName)}</span>
    </td>
  </tr>

  <!-- Badge -->
  <tr>
    <td style="padding:28px 32px 0;text-align:center;">
      <div style="display:inline-block;background:#e8f5e9;color:#2e7d32;font-size:13px;font-weight:600;padding:6px 16px;border-radius:99px;letter-spacing:0.02em;">
        New Order Received
      </div>
    </td>
  </tr>

  <!-- Order headline -->
  <tr>
    <td style="padding:20px 32px 4px;text-align:center;">
      <h1 style="margin:0;font-size:28px;font-weight:700;color:#111;">${formatCurrency(totalCents, currency)}</h1>
    </td>
  </tr>
  <tr>
    <td style="padding:0 32px 24px;text-align:center;">
      <p style="margin:0;font-size:14px;color:#888;">Order #${orderId} &middot; ${formatDate(order.paid_at || order.created_at)}</p>
    </td>
  </tr>

  <!-- Divider -->
  <tr><td style="padding:0 32px;"><div style="border-top:1px solid #eee;"></div></td></tr>

  <!-- Context info -->
  <tr>
    <td style="padding:20px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#999;padding-bottom:6px;">Gallery</td>
          <td style="font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#999;padding-bottom:6px;text-align:right;">Buyer</td>
        </tr>
        <tr>
          <td style="font-size:14px;font-weight:600;color:#333;">${esc(contextLabel)}</td>
          <td style="font-size:14px;color:#333;text-align:right;">${esc(buyerEmail)}</td>
        </tr>
        ${studentLabel ? `
        <tr>
          <td colspan="2" style="padding-top:8px;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#999;">Student</td>
        </tr>
        <tr>
          <td colspan="2" style="font-size:14px;color:#333;">${esc(studentLabel)}</td>
        </tr>` : ""}
      </table>
    </td>
  </tr>

  <!-- Divider -->
  <tr><td style="padding:0 32px;"><div style="border-top:1px solid #eee;"></div></td></tr>

  <!-- Package name -->
  <tr>
    <td style="padding:20px 32px 8px;">
      <p style="margin:0;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#999;">Package</p>
      <p style="margin:4px 0 0;font-size:15px;font-weight:600;color:#333;">${esc(packageName)}</p>
    </td>
  </tr>

  <!-- Items table -->
  ${items.length > 0 ? `
  <tr>
    <td style="padding:8px 32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f0f0f0;border-radius:8px;overflow:hidden;">
        <tr style="background:#fafafa;">
          <th style="padding:10px 16px;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#999;text-align:left;font-weight:600;">Item</th>
          <th style="padding:10px 16px;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#999;text-align:center;font-weight:600;">Qty</th>
          <th style="padding:10px 16px;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#999;text-align:right;font-weight:600;">Total</th>
        </tr>
        ${itemRowsHtml}
      </table>
    </td>
  </tr>` : ""}

  ${orderedPhotos.length > 0 ? `
  <!-- Ordered photos -->
  <tr>
    <td style="padding:4px 24px 20px;">
      <p style="margin:0 8px 10px;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#999;font-weight:700;">Ordered Photos</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${photoRowsHtml}
      </table>
    </td>
  </tr>` : ""}

  <!-- Totals -->
  <tr>
    <td style="padding:8px 32px 24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        ${subtotalCents !== totalCents ? `
        <tr>
          <td style="font-size:14px;color:#666;padding:4px 0;">Subtotal</td>
          <td style="font-size:14px;color:#666;padding:4px 0;text-align:right;">${formatCurrency(subtotalCents, currency)}</td>
        </tr>` : ""}
        ${taxCents > 0 ? `
        <tr>
          <td style="font-size:14px;color:#666;padding:4px 0;">Tax</td>
          <td style="font-size:14px;color:#666;padding:4px 0;text-align:right;">${formatCurrency(taxCents, currency)}</td>
        </tr>` : ""}
        <tr>
          <td style="font-size:16px;font-weight:700;color:#111;padding:8px 0 0;border-top:1px solid #eee;">Total</td>
          <td style="font-size:16px;font-weight:700;color:#111;padding:8px 0 0;border-top:1px solid #eee;text-align:right;">${formatCurrency(totalCents, currency)}</td>
        </tr>
      </table>
    </td>
  </tr>

  ${customerNote ? `
  <!-- Special notes -->
  <tr>
    <td style="padding:0 32px 20px;">
      <div style="background:#fffbeb;border:1px solid #fef3c7;border-radius:8px;padding:12px 16px;">
        <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#92400e;font-weight:600;">Customer Note</p>
        <p style="margin:0;font-size:14px;color:#78350f;">${esc(customerNote)}</p>
      </div>
    </td>
  </tr>` : ""}

  <!-- CTA button -->
  <tr>
    <td style="padding:8px 32px 32px;text-align:center;">
      <a href="${esc(dashboardUrl)}" target="_blank" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:14px 36px;border-radius:99px;letter-spacing:0.02em;">
        View in Dashboard
      </a>
    </td>
  </tr>

</table>
<!-- End Card -->

<!-- Footer -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
  <tr>
    <td style="padding:24px 32px;text-align:center;">
      <p style="margin:0;font-size:12px;color:#bbb;">
        Powered by <a href="https://www.studiooscloud.com" style="color:#999;text-decoration:none;font-weight:500;">Studio OS Cloud</a>
      </p>
      <p style="margin:8px 0 0;font-size:11px;color:#ccc;">
        You received this because a customer placed an order in your gallery.
      </p>
    </td>
  </tr>
</table>

</td></tr>
</table>
</body>
</html>`;

  // Plain text fallback
  const text = [
    `New Order #${orderId}`,
    `Amount: ${formatCurrency(totalCents, currency)}`,
    `Gallery: ${contextLabel}`,
    `Buyer: ${buyerEmail}`,
    studentLabel ? `Student: ${studentLabel}` : null,
    `Package: ${packageName}`,
    "",
    items.map((item, index) => {
      const name = clean(item.product_name) || "Item";
      const qty = item.quantity ?? 1;
      const lineTotal = resolveOrderItemDisplayCents(item, items, totalCents, index);
      const totalLabel = isPackageComponentItem(order, item, items)
        ? "Included"
        : formatCurrency(lineTotal, currency);
      return `  ${name} x${qty} — ${totalLabel}`;
    }).join("\n"),
    orderedPhotos.length ? `\nOrdered photos:\n${orderedPhotos.map((photo, index) => `  ${index + 1}. ${photo.label}: ${photo.displayUrl}`).join("\n")}` : null,
    "",
    subtotalCents !== totalCents ? `Subtotal: ${formatCurrency(subtotalCents, currency)}` : null,
    taxCents > 0 ? `Tax: ${formatCurrency(taxCents, currency)}` : null,
    `Total: ${formatCurrency(totalCents, currency)}`,
    customerNote ? `\nCustomer Note: ${customerNote}` : null,
    "",
    `View in dashboard: ${dashboardUrl}`,
  ].filter(Boolean).join("\n");

  return { subject, html, text };
}

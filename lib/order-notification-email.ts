/**
 * Build an HTML email to notify the photographer of a new paid order.
 * Design: Studio OS Cloud branded, clean & modern — inspired by ShootProof
 * but elevated with our own palette.
 */

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
  const totalCents = order.total_cents ?? Math.round(Number(order.total_amount ?? 0) * 100);
  const subtotalCents = order.subtotal_cents ?? totalCents;
  const taxCents = order.tax_cents ?? 0;
  const buyerEmail = clean(order.customer_email || order.parent_email) || "—";
  const packageName = clean(order.package_name) || "Photo Order";
  const studioName = clean(photographer.business_name) || "Your Studio";
  const orderId = clean(order.id).slice(0, 8).toUpperCase();

  const contextLabel = clean(context.project_title)
    || clean(context.school_name)
    || "Gallery";
  const studentLabel = clean(context.student_name);

  // Subject line
  const subject = `New Order #${orderId} — ${formatCurrency(totalCents, currency)} from ${contextLabel}`;

  // Build item rows
  const itemRowsHtml = items.map((item) => {
    const name = clean(item.product_name) || "Item";
    const qty = item.quantity ?? 1;
    const lineTotal = item.line_total_cents ?? (item.unit_price_cents ?? 0) * qty;
    return `
      <tr>
        <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;">${esc(name)}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;text-align:center;">${qty}</td>
        <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;text-align:right;">${formatCurrency(lineTotal, currency)}</td>
      </tr>`;
  }).join("");

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

  ${clean(order.special_notes) ? `
  <!-- Special notes -->
  <tr>
    <td style="padding:0 32px 20px;">
      <div style="background:#fffbeb;border:1px solid #fef3c7;border-radius:8px;padding:12px 16px;">
        <p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:#92400e;font-weight:600;">Customer Note</p>
        <p style="margin:0;font-size:14px;color:#78350f;">${esc(clean(order.special_notes))}</p>
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
        Powered by <a href="https://studiooscloud.com" style="color:#999;text-decoration:none;font-weight:500;">Studio OS Cloud</a>
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
    items.map((item) => {
      const name = clean(item.product_name) || "Item";
      const qty = item.quantity ?? 1;
      const lineTotal = item.line_total_cents ?? (item.unit_price_cents ?? 0) * qty;
      return `  ${name} x${qty} — ${formatCurrency(lineTotal, currency)}`;
    }).join("\n"),
    "",
    subtotalCents !== totalCents ? `Subtotal: ${formatCurrency(subtotalCents, currency)}` : null,
    taxCents > 0 ? `Tax: ${formatCurrency(taxCents, currency)}` : null,
    `Total: ${formatCurrency(totalCents, currency)}`,
    clean(order.special_notes) ? `\nCustomer Note: ${clean(order.special_notes)}` : null,
    "",
    `View in dashboard: ${dashboardUrl}`,
  ].filter(Boolean).join("\n");

  return { subject, html, text };
}

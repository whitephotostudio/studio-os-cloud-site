// 2026-04-25 — Parent-facing order receipt email.
//
// Sent to the parent after a successful Stripe payment, alongside the
// existing photographer-facing notification (lib/order-notification-email.ts).
// Acts as the parent's proof-of-purchase: order number, every line item with
// a thumbnail of the pose, size + quantity, totals, studio contact info.
//
// The email body is HTML (with a plaintext fallback for clients that don't
// render HTML).  Thumbnails are referenced by URL — no inline attachments.
// Most modern email clients render external image URLs from HTTPS.

export type OrderReceiptOrder = {
  id: string;
  package_name?: string | null;
  total_cents?: number | null;
  total_amount?: number | null;
  subtotal_cents?: number | null;
  tax_cents?: number | null;
  currency?: string | null;
  parent_name?: string | null;
  parent_email?: string | null;
  customer_email?: string | null;
  special_notes?: string | null;
  created_at?: string | null;
  paid_at?: string | null;
  status?: string | null;
};

export type OrderReceiptItem = {
  product_name?: string | null;
  quantity?: number | null;
  unit_price_cents?: number | null;
  line_total_cents?: number | null;
  /** SKU is the photo URL the parent picked for this slot (or the line). */
  sku?: string | null;
};

export type OrderReceiptPhotographer = {
  business_name?: string | null;
  studio_email?: string | null;
  studio_phone?: string | null;
  studio_address?: string | null;
  logo_url?: string | null;
};

export type OrderReceiptContext = {
  project_title?: string | null;
  school_name?: string | null;
  student_name?: string | null;
};

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

/**
 * Some parents' email clients (Outlook desktop especially) drop large
 * external images.  Force a stable max width and use a 1:1 srcset so the
 * thumbnail renders consistently.
 */
function thumbCell(url: string | null | undefined) {
  const safeUrl = clean(url);
  if (!safeUrl) {
    return `<td width="64" style="width:64px;padding:12px 8px 12px 16px;vertical-align:middle;"><div style="width:48px;height:60px;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:6px;"></div></td>`;
  }
  return `<td width="64" style="width:64px;padding:12px 8px 12px 16px;vertical-align:middle;"><img src="${esc(safeUrl)}" alt="" width="48" height="60" style="display:block;width:48px;height:60px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;" /></td>`;
}

export function buildOrderReceiptEmail(input: {
  order: OrderReceiptOrder;
  items: OrderReceiptItem[];
  photographer: OrderReceiptPhotographer;
  context: OrderReceiptContext;
  /** URL the parent can click to open their orders history. */
  ordersHistoryUrl?: string | null;
}) {
  const { order, items, photographer, context, ordersHistoryUrl } = input;

  const currency = clean(order.currency) || "cad";
  const totalCents = order.total_cents ?? Math.round(Number(order.total_amount ?? 0) * 100);
  const subtotalCents = order.subtotal_cents ?? totalCents;
  const taxCents = order.tax_cents ?? 0;
  const studioName = clean(photographer.business_name) || "Your Studio";
  const orderId = clean(order.id).slice(0, 8).toUpperCase();
  const fullOrderId = clean(order.id);
  const parentName = clean(order.parent_name) || "there";
  const studentName = clean(context.student_name);
  const contextLabel =
    clean(context.project_title) || clean(context.school_name) || "Gallery";

  const subject = `Your order #${orderId} from ${studioName}`;

  // Item rows — thumbnail + name + qty + line total.  We deliberately
  // skip negative-priced rows (sibling discounts) from the visible table
  // and surface them as a discount summary line under the totals.
  const visibleItems = items.filter(
    (i) => (i.line_total_cents ?? 0) >= 0,
  );
  const discountItems = items.filter(
    (i) => (i.line_total_cents ?? 0) < 0,
  );

  const itemRowsHtml = visibleItems
    .map((item) => {
      const name = clean(item.product_name) || "Item";
      const qty = item.quantity ?? 1;
      const lineTotal =
        item.line_total_cents ?? (item.unit_price_cents ?? 0) * qty;
      return `
        <tr>
          ${thumbCell(item.sku)}
          <td style="padding:12px 16px 12px 0;font-size:14px;color:#222;font-weight:600;line-height:1.4;">${esc(name)}<br><span style="font-size:12px;color:#888;font-weight:400;">Qty ${qty}</span></td>
          <td style="padding:12px 16px;font-size:14px;color:#222;text-align:right;font-weight:600;white-space:nowrap;">${formatCurrency(lineTotal, currency)}</td>
        </tr>`;
    })
    .join("");

  const discountRowsHtml = discountItems
    .map((item) => {
      const name = clean(item.product_name) || "Discount";
      const lineTotal = item.line_total_cents ?? 0;
      return `
        <tr>
          <td colspan="2" style="padding:8px 16px;font-size:13px;color:#16a34a;font-weight:600;">${esc(name)}</td>
          <td style="padding:8px 16px;font-size:13px;color:#16a34a;text-align:right;font-weight:600;">−${formatCurrency(Math.abs(lineTotal), currency)}</td>
        </tr>`;
    })
    .join("");

  const studioContactLines = [
    photographer.studio_email ? `<a href="mailto:${esc(clean(photographer.studio_email))}" style="color:#2563eb;text-decoration:none;">${esc(clean(photographer.studio_email))}</a>` : null,
    photographer.studio_phone ? esc(clean(photographer.studio_phone)) : null,
    photographer.studio_address ? esc(clean(photographer.studio_address)) : null,
  ]
    .filter(Boolean)
    .join(" &middot; ");

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Your order receipt</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
  Your photo order #${orderId} for ${formatCurrency(totalCents, currency)} has been confirmed.
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;">
<tr><td align="center" style="padding:32px 16px;">

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">

    <!-- Studio header -->
    <tr>
      <td style="background:#111;padding:28px 32px;text-align:center;">
        ${photographer.logo_url
          ? `<img src="${esc(photographer.logo_url)}" alt="${esc(studioName)}" width="140" style="max-width:140px;max-height:48px;display:inline-block;margin-bottom:8px;" /><br/>`
          : ""}
        <span style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.7);">${esc(studioName)}</span>
      </td>
    </tr>

    <!-- Status badge -->
    <tr>
      <td style="padding:28px 32px 0;text-align:center;">
        <div style="display:inline-block;background:#e8f5e9;color:#2e7d32;font-size:13px;font-weight:600;padding:6px 16px;border-radius:99px;letter-spacing:0.02em;">
          ✓ Order confirmed
        </div>
      </td>
    </tr>

    <!-- Order headline -->
    <tr>
      <td style="padding:14px 32px 0;text-align:center;">
        <p style="margin:0;font-size:14px;color:#666;">Hi ${esc(parentName)}, thanks for your order!</p>
      </td>
    </tr>
    <tr>
      <td style="padding:18px 32px 4px;text-align:center;">
        <h1 style="margin:0;font-size:30px;font-weight:700;color:#111;letter-spacing:-0.02em;">Order #${orderId}</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:0 32px 24px;text-align:center;">
        <p style="margin:0;font-size:13px;color:#888;">${formatDate(order.paid_at || order.created_at)}${studentName ? ` &middot; ${esc(studentName)}` : ""}${contextLabel ? ` &middot; ${esc(contextLabel)}` : ""}</p>
      </td>
    </tr>

    <!-- Items -->
    <tr>
      <td style="padding:0 24px;">
        <div style="border:1px solid #f0f0f0;border-radius:12px;overflow:hidden;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td colspan="3" style="background:#fafafa;padding:10px 16px;font-size:11px;font-weight:700;color:#666;letter-spacing:0.08em;text-transform:uppercase;border-bottom:1px solid #f0f0f0;">
                What you ordered (${visibleItems.length} item${visibleItems.length === 1 ? "" : "s"})
              </td>
            </tr>
            ${itemRowsHtml}
          </table>
        </div>
      </td>
    </tr>

    <!-- Totals -->
    <tr>
      <td style="padding:18px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size:13px;color:#666;padding:4px 0;">Subtotal</td>
            <td style="font-size:13px;color:#222;text-align:right;padding:4px 0;">${formatCurrency(subtotalCents, currency)}</td>
          </tr>
          ${discountRowsHtml || ""}
          ${taxCents > 0 ? `<tr><td style="font-size:13px;color:#666;padding:4px 0;">Tax</td><td style="font-size:13px;color:#222;text-align:right;padding:4px 0;">${formatCurrency(taxCents, currency)}</td></tr>` : ""}
          <tr><td colspan="2" style="border-top:1px solid #eee;padding:6px 0;"></td></tr>
          <tr>
            <td style="font-size:16px;color:#111;font-weight:700;padding:6px 0;">Total paid</td>
            <td style="font-size:18px;color:#111;font-weight:800;text-align:right;padding:6px 0;">${formatCurrency(totalCents, currency)}</td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- View orders CTA -->
    ${ordersHistoryUrl ? `
    <tr>
      <td style="padding:24px 32px 8px;text-align:center;">
        <a href="${esc(ordersHistoryUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 26px;border-radius:999px;">View my orders</a>
      </td>
    </tr>
    ` : ""}

    <!-- Reference + studio contact -->
    <tr>
      <td style="padding:24px 32px 8px;">
        <p style="margin:0 0 6px;font-size:11px;color:#999;">Reference: <span style="font-family:'SF Mono',Menlo,monospace;color:#666;">${esc(fullOrderId)}</span></p>
        ${studioContactLines ? `<p style="margin:0;font-size:12px;color:#666;line-height:1.5;">Questions? ${studioContactLines}</p>` : ""}
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="padding:24px 32px 28px;border-top:1px solid #f5f5f5;text-align:center;">
        <p style="margin:0;font-size:11px;color:#9ca3af;">This receipt is your proof of purchase. Save or print it for your records.</p>
      </td>
    </tr>
  </table>

</td></tr>
</table>

</body>
</html>`;

  // Plaintext fallback
  const textLines: string[] = [];
  textLines.push(`${studioName} — Order #${orderId}`);
  textLines.push("");
  textLines.push(`Hi ${parentName}, thanks for your order!`);
  textLines.push(`Date: ${formatDate(order.paid_at || order.created_at)}`);
  if (studentName) textLines.push(`Student: ${studentName}`);
  if (contextLabel) textLines.push(`Gallery: ${contextLabel}`);
  textLines.push("");
  textLines.push("Items:");
  for (const item of visibleItems) {
    const name = clean(item.product_name) || "Item";
    const qty = item.quantity ?? 1;
    const lineTotal = item.line_total_cents ?? (item.unit_price_cents ?? 0) * qty;
    textLines.push(`  • ${name} (qty ${qty}) — ${formatCurrency(lineTotal, currency)}`);
  }
  if (discountItems.length > 0) {
    textLines.push("");
    for (const d of discountItems) {
      textLines.push(`  ${clean(d.product_name) || "Discount"}: −${formatCurrency(Math.abs(d.line_total_cents ?? 0), currency)}`);
    }
  }
  textLines.push("");
  textLines.push(`Subtotal: ${formatCurrency(subtotalCents, currency)}`);
  if (taxCents > 0) textLines.push(`Tax: ${formatCurrency(taxCents, currency)}`);
  textLines.push(`Total paid: ${formatCurrency(totalCents, currency)}`);
  textLines.push("");
  textLines.push(`Reference: ${fullOrderId}`);
  if (ordersHistoryUrl) {
    textLines.push("");
    textLines.push(`View your orders: ${ordersHistoryUrl}`);
  }
  if (photographer.studio_email) {
    textLines.push("");
    textLines.push(`Questions? Reply to this email or contact ${clean(photographer.studio_email)}.`);
  }

  return {
    subject,
    html,
    text: textLines.join("\n"),
  };
}

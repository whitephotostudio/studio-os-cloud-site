import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";

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

function u16(v: number) {
  const b = new Uint8Array(2);
  b[0] = v & 0xff;
  b[1] = (v >> 8) & 0xff;
  return b;
}
function u32(v: number) {
  const b = new Uint8Array(4);
  b[0] = v & 0xff;
  b[1] = (v >> 8) & 0xff;
  b[2] = (v >> 16) & 0xff;
  b[3] = (v >> 24) & 0xff;
  return b;
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

function money(cents: number | null | undefined, fallbackAmount?: number | null) {
  const val = cents != null ? cents / 100 : (fallbackAmount ?? 0);
  return `$${val.toFixed(2)}`;
}

function slug(v: string | null | undefined, fallback: string) {
  const s = clean(v);
  return s ? s.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "") : fallback;
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

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "numeric", day: "numeric" });
}

function shortOrderId(id: string) {
  return id.replace(/-/g, "").slice(0, 6).toUpperCase();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildOrderSummaryHtml(order: any, branding: StudioBranding): string {
  const studentName = `${clean(order.student?.first_name)} ${clean(order.student?.last_name)}`.trim() || "Student";
  const schoolName = order.school?.school_name ?? "—";
  const className = order.class?.class_name ?? "";
  const parentName = order.parent_name ?? order.customer_name ?? "—";
  const parentEmail = order.parent_email ?? order.customer_email ?? "—";
  const parentPhone = order.parent_phone ?? "";
  const currency = (order.currency ?? "CAD").toUpperCase();
  const total = money(order.total_cents, order.total_amount);
  const orderDate = formatDate(order.created_at);
  const orderId = shortOrderId(order.id);
  const status = (order.status ?? "new").toUpperCase().replace(/_/g, " ");

  const items = order.items ?? [];
  const photoUrls = new Set<string>();
  if (clean(order.student?.photo_url)) photoUrls.add(order.student.photo_url);
  for (const item of items) {
    if (clean(item.sku)) photoUrls.add(item.sku);
  }
  const photos = Array.from(photoUrls);

  // Build photo cards — each with product name, number, quantity
  let photoCardsHtml = "";
  let photoIndex = 0;
  for (const item of items) {
    photoIndex++;
    const qty = item.quantity ?? 1;
    const productName = item.product_name ?? "Item";
    const photoSrc = item.sku || "";

    photoCardsHtml += `
      <div style="display:inline-block;vertical-align:top;margin:0 28px 28px 0;text-align:center;width:200px;">
        ${photoSrc ? `<img src="${esc(photoSrc)}" style="width:190px;height:230px;object-fit:cover;border-radius:6px;border:3px solid #e2e8f0;background:#f7fafc;" />` : `<div style="width:190px;height:230px;background:#f7fafc;border-radius:6px;border:3px solid #e2e8f0;display:flex;align-items:center;justify-content:center;color:#a0aec0;font-size:13px;">No photo</div>`}
        <div style="margin-top:10px;font-size:14px;font-weight:600;color:#2d3748;">${esc(productName)}</div>
        <div style="font-size:13px;color:#e53e3e;font-weight:800;">#${String(photoIndex).padStart(4, "0")}</div>
        <div style="font-size:14px;color:#4a5568;">&times; ${qty}</div>
      </div>`;
  }

  // If no items but photos exist
  if (items.length === 0 && photos.length > 0) {
    photos.forEach((url, i) => {
      photoCardsHtml += `
        <div style="display:inline-block;vertical-align:top;margin:0 28px 28px 0;text-align:center;width:200px;">
          <img src="${esc(url)}" style="width:190px;height:230px;object-fit:cover;border-radius:6px;border:3px solid #e2e8f0;background:#f7fafc;" />
          <div style="margin-top:10px;font-size:14px;font-weight:600;color:#2d3748;">${esc(order.package_name ?? "Package")}</div>
          <div style="font-size:13px;color:#e53e3e;font-weight:800;">#${String(i + 1).padStart(4, "0")}</div>
        </div>`;
    });
  }

  // Delivery note (extract from special_notes if present)
  const notes = clean(order.special_notes) || clean(order.notes);
  const deliveryMatch = notes.match(/Delivery:\s*(\w+)/i);
  const delivery = deliveryMatch ? deliveryMatch[1] : "";

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
  <div style="background:#2d3748;color:#fff;padding:28px 36px;display:flex;justify-content:space-between;align-items:flex-start;">
    <div>
      <div style="font-size:15px;color:#a0aec0;">
        <span style="font-weight:800;color:#fff;">${esc(schoolName)}</span>
        ${className ? `&nbsp;&nbsp;<span style="color:#cbd5e0;">${esc(className)}</span>` : ""}
      </div>
      <div style="font-size:36px;font-weight:800;margin-top:8px;letter-spacing:-0.01em;">${esc(studentName)}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:24px;font-weight:900;color:#fff;letter-spacing:0.02em;">${esc(branding.businessName)}</div>
      <div style="font-size:13px;color:#a0aec0;margin-top:8px;line-height:1.7;">
        ${branding.phone ? `${esc(branding.phone)}<br/>` : ""}
        ${branding.email ? `${esc(branding.email)}<br/>` : ""}
        ${branding.website ? esc(branding.website) : ""}
      </div>
    </div>
  </div>

  <!-- Order date + status bar -->
  <div style="display:flex;justify-content:flex-end;align-items:center;gap:16px;padding:12px 36px;background:#edf2f7;border-bottom:1px solid #e2e8f0;">
    <span style="font-size:13px;color:#4a5568;">Order: ${orderDate}</span>
    <span style="display:inline-block;padding:5px 18px;background:#38a169;color:#fff;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:0.04em;">${esc(status)}</span>
  </div>

  <!-- Photo cards + order number -->
  <div style="padding:32px 36px;position:relative;">
    ${photoCardsHtml || '<div style="color:#a0aec0;font-size:14px;">No photos in this order.</div>'}
    <div style="position:absolute;top:32px;right:36px;text-align:center;">
      <div style="font-size:14px;color:#718096;font-weight:700;">#${orderId}</div>
    </div>
  </div>

  <!-- Compact info footer -->
  <div style="padding:14px 36px;background:#f7fafc;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
    <div style="font-size:13px;color:#4a5568;">
      <span style="font-weight:600;">Parent:</span> ${esc(parentName)}${parentEmail !== "—" ? ` &middot; ${esc(parentEmail)}` : ""}${parentPhone ? ` &middot; ${esc(parentPhone)}` : ""}
      ${delivery ? `&nbsp;&nbsp;<span style="display:inline-block;padding:2px 10px;background:#ebf8ff;color:#2b6cb0;border-radius:10px;font-size:11px;font-weight:700;text-transform:uppercase;">${esc(delivery)}</span>` : ""}
    </div>
    <div style="font-size:13px;color:#718096;">
      Studio OS Cloud
    </div>
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
        special_notes, notes, student_id, school_id, class_id, project_id,
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

      // Add order summary HTML
      const summaryHtml = buildOrderSummaryHtml(order, branding);
      const enc = new TextEncoder();
      zipEntries.push({
        name: `${prefix}order-summary.html`,
        data: enc.encode(summaryHtml),
      });

      // Collect photo URLs
      const photoUrls = new Set<string>();
      if (clean(order.student?.photo_url)) photoUrls.add(order.student.photo_url);
      for (const item of order.items ?? []) {
        if (clean(item.sku)) photoUrls.add(item.sku);
      }

      // Download each photo and add to ZIP
      let photoIndex = 0;
      for (const url of photoUrls) {
        photoIndex++;
        try {
          const resp = await fetch(url);
          if (!resp.ok) {
            console.error(`Failed to download photo ${url}: ${resp.status}`);
            continue;
          }
          const arrayBuf = await resp.arrayBuffer();
          const fileName = fileNameFromUrl(url, `photo-${photoIndex}.jpg`);
          zipEntries.push({
            name: `${prefix}${fileName}`,
            data: new Uint8Array(arrayBuf),
          });
        } catch (err) {
          console.error(`Error downloading photo ${url}:`, err);
        }
      }
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
      { ok: false, message: error instanceof Error ? error.message : "Download failed." },
      { status: 500 },
    );
  }
}

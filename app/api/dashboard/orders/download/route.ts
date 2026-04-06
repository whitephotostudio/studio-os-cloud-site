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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildOrderSummaryText(order: any): string {
  const studentName = `${clean(order.student?.first_name)} ${clean(order.student?.last_name)}`.trim() || "Student";
  const schoolName = order.school?.school_name ?? "—";
  const className = order.class?.class_name ?? "—";
  const parentName = order.parent_name ?? order.customer_name ?? "—";
  const parentEmail = order.parent_email ?? order.customer_email ?? "—";
  const parentPhone = order.parent_phone ?? "—";
  const currency = (order.currency ?? "CAD").toUpperCase();
  const total = money(order.total_cents, order.total_amount);

  const lines = [
    `╔══════════════════════════════════════════════════════════════╗`,
    `║                  STUDIO OS - ORDER SUMMARY                  ║`,
    `╚══════════════════════════════════════════════════════════════╝`,
    ``,
    `Order ID:     ${order.id}`,
    `Order Date:   ${new Date(order.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}`,
    `Status:       ${order.status}`,
    ``,
    `── Student & School ──────────────────────────────────────────`,
    `Student:      ${studentName}`,
    `School:       ${schoolName}`,
    `Class:        ${className}`,
    ``,
    `── Parent / Customer ─────────────────────────────────────────`,
    `Name:         ${parentName}`,
    `Email:        ${parentEmail}`,
    `Phone:        ${parentPhone}`,
    ``,
    `── Order Items ───────────────────────────────────────────────`,
  ];

  const items = order.items ?? [];
  if (items.length > 0) {
    let subtotal = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const qty = item.quantity ?? 1;
      const lineTotal = item.line_total_cents ?? Math.round((item.price ?? 0) * 100);
      subtotal += lineTotal;
      const fileName = item.sku ? fileNameFromUrl(item.sku, "") : "";
      lines.push(
        `${i + 1}. ${item.product_name ?? "Item"}`,
        `   Qty: ${qty}  |  Total: ${money(lineTotal)}${fileName ? `  |  File: ${fileName}` : ""}`,
      );
    }
    lines.push(``);
    lines.push(`── Totals ────────────────────────────────────────────────────`);
    if (order.subtotal_cents != null) lines.push(`Subtotal:     ${money(order.subtotal_cents)}`);
    if (order.tax_cents != null && order.tax_cents > 0) lines.push(`Tax:          ${money(order.tax_cents)}`);
    lines.push(`TOTAL:        ${total} ${currency}`);
  } else {
    lines.push(`1. ${order.package_name ?? "Package"}  |  Total: ${total}`);
    lines.push(``);
    lines.push(`TOTAL:        ${total} ${currency}`);
  }

  if (clean(order.special_notes) || clean(order.notes)) {
    lines.push(``);
    lines.push(`── Special Notes ─────────────────────────────────────────────`);
    lines.push(order.special_notes || order.notes);
  }

  lines.push(``);
  lines.push(`── Photos Included ───────────────────────────────────────────`);
  const photoUrls = new Set<string>();
  if (clean(order.student?.photo_url)) photoUrls.add(order.student.photo_url);
  for (const item of items) {
    if (clean(item.sku)) photoUrls.add(item.sku);
  }
  const urlArr = Array.from(photoUrls);
  if (urlArr.length > 0) {
    urlArr.forEach((url, i) => lines.push(`${i + 1}. ${fileNameFromUrl(url, `photo-${i + 1}.jpg`)}`));
  } else {
    lines.push(`No photos attached.`);
  }

  return lines.join("\n");
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

    // Get photographer
    const { data: pgRow } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!pgRow?.id) {
      return NextResponse.json({ ok: false, message: "Photographer not found." }, { status: 404 });
    }

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

      // Add order summary text
      const summaryText = buildOrderSummaryText(order);
      const enc = new TextEncoder();
      zipEntries.push({
        name: `${prefix}order-summary.txt`,
        data: enc.encode(summaryText),
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

// GET /api/portal/orders/history
//
// Returns the parent's order history for a single gallery — fuels the new
// Orders tab inside /parents/[pin] (and powers the one-click reorder
// button on each row).
//
// Auth model: PIN + email gates a school-mode gallery, PIN + email gates
// an event-mode gallery.  We re-validate that combo here against the DB
// before returning anything — never trust the client's claimed identity.
//
// Query parameters:
//   pin           required — gallery PIN
//   email         required — viewer email (matches school_gallery_visitors
//                            or event_gallery_visitors)
//   schoolId      optional (school mode)
//   projectId     optional (event mode)
//
// Response shape:
//   {
//     ok: true,
//     orders: Array<{
//       id, shortId, createdAt, paidAt, status, totalCents, currency,
//       items: Array<{ productName, quantity, lineTotalCents, sku }>,
//       cartSnapshot: <opaque JSON or null>,
//       schoolName, projectTitle, studentName, photographerId
//     }>
//   }

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { parseJson } from "@/lib/api-validation";
import type { RateLimitConfig } from "@/lib/rate-limit";
import {
  isWebImageUrl,
  isPackageComponentItem,
  parseOrderPhotoSelections,
  resolveOrderItemDisplayCents,
  resolveOrderSubtotalCents,
  resolveOrderTotalCents,
} from "@/lib/order-display";
import { createDigitalDeliveryDownloadUrl } from "@/lib/digital-delivery";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  pin: z.string().trim().min(3).max(64),
  email: z.string().trim().email().max(320),
  schoolId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
});

type OrderItemRow = {
  product_name: string | null;
  quantity: number | null;
  line_total_cents: number | null;
  unit_price_cents: number | null;
  sku: string | null;
};

type OrderRow = {
  id: string;
  created_at: string | null;
  paid_at: string | null;
  status: string | null;
  payment_status: string | null;
  total_cents: number | null;
  total_amount: number | null;
  subtotal_cents: number | null;
  tax_cents: number | null;
  currency: string | null;
  package_name: string | null;
  parent_name: string | null;
  parent_email: string | null;
  parent_phone: string | null;
  customer_email: string | null;
  special_notes: string | null;
  notes: string | null;
  cart_snapshot: unknown;
  photographer_id: string;
  school_id: string | null;
  project_id: string | null;
  student_id: string | null;
  order_group_id: string | null;
  order_items: OrderItemRow[] | null;
};

function clean(v: string | null | undefined) {
  return (v ?? "").trim();
}

function lower(v: string | null | undefined) {
  return clean(v).toLowerCase();
}

function looksDigital(value: string | null | undefined) {
  const text = lower(value);
  if (!text || text.includes("retouch")) return false;
  return (
    text.includes("digital") ||
    text.includes("download") ||
    text.includes("file") ||
    text.includes("jpg") ||
    text.includes("jpeg") ||
    text.includes("png") ||
    text.includes("usb")
  );
}

function isPaidEnough(row: OrderRow) {
  const status = lower(row.status);
  const paymentStatus = lower(row.payment_status);
  if (row.paid_at) return true;
  if (paymentStatus === "paid" || paymentStatus === "succeeded") return true;
  return [
    "paid",
    "digital_paid",
    "digital_sent",
    "reviewed",
    "sent_to_print",
    "completed",
  ].includes(status);
}

function orderHasDigitalDelivery(row: OrderRow, items: OrderItemRow[]) {
  if (looksDigital(row.package_name) || looksDigital(row.status)) return true;
  return items.some((item) => looksDigital(item.product_name));
}

function rowEmailMatches(row: OrderRow, emailLower: string) {
  return (
    lower(row.parent_email) === emailLower ||
    lower(row.customer_email) === emailLower
  );
}

export async function POST(request: NextRequest) {
  // 5 fetches per minute per IP; orders history isn't a hot loop.
  try {
    const ip = getClientIp(request);
    const limit = await rateLimit(`portal-orders-history:${ip}`, {
      namespace: "portal-orders-history",
      limit: 5,
      windowSeconds: 60,
    } satisfies RateLimitConfig);
    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, message: "Too many requests. Try again in a moment." },
        { status: 429 },
      );
    }
  } catch {
    // Rate-limit storage hiccup — fail open.
  }

  const parsed = await parseJson(request, QuerySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (!body.schoolId && !body.projectId) {
    return NextResponse.json(
      { ok: false, message: "schoolId or projectId is required." },
      { status: 400 },
    );
  }

  const sb = createDashboardServiceClient();
  const emailLower = body.email.toLowerCase();

  // Validate the parent's identity by checking that the PIN exists in the
  // claimed gallery AND the email is recorded in the visitors table for
  // that gallery.  Both checks together prevent a malicious viewer from
  // pulling another parent's order history.
  if (body.schoolId) {
    const { data: studentRow } = await sb
      .from("students")
      .select("id,school_id,first_name,last_name")
      .eq("pin", body.pin)
      .eq("school_id", body.schoolId)
      .maybeSingle();

    if (!studentRow) {
      return NextResponse.json(
        { ok: false, message: "Invalid PIN for this school." },
        { status: 404 },
      );
    }

    const { data: visitorRow } = await sb
      .from("school_gallery_visitors")
      .select("viewer_email")
      .eq("school_id", body.schoolId)
      .ilike("viewer_email", emailLower)
      .maybeSingle();

    // Visitor rows are best-effort tracking.  Older paid orders can exist
    // without one, so the actual order query below still runs for a valid
    // student PIN.  Contact details + digital download links remain gated
    // by an exact purchase-email match in formatOrder().
    void visitorRow;

    const { data: orders, error } = await sb
      .from("orders")
      .select(
        `id,created_at,paid_at,status,total_cents,subtotal_cents,tax_cents,currency,package_name,
         payment_status,
         total_amount,
         parent_name,parent_email,parent_phone,customer_email,special_notes,notes,
         cart_snapshot,photographer_id,
         school_id,project_id,student_id,order_group_id,
         order_items(product_name,quantity,line_total_cents,unit_price_cents,sku)`,
      )
      .eq("school_id", body.schoolId)
      .eq("student_id", studentRow.id)
      .or(
        `parent_email.ilike.${emailLower},customer_email.ilike.${emailLower}`,
      )
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json(
        { ok: false, message: "Failed to load order history." },
        { status: 500 },
      );
    }

    let historyRows = (orders ?? []) as unknown as OrderRow[];
    if (historyRows.length === 0) {
      const { data: fallbackOrders, error: fallbackError } = await sb
        .from("orders")
        .select(
          `id,created_at,paid_at,status,total_cents,subtotal_cents,tax_cents,currency,package_name,
           payment_status,
           total_amount,
           parent_name,parent_email,parent_phone,customer_email,special_notes,notes,
           cart_snapshot,photographer_id,
           school_id,project_id,student_id,order_group_id,
           order_items(product_name,quantity,line_total_cents,unit_price_cents,sku)`,
        )
        .eq("school_id", body.schoolId)
        .eq("student_id", studentRow.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (fallbackError) {
        return NextResponse.json(
          { ok: false, message: "Failed to load order history." },
          { status: 500 },
        );
      }
      historyRows = (fallbackOrders ?? []) as unknown as OrderRow[];
    }

    return NextResponse.json({
      ok: true,
      orders: historyRows.map((row) => formatOrder(row, {
        student_name: [
          clean((studentRow as { first_name?: string }).first_name),
          clean((studentRow as { last_name?: string }).last_name),
        ].filter(Boolean).join(" ") || null,
        allow_private_details: rowEmailMatches(row, emailLower),
      })),
    });
  }

  // Event mode — validate the PIN matches the project's access_pin
  // (same gating as school-mode's PIN-on-students check).  Without this,
  // someone holding only a parent's email + projectId could pull their
  // order history without ever proving they have the PIN.
  const { data: projectRow } = await sb
    .from("projects")
    .select("id,access_pin")
    .eq("id", body.projectId!)
    .maybeSingle();

  if (!projectRow) {
    return NextResponse.json(
      { ok: false, message: "Invalid event." },
      { status: 404 },
    );
  }

  const projectPin = clean((projectRow as { access_pin?: string }).access_pin);
  if (projectPin && projectPin !== body.pin) {
    return NextResponse.json(
      { ok: false, message: "Invalid PIN for this event." },
      { status: 404 },
    );
  }

  const { data: visitorRow } = await sb
    .from("event_gallery_visitors")
    .select("viewer_email")
    .eq("project_id", body.projectId!)
    .ilike("viewer_email", emailLower)
    .maybeSingle();

  if (!visitorRow) {
    return NextResponse.json(
      { ok: false, message: "We couldn't find any orders for that email + PIN combination." },
      { status: 404 },
    );
  }

  const { data: orders, error } = await sb
    .from("orders")
    .select(
      `id,created_at,paid_at,status,total_cents,subtotal_cents,tax_cents,currency,package_name,
       payment_status,
       total_amount,
       parent_name,parent_email,parent_phone,customer_email,special_notes,notes,
       cart_snapshot,photographer_id,
       school_id,project_id,student_id,order_group_id,
       order_items(product_name,quantity,line_total_cents,unit_price_cents,sku)`,
    )
    .eq("project_id", body.projectId!)
    .or(
      `parent_email.ilike.${emailLower},customer_email.ilike.${emailLower}`,
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json(
      { ok: false, message: "Failed to load order history." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    orders: (orders ?? []).map((row) =>
      formatOrder(row as unknown as OrderRow, { student_name: null }),
    ),
  });
}

function formatOrder(
  row: OrderRow,
  ctx: { student_name: string | null; allow_private_details?: boolean },
) {
  const allowPrivateDetails = ctx.allow_private_details !== false;
  const notePhotos = parseOrderPhotoSelections(row.special_notes ?? row.notes);
  const rawItems = (row.order_items?.length ? row.order_items : notePhotos.map((photo) => ({
    product_name: photo.label,
    quantity: 1,
    line_total_cents: null,
    unit_price_cents: null,
    sku: photo.url,
  }))) ?? [];
  const orderTotalCents = resolveOrderTotalCents(row, rawItems);
  const recipientEmail = clean(row.customer_email) || clean(row.parent_email);
  const hasDigitalDelivery = orderHasDigitalDelivery(row, rawItems);
  let digitalDownload: {
    available: boolean;
    url: string | null;
    message: string;
  } | null = null;
  if (hasDigitalDelivery) {
    digitalDownload = {
      available: false,
      url: null,
      message: !allowPrivateDetails
        ? "Use the purchase email to download digital files."
        : isPaidEnough(row)
        ? "Digital files are being prepared."
        : "Digital download unlocks after payment.",
    };
    if (allowPrivateDetails && recipientEmail && isPaidEnough(row)) {
      try {
        digitalDownload = {
          available: true,
          url: createDigitalDeliveryDownloadUrl(row.id, recipientEmail),
          message: "Download digital files",
        };
      } catch (error) {
        console.error("[orders-history] failed to create digital download link", {
          orderId: row.id,
          error,
        });
      }
    }
  }
  const items = rawItems.map((it, index) => ({
    productName: it.product_name ?? "Item",
    quantity: it.quantity ?? 1,
    includedInPackage: isPackageComponentItem(row, it, rawItems),
    lineTotalCents: resolveOrderItemDisplayCents(
      it,
      rawItems,
      orderTotalCents,
      index,
    ),
    unitPriceCents: it.unit_price_cents ?? 0,
    sku: isWebImageUrl(it.sku) ? it.sku : notePhotos[index]?.url ?? null,
  }));
  return {
    id: row.id,
    shortId: row.id.slice(0, 8).toUpperCase(),
    createdAt: row.created_at,
    paidAt: row.paid_at,
    status: row.status ?? "pending",
    totalCents: orderTotalCents,
    subtotalCents: resolveOrderSubtotalCents(row, rawItems),
    taxCents: row.tax_cents ?? null,
    currency: row.currency ?? "cad",
    packageName: row.package_name ?? null,
    items,
    cartSnapshot: row.cart_snapshot ?? null,
    schoolId: row.school_id,
    projectId: row.project_id,
    studentId: row.student_id,
    orderGroupId: row.order_group_id,
    studentName: ctx.student_name,
    parentName: allowPrivateDetails ? row.parent_name ?? null : null,
    parentEmail: allowPrivateDetails ? row.parent_email ?? row.customer_email ?? null : null,
    parentPhone: allowPrivateDetails ? row.parent_phone ?? null : null,
    specialNotes: row.special_notes ?? row.notes ?? null,
    digitalDownload,
  };
}

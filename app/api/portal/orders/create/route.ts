import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { validateEventGalleryAccess } from "@/lib/event-gallery-access";
import { isOrderingWindowOpen } from "@/lib/ordering-window";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { hasActiveSubscription } from "@/lib/subscription-gate";
import {
  ensureObjectBody,
  validateEmail,
  validateString,
  validateUuid,
} from "@/lib/request-validation";

export const dynamic = "force-dynamic";

// ──────────────────────────────────────────────────────────────────────────
// Server-side order creation for the parents portal.
//
// Why this route exists:
//
// Previously app/parents/[pin]/page.tsx wrote `orders` + `order_items`
// directly via the public anon key. The `orders.parent_place_order` RLS
// policy allowed the insert with `WITH CHECK (true)`, which meant any
// anonymous caller could fabricate an `orders` row with arbitrary
// `total_cents` / `package_id` / `photographer_id` / `project_id` and
// hand the orderId to /api/stripe/checkout.
//
// The checkout route has a price-tampering guard (sum of order_items
// must match, total must be ≥ the authoritative package price), but
// that's a rearguard check. This route closes the vector at the source:
// clients send only "what was selected" (packageIds, quantities,
// backdropIds, slots, parent/delivery info). The server looks up the
// real package and backdrop prices from the `packages` and
// `backdrop_catalog` tables and computes totals itself. The anon key no
// longer touches `orders`.
//
// Covers both modes:
//   - mode: "school"  — requires pin + schoolId; student must exist at that school
//   - mode: "event"   — requires pin + projectId + email; goes through
//                       validateEventGalleryAccess (pre-release whitelist
//                       + project/subject/collection pin)
// ──────────────────────────────────────────────────────────────────────────

const MAX_ENTRIES = 10;
const MAX_QUANTITY = 20;
const MAX_SLOTS = 20;
const MAX_NOTES_LENGTH = 2000;
const MAX_IMAGE_URL_LENGTH = 2048;
const MAX_LABEL_LENGTH = 120;
const MAX_COMPOSITE_TITLE_LENGTH = 200;
const MIN_BACKDROP_BLUR_PX = 4;
const MAX_BACKDROP_BLUR_PX = 24;
const DEFAULT_BACKDROP_BLUR_PX = 4;

type SlotPayload = { label: string; assignedImageUrl: string | null };

type EntryPayload = {
  packageId: string;
  quantity: number;
  backdrop: {
    id: string;
    blurred: boolean;
    blurAmount: number;
  } | null;
  slots: SlotPayload[];
  selectedImageUrl: string | null;
  isComposite: boolean;
  compositeTitle: string | null;
};

type DeliveryPayload =
  | { method: "pickup" }
  | {
      method: "shipping";
      name: string;
      address1: string;
      address2: string;
      city: string;
      province: string;
      postalCode: string;
    };

type ParentPayload = {
  name: string;
  email: string;
  phone: string;
};

type SchoolRow = {
  id: string;
  photographer_id: string | null;
  order_due_date: string | null;
  expiration_date: string | null;
};

type StudentRow = {
  id: string;
  school_id: string;
  class_id: string | null;
};

type PackageRow = {
  id: string;
  name: string | null;
  price_cents: number | null;
  photographer_id: string | null;
  category: string | null;
  active: boolean | null;
};

type BackdropRow = {
  id: string;
  name: string | null;
  image_url: string | null;
  tier: string | null;
  price_cents: number | null;
  photographer_id: string | null;
  active: boolean | null;
};

type PhotographerGateRow = {
  id: string;
  is_platform_admin?: boolean | null;
  subscription_status?: string | null;
  trial_starts_at?: string | null;
  trial_ends_at?: string | null;
  created_at?: string | null;
};

type OrderItemInsert = {
  order_id: string;
  product_name: string;
  quantity: number;
  price: number;
  unit_price_cents: number;
  line_total_cents: number;
  sku: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function isDigitalCategory(pkg: Pick<PackageRow, "category" | "name">) {
  const cat = clean(pkg.category).toLowerCase();
  if (cat === "digital") return true;
  const name = clean(pkg.name).toLowerCase();
  return name.includes("digital") || name.includes("download") || name.includes("usb");
}

function validateOptionalString(
  raw: unknown,
  field: string,
  max: number,
): { ok: true; value: string } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, value: "" };
  if (typeof raw !== "string") {
    return { ok: false, message: `${field} must be a string.` };
  }
  const trimmed = raw.trim();
  if (trimmed.length > max) {
    return { ok: false, message: `${field} is too long.` };
  }
  return { ok: true, value: trimmed };
}

function validateSlots(
  raw: unknown,
  field: string,
): { ok: true; value: SlotPayload[] } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, message: `${field} must be an array.` };
  }
  if (raw.length > MAX_SLOTS) {
    return { ok: false, message: `${field} has too many items (max ${MAX_SLOTS}).` };
  }
  const out: SlotPayload[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, message: `${field} contains an invalid entry.` };
    }
    const slot = entry as Record<string, unknown>;
    const label = typeof slot.label === "string" ? slot.label.trim() : "";
    if (label.length > MAX_LABEL_LENGTH) {
      return { ok: false, message: `A ${field} label is too long.` };
    }
    const rawImage = slot.assignedImageUrl;
    let assignedImageUrl: string | null = null;
    if (typeof rawImage === "string") {
      const trimmed = rawImage.trim();
      if (trimmed.length > MAX_IMAGE_URL_LENGTH) {
        return { ok: false, message: `A ${field} image URL is too long.` };
      }
      assignedImageUrl = trimmed || null;
    } else if (rawImage !== undefined && rawImage !== null) {
      return { ok: false, message: `A ${field} image URL must be a string.` };
    }
    out.push({ label: label || "Item", assignedImageUrl });
  }
  return { ok: true, value: out };
}

function validateDelivery(
  raw: unknown,
): { ok: true; value: DeliveryPayload } | { ok: false; message: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "delivery must be an object." };
  }
  const d = raw as Record<string, unknown>;
  const method = typeof d.method === "string" ? d.method.trim().toLowerCase() : "";

  if (method === "pickup") {
    return { ok: true, value: { method: "pickup" } };
  }
  if (method !== "shipping") {
    return { ok: false, message: "delivery.method must be pickup or shipping." };
  }

  const required = ["name", "address1", "city", "province", "postalCode"] as const;
  const collected: Record<string, string> = {};
  for (const key of required) {
    const field = `delivery.${key}`;
    const result = validateString(d[key], field, { max: 200 });
    if (!result.ok) return result;
    collected[key] = result.value;
  }

  const address2Result = validateOptionalString(d.address2, "delivery.address2", 200);
  if (!address2Result.ok) return address2Result;

  return {
    ok: true,
    value: {
      method: "shipping",
      name: collected.name,
      address1: collected.address1,
      address2: address2Result.value,
      city: collected.city,
      province: collected.province,
      postalCode: collected.postalCode,
    },
  };
}

function validateParent(
  raw: unknown,
): { ok: true; value: ParentPayload } | { ok: false; message: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "parent must be an object." };
  }
  const p = raw as Record<string, unknown>;
  const email = validateEmail(p.email, "parent.email");
  if (!email.ok) return email;
  const name = validateOptionalString(p.name, "parent.name", 200);
  if (!name.ok) return name;
  const phone = validateOptionalString(p.phone, "parent.phone", 40);
  if (!phone.ok) return phone;
  return {
    ok: true,
    value: { email: email.value, name: name.value, phone: phone.value },
  };
}

function validateEntries(
  raw: unknown,
): { ok: true; value: EntryPayload[] } | { ok: false; message: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, message: "entries must be an array." };
  }
  if (raw.length < 1) {
    return { ok: false, message: "Add at least one product before checkout." };
  }
  if (raw.length > MAX_ENTRIES) {
    return { ok: false, message: `Too many items (max ${MAX_ENTRIES}).` };
  }
  const out: EntryPayload[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, message: `entries[${i}] must be an object.` };
    }
    const entry = row as Record<string, unknown>;

    const pkgId = validateUuid(entry.packageId, `entries[${i}].packageId`);
    if (!pkgId.ok) return pkgId;

    const rawQty =
      typeof entry.quantity === "number" ? entry.quantity : Number(entry.quantity);
    if (
      !Number.isFinite(rawQty) ||
      !Number.isInteger(rawQty) ||
      rawQty < 1 ||
      rawQty > MAX_QUANTITY
    ) {
      return {
        ok: false,
        message: `entries[${i}].quantity must be 1..${MAX_QUANTITY}.`,
      };
    }

    let backdrop: EntryPayload["backdrop"] = null;
    if (entry.backdrop && typeof entry.backdrop === "object" && !Array.isArray(entry.backdrop)) {
      const b = entry.backdrop as Record<string, unknown>;
      const idResult = validateUuid(b.id, `entries[${i}].backdrop.id`);
      if (!idResult.ok) return idResult;
      const blurred = b.blurred === true;
      const rawBlurAmount =
        typeof b.blurAmount === "number" ? b.blurAmount : Number(b.blurAmount ?? DEFAULT_BACKDROP_BLUR_PX);
      if (!Number.isFinite(rawBlurAmount)) {
        return {
          ok: false,
          message: `entries[${i}].backdrop.blurAmount must be a number.`,
        };
      }
      const blurAmount = blurred
        ? Math.min(
            MAX_BACKDROP_BLUR_PX,
            Math.max(MIN_BACKDROP_BLUR_PX, Math.round(rawBlurAmount)),
          )
        : 0;
      backdrop = { id: idResult.value, blurred, blurAmount };
    } else if (entry.backdrop !== undefined && entry.backdrop !== null) {
      return { ok: false, message: `entries[${i}].backdrop must be an object or null.` };
    }

    const slotsResult = validateSlots(entry.slots, `entries[${i}].slots`);
    if (!slotsResult.ok) return slotsResult;

    const selectedImage = validateOptionalString(
      entry.selectedImageUrl,
      `entries[${i}].selectedImageUrl`,
      MAX_IMAGE_URL_LENGTH,
    );
    if (!selectedImage.ok) return selectedImage;

    const compositeTitle = validateOptionalString(
      entry.compositeTitle,
      `entries[${i}].compositeTitle`,
      MAX_COMPOSITE_TITLE_LENGTH,
    );
    if (!compositeTitle.ok) return compositeTitle;

    out.push({
      packageId: pkgId.value,
      quantity: rawQty,
      backdrop,
      slots: slotsResult.value,
      selectedImageUrl: selectedImage.value || null,
      isComposite: entry.isComposite === true,
      compositeTitle: compositeTitle.value || null,
    });
  }
  return { ok: true, value: out };
}

export async function POST(request: NextRequest) {
  try {
    // 10 creates per minute per IP. Far above any realistic human
    // checkout rate; tight enough to kill scripts hammering orders.
    const limitResult = rateLimit(getClientIp(request), {
      namespace: "orders-create",
      limit: 10,
      windowSeconds: 60,
    });
    if (!limitResult.allowed) {
      return NextResponse.json(
        { ok: false, message: "Too many orders. Please wait a moment and try again." },
        {
          status: 429,
          headers: {
            "Retry-After": Math.max(
              1,
              Math.ceil((limitResult.resetAt - Date.now()) / 1000),
            ).toString(),
          },
        },
      );
    }

    const parsed = (await request.json().catch(() => null)) as unknown;
    const bodyResult = ensureObjectBody(parsed);
    if (!bodyResult.ok) {
      return NextResponse.json(
        { ok: false, message: bodyResult.message },
        { status: 400 },
      );
    }
    const body = bodyResult.value;

    const mode = typeof body.mode === "string" ? body.mode.trim().toLowerCase() : "school";
    if (mode !== "school" && mode !== "event") {
      return NextResponse.json(
        { ok: false, message: "mode must be 'school' or 'event'." },
        { status: 400 },
      );
    }

    // ── common validation ───────────────────────────────────────────────
    const pinResult = validateString(body.pin, "pin", { min: 3, max: 64 });
    if (!pinResult.ok) {
      return NextResponse.json({ ok: false, message: pinResult.message }, { status: 400 });
    }

    const parentResult = validateParent(body.parent);
    if (!parentResult.ok) {
      return NextResponse.json(
        { ok: false, message: parentResult.message },
        { status: 400 },
      );
    }
    const parent = parentResult.value;

    const deliveryResult = validateDelivery(body.delivery);
    if (!deliveryResult.ok) {
      return NextResponse.json(
        { ok: false, message: deliveryResult.message },
        { status: 400 },
      );
    }
    const delivery = deliveryResult.value;

    const notesResult = validateOptionalString(body.notes, "notes", MAX_NOTES_LENGTH);
    if (!notesResult.ok) {
      return NextResponse.json(
        { ok: false, message: notesResult.message },
        { status: 400 },
      );
    }
    const notes = notesResult.value;

    const entriesResult = validateEntries(body.entries);
    if (!entriesResult.ok) {
      return NextResponse.json(
        { ok: false, message: entriesResult.message },
        { status: 400 },
      );
    }
    const entries = entriesResult.value;

    // ── mode-specific access + photographer resolution ──────────────────
    let photographerId: string;
    let schoolId: string | null = null;
    let student: StudentRow | null = null;
    let projectId: string | null = null;
    let projectTitle: string | null = null;
    let sb = createDashboardServiceClient();

    if (mode === "school") {
      const schoolIdResult = validateUuid(body.schoolId, "schoolId");
      if (!schoolIdResult.ok) {
        return NextResponse.json(
          { ok: false, message: schoolIdResult.message },
          { status: 400 },
        );
      }

      const { data: studentRow, error: studentError } = await sb
        .from("students")
        .select("id,school_id,class_id")
        .eq("pin", pinResult.value)
        .eq("school_id", schoolIdResult.value)
        .maybeSingle<StudentRow>();
      if (studentError) throw studentError;
      if (!studentRow) {
        return NextResponse.json(
          { ok: false, message: "We couldn't match that PIN to a student at this school." },
          { status: 404 },
        );
      }

      const { data: schoolRow, error: schoolError } = await sb
        .from("schools")
        .select("id,photographer_id,order_due_date,expiration_date")
        .eq("id", schoolIdResult.value)
        .maybeSingle<SchoolRow>();
      if (schoolError) throw schoolError;
      if (!schoolRow?.photographer_id) {
        return NextResponse.json(
          { ok: false, message: "This school is not linked to a photographer." },
          { status: 404 },
        );
      }

      if (!isOrderingWindowOpen(schoolRow)) {
        return NextResponse.json(
          { ok: false, message: "Ordering is no longer available for this gallery." },
          { status: 410 },
        );
      }

      student = studentRow;
      schoolId = schoolRow.id;
      photographerId = schoolRow.photographer_id;
    } else {
      const projectIdResult = validateUuid(body.projectId, "projectId");
      if (!projectIdResult.ok) {
        return NextResponse.json(
          { ok: false, message: projectIdResult.message },
          { status: 400 },
        );
      }
      const eventEmailResult = validateEmail(body.email, "email");
      if (!eventEmailResult.ok) {
        return NextResponse.json(
          { ok: false, message: eventEmailResult.message },
          { status: 400 },
        );
      }

      const access = await validateEventGalleryAccess({
        projectId: projectIdResult.value,
        email: eventEmailResult.value,
        pin: pinResult.value,
      });
      if (!access.ok) {
        return NextResponse.json(
          { ok: false, message: access.message },
          { status: access.status },
        );
      }
      if (!access.project.photographer_id) {
        return NextResponse.json(
          { ok: false, message: "This event is not linked to a photographer." },
          { status: 404 },
        );
      }

      if (!isOrderingWindowOpen(access.project)) {
        return NextResponse.json(
          { ok: false, message: "Ordering is no longer available for this gallery." },
          { status: 410 },
        );
      }

      sb = access.service;
      projectId = access.projectId;
      projectTitle = clean(access.project.title) || null;
      photographerId = access.project.photographer_id;
    }

    const { data: photographer, error: photographerError } = await sb
      .from("photographers")
      .select(
        "id,is_platform_admin,subscription_status,trial_starts_at,trial_ends_at,created_at",
      )
      .eq("id", photographerId)
      .maybeSingle<PhotographerGateRow>();

    if (photographerError) throw photographerError;
    if (!hasActiveSubscription(photographer)) {
      return NextResponse.json(
        { ok: false, message: "This gallery is no longer available." },
        { status: 410 },
      );
    }

    // ── resolve packages + backdrops in bulk ────────────────────────────
    const packageIds = Array.from(new Set(entries.map((e) => e.packageId)));
    const backdropIds = Array.from(
      new Set(entries.map((e) => e.backdrop?.id).filter((v): v is string => !!v)),
    );

    const { data: packageRows, error: packageError } = await sb
      .from("packages")
      .select("id,name,price_cents,photographer_id,category,active")
      .in("id", packageIds);
    if (packageError) throw packageError;

    const packageMap = new Map<string, PackageRow>();
    for (const row of (packageRows ?? []) as PackageRow[]) {
      packageMap.set(clean(row.id), row);
    }
    for (const pid of packageIds) {
      const pkg = packageMap.get(pid);
      if (!pkg || pkg.active === false) {
        return NextResponse.json(
          { ok: false, message: "A selected package is no longer available." },
          { status: 404 },
        );
      }
      if (clean(pkg.photographer_id) !== clean(photographerId)) {
        return NextResponse.json(
          { ok: false, message: "A selected package does not belong to this gallery." },
          { status: 400 },
        );
      }
      const cents = Number(pkg.price_cents);
      if (!Number.isFinite(cents) || cents <= 0) {
        return NextResponse.json(
          { ok: false, message: "A selected package is missing a valid price." },
          { status: 400 },
        );
      }
    }

    const backdropMap = new Map<string, BackdropRow>();
    if (backdropIds.length > 0) {
      const { data: backdropRows, error: backdropError } = await sb
        .from("backdrop_catalog")
        .select("id,name,image_url,tier,price_cents,photographer_id,active")
        .in("id", backdropIds);
      if (backdropError) throw backdropError;

      for (const row of (backdropRows ?? []) as BackdropRow[]) {
        backdropMap.set(clean(row.id), row);
      }
      for (const bid of backdropIds) {
        const bd = backdropMap.get(bid);
        if (!bd || bd.active === false) {
          return NextResponse.json(
            { ok: false, message: "A selected backdrop is no longer available." },
            { status: 404 },
          );
        }
        if (clean(bd.photographer_id) !== clean(photographerId)) {
          return NextResponse.json(
            { ok: false, message: "A selected backdrop does not belong to this gallery." },
            { status: 400 },
          );
        }
      }
    }

    // ── compute per-entry totals from authoritative rows ────────────────
    type ResolvedEntry = EntryPayload & {
      pkg: PackageRow;
      backdropRow: BackdropRow | null;
      packageSubtotalCents: number;
      backdropAddOnCents: number;
      lineTotalCents: number;
      isDigital: boolean;
    };

    const resolved: ResolvedEntry[] = entries.map((entry) => {
      const pkg = packageMap.get(entry.packageId) as PackageRow;
      const packagePriceCents = Math.round(Number(pkg.price_cents));
      const packageSubtotalCents = packagePriceCents * entry.quantity;
      let backdropRow: BackdropRow | null = null;
      let backdropAddOnCents = 0;
      if (entry.backdrop) {
        const bd = backdropMap.get(entry.backdrop.id) ?? null;
        backdropRow = bd;
        if (bd && clean(bd.tier).toLowerCase() === "premium") {
          const cents = Number(bd.price_cents);
          backdropAddOnCents =
            Number.isFinite(cents) && cents > 0 ? Math.round(cents) : 0;
        }
      }
      return {
        ...entry,
        pkg,
        backdropRow,
        packageSubtotalCents,
        backdropAddOnCents,
        lineTotalCents: packageSubtotalCents + backdropAddOnCents,
        isDigital: isDigitalCategory(pkg),
      };
    });

    const orderTotalCents = resolved.reduce((sum, e) => sum + e.lineTotalCents, 0);
    if (!Number.isFinite(orderTotalCents) || orderTotalCents <= 0) {
      return NextResponse.json(
        { ok: false, message: "Order total is invalid." },
        { status: 400 },
      );
    }

    const anyPhysical = resolved.some((e) => !e.isDigital);
    if (!anyPhysical && delivery.method === "shipping") {
      // Digital-only carts don't ship anywhere; quietly treat as pickup.
      (delivery as unknown as { method: string }).method = "pickup";
    }

    // ── build server-trusted notes block ────────────────────────────────
    const entryNotes = resolved.map((entry, index) => {
      const entryName = entry.isComposite
        ? `Composite • ${clean(entry.pkg.name) || "Package"}`
        : clean(entry.pkg.name) || "Package";
      const compositeNote =
        entry.isComposite && entry.compositeTitle
          ? `CLASS COMPOSITE: ${entry.compositeTitle}`
          : "";
      const backdropNote = entry.backdropRow
        ? `BACKDROP: ${clean(entry.backdropRow.name) || "Backdrop"}${
            clean(entry.backdropRow.tier).toLowerCase() === "premium"
              ? ` (Premium · $${(entry.backdropAddOnCents / 100).toFixed(2)})`
              : " (Included)"
          }${
            entry.backdrop?.blurred
              ? ` · Blurred ${entry.backdrop.blurAmount || DEFAULT_BACKDROP_BLUR_PX}px`
              : ""
          }`
        : "";
      const slotsSummary = entry.isDigital
        ? `Digital download order x${entry.quantity}`
        : entry.slots.length > 0
          ? entry.slots
              .map(
                (slot, i) =>
                  `Item ${i + 1}: ${slot.label} → ${slot.assignedImageUrl ?? "no photo"}`,
              )
              .join("\n")
          : "";

      return [
        `ORDER ITEM ${index + 1}: ${entryName}`,
        compositeNote,
        backdropNote,
        entry.isDigital
          ? "DIGITAL ORDER"
          : slotsSummary
            ? `PHOTO SELECTIONS:\n${slotsSummary}`
            : "",
      ]
        .filter(Boolean)
        .join("\n");
    });

    const shippingBlock =
      anyPhysical
        ? delivery.method === "shipping"
          ? [
              "Delivery: shipping",
              `Name: ${delivery.name}`,
              `Address: ${delivery.address1}`,
              delivery.address2 ? `Line 2: ${delivery.address2}` : "",
              `City: ${delivery.city}`,
              `Province: ${delivery.province}`,
              `Postal: ${delivery.postalCode}`,
            ]
              .filter(Boolean)
              .join("\n")
          : "Delivery: pickup"
        : "";

    const combinedNotes = [notes, ...entryNotes, shippingBlock]
      .filter(Boolean)
      .join("\n\n");

    // ── order summary name for the orders row ───────────────────────────
    const first = resolved[0];
    const firstName = first.isComposite
      ? `Composite • ${clean(first.pkg.name) || "Package"}`
      : clean(first.pkg.name) || "Package";
    const orderSummaryName =
      resolved.length === 1
        ? firstName
        : `${firstName} + ${resolved.length - 1} more`;

    // ── insert orders ───────────────────────────────────────────────────
    const parentName = parent.name || null;
    const parentPhone = parent.phone || null;

    const orderInsert: Record<string, unknown> = {
      photographer_id: photographerId,
      parent_name: parentName,
      parent_email: parent.email,
      parent_phone: parentPhone,
      customer_name: parentName,
      customer_email: parent.email,
      package_id: first.pkg.id,
      package_name: orderSummaryName,
      package_price: orderTotalCents / 100,
      special_notes: combinedNotes || null,
      notes: combinedNotes || null,
      status: "payment_pending",
      seen_by_photographer: false,
      subtotal_cents: orderTotalCents,
      tax_cents: 0,
      total_cents: orderTotalCents,
      total_amount: orderTotalCents / 100,
      currency: "cad",
    };

    if (mode === "school" && student && schoolId) {
      orderInsert.school_id = schoolId;
      orderInsert.class_id = student.class_id ?? null;
      orderInsert.student_id = student.id;
      orderInsert.project_id = null;
    } else if (mode === "event" && projectId) {
      orderInsert.project_id = projectId;
      orderInsert.school_id = null;
      orderInsert.student_id = null;
      orderInsert.class_id = null;
    }

    const { data: orderRow, error: orderErr } = await sb
      .from("orders")
      .insert(orderInsert)
      .select("id")
      .single();

    if (orderErr || !orderRow) throw orderErr ?? new Error("Failed to create order.");

    const orderId = orderRow.id;

    // ── build + insert order_items ──────────────────────────────────────
    const itemsToInsert: OrderItemInsert[] = [];
    for (const entry of resolved) {
      const pkgName = clean(entry.pkg.name) || "Package";
      if (entry.isDigital) {
        itemsToInsert.push({
          order_id: orderId,
          product_name: entry.isComposite ? `Composite • ${pkgName}` : pkgName,
          quantity: entry.quantity,
          price: entry.packageSubtotalCents / 100,
          unit_price_cents: Math.round(
            entry.packageSubtotalCents / Math.max(entry.quantity, 1),
          ),
          line_total_cents: entry.packageSubtotalCents,
          sku: entry.selectedImageUrl,
        });
      } else if (entry.slots.length > 0) {
        for (const slot of entry.slots) {
          const perSlot = Math.round(
            entry.packageSubtotalCents / Math.max(entry.slots.length, 1),
          );
          itemsToInsert.push({
            order_id: orderId,
            product_name: slot.label || "Item",
            quantity: 1,
            price: perSlot / 100,
            unit_price_cents: perSlot,
            line_total_cents: perSlot,
            sku: slot.assignedImageUrl ?? null,
          });
        }
      } else {
        // Physical package with no slots yet (shouldn't happen from the
        // client but don't let it silently drop a charge).
        itemsToInsert.push({
          order_id: orderId,
          product_name: pkgName,
          quantity: entry.quantity,
          price: entry.packageSubtotalCents / 100,
          unit_price_cents: Math.round(
            entry.packageSubtotalCents / Math.max(entry.quantity, 1),
          ),
          line_total_cents: entry.packageSubtotalCents,
          sku: entry.selectedImageUrl,
        });
      }

      if (entry.backdropAddOnCents > 0 && entry.backdropRow) {
        const blurSuffix = entry.backdrop?.blurred
          ? ` (Blurred ${entry.backdrop.blurAmount || DEFAULT_BACKDROP_BLUR_PX}px)`
          : "";
        itemsToInsert.push({
          order_id: orderId,
          product_name: `★ Premium Backdrop: ${clean(entry.backdropRow.name) || "Backdrop"}${blurSuffix}`,
          quantity: 1,
          price: entry.backdropAddOnCents / 100,
          unit_price_cents: entry.backdropAddOnCents,
          line_total_cents: entry.backdropAddOnCents,
          sku: clean(entry.backdropRow.image_url) || null,
        });
      }
    }

    const { error: itemsError } = await sb.from("order_items").insert(itemsToInsert);
    if (itemsError) {
      // Best-effort rollback of the orphan orders row.
      await sb.from("orders").delete().eq("id", orderId);
      throw itemsError;
    }

    return NextResponse.json({
      ok: true,
      orderId,
      mode,
      projectTitle,
    });
  } catch (error) {
    console.error("[portal:orders:create]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to create your order. Please try again." },
      { status: 500 },
    );
  }
}

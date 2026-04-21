import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
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
// Server-side order creation for the parents portal (school mode).
//
// Why this route exists:
//
// Previously the parents portal (app/parents/[pin]/page1.tsx) wrote the
// `orders` + `order_items` rows directly with the public anon key. A
// `parent_place_order` RLS policy allowed the insert with `WITH CHECK
// (true)`, which meant any anonymous caller could fabricate an `orders`
// row with arbitrary `total_cents` / `package_id` / `photographer_id` and
// then hand the orderId to /api/stripe/checkout.
//
// We already added a price-tampering guard inside /api/stripe/checkout
// (sum of order_items must match, total must be ≥ the authoritative
// package price). This route closes the vector at the source: clients
// now send us only "what was selected" (packageId, quantity, backdropId,
// slots, parent/delivery info). We look up the real package and backdrop
// prices server-side with the service client and compute totals
// ourselves. The anon key no longer touches `orders` at all.
//
// This is school-mode only for now. Event mode (multi-item carts with
// composites, per-entry backdrops, digital-vs-physical branching) is more
// complex and will get its own endpoint; leaving page.tsx untouched in
// this round.
// ──────────────────────────────────────────────────────────────────────────

const MAX_QUANTITY = 20;
const MAX_SLOTS = 20;
const MAX_NOTES_LENGTH = 2000;
const MAX_IMAGE_URL_LENGTH = 2048;
const MAX_LABEL_LENGTH = 120;

type SlotPayload = {
  label: string;
  assignedImageUrl: string | null;
};

type SchoolRow = {
  id: string;
  photographer_id: string | null;
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

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function isDigitalPackage(pkg: Pick<PackageRow, "category" | "name">) {
  const cat = clean(pkg.category).toLowerCase();
  if (cat === "digital") return true;
  const name = clean(pkg.name).toLowerCase();
  return (
    name.includes("digital") ||
    name.includes("download") ||
    name.includes("usb")
  );
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
): { ok: true; value: SlotPayload[] } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, message: "slots must be an array." };
  }
  if (raw.length > MAX_SLOTS) {
    return { ok: false, message: `Too many slots (max ${MAX_SLOTS}).` };
  }
  const out: SlotPayload[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, message: "slots contains an invalid entry." };
    }
    const slot = entry as Record<string, unknown>;
    const label = typeof slot.label === "string" ? slot.label.trim() : "";
    if (label.length > MAX_LABEL_LENGTH) {
      return { ok: false, message: "A slot label is too long." };
    }
    const rawImage = slot.assignedImageUrl;
    let assignedImageUrl: string | null = null;
    if (typeof rawImage === "string") {
      const trimmed = rawImage.trim();
      if (trimmed.length > MAX_IMAGE_URL_LENGTH) {
        return { ok: false, message: "A slot image URL is too long." };
      }
      assignedImageUrl = trimmed || null;
    } else if (rawImage !== undefined && rawImage !== null) {
      return { ok: false, message: "A slot image URL must be a string." };
    }
    out.push({ label: label || "Slot", assignedImageUrl });
  }
  return { ok: true, value: out };
}

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

function validateDelivery(
  raw: unknown,
): { ok: true; value: DeliveryPayload } | { ok: false; message: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "delivery must be an object." };
  }
  const d = raw as Record<string, unknown>;
  const method =
    typeof d.method === "string" ? d.method.trim().toLowerCase() : "";

  if (method === "pickup") {
    return { ok: true, value: { method: "pickup" } };
  }
  if (method !== "shipping") {
    return { ok: false, message: "delivery.method must be pickup or shipping." };
  }

  const required = [
    "name",
    "address1",
    "city",
    "province",
    "postalCode",
  ] as const;
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

export async function POST(request: NextRequest) {
  try {
    // 10 creates per minute per IP. Realistic parents place at most a
    // couple of orders per visit; 10 is a comfortable ceiling while still
    // blocking a script that tries to hammer the table.
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
    if (mode !== "school") {
      return NextResponse.json(
        { ok: false, message: "Only school-mode orders are supported on this endpoint yet." },
        { status: 400 },
      );
    }

    // PIN is a short numeric/alpha code printed on the take-home card.
    // We allow up to 32 chars and at least 3.
    const pinResult = validateString(body.pin, "pin", { min: 3, max: 32 });
    if (!pinResult.ok) {
      return NextResponse.json({ ok: false, message: pinResult.message }, { status: 400 });
    }

    const schoolIdResult = validateUuid(body.schoolId, "schoolId");
    if (!schoolIdResult.ok) {
      return NextResponse.json({ ok: false, message: schoolIdResult.message }, { status: 400 });
    }

    const packageIdResult = validateUuid(body.packageId, "packageId");
    if (!packageIdResult.ok) {
      return NextResponse.json({ ok: false, message: packageIdResult.message }, { status: 400 });
    }

    let backdropId: string | null = null;
    if (body.backdropId !== undefined && body.backdropId !== null && body.backdropId !== "") {
      const result = validateUuid(body.backdropId, "backdropId");
      if (!result.ok) {
        return NextResponse.json({ ok: false, message: result.message }, { status: 400 });
      }
      backdropId = result.value;
    }

    const rawQty = typeof body.quantity === "number" ? body.quantity : Number(body.quantity);
    if (!Number.isFinite(rawQty) || !Number.isInteger(rawQty) || rawQty < 1 || rawQty > MAX_QUANTITY) {
      return NextResponse.json(
        { ok: false, message: `quantity must be an integer between 1 and ${MAX_QUANTITY}.` },
        { status: 400 },
      );
    }
    const quantity = rawQty;

    const parentRaw = body.parent;
    if (!parentRaw || typeof parentRaw !== "object" || Array.isArray(parentRaw)) {
      return NextResponse.json(
        { ok: false, message: "parent info is required." },
        { status: 400 },
      );
    }
    const parentObj = parentRaw as Record<string, unknown>;
    const emailResult = validateEmail(parentObj.email, "parent.email");
    if (!emailResult.ok) {
      return NextResponse.json({ ok: false, message: emailResult.message }, { status: 400 });
    }
    const parentEmail = emailResult.value;

    const parentNameResult = validateOptionalString(parentObj.name, "parent.name", 200);
    if (!parentNameResult.ok) {
      return NextResponse.json(
        { ok: false, message: parentNameResult.message },
        { status: 400 },
      );
    }
    const parentPhoneResult = validateOptionalString(parentObj.phone, "parent.phone", 40);
    if (!parentPhoneResult.ok) {
      return NextResponse.json(
        { ok: false, message: parentPhoneResult.message },
        { status: 400 },
      );
    }

    const deliveryResult = validateDelivery(body.delivery);
    if (!deliveryResult.ok) {
      return NextResponse.json(
        { ok: false, message: deliveryResult.message },
        { status: 400 },
      );
    }
    const delivery = deliveryResult.value;

    const slotsResult = validateSlots(body.slots);
    if (!slotsResult.ok) {
      return NextResponse.json(
        { ok: false, message: slotsResult.message },
        { status: 400 },
      );
    }
    const slots = slotsResult.value;

    const notesResult = validateOptionalString(body.notes, "notes", MAX_NOTES_LENGTH);
    if (!notesResult.ok) {
      return NextResponse.json(
        { ok: false, message: notesResult.message },
        { status: 400 },
      );
    }
    const notes = notesResult.value;

    const sb = createDashboardServiceClient();

    // Verify the PIN matches a student actually enrolled at this school.
    // Without this, any caller who can guess (or guess-and-check) PINs
    // could create orders pointed at arbitrary students.
    const { data: student, error: studentError } = await sb
      .from("students")
      .select("id,school_id,class_id")
      .eq("pin", pinResult.value)
      .eq("school_id", schoolIdResult.value)
      .maybeSingle<StudentRow>();

    if (studentError) throw studentError;
    if (!student) {
      return NextResponse.json(
        { ok: false, message: "We couldn't match that PIN to a student at this school." },
        { status: 404 },
      );
    }

    const { data: school, error: schoolError } = await sb
      .from("schools")
      .select("id,photographer_id")
      .eq("id", schoolIdResult.value)
      .maybeSingle<SchoolRow>();

    if (schoolError) throw schoolError;
    if (!school?.photographer_id) {
      return NextResponse.json(
        { ok: false, message: "This school is not linked to a photographer yet." },
        { status: 404 },
      );
    }

    const { data: photographer, error: photographerError } = await sb
      .from("photographers")
      .select(
        "id,is_platform_admin,subscription_status,trial_starts_at,trial_ends_at,created_at",
      )
      .eq("id", school.photographer_id)
      .maybeSingle<PhotographerGateRow>();

    if (photographerError) throw photographerError;
    if (!hasActiveSubscription(photographer)) {
      return NextResponse.json(
        { ok: false, message: "This gallery is no longer available." },
        { status: 410 },
      );
    }

    // Authoritative package lookup. Must belong to this photographer and
    // be active — prevents pointing at a cheap package from a different
    // studio, and prevents reviving disabled/old packages.
    const { data: pkg, error: packageError } = await sb
      .from("packages")
      .select("id,name,price_cents,photographer_id,category,active")
      .eq("id", packageIdResult.value)
      .maybeSingle<PackageRow>();

    if (packageError) throw packageError;
    if (!pkg || pkg.active === false) {
      return NextResponse.json(
        { ok: false, message: "That package is no longer available." },
        { status: 404 },
      );
    }
    if (clean(pkg.photographer_id) !== clean(school.photographer_id)) {
      return NextResponse.json(
        { ok: false, message: "That package does not belong to this school." },
        { status: 400 },
      );
    }
    const packagePriceCents = Number(pkg.price_cents);
    if (!Number.isFinite(packagePriceCents) || packagePriceCents <= 0) {
      return NextResponse.json(
        { ok: false, message: "That package is missing a valid price." },
        { status: 400 },
      );
    }

    // Backdrop lookup (optional). Same ownership + active guardrails.
    // Only premium tier adds to the total.
    let backdrop: BackdropRow | null = null;
    let backdropAddOnCents = 0;
    if (backdropId) {
      const { data: backdropRow, error: backdropError } = await sb
        .from("backdrop_catalog")
        .select("id,name,image_url,tier,price_cents,photographer_id,active")
        .eq("id", backdropId)
        .maybeSingle<BackdropRow>();

      if (backdropError) throw backdropError;
      if (!backdropRow || backdropRow.active === false) {
        return NextResponse.json(
          { ok: false, message: "That backdrop is no longer available." },
          { status: 404 },
        );
      }
      if (clean(backdropRow.photographer_id) !== clean(school.photographer_id)) {
        return NextResponse.json(
          { ok: false, message: "That backdrop does not belong to this school." },
          { status: 400 },
        );
      }
      backdrop = backdropRow;
      if (clean(backdrop.tier).toLowerCase() === "premium") {
        const cents = Number(backdrop.price_cents);
        backdropAddOnCents = Number.isFinite(cents) && cents > 0 ? Math.round(cents) : 0;
      }
    }

    const subtotalCents = packagePriceCents * quantity;
    const totalCents = subtotalCents + backdropAddOnCents;
    const isDigital = isDigitalPackage(pkg);

    // Build the combined notes block server-side so the photographer's
    // packing slip still gets the same info the old client-side flow
    // produced. We only trust the free-form `notes` field from the
    // client; everything structured (backdrop line, slots summary,
    // shipping block) we reconstruct from validated inputs.
    const backdropNote = backdrop
      ? `BACKDROP: ${clean(backdrop.name) || "Backdrop"}${
          clean(backdrop.tier).toLowerCase() === "premium"
            ? ` (Premium · $${(backdropAddOnCents / 100).toFixed(2)})`
            : " (Included)"
        }`
      : "";

    const slotsSummary = isDigital
      ? "Digital download order"
      : slots.length > 0
        ? slots
            .map(
              (s, i) =>
                `Item ${i + 1}: ${s.label} → ${s.assignedImageUrl ?? "no photo"}`,
            )
            .join("\n")
        : "";

    const shippingBlock =
      delivery.method === "shipping"
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
        : "Delivery: pickup";

    const combinedNotes = [
      notes,
      backdropNote,
      isDigital
        ? "DIGITAL ORDER"
        : slotsSummary
          ? `PHOTO SELECTIONS:\n${slotsSummary}`
          : "",
      shippingBlock,
    ]
      .filter(Boolean)
      .join("\n\n");

    const parentNameFinal = parentNameResult.value || null;
    const parentPhoneFinal = parentPhoneResult.value || null;

    const { data: orderRow, error: orderErr } = await sb
      .from("orders")
      .insert({
        school_id: school.id,
        class_id: student.class_id ?? null,
        student_id: student.id,
        photographer_id: school.photographer_id,
        parent_name: parentNameFinal,
        parent_email: parentEmail,
        parent_phone: parentPhoneFinal,
        customer_name: parentNameFinal,
        customer_email: parentEmail,
        package_id: pkg.id,
        package_name: pkg.name ?? null,
        package_price: packagePriceCents / 100,
        special_notes: combinedNotes || null,
        notes: combinedNotes || null,
        status: "payment_pending",
        seen_by_photographer: false,
        subtotal_cents: subtotalCents,
        tax_cents: 0,
        total_cents: totalCents,
        total_amount: totalCents / 100,
        currency: "cad",
      })
      .select("id")
      .single();

    if (orderErr || !orderRow) throw orderErr ?? new Error("Failed to create order.");

    const orderId = orderRow.id;

    type OrderItemInsert = {
      order_id: string;
      product_name: string;
      quantity: number;
      price: number;
      unit_price_cents: number;
      line_total_cents: number;
      sku: string | null;
    };

    const itemsToInsert: OrderItemInsert[] = isDigital
      ? [
          {
            order_id: orderId,
            product_name: pkg.name ?? "Digital package",
            quantity,
            price: packagePriceCents / 100,
            unit_price_cents: packagePriceCents,
            line_total_cents: subtotalCents,
            sku: slots.find((s) => s.assignedImageUrl)?.assignedImageUrl ?? null,
          },
        ]
      : slots.length > 0
        ? slots.map((slot) => {
            const perSlotTotal = Math.round(subtotalCents / Math.max(slots.length, 1));
            return {
              order_id: orderId,
              product_name: slot.label || "Item",
              quantity: 1,
              price: perSlotTotal / 100,
              unit_price_cents: perSlotTotal,
              line_total_cents: perSlotTotal,
              sku: slot.assignedImageUrl ?? null,
            };
          })
        : [
            {
              order_id: orderId,
              product_name: pkg.name ?? "Package",
              quantity,
              price: packagePriceCents / 100,
              unit_price_cents: packagePriceCents,
              line_total_cents: subtotalCents,
              sku: null,
            },
          ];

    if (backdropAddOnCents > 0 && backdrop) {
      itemsToInsert.push({
        order_id: orderId,
        product_name: `★ Premium Backdrop: ${clean(backdrop.name) || "Backdrop"}`,
        quantity: 1,
        price: backdropAddOnCents / 100,
        unit_price_cents: backdropAddOnCents,
        line_total_cents: backdropAddOnCents,
        sku: clean(backdrop.image_url) || null,
      });
    }

    const { error: itemsError } = await sb.from("order_items").insert(itemsToInsert);
    if (itemsError) {
      // Best-effort rollback: delete the orphan orders row so the client
      // can retry without leaving a zombie draft behind.
      await sb.from("orders").delete().eq("id", orderId);
      throw itemsError;
    }

    return NextResponse.json({ ok: true, orderId });
  } catch (error) {
    console.error("[portal:orders:create]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to create your order. Please try again." },
      { status: 500 },
    );
  }
}

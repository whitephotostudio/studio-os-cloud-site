// POST /api/portal/orders/create-combined
//
// Multi-student / cross-year combined checkout.  Companion to the legacy
// /api/portal/orders/create endpoint — that route still serves the
// single-student flow untouched; this one is opted into when a parent has
// added items from more than one student gallery.
//
// Spec: docs/design/combine-orders-and-recovery.md (sections 4.1, 5).
//
// Request body shape:
//   {
//     groups: [
//       {
//         pin: string,                 // PIN that authenticates the gallery
//         schoolId: string,            // school the PIN belongs to (event mode is Phase 2)
//         email: string,               // typed parent email — must match this group's auth
//         entries: [ ...same shape as single-student route... ],
//       },
//       ...
//     ],
//     parent: { name, email, phone },  // shared customer + invoice contact
//     delivery: { method: 'pickup' | 'shipping', ... },
//     notes?: string,
//   }
//
// Server contract:
//   1. Validates each group (PIN ↔ student ↔ school ↔ photographer)
//   2. Refuses if any group spans a different photographer (cross-studio
//      combining is not allowed — keeps tenancy clean)
//   3. Resolves authoritative prices for every package + backdrop
//   4. Computes per-group subtotals → applies sibling discount tier
//   5. Resolves shipping (forces shipping + late handling if any group is
//      past its order_due_date)
//   6. Inserts N orders sharing one fresh order_group_id; the FIRST order
//      carries the shipping + handling fee on top of its product subtotal
//   7. Inserts order_items rows
//   8. Returns { orderGroupId, orderIds, primaryOrderId, totals }
//
// The follow-up /api/stripe/checkout call uses primaryOrderId for the
// Stripe Checkout Session; the webhook fans out to every member of the
// group via finalizePaidOrderOrGroup (already in lib/payments.ts).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { isOrderingWindowOpen } from "@/lib/ordering-window";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { hasActiveSubscription } from "@/lib/subscription-gate";
import { parseJson } from "@/lib/api-validation";
import {
  computeCombineTotals,
  type CombineGroup,
  type SiblingDiscountTiers,
} from "@/lib/combine-orders";

export const dynamic = "force-dynamic";

// ── Limits ────────────────────────────────────────────────────────────

const MAX_GROUPS = 6; // No realistic family combines more than 6 students.
const MAX_ENTRIES_PER_GROUP = 10;
const MAX_QUANTITY = 20;
const MAX_SLOTS = 20;
const MAX_NOTES_LENGTH = 2000;
const MAX_IMAGE_URL_LENGTH = 2048;
const MAX_LABEL_LENGTH = 120;
const MAX_COMPOSITE_TITLE_LENGTH = 200;
const MIN_BACKDROP_BLUR_PX = 4;
const MAX_BACKDROP_BLUR_PX = 24;
const DEFAULT_BACKDROP_BLUR_PX = 4;

// ── Zod schemas ───────────────────────────────────────────────────────

const SlotSchema = z.object({
  label: z.string().trim().max(MAX_LABEL_LENGTH).optional().default("Item"),
  assignedImageUrl: z
    .string()
    .trim()
    .max(MAX_IMAGE_URL_LENGTH)
    .nullable()
    .optional(),
});

const BackdropSchema = z
  .object({
    id: z.string().uuid(),
    blurred: z.boolean().optional().default(false),
    blurAmount: z.number().optional(),
  })
  .nullable()
  .optional();

const EntrySchema = z.object({
  packageId: z.string().uuid(),
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
  backdrop: BackdropSchema,
  slots: z.array(SlotSchema).max(MAX_SLOTS).optional().default([]),
  selectedImageUrl: z.string().trim().max(MAX_IMAGE_URL_LENGTH).nullable().optional(),
  isComposite: z.boolean().optional().default(false),
  compositeTitle: z.string().trim().max(MAX_COMPOSITE_TITLE_LENGTH).nullable().optional(),
  // 2026-04-25: backdrop orientation chosen by the parent.  Server doesn't
  // enforce that the picked backdrop's catalog row has supports_landscape
  // === true (the desktop lab will see "Landscape" in the order summary
  // and produce the wide print regardless).  Default "portrait".
  orientation: z.enum(["portrait", "landscape"]).optional().default("portrait"),
});

const GroupSchema = z.object({
  pin: z.string().trim().min(3).max(64),
  schoolId: z.string().uuid(),
  email: z.string().trim().email().max(320),
  entries: z.array(EntrySchema).min(1).max(MAX_ENTRIES_PER_GROUP),
});

const DeliverySchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("pickup") }),
  z.object({
    method: z.literal("shipping"),
    name: z.string().trim().min(1).max(200),
    address1: z.string().trim().min(1).max(200),
    address2: z.string().trim().max(200).optional().default(""),
    city: z.string().trim().min(1).max(200),
    province: z.string().trim().min(1).max(200),
    postalCode: z.string().trim().min(1).max(200),
  }),
]);

const ParentSchema = z.object({
  name: z.string().trim().max(200).optional().default(""),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().max(40).optional().default(""),
});

const BodySchema = z.object({
  groups: z.array(GroupSchema).min(1).max(MAX_GROUPS),
  parent: ParentSchema,
  delivery: DeliverySchema,
  notes: z.string().trim().max(MAX_NOTES_LENGTH).optional().default(""),
});

type Body = z.infer<typeof BodySchema>;

// ── Helpers ───────────────────────────────────────────────────────────

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function isDigitalCategory(category: string | null | undefined, name: string | null | undefined) {
  const c = clean(category).toLowerCase();
  if (c === "digital") return true;
  const n = clean(name).toLowerCase();
  return n.includes("digital") || n.includes("download") || n.includes("usb");
}

/** Past order_due_date? Returns true to force shipping + handling fee. */
function isPastDueDate(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false;
  const ms = Date.parse(dueDate);
  if (!Number.isFinite(ms)) return false;
  return ms < Date.now();
}

// ── Route handler ─────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Rate limit: a combined order is heavier than a single-order create,
  // but a real parent only does this once or twice.  Keep it tight.
  const limit = await rateLimit(getClientIp(request), {
    namespace: "orders-create-combined",
    limit: 6,
    windowSeconds: 60,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, message: "Too many checkout attempts. Please wait a moment." },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000)),
          ),
        },
      },
    );
  }

  const parsed = await parseJson(request, BodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  try {
    const sb = createDashboardServiceClient();

    // ── Validate every group: PIN ↔ student ↔ school ↔ photographer ──
    type ResolvedGroup = {
      groupIndex: number;
      input: Body["groups"][number];
      photographerId: string;
      schoolId: string;
      schoolName: string | null;
      classId: string | null;
      studentId: string;
      studentFirstName: string | null;
      studentLastName: string | null;
      orderDueDate: string | null;
      isLate: boolean;
    };

    const resolvedGroups: ResolvedGroup[] = [];
    let sharedPhotographerId: string | null = null;
    let anyGroupLate = false;

    for (let i = 0; i < body.groups.length; i++) {
      const group = body.groups[i];

      const { data: studentRow, error: studentErr } = await sb
        .from("students")
        .select("id, first_name, last_name, school_id, class_id")
        .eq("pin", group.pin)
        .eq("school_id", group.schoolId)
        .maybeSingle();
      if (studentErr) throw studentErr;
      if (!studentRow) {
        return NextResponse.json(
          {
            ok: false,
            message: `We couldn't match the PIN for student #${i + 1}. Double-check the PIN and school.`,
            failedGroupIndex: i,
          },
          { status: 404 },
        );
      }

      const { data: schoolRow, error: schoolErr } = await sb
        .from("schools")
        .select(
          "id, school_name, photographer_id, order_due_date, expiration_date",
        )
        .eq("id", group.schoolId)
        .maybeSingle();
      if (schoolErr) throw schoolErr;
      if (!schoolRow?.photographer_id) {
        return NextResponse.json(
          {
            ok: false,
            message: `Gallery #${i + 1} is not linked to a photographer.`,
            failedGroupIndex: i,
          },
          { status: 404 },
        );
      }

      if (!isOrderingWindowOpen(schoolRow as unknown as { order_due_date?: string | null; expiration_date?: string | null })) {
        return NextResponse.json(
          {
            ok: false,
            message: `Ordering is no longer available for gallery #${i + 1}.`,
            failedGroupIndex: i,
          },
          { status: 410 },
        );
      }

      // Tenancy guard — every group must belong to the SAME studio.
      // Cross-studio combining is explicitly out-of-scope per the design.
      if (!sharedPhotographerId) {
        sharedPhotographerId = schoolRow.photographer_id as string;
      } else if (schoolRow.photographer_id !== sharedPhotographerId) {
        return NextResponse.json(
          {
            ok: false,
            message:
              "All combined siblings must belong to the same studio. Please remove items from a different studio's gallery before checking out.",
            failedGroupIndex: i,
          },
          { status: 400 },
        );
      }

      const dueDate = (schoolRow.order_due_date as string | null) ?? null;
      const isLate = isPastDueDate(dueDate);
      if (isLate) anyGroupLate = true;

      resolvedGroups.push({
        groupIndex: i,
        input: group,
        photographerId: schoolRow.photographer_id as string,
        schoolId: schoolRow.id as string,
        schoolName: (schoolRow.school_name as string | null) ?? null,
        classId: (studentRow.class_id as string | null) ?? null,
        studentId: studentRow.id as string,
        studentFirstName: (studentRow.first_name as string | null) ?? null,
        studentLastName: (studentRow.last_name as string | null) ?? null,
        orderDueDate: dueDate,
        isLate,
      });
    }

    if (!sharedPhotographerId) {
      return NextResponse.json(
        { ok: false, message: "Could not resolve studio for this order." },
        { status: 400 },
      );
    }

    // ── Photographer subscription gate + commerce knobs ─────────────────
    const { data: photographer, error: photographerErr } = await sb
      .from("photographers")
      .select(
        "id, is_platform_admin, subscription_status, trial_starts_at, trial_ends_at, created_at, sibling_discount_tiers, shipping_fee_cents, late_handling_fee_percent",
      )
      .eq("id", sharedPhotographerId)
      .maybeSingle();
    if (photographerErr) throw photographerErr;
    if (!hasActiveSubscription(photographer)) {
      return NextResponse.json(
        { ok: false, message: "This studio is no longer accepting orders." },
        { status: 410 },
      );
    }

    const tiers: SiblingDiscountTiers =
      (photographer?.sibling_discount_tiers as SiblingDiscountTiers | null) ?? {};
    const shippingFeeCents = Number(photographer?.shipping_fee_cents ?? 0) || 0;
    const lateHandlingFeePercent =
      Number(photographer?.late_handling_fee_percent ?? 10) || 10;

    // ── Resolve packages + backdrops in bulk ────────────────────────────
    const allPackageIds = Array.from(
      new Set(
        resolvedGroups.flatMap((g) => g.input.entries.map((e) => e.packageId)),
      ),
    );
    const allBackdropIds = Array.from(
      new Set(
        resolvedGroups.flatMap((g) =>
          g.input.entries
            .map((e) => e.backdrop?.id)
            .filter((v): v is string => !!v),
        ),
      ),
    );

    const { data: packageRows, error: packageErr } = await sb
      .from("packages")
      .select("id, name, price_cents, photographer_id, category, active")
      .in("id", allPackageIds);
    if (packageErr) throw packageErr;
    const packageMap = new Map<string, {
      id: string;
      name: string | null;
      price_cents: number | null;
      photographer_id: string | null;
      category: string | null;
      active: boolean | null;
    }>();
    for (const row of (packageRows ?? []) as Array<typeof packageMap extends Map<string, infer V> ? V : never>) {
      packageMap.set(clean(row.id), row);
    }
    for (const pid of allPackageIds) {
      const pkg = packageMap.get(pid);
      if (!pkg || pkg.active === false) {
        return NextResponse.json(
          { ok: false, message: "A selected package is no longer available." },
          { status: 404 },
        );
      }
      if (clean(pkg.photographer_id) !== sharedPhotographerId) {
        return NextResponse.json(
          { ok: false, message: "A selected package does not belong to this studio." },
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

    const backdropMap = new Map<string, {
      id: string;
      name: string | null;
      image_url: string | null;
      tier: string | null;
      price_cents: number | null;
      photographer_id: string | null;
      active: boolean | null;
    }>();
    if (allBackdropIds.length > 0) {
      const { data: backdropRows, error: backdropErr } = await sb
        .from("backdrop_catalog")
        .select("id, name, image_url, tier, price_cents, photographer_id, active")
        .in("id", allBackdropIds);
      if (backdropErr) throw backdropErr;
      for (const row of (backdropRows ?? []) as Array<typeof backdropMap extends Map<string, infer V> ? V : never>) {
        backdropMap.set(clean(row.id), row);
      }
      for (const bid of allBackdropIds) {
        const bd = backdropMap.get(bid);
        if (!bd || bd.active === false) {
          return NextResponse.json(
            { ok: false, message: "A selected backdrop is no longer available." },
            { status: 404 },
          );
        }
        if (clean(bd.photographer_id) !== sharedPhotographerId) {
          return NextResponse.json(
            { ok: false, message: "A selected backdrop does not belong to this studio." },
            { status: 400 },
          );
        }
      }
    }

    // ── Compute per-entry totals + per-group subtotals ──────────────────

    type ResolvedEntry = {
      groupIndex: number;
      packageId: string;
      packageName: string;
      quantity: number;
      packageSubtotalCents: number;
      backdropAddOnCents: number;
      lineTotalCents: number;
      isComposite: boolean;
      compositeTitle: string | null;
      isDigital: boolean;
      slots: { label: string; assignedImageUrl: string | null }[];
      selectedImageUrl: string | null;
      backdrop: {
        id: string;
        name: string;
        tier: string | null;
        imageUrl: string | null;
        blurred: boolean;
        blurAmount: number;
      } | null;
      /** 2026-04-25: portrait/landscape — surfaces in order_items product
       *  names so the lab knows which way to print this entry. */
      orientation: "portrait" | "landscape";
    };

    const resolvedEntries: ResolvedEntry[] = [];

    for (const grp of resolvedGroups) {
      for (const entry of grp.input.entries) {
        const pkg = packageMap.get(entry.packageId)!;
        const packagePriceCents = Math.round(Number(pkg.price_cents));
        const packageSubtotalCents = packagePriceCents * entry.quantity;

        let backdrop: ResolvedEntry["backdrop"] = null;
        let backdropAddOnCents = 0;
        if (entry.backdrop) {
          const bd = backdropMap.get(entry.backdrop.id);
          if (bd) {
            const isPremium = clean(bd.tier).toLowerCase() === "premium";
            if (isPremium) {
              const cents = Number(bd.price_cents);
              backdropAddOnCents =
                Number.isFinite(cents) && cents > 0 ? Math.round(cents) : 0;
            }
            const rawBlur =
              typeof entry.backdrop.blurAmount === "number"
                ? entry.backdrop.blurAmount
                : DEFAULT_BACKDROP_BLUR_PX;
            const blurAmount = entry.backdrop.blurred
              ? Math.min(
                  MAX_BACKDROP_BLUR_PX,
                  Math.max(MIN_BACKDROP_BLUR_PX, Math.round(rawBlur)),
                )
              : 0;
            backdrop = {
              id: bd.id as string,
              name: clean(bd.name) || "Backdrop",
              tier: bd.tier ?? null,
              imageUrl: bd.image_url ?? null,
              blurred: !!entry.backdrop.blurred,
              blurAmount,
            };
          }
        }

        resolvedEntries.push({
          groupIndex: grp.groupIndex,
          packageId: pkg.id as string,
          packageName: clean(pkg.name) || "Package",
          quantity: entry.quantity,
          packageSubtotalCents,
          backdropAddOnCents,
          lineTotalCents: packageSubtotalCents + backdropAddOnCents,
          isComposite: !!entry.isComposite,
          compositeTitle: entry.compositeTitle ?? null,
          isDigital: isDigitalCategory(pkg.category, pkg.name),
          slots: (entry.slots ?? []).map((s) => ({
            label: clean(s.label) || "Item",
            assignedImageUrl: s.assignedImageUrl ?? null,
          })),
          selectedImageUrl: entry.selectedImageUrl ?? null,
          backdrop,
          orientation: entry.orientation ?? "portrait",
        });
      }
    }

    // ── Combined totals (sibling discount + shipping + handling) ────────

    const groupSubtotalsByIndex = new Map<number, number>();
    for (const e of resolvedEntries) {
      groupSubtotalsByIndex.set(
        e.groupIndex,
        (groupSubtotalsByIndex.get(e.groupIndex) ?? 0) + e.lineTotalCents,
      );
    }
    const groups: CombineGroup[] = resolvedGroups.map((g) => ({
      key: g.studentId,
      subtotalCents: groupSubtotalsByIndex.get(g.groupIndex) ?? 0,
    }));

    const anyPhysical = resolvedEntries.some((e) => !e.isDigital);
    const requestedMethod: "pickup" | "shipping" =
      anyPhysical ? body.delivery.method : "pickup";

    const combineTotals = computeCombineTotals({
      groups,
      tiers,
      shipping: {
        requestedMethod,
        shippingFeeCents,
        lateHandlingFeePercent,
        anyGroupLate: anyPhysical && anyGroupLate,
      },
    });

    if (
      !Number.isFinite(combineTotals.grandTotalCents) ||
      combineTotals.grandTotalCents <= 0
    ) {
      return NextResponse.json(
        { ok: false, message: "Order total is invalid." },
        { status: 400 },
      );
    }

    // ── Insert N orders linked by order_group_id ────────────────────────

    const { data: groupIdRow, error: groupIdErr } = await sb.rpc(
      "gen_random_uuid",
    );
    let orderGroupId =
      typeof groupIdRow === "string" && groupIdRow ? groupIdRow : null;
    if (!orderGroupId) {
      // Fallback: postgres extension is enabled by default but in case it's
      // not exposed via RPC, we generate a v4 UUID here.  This is purely a
      // safety net — it should never fire on this database.
      orderGroupId = (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    }
    void groupIdErr;

    const parentName = body.parent.name || null;
    const parentPhone = body.parent.phone || null;

    // Pick the primary group: highest subtotal (matches the discount-math
    // "first kid full price" rule). The primary order also carries the
    // shipping + handling fee on top of its product subtotal.
    let primaryGroupIndex = 0;
    let primaryValue = combineTotals.groupTotals[0]?.subtotalCents ?? 0;
    for (let i = 1; i < combineTotals.groupTotals.length; i++) {
      if (combineTotals.groupTotals[i].subtotalCents > primaryValue) {
        primaryValue = combineTotals.groupTotals[i].subtotalCents;
        primaryGroupIndex = i;
      }
    }

    const insertedOrderIdByGroupIndex = new Map<number, string>();

    for (let gi = 0; gi < resolvedGroups.length; gi++) {
      const grp = resolvedGroups[gi];
      const totalsRow = combineTotals.groupTotals[gi];
      const isPrimary = gi === primaryGroupIndex;

      // Build the per-order summary name from this group's first entry.
      const firstEntry = resolvedEntries.find((e) => e.groupIndex === gi);
      const baseName = firstEntry?.packageName ?? "Package";
      const groupEntryCount = resolvedEntries.filter((e) => e.groupIndex === gi).length;
      const summaryName =
        groupEntryCount > 1 ? `${baseName} + ${groupEntryCount - 1} more` : baseName;

      const groupEntries = resolvedEntries.filter((e) => e.groupIndex === gi);

      const entryNotes = groupEntries.map((entry, idx) => {
        const entryName = entry.isComposite
          ? `Composite • ${entry.packageName}`
          : entry.packageName;
        const compositeNote =
          entry.isComposite && entry.compositeTitle
            ? `CLASS COMPOSITE: ${entry.compositeTitle}`
            : "";
        const backdropNote = entry.backdrop
          ? `BACKDROP: ${entry.backdrop.name}${
              clean(entry.backdrop.tier).toLowerCase() === "premium"
                ? ` (Premium · $${(entry.backdropAddOnCents / 100).toFixed(2)})`
                : " (Included)"
            }${
              entry.backdrop.blurred
                ? ` · Blurred ${entry.backdrop.blurAmount}px`
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
          `ORDER ITEM ${idx + 1}: ${entryName}`,
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
        isPrimary && combineTotals.shipping.effectiveMethod === "shipping" && body.delivery.method === "shipping"
          ? [
              "Delivery: shipping",
              `Name: ${body.delivery.name}`,
              `Address: ${body.delivery.address1}`,
              body.delivery.address2 ? `Line 2: ${body.delivery.address2}` : "",
              `City: ${body.delivery.city}`,
              `Province: ${body.delivery.province}`,
              `Postal: ${body.delivery.postalCode}`,
            ]
              .filter(Boolean)
              .join("\n")
          : isPrimary && combineTotals.shipping.effectiveMethod === "pickup"
            ? "Delivery: pickup"
            : "Delivery: combined order — see primary order for shipping";

      const combineMetaBlock = [
        `Combined order group ${orderGroupId}`,
        `Sibling tier: ${combineTotals.appliedTierPercent}% off additional siblings`,
        `Sibling discount this order: $${(totalsRow.discountCents / 100).toFixed(2)}`,
        isPrimary ? `Shipping: $${(combineTotals.shipping.shippingFeeCents / 100).toFixed(2)}` : null,
        isPrimary && combineTotals.shipping.handlingFeeCents > 0
          ? `Late handling: $${(combineTotals.shipping.handlingFeeCents / 100).toFixed(2)}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");

      const combinedNotes = [body.notes, ...entryNotes, shippingBlock, combineMetaBlock]
        .filter(Boolean)
        .join("\n\n");

      // Per-order total: product after discount, plus shipping + handling on PRIMARY only.
      const productAfterDiscountCents = totalsRow.finalCents;
      const shippingPortion = isPrimary
        ? combineTotals.shipping.shippingFeeCents +
          combineTotals.shipping.handlingFeeCents
        : 0;
      const orderTotalCents = productAfterDiscountCents + shippingPortion;

      const { data: orderRow, error: orderErr } = await sb
        .from("orders")
        .insert({
          photographer_id: sharedPhotographerId,
          parent_name: parentName,
          parent_email: body.parent.email,
          parent_phone: parentPhone,
          customer_name: parentName,
          customer_email: body.parent.email,
          package_id: firstEntry?.packageId ?? null,
          package_name: summaryName,
          package_price: orderTotalCents / 100,
          special_notes: combinedNotes || null,
          notes: combinedNotes || null,
          status: "payment_pending",
          seen_by_photographer: false,
          subtotal_cents: totalsRow.subtotalCents,
          tax_cents: 0,
          total_cents: orderTotalCents,
          total_amount: orderTotalCents / 100,
          currency: "cad",
          school_id: grp.schoolId,
          class_id: grp.classId,
          student_id: grp.studentId,
          project_id: null,
          order_group_id: orderGroupId,
        })
        .select("id")
        .single();

      if (orderErr || !orderRow) {
        // Roll back any orders we already inserted in this group so we
        // don't leave a half-formed group floating in the DB.
        const insertedIds = Array.from(insertedOrderIdByGroupIndex.values());
        if (insertedIds.length > 0) {
          await sb.from("orders").delete().in("id", insertedIds);
        }
        throw orderErr ?? new Error("Failed to create combined order.");
      }

      insertedOrderIdByGroupIndex.set(gi, orderRow.id as string);

      // Insert order_items for this group.
      type ItemInsert = {
        order_id: string;
        product_name: string;
        quantity: number;
        price: number;
        unit_price_cents: number;
        line_total_cents: number;
        sku: string | null;
      };
      const itemsToInsert: ItemInsert[] = [];
      for (const entry of groupEntries) {
        // 2026-04-25: tag every product name with the orientation when the
        // parent flipped this entry into landscape mode so the lab/sees
        // "Landscape" inline with each line.  Portrait stays unannotated to
        // keep existing receipts visually unchanged.
        const orientationSuffix =
          entry.orientation === "landscape" ? " (Landscape)" : "";
        if (entry.isDigital) {
          itemsToInsert.push({
            order_id: orderRow.id as string,
            product_name: (entry.isComposite
              ? `Composite • ${entry.packageName}`
              : entry.packageName) + orientationSuffix,
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
              order_id: orderRow.id as string,
              product_name: (slot.label || "Item") + orientationSuffix,
              quantity: 1,
              price: perSlot / 100,
              unit_price_cents: perSlot,
              line_total_cents: perSlot,
              sku: slot.assignedImageUrl ?? null,
            });
          }
        } else {
          itemsToInsert.push({
            order_id: orderRow.id as string,
            product_name: entry.packageName + orientationSuffix,
            quantity: entry.quantity,
            price: entry.packageSubtotalCents / 100,
            unit_price_cents: Math.round(
              entry.packageSubtotalCents / Math.max(entry.quantity, 1),
            ),
            line_total_cents: entry.packageSubtotalCents,
            sku: entry.selectedImageUrl,
          });
        }

        if (entry.backdropAddOnCents > 0 && entry.backdrop) {
          const blurSuffix = entry.backdrop.blurred
            ? ` (Blurred ${entry.backdrop.blurAmount}px)`
            : "";
          itemsToInsert.push({
            order_id: orderRow.id as string,
            product_name: `★ Premium Backdrop: ${entry.backdrop.name}${blurSuffix}`,
            quantity: 1,
            price: entry.backdropAddOnCents / 100,
            unit_price_cents: entry.backdropAddOnCents,
            line_total_cents: entry.backdropAddOnCents,
            sku: entry.backdrop.imageUrl,
          });
        }
      }

      // Surface the sibling discount as its own line item on non-primary
      // groups so the receipt clearly shows the savings.
      if (!isPrimary && totalsRow.discountCents > 0) {
        itemsToInsert.push({
          order_id: orderRow.id as string,
          product_name: `Sibling combine discount (${totalsRow.discountPercent}% off)`,
          quantity: 1,
          price: -(totalsRow.discountCents / 100),
          unit_price_cents: -totalsRow.discountCents,
          line_total_cents: -totalsRow.discountCents,
          sku: null,
        });
      }

      // Surface shipping + handling line items on the primary order only.
      if (isPrimary && combineTotals.shipping.shippingFeeCents > 0) {
        itemsToInsert.push({
          order_id: orderRow.id as string,
          product_name:
            combineTotals.shipping.effectiveMethod === "shipping"
              ? combineTotals.shipping.forcedDueToLate
                ? "Shipping (late — pickup window closed)"
                : "Shipping"
              : "Shipping",
          quantity: 1,
          price: combineTotals.shipping.shippingFeeCents / 100,
          unit_price_cents: combineTotals.shipping.shippingFeeCents,
          line_total_cents: combineTotals.shipping.shippingFeeCents,
          sku: null,
        });
      }
      if (isPrimary && combineTotals.shipping.handlingFeeCents > 0) {
        itemsToInsert.push({
          order_id: orderRow.id as string,
          product_name: `Late handling (${lateHandlingFeePercent}%)`,
          quantity: 1,
          price: combineTotals.shipping.handlingFeeCents / 100,
          unit_price_cents: combineTotals.shipping.handlingFeeCents,
          line_total_cents: combineTotals.shipping.handlingFeeCents,
          sku: null,
        });
      }

      const { error: itemsErr } = await sb.from("order_items").insert(itemsToInsert);
      if (itemsErr) {
        // Rollback all inserted orders in the group.
        const insertedIds = Array.from(insertedOrderIdByGroupIndex.values());
        if (insertedIds.length > 0) {
          await sb.from("orders").delete().in("id", insertedIds);
        }
        throw itemsErr;
      }
    }

    const orderIds = Array.from(insertedOrderIdByGroupIndex.values());
    const primaryOrderId = insertedOrderIdByGroupIndex.get(primaryGroupIndex);
    if (!primaryOrderId) {
      throw new Error("Failed to identify primary order in group.");
    }

    return NextResponse.json({
      ok: true,
      orderGroupId,
      orderIds,
      primaryOrderId,
      // Echo the totals back so the client can show a confirmation summary
      // before redirecting to Stripe.  Authoritative; client's preview math
      // should match.
      totals: {
        productSubtotalCents: combineTotals.productSubtotalCents,
        siblingDiscountCents: combineTotals.totalSiblingDiscountCents,
        appliedTierPercent: combineTotals.appliedTierPercent,
        shippingCents: combineTotals.shipping.shippingFeeCents,
        handlingCents: combineTotals.shipping.handlingFeeCents,
        forcedLate: combineTotals.shipping.forcedDueToLate,
        grandTotalCents: combineTotals.grandTotalCents,
      },
    });
  } catch (error) {
    console.error("[portal:orders:create-combined]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to create combined order. Please try again." },
      { status: 500 },
    );
  }
}

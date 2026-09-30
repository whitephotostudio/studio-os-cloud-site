import { lockOrderPayment } from "@/lib/order-payment-lock";
import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { assertStoredOrderBackdropCutouts } from "@/lib/stored-order-backdrop-preflight";
import { ParentCutoutPreflightError } from "@/lib/parent-cutout-preflight";
import { retouchPrintPurchaseIssue, type RetouchPrintPackage } from "@/lib/retouching";
import {
  createDirectOrderCheckoutSession,
  describeConnectStatus,
  getConnectedAccountId,
  isStripeBillingActive,
  retrieveStripeAccount,
  retrieveCheckoutSession,
  syncConnectState,
} from "@/lib/payments";
import {
  storedOrderTotalCents,
  sumStoredOrderItemTotalsCents,
  sumStoredOrderTotalsCents,
} from "@/lib/order-checkout-totals";

export const dynamic = "force-dynamic";

type OrderRow = {
  id: string;
  order_group_id: string | null;
  school_id: string | null;
  project_id: string | null;
  student_id: string | null;
  photographer_id: string | null;
  parent_email: string | null;
  customer_email: string | null;
  package_id: string | null;
  package_name: string | null;
  cart_snapshot?: unknown;
  special_notes?: string | null;
  notes?: string | null;
  subtotal_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  total_amount: number | null;
  currency: string | null;
  status: string | null;
  payment_status: string | null;
  stripe_checkout_session_id: string | null;
};

const ORDER_SELECT = "id,order_group_id,school_id,project_id,student_id,photographer_id,parent_email,customer_email,package_id,package_name,cart_snapshot,special_notes,notes,subtotal_cents,tax_cents,total_cents,total_amount,currency,status,payment_status,stripe_checkout_session_id";
type CheckoutItemRow = {
  line_total_cents: number | null;
  unit_price_cents: number | null;
  quantity: number | null;
  product_name: string | null;
  sku?: string | null;
};

type SchoolRow = {
  id: string;
  photographer_id: string | null;
  school_name: string | null;
};

type ProjectRow = {
  id: string;
  photographer_id: string | null;
  title: string | null;
  client_name: string | null;
};

type PhotographerRow = {
  id: string;
  business_name: string | null;
  stripe_account_id: string | null;
  stripe_connected_account_id: string | null;
  stripe_connect_onboarding_complete: boolean | null;
  stripe_connect_charges_enabled: boolean | null;
  stripe_connect_payouts_enabled: boolean | null;
  subscription_status: string | null;
  subscription_plan_code: string | null;
  is_platform_admin: boolean | null;
};

type CheckoutBody = {
  orderId?: string;
  pin?: string;
  schoolId?: string;
  projectId?: string;
  mode?: string;
  email?: string;
  customerEmail?: string;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function service() {
  return createDashboardServiceClient();
}

function baseUrl(req: NextRequest) {
  return new URL(req.url).origin.replace(/\/$/, "");
}

export async function POST(req: NextRequest) {
  let release: (() => Promise<void>) | undefined;
  try {
    const body = (await req.json()) as CheckoutBody;
    if (!body.orderId) {
      return NextResponse.json({ ok: false, message: "Missing orderId." }, { status: 400 });
    }

    const sb = service();
    const { data: initialOrder, error: orderError } = await sb
      .from("orders")
      .select(ORDER_SELECT)
      .eq("id", body.orderId)
      .maybeSingle<OrderRow>();

    if (orderError) throw orderError;
    if (!initialOrder) {
      return NextResponse.json({ ok: false, message: "Order draft not found." }, { status: 404 });
    }
    let order = initialOrder;

    let checkoutOrders: OrderRow[] = [order];
    if (order.order_group_id) {
      const { data: groupOrders, error: groupError, count: groupCount } = await sb
        .from("orders")
        .select(ORDER_SELECT, { count: "exact" })
        .eq("order_group_id", order.order_group_id)
        .order("id", { ascending: true });

      if (groupError) throw groupError;
      checkoutOrders = (groupOrders ?? []) as OrderRow[];
      if (
        checkoutOrders.length === 0 ||
        groupCount == null || checkoutOrders.length !== groupCount ||
        !checkoutOrders.some((member) => member.id === order.id)
      ) {
        return NextResponse.json(
          { ok: false, message: "This combined order is incomplete." },
          { status: 400 },
        );
      }
    }

    release = await lockOrderPayment(sb, order.order_group_id || order.id);
    // Re-read full scope, selections, totals and every group member under the
    // same payment lock cancellation uses. This does not freeze R2 assets.
    const currentQuery = sb.from("orders").select(ORDER_SELECT, { count: "exact" });
    const { data: currentOrders, error: currentError, count: currentCount } = order.order_group_id
      ? await currentQuery.eq("order_group_id", order.order_group_id).order("id", { ascending: true })
      : await currentQuery.in("id", [order.id]);
    if (currentError) throw currentError;
    const refreshed = (currentOrders ?? []) as OrderRow[];
    const refreshedOrder = refreshed.find(member => member.id === order.id);
    if (!refreshedOrder || (order.order_group_id && (currentCount == null || refreshed.length !== currentCount)) ||
        refreshed.some(member => member.order_group_id !== order.order_group_id) ||
        new Set(refreshed.map(member => member.id)).size !== refreshed.length ||
        checkoutOrders.some(member => !refreshed.some(row => row.id === member.id))) {
      return NextResponse.json({ ok: false, message: "This order changed. Please return to your gallery before paying." }, { status: 409 });
    }
    checkoutOrders = refreshed;
    order = refreshedOrder;
    if (checkoutOrders.some((member) => ["cancelled", "canceled", "cancel_pending", "refunded", "refund_pending"].includes(member.status || "") || ["refunded", "partially_refunded"].includes(member.payment_status || ""))) {
      return NextResponse.json({ ok: false, message: "This order is closed and cannot be charged again." }, { status: 409 });
    }

    if (
      checkoutOrders.some(
        (member) =>
          ["paid", "succeeded", "no_payment_required"].includes(
            (member.payment_status ?? "").toLowerCase(),
          ),
      )
    ) {
      return NextResponse.json(
        { ok: false, message: "This order has already been paid." },
        { status: 400 },
      );
    }

    // Read each saved line once. This also detects legacy premium-background
    // drafts whose exact selections were never saved. All members must pass
    // before Connect/provider calls, session reuse or checkout state writes.
    const itemsByOrder = new Map<string, CheckoutItemRow[]>();
    for (const checkoutOrder of checkoutOrders) {
      const { data: itemRows, error: itemError } = await sb.from("order_items")
        .select("line_total_cents,unit_price_cents,quantity,product_name,sku").eq("order_id", checkoutOrder.id);
      if (itemError) throw itemError;
      itemsByOrder.set(checkoutOrder.id, (itemRows ?? []) as CheckoutItemRow[]);
    }
    await assertStoredOrderBackdropCutouts(sb, checkoutOrders, itemsByOrder, body.pin);
    // A caller normally submits create-combined's primaryOrderId, but make the
    // Stripe/idempotency anchor deterministic for every member of the group.
    // This prevents a second Checkout Session if a retry names a sibling row.
    const checkoutAnchorOrder = order.order_group_id
      ? checkoutOrders[0] ?? order
      : order;

    const hasSavedScope = !!(order.school_id || order.project_id);
    const effectiveSchoolId = hasSavedScope ? order.school_id : body.schoolId || null;
    const effectiveProjectId = hasSavedScope ? order.project_id : body.projectId || null;
    const isEventOrder = order.school_id ? false : order.project_id ? true :
      (!effectiveSchoolId && !!effectiveProjectId) || body.mode === "event";

    let school: SchoolRow | null = null;
    let project: ProjectRow | null = null;
    let photographerId: string | null = order.photographer_id || null;

    if (isEventOrder) {
      if (!effectiveProjectId) {
        return NextResponse.json(
          { ok: false, message: "This event order is missing a project link." },
          { status: 400 },
        );
      }

      const { data: projectRow, error: projectError } = await sb
        .from("projects")
        .select("id,photographer_id,title,client_name")
        .eq("id", effectiveProjectId)
        .maybeSingle<ProjectRow>();

      if (projectError) throw projectError;
      if (!projectRow?.photographer_id) {
        return NextResponse.json(
          { ok: false, message: "Photographer record not found for this event." },
          { status: 404 },
        );
      }

      project = projectRow;
      photographerId = projectRow.photographer_id;
    } else {
      if (!effectiveSchoolId) {
        return NextResponse.json(
          { ok: false, message: "This order is missing a school link." },
          { status: 400 },
        );
      }

      const { data: schoolRow, error: schoolError } = await sb
        .from("schools")
        .select("id,photographer_id,school_name")
        .eq("id", effectiveSchoolId)
        .maybeSingle<SchoolRow>();

      if (schoolError) throw schoolError;
      if (!schoolRow?.photographer_id) {
        return NextResponse.json(
          { ok: false, message: "Photographer record not found for this school." },
          { status: 404 },
        );
      }

      school = schoolRow;
      photographerId = schoolRow.photographer_id;
    }

    if (
      order.order_group_id &&
      checkoutOrders.some(
        (member) =>
          !member.photographer_id || member.photographer_id !== photographerId,
      )
    ) {
      console.error("[stripe:checkout] order-group photographer mismatch", {
        orderId: order.id,
        orderGroupId: order.order_group_id,
      });
      return NextResponse.json(
        { ok: false, message: "This combined order is invalid." },
        { status: 400 },
      );
    }

    const { data: photographer, error: photographerError } = await sb
      .from("photographers")
      .select(
        "id,business_name,stripe_account_id,stripe_connected_account_id,stripe_connect_onboarding_complete,stripe_connect_charges_enabled,stripe_connect_payouts_enabled,subscription_status,subscription_plan_code,is_platform_admin",
      )
      .eq("id", photographerId)
      .maybeSingle<PhotographerRow>();

    if (photographerError) throw photographerError;
    if (!photographer?.id) {
      return NextResponse.json(
        { ok: false, message: "Photographer profile not found." },
        { status: 404 },
      );
    }

    if (!photographer.is_platform_admin && !isStripeBillingActive(photographer.subscription_status)) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "This studio’s Studio OS subscription is inactive. Customer checkout is unavailable until billing is reactivated.",
        },
        { status: 403 },
      );
    }

    const stripeAccountId = getConnectedAccountId(photographer);
    if (!stripeAccountId) {
      return NextResponse.json(
        { ok: false, message: "This photographer has not connected Stripe yet." },
        { status: 400 },
      );
    }

    const account = await retrieveStripeAccount(stripeAccountId);
    await syncConnectState(sb, photographer.id, account);

    const connectStatus = describeConnectStatus({
      accountId: stripeAccountId,
      detailsSubmitted: Boolean(account.details_submitted),
      chargesEnabled: Boolean(account.charges_enabled),
      payoutsEnabled: Boolean(account.payouts_enabled),
      disabledReason: account.requirements?.disabled_reason ?? null,
    });

    if (!connectStatus.readyForPayments) {
      return NextResponse.json(
        { ok: false, message: connectStatus.message },
        { status: 400 },
      );
    }

    const totalCents = sumStoredOrderTotalsCents(checkoutOrders);
    if (totalCents == null) {
      return NextResponse.json(
        { ok: false, message: "This order total is invalid." },
        { status: 400 },
      );
    }

    // Defense against corrupted or tampered persisted totals. For combined
    // checkout every member is independently reconciled, then their trusted
    // total_cents values are summed once for the single Stripe charge.
    for (const checkoutOrder of checkoutOrders) {
      const orderTotalCents = storedOrderTotalCents(checkoutOrder);
      if (orderTotalCents == null) {
        return NextResponse.json(
          { ok: false, message: "This order total is invalid." },
          { status: 400 },
        );
      }
      const rawTaxCents = Math.round(Number(checkoutOrder.tax_cents ?? 0));
      const taxCents = Math.max(0, rawTaxCents);
      const storedSubtotalCents = Math.round(Number(
        checkoutOrder.subtotal_cents ?? orderTotalCents - taxCents,
      ));
      if (
        !Number.isSafeInteger(taxCents) ||
        !Number.isSafeInteger(storedSubtotalCents) ||
        storedSubtotalCents <= 0
      ) {
        return NextResponse.json(
          { ok: false, message: "This order total is invalid." },
          { status: 400 },
        );
      }

      const itemRows = itemsByOrder.get(checkoutOrder.id) ?? [];

      if (!itemRows || itemRows.length === 0) {
        return NextResponse.json(
          { ok: false, message: "This order has no line items." },
          { status: 400 },
        );
      }

      // Recheck persisted drafts too: an older browser/order must not start a
      // retouching-only payment after the add-on rule has changed.
      const snapshot = Array.isArray(checkoutOrder.cart_snapshot)
        ? checkoutOrder.cart_snapshot as Array<{ packageId?: string; packageName?: string; quantity?: number }>
        : [];
      const purchaseIds = [...new Set([
        checkoutOrder.package_id,
        ...snapshot.map((entry) => entry.packageId),
      ].filter((id): id is string => typeof id === "string" && !!id))];
      const purchasePackages = new Map<string, RetouchPrintPackage>();
      if (purchaseIds.length) {
        const { data: rows, error } = await sb.from("packages")
          .select("id,name,category,items,is_retouch_addon")
          .in("id", purchaseIds);
        if (error) throw error;
        for (const row of rows ?? []) purchasePackages.set(row.id, row);
      }
      const purchaseEntries = snapshot.length
        ? snapshot.map((entry) => ({
            pkg: purchasePackages.get(entry.packageId ?? "") ?? { name: entry.packageName },
            quantity: entry.quantity,
          }))
        : [
            { pkg: purchasePackages.get(checkoutOrder.package_id ?? "") ?? { name: checkoutOrder.package_name }, quantity: 1 },
            ...itemRows.map((item) => ({ pkg: { name: item.product_name }, quantity: Number(item.quantity) })),
          ];
      const purchaseIssue = retouchPrintPurchaseIssue(purchaseEntries);
      if (purchaseIssue) return NextResponse.json({ ok: false, message: purchaseIssue }, { status: 400 });

      const computedCents = sumStoredOrderItemTotalsCents(itemRows);

      // Allow 2¢ of wiggle for rounding across split-per-slot line items.
      if (computedCents <= 0 || Math.abs(computedCents - storedSubtotalCents) > 2) {
        console.error("[stripe:checkout] total mismatch", {
          orderId: order.id,
          memberOrderId: checkoutOrder.id,
          subtotal: storedSubtotalCents,
          computed: computedCents,
        });
        return NextResponse.json(
          { ok: false, message: "This order total is invalid." },
          { status: 400 },
        );
      }
      if (Math.abs(storedSubtotalCents + taxCents - orderTotalCents) > 2) {
        console.error("[stripe:checkout] tax total mismatch", {
          orderId: checkoutOrder.id,
          subtotal: storedSubtotalCents,
          tax: taxCents,
          total: orderTotalCents,
        });
        return NextResponse.json(
          { ok: false, message: "This order total is invalid." },
          { status: 400 },
        );
      }

      // Authoritative minimum for legacy/single orders. Combined orders are
      // created only by the server and intentionally carry negative sibling
      // discount rows, so their independent item reconciliation above is the
      // correct authority and a raw package-price floor would reject them.
      if (!order.order_group_id && checkoutOrder.package_id) {
        const { data: packageRow, error: packageError } = await sb
          .from("packages")
          .select("id,price_cents,photographer_id")
          .eq("id", checkoutOrder.package_id)
          .maybeSingle();
        if (packageError) throw packageError;

        if (packageRow) {
          // The package must belong to the photographer we're about to
          // charge — otherwise the attacker is pointing at a cheap
          // package from a different studio.
          if (
            packageRow.photographer_id &&
            photographerId &&
            packageRow.photographer_id !== photographerId
          ) {
            console.error("[stripe:checkout] package/photographer mismatch", {
              orderId: checkoutOrder.id,
              orderPackageOwner: packageRow.photographer_id,
              chargePhotographer: photographerId,
            });
            return NextResponse.json(
              { ok: false, message: "This order total is invalid." },
              { status: 400 },
            );
          }
          const authoritativePackageCents = Number(packageRow.price_cents);
          if (
            Number.isFinite(authoritativePackageCents) &&
            authoritativePackageCents > 0 &&
            storedSubtotalCents + 2 < authoritativePackageCents
          ) {
            console.error("[stripe:checkout] below-package-floor", {
              orderId: checkoutOrder.id,
              stored: storedSubtotalCents,
              packageFloor: authoritativePackageCents,
            });
            return NextResponse.json(
              { ok: false, message: "This order total is invalid." },
              { status: 400 },
            );
          }
        }
      }
    }

    const currency = clean(order.currency || "cad").toLowerCase();
    if (
      checkoutOrders.some(
        (member) => clean(member.currency || "cad").toLowerCase() !== currency,
      )
    ) {
      return NextResponse.json(
        { ok: false, message: "This combined order has inconsistent currencies." },
        { status: 400 },
      );
    }
    const origin = baseUrl(req);
    const baseGalleryUrl = new URL(`/parents/${encodeURIComponent(body.pin || "")}`, origin);

    if (isEventOrder) {
      baseGalleryUrl.searchParams.set("mode", "event");
      if (effectiveProjectId) baseGalleryUrl.searchParams.set("project", effectiveProjectId);
      if (body.email) baseGalleryUrl.searchParams.set("email", body.email);
    } else {
      baseGalleryUrl.searchParams.set("mode", "school");
      if (effectiveSchoolId) baseGalleryUrl.searchParams.set("school", effectiveSchoolId);
    }

    const successUrl = new URL(baseGalleryUrl.toString());
    successUrl.searchParams.set("checkout", "success");
    successUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");

    const cancelUrl = new URL(baseGalleryUrl.toString());
    cancelUrl.searchParams.set("checkout", "cancel");

    const existingSessionId = checkoutOrders.find((member) => member.stripe_checkout_session_id)?.stripe_checkout_session_id;
    let expiredSessionId: string | null = null;
    if (existingSessionId) {
      const existing = await retrieveCheckoutSession(existingSessionId, stripeAccountId);
      if (existing.status === "open" && existing.url) return NextResponse.json({ ok: true, url: existing.url, sessionId: existing.id });
      if (existing.status !== "expired") return NextResponse.json({ ok: false, message: "Payment was already submitted. Check your order confirmation before trying again." }, { status: 409 });
      expiredSessionId = existing.id;
    }
    // This marker stays on ambiguous network failure. Cancellation must not
    // claim success while an unrecorded Stripe session might still be payable.
    const { error: startingError } = await sb.from("orders").update({ status: "checkout_starting" }).in("id", checkoutOrders.map((member) => member.id));
    if (startingError) throw startingError;

    const session = await createDirectOrderCheckoutSession({
      accountId: stripeAccountId,
      orderId: checkoutAnchorOrder.id,
      photographerId: photographer.id,
      schoolId: effectiveSchoolId,
      projectId: effectiveProjectId,
      studentId: checkoutAnchorOrder.student_id,
      customerEmail:
        checkoutAnchorOrder.customer_email ||
        checkoutAnchorOrder.parent_email ||
        body.customerEmail ||
        null,
      currency,
      totalCents,
      productName: order.order_group_id
        ? "Combined photo order"
        : order.package_name || "Photo order",
      description: isEventOrder
        ? `${project?.title || project?.client_name || "Event"} gallery order`
        : school?.school_name
          ? `${school.school_name} gallery order`
          : "Studio OS photo order",
      successUrl: successUrl.toString(),
      cancelUrl: cancelUrl.toString(),
      orderGroupId: order.order_group_id,
      previousExpiredSessionId: expiredSessionId,
    });

    const { error: updateError } = await sb
      .from("orders")
      .update({
        photographer_id: photographer.id,
        status: "payment_pending",
        stripe_checkout_session_id: session.id,
        payment_status: "pending",
      })
      .in(
        "id",
        checkoutOrders.map((member) => member.id),
      ).eq("status", "checkout_starting");

    if (updateError) throw updateError;

    return NextResponse.json({
      ok: true,
      url: session.url,
      sessionId: session.id,
      orderId: checkoutAnchorOrder.id,
      stripeAccountId,
      planCode: photographer.subscription_plan_code,
    });
  } catch (error) {
    if (error instanceof ParentCutoutPreflightError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 409 });
    }
    console.error("[stripe:checkout]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to create Stripe checkout." },
      { status: 500 },
    );
  } finally {
    await release?.();
  }
}

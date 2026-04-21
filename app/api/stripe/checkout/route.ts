import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import {
  createDirectOrderCheckoutSession,
  describeConnectStatus,
  getConnectedAccountId,
  isStripeBillingActive,
  retrieveStripeAccount,
  syncConnectState,
} from "@/lib/payments";

export const dynamic = "force-dynamic";

type OrderRow = {
  id: string;
  school_id: string | null;
  project_id: string | null;
  student_id: string | null;
  photographer_id: string | null;
  parent_email: string | null;
  customer_email: string | null;
  package_id: string | null;
  package_name: string | null;
  total_cents: number | null;
  total_amount: number | null;
  currency: string | null;
  status: string | null;
  payment_status: string | null;
  stripe_checkout_session_id: string | null;
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
  try {
    const body = (await req.json()) as CheckoutBody;
    if (!body.orderId) {
      return NextResponse.json({ ok: false, message: "Missing orderId." }, { status: 400 });
    }

    const sb = service();
    const { data: order, error: orderError } = await sb
      .from("orders")
      .select(
        "id,school_id,project_id,student_id,photographer_id,parent_email,customer_email,package_id,package_name,total_cents,total_amount,currency,status,payment_status,stripe_checkout_session_id",
      )
      .eq("id", body.orderId)
      .maybeSingle<OrderRow>();

    if (orderError) throw orderError;
    if (!order) {
      return NextResponse.json({ ok: false, message: "Order draft not found." }, { status: 404 });
    }

    if ((order.payment_status ?? "").toLowerCase() === "paid") {
      return NextResponse.json(
        { ok: false, message: "This order has already been paid." },
        { status: 400 },
      );
    }

    const effectiveSchoolId = order.school_id || body.schoolId || null;
    const effectiveProjectId = order.project_id || body.projectId || null;
    const isEventOrder = (!effectiveSchoolId && !!effectiveProjectId) || body.mode === "event";

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

    const totalCents = Number(order.total_cents ?? Math.round(Number(order.total_amount ?? 0) * 100));
    if (!Number.isFinite(totalCents) || totalCents <= 0) {
      return NextResponse.json(
        { ok: false, message: "This order total is invalid." },
        { status: 400 },
      );
    }

    // Defense against client-side price tampering. The parents portal still
    // inserts the `orders` row via the anon key, which means a malicious
    // caller could set total_cents = 1 and pay a penny for any package.
    // Two cross-checks before we hand the total to Stripe:
    //   1. Sum of order_items must match total_cents (±2¢ rounding).
    //   2. total_cents must be at least the authoritative package price
    //      from the `packages` table — prevents the attacker from also
    //      tampering order_items. The full fix is to move the order
    //      insert itself server-side; this is the interim guard.
    {
      const { data: itemRows, error: itemError } = await sb
        .from("order_items")
        .select("line_total_cents,unit_price_cents,quantity")
        .eq("order_id", order.id);
      if (itemError) throw itemError;

      if (!itemRows || itemRows.length === 0) {
        return NextResponse.json(
          { ok: false, message: "This order has no line items." },
          { status: 400 },
        );
      }

      let computedCents = 0;
      for (const row of itemRows) {
        const lineTotal = Number(row.line_total_cents);
        if (Number.isFinite(lineTotal) && lineTotal > 0) {
          computedCents += lineTotal;
          continue;
        }
        const unit = Number(row.unit_price_cents);
        const qty = Number(row.quantity);
        if (Number.isFinite(unit) && Number.isFinite(qty) && unit > 0 && qty > 0) {
          computedCents += unit * qty;
        }
      }

      // Allow 2¢ of wiggle for rounding across split-per-slot line items.
      if (computedCents <= 0 || Math.abs(computedCents - totalCents) > 2) {
        console.error("[stripe:checkout] total mismatch", {
          orderId: order.id,
          stored: totalCents,
          computed: computedCents,
        });
        return NextResponse.json(
          { ok: false, message: "This order total is invalid." },
          { status: 400 },
        );
      }

      // Authoritative minimum: the base package itself. If this order
      // references a package_id we look up the real price and require
      // total_cents >= that floor. Backdrops/extras can inflate it, but
      // nothing should bring it below the package's own price.
      if (order.package_id) {
        const { data: packageRow, error: packageError } = await sb
          .from("packages")
          .select("id,price_cents,photographer_id")
          .eq("id", order.package_id)
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
              orderId: order.id,
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
            totalCents + 2 < authoritativePackageCents
          ) {
            console.error("[stripe:checkout] below-package-floor", {
              orderId: order.id,
              stored: totalCents,
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

    const session = await createDirectOrderCheckoutSession({
      accountId: stripeAccountId,
      orderId: order.id,
      photographerId: photographer.id,
      schoolId: effectiveSchoolId,
      projectId: effectiveProjectId,
      studentId: order.student_id,
      customerEmail: order.customer_email || order.parent_email || body.customerEmail || null,
      currency,
      totalCents,
      productName: order.package_name || "Photo order",
      description: isEventOrder
        ? `${project?.title || project?.client_name || "Event"} gallery order`
        : school?.school_name
          ? `${school.school_name} gallery order`
          : "Studio OS photo order",
      successUrl: successUrl.toString(),
      cancelUrl: cancelUrl.toString(),
    });

    const { error: updateError } = await sb
      .from("orders")
      .update({
        photographer_id: photographer.id,
        stripe_checkout_session_id: session.id,
        payment_status: "pending",
      })
      .eq("id", order.id);

    if (updateError) throw updateError;

    return NextResponse.json({
      ok: true,
      url: session.url,
      sessionId: session.id,
      orderId: order.id,
      stripeAccountId,
      planCode: photographer.subscription_plan_code,
    });
  } catch (error) {
    console.error("[stripe:checkout]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to create Stripe checkout." },
      { status: 500 },
    );
  }
}

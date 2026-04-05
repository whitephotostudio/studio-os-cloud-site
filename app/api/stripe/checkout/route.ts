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
        "id,school_id,project_id,student_id,photographer_id,parent_email,customer_email,package_name,total_cents,total_amount,currency,status,payment_status,stripe_checkout_session_id",
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
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Failed to create Stripe checkout.",
      },
      { status: 500 },
    );
  }
}

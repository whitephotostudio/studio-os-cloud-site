import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import {
  buildAbandonedCartEmail,
  buildSchoolAbandonedCartEmail,
  eventFromName,
  eventReplyTo,
} from "@/lib/event-gallery-email";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";
import {
  hasProjectEmailDelivery,
  recordProjectEmailDelivery,
} from "@/lib/project-email-deliveries";
import { resendConfigured, sendResendEmail } from "@/lib/resend";

export const dynamic = "force-dynamic";

type PendingOrderRow = {
  id: string;
  project_id: string | null;
  school_id: string | null;
  photographer_id: string | null;
  parent_email: string | null;
  customer_email: string | null;
  package_name: string | null;
  total_cents: number | null;
  total_amount: number | null;
  created_at: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function looksLikeEmail(value: string | null | undefined) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

function isAuthorized(request: NextRequest) {
  const expected = clean(process.env.CRON_SECRET);
  // Fail closed: if CRON_SECRET is unset (e.g. mis-deploy, env rotation gap),
  // refuse the request instead of allowing every caller.
  if (!expected) {
    console.error("[cron] CRON_SECRET is not configured; rejecting request.");
    return false;
  }
  const header = clean(request.headers.get("authorization"));
  return header === `Bearer ${expected}`;
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

    if (!resendConfigured()) {
      return NextResponse.json({
        ok: true,
        processed: 0,
        sent: 0,
        skipped: 0,
        failed: 0,
        warning: "Resend is not configured on the server.",
      });
    }

    const service = createDashboardServiceClient();
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const origin = new URL(request.url).origin;

    const { data: orderRows, error: orderError } = await service
      .from("orders")
      .select(
        "id,project_id,school_id,photographer_id,parent_email,customer_email,package_name,total_cents,total_amount,created_at",
      )
      .or("project_id.not.is.null,school_id.not.is.null")
      .eq("status", "payment_pending")
      .lte("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(200);

    if (orderError) throw orderError;

    const pendingOrders = (orderRows ?? []) as PendingOrderRow[];
    if (!pendingOrders.length) {
      return NextResponse.json({ ok: true, processed: 0, sent: 0, skipped: 0, failed: 0 });
    }

    const projectIds = Array.from(
      new Set(pendingOrders.map((row) => clean(row.project_id)).filter(Boolean)),
    );
    const schoolIds = Array.from(
      new Set(pendingOrders.map((row) => clean(row.school_id)).filter(Boolean)),
    );
    const photographerIds = Array.from(
      new Set(pendingOrders.map((row) => clean(row.photographer_id)).filter(Boolean)),
    );

    const [projectsResult, schoolsResult, photographersResult] = await Promise.all([
      service
        .from("projects")
        .select("id,title,client_name,access_mode,access_pin,email_required,cover_photo_url,gallery_settings")
        .in("id", projectIds),
      service
        .from("schools")
        .select("id,school_name,access_mode,access_pin,email_required,gallery_settings")
        .in("id", schoolIds),
      service
        .from("photographers")
        .select("id,business_name,studio_email")
        .in("id", photographerIds),
    ]);

    if (projectsResult.error) throw projectsResult.error;
    if (schoolsResult.error) throw schoolsResult.error;
    if (photographersResult.error) throw photographersResult.error;

    const projectMap = new Map(
      (projectsResult.data ?? []).map((row) => [row.id, row] as const),
    );
    const schoolMap = new Map(
      (schoolsResult.data ?? []).map((row) => [row.id, row] as const),
    );
    const photographerMap = new Map(
      (photographersResult.data ?? []).map((row) => [row.id, row] as const),
    );

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const order of pendingOrders) {
      const projectId = clean(order.project_id);
      const schoolId = clean(order.school_id);
      const photographerId = clean(order.photographer_id);
      const recipientEmail = clean(order.customer_email || order.parent_email).toLowerCase();
      if ((!projectId && !schoolId) || !photographerId || !looksLikeEmail(recipientEmail)) {
        skipped += 1;
        continue;
      }

      const dedupeKey = `abandoned-cart:${order.id}`;
      if (await hasProjectEmailDelivery(service, dedupeKey)) {
        skipped += 1;
        continue;
      }

      const photographer = photographerMap.get(photographerId);
      const project = projectId ? projectMap.get(projectId) : null;
      const school = schoolId ? schoolMap.get(schoolId) : null;
      if ((!project && !school) || !photographer) {
        skipped += 1;
        continue;
      }

      const settings = normalizeEventGallerySettings(
        project?.gallery_settings ?? school?.gallery_settings,
      );
      if (!settings.extras.enableAbandonedCartEmail) {
        skipped += 1;
        continue;
      }

      const totalCents = Number(
        order.total_cents ?? Math.round(Number(order.total_amount ?? 0) * 100),
      );
      const orderTotalLabel =
        Number.isFinite(totalCents) && totalCents > 0
          ? `$${(totalCents / 100).toFixed(2)}`
          : "your saved cart";

      const email = project
        ? buildAbandonedCartEmail({
            project,
            photographer,
            share: settings.share,
            origin,
            orderTotalLabel,
          })
        : buildSchoolAbandonedCartEmail({
            school: {
              id: schoolId,
              school_name: school?.school_name,
              access_mode: school?.access_mode,
              access_pin: school?.access_pin,
              email_required: school?.email_required,
            },
            photographer,
            origin,
            orderTotalLabel,
          });
      const dedupeTargetId = projectId || schoolId;

      try {
        const sendResult = await sendResendEmail({
          to: recipientEmail,
          subject: email.subject,
          html: email.html,
          text: email.text,
          fromName: eventFromName(photographer),
          replyTo: eventReplyTo(photographer),
          idempotencyKey: dedupeKey,
          tags: [
            { name: "type", value: "abandoned_cart" },
            { name: projectId ? "project_id" : "school_id", value: dedupeTargetId },
          ],
        });

        await recordProjectEmailDelivery(service, {
          projectId: projectId || null,
          orderId: order.id,
          photographerId,
          recipientEmail,
          emailType: "abandoned_cart",
          dedupeKey,
          resendEmailId: sendResult.id,
          subject: email.subject,
          status: "sent",
          payload: {
            packageName: clean(order.package_name) || null,
            createdAt: order.created_at,
          },
        });
        sent += 1;
      } catch (error) {
        failed += 1;
        await recordProjectEmailDelivery(service, {
          projectId: projectId || null,
          orderId: order.id,
          photographerId,
          recipientEmail,
          emailType: "abandoned_cart",
          dedupeKey,
          subject: email.subject,
          status: "failed",
          payload: {
            packageName: clean(order.package_name) || null,
            createdAt: order.created_at,
          },
          errorMessage:
            error instanceof Error ? error.message : "Failed to send abandoned cart reminder.",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      processed: pendingOrders.length,
      sent,
      skipped,
      failed,
    });
  } catch (error) {
    console.error("[cron:abandoned-cart-reminders]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to send abandoned cart reminders." },
      { status: 500 },
    );
  }
}

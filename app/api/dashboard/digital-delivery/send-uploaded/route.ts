import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { parseJson } from "@/lib/api-validation";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { getR2Client, R2_BUCKET } from "@/lib/r2";
import { rateLimit } from "@/lib/rate-limit";
import { resendConfigured } from "@/lib/resend";
import { guardAgreement } from "@/lib/require-agreement";
import { sendUploadedDeliveryEmail } from "@/lib/uploaded-digital-delivery";
import {
  isPaidUploadedDeliveryOrder,
  MAX_UPLOADED_DELIVERY_FILES,
  validateUploadedDeliveryKeys,
} from "@/lib/uploaded-digital-delivery-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const BodySchema = z.object({
  orderId: z.string().uuid("A valid orderId is required."),
  objectKeys: z.array(z.string()).min(1).max(MAX_UPLOADED_DELIVERY_FILES),
});

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) return jsonError("Please sign in again.", 401);

    const parsed = await parseJson(request, BodySchema);
    if (!parsed.ok) return parsed.response;

    const service = createDashboardServiceClient();
    const agreement = await guardAgreement({ service, userId: user.id });
    if (!agreement.ok) {
      return NextResponse.json(agreement.body, { status: agreement.status });
    }

    const { data: photographer, error: photographerError } = await service
      .from("photographers")
      .select("id,business_name,studio_email,billing_email")
      .eq("user_id", user.id)
      .maybeSingle();
    if (photographerError || !photographer?.id) {
      return jsonError("Photographer profile not found.", 403);
    }

    const limit = await rateLimit(photographer.id, {
      namespace: "uploaded-digital-delivery",
      limit: 30,
      windowSeconds: 600,
    });
    if (!limit.allowed) return jsonError("Too many delivery requests. Please wait and try again.", 429);

    const { data: order, error: orderError } = await service
      .from("orders")
      .select("id,photographer_id,school_id,student_id,status,payment_status,paid_at,parent_email,customer_email,parent_name,customer_name,notes")
      .eq("id", parsed.data.orderId)
      .maybeSingle();
    if (orderError || !order?.id) return jsonError("Order not found.", 404);
    if (order.photographer_id !== photographer.id) {
      return jsonError("You do not have access to this order.", 403);
    }
    if (!isPaidUploadedDeliveryOrder(order)) {
      return jsonError("This order is not paid yet.", 409);
    }
    if (!order.school_id || !order.student_id) {
      return jsonError("This order is missing its school or student.", 409);
    }

    const objectKeys = validateUploadedDeliveryKeys(
      parsed.data.objectKeys,
      order.school_id,
      order.student_id,
    );
    if (!objectKeys) {
      return jsonError("One or more photos are outside this order's student folder.", 400);
    }

    const recipientEmail = clean(order.customer_email) || clean(order.parent_email);
    if (!recipientEmail) return jsonError("No recipient email was found for this order.", 409);
    if (!resendConfigured()) return jsonError("Email delivery is not configured.", 503);

    for (let index = 0; index < objectKeys.length; index += 8) {
      const batch = objectKeys.slice(index, index + 8);
      try {
        await Promise.all(
          batch.map((key) =>
            getR2Client().send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key })),
          ),
        );
      } catch {
        return jsonError("One or more uploaded photos could not be verified.", 409);
      }
    }

    const [{ data: student, error: studentError }, { data: school, error: schoolError }] =
      await Promise.all([
        service
          .from("students")
          .select("id,first_name,last_name")
          .eq("id", order.student_id)
          .eq("school_id", order.school_id)
          .maybeSingle(),
        service
          .from("schools")
          .select("id,school_name")
          .eq("id", order.school_id)
          .eq("photographer_id", photographer.id)
          .maybeSingle(),
      ]);
    if (studentError || schoolError || !student?.id || !school?.id) {
      return jsonError("Could not verify the student and school for this order.", 409);
    }

    const result = await sendUploadedDeliveryEmail({
      orderId: order.id,
      recipientEmail,
      recipientName: clean(order.customer_name) || clean(order.parent_name),
      studentName: [clean(student.first_name), clean(student.last_name)].filter(Boolean).join(" "),
      schoolName: clean(school.school_name),
      businessName: clean(photographer.business_name),
      replyTo: clean(photographer.studio_email) || clean(photographer.billing_email),
      objectKeys,
    });

    const noteLine = `Secure uploaded digital delivery emailed ${new Date().toISOString()} (${objectKeys.length} file${objectKeys.length === 1 ? "" : "s"}).`;
    const existingNotes = clean(order.notes);
    const { error: updateError } = await service
      .from("orders")
      .update({
        status: "digital_sent",
        notes: existingNotes ? `${existingNotes}\n\n${noteLine}` : noteLine,
      })
      .eq("id", order.id)
      .eq("photographer_id", photographer.id);
    if (updateError) {
      return jsonError("The email was sent, but the order status could not be updated. Refresh before retrying.", 500);
    }

    return NextResponse.json({
      ok: true,
      fileCount: result.fileCount,
      expiresAt: new Date(result.expiresAt).toISOString(),
    });
  } catch (error) {
    console.error("[dashboard/digital-delivery/send-uploaded] request failed", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    return jsonError("Could not send the secure digital delivery.", 500);
  }
}

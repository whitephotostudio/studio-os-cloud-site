import { NextRequest, NextResponse } from "next/server";

import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import {
  createUploadedDeliveryZipStream,
  uploadedDeliveryContentDisposition,
  uploadedDeliveryZipName,
} from "@/lib/uploaded-digital-delivery";
import {
  isPaidUploadedDeliveryOrder,
  validateUploadedDeliveryKeys,
  verifyUploadedDeliveryToken,
} from "@/lib/uploaded-digital-delivery-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

export async function GET(request: NextRequest) {
  try {
    const token = clean(request.nextUrl.searchParams.get("token"));
    if (!token) {
      return NextResponse.json({ ok: false, message: "Missing digital delivery link." }, { status: 400 });
    }

    const payload = verifyUploadedDeliveryToken(token);
    const service = createDashboardServiceClient();
    const { data: order, error: orderError } = await service
      .from("orders")
      .select("id,school_id,student_id,status,payment_status,paid_at,parent_email,customer_email")
      .eq("id", payload.orderId)
      .maybeSingle();
    if (orderError || !order?.id || !isPaidUploadedDeliveryOrder(order)) {
      return NextResponse.json({ ok: false, message: "This delivery is not available." }, { status: 404 });
    }

    const recipientEmail = (clean(order.customer_email) || clean(order.parent_email)).toLowerCase();
    if (!recipientEmail || recipientEmail !== payload.recipientEmail.toLowerCase()) {
      return NextResponse.json({ ok: false, message: "This delivery is not available." }, { status: 403 });
    }
    if (!order.school_id || !order.student_id) {
      return NextResponse.json({ ok: false, message: "This delivery is not available." }, { status: 404 });
    }

    const objectKeys = validateUploadedDeliveryKeys(
      payload.objectKeys,
      order.school_id,
      order.student_id,
    );
    if (!objectKeys || objectKeys.length !== payload.objectKeys.length) {
      return NextResponse.json({ ok: false, message: "This delivery is not available." }, { status: 403 });
    }

    const [{ data: student }, { data: school }] = await Promise.all([
      service
        .from("students")
        .select("first_name,last_name")
        .eq("id", order.student_id)
        .eq("school_id", order.school_id)
        .maybeSingle(),
      service.from("schools").select("school_name").eq("id", order.school_id).maybeSingle(),
    ]);
    const fileName = uploadedDeliveryZipName(
      clean(school?.school_name),
      [clean(student?.first_name), clean(student?.last_name)].filter(Boolean).join(" "),
    );

    return new NextResponse(createUploadedDeliveryZipStream(objectKeys), {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": uploadedDeliveryContentDisposition(fileName),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      },
    });
  } catch (error) {
    console.error("[uploaded-digital-delivery] request rejected", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { ok: false, message: "This digital delivery link is invalid or expired." },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }
}

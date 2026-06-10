import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import {
  contentDispositionAttachment,
  createDigitalDeliveryZipStream,
  digitalDeliveryFileName,
  resolveDigitalDeliveryContext,
  verifyDigitalDeliveryToken,
} from "@/lib/digital-delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

export async function GET(request: NextRequest) {
  try {
    const token = clean(request.nextUrl.searchParams.get("token"));
    const wantsJson = clean(request.nextUrl.searchParams.get("format")) === "json";
    if (!token) {
      return NextResponse.json(
        { ok: false, message: "Missing digital delivery link." },
        { status: 400 },
      );
    }

    const payload = verifyDigitalDeliveryToken(token);
    const service = createDashboardServiceClient();
    const context = await resolveDigitalDeliveryContext(service, payload.orderId, {
      recipientEmail: payload.recipientEmail,
      requirePaid: true,
    });

    if (context.recipientEmail.toLowerCase() !== payload.recipientEmail.toLowerCase()) {
      return NextResponse.json(
        { ok: false, message: "This digital delivery link does not match the order email." },
        { status: 403 },
      );
    }

    const fileName = digitalDeliveryFileName(context);
    if (wantsJson) {
      return NextResponse.json(
        {
          ok: true,
          fileName,
          fileCount: context.files.length,
          expiresAt: new Date(payload.exp).toISOString(),
        },
        { headers: { "cache-control": "private, no-store" } },
      );
    }

    return new NextResponse(createDigitalDeliveryZipStream(context), {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": contentDispositionAttachment(fileName),
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[digital-delivery]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to prepare your digital photo ZIP." },
      { status: 500 },
    );
  }
}

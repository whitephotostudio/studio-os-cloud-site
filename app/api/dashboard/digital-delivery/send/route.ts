import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";
import { guardAgreement } from "@/lib/require-agreement";
import { sendDigitalDeliveryEmailForOrder } from "@/lib/digital-delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({
  orderId: z.string().min(1, "orderId is required."),
  recipientEmail: z.string().email("recipientEmail must be a valid email.").optional(),
  force: z.boolean().optional().default(true),
});

export async function POST(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const parsed = await parseJson(request, BodySchema);
    if (!parsed.ok) return parsed.response;

    const service = createDashboardServiceClient();
    const guard = await guardAgreement({ service, userId: user.id });
    if (!guard.ok) {
      return NextResponse.json(guard.body, { status: guard.status });
    }

    const { data: photographerRow, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (photographerError || !photographerRow?.id) {
      return NextResponse.json(
        { ok: false, message: "Photographer profile not found." },
        { status: 403 },
      );
    }

    const { data: orderRow, error: orderError } = await service
      .from("orders")
      .select("id,photographer_id")
      .eq("id", parsed.data.orderId)
      .maybeSingle();

    if (orderError || !orderRow?.id) {
      return NextResponse.json(
        { ok: false, message: "Order not found." },
        { status: 404 },
      );
    }

    if (orderRow.photographer_id !== photographerRow.id) {
      return NextResponse.json(
        { ok: false, message: "You do not have access to this order." },
        { status: 403 },
      );
    }

    const result = await sendDigitalDeliveryEmailForOrder(service, parsed.data.orderId, {
      recipientEmail: parsed.data.recipientEmail,
      force: parsed.data.force,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[dashboard/digital-delivery/send]", error);
    return NextResponse.json(
      { ok: false, message: "Could not send the digital ZIP link." },
      { status: 500 },
    );
  }
}

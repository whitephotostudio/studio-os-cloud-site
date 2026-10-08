import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deliverAbandonedCartReminders } from "@/lib/abandoned-cart-reminders";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { rateLimit } from "@/lib/rate-limit";
import { hasActiveSubscription } from "@/lib/subscription-gate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const RUN_LIMIT = 100;
const BodySchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(1000),
  // Older desktop clients send these fields. Neither can bypass the shared
  // timing, purchase suppression, stop-reminder or delivery-cap policy.
  force: z.boolean().optional(),
  cooldownDays: z.number().finite().nonnegative().optional(),
}).strict();

function jsonError(message: string, status: number, headers?: Record<string, string>) {
  return NextResponse.json({ ok: false, error: message, message }, {
    status, headers: { "cache-control": "no-store", ...headers },
  });
}

export async function GET() {
  return jsonError("Use POST to request cart reminders.", 405, { Allow: "POST" });
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
      return jsonError("Invalid request origin.", 403);
    }
    const auth = await resolveDashboardAuth(request);
    if (!auth.user) return jsonError("Please sign in again.", 401);
    if (!auth.mfaSatisfied) {
      return jsonError("Complete two-step verification before sending reminders.", 403);
    }

    let raw: unknown;
    try { raw = await request.json(); }
    catch { return jsonError("Request body must be valid JSON.", 400); }
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonError("Provide 1 to 1000 valid order IDs and valid reminder options.", 400);
    }
    const orderIds = [...new Set(parsed.data.orderIds.map((id) => id.toLowerCase()))];
    const service = createDashboardServiceClient();
    const { data: photographer, error: photographerError } = await service
      .from("photographers")
      .select("id,is_platform_admin,subscription_status,trial_starts_at,trial_ends_at,created_at")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (photographerError) throw photographerError;
    if (!photographer?.id) return jsonError("Photographer profile not found.", 403);
    if (!hasActiveSubscription(photographer)) {
      return jsonError("An active Studio OS subscription is required to send reminders.", 403);
    }

    const limit = await rateLimit(photographer.id, {
      namespace: "abandoned-cart-reminders-manual",
      limit: 10,
      windowSeconds: 600,
    });
    if (!limit.allowed) {
      return jsonError("Too many reminder requests. Please wait and try again.", 429, {
        "Retry-After": String(Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))),
      });
    }

    // Never let a partially owned batch produce a partial send. The worker
    // repeats this photographer scope in the transactional claim as well.
    // Keep the read URL bounded for older clients' 1000-order selections.
    // All ownership reads finish before the single delivery run begins.
    for (let offset = 0; offset < orderIds.length; offset += RUN_LIMIT) {
      const batchIds = orderIds.slice(offset, offset + RUN_LIMIT);
      const { data: orders, error: ordersError } = await service
        .from("orders")
        .select("id,photographer_id")
        .in("id", batchIds)
        .eq("photographer_id", photographer.id);
      if (ordersError) throw ordersError;
      const ownedIds = new Set((orders ?? []).map((order) => order.id));
      if (ownedIds.size !== batchIds.length ||
          orders?.some((order) => order.photographer_id !== photographer.id) ||
          batchIds.some((id) => !ownedIds.has(id))) {
        return jsonError("One or more orders are unavailable to this studio. Refresh Orders.", 403);
      }
    }

    const result = await deliverAbandonedCartReminders(service, {
      origin: new URL(request.url).origin,
      orderIds,
      photographerId: photographer.id,
      limit: RUN_LIMIT,
    });
    return NextResponse.json({
      ok: true,
      ...result,
      // A request can include ineligible, suppressed or deferred orders.
      // Only claimed attempts contribute to total and the worker counters.
      total: result.processed,
      requested: orderIds.length,
      notClaimed: orderIds.length - result.processed,
      limit: RUN_LIMIT,
      forced: false,
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    console.error("[dashboard/orders/abandoned-cart-reminders] Request could not be completed.");
    return jsonError("Could not send cart reminders. Please try again later.", 503);
  }
}

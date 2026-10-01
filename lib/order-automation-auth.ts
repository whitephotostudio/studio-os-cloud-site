import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import {
  resolveDashboardAuth,
  createDashboardServiceClient,
} from "@/lib/dashboard-auth";
import { rateLimit } from "@/lib/rate-limit";
export class ProductionAuthError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function productionAuth(request: NextRequest) {
  const auth = await resolveDashboardAuth(request);
  if (!auth.user)
    throw new ProductionAuthError(
      "Sign in to Studio OS before using AI Orders.",
      401,
    );
  if (!auth.mfaSatisfied)
    throw new ProductionAuthError(
      "Complete two-step verification before using AI Orders.",
      403,
    );
  const limit = await rateLimit(auth.user.id, {
    namespace: "order-production",
    limit: 1200,
    windowSeconds: 3600,
  });
  if (!limit.allowed)
    throw new ProductionAuthError(
      "Production request limit reached. Try again later.",
      429,
    );
  return auth.user;
}
export async function currentProductionOrders(owner: string, ids: string[]) {
  if (
    !ids.length ||
    ids.length > 100 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !/^[0-9a-f-]{36}$/.test(id))
  )
    throw Error("Exact cloud order references are required.");
  const service = createDashboardServiceClient();
  const { data: studios, error: studioError } = await service
    .from("photographers")
    .select("id,business_name,studio_email")
    .eq("user_id", owner);
  if (studioError || !studios?.length)
    throw Error("Studio ownership could not be verified.");
  const { data: orders, error } = await service
    .from("orders")
    .select(
      "id,photographer_id,status,payment_status,refund_status,refund_amount_cents,updated_at",
    )
    .in("id", ids)
    .in(
      "photographer_id",
      studios.map((s) => s.id),
    );
  if (
    error ||
    orders?.length !== ids.length ||
    orders.some(
      (o) =>
        !["paid", "succeeded", "no_payment_required"].includes(
          (o.payment_status || "").toLowerCase(),
        ) ||
        [
          "cancelled",
          "canceled",
          "cancel_pending",
          "refunded",
          "refund_pending",
        ].includes((o.status || "").toLowerCase()) ||
        Number(o.refund_amount_cents || 0) > 0 ||
        (o.refund_status &&
          !["none", "not_refunded"].includes(o.refund_status.toLowerCase())),
    )
  )
    throw Error(
      "An order is unpaid, cancelled, refunded or unavailable. Refresh Orders.",
    );
  const studio = studios.find((s) => s.id === orders[0].photographer_id)!;
  if (orders.some((o) => o.photographer_id !== studio.id))
    throw Error("A batch must belong to one studio profile.");
  return { orders, studio };
}

export function productionFinancialRevision(orders: unknown[]) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        [...orders].sort((a, b) =>
          JSON.stringify(a).localeCompare(JSON.stringify(b)),
        ),
      ),
    )
    .digest("hex");
}

import type { createDashboardServiceClient } from "@/lib/dashboard-auth";

type Service = ReturnType<typeof createDashboardServiceClient>;
export type OnlineBackdropPolicy = {
  studioDefault: boolean;
  schoolOverride: boolean | null;
  enabled: boolean;
};

/** Existing galleries retain their behavior until the owner changes a policy.
 * A school override is independent of the default, including explicit On when
 * a studio's default is Off. Desktop gallery-settings sync cannot reset it. */
export function resolveOnlineBackdropsEnabled(studioDefault: unknown, schoolOverride?: unknown): boolean {
  if (typeof schoolOverride === "boolean") return schoolOverride;
  return studioDefault !== false;
}

function isMissingColumn(error: { code?: string; message?: string } | null, column: string) {
  return !!error && ["42703", "PGRST204"].includes(error.code ?? "") &&
    (error.message ?? "").includes(column);
}

export async function readOnlineBackdropPolicy(
  service: Service,
  scope: { photographerId: string; schoolId?: string | null },
): Promise<OnlineBackdropPolicy> {
  let photographerResult = await service.from("photographers")
    .select("id,online_backdrops_enabled").eq("id", scope.photographerId)
    .maybeSingle<{ id: string; online_backdrops_enabled?: boolean | null }>();
  if (isMissingColumn(photographerResult.error, "online_backdrops_enabled")) {
    photographerResult = await service.from("photographers")
      .select("id").eq("id", scope.photographerId).maybeSingle();
  }
  if (photographerResult.error) throw photographerResult.error;
  if (!photographerResult.data?.id) throw new Error("Studio backdrop policy could not be verified.");
  const studioDefault = photographerResult.data.online_backdrops_enabled !== false;

  let schoolOverride: boolean | null = null;
  if (scope.schoolId) {
    let schoolResult = await service.from("schools")
      .select("id,photographer_id,online_backdrops_override").eq("id", scope.schoolId)
      .eq("photographer_id", scope.photographerId)
      .maybeSingle<{ id: string; photographer_id: string; online_backdrops_override?: boolean | null }>();
    if (isMissingColumn(schoolResult.error, "online_backdrops_override")) {
      schoolResult = await service.from("schools")
        .select("id,photographer_id").eq("id", scope.schoolId)
        .eq("photographer_id", scope.photographerId).maybeSingle();
    }
    if (schoolResult.error) throw schoolResult.error;
    if (!schoolResult.data?.id || schoolResult.data.photographer_id !== scope.photographerId) {
      throw new Error("Gallery backdrop policy could not be verified.");
    }
    const override = schoolResult.data.online_backdrops_override;
    schoolOverride = typeof override === "boolean" ? override : null;
  }
  return { studioDefault, schoolOverride, enabled: resolveOnlineBackdropsEnabled(studioDefault, schoolOverride) };
}

export class OnlineBackdropsDisabledError extends Error {
  constructor() {
    super("Background changes are no longer available for this gallery. Return to your gallery and remove the background selection before ordering. Your original photos are still available.");
    this.name = "OnlineBackdropsDisabledError";
  }
}

/** This is a new-purchase gate only. It never mutates a saved selection, photo,
 * cutout, paid order, payment confirmation, download or fulfillment asset. */
export async function assertNewOnlineBackdropPurchase(
  service: Service,
  scope: { photographerId: string; schoolId?: string | null },
  hasBackdrop: boolean,
) {
  if (!hasBackdrop) return;
  if (!(await readOnlineBackdropPolicy(service, scope)).enabled) throw new OnlineBackdropsDisabledError();
}

type PendingBackdropOrder = {
  photographer_id?: string | null;
  school_id?: string | null;
  cart_snapshot?: unknown;
  special_notes?: string | null;
  notes?: string | null;
};

/** For unpaid persisted checkout drafts, use the saved scope and selections,
 * never a caller-supplied school ID. Old machine-written background notes are
 * review hints when a legacy draft has no structured snapshot. */
export async function assertPendingOnlineBackdropOrders(service: Service, orders: PendingBackdropOrder[]) {
  const checked = new Set<string>();
  for (const order of orders) {
    const snapshot = Array.isArray(order.cart_snapshot) ? order.cart_snapshot : [order.cart_snapshot];
    const hasBackdrop = snapshot.some(entry => !!entry && typeof entry === "object" &&
      !Array.isArray(entry) && (entry as { backdrop?: unknown }).backdrop != null) ||
      [order.special_notes, order.notes].some(notes => /^BACKDROP:\s*\S/m.test(notes ?? ""));
    if (!hasBackdrop) continue;
    if (!order.photographer_id) throw new Error("Saved backdrop order is missing its studio.");
    const key = `${order.photographer_id}:${order.school_id ?? ""}`;
    if (checked.has(key)) continue;
    await assertNewOnlineBackdropPurchase(service, {
      photographerId: order.photographer_id, schoolId: order.school_id,
    }, true);
    checked.add(key);
  }
}

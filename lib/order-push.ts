// "New order" push to a photographer's iPhone(s).
//
// Privacy-first: the lock-screen banner is just "New order received" unless the
// photographer turned on `photographers.order_push_show_details`, in which case
// it includes the client name + amount. Best-effort — never throws into the
// order/payment path.

import type { SupabaseClient } from "@supabase/supabase-js";
import { hasApnsConfig, sendApnsPush } from "@/lib/apns";

export async function sendNewOrderPush(
  service: SupabaseClient,
  photographerId: string,
  details: { customerName?: string | null; amountLabel?: string | null } = {},
): Promise<void> {
  if (!hasApnsConfig() || !photographerId) return;

  try {
    const { data: tokenRows } = await service
      .from("device_push_tokens")
      .select("token")
      .eq("photographer_id", photographerId);
    const tokens = (tokenRows ?? []) as Array<{ token: string }>;
    if (tokens.length === 0) return;

    const { data: pg } = await service
      .from("photographers")
      .select("order_push_show_details")
      .eq("id", photographerId)
      .maybeSingle<{ order_push_show_details: boolean | null }>();
    const showDetails = Boolean(pg?.order_push_show_details);

    const name = (details.customerName ?? "").trim();
    const amount = (details.amountLabel ?? "").trim();
    const body =
      showDetails && (name || amount)
        ? `${name || "A client"} placed an order${amount ? ` for ${amount}` : ""}.`
        : "New order received.";

    const payload = {
      aps: {
        alert: { title: "Studio OS", body },
        sound: "default",
        "thread-id": "new-order",
      },
      // Consumed by the app to deep-link to the orders list when tapped.
      url: "/m/orders",
    };

    for (const row of tokens) {
      const result = await sendApnsPush(row.token, payload);
      // Apple tells us when a token is dead — prune it so we stop trying.
      if (
        result.status === 410 ||
        result.reason === "BadDeviceToken" ||
        result.reason === "Unregistered"
      ) {
        await service.from("device_push_tokens").delete().eq("token", row.token);
      }
    }
  } catch (error) {
    console.error("[order-push] failed", error);
  }
}

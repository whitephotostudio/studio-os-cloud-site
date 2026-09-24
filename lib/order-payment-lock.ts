import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function lockOrderPayment(service: SupabaseClient, key: string) {
  const token = randomUUID();
  const { data, error } = await service.rpc("acquire_order_payment_lock", { p_key: key, p_token: token });
  if (error) throw error;
  if (!data) throw new Error("Another payment action is in progress. Wait two minutes, then refresh.");
  return async () => {
    const { error: releaseError } = await service.from("order_payment_locks").delete().eq("key", key).eq("token", token);
    if (releaseError) console.error("[payment-lock] Release failed; lease will expire.");
  };
}

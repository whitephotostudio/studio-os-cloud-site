import type { SupabaseClient } from "@supabase/supabase-js";
import { r2MediaOwnedBy } from "@/lib/r2-media-ownership";

/** Uploads and server transforms must use the same retained owner proof as reads.
 * Managed cutouts still require their separate paid-photo proof before writing. */
export async function assertKeyOwnedByPhotographer(
  service: Pick<SupabaseClient, "rpc">, photographerId: string, rawKey: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return await r2MediaOwnedBy(service, rawKey, photographerId)
    ? { ok: true }
    : { ok: false, reason: "key does not map to a resource owned by caller" };
}

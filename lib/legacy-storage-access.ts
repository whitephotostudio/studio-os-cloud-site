import type { SupabaseClient } from "@supabase/supabase-js";

/** The immutable snapshot is established from storage ownership, never from a
 * tenant-edited photo URL supplied to this request. Missing proof denies. */
export async function legacyStorageOwner(service: Pick<SupabaseClient, "rpc">, bucket: string, key: string): Promise<string | null> {
  const { data, error } = await service.rpc("legacy_student_storage_owner", { p_bucket: bucket, p_key: key });
  if (error) throw new Error("Legacy media ownership is unavailable.");
  return typeof data === "string" && data ? data : null;
}

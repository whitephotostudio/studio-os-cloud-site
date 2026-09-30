import type { SupabaseClient } from "@supabase/supabase-js";
import { isServerOnlyR2Key, isUuid } from "./r2-access-security";

/** Local school IDs are text, never feed them into a UUID column or raw OR filter. */
export async function assertKeyOwnedByPhotographer(
  service: SupabaseClient, photographerId: string, rawKey: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const key = rawKey.trim();
  const denied = { ok: false as const, reason: "key does not map to a resource owned by caller" };
  if (!key || key.includes("..") || key.startsWith("/")) return denied;
  if (isServerOnlyR2Key(key)) return denied;
  const segments = key.split("/");
  if (segments.length < 2 || segments.some(segment => !segment)) return denied;
  const [first, second, third] = segments;
  if (first === "backdrops") return second === photographerId ? { ok: true } : denied;
  const projectId = first === "projects" ? second : first === "nobg-photos" && second === "projects" ? third : null;
  if (projectId) {
    if (!isUuid(projectId)) return denied;
    const { data, error } = await service.from("projects").select("id")
      .eq("id", projectId).eq("photographer_id", photographerId).maybeSingle();
    if (error) throw error;
    return data?.id ? { ok: true } : denied;
  }
  const candidate = first === "schools" || first === "photos" ? second
    : first === "nobg-photos" ? (second === "schools" ? third : second) : first;
  if (!candidate || !/^[A-Za-z0-9_-]+$/.test(candidate)) return denied;
  const [byId, byLocal] = await Promise.all([
    isUuid(candidate) ? service.from("schools").select("id,photographer_id").eq("id", candidate).limit(2)
      : Promise.resolve({ data: [], error: null }),
    service.from("schools").select("id,photographer_id").eq("local_school_id", candidate).limit(2),
  ]);
  if (byId.error) throw byId.error;
  if (byLocal.error) throw byLocal.error;
  const matches = [...new Map([...(byId.data ?? []), ...(byLocal.data ?? [])].map(row => [row.id, row])).values()];
  return matches.length === 1 && matches[0].photographer_id === photographerId ? { ok: true } : denied;
}

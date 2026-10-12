import type { SupabaseClient } from "@supabase/supabase-js";
import { isServerOnlyR2Key, isUuid, normalizeR2Key, scopeForR2Key } from "@/lib/r2-access-security";

type ServiceClient = Pick<SupabaseClient, "rpc">;
export type R2MediaOwnershipOptions = {
  prefix?: boolean;
  /** Only after an existing, paid order and its tenant/media binding are verified. */
  allowDeletedResource?: boolean;
};
export class R2MediaOwnershipError extends Error {
  constructor(public readonly status: 403 | 503) {
    super(status === 403 ? "This photo does not belong to the authorized studio." : "Photo authorization is temporarily unavailable.");
  }
}

/** A media/student URL is never proof of byte ownership. Use retained namespaces. */
export async function resolveR2MediaOwnership(
  service: ServiceClient, rawKey: string, photographerId: string,
  options: R2MediaOwnershipOptions = {},
): Promise<{ owned: boolean; schoolId: string | null; key: string | null }> {
  const key = normalizeR2Key(rawKey, { allowQueryCharacters: true, prefix: options.prefix });
  const denied = { owned: false, schoolId: null, key };
  if (!key || !isUuid(photographerId) || isServerOnlyR2Key(key)) return denied;
  const segments = key.replace(/\/$/, "").split("/"), [first, second] = segments;
  let scope = scopeForR2Key(key, { prefix: options.prefix });
  let allowPhotographerRoot = false;
  if (first === "crm-locations") scope = { kind: "photographer", id: second };
  else if (first === "thumbs") { scope = { kind: "school", id: second }; allowPhotographerRoot = true; }
  else if (first === "nobg-photos" && second !== "schools" && second !== "projects") allowPhotographerRoot = true;
  else if (!["projects", "probes", "schools", "photos", "nobg-photos", "backdrops"].includes(first)) allowPhotographerRoot = true;
  if (!scope || !scope.id || (scope.kind !== "school" && !isUuid(scope.id))) return denied;
  // A resource prefix is not an object. The nested no-background namespaces
  // need one additional segment for their project/school identifier.
  const resourceSegments = first === "nobg-photos" && ["schools", "projects"].includes(second) ? 3
    : ["projects", "probes", "schools", "photos", "backdrops", "thumbs", "nobg-photos", "crm-locations"].includes(first) ? 2 : 1;
  if (segments.length < resourceSegments || (!options.prefix && segments.length === resourceSegments)) return denied;
  // Legacy UUID roots can denote a school or a photographer. A school alias
  // may never redirect another photographer's established object namespace.
  if (allowPhotographerRoot && isUuid(scope.id)) {
    const photographer = await service.rpc("r2_media_namespace_owner", {
      p_kind: "photographer", p_root: scope.id, p_allow_photographer_root: false,
      p_allow_deleted_resource: false,
    });
    if (photographer.error) throw new R2MediaOwnershipError(503);
    if (!Array.isArray(photographer.data) || photographer.data.length > 1 ||
      (photographer.data.length === 1 && photographer.data[0]?.photographer_id !== photographerId)) return denied;
  }
  const { data, error } = await service.rpc("r2_media_namespace_owner", {
    p_kind: scope.kind, p_root: scope.id, p_allow_photographer_root: allowPhotographerRoot,
    p_allow_deleted_resource: options.allowDeletedResource === true,
  });
  if (error) throw new R2MediaOwnershipError(503);
  if (!Array.isArray(data) || data.length !== 1 || data[0]?.photographer_id !== photographerId) return denied;
  return { owned: true, schoolId: typeof data[0].school_id === "string" ? data[0].school_id : null, key };
}

export async function r2MediaOwnedBy(service: ServiceClient, key: string, photographerId: string, options: R2MediaOwnershipOptions = {}) {
  return (await resolveR2MediaOwnership(service, key, photographerId, options)).owned;
}

export async function assertR2MediaOwnership(service: ServiceClient, key: string, photographerId: string, options: R2MediaOwnershipOptions = {}) {
  const result = await resolveR2MediaOwnership(service, key, photographerId, options);
  if (!result.owned) throw new R2MediaOwnershipError(403);
  return result;
}

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { r2Download } from "@/lib/r2";
import { r2PresignedGetUrl } from "@/lib/r2-signed-urls";
import { isUuid, normalizeR2Key, scopeForR2Key } from "@/lib/r2-access-security";

export type CreditCutoutService = Pick<SupabaseClient, "from" | "rpc">;
export type CreditCutoutBinding = { object_key: string; original_sha256: string; cutout_sha256: string };
export const MAX_MANAGED_CUTOUT_BYTES = 25 * 1024 * 1024;
export const MANAGED_CUTOUT_URL_TTL_SECONDS = 300;
const SHA256 = /^[a-f0-9]{64}$/;

export function isManagedCutoutKey(key: string) {
  return key.trim().split("/")[0] === "nobg-photos";
}

export class CreditCutoutAccessError extends Error {
  constructor() { super("This cutout has no verified paid access. Keep the original file for review or process it through Studio OS."); }
}

export async function authorizedCutoutBindings(service: CreditCutoutService, photographerId: string, keys: string[]) {
  const requested = [...new Set(keys.filter(key => isManagedCutoutKey(key) && normalizeR2Key(key, { allowQueryCharacters: true }) === key))];
  const result = new Map<string, CreditCutoutBinding>();
  if (!requested.length) return result;
  if (!photographerId || typeof service.rpc !== "function") throw new CreditCutoutAccessError();
  for (let offset = 0; offset < requested.length; offset += 500) {
    const batch = requested.slice(offset, offset + 500);
    const { data, error } = await service.rpc("authorized_credit_cutout_keys", { p_photographer_id: photographerId, p_keys: batch });
    if (error) throw new CreditCutoutAccessError();
    const allowed = new Set(batch);
    for (const row of (data ?? []) as CreditCutoutBinding[]) {
      if (allowed.has(row.object_key) && SHA256.test(row.original_sha256) && SHA256.test(row.cutout_sha256)) result.set(row.object_key, row);
    }
  }
  return result;
}

export async function assertPaidCutoutUpload(service: CreditCutoutService, studioId: string, originalHash: string, cutoutHash: string) {
  if (!SHA256.test(originalHash) || !SHA256.test(cutoutHash)) throw new CreditCutoutAccessError();
  const { data, error } = await service.rpc("has_studio_cutout_entitlement", {
    p_studio_id: studioId, p_original_sha256: originalHash, p_cutout_sha256: cutoutHash,
  });
  if (error || data !== true) throw new CreditCutoutAccessError();
}

export async function linkPaidCutoutObject(service: CreditCutoutService, studioId: string, key: string, originalHash: string, cutoutHash: string) {
  const { data, error } = await service.rpc("link_credit_cutout_object", {
    p_studio_id: studioId, p_object_key: key, p_original_sha256: originalHash, p_cutout_sha256: cutoutHash,
  });
  if (error || data !== true) throw new CreditCutoutAccessError();
}

export async function readBoundCutout(binding: CreditCutoutBinding) {
  const bytes = await r2Download(binding.object_key, { allowVerifiedCutout: true, maxBytes: MAX_MANAGED_CUTOUT_BYTES });
  if (createHash("sha256").update(bytes).digest("hex") !== binding.cutout_sha256) throw new CreditCutoutAccessError();
  return bytes;
}

export async function readPaidCutout(service: CreditCutoutService, photographerId: string, key: string) {
  const binding = (await authorizedCutoutBindings(service, photographerId, [key])).get(key);
  if (!binding) throw new CreditCutoutAccessError();
  return readBoundCutout(binding);
}

export function signVerifiedCutout(key: string, ttlSeconds?: number) {
  const ttl = typeof ttlSeconds === "number" && Number.isFinite(ttlSeconds) ? ttlSeconds : MANAGED_CUTOUT_URL_TTL_SECONDS;
  return r2PresignedGetUrl(key, Math.min(Math.max(1, ttl), MANAGED_CUTOUT_URL_TTL_SECONDS), { allowVerifiedCutout: true });
}

// Fallback for trusted server consumers that cannot supply a known owner:
// resolve a canonical resource in the DB, never a filename or ambiguous id.
async function resolveCutoutOwner(service: CreditCutoutService, key: string) {
  const scope = scopeForR2Key(key);
  if (!scope) return null;
  if (scope.kind === "project") {
    if (!isUuid(scope.id)) return null;
    const { data, error } = await service.from("projects").select("photographer_id").eq("id", scope.id).maybeSingle();
    if (error) throw new CreditCutoutAccessError();
    return data?.photographer_id as string | null;
  }
  if (scope.kind !== "school" || !/^[A-Za-z0-9_-]+$/.test(scope.id)) return null;
  const [byId, byLocal] = await Promise.all([
    isUuid(scope.id) ? service.from("schools").select("id,photographer_id").eq("id", scope.id).limit(2) : Promise.resolve({ data: [], error: null }),
    service.from("schools").select("id,photographer_id").eq("local_school_id", scope.id).limit(2),
  ]);
  if (byId.error || byLocal.error) throw new CreditCutoutAccessError();
  const matches = [...new Map([...(byId.data ?? []), ...(byLocal.data ?? [])].map(row => [row.id, row])).values()];
  return matches.length === 1 ? matches[0].photographer_id as string | null : null;
}

export async function filterPaidCutoutFiles<T extends { key: string; url: string }>(files: T[], options: {
  service?: CreditCutoutService; photographerId?: string | null; ttlSeconds?: number;
} = {}): Promise<T[]> {
  const managed = files.filter(file => isManagedCutoutKey(file.key));
  if (!managed.length) return files;
  const service = options.service ?? createDashboardServiceClient();
  const groups = new Map<string, string[]>();
  const ownerByNamespace = new Map<string, string | null>();
  for (const file of managed) {
    let owner = options.photographerId;
    if (!owner) {
      const scope = scopeForR2Key(file.key);
      const namespace = scope ? `${scope.kind}:${scope.id}` : file.key;
      if (!ownerByNamespace.has(namespace)) ownerByNamespace.set(namespace, await resolveCutoutOwner(service, file.key));
      owner = ownerByNamespace.get(namespace);
    }
    if (owner) groups.set(owner, [...(groups.get(owner) ?? []), file.key]);
  }
  const bindings = new Map<string, CreditCutoutBinding>();
  for (const [owner, keys] of groups) for (const [key, binding] of await authorizedCutoutBindings(service, owner, keys)) bindings.set(key, binding);
  const filtered: T[] = [];
  for (const file of files) {
    if (!isManagedCutoutKey(file.key)) { filtered.push(file); continue; }
    const binding = bindings.get(file.key);
    if (!binding) continue; // Retain unknown/legacy objects for review.
    try {
      await readBoundCutout(binding);
      const url = signVerifiedCutout(file.key, options.ttlSeconds);
      if (url) filtered.push({ ...file, url });
    } catch { /* Do not expose a missing or overwritten paid output. */ }
  }
  return filtered;
}

export async function firstPaidCutoutBytes(keys: string[], options: { service?: CreditCutoutService; photographerId?: string | null } = {}) {
  const service = options.service ?? createDashboardServiceClient();
  const owner = options.photographerId || (keys[0] ? await resolveCutoutOwner(service, keys[0]) : null);
  if (!owner) return null;
  const bindings = await authorizedCutoutBindings(service, owner, keys);
  for (const key of keys) {
    const binding = bindings.get(key);
    if (!binding) continue;
    try { return await readBoundCutout(binding); } catch { /* Try another verified convention only. */ }
  }
  return null;
}

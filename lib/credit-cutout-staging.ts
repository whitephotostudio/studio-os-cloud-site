import { r2Delete, r2Download } from "@/lib/r2";
import { MAX_MANAGED_CUTOUT_BYTES } from "@/lib/credit-cutout-access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class CreditCutoutStagingError extends Error {
  constructor() { super("The private cutout upload could not be verified. Upload the original PNG again."); }
}
export function ownsCutoutStagingKey(studioId: string, key: unknown): key is string {
  if (!UUID.test(studioId) || typeof key !== "string") return false;
  const parts = key.split("/");
  return parts.length === 3 && parts[0] === "credit-staging" && parts[1] === studioId &&
    parts[2].endsWith(".png") && UUID.test(parts[2].slice(0, -4));
}
export async function readOwnedCutoutStaging(studioId: string, key: unknown) {
  if (!ownsCutoutStagingKey(studioId, key)) throw new CreditCutoutStagingError();
  try {
    const bytes = await r2Download(key, { allowCutoutStaging: true, maxBytes: MAX_MANAGED_CUTOUT_BYTES });
    if (!bytes.length || bytes.length > MAX_MANAGED_CUTOUT_BYTES) throw new CreditCutoutStagingError();
    return bytes;
  } catch { throw new CreditCutoutStagingError(); }
}
export async function cleanOwnedCutoutStaging(studioId: string, keys: unknown[]) {
  for (const key of new Set(keys)) {
    if (!ownsCutoutStagingKey(studioId, key)) continue;
    // A stale upload URL can recreate only this private, unentitled object.
    // Cleanup failure must not undo a committed proof or canonical upload.
    try { await r2Delete(key, { allowCutoutStaging: true }); } catch { /* retry/orphan cleanup is safe */ }
  }
}

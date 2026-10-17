import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCollageTemplate, type CollageTemplate } from "@/lib/collage-template";

export class CollageAccessError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const COLLAGE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type CollageGalleryScope = { schoolId?: string; projectId?: string };
export type StoredCollageVersion = {
  id: string; templateId: string; photographerId: string; versionNumber: number;
  design: CollageTemplate; artworkKey: string | null; contentHash: string; published: boolean;
};
export type CollageVersionRow = {
  id: string; template_id: string; photographer_id: string; version_number: number;
  design: unknown; artwork_key: string | null; content_hash: string; published: boolean;
};
export const collageVersionFields = "id,template_id,photographer_id,version_number,design,artwork_key,content_hash,published";

/** Enforce the byte budget while reading, including chunked browser uploads. */
export async function readCollageJson(request: Request, maximumBytes: number): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length")) > maximumBytes) throw new CollageAccessError("The collage request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new CollageAccessError("A collage request body is required.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel().catch(() => {});
        throw new CollageAccessError("The collage request is too large.", 413);
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error();
    return body as Record<string, unknown>;
  } catch { throw new CollageAccessError("Invalid collage request JSON."); }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
export function collageContentHash(design: CollageTemplate, artworkKey: string | null) {
  return createHash("sha256").update(JSON.stringify(canonical([design, artworkKey]))).digest("hex");
}
export function collageArtworkKey(photographerId: string, hash: string) {
  if (!COLLAGE_UUID.test(photographerId) || !/^[a-f0-9]{64}$/.test(hash)) throw new CollageAccessError("Invalid collage artwork identity.");
  // The existing production adapter reserves this namespace from generic image
  // signing, public proxying, copying and deletion.
  return `order-automation/${photographerId}/collages/artwork/${hash}.png`;
}
export function assertCollageArtworkKey(photographerId: string, value: string | null) {
  if (value === null) return;
  const prefix = `order-automation/${photographerId}/collages/artwork/`;
  if (!value.startsWith(prefix) || !/^[a-f0-9]{64}\.png$/.test(value.slice(prefix.length))) throw new CollageAccessError("Collage artwork belongs to another studio.", 403);
}
export function storedCollageVersion(row: CollageVersionRow): StoredCollageVersion {
  if (!COLLAGE_UUID.test(row.id) || !COLLAGE_UUID.test(row.template_id) || !COLLAGE_UUID.test(row.photographer_id) || !Number.isInteger(row.version_number) || row.version_number < 1) throw new CollageAccessError("Invalid saved collage version.", 409);
  const design = parseCollageTemplate(row.design);
  if (design.overlay) throw new CollageAccessError("Saved collage artwork must use private storage.", 409);
  assertCollageArtworkKey(row.photographer_id, row.artwork_key);
  if (row.content_hash !== collageContentHash(design, row.artwork_key)) throw new CollageAccessError("Saved collage content changed. Reopen the design.", 409);
  return { id: row.id, templateId: row.template_id, photographerId: row.photographer_id, versionNumber: row.version_number, design, artworkKey: row.artwork_key, contentHash: row.content_hash, published: row.published === true };
}
export function validateCollageVersionAccess(rows: CollageVersionRow[], photographerId: string, versionIds: string[], assignedVersionIds: string[]) {
  if (!COLLAGE_UUID.test(photographerId) || versionIds.length > 20 || versionIds.some(id => !COLLAGE_UUID.test(id))) throw new CollageAccessError("Invalid collage selection.");
  const assigned = new Set(assignedVersionIds);
  const result = new Map<string, StoredCollageVersion>();
  for (const id of new Set(versionIds)) {
    const row = rows.find(row => row.id === id && row.photographer_id === photographerId && row.published === true);
    if (!row || !assigned.has(id)) throw new CollageAccessError("A collage design is not available to this gallery. Reopen the gallery.", 403);
    result.set(id, storedCollageVersion(row));
  }
  return result;
}

async function loadCollageVersionAccess(service: SupabaseClient, photographerId: string, scope: CollageGalleryScope, versionIds: string[]) {
  if (!!scope.schoolId === !!scope.projectId || !COLLAGE_UUID.test(scope.schoolId || scope.projectId || "") || versionIds.length > 20 || versionIds.some(id => !COLLAGE_UUID.test(id))) throw new CollageAccessError("Invalid collage gallery scope.");
  const gallery = await service.from(scope.schoolId ? "schools" : "projects").select("id").eq("id", scope.schoolId || scope.projectId!).eq("photographer_id", photographerId).maybeSingle();
  if (gallery.error) throw gallery.error;
  if (!gallery.data) throw new CollageAccessError("This collage gallery is unavailable.", 403);
  const ids = [...new Set(versionIds)];
  const [versions, grants] = await Promise.all([
    service.from("collage_template_versions").select(collageVersionFields).eq("photographer_id", photographerId).in("id", ids),
    service.from("collage_template_galleries").select("version_id").eq("photographer_id", photographerId).eq(scope.schoolId ? "school_id" : "project_id", scope.schoolId || scope.projectId!).in("version_id", ids).is("revoked_at", null),
  ]);
  if (versions.error) throw versions.error;
  if (grants.error) throw grants.error;
  return { rows: (versions.data ?? []) as CollageVersionRow[], assigned: (grants.data ?? []).map(row => row.version_id), ids };
}
/** Called only after authenticating the parent's actual gallery scope. */
export async function resolveCollageVersions(service: SupabaseClient, photographerId: string, scope: CollageGalleryScope, versionIds: string[]) {
  if (!versionIds.length) return new Map<string, StoredCollageVersion>();
  const loaded = await loadCollageVersionAccess(service, photographerId, scope, versionIds);
  return validateCollageVersionAccess(loaded.rows, photographerId, loaded.ids, loaded.assigned);
}
/** Catalogue discovery omits unavailable products without exposing their owners or designs. */
export async function resolveCollageCatalogueVersions(service: SupabaseClient, photographerId: string, scope: CollageGalleryScope, versionIds: string[]) {
  if (!versionIds.length) return { versions: new Map<string, StoredCollageVersion>(), unavailableVersionIds: [] as string[] };
  const loaded = await loadCollageVersionAccess(service, photographerId, scope, versionIds);
  const versions = new Map<string, StoredCollageVersion>(), unavailableVersionIds: string[] = [];
  for (const id of loaded.ids) {
    try { versions.set(id, validateCollageVersionAccess(loaded.rows, photographerId, [id], loaded.assigned).get(id)!); }
    catch (error) { if (!(error instanceof CollageAccessError)) throw error; unavailableVersionIds.push(id); }
  }
  return { versions, unavailableVersionIds };
}

export async function readCollageArtwork(version: Pick<StoredCollageVersion, "photographerId" | "artworkKey">) {
  assertCollageArtworkKey(version.photographerId, version.artworkKey);
  if (!version.artworkKey) return null;
  const { readProduction, digest } = await import("./order-automation-storage");
  const result = await readProduction(version.artworkKey, 12 * 1024 * 1024);
  if (!version.artworkKey.endsWith(`/${digest(result.bytes)}.png`)) throw new CollageAccessError("Saved collage artwork changed.", 409);
  return result.bytes;
}
export async function collageVersionForPreview(version: StoredCollageVersion) {
  const artwork = await readCollageArtwork(version);
  return { ...version, design: { ...version.design, overlay: artwork ? `data:image/png;base64,${artwork.toString("base64")}` : null } };
}

export async function collageDashboardAccess(request: import("next/server").NextRequest, mutate = false) {
  const { resolveDashboardAuth, createDashboardServiceClient } = await import("./dashboard-auth");
  const { user } = await resolveDashboardAuth(request);
  if (!user) throw new CollageAccessError("Please sign in to Studio OS again.", 401);
  const service = createDashboardServiceClient();
  if (mutate) {
    const { guardAgreement } = await import("./require-agreement");
    const result = await guardAgreement({ service, userId: user.id });
    if (!result.ok) throw new CollageAccessError("Accept the studio agreement before saving collage designs.", result.status);
  }
  const owner = await service.from("photographers").select("id").eq("user_id", user.id).maybeSingle();
  if (owner.error) throw owner.error;
  if (!owner.data) throw new CollageAccessError("Photographer profile not found.", 404);
  return { service, photographerId: owner.data.id as string, user };
}

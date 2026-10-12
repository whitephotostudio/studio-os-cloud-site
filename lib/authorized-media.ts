import type { SupabaseClient } from "@supabase/supabase-js";
import { legacyStorageOwner } from "@/lib/legacy-storage-access";
import { privateSupabaseStorageReference } from "@/lib/photo-url";
import { privateMediaKeyFromReference } from "@/lib/private-media-references";
import { r2MediaOwnedBy } from "@/lib/r2-media-ownership";
import { r2PresignedGetUrl } from "@/lib/r2-signed-urls";
import { normalizeR2Key } from "@/lib/r2-access-security";

type Service = Pick<SupabaseClient, "from" | "rpc" | "storage">;
const clean = (value: string | null | undefined) => (value ?? "").trim();

/** For server byte readers: owning an editable DB row never proves file ownership. */
export async function authorizedMediaUrl(service: Service, reference: string, photographerId: string | null | undefined, ttlSeconds = 300, options: { allowDeletedResource?: boolean } = {}) {
  if (!photographerId) throw new Error("A photo owner is required.");
  const legacy = privateSupabaseStorageReference(reference);
  if (legacy) {
    if (await legacyStorageOwner(service, legacy.bucket, legacy.key) !== photographerId) throw new Error("This legacy photo belongs to another storage owner.");
    const { data, error } = await service.storage.from(legacy.bucket).createSignedUrl(legacy.key, ttlSeconds);
    const signed = privateSupabaseStorageReference(data?.signedUrl);
    if (error || !data?.signedUrl || signed?.bucket !== legacy.bucket || signed.key !== legacy.key) throw new Error("The legacy photo could not be authorized.");
    return data.signedUrl;
  }
  const key = privateMediaKeyFromReference(reference) || normalizeR2Key(reference, { allowQueryCharacters: true });
  if (!key || !await r2MediaOwnedBy(service, key, photographerId, options)) throw new Error("This photo is outside the studio storage namespace.");
  const url = r2PresignedGetUrl(key, ttlSeconds);
  if (!url) throw new Error("The private photo could not be authorized.");
  return url;
}

export async function authorizedMediaUrls(service: Service, input: { storagePath?: string | null; previewUrl?: string | null; thumbnailUrl?: string | null }, photographerId: string | null | undefined, ttlSeconds = 300) {
  const source = clean(input.storagePath) || clean(input.previewUrl) || clean(input.thumbnailUrl);
  const legacy = privateSupabaseStorageReference(source);
  let references: { originalUrl: string; previewUrl: string; thumbnailUrl: string };
  if (legacy) {
    references = { originalUrl: source, previewUrl: clean(input.previewUrl) || source, thumbnailUrl: clean(input.thumbnailUrl) || clean(input.previewUrl) || source };
  } else {
    const key = privateMediaKeyFromReference(source);
    if (!key) throw new Error("A canonical private photo reference is required.");
    const base = key.replace(/_(preview|thumbnail)\.[^.]+$/i, ".jpg").replace(/\.[^./]+$/i, "");
    references = { originalUrl: `${base}.jpg`, previewUrl: clean(input.previewUrl) || `${base}_preview.jpg`, thumbnailUrl: clean(input.thumbnailUrl) || `${base}_thumbnail.jpg` };
  }
  const cache = new Map<string, Promise<string>>();
  const sign = (reference: string) => {
    if (!cache.has(reference)) cache.set(reference, authorizedMediaUrl(service, reference, photographerId, ttlSeconds));
    return cache.get(reference)!;
  };
  const [originalUrl, previewUrl, thumbnailUrl] = await Promise.all([sign(references.originalUrl), sign(references.previewUrl), sign(references.thumbnailUrl)]);
  return { originalUrl, previewUrl, thumbnailUrl };
}

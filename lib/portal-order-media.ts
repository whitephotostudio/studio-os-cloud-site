import { privateMediaKeyFromReference } from "@/lib/private-media-references";
import { extractStoragePathFromSupabaseUrl } from "@/lib/storage-images";

// History/reorder payloads carry durable identity. Rendering uses the current
// gallery's separately authorized preview map; history never presigns originals.
export function canonicalPortalOrderReference(value: string | null | undefined) {
  const raw = (value || "").trim();
  if (!raw) return null;
  const key = privateMediaKeyFromReference(raw) || extractStoragePathFromSupabaseUrl(raw);
  if (!key || key.includes("..") || key.includes("\\") || /[\u0000-\u001f\u007f]/.test(key) || key.includes("://")) return null;
  return key.replace(/_(preview|thumbnail)\.[^/.]+$/i, ".jpg");
}

export function canonicalPortalOrderSnapshot<T>(value: T): T {
  if (typeof value === "string") {
    const key = canonicalPortalOrderReference(value);
    if (key) return key as T;
    // External/raw image URLs do not establish permission to read a photo.
    if (/^https?:\/\//i.test(value) && /\.(jpe?g|png|webp|avif)([?#]|$)/i.test(value)) return null as T;
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalPortalOrderSnapshot) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, canonicalPortalOrderSnapshot(entry)])) as T;
  return value;
}

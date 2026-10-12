import { signedPrivateMediaReference } from "@/lib/private-media-references";

type BackdropReferenceRow = {
  image_url?: string | null;
  thumbnail_url?: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

export function signedBackdropReference(
  value: string | null | undefined,
  ttlSeconds: number,
  photographerId?: string | null,
) {
  const raw = clean(value);
  if (!raw) return raw;
  return signedPrivateMediaReference(raw, ttlSeconds, photographerId);
}

export function signBackdropRows<T extends BackdropReferenceRow>(
  rows: T[],
  ttlSeconds: number,
  photographerId?: string | null,
) {
  return rows.map((row) => ({
    ...row,
    image_url: signedBackdropReference(row.image_url, ttlSeconds, photographerId),
    thumbnail_url: signedBackdropReference(row.thumbnail_url, ttlSeconds, photographerId),
  }));
}

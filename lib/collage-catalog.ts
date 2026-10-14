import { packageCollageVersion } from "./collage-selection";

/** Shared price sheets can contain designs assigned to different galleries. */
export function galleryCollagePackageAvailable(pkg: { items?: unknown[] | null }, available: Record<string, unknown>) {
  try { return (pkg.items ?? []).every(item => {
    const id = packageCollageVersion(item);
    return !id || (Object.hasOwn(available, id) && !!available[id]);
  }); } catch { return false; }
}
export function collageVersionBatches(ids: string[]) {
  const unique = [...new Set(ids)];
  return Array.from({ length: Math.ceil(unique.length / 20) }, (_, index) => unique.slice(index * 20, (index + 1) * 20));
}

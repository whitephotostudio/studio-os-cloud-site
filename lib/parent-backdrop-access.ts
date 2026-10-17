export type ParentBackdropPortrait = {
  id: string;
  references: readonly (string | null | undefined)[];
};

export const PARENT_BACKDROP_UNAVAILABLE =
  "The selected background isn't ready for every photo in this item. " +
  "Choose a photo with background options, or ask your photographer for help.";

export const PARENT_BACKDROPS_DISABLED =
  "Background changes are no longer offered for this gallery. " +
  "Remove background items from your basket and add the original photos instead.";

export function canOfferParentBackdrops(options: {
  schoolMode: boolean;
  composite: boolean;
  catalogCount: number;
  cutoutUrl: string | null | undefined;
  onlineBackdropsEnabled?: boolean;
}) {
  return options.onlineBackdropsEnabled !== false && options.schoolMode && !options.composite && options.catalogCount > 0 &&
    !!options.cutoutUrl?.trim();
}

// Candidates must come from the fresh server-authorized gallery response.
// A filename, public bucket listing or successful unauthenticated probe is
// never added here. Loading checks usability, not payment authorization.
export async function usableParentCutouts(
  candidates: Record<string, string>,
  photoIds: readonly string[],
  canLoad: (url: string) => Promise<boolean>,
) {
  const allowedIds = new Set(photoIds);
  const results = await Promise.all(Object.entries(candidates).map(async ([id, url]) => {
    if (!allowedIds.has(id) || typeof url !== "string" || !url.trim()) return null;
    try { return await canLoad(url) ? [id, url] as const : null; }
    catch { return null; }
  }));
  return Object.fromEntries(results.filter((result) => result !== null));
}

function referenceWithoutSignature(value: string | null | undefined) {
  // Preserve the complete namespace and filename. Two different children or
  // albums with the same portrait basename must never share readiness.
  const candidate = (value ?? "").trim().split(/[?#]/)[0];
  try {
    const url = new URL(candidate, "https://studio.invalid");
    const path = decodeURIComponent(url.pathname);
    if (path.startsWith("/api/r2/img/")) return path.slice("/api/r2/img/".length);
    const storage = path.match(/^\/storage\/v1\/(?:object|render\/image)\/(?:public|sign)\/[^/]+\/(.+)$/);
    if (storage && /\.supabase\.co$/.test(url.hostname)) return storage[1];
    // Signed bucket URLs (R2 / Backblaze / Wasabi / AWS; keep in sync with
    // lib/storage-hosts.ts) address the bucket in the path on `s3.` and
    // `<account>.r2.cloudflarestorage.com` hosts, so the key follows it.
    if (/(^|\.)(r2\.cloudflarestorage\.com|backblazeb2\.com|wasabisys\.com|amazonaws\.com)$/i.test(url.hostname)) {
      const pathStyle = /\.r2\.cloudflarestorage\.com$/i.test(url.hostname) ? url.hostname.split(".").length === 4 : /^s3\./i.test(url.hostname);
      return path.split("/").slice(pathStyle ? 2 : 1).join("/");
    }
  } catch { /* Unknown URL shapes match only their exact reference. */ }
  return candidate;
}

export function parentBackdropSelectionIssue(options: {
  hasBackdrop: boolean;
  composite?: boolean;
  category: string;
  selectedImageUrl?: string | null;
  slots?: readonly { assignedImageUrl?: string | null }[];
  digitalSelections?: readonly { url: string }[];
  allDigitals?: boolean;
  portraits: readonly ParentBackdropPortrait[];
  cutoutUrls: Record<string, string>;
}) {
  if (!options.hasBackdrop) return "";
  if (options.composite) return PARENT_BACKDROP_UNAVAILABLE;
  const selectedReferences = options.category === "digital"
    ? options.allDigitals
      ? options.portraits.map((photo) => photo.references.find((value) => !!value))
      : options.digitalSelections?.length
        ? options.digitalSelections.map((selection) => selection.url)
        : [options.selectedImageUrl]
    : (options.slots ?? []).map((slot) => slot.assignedImageUrl);
  if (!selectedReferences.length || selectedReferences.some((value) => !value?.trim())) {
    return PARENT_BACKDROP_UNAVAILABLE;
  }
  for (const reference of selectedReferences) {
    const normalized = referenceWithoutSignature(reference);
    const matches = options.portraits.filter((photo) => photo.references.some((candidate) =>
      !!candidate && referenceWithoutSignature(candidate) === normalized));
    if (matches.length !== 1 || !options.cutoutUrls[matches[0].id]?.trim()) {
      return PARENT_BACKDROP_UNAVAILABLE;
    }
  }
  return "";
}

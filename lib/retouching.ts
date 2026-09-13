export const MAX_RETOUCH_PHOTOS = 20;
export const MAX_RETOUCH_NOTES_LENGTH = 2000;

export type RetouchSelection = {
  imageUrl: string;
  notes: string;
};

type RetouchPackage = {
  name?: string | null;
  is_retouch_addon?: boolean | null;
};

export function isRetouchPackage(pkg: RetouchPackage): boolean {
  return pkg.is_retouch_addon === true || /retouch/i.test(pkg.name ?? "");
}

/** The configured product name states how many distinct poses are included. */
export function retouchPhotoLimit(pkg: RetouchPackage, quantity = 1): number {
  const name = pkg.name ?? "";
  if (/\ball\s+(?:photos?|images?|poses?)\b/i.test(name)) return MAX_RETOUCH_PHOTOS;
  const count = name.match(/\b(\d+)\s*(?:photos?|images?|poses?)\b/i)?.[1];
  return Math.min(MAX_RETOUCH_PHOTOS, Math.max(1, Number(count) || 1) * Math.max(1, quantity));
}

export function parseRetouchSelections(raw: unknown):
  | { ok: true; value: RetouchSelection[] }
  | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw) || raw.length > MAX_RETOUCH_PHOTOS) {
    return { ok: false, message: `Choose up to ${MAX_RETOUCH_PHOTOS} retouching photos.` };
  }
  const value: RetouchSelection[] = [];
  const seen = new Set<string>();
  for (const selection of raw) {
    if (!selection || typeof selection !== "object" ||
        typeof selection.imageUrl !== "string" ||
        !selection.imageUrl.trim() || selection.imageUrl.length > 2048 ||
        /[\u0000-\u001f\u007f]/.test(selection.imageUrl) ||
        (selection.notes !== undefined && typeof selection.notes !== "string")) {
      return { ok: false, message: "Choose a photo and enter valid retouching instructions." };
    }
    const imageUrl = selection.imageUrl.trim();
    const notes = (selection.notes ?? "").trim();
    if (notes.length > MAX_RETOUCH_NOTES_LENGTH) {
      return { ok: false, message: `Retouching instructions must be ${MAX_RETOUCH_NOTES_LENGTH} characters or fewer per photo.` };
    }
    if (seen.has(imageUrl)) {
      return { ok: false, message: "Choose each retouching photo only once." };
    }
    seen.add(imageUrl);
    value.push({ imageUrl, notes });
  }
  return { ok: true, value };
}

export function retouchSelectionIssue(
  pkg: RetouchPackage,
  selections: RetouchSelection[],
  quantity = 1,
): string {
  if (!isRetouchPackage(pkg)) {
    return selections.length ? "Retouching selections require a retouching service." : "";
  }
  if (!selections.length) return `Choose the photo(s) to retouch for ${pkg.name || "retouching"}.`;
  const parsed = parseRetouchSelections(selections);
  if (!parsed.ok) return parsed.message;
  const limit = retouchPhotoLimit(pkg, quantity);
  return selections.length > limit
    ? `${pkg.name || "Retouching"} includes up to ${limit} photo${limit === 1 ? "" : "s"}. Choose fewer photos or add another retouching service.`
    : "";
}

/** Durable photo references and notes are shared with Studio OS desktop. */
export function retouchNotesBlock(selections: RetouchSelection[]): string {
  if (!selections.length) return "";
  return [
    `RETOUCHING DETAILS JSON: ${JSON.stringify(selections)}`,
    ...selections.flatMap((selection) => [
      `RETOUCHING PHOTO: ${selection.imageUrl}`,
      `RETOUCHING NOTES: ${selection.notes.replace(/\r\n|\r|\n/g, "\n  > ") || "Standard retouching requested."}`,
    ]),
  ].join("\n");
}

/** Customer prose must not be interpreted as machine-written fulfillment metadata. */
export function customerNotesBlock(notes: string): string {
  return notes.trim()
    ? `CUSTOMER NOTES:\n${notes.trim().split(/\r\n|\r|\n/).map((line) => `> ${line}`).join("\n")}`
    : "";
}

/** Retouching is a service line with a photo, never a print-size slot. */
export function retouchSlots(packageName: string, selections: RetouchSelection[]) {
  const label = /retouch/i.test(packageName) ? packageName : `Retouching • ${packageName}`;
  return selections.map(({ imageUrl }) => ({ label, assignedImageUrl: imageUrl }));
}

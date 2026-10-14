import type { CollageTemplate } from "./collage-template";

/** One recipe is one finished print. Openings never represent billable items. */
export type CollageFrameSelection = { slotId: string; mediaId: string; zoom: number; x: number; y: number };
export type CollageSelection = {
  version: 1;
  templateVersionId: string;
  placements: CollageFrameSelection[];
  caption: { studentName: string; schoolName: string; year: string };
};
export const COLLAGE_VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid collage selection.");
  return value as Record<string, unknown>;
}
export function packageCollageVersion(item: unknown): string | null {
  if (!item || typeof item !== "object" || !("collage" in item) || item.collage == null) return null;
  const config = object(item.collage);
  if (typeof config.templateVersionId !== "string" || !COLLAGE_VERSION_ID.test(config.templateVersionId)) throw Error("This collage product has an invalid template version.");
  return config.templateVersionId;
}
/** Whitelist identities/crops; never persist submitted URLs, assets or prices. */
export function parseCollageSelection(value: unknown, template?: CollageTemplate): CollageSelection {
  const input = object(value);
  if (input.version !== 1 || typeof input.templateVersionId !== "string" || !COLLAGE_VERSION_ID.test(input.templateVersionId)) throw Error("Unsupported collage selection or template version.");
  if (!Array.isArray(input.placements) || input.placements.length > 8) throw Error("Invalid collage photo selections.");
  const ids = new Set<string>();
  const placements = input.placements.map(value => {
    const p = object(value);
    if (typeof p.slotId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(p.slotId) || ids.has(p.slotId)) throw Error("Invalid or repeated collage photo space.");
    ids.add(p.slotId);
    if (typeof p.mediaId !== "string" || !p.mediaId.trim() || p.mediaId.length > 1024 || /[:\\\u0000-\u001f\u007f?#]/.test(p.mediaId) || p.mediaId.split("/").some(part => part === ".." || part === ".")) throw Error("Choose a photo from this gallery for the collage.");
    if (typeof p.zoom !== "number" || !Number.isFinite(p.zoom) || p.zoom < 1 || p.zoom > 3 ||
      typeof p.x !== "number" || !Number.isFinite(p.x) || p.x < 0 || p.x > 1 ||
      typeof p.y !== "number" || !Number.isFinite(p.y) || p.y < 0 || p.y > 1) throw Error("The collage crop is outside the photo.");
    return { slotId: p.slotId, mediaId: p.mediaId, zoom: p.zoom, x: p.x, y: p.y };
  });
  if (template && (template.slots.length !== placements.length || template.slots.some(s => !ids.has(s.id)))) throw Error("Choose a photo for every collage space.");
  const c = object(input.caption);
  function text(key: string) {
    const v = c[key];
    if (typeof v !== "string" || v.length > 100 || /[\u0000-\u001f\u007f]/.test(v)) throw Error("Collage captions must be at most 100 characters per line.");
    return v.trim();
  }
  return { version: 1, templateVersionId: input.templateVersionId, placements,
    caption: { studentName: text("studentName"), schoolName: text("schoolName"), year: text("year") } };
}

export function emptyCollageSelection(templateVersionId: string): CollageSelection {
  if (!COLLAGE_VERSION_ID.test(templateVersionId)) throw Error("Invalid collage template version.");
  return { version: 1, templateVersionId, placements: [], caption: { studentName: "", schoolName: "", year: "" } };
}

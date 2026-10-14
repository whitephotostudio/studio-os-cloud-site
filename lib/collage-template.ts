/** Portable design only. Student photos and orders never belong in a template. */
export type CollageSlot = { id: string; label: string; x: number; y: number; width: number; height: number };
export type CollageTemplate = {
  version: 1;
  name: string;
  widthInches: number;
  heightInches: number;
  background: string;
  ink: string;
  overlay: string | null;
  slots: CollageSlot[];
  caption: { x: number; y: number; size: number };
};
export type CollagePhoto = { url: string; filename: string; width: number; height: number };
export type CollagePlacement = { photo: CollagePhoto; zoom: number; x: number; y: number };
export const COLLAGE_DPI = 300;
export const MAX_TEMPLATE_BYTES = 12 * 1024 * 1024;

export function collagePreset(kind: "triptych" | "graduation"): CollageTemplate {
  return kind === "triptych" ? {
    version: 1, name: "Three favourite moments", widthInches: 10, heightInches: 8,
    background: "#ffffff", ink: "#172033", overlay: null,
    slots: [
      { id: "left", label: "Left photo", x: .06, y: .12, width: .27, height: .62 },
      { id: "centre", label: "Centre photo", x: .365, y: .07, width: .27, height: .67 },
      { id: "right", label: "Right photo", x: .67, y: .12, width: .27, height: .62 },
    ], caption: { x: .5, y: .82, size: .028 },
  } : {
    version: 1, name: "Graduation keepsake", widthInches: 8, heightInches: 10,
    background: "#ffffff", ink: "#14245b", overlay: null,
    slots: [
      { id: "main", label: "Main portrait", x: .07, y: .055, width: .75, height: .67 },
      { id: "inset", label: "Inset portrait", x: .62, y: .53, width: .32, height: .32 },
    ], caption: { x: .33, y: .79, size: .027 },
  };
}

function finite(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid template structure.");
  return value as Record<string, unknown>;
}

/** Whitelist fields so imports cannot carry photos, credentials or remote URLs. */
export function parseCollageTemplate(value: unknown): CollageTemplate {
  const t = record(value);
  if (t.version !== 1) throw Error("Unsupported template version.");
  if (typeof t.name !== "string" || !t.name.trim() || t.name.length > 100) throw Error("Enter a template name (up to 100 characters).");
  if (!finite(t.widthInches, 4, 30) || !finite(t.heightInches, 4, 30) || t.widthInches * t.heightInches > 600) throw Error("Choose print dimensions from 4 to 30 inches, up to 600 square inches.");
  const color = (v: unknown) => typeof v === "string" && /^#[a-f\d]{6}$/i.test(v);
  if (!color(t.background) || !color(t.ink)) throw Error("Invalid template colours.");
  if (t.overlay !== null && (typeof t.overlay !== "string" || t.overlay.length > MAX_TEMPLATE_BYTES || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(t.overlay))) throw Error("Artwork must be an embedded PNG or JPEG.");
  if (!Array.isArray(t.slots) || t.slots.length < 1 || t.slots.length > 8) throw Error("A collage needs between 1 and 8 photo spaces.");
  const ids = new Set<string>();
  const slots = t.slots.map((value) => {
    const s = record(value);
    if (typeof s.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(s.id) || ids.has(s.id)) throw Error("Photo spaces need unique IDs.");
    ids.add(s.id);
    if (typeof s.label !== "string" || !s.label.trim() || s.label.length > 80) throw Error("Invalid photo-space label.");
    if (!finite(s.x, 0, 1) || !finite(s.y, 0, 1) || !finite(s.width, .02, 1) || !finite(s.height, .02, 1) || s.x + s.width > 1.000001 || s.y + s.height > 1.000001) throw Error("Keep every photo space inside the page.");
    return { id: s.id, label: s.label, x: s.x, y: s.y, width: s.width, height: s.height };
  });
  const c = record(t.caption);
  if (!finite(c.x, 0, 1) || !finite(c.y, 0, .9) || !finite(c.size, .01, .06)) throw Error("Keep the caption inside the page.");
  return { version: 1, name: t.name.trim(), widthInches: t.widthInches, heightInches: t.heightInches,
    background: t.background as string, ink: t.ink as string, overlay: t.overlay as string | null,
    slots, caption: { x: c.x, y: c.y, size: c.size } };
}

/** Source crop shared by preview and final output. Positions run from 0 to 1. */
export function collageCrop(photoWidth: number, photoHeight: number, frameWidth: number, frameHeight: number, zoom = 1, x = .5, y = .5) {
  if (![photoWidth, photoHeight, frameWidth, frameHeight].every(v => Number.isFinite(v) && v > 0)) throw Error("Invalid image dimensions.");
  if (![zoom, x, y].every(Number.isFinite)) throw Error("Invalid crop.");
  const scale = Math.max(frameWidth / photoWidth, frameHeight / photoHeight) * Math.min(3, Math.max(1, zoom));
  const width = Math.min(photoWidth, frameWidth / scale);
  const height = Math.min(photoHeight, frameHeight / scale);
  return { x: (photoWidth - width) * Math.min(1, Math.max(0, x)), y: (photoHeight - height) * Math.min(1, Math.max(0, y)), width, height };
}

export function collageResolution(template: CollageTemplate, slot: CollageSlot, placement: CollagePlacement) {
  const crop = collageCrop(placement.photo.width, placement.photo.height, template.widthInches * slot.width, template.heightInches * slot.height, placement.zoom, placement.x, placement.y);
  return Math.floor(Math.min(crop.width / (template.widthInches * slot.width), crop.height / (template.heightInches * slot.height)) + 1e-8);
}

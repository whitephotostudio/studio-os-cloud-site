import { createHash } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { COLLAGE_DPI, collageCrop, collageOutputSize, type CollageTemplate } from "@/lib/collage-template";
import { parseCollageSelection } from "@/lib/collage-selection";
import { CollageAccessError, storedCollageVersion, readCollageArtwork } from "@/lib/collage-server";
import type { CollageOrderSnapshot } from "@/lib/collage-checkout";
import { isServerOnlyR2Key, normalizeR2Key } from "@/lib/r2-access-security";

const xml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
export type CollageRenderResult = {
  bytes: Buffer; width: number; height: number; sha256: string;
  trim: { width: number; height: number }; bleedPixels: number;
  warnings: Array<{ slotId: string; ppi: number }>;
};

/** Validate the frozen recipe independently of any submitted preview or URLs. */
export function parseCollageOrderSnapshot(value: unknown): CollageOrderSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CollageAccessError("The order is missing its collage production recipe.", 409);
  const raw = value as CollageOrderSnapshot;
  const stored = storedCollageVersion({ id: raw.templateVersionId, template_id: raw.templateId, photographer_id: raw.photographerId,
    version_number: raw.versionNumber, design: raw.design, artwork_key: raw.artworkKey, content_hash: raw.contentHash, published: true });
  const selection = parseCollageSelection(raw, stored.design);
  const placements = selection.placements.map(placement => {
    const mediaKey = raw.placements.find(row => row.slotId === placement.slotId)?.mediaKey;
    if (typeof mediaKey !== "string" || !normalizeR2Key(mediaKey) || isServerOnlyR2Key(mediaKey) || /_(?:preview|thumbnail)\.[^/.]+$/i.test(mediaKey)) throw new CollageAccessError("A collage source must reference an authorized original photo.", 409);
    return { ...placement, mediaKey };
  });
  return { ...selection, placements, templateId: stored.templateId, photographerId: stored.photographerId, versionNumber: stored.versionNumber,
    design: stored.design, artworkKey: stored.artworkKey, contentHash: stored.contentHash };
}

/** The same pixels feed parent review and finished production output. */
export async function renderCollageProduction(input: {
  snapshot: unknown;
  loadMedia: (mediaKey: string) => Promise<Buffer>;
  loadArtwork?: (snapshot: CollageOrderSnapshot) => Promise<Buffer | null>;
  /** Private previews rasterize the same geometry at a bounded screen size. */
  previewMaxDimension?: number;
}): Promise<CollageRenderResult> {
  const snapshot = parseCollageOrderSnapshot(input.snapshot), template: CollageTemplate = snapshot.design;
  const output = collageOutputSize(template);
  if (input.previewMaxDimension !== undefined && (!Number.isInteger(input.previewMaxDimension) || input.previewMaxDimension < 240 || input.previewMaxDimension > 1600)) throw new CollageAccessError("Invalid collage preview size.");
  const renderScale = input.previewMaxDimension ? Math.min(1, input.previewMaxDimension / Math.max(output.width, output.height)) : 1;
  const dpi = COLLAGE_DPI * renderScale;
  const width = Math.round(output.width * renderScale), height = Math.round(output.height * renderScale);
  const trimWidth = template.widthInches * dpi, trimHeight = template.heightInches * dpi;
  const bleed = (template.bleedInches ?? 0) * dpi;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${template.background}"/>`];
  const warnings: CollageRenderResult["warnings"] = [];
  const originals = new Map<string, Promise<{ bytes: Buffer; width: number; height: number }>>();
  const imageIds = new Map<string, string>(), definitions: string[] = [];
  const source = (mediaKey: string) => {
    if (!originals.has(mediaKey)) originals.set(mediaKey, (async () => {
      const bytes = await input.loadMedia(mediaKey);
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 100 * 1024 * 1024) throw new CollageAccessError("A collage source image is too large or unavailable.", 409);
      const image = sharp(bytes, { limitInputPixels: 64_000_000 });
      const metadata = await image.metadata();
      if (!["jpeg", "png", "webp", "tiff", "heif", "avif"].includes(metadata.format || "")) throw new CollageAccessError("A collage source must be an original photograph.", 409);
      const rotated = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
      const originalWidth = rotated ? metadata.height! : metadata.width!, originalHeight = rotated ? metadata.width! : metadata.height!;
      if (!originalWidth || !originalHeight) throw new CollageAccessError("A collage original has invalid dimensions.", 409);
      // Decode only enough working pixels for the requested raster and crops.
      // PPI remains calculated from the original dimensions below. JPEG's
      // shrink-on-load also avoids decoding 24MP originals for a small preview.
      const neededScale = Math.min(1, Math.max(...snapshot.placements.filter(placement => placement.mediaKey === mediaKey).map(placement => {
        const slot = template.slots.find(slot => slot.id === placement.slotId)!;
        return Math.max(slot.width * trimWidth / originalWidth, slot.height * trimHeight / originalHeight) * placement.zoom;
      })));
      const decoded = await image.rotate().resize({ width: Math.max(1, Math.ceil(originalWidth * neededScale)), height: Math.max(1, Math.ceil(originalHeight * neededScale)), fit: "fill", withoutEnlargement: true }).toColorspace("srgb").png().toBuffer();
      return { bytes: decoded, width: originalWidth, height: originalHeight };
    })());
    return originals.get(mediaKey)!;
  };
  for (const slot of template.slots) {
    const placement = snapshot.placements.find(row => row.slotId === slot.id)!;
    const image = await source(placement.mediaKey);
    if (!imageIds.has(placement.mediaKey)) {
      const id = `photo-${imageIds.size}`; imageIds.set(placement.mediaKey, id);
      definitions.push(`<image id="${id}" width="${image.width}" height="${image.height}" preserveAspectRatio="none" xlink:href="data:image/png;base64,${image.bytes.toString("base64")}"/>`);
    }
    const frameWidth = slot.width * trimWidth, frameHeight = slot.height * trimHeight;
    const crop = collageCrop(image.width, image.height, frameWidth, frameHeight, placement.zoom, placement.x, placement.y);
    const ppi = Math.floor(Math.min(crop.width / (slot.width * template.widthInches), crop.height / (slot.height * template.heightInches)) + 1e-8);
    if (ppi < COLLAGE_DPI) warnings.push({ slotId: slot.id, ppi });
    // Nested viewBox preserves the shared fractional source crop exactly. There
    // is no integer extract rounding or EXIF-dependent crop drift.
    parts.push(`<svg x="${bleed + slot.x * trimWidth}" y="${bleed + slot.y * trimHeight}" width="${frameWidth}" height="${frameHeight}" viewBox="${crop.x} ${crop.y} ${crop.width} ${crop.height}" preserveAspectRatio="none" overflow="hidden"><use xlink:href="#${imageIds.get(placement.mediaKey)}"/></svg>`);
    if (slot.border?.widthInches) {
      const stroke = slot.border.widthInches * dpi;
      parts.push(`<rect x="${bleed + slot.x * trimWidth + stroke / 2}" y="${bleed + slot.y * trimHeight + stroke / 2}" width="${Math.max(0, frameWidth - stroke)}" height="${Math.max(0, frameHeight - stroke)}" fill="none" stroke="${slot.border.color}" stroke-width="${stroke}"/>`);
    }
  }
  if (snapshot.artworkKey) {
    const artwork = await (input.loadArtwork ?? readCollageArtwork)(snapshot);
    if (!artwork || !snapshot.artworkKey.endsWith(`/${createHash("sha256").update(artwork).digest("hex")}.png`)) throw new CollageAccessError("The frozen collage artwork is unavailable or changed.", 409);
    const meta = await sharp(artwork, { limitInputPixels: 40_000_000 }).metadata();
    if (meta.format !== "png") throw new CollageAccessError("Saved collage artwork must be a PNG.", 409);
    parts.push(`<image x="${bleed}" y="${bleed}" width="${trimWidth}" height="${trimHeight}" preserveAspectRatio="none" xlink:href="data:image/png;base64,${artwork.toString("base64")}"/>`);
  }
  const fontSize = trimWidth * template.caption.size;
  const maxWidth = Math.max(1, 2 * Math.min(template.caption.x, 1 - template.caption.x) * trimWidth * .95);
  const captions = [snapshot.caption.studentName, snapshot.caption.schoolName, snapshot.caption.year];
  for (const [index, caption] of captions.entries()) {
    if (!caption) continue;
    const text = xml(caption);
    const measured = await sharp({ text: { text, font: `Arial Bold ${fontSize}`, dpi: 72, rgba: true } }).metadata();
    const fit = (measured.width ?? 0) > maxWidth ? ` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"` : "";
    parts.push(`<text x="${bleed + template.caption.x * trimWidth}" y="${bleed + template.caption.y * trimHeight + index * fontSize * 1.5}" font-family="Arial, Liberation Sans, sans-serif" font-weight="bold" font-size="${fontSize}" dominant-baseline="text-before-edge" text-anchor="middle" fill="${template.ink}"${fit}>${text}</text>`);
  }
  parts.push("</svg>");
  parts.splice(1, 0, `<defs>${definitions.join("")}</defs>`);
  const bytes = await sharp(Buffer.from(parts.join("")), { limitInputPixels: 64_000_000 }).png().withMetadata({ density: Math.max(1, Math.round(dpi)) }).toBuffer();
  return { bytes, width: output.width, height: output.height, sha256: createHash("sha256").update(bytes).digest("hex"), trim: { width: Math.round(template.widthInches * COLLAGE_DPI), height: Math.round(template.heightInches * COLLAGE_DPI) }, bleedPixels: (template.bleedInches ?? 0) * COLLAGE_DPI, warnings };
}

/** For a stored owner-verified paid order only; never call with a browser recipe. */
export async function renderCollageOrderSnapshot(value: unknown, service: SupabaseClient) {
  const snapshot = parseCollageOrderSnapshot(value);
  const { assertR2MediaOwnership } = await import("./r2-media-ownership");
  const { r2Download } = await import("./r2");
  return renderCollageProduction({ snapshot, loadMedia: async key => {
    await assertR2MediaOwnership(service, key, snapshot.photographerId, { allowDeletedResource: true });
    return r2Download(key, { maxBytes: 100 * 1024 * 1024 });
  } });
}

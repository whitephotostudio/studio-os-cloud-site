import { parseCollageSelection, type CollageSelection } from "./collage-selection";
import type { CollageTemplate } from "./collage-template";

export type CollageGalleryVersion = { id: string; templateId: string; versionNumber: number; design: CollageTemplate; contentHash: string; hasArtwork?: boolean };
export type CollageGalleryPhoto = { mediaId: string; url: string; filename: string };

export function collageSelectionComplete(selection: CollageSelection, design?: CollageTemplate) {
  if (!design) return false;
  try { parseCollageSelection(selection, design); return true; } catch { return false; }
}
export function collageTrimPercent(design: CollageTemplate) {
  const bleed = design.bleedInches ?? 0;
  return {
    left: `${100 * bleed / (design.widthInches + 2 * bleed)}%`,
    right: `${100 * bleed / (design.widthInches + 2 * bleed)}%`,
    top: `${100 * bleed / (design.heightInches + 2 * bleed)}%`,
    bottom: `${100 * bleed / (design.heightInches + 2 * bleed)}%`,
  };
}

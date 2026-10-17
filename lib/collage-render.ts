import { collageCrop, type CollageTemplate, type CollagePlacement } from "./collage-template";

export async function loadCollageImage(url: string): Promise<HTMLImageElement> {
  // This editor accepts local uploads and embedded template artwork only.
  if (!url.startsWith("blob:") && !/^data:image\/(png|jpeg);base64,/.test(url)) throw Error("Use a local PNG or JPEG image.");
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => image.naturalWidth > 0 && image.naturalHeight > 0 ? resolve(image) : reject(Error("Empty image."));
    image.onerror = () => reject(Error("This image could not be opened. Use PNG or JPEG."));
    image.src = url;
  });
}

export async function renderCollage(template: CollageTemplate, placements: Record<string, CollagePlacement>, captions: string[], width: number, placeholders = false): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  const scale = width / template.widthInches;
  const bleed = (template.bleedInches ?? 0) * scale;
  const trimWidth = width, trimHeight = width * template.heightInches / template.widthInches;
  canvas.width = Math.round(trimWidth + 2 * bleed);
  canvas.height = Math.round(trimHeight + 2 * bleed);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw Error("Your browser does not support image export.");
  ctx.fillStyle = template.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const slot of template.slots) {
    const left = bleed + slot.x * trimWidth, top = bleed + slot.y * trimHeight;
    const w = slot.width * trimWidth, h = slot.height * trimHeight;
    const placement = Object.hasOwn(placements, slot.id) ? placements[slot.id] : undefined;
    if (placement) {
      const image = await loadCollageImage(placement.photo.url);
      const crop = collageCrop(image.naturalWidth, image.naturalHeight, w, h, placement.zoom, placement.x, placement.y);
      ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, left, top, w, h);
    } else if (placeholders) {
      ctx.fillStyle = "#e9edf3";
      ctx.fillRect(left, top, w, h);
      ctx.fillStyle = "#566176";
      ctx.font = `${trimWidth * .018}px Arial`;
      ctx.textAlign = "center";
      ctx.fillText(slot.label, left + w / 2, top + h / 2, w * .9);
    } else {
      throw Error(`Choose a photo for ${slot.label}.`);
    }
    if (slot.border?.widthInches) {
      const stroke = slot.border.widthInches * scale;
      ctx.strokeStyle = slot.border.color;
      ctx.lineWidth = stroke;
      ctx.strokeRect(left + stroke / 2, top + stroke / 2, Math.max(0, w - stroke), Math.max(0, h - stroke));
    }
  }
  // Transparent openings in the uploaded artwork reveal the assigned photos.
  if (template.overlay) ctx.drawImage(await loadCollageImage(template.overlay), bleed, bleed, trimWidth, trimHeight);
  ctx.fillStyle = template.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const fontSize = trimWidth * template.caption.size;
  ctx.font = `bold ${fontSize}px Arial`;
  captions.slice(0, 3).forEach((line, i) => ctx.fillText(line.slice(0, 100), bleed + template.caption.x * trimWidth, bleed + template.caption.y * trimHeight + i * fontSize * 1.5, Math.max(1, 2 * Math.min(template.caption.x, 1 - template.caption.x) * trimWidth * .95)));
  return canvas;
}

import { createHash } from "node:crypto";
import sharp from "sharp";
import { LabError } from "./validation";
import type { ProductionAsset, ProductionCrop, ProductionJob, ProductionSize } from "./production-types";

export const PRODUCTION_MAX_BYTES = 4_000_000;
export const PRODUCTION_MAX_PIXELS = 100_000_000;
export const PRODUCTION_DIMENSIONS = { "8x10": [2400, 3000], "5x7": [1500, 2100] } as const;
export const productionHash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const image = (bytes: Buffer) => sharp(bytes, { limitInputPixels: PRODUCTION_MAX_PIXELS, failOn: "warning" });

/** Decode the complete original; dimensions always describe its EXIF-upright view. */
export async function inspectProductionImage(bytes: Buffer) {
  if (!bytes.length || bytes.length > PRODUCTION_MAX_BYTES) throw new LabError("Choose a JPEG or PNG up to 4 MB.", 413, "PRODUCTION_FILE_SIZE");
  try {
    const source = image(bytes), m = await source.metadata();
    if (!m.width || !m.height || m.width < 16 || m.height < 16 || m.width > 16000 || m.height > 16000 ||
      (m.pages || 1) !== 1 || !["jpeg", "png"].includes(m.format || "")) throw Error("format");
    await source.stats();
    const swap = [5, 6, 7, 8].includes(m.orientation || 1);
    return { widthPixels: swap ? m.height : m.width, heightPixels: swap ? m.width : m.height,
      contentType: (m.format === "jpeg" ? "image/jpeg" : "image/png") as ProductionAsset["contentType"],
      byteSize: bytes.length, sha256: productionHash(bytes) };
  } catch { throw new LabError("Use a complete, single-image JPEG or PNG with 16–16,000 pixels per side and no more than 100 megapixels.", 400, "PRODUCTION_FILE_INVALID"); }
}

export function validateProductionCrop(source: Pick<ProductionAsset, "widthPixels" | "heightPixels">, size: ProductionSize, rect: ProductionCrop) {
  if (![rect.x, rect.y, rect.width, rect.height, rect.rotation].every(Number.isSafeInteger) ||
    rect.x < 0 || rect.y < 0 || rect.width < 1 || rect.height < 1 || ![0, 90, 180, 270].includes(rect.rotation) ||
    rect.x + rect.width > source.widthPixels || rect.y + rect.height > source.heightPixels) {
    throw new LabError("Keep the crop inside the upright original photograph.", 400, "PRODUCTION_INVALID_CROP");
  }
  const rotated = rect.rotation === 90 || rect.rotation === 270;
  const width = rotated ? rect.height : rect.width, height = rotated ? rect.width : rect.height;
  const inches = size === "8x10" ? [8, 10] : [5, 7];
  if (Math.abs((width / height) / (inches[0] / inches[1]) - 1) > 0.002 || width / inches[0] < 200 || height / inches[1] < 200) {
    throw new LabError("Match the print shape and retain at least 200 pixels per printed inch. Zoom out or choose a larger photo.", 400, "PRODUCTION_CROP_DETAIL");
  }
}

/** Write JFIF density without copying the original EXIF (which may contain GPS). */
export function productionJpegDensity(bytes: Buffer): Buffer {
  const output = Buffer.from(bytes);
  if (output[0] !== 0xff || output[1] !== 0xd8) throw new Error("Expected JPEG");
  for (let offset = 2; offset + 4 < output.length;) {
    if (output[offset] !== 0xff) break;
    const marker = output[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = output.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > output.length) break;
    if (marker === 0xe0 && length >= 16 && output.toString("ascii", offset + 4, offset + 9) === "JFIF\0") {
      output[offset + 11] = 1; output.writeUInt16BE(300, offset + 12); output.writeUInt16BE(300, offset + 14);
      return output;
    }
    offset += 2 + length;
  }
  const jfif = Buffer.from([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, 1, 44, 1, 44, 0, 0]);
  return Buffer.concat([output.subarray(0, 2), jfif, output.subarray(2)]);
}

export async function renderProductionCrop(bytes: Buffer, source: ProductionAsset, size: ProductionSize, rect: ProductionCrop): Promise<Buffer> {
  if (productionHash(bytes) !== source.sha256 || bytes.length !== source.byteSize) throw new LabError("The original file failed its integrity check.", 409, "PRODUCTION_INTEGRITY");
  validateProductionCrop(source, size, rect);
  const [width, height] = PRODUCTION_DIMENSIONS[size];
  // Materialize EXIF orientation before extracting, then explicit rotation. This
  // keeps UI/SQL coordinates independent of Sharp's deferred operation order.
  const upright = await image(bytes).autoOrient().png().toBuffer();
  const cropped = await image(upright).extract({ left: rect.x, top: rect.y, width: rect.width, height: rect.height }).png().toBuffer();
  for (const quality of [95, 90, 85, 80, 75]) {
    const result = productionJpegDensity(await image(cropped).rotate(rect.rotation).resize(width, height, { fit: "fill" })
      .flatten({ background: "white" }).withIccProfile("srgb").jpeg({ quality, chromaSubsampling: "4:4:4" }).toBuffer());
    if (result.length <= PRODUCTION_MAX_BYTES) return result;
  }
  throw new LabError("This crop exceeds the private file limit. Export a smaller JPEG original and try again.", 413, "PRODUCTION_FILE_SIZE");
}

export async function renderProductionPreview(bytes: Buffer): Promise<Buffer> {
  return image(bytes).autoOrient().resize(1400, 1400, { fit: "inside", withoutEnlargement: true }).flatten({ background: "white" })
    .withIccProfile("srgb").jpeg({ quality: 85 }).toBuffer();
}

export async function normalizeProductionCorrection(bytes: Buffer): Promise<Buffer> {
  const output = productionJpegDensity(await image(bytes).autoOrient().flatten({ background: "white" })
    .withIccProfile("srgb").jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer());
  if (output.length > PRODUCTION_MAX_BYTES) throw new LabError("Export the corrected image as a JPEG up to 4 MB.", 413, "PRODUCTION_FILE_SIZE");
  return output;
}

export async function verifyProductionFinal(bytes: Buffer, asset: ProductionAsset, size: ProductionSize) {
  if (productionHash(bytes) !== asset.sha256 || bytes.length !== asset.byteSize) throw new LabError("The reviewed production file failed its integrity check.", 409, "PRODUCTION_INTEGRITY");
  const m = await image(bytes).metadata(), [w, h] = PRODUCTION_DIMENSIONS[size];
  if (m.width !== w || m.height !== h || (m.orientation !== undefined && m.orientation !== 1)) throw new LabError("The reviewed file no longer has the required print geometry.", 409, "PRODUCTION_INTEGRITY");
  await image(bytes).stats();
}

export async function packProductionPair(bytes: Buffer, asset: ProductionAsset): Promise<Buffer> {
  await verifyProductionFinal(bytes, asset, "5x7");
  // Each cell is already the approved 1500×2100 final. No resize or crop here.
  return productionJpegDensity(await sharp({ create: { width: 3000, height: 2100, channels: 3, background: "white" } })
    .composite([{ input: bytes, left: 0, top: 0 }, { input: bytes, left: 1500, top: 0 }])
    .withIccProfile("srgb").jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer());
}

export function requireProductionReady(job: ProductionJob) {
  if (job.holds.length || !["accepted", "in_production", "ready", "completed"].includes(job.status) ||
    !job.photographerApproved || job.lines.length !== 2 || job.lines.some(l => !l.cropApproved || !l.cropAsset || !l.finalAsset || !l.finalReviewedAt ||
      (job.policy.labColourCorrection && (!l.colourAsset || !l.colourCompletedAt)))) {
    throw new LabError("Complete order approval, both crops, requested colour work, lab acceptance and final reviews before downloading paper files.", 409, "PRODUCTION_HELD");
  }
}

import { createHash } from "node:crypto";
import { r2PresignedGetUrl } from "@/lib/r2-signed-urls";

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
export const CRM_LOCATION_MAX_PHOTOS = 12;
export const CRM_LOCATION_MAX_INPUT_PHOTO_BYTES = 6 * 1024 * 1024;
export const CRM_LOCATION_MAX_INPUT_PHOTO_BASE64 = 8_400_000;
export const CRM_LOCATION_MAX_OUTPUT_PHOTO_BYTES = 1_310_720;
const CRM_LOCATION_MAX_INPUT_PIXELS = 40_000_000;

export const CRM_LOCATION_PHOTO_AUDIENCES = ["client", "staff"] as const;
export const CRM_LOCATION_PHOTO_CATEGORIES = [
  "exterior",
  "entrance",
  "parking",
  "loading",
  "room",
  "setup",
  "other",
] as const;

export type CrmLocationPhotoAudience =
  (typeof CRM_LOCATION_PHOTO_AUDIENCES)[number];
export type CrmLocationPhotoCategory =
  (typeof CRM_LOCATION_PHOTO_CATEGORIES)[number];

export type CrmLocationPhotoUploadInput = {
  filename: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  content: string;
};

export class InvalidCrmLocationPhotoError extends Error {}

function safeOutputFilename(value: string) {
  const leaf = value.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim() ?? "";
  const stem = leaf.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9 _.-]+/g, "-").trim();
  return `${(stem || "location-photo").slice(0, 245)}.jpg`;
}

export async function prepareCrmLocationPhoto(photo: CrmLocationPhotoUploadInput) {
  if (
    !photo.content ||
    photo.content.length > CRM_LOCATION_MAX_INPUT_PHOTO_BASE64 ||
    !BASE64_RE.test(photo.content)
  ) {
    throw new InvalidCrmLocationPhotoError("Choose a valid JPEG, PNG, or WebP image.");
  }

  const source = Buffer.from(photo.content, "base64");
  if (!source.length || source.length > CRM_LOCATION_MAX_INPUT_PHOTO_BYTES) {
    throw new InvalidCrmLocationPhotoError("Location photos must be 6 MB or smaller.");
  }

  try {
    // Keep the CRM module importable when Sharp's optional native runtime is
    // unavailable. Only photo uploads need to initialize the image processor.
    const { default: sharp } = await import("sharp");
    const image = sharp(source, {
      failOn: "error",
      limitInputPixels: CRM_LOCATION_MAX_INPUT_PIXELS,
    });
    const metadata = await image.metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
      throw new InvalidCrmLocationPhotoError(
        "Location photos must be JPEG, PNG, or WebP images.",
      );
    }
    if (
      metadata.width &&
      metadata.height &&
      metadata.width * metadata.height > CRM_LOCATION_MAX_INPUT_PIXELS
    ) {
      throw new InvalidCrmLocationPhotoError(
        "This location photo has too many pixels. Choose a smaller image.",
      );
    }

    // Sharp does not preserve metadata unless withMetadata() is called. The
    // output therefore has orientation applied while EXIF/GPS data is removed.
    const { data, info } = await image
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize({
        width: 2000,
        height: 2000,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 84, progressive: true, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    if (!data.length || data.length > CRM_LOCATION_MAX_OUTPUT_PHOTO_BYTES) {
      throw new InvalidCrmLocationPhotoError(
        "This photo is still too large after optimization. Choose a smaller image.",
      );
    }

    return {
      bytes: data,
      filename: safeOutputFilename(photo.filename),
      contentType: "image/jpeg" as const,
      byteSize: data.length,
      width: info.width || null,
      height: info.height || null,
      contentSha256: createHash("sha256").update(data).digest("hex"),
    };
  } catch (error) {
    if (error instanceof InvalidCrmLocationPhotoError) throw error;
    throw new InvalidCrmLocationPhotoError("This location photo could not be read.");
  }
}

export function crmLocationPhotoPublicRow(row: Record<string, unknown>) {
  const objectKey = typeof row.object_key === "string" ? row.object_key : "";
  return {
    id: String(row.id ?? ""),
    clientId: String(row.client_id ?? ""),
    locationId: String(row.location_id ?? ""),
    filename: String(row.filename ?? "location-photo.jpg"),
    audience: row.audience === "staff" ? "staff" : "client",
    category: CRM_LOCATION_PHOTO_CATEGORIES.includes(
      row.category as CrmLocationPhotoCategory,
    )
      ? (row.category as CrmLocationPhotoCategory)
      : "other",
    caption: typeof row.caption === "string" ? row.caption : null,
    altText: typeof row.alt_text === "string" ? row.alt_text : null,
    sortOrder: Number(row.sort_order ?? 0),
    contentType: "image/jpeg" as const,
    byteSize: Number(row.byte_size ?? 0),
    width: typeof row.width === "number" ? row.width : null,
    height: typeof row.height === "number" ? row.height : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
    previewUrl: objectKey ? r2PresignedGetUrl(objectKey, 15 * 60) : "",
  };
}

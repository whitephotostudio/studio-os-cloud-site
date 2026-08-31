import sharp from "sharp";

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
export const STUDIO_BOOKING_EMAIL_MAX_PHOTO_BASE64 = 1_000_000;
export const STUDIO_BOOKING_EMAIL_MAX_TOTAL_PHOTO_BASE64 = 3_200_000;
const MAX_OUTPUT_PHOTO_BYTES = 900_000;
const MAX_INPUT_PIXELS = 40_000_000;

export type StudioBookingDirectionPhotoInput = {
  filename: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  content: string;
};

export class InvalidStudioBookingDirectionPhotoError extends Error {}

export async function prepareStudioBookingDirectionPhoto(
  photo: StudioBookingDirectionPhotoInput,
  index: number,
) {
  if (!BASE64_RE.test(photo.content)) {
    throw new InvalidStudioBookingDirectionPhotoError(
      `Direction photo ${index + 1} is not a valid image.`,
    );
  }

  const source = Buffer.from(photo.content, "base64");
  if (!source.length || source.length > MAX_OUTPUT_PHOTO_BYTES * 2) {
    throw new InvalidStudioBookingDirectionPhotoError(
      `Direction photo ${index + 1} is too large.`,
    );
  }

  try {
    const image = sharp(source, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    });
    const metadata = await image.metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) {
      throw new InvalidStudioBookingDirectionPhotoError(
        `Direction photo ${index + 1} must be a JPEG, PNG, or WebP image.`,
      );
    }
    if (
      metadata.width &&
      metadata.height &&
      metadata.width * metadata.height > MAX_INPUT_PIXELS
    ) {
      throw new InvalidStudioBookingDirectionPhotoError(
        `Direction photo ${index + 1} has too many pixels. Choose a smaller image.`,
      );
    }

    const output = await image
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82, progressive: true, mozjpeg: true })
      .toBuffer();

    if (output.length > MAX_OUTPUT_PHOTO_BYTES) {
      throw new InvalidStudioBookingDirectionPhotoError(
        `Direction photo ${index + 1} is still too large after optimization.`,
      );
    }

    return {
      filename: `direction-photo-${index + 1}.jpg`,
      content: output.toString("base64"),
      contentId: `booking-direction-${index + 1}`,
    };
  } catch (error) {
    if (error instanceof InvalidStudioBookingDirectionPhotoError) throw error;
    throw new InvalidStudioBookingDirectionPhotoError(
      `Direction photo ${index + 1} could not be read.`,
    );
  }
}

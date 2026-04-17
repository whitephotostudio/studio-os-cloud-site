import { createHmac, timingSafeEqual } from "node:crypto";
import type { EventGalleryDownloadResolution } from "@/lib/event-gallery-downloads";

export type EventGalleryBatchTokenPayload = {
  v: 1;
  kind: "event-gallery-download-batch";
  projectId: string;
  viewerEmail: string;
  galleryName: string;
  archiveBaseName: string;
  resolution: EventGalleryDownloadResolution;
  applyWatermark: boolean;
  includePrintRelease: boolean;
  watermarkText: string;
  watermarkLogoUrl: string;
  studioName: string;
  studioEmail: string;
  fileName: string;
  mediaIds: string[];
  exp: number;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function resolveSigningSecret() {
  const secret =
    clean(process.env.EVENT_DOWNLOAD_TOKEN_SECRET) ||
    clean(process.env.DOWNLOAD_TOKEN_SECRET) ||
    clean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!secret) {
    throw new Error("Missing event download signing secret.");
  }

  return secret;
}

function encodePayload(payload: EventGalleryBatchTokenPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(encodedPayload: string) {
  const raw = Buffer.from(encodedPayload, "base64url").toString("utf8");
  return JSON.parse(raw) as EventGalleryBatchTokenPayload;
}

function signEncodedPayload(encodedPayload: string) {
  return createHmac("sha256", resolveSigningSecret())
    .update(encodedPayload)
    .digest("hex");
}

export function createEventGalleryBatchToken(payload: EventGalleryBatchTokenPayload) {
  const encodedPayload = encodePayload(payload);
  const signature = signEncodedPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifyEventGalleryBatchToken(token: string) {
  const [encodedPayload, signature] = clean(token).split(".");
  if (!encodedPayload || !signature) {
    throw new Error("Invalid download token.");
  }

  const expectedSignature = signEncodedPayload(encodedPayload);
  const actualBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid download token.");
  }

  const payload = decodePayload(encodedPayload);
  if (payload.v !== 1 || payload.kind !== "event-gallery-download-batch") {
    throw new Error("Unsupported download token.");
  }

  if (!Number.isFinite(payload.exp) || payload.exp <= Date.now()) {
    throw new Error("This download session has expired.");
  }

  return payload;
}

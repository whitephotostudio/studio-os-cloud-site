import { decryptCapability, encryptCapability, isEncryptedCapabilityToken, MAX_CAPABILITY_PAYLOAD_BYTES, PREVIEW_CAPABILITY_PAYLOAD_BYTES } from "@/lib/encrypted-capability";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { EventGalleryDownloadResolution } from "@/lib/event-gallery-downloads";
import { eventCollectionAccessMode, type EventDownloadCollection } from "@/lib/event-download-scope";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";

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
  // Optional in the decoded v1 shape for legacy token detection. The batch
  // route asks sessions without an album scope/grant to prepare fresh links.
  downloadLogId?: string;
  collectionId?: string | null;
  collectionIds?: string[];
  collectionGrants?: Record<string, string>;
  photographerId?: string | null;
  projectAccessGrant?: string;
  downloadPolicyGrant?: string;
  deliveryType?: "gallery" | "favorites";
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

function signEncodedPayload(encodedPayload: string) {
  return createHmac("sha256", resolveSigningSecret())
    .update(encodedPayload)
    .digest("hex");
}

// Bind the bearer grant to the album's current access configuration without
// placing its private PIN in a client-readable token. Changes revoke the grant.
export function createEventCollectionDownloadGrant(projectId: string, row: EventDownloadCollection) {
  return signEncodedPayload(JSON.stringify([
    "event-album-access", projectId, row.id, clean(row.kind).toLowerCase(),
    eventCollectionAccessMode(row.access_mode), clean(row.access_pin), clean(row.slug),
  ]));
}

export function createEventProjectDownloadGrant(row: {
  id: string; access_mode: string | null; access_pin: string | null;
}) {
  return signEncodedPayload(JSON.stringify([
    "event-project-access", row.id, eventCollectionAccessMode(row.access_mode), clean(row.access_pin),
  ]));
}

export function createEventDownloadPolicyGrant(settings: unknown) {
  return signEncodedPayload(JSON.stringify(["event-download-policy", normalizeEventGallerySettings(settings).extras]));
}

export type EventPreviewTokenPayload = {
  v: 1; kind: "event-gallery-preview"; projectId: string; viewerEmail: string;
  collectionIds: string[]; collectionGrants: Record<string, string>;
  photographerId: string | null; projectAccessGrant: string; exp: number;
};

export function createEventPreviewToken(payload: EventPreviewTokenPayload) {
  return encryptCapability(payload, { secret: resolveSigningSecret(), purpose: "event-gallery-preview", maximumPayloadBytes: PREVIEW_CAPABILITY_PAYLOAD_BYTES });
}

function verifyLegacyPayload(token: string, maximumEncodedBytes: number) {
  const [encoded, signature, extra] = clean(token).split(".");
  if (!encoded || !signature || extra !== undefined || encoded.length > maximumEncodedBytes) throw new Error("Invalid download token.");
  const expected = Buffer.from(signEncodedPayload(encoded)), actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid download token.");
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}

export function verifyEventPreviewToken(token: string): EventPreviewTokenPayload {
  const value = clean(token);
  const payload = (isEncryptedCapabilityToken(value)
    ? decryptCapability(value, { secret: resolveSigningSecret(), purpose: "event-gallery-preview", maximumPayloadBytes: PREVIEW_CAPABILITY_PAYLOAD_BYTES })
    : verifyLegacyPayload(value, 25000)) as EventPreviewTokenPayload;
  if (payload.v !== 1 || payload.kind !== "event-gallery-preview" || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) throw new Error("Expired preview token.");
  return payload;
}

export function createEventGalleryBatchToken(payload: EventGalleryBatchTokenPayload) {
  return encryptCapability(payload, { secret: resolveSigningSecret(), purpose: "event-gallery-download-batch" });
}

export function verifyEventGalleryBatchToken(token: string) {
  const value = clean(token);
  const payload = (isEncryptedCapabilityToken(value)
    ? decryptCapability(value, { secret: resolveSigningSecret(), purpose: "event-gallery-download-batch" })
    : verifyLegacyPayload(value, Math.ceil(MAX_CAPABILITY_PAYLOAD_BYTES * 4 / 3))) as EventGalleryBatchTokenPayload;
  if (payload.v !== 1 || payload.kind !== "event-gallery-download-batch") throw new Error("Unsupported download token.");
  if (!Number.isFinite(payload.exp) || payload.exp <= Date.now()) throw new Error("This download session has expired.");
  return payload;
}

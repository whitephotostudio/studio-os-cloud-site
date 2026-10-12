import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Purpose-specific keys and authenticated context keep capabilities isolated
// even when the deployment uses one signing secret for several delivery flows.
export type EncryptedCapabilityPurpose =
  | "school-gallery-preview"
  | "school-photo-download"
  | "event-gallery-preview"
  | "event-gallery-download-batch"
  | "digital-order-delivery"
  | "favorites-delivery"
  | "parent-gallery-entry";

const VERSION = "ec1";
export const MAX_CAPABILITY_PAYLOAD_BYTES = 64 * 1024;
export const PREVIEW_CAPABILITY_PAYLOAD_BYTES = 18750;
const PURPOSES = new Set<EncryptedCapabilityPurpose>([
  "school-gallery-preview", "school-photo-download", "event-gallery-preview",
  "event-gallery-download-batch", "digital-order-delivery", "favorites-delivery",
  "parent-gallery-entry",
]);
type Options = { secret: string; purpose: EncryptedCapabilityPurpose; maximumPayloadBytes?: number };

function invalid(): never { throw new Error("Invalid encrypted capability."); }
function context(options: Options) {
  const maximum = options.maximumPayloadBytes ?? MAX_CAPABILITY_PAYLOAD_BYTES;
  if (!PURPOSES.has(options.purpose) || !options.secret || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAX_CAPABILITY_PAYLOAD_BYTES) invalid();
  const aad = Buffer.from(`studio-os:encrypted-capability:${VERSION}:${options.purpose}`, "utf8");
  const key = Buffer.from(hkdfSync("sha256", options.secret, "studio-os:capability-encryption:hkdf:v1", aad, 32));
  return { maximum, aad, key };
}
function decode(value: string, maximum: number) {
  if (!value || value.length > Math.ceil(maximum * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) invalid();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length > maximum || bytes.toString("base64url") !== value) invalid();
  return bytes;
}

export function isEncryptedCapabilityToken(token: string) { return token.startsWith(`${VERSION}.`); }

export function encryptCapability(payload: object, options: Options) {
  const { maximum, aad, key } = context(options);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  if (!plaintext.length || plaintext.length > maximum) invalid();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [VERSION, nonce.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

export function decryptCapability(token: string, options: Options): unknown {
  const { maximum, aad, key } = context(options);
  if (token.length > Math.ceil(maximum * 4 / 3) + 64) invalid();
  const [version, nonceValue, ciphertextValue, tagValue, extra] = token.split(".");
  if (version !== VERSION || extra !== undefined || !nonceValue || !ciphertextValue || !tagValue) invalid();
  const nonce = decode(nonceValue, 12), ciphertext = decode(ciphertextValue, maximum), tag = decode(tagValue, 16);
  if (nonce.length !== 12 || tag.length !== 16) invalid();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    // Authentication must finish before JSON is parsed or any plaintext leaves.
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const payload: unknown = JSON.parse(plaintext.toString("utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) invalid();
    return payload;
  } catch { invalid(); }
}

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

export const MAX_UPLOADED_DELIVERY_FILES = 50;
export const MAX_UPLOADED_DELIVERY_TOKEN_BYTES = 64 * 1024;

export type UploadedDeliveryTokenPayload = {
  v: 1;
  kind: "uploaded-digital-order-delivery";
  orderId: string;
  recipientEmail: string;
  objectKeys: string[];
  exp: number;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function deliverySecret() {
  const secret =
    clean(process.env.DIGITAL_DELIVERY_TOKEN_SECRET) ||
    clean(process.env.DOWNLOAD_TOKEN_SECRET) ||
    clean(process.env.EVENT_DOWNLOAD_TOKEN_SECRET) ||
    clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!secret) throw new Error("Missing digital delivery token secret.");
  return createHash("sha256").update(secret, "utf8").digest();
}

function isSupportedPhotoKey(key: string) {
  return /\.(jpe?g|png|webp|heic|heif|tiff?|dng|cr2|cr3|nef|arw|raf|orf)$/i.test(key);
}

export function validateUploadedDeliveryKeys(
  value: unknown,
  schoolId: string,
  studentId: string,
) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_UPLOADED_DELIVERY_FILES) {
    return null;
  }

  const prefix = `photos/${clean(schoolId)}/${clean(studentId)}/`;
  if (prefix.includes("//")) return null;

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") return null;
    const key = clean(raw);
    if (
      !key.startsWith(prefix) ||
      key.length <= prefix.length ||
      key.length > 1024 ||
      key.includes("\\") ||
      key.includes("..") ||
      /[\u0000-\u001f\u007f?#]/.test(key) ||
      /^[a-z][a-z0-9+.-]*:\/\//i.test(key) ||
      !isSupportedPhotoKey(key)
    ) {
      return null;
    }
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }

  return keys.length ? keys : null;
}

export function isPaidUploadedDeliveryOrder(order: {
  status?: string | null;
  payment_status?: string | null;
  paid_at?: string | null;
  refund_status?: string | null;
  refund_amount_cents?: number | null;
}) {
  // Keep in step with hasCurrentDigitalPayment; this standalone helper is also
  // imported directly by native Node security checks without application aliases.
  const status = clean(order.status).toLowerCase(), payment = clean(order.payment_status).toLowerCase(), refund = clean(order.refund_status).toLowerCase();
  const amount = order.refund_amount_cents == null ? 0 : Number(order.refund_amount_cents);
  if (!Number.isFinite(amount) || amount !== 0 || (refund && !["none", "not_refunded", "not_requested"].includes(refund)) || ["refunded", "refund_pending", "cancelled", "canceled", "cancel_pending"].includes(status)) return false;
  if (payment) return ["paid", "succeeded", "no_payment_required"].includes(payment);
  return ["paid", "digital_paid"].includes(status) || (!!clean(order.paid_at) && ["digital_sent", "completed", "fulfilled"].includes(status));
}

export function createUploadedDeliveryToken(payload: UploadedDeliveryTokenPayload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deliverySecret(), iv);
  cipher.setAAD(Buffer.from("studio-os-uploaded-delivery-v1", "utf8"));
  const compressed = deflateRawSync(Buffer.from(JSON.stringify(payload), "utf8"));
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), encrypted.toString("base64url"), tag.toString("base64url")].join(".");
}

export function verifyUploadedDeliveryToken(token: string) {
  const [version, ivValue, encryptedValue, tagValue, extra] = clean(token).split(".");
  if (version !== "v1" || !ivValue || !encryptedValue || !tagValue || extra) {
    throw new Error("Invalid digital delivery link.");
  }

  const iv = Buffer.from(ivValue, "base64url");
  const encrypted = Buffer.from(encryptedValue, "base64url");
  const tag = Buffer.from(tagValue, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || encrypted.length > MAX_UPLOADED_DELIVERY_TOKEN_BYTES) {
    throw new Error("Invalid digital delivery link.");
  }

  let payload: UploadedDeliveryTokenPayload;
  try {
    const decipher = createDecipheriv("aes-256-gcm", deliverySecret(), iv);
    decipher.setAAD(Buffer.from("studio-os-uploaded-delivery-v1", "utf8"));
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const decoded = inflateRawSync(compressed, {
      maxOutputLength: MAX_UPLOADED_DELIVERY_TOKEN_BYTES,
    });
    payload = JSON.parse(decoded.toString("utf8")) as UploadedDeliveryTokenPayload;
  } catch {
    throw new Error("Invalid digital delivery link.");
  }

  if (
    payload.v !== 1 ||
    payload.kind !== "uploaded-digital-order-delivery" ||
    !clean(payload.orderId) ||
    !clean(payload.recipientEmail) ||
    !Array.isArray(payload.objectKeys) ||
    !Number.isFinite(payload.exp)
  ) {
    throw new Error("Unsupported digital delivery link.");
  }
  if (payload.exp <= Date.now()) {
    throw new Error("This digital delivery link has expired.");
  }
  return payload;
}

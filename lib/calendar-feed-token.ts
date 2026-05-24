import { createHmac, timingSafeEqual } from "crypto";

const TOKEN_VERSION = "v1";

function feedSecret(): string {
  const secret =
    process.env.STUDIO_CALENDAR_FEED_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  if (!secret) throw new Error("Missing calendar feed signing secret.");
  return secret;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signature(payload: string): string {
  return createHmac("sha256", feedSecret()).update(payload).digest("base64url");
}

export function createCalendarFeedToken(photographerId: string): string {
  const payload = `${TOKEN_VERSION}:${photographerId}`;
  return `${toBase64Url(payload)}.${signature(payload)}`;
}

export function verifyCalendarFeedToken(token: string | null | undefined): string | null {
  const raw = (token ?? "").trim();
  const [payloadPart, signaturePart] = raw.split(".");
  if (!payloadPart || !signaturePart) return null;

  let payload = "";
  try {
    payload = fromBase64Url(payloadPart);
  } catch {
    return null;
  }

  const expected = signature(payload);
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(signaturePart, "utf8");
  if (expectedBuffer.length !== actualBuffer.length) return null;
  if (!timingSafeEqual(expectedBuffer, actualBuffer)) return null;

  const [version, photographerId] = payload.split(":");
  if (version !== TOKEN_VERSION || !photographerId) return null;
  return photographerId;
}

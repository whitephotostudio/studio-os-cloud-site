import { createHash, createHmac, timingSafeEqual } from "node:crypto";

type CrmUnsubscribePayload = {
  v: 1;
  p: string;
  c: string;
  h: string;
  exp: number;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function secret() {
  const value = clean(process.env.CRM_UNSUBSCRIBE_SECRET);
  return value.length >= 32 ? value : null;
}

function verificationSecrets() {
  const current = secret();
  const previous = clean(process.env.CRM_UNSUBSCRIBE_PREVIOUS_SECRET);
  return [current, previous.length >= 32 ? previous : null].filter(
    (value): value is string => Boolean(value),
  );
}

function applicationOrigin() {
  const value = clean(process.env.NEXT_PUBLIC_APP_URL).replace(/\/$/, "");
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (
      process.env.NODE_ENV === "production" &&
      parsed.protocol !== "https:" &&
      !['localhost', '127.0.0.1'].includes(parsed.hostname)
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function signature(value: string, signingSecret: string) {
  return createHmac("sha256", signingSecret).update(value).digest("base64url");
}

export function crmUnsubscribeEmailHash(email: string) {
  return createHash("sha256").update(clean(email).toLowerCase()).digest("hex");
}

export function crmUnsubscribeConfigured() {
  return Boolean(secret() && applicationOrigin());
}

export function createCrmUnsubscribeUrl(input: {
  photographerId: string;
  contactId: string;
  email: string;
  now?: Date;
}) {
  const signingSecret = secret();
  const origin = applicationOrigin();
  if (!signingSecret || !origin) return null;
  const now = input.now ?? new Date();
  const payload: CrmUnsubscribePayload = {
    v: 1,
    p: input.photographerId,
    c: input.contactId,
    h: crmUnsubscribeEmailHash(input.email),
    exp: Math.floor(now.getTime() / 1000) + 730 * 24 * 60 * 60,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const token = `${encoded}.${signature(encoded, signingSecret)}`;
  const url = new URL("/api/crm/unsubscribe", origin);
  url.searchParams.set("token", token);
  return url.toString();
}

export function verifyCrmUnsubscribeToken(
  token: string,
  now = new Date(),
): CrmUnsubscribePayload | null {
  const value = clean(token);
  const signingSecrets = verificationSecrets();
  if (!signingSecrets.length || value.length < 40 || value.length > 2_000) return null;
  const [encoded, supplied, extra] = value.split(".");
  if (!encoded || !supplied || extra) return null;
  const suppliedBuffer = Buffer.from(supplied);
  const validSignature = signingSecrets.some((signingSecret) => {
    const expectedBuffer = Buffer.from(signature(encoded, signingSecret));
    return (
      expectedBuffer.length === suppliedBuffer.length &&
      timingSafeEqual(expectedBuffer, suppliedBuffer)
    );
  });
  if (!validSignature) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<CrmUnsubscribePayload>;
    if (
      payload.v !== 1 ||
      !UUID_PATTERN.test(clean(payload.p)) ||
      !UUID_PATTERN.test(clean(payload.c)) ||
      !/^[0-9a-f]{64}$/i.test(clean(payload.h)) ||
      !Number.isSafeInteger(payload.exp) ||
      Number(payload.exp) <= Math.floor(now.getTime() / 1000)
    ) {
      return null;
    }
    return payload as CrmUnsubscribePayload;
  } catch {
    return null;
  }
}

export function crmUnsubscribeEmailMatches(email: string, expectedHash: string) {
  const actual = Buffer.from(crmUnsubscribeEmailHash(email));
  const expected = Buffer.from(clean(expectedHash).toLowerCase());
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

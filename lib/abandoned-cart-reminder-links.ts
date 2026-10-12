import { createHmac, timingSafeEqual } from "node:crypto";

type ReminderLinkPayload = { v: 1; o: string; p: string; h: string; exp: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TTL_SECONDS = 90 * 24 * 60 * 60;
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";

function currentSecret() {
  const value = clean(process.env.CART_REMINDER_TOKEN_SECRET) ||
    clean(process.env.CRM_UNSUBSCRIBE_SECRET) || clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return value.length >= 32 ? value : null;
}

function secrets() {
  const previous = clean(process.env.CART_REMINDER_TOKEN_PREVIOUS_SECRET);
  return [currentSecret(), previous.length >= 32 ? previous : null].filter((value): value is string => !!value);
}

function digest(value: string, secret: string) {
  return createHmac("sha256", secret).update(`studio-os:cart-reminder:v1:${value}`).digest("base64url");
}

function recipientHash(email: string, secret: string) {
  return digest(`recipient:${clean(email).toLowerCase()}`, secret);
}

function equal(actual: string, expected: string) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cartReminderLinkEmailMatches(email: string, hash: string) {
  return secrets().some(secret => equal(recipientHash(email, secret), hash));
}

export function createAbandonedCartStopUrl(input: {
  origin?: string; orderId: string; photographerId: string; recipientEmail: string; now?: Date;
}) {
  const secret = currentSecret();
  const email = clean(input.recipientEmail).toLowerCase();
  if (!secret || !UUID.test(input.orderId) || !UUID.test(input.photographerId) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  // Client emails always use the branded production host. Local fixtures may
  // use localhost; an arbitrary request host can never capture signed tokens.
  let origin = "https://www.studiooscloud.com";
  try {
    const local = new URL(input.origin || "");
    if (process.env.NODE_ENV !== "production" &&
      ["localhost", "127.0.0.1"].includes(local.hostname) && ["http:", "https:"].includes(local.protocol)) {
      origin = local.origin;
    }
  } catch { /* production host remains canonical */ }
  const payload: ReminderLinkPayload = {
    v: 1, o: input.orderId, p: input.photographerId, h: recipientHash(email, secret),
    exp: Math.floor((input.now ?? new Date()).getTime() / 1000) + TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const url = new URL("/api/portal/orders/stop-reminders", origin);
  url.searchParams.set("token", `${encoded}.${digest(`token:${encoded}`, secret)}`);
  return url.toString();
}

export function verifyAbandonedCartStopToken(token: string, now = new Date()): ReminderLinkPayload | null {
  if (token.length < 40 || token.length > 1500) return null;
  const parts = token.split(".");
  const [encoded, signature] = parts;
  if (parts.length !== 2 || !encoded || !signature || !/^[\w-]+$/.test(encoded) ||
    !secrets().some(secret => equal(digest(`token:${encoded}`, secret), signature))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (payload.v !== 1 || !UUID.test(clean(payload.o)) || !UUID.test(clean(payload.p)) ||
      !/^[\w-]{43}$/.test(clean(payload.h)) || !Number.isSafeInteger(payload.exp) ||
      payload.exp <= Math.floor(now.getTime() / 1000)) return null;
    return payload;
  } catch { return null; }
}

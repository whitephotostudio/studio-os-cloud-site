import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Redis } from "@upstash/redis";
import { getClientIp } from "@/lib/rate-limit";

export type PortalPinScope = { kind: "school" | "event"; galleryId: string; pin: string; email: string };
const COOKIE = "studio_os_parent_pin_budget";
const TTL_SECONDS = 6 * 60 * 60;
const MAX_GRANTS = 16;
export const PORTAL_PIN_RESERVATION_HEADER = "x-studio-pin-reservation";
const RESERVATION_SECONDS = 120;
const issuedReservations = new WeakMap<Request, string>();
type Reservation = { v: number; n: string; i: string; s: string; m: string; p: string; e: number; a: number; b: number };
type Denied = { status: number; retryAfter: number; message: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Grant = { hash: string; exp: number };
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";

function secret() {
  return process.env.EVENT_DOWNLOAD_TOKEN_SECRET || process.env.DOWNLOAD_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}
function signature(value: string) {
  return createHmac("sha256", secret()).update(`parent-pin-budget-v1:${value}`).digest("hex");
}
function reservationSignature(value: string) {
  return createHmac("sha256", secret()).update(`parent-pin-reservation-v1:${value}`).digest("hex");
}
function ipHash(request: Request) {
  return reservationSignature(`ip:${getClientIp(request)}`);
}

// Both windows and their refundable request identity change in one Redis
// transaction. A denied request never partially consumes only one window.
const reserveScript = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
if math.floor(now / 60000) ~= tonumber(ARGV[2]) or math.floor(now / 900000) ~= tonumber(ARGV[3]) then
  return {2, now}
end
local short = tonumber(redis.call('GET', KEYS[1]) or '0')
local long = tonumber(redis.call('GET', KEYS[2]) or '0')
if not short or not long or short < 0 or long < 0 or short % 1 ~= 0 or long % 1 ~= 0 then return {-1, now} end
local retry = 0
if short >= 10 then retry = (tonumber(ARGV[2]) + 1) * 60000 - now end
if long >= 60 then retry = math.max(retry, (tonumber(ARGV[3]) + 1) * 900000 - now) end
if retry > 0 then return {0, retry} end
if redis.call('EXISTS', KEYS[3]) ~= 0 then return {-1, now} end
redis.call('INCR', KEYS[1])
redis.call('PEXPIREAT', KEYS[1], (tonumber(ARGV[2]) + 1) * 60000)
redis.call('INCR', KEYS[2])
redis.call('PEXPIREAT', KEYS[2], (tonumber(ARGV[3]) + 1) * 900000)
redis.call('SET', KEYS[3], ARGV[1], 'PX', 121000)
return {1, now}
`;
const refundScript = `
if redis.call('GET', KEYS[3]) ~= ARGV[1] then return 0 end
local short = tonumber(redis.call('GET', KEYS[1]) or '0')
local long = tonumber(redis.call('GET', KEYS[2]) or '0')
if not short or not long or short < 0 or long < 0 or short % 1 ~= 0 or long % 1 ~= 0 then return -1 end
redis.call('DEL', KEYS[3])
if short > 0 then redis.call('DECR', KEYS[1]) end
if long > 0 then redis.call('DECR', KEYS[2]) end
return 1
`;

function redisClient() {
  const env = (value: string | undefined) => (value || "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
  const url = env(process.env.UPSTASH_REDIS_REST_URL), token = env(process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!url || !token) return null;
  return new Redis({ url, token, signal: () => AbortSignal.timeout(2500), retry: { retries: 0 } });
}
function reservationKeys(claim: Reservation) {
  // The Redis hash tag keeps all three keys in the same cluster slot.
  const prefix = `rl:pin-auth-reservation:v1:{${claim.i}}`;
  return [`${prefix}:short:${claim.a}`, `${prefix}:long:${claim.b}`, `${prefix}:request:${claim.n}`];
}
const unavailable = (): Denied => ({ status: 503, retryAfter: 3,
  message: "Gallery access is temporarily unavailable. Please try again shortly." });

/** Only the proxy-minted value, never a caller-supplied request header. */
export function portalPinReservationHeader(request: Request) {
  return issuedReservations.get(request) || null;
}

/** Call only after all these exact credentials passed the real validator. */
export async function refundPortalPinAttempt(request: Request, validated: PortalPinScope | PortalPinScope[]) {
  if (!secret()) return false;
  const raw = issuedReservations.get(request) || request.headers.get(PORTAL_PIN_RESERVATION_HEADER) || "";
  if (!raw || raw.length > 8192) return false;
  const [encoded, mac, extra] = raw.split(".");
  if (!encoded || !mac || extra) return false;
  const expected = Buffer.from(reservationSignature(encoded)), actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
  try {
    const claim: Reservation = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const scopes = Array.isArray(validated) ? validated : [validated];
    if (scopes.some(scope => !validScope(scope))) return false;
    const hashes = scopeSetHash(scopes);
    if (claim.v !== 1 || !/^[a-f0-9]{32}$/.test(claim.n) || claim.i !== ipHash(request) ||
        claim.m !== request.method || claim.p !== new URL(request.url).pathname ||
        !Number.isSafeInteger(claim.e) || claim.e <= Date.now() || claim.e > Date.now() + RESERVATION_SECONDS * 1000 + 5000 ||
        !Number.isSafeInteger(claim.a) || !Number.isSafeInteger(claim.b) ||
        claim.a !== Math.floor((claim.e - RESERVATION_SECONDS * 1000) / 60000) ||
        claim.b !== Math.floor((claim.e - RESERVATION_SECONDS * 1000) / 900000) ||
        claim.s !== hashes) return false;
    const redis = redisClient();
    if (!redis) return false;
    return await redis.eval(refundScript, reservationKeys(claim), [reservationSignature(raw)]) === 1;
  } catch { return false; }
}
function scopeHash(scope: PortalPinScope) {
  return signature(JSON.stringify([scope.kind, scope.galleryId.toLowerCase(), scope.pin, scope.email.toLowerCase()]));
}
function scopeSetHash(scopes: PortalPinScope[]) {
  return reservationSignature(`scopes:${JSON.stringify([...new Set(scopes.map(scopeHash))].sort())}`);
}
function validScope(scope: PortalPinScope) {
  return UUID.test(scope.galleryId) && scope.pin.length > 0 && scope.pin.length <= 64 &&
    scope.email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(scope.email);
}
function grants(request: Request): Grant[] {
  if (!secret()) return [];
  const cookie = (request.headers.get("cookie") || "").split(";").map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`));
  if (!cookie) return [];
  const raw = cookie.slice(COOKIE.length + 1);
  if (raw.length > 8192) return [];
  const [encoded, mac, extra] = raw.split(".");
  if (!encoded || !mac || extra) return [];
  const expected = Buffer.from(signature(encoded)), actual = Buffer.from(mac);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return [];
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (payload.v !== 1 || !Array.isArray(payload.grants) || payload.grants.length > MAX_GRANTS) return [];
    return payload.grants.filter((grant: Grant) => typeof grant?.hash === "string" && /^[a-f0-9]{64}$/.test(grant.hash) &&
      Number.isFinite(grant.exp) && grant.exp > Date.now());
  } catch { return []; }
}

// Called only after successful PIN validation. This cookie grants a larger
// attempt budget for the exact credentials, never gallery or download access.
// Every route must continue its current database authorization checks.
export async function grantPortalPinBudget<T extends { headers: Headers }>(response: T, request: Request, scope: PortalPinScope): Promise<T> {
  if (!secret() || !validScope(scope)) return response;
  await refundPortalPinAttempt(request, scope);
  const hash = scopeHash(scope);
  const next = [...grants(request).filter(grant => grant.hash !== hash), { hash, exp: Date.now() + TTL_SECONDS * 1000 }].slice(-MAX_GRANTS);
  const encoded = Buffer.from(JSON.stringify({ v: 1, grants: next })).toString("base64url");
  const secure = process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:";
  response.headers.append("Set-Cookie", `${COOKIE}=${encoded}.${signature(encoded)}; Path=/api/portal; Max-Age=${TTL_SECONDS}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`);
  return response;
}

function scopesFromBody(body: Record<string, unknown>): PortalPinScope[] {
  const pin = clean(body.pin);
  if (!pin) return [];
  const email = clean(body.email).toLowerCase(), scopes: PortalPinScope[] = [];
  // Include every supplied gallery alias: extra fields cannot redirect the
  // budget proof away from the credentials the destination route validates.
  for (const field of ["schoolId", "projectId", "eventId"] as const) {
    const galleryId = clean(body[field]);
    if (galleryId) scopes.push({ kind: field === "schoolId" ? "school" : "event", galleryId, pin, email });
  }
  return scopes.length ? scopes : [{ kind: "event", galleryId: "", pin, email }];
}

export async function portalPinAttemptLimit(request: Request): Promise<Denied | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/portal/")) return null;
  let body: Record<string, unknown>;
  if (request.method === "GET") {
    // Routes use searchParams.get (first value). Refuse ambiguous duplicates
    // before any PIN validation, including proof-covered requests.
    if (["pin", "email", "schoolId", "projectId", "eventId"].some(field => url.searchParams.getAll(field).length > 1)) {
      return { status: 400, retryAfter: 1, message: "Invalid gallery access request." };
    }
    body = Object.fromEntries(url.searchParams);
  }
  else if (request.method === "POST") {
    try { body = await request.clone().json(); }
    catch { return null; } // Route validation rejects malformed JSON; no PIN is checked.
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  } else return null;
  const nested = Array.isArray(body.groups)
    ? body.groups.flatMap(group => group && typeof group === "object" ? scopesFromBody(group) : [])
    : [];
  // Unknown extra fields must not suppress the route's top-level credentials.
  const scopes = [...scopesFromBody(body), ...nested];
  if (!scopes.length) return null;
  const known = new Set(grants(request).map(grant => grant.hash));
  if (secret() && scopes.every(scope => validScope(scope) && known.has(scopeHash(scope)))) return null;
  if (!secret() || scopes.length > 96) return unavailable();
  if (issuedReservations.has(request)) return null;
  // No process-local production fallback: all first validations reserve the
  // same shared budget, regardless of which credential route is used.
  try {
    const redis = redisClient();
    if (!redis) return unavailable();
    let now = Date.now();
    for (let attempt = 0; attempt < 2; attempt++) {
      const claim: Reservation = { v: 1, n: randomBytes(16).toString("hex"), i: ipHash(request),
        s: scopeSetHash(scopes), m: request.method, p: url.pathname,
        e: now + RESERVATION_SECONDS * 1000, a: Math.floor(now / 60000), b: Math.floor(now / 900000) };
      const encoded = Buffer.from(JSON.stringify(claim)).toString("base64url");
      const raw = `${encoded}.${reservationSignature(encoded)}`;
      const result = await redis.eval<(string | number)[], number[]>(reserveScript, reservationKeys(claim), [reservationSignature(raw), claim.a, claim.b]);
      if (!Array.isArray(result) || result.length !== 2 || !result.every(Number.isSafeInteger)) return unavailable();
      if (result[0] === 2 && Math.abs(result[1] - Date.now()) <= 5000) { now = result[1]; continue; }
      if (result[0] === 1 && Math.abs(result[1] - Date.now()) <= 5000 && Math.floor(result[1] / 60000) === claim.a && Math.floor(result[1] / 900000) === claim.b) {
        issuedReservations.set(request, raw); return null;
      }
      if (result[0] === 0 && result[1] > 0) return { status: 429, retryAfter: Math.max(1, Math.ceil(result[1] / 1000)),
        message: "Too many PIN attempts. Please wait before trying again." };
      return unavailable();
    }
  } catch { /* A network/script failure must never permit a PIN guess. */ }
  return unavailable();
}

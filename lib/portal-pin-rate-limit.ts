import { createHmac, timingSafeEqual } from "node:crypto";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

export type PortalPinScope = { kind: "school" | "event"; galleryId: string; pin: string; email: string };
const COOKIE = "studio_os_parent_pin_budget";
const TTL_SECONDS = 6 * 60 * 60;
const MAX_GRANTS = 16;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Grant = { hash: string; exp: number };
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";

function secret() {
  return process.env.EVENT_DOWNLOAD_TOKEN_SECRET || process.env.DOWNLOAD_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}
function signature(value: string) {
  return createHmac("sha256", secret()).update(`parent-pin-budget-v1:${value}`).digest("hex");
}
function scopeHash(scope: PortalPinScope) {
  return signature(JSON.stringify([scope.kind, scope.galleryId.toLowerCase(), scope.pin, scope.email.toLowerCase()]));
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
export function grantPortalPinBudget<T extends { headers: Headers }>(response: T, request: Request, scope: PortalPinScope): T {
  if (!secret() || !validScope(scope)) return response;
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

export async function portalPinAttemptLimit(request: Request) {
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

  // Shared across all PIN-checking routes so switching from login to context,
  // favorites, order history, yearbook, or download cannot reset the budget.
  const ip = getClientIp(request);
  const results = await Promise.all([
    rateLimit(ip, { namespace: "pin-auth-shared-short", limit: 10, windowSeconds: 60, failClosed: true }),
    rateLimit(ip, { namespace: "pin-auth-shared-long", limit: 60, windowSeconds: 15 * 60, failClosed: true }),
  ]);
  const denied = results.find(result => !result.allowed);
  if (!denied) return null;
  return { status: denied.unavailable ? 503 : 429, retryAfter: Math.max(1, Math.ceil((denied.resetAt - Date.now()) / 1000)),
    message: denied.unavailable ? "Gallery access is temporarily unavailable. Please try again shortly." : "Too many PIN attempts. Please wait before trying again." };
}

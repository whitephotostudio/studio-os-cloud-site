import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { grantPortalPinBudget, portalPinAttemptLimit, refundPortalPinAttempt, PORTAL_PIN_RESERVATION_HEADER } from "@/lib/portal-pin-rate-limit";
import { normalizeParentGalleryCredentials, validateParentGalleryCredentials, type ParentGalleryCredentials } from "@/lib/parent-gallery-session-access";

export const PARENT_GALLERY_SESSION_TTL_SECONDS = 24 * 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const selectorFields = ["laneId", "parentLaneId", "kind", "mode", "galleryId", "schoolId", "projectId", "eventId", "pin", "email"];

export class ParentGallerySessionError extends Error {
  constructor(public status: number, public code: "invalid_request" | "unauthorized" | "forbidden" | "unavailable" | "capacity", message: string, public retryAfter?: number) {
    super(message);
    this.name = "ParentGallerySessionError";
  }
}
const invalid = () => new ParentGallerySessionError(400, "invalid_request", "Invalid gallery access request.");
const unauthorized = () => new ParentGallerySessionError(401, "unauthorized", "Please reopen your gallery using your QR code or PIN.");
const unavailable = () => new ParentGallerySessionError(503, "unavailable", "Gallery access is temporarily unavailable. Please try again shortly.");

export type ParentGallerySessionPublicGrant = {
  ok: true; laneId: string; kind: "school" | "event"; galleryId: string;
  viewerEmail: string; photographerId: string; expiresAt: string; galleryUrl: string;
};
export type ParentGallerySessionScope = {
  laneId: string; kind: "school" | "event"; galleryId: string; photographerId: string;
  pin: string; email: string; expiresAt: string;
};

function secureRequest(request: Request) {
  return process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:";
}
function cookieName(request: Request) {
  return secureRequest(request) ? "__Host-studio_os_parent_session" : "studio_os_parent_session_dev";
}
function cookieToken(request: Request) {
  const name = cookieName(request);
  const matches = (request.headers.get("cookie") || "").split(";").map(value => value.trim())
    .filter(value => value.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(name.length + 1);
  if (!TOKEN.test(token) || Buffer.from(token, "base64url").length !== 32 || Buffer.from(token, "base64url").toString("base64url") !== token) return null;
  return token;
}

/** A binding value for server-side return records; this does not authenticate a request. */
export function parentSessionCookieBinding(request: Request) {
  const token = cookieToken(request);
  return token ? hash(token) : null;
}

/** A shared API budget key for a registered lane; never gallery authorization. */
export async function parentSessionRateBudgetKey(request: Request): Promise<string | null> {
  const binding = parentSessionCookieBinding(request);
  if (!binding) return null;
  try {
    const url = new URL(request.url);
    if (!["gallery-context", "event-gallery-context", "event-favorites", "school-favorites", "school-downloads",
      "event-downloads", "event-download-ready", "yearbook", "orders/create", "orders/create-combined",
      "orders/history", "orders/dismiss"].some(route => url.pathname === `/api/portal/${route}`) &&
        !["/api/stripe/checkout", "/api/stripe/checkout/confirm"].includes(url.pathname)) return null;
    const query = url.searchParams;
    if (query.getAll("parentLaneId").length > 1) return null;
    let laneId: unknown = query.get("parentLaneId");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
      const reader = request.clone().body?.getReader();
      if (!reader) return null;
      const chunks: Uint8Array[] = [];
      let size = 0, expired = false;
      const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => {}); }, 1500);
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 32768) { void reader.cancel().catch(() => {}); return null; }
          chunks.push(part.value);
        }
      } finally { clearTimeout(timer); reader.releaseLock(); }
      if (expired) return null;
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!body || typeof body !== "object" || Array.isArray(body)) return null;
      if (body.groups !== undefined && (!Array.isArray(body.groups) || body.groups.length < 1 || body.groups.length > 32)) return null;
      const bodyLane = body.parentLaneId ?? body.groups?.[0]?.parentLaneId;
      if (laneId && bodyLane && laneId !== bodyLane) return null;
      laneId ||= bodyLane;
    }
    if (typeof laneId !== "string" || !UUID.test(laneId)) return null;
    const { data, error } = await createDashboardServiceClient().from("parent_gallery_sessions")
      .select("id,expires_at,revoked_at").eq("id", laneId.toLowerCase())
      .eq("token_hash", binding).is("revoked_at", null).maybeSingle();
    if (error || !data || data.id !== laneId.toLowerCase() || data.revoked_at !== null || !checkExpiry(data.expires_at)) return null;
    return `parent-session:${hash(JSON.stringify([binding, data.id]))}`;
  } catch { return null; }
}

/** New cookie-authenticated mutations are browser-only and require this origin. */
export function assertParentSessionRequestOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return;
  const origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
  if ((origin && origin !== new URL(request.url).origin) || (site && site !== "same-origin") || (!origin && site !== "same-origin")) {
    throw new ParentGallerySessionError(403, "forbidden", "Please open this gallery from the Studio OS website.");
  }
}

/** Call on each parsed route body/group before injecting private credentials. */
export function assertParentSessionScope(request: Request, scope: Pick<ParentGallerySessionScope, "laneId" | "kind" | "galleryId">, suppliedFields: Record<string, unknown> = {}) {
  const query = new URL(request.url).searchParams;
  if (selectorFields.some(field => query.getAll(field).length > 1)) throw invalid();
  const sources = [Object.fromEntries(query), suppliedFields];
  for (const fields of sources) {
    if (Object.hasOwn(fields, "pin") || Object.hasOwn(fields, "email")) throw invalid();
    for (const key of ["laneId", "parentLaneId"]) {
      if (Object.hasOwn(fields, key) && clean(fields[key]).toLowerCase() !== scope.laneId.toLowerCase()) throw invalid();
    }
    if (Object.hasOwn(fields, "kind") && fields.kind !== scope.kind) throw invalid();
    if (Object.hasOwn(fields, "mode") && fields.mode !== scope.kind) throw invalid();
    for (const key of ["galleryId", "schoolId", "projectId", "eventId"]) {
      if (!Object.hasOwn(fields, key)) continue;
      if ((key === "schoolId" && scope.kind !== "school") || ((key === "projectId" || key === "eventId") && scope.kind !== "event") ||
        clean(fields[key]).toLowerCase() !== scope.galleryId.toLowerCase()) throw invalid();
    }
  }
}

function checkExpiry(value: unknown) {
  const expiry = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(expiry) && expiry > Date.now() && expiry <= Date.now() + (PARENT_GALLERY_SESSION_TTL_SECONDS + 300) * 1000;
}

export async function bootstrapParentGallerySession(request: Request, input: ParentGalleryCredentials,
  options: { expectedPhotographerId?: string } = {}) {
  assertParentSessionRequestOrigin(request);
  const credentials = normalizeParentGalleryCredentials(input);
  if (!credentials) throw invalid();
  if (options.expectedPhotographerId !== undefined && !UUID.test(options.expectedPhotographerId)) throw invalid();
  if (selectorFields.some(field => new URL(request.url).searchParams.has(field))) throw invalid();
  // The public bootstrap uses galleryId; translate only in local memory so the
  // existing shared counter recognizes the exact scope and old proof cookie.
  const budgetHeaders = new Headers(request.headers);
  budgetHeaders.delete(PORTAL_PIN_RESERVATION_HEADER);
  // Also used by legacy checkout: this local canonical request always reaches
  // the one portal counter, without issuing another HTTP request.
  const budgetRequest = new Request(new URL("/api/portal/session", request.url), { method: "POST", headers: budgetHeaders,
    body: JSON.stringify({ [credentials.kind === "school" ? "schoolId" : "projectId"]: credentials.galleryId,
      pin: credentials.pin, email: credentials.email }) });
  const denied = await portalPinAttemptLimit(budgetRequest);
  if (denied) throw new ParentGallerySessionError(denied.status, denied.status === 503 ? "unavailable" : "forbidden", denied.message, denied.retryAfter);
  try {
    const access = await validateParentGalleryCredentials(credentials);
    if (!access.ok) throw new ParentGallerySessionError(access.status, "forbidden", access.message);
    if (options.expectedPhotographerId !== undefined && access.photographerId !== options.expectedPhotographerId.toLowerCase()) {
      throw new ParentGallerySessionError(403, "forbidden", "Gallery access has changed. Please reopen your gallery.");
    }
    // Validation already succeeded. A later session-store failure must not
    // consume another parent's WiFi PIN budget.
    await refundPortalPinAttempt(budgetRequest, credentials);
    const service = createDashboardServiceClient();
    let token = cookieToken(request);
    if (token) {
      const { data, error } = await service.from("parent_gallery_sessions").select("id")
        .eq("token_hash", hash(token)).is("revoked_at", null).limit(1).maybeSingle();
      if (error) throw unavailable();
      if (!data) token = null;
    }
    token ||= randomBytes(32).toString("base64url");
    const { data, error } = await service.rpc("register_parent_gallery_session", {
      p_token_hash: hash(token), p_scope_hash: hash(JSON.stringify([credentials.kind, credentials.galleryId, access.photographerId, credentials.pin, credentials.email])),
      p_kind: credentials.kind, p_gallery_id: credentials.galleryId, p_photographer_id: access.photographerId,
      p_pin: credentials.pin, p_email: credentials.email,
    });
    if (error) {
      if (error.code === "P0001" && error.message === "PARENT_SESSION_CAPACITY") {
        throw new ParentGallerySessionError(409, "capacity", "This browser has reached its gallery limit. Please keep your saved carts and use another browser for this gallery.");
      }
      throw unavailable();
    }
    if (!data || typeof data !== "object" || Array.isArray(data) || !UUID.test(clean(data.laneId)) ||
      data.kind !== credentials.kind || data.galleryId !== credentials.galleryId || data.photographerId !== access.photographerId ||
      data.viewerEmail !== credentials.email || !checkExpiry(data.expiresAt)) throw unavailable();
    const grant: ParentGallerySessionPublicGrant = { ok: true, laneId: data.laneId, kind: credentials.kind,
      galleryId: credentials.galleryId, photographerId: access.photographerId, viewerEmail: credentials.email,
      expiresAt: data.expiresAt, galleryUrl: `/parents/view/${data.laneId}` };
    const cookie = `${cookieName(request)}=${token}; Path=/; Max-Age=${PARENT_GALLERY_SESSION_TTL_SECONDS}; HttpOnly; SameSite=Lax${secureRequest(request) ? "; Secure" : ""}`;
    return { grant, async applyCookie<T extends { headers: Headers }>(response: T): Promise<T> {
      response.headers.append("Set-Cookie", cookie);
      return grantPortalPinBudget(response, request, { kind: credentials.kind, galleryId: credentials.galleryId, pin: credentials.pin, email: credentials.email });
    } };
  } catch (error) {
    if (error instanceof ParentGallerySessionError) throw error;
    throw unavailable();
  }
}

export async function resolveParentGallerySession(request: Request, laneId: string): Promise<ParentGallerySessionScope> {
  assertParentSessionRequestOrigin(request);
  if (!UUID.test(laneId)) throw invalid();
  const binding = parentSessionCookieBinding(request);
  if (!binding) throw unauthorized();
  try {
    const service = createDashboardServiceClient();
    const { data, error } = await service.from("parent_gallery_sessions")
      .select("id,gallery_kind,gallery_id,photographer_id,pin,viewer_email,expires_at,revoked_at")
      .eq("id", laneId.toLowerCase()).eq("token_hash", binding).is("revoked_at", null).maybeSingle();
    if (error) throw unavailable();
    if (!data || data.id !== laneId.toLowerCase() || data.revoked_at !== null || !checkExpiry(data.expires_at)) throw unauthorized();
    const credentials = normalizeParentGalleryCredentials({ kind: data.gallery_kind, galleryId: data.gallery_id, pin: data.pin, email: data.viewer_email });
    if (!credentials || !UUID.test(clean(data.photographer_id))) throw unauthorized();
    const scope: ParentGallerySessionScope = { ...credentials, laneId: data.id,
      photographerId: data.photographer_id, expiresAt: data.expires_at };
    assertParentSessionScope(request, scope);
    const access = await validateParentGalleryCredentials(credentials);
    if (!access.ok) throw new ParentGallerySessionError(access.status, "forbidden", access.message);
    if (access.photographerId !== scope.photographerId) {
      throw new ParentGallerySessionError(403, "forbidden", "Gallery access has changed. Please reopen your gallery.");
    }
    return scope;
  } catch (error) {
    if (error instanceof ParentGallerySessionError) throw error;
    throw unavailable();
  }
}

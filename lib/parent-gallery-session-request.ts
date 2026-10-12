import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import {
  assertParentSessionScope,
  resolveParentGallerySession,
  ParentGallerySessionError,
  parentSessionCookieBinding,
} from "@/lib/parent-gallery-session";
import { recordParentOrderSessionAccess } from "@/lib/parent-checkout-return";

type Scope = Awaited<ReturnType<typeof resolveParentGallerySession>>;
const resolvedRequests = new WeakMap<Request, Scope[]>();
export function getParentGalleryRequestScope(request: Request): Scope | null {
  return resolvedRequests.get(request)?.[0] ?? null;
}
/** Only a fully resolved private request can separate a family's action budget. */
export function parentGalleryRateKey(request: Request): string | null {
  const scope = getParentGalleryRequestScope(request);
  const binding = scope ? parentSessionCookieBinding(request) : null;
  return scope && binding ? `parent:${createHash("sha256").update(JSON.stringify(["parent-action-budget", binding, scope.laneId])).digest("hex")}` : null;
}

function injectScope(value: Record<string, unknown>, scope: Scope) {
  const next: Record<string, unknown> = { ...value, pin: scope.pin, email: scope.email };
  delete next.parentLaneId;
  if (scope.kind === "school") { next.schoolId = scope.galleryId; delete next.projectId; delete next.eventId; }
  else { next.projectId = scope.galleryId; delete next.schoolId; if ("eventId" in value) next.eventId = scope.galleryId; }
  return next;
}

function cleanResponseUrl(value: string, scopes: Scope[]) {
  if (!value.startsWith("/") || value.startsWith("//")) return value;
  try {
    const url = new URL(value, "https://parent-session.invalid");
    for (const scope of scopes) {
      if (url.pathname === `/parents/${encodeURIComponent(scope.pin)}` &&
          (url.searchParams.get("school") || url.searchParams.get("project")) === scope.galleryId &&
          (url.searchParams.get("email") || "").toLowerCase() === scope.email.toLowerCase()) {
        url.pathname = `/parents/view/${scope.laneId}`;
        for (const key of ["mode", "school", "project", "pin", "email"]) url.searchParams.delete(key);
        return `${url.pathname}${url.search}`;
      }
      if (url.pathname.startsWith("/api/portal/") && url.searchParams.get("pin") === scope.pin &&
          (url.searchParams.get("email") || "").toLowerCase() === scope.email.toLowerCase() &&
          ["schoolId", "projectId", "eventId"].some(key => url.searchParams.get(key) === scope.galleryId)) {
        url.searchParams.delete("pin"); url.searchParams.delete("email");
        url.searchParams.set("parentLaneId", scope.laneId);
        return `${url.pathname}${url.search}`;
      }
    }
  } catch { /* An unrelated label or value is not a URL. */ }
  return value;
}

function safePayload(value: unknown, scopes: Scope[]): unknown {
  if (typeof value === "string") return cleanResponseUrl(value, scopes);
  if (Array.isArray(value)) return value.map(item => safePayload(item, scopes));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "pin" && key !== "access_pin")
    .map(([key, item]) => [key, safePayload(item, scopes)]));
  return value;
}

/** Adapt only a new session request; every original route still authorizes it. */
export async function runParentGallerySessionRoute(request: NextRequest,
  handler: (request: NextRequest) => Promise<Response>): Promise<Response> {
  try {
    const scopes: Scope[] = [];
    const url = new URL(request.url);
    const headers = new Headers(request.headers);
    headers.delete("x-studio-parent-session"); headers.delete("content-length");
    let body: Record<string, unknown> | undefined;
    if (request.method === "GET" || request.method === "HEAD") {
      const fields = Object.fromEntries(url.searchParams);
      const scope = await resolveParentGallerySession(request, String(fields.parentLaneId || ""));
      assertParentSessionScope(request, scope, fields);
      scopes.push(scope);
      const next = injectScope(fields, scope);
      url.search = new URLSearchParams(Object.entries(next).map(([key, value]) => [key, String(value)])).toString();
    } else {
      const parsed = await request.clone().json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid session body.");
      body = parsed;
      if (Array.isArray(body?.groups) && ["pin", "email", "parentLaneId", "laneId", "kind", "mode", "galleryId", "schoolId", "projectId", "eventId"]
        .some(key => Object.hasOwn(parsed, key))) {
        return NextResponse.json({ ok: false, message: "Invalid combined gallery access request." }, { status: 400 });
      }
      if (body?.parentLaneId) {
        const scope = await resolveParentGallerySession(request, String(body.parentLaneId));
        assertParentSessionScope(request, scope, body);
        scopes.push(scope); body = injectScope(body, scope);
      }
      if (Array.isArray(body?.groups)) {
        if (!body.groups.length || body.groups.length > 32) throw new Error("Invalid gallery groups.");
        const groups = await Promise.all(body.groups.map(async (group) => {
          if (!group || typeof group !== "object" || Array.isArray(group)) throw new Error("Invalid gallery group.");
          const scope = await resolveParentGallerySession(request, String(group.parentLaneId || ""));
          assertParentSessionScope(request, scope, group);
          return { scope, value: injectScope(group, scope) };
        }));
        scopes.push(...groups.map(group => group.scope));
        body.groups = groups.map(group => group.value);
      }
      if (!scopes.length || new Set(scopes.map(scope => scope.photographerId)).size !== 1) {
        return NextResponse.json({ ok: false, message: "Reopen the galleries in this basket before continuing. Your basket was kept." }, { status: 403 });
      }
      url.searchParams.delete("parentLaneId"); url.searchParams.delete("laneId");
    }
    const adapted = new NextRequest(url, { method: request.method, headers, signal: request.signal,
      ...(body ? { body: JSON.stringify(body) } : {}) });
    resolvedRequests.set(adapted, scopes);
    const response = await handler(adapted);
    if (!/application\/json/i.test(response.headers.get("content-type") || "")) return response;
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-length"); responseHeaders.set("Cache-Control", "private, no-store");
    responseHeaders.set("Referrer-Policy", "no-referrer");
    const payload = await response.json();
    if (response.ok && ["/api/portal/orders/create", "/api/portal/orders/create-combined"].includes(new URL(request.url).pathname)) {
      await recordParentOrderSessionAccess(request, scopes, payload);
    }
    return NextResponse.json(safePayload(payload, scopes), { status: response.status, headers: responseHeaders });
  } catch (error) {
    const status = error instanceof ParentGallerySessionError ? error.status : 503;
    return NextResponse.json({ ok: false, message: "Please reopen your gallery to continue. Your basket was kept." },
      { status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  }
}

// Opaque lane IDs identify browser-owned galleries; they are never access tokens.
// The server also requires the HttpOnly cookie and current gallery authorization.
export type ParentSessionAccess = {
  laneId: string;
  kind: "school" | "event";
  galleryId: string;
  viewerEmail: string;
  photographerId?: string;
  shareUrl?: string;
  checkoutReturnId?: string;
  checkoutSessionId?: string;
  checkoutStatus?: "success" | "cancel";
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_PIN = /^session:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function parentLaneFromPin(pin: unknown): string | null {
  return typeof pin === "string" ? SESSION_PIN.exec(pin)?.[1].toLowerCase() ?? null : null;
}

export function parentSessionPin(laneId: string) {
  if (!UUID.test(laneId)) throw new Error("Invalid gallery session.");
  return `session:${laneId.toLowerCase()}`;
}

export function parentSessionGalleryPath(laneId: string) {
  if (!UUID.test(laneId)) throw new Error("Invalid gallery session.");
  return `/parents/view/${laneId.toLowerCase()}`;
}

export async function beginParentGallerySession(input: {
  kind: "school" | "event"; galleryId: string; pin: string; email: string;
}): Promise<ParentSessionAccess & { galleryUrl: string; expiresAt: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch("/api/portal/session", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input), signal: controller.signal,
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok || value.ok === false || !UUID.test(value.laneId || "") ||
        value.kind !== input.kind || value.galleryId?.toLowerCase() !== input.galleryId.toLowerCase() ||
        value.galleryUrl !== parentSessionGalleryPath(value.laneId)) {
      throw new Error(value.message || "Could not open the private gallery. Please try again.");
    }
    if (typeof window !== "undefined") {
      // Entry forms also reach this helper, so migrate choices before the
      // clean gallery URL replaces any legacy client entry point.
      try { migrateParentChoiceStorage({ ...input, laneId: value.laneId }, window.localStorage); } catch {}
      try {
        const staleContexts = Array.from({ length: window.sessionStorage.length }, (_, index) =>
          window.sessionStorage.key(index)).filter((key): key is string => !!key?.startsWith("gallery_ctx:"));
        for (const key of staleContexts) window.sessionStorage.removeItem(key);
      } catch {}
    }
    return value;
  } finally { clearTimeout(timeout); }
}

function privateFields(value: Record<string, unknown>, defaultLaneId?: string) {
  const virtualLane = parentLaneFromPin(value.pin);
  if ((defaultLaneId || value.parentLaneId) && Object.hasOwn(value, "pin") && !virtualLane) {
    throw new Error("Reopen this gallery before continuing. Your basket was kept.");
  }
  const laneId = virtualLane || (typeof value.parentLaneId === "string" ? value.parentLaneId : defaultLaneId);
  if (!laneId) return value;
  if (!UUID.test(laneId)) throw new Error("Please reopen this gallery before continuing. Your basket was kept.");
  const next: Record<string, unknown> = { ...value, parentLaneId: laneId };
  delete next.pin;
  delete next.email;
  // School galleries can have a derived event/project for presentation. That
  // is not a second authorization scope and must not be sent as one.
  if (next.schoolId) delete next.projectId;
  if (next.projectId || next.eventId) delete next.schoolId;
  return next;
}

/** Keep credentials out of new requests, retaining ordinary legacy callers. */
export function parentPortalRequest(input: RequestInfo | URL, init?: RequestInit, defaultLaneId?: string) {
  if (typeof input !== "string" || !/^\/api\/(?:portal\/|stripe\/checkout(?:\/|$))/.test(input)) return { input, init };
  const url = new URL(input, "https://parent-session.invalid");
  const credentialRoutes = new Set(["gallery-context", "event-gallery-context", "event-favorites", "school-favorites",
    "school-downloads", "event-downloads", "event-download-ready", "yearbook", "orders/create", "orders/create-combined",
    "orders/history", "orders/dismiss", "collages", "collages/preview"].map(route => `/api/portal/${route}`));
  if (!credentialRoutes.has(url.pathname) && !["/api/stripe/checkout", "/api/stripe/checkout/confirm"].includes(url.pathname)) return { input, init };
  let changed = false;
  let nextInit = init ? { ...init } : {};
  if (typeof init?.body === "string" && /json/i.test(new Headers(init.headers).get("content-type") || "")) {
    const body = JSON.parse(init.body);
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const groups = Array.isArray(body.groups) ? body.groups.map((group: unknown) =>
        group && typeof group === "object" && !Array.isArray(group) ? privateFields(group as Record<string, unknown>) : group) : undefined;
      const hasGroups = !!groups?.some((group: Record<string, unknown>) => !!group?.parentLaneId);
      if (hasGroups && groups?.some((group: Record<string, unknown>) => !group?.parentLaneId || Object.hasOwn(group, "pin") || Object.hasOwn(group, "email"))) {
        throw new Error("Reopen the galleries in this basket before continuing. Your basket was kept.");
      }
      const next = privateFields(body, hasGroups ? undefined : defaultLaneId);
      if (groups) next.groups = groups;
      changed = !!next.parentLaneId || hasGroups;
      if (changed) nextInit.body = JSON.stringify(next);
    }
  }
  const queryLane = parentLaneFromPin(url.searchParams.get("pin"));
  if (queryLane) {
    url.searchParams.delete("pin"); url.searchParams.delete("email");
    url.searchParams.set("parentLaneId", queryLane);
    changed = true;
  }
  if (changed) {
    const headers = new Headers(nextInit.headers);
    headers.set("x-studio-parent-session", "1");
    nextInit = { ...nextInit, headers, credentials: "same-origin", cache: "no-store" };
  }
  return { input: `${url.pathname}${url.search}`, init: nextInit };
}

export function parentPortalFetch(input: RequestInfo | URL, init?: RequestInit, defaultLaneId?: string) {
  const request = parentPortalRequest(input, init, defaultLaneId);
  return fetch(request.input, request.init);
}

/** Move existing choices without persisting the old credential-bearing key. */
export function migrateParentChoiceStorage(input: {
  kind: "school" | "event"; galleryId: string; pin: string; email: string; laneId: string;
}, storage: Storage) {
  if (input.kind !== "event") return;
  for (const prefix of ["event-favorites", "event-wall-ratios"]) {
    const oldKey = `${prefix}:${input.galleryId}:${input.email.trim().toLowerCase()}:${input.pin.trim()}`;
    const newKey = `${prefix}:v2:${input.galleryId}:${input.laneId}`;
    const value = storage.getItem(oldKey);
    if (value !== null) {
      const existing = storage.getItem(newKey);
      if (existing === null) storage.setItem(newKey, value);
      else {
        const before = JSON.parse(value), current = JSON.parse(existing);
        if (prefix === "event-favorites" && Array.isArray(before) && Array.isArray(current)) {
          storage.setItem(newKey, JSON.stringify([...new Set([...before, ...current])]));
        } else if (prefix === "event-wall-ratios" && before && current && typeof before === "object" && typeof current === "object") {
          storage.setItem(newKey, JSON.stringify({ ...before, ...current }));
        }
      }
      storage.removeItem(oldKey);
    }
  }
}

/** Upgrade legacy sibling credentials in memory; keep every basket item. */
export async function migrateParentCombineLanes<T extends { pin: string; email: string; schoolId: string }>(lanes: T[]) {
  const result: T[] = [];
  for (const lane of lanes) {
    if (parentLaneFromPin(lane.pin) || !lane.pin || !lane.email) {
      result.push({ ...lane, email: "" });
      continue;
    }
    try {
      const grant = await beginParentGallerySession({ kind: "school", galleryId: lane.schoolId, pin: lane.pin, email: lane.email });
      result.push({ ...lane, pin: parentSessionPin(grant.laneId), email: "" });
    } catch {
      // Reopening that child's gallery restores the lane. Never drop products
      // or persist the old credentials merely because reauthentication failed.
      result.push({ ...lane, pin: "", email: "" });
    }
  }
  return result;
}

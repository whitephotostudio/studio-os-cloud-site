// Cross-gallery cart persistence for the parents-portal combine flow.
//
// Why sessionStorage (not localStorage):
//   · Cart state is meant to live ONLY for the current shopping session.
//     If the parent closes the tab, that's a clear signal they're done.
//     Persisting forever would risk stale items resurfacing weeks later
//     after PINs / prices / archive dates have changed.
//   · Carries across same-tab navigations (so /parents/<sibA-pin> →
//     /parents/<sibB-pin> keeps the cart), which is exactly the use case.
//
// Why per-photographer key (not per-school):
//   · A parent combining siblings stays inside ONE studio.  Cross-studio
//     combining is intentionally blocked at the API level. Scoping by
//     photographerId keeps each studio's session isolated even if the
//     same browser later visits a different studio.
//
// What we persist:
//   · `lanes` — one entry per student gallery the parent has authed into
//     this session.  Each lane carries the schoolId + studentId + the
//     PIN/email used to validate that gallery, plus display labels.
//     These are the auth tokens the combined-checkout endpoint needs.
//   · `items` — cart line items tagged with the lane key they belong to.
//
// Anything else (gallery photos, package definitions, backdrops) stays
// in transient page state and is re-fetched per gallery — those are
// large and don't need to round-trip through sessionStorage.

export type CombineLane = {
  /** schoolId:studentId composite. Stable across mounts. */
  laneKey: string;
  schoolId: string;
  studentId: string;
  pin: string;
  email: string;
  schoolName: string;
  studentName: string;
  /** Captured at validate time so we can label the row in the cart UI. */
  className?: string | null;
  /** "2026" / "2025" — captured for past-year combining. */
  shootYear?: number | null;
};

/**
 * One persisted cart item.  Mirrors the shape of CartLineItem in
 * app/parents/[pin]/page.tsx with the addition of `lane*` tags + the
 * authoritative entry shape required by /api/portal/orders/create*.
 *
 * We keep this as a flat record (not a class instance) so JSON.stringify
 * round-trips cleanly.
 */
export type PersistedCartItem = {
  id: string;
  laneKey: string;
  /** Raw entry payload — server re-prices, never trusts these. */
  packageId: string;
  packageName: string;
  category: string;
  quantity: number;
  packageSubtotalCents: number;
  backdropAddOnCents: number;
  lineTotalCents: number;
  selectedImageUrl: string | null;
  isCompositeOrder: boolean;
  compositeTitle: string | null;
  slots: Array<{
    label: string;
    assignedImageUrl: string | null;
  }>;
  backdrop: {
    id: string;
    name: string;
    imageUrl: string | null;
    blurred: boolean;
    blurAmount: number;
    tier: string | null;
    priceCents: number;
  } | null;
  /** 2026-04-25: portrait/landscape — always defined on new items, but
   *  marked optional so older persisted carts (pre-feature) round-trip
   *  cleanly without their items getting silently dropped. */
  orientation?: "portrait" | "landscape";
};

export type CombineCart = {
  /** Bumps when shape changes; readers ignore older versions silently. */
  version: 1;
  photographerId: string;
  lanes: CombineLane[];
  items: PersistedCartItem[];
};

const STORAGE_PREFIX = "studio-os-combine-cart:";
const CURRENT_VERSION = 1;

function storageKeyFor(photographerId: string): string {
  return `${STORAGE_PREFIX}${photographerId}`;
}

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Read the persisted cart for one studio.  Returns an empty cart shape
 * (with a fresh photographerId) when nothing's stored or the data is
 * corrupt.  Never throws.
 */
export function loadCombineCart(photographerId: string): CombineCart {
  const empty: CombineCart = {
    version: CURRENT_VERSION,
    photographerId,
    lanes: [],
    items: [],
  };
  const storage = safeStorage();
  if (!storage || !photographerId) return empty;
  try {
    const raw = storage.getItem(storageKeyFor(photographerId));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<CombineCart>;
    if (
      !parsed ||
      parsed.version !== CURRENT_VERSION ||
      parsed.photographerId !== photographerId ||
      !Array.isArray(parsed.lanes) ||
      !Array.isArray(parsed.items)
    ) {
      return empty;
    }
    return {
      version: CURRENT_VERSION,
      photographerId,
      lanes: parsed.lanes as CombineLane[],
      items: parsed.items as PersistedCartItem[],
    };
  } catch {
    return empty;
  }
}

/** Persist the cart (best-effort).  Silent no-op when storage is locked. */
export function saveCombineCart(cart: CombineCart): void {
  const storage = safeStorage();
  if (!storage || !cart.photographerId) return;
  try {
    storage.setItem(storageKeyFor(cart.photographerId), JSON.stringify(cart));
  } catch {
    // ignore — quota / private mode, never block the UI
  }
}

/** Wipe the persisted cart for one studio. Used after successful checkout. */
export function clearCombineCart(photographerId: string): void {
  const storage = safeStorage();
  if (!storage || !photographerId) return;
  try {
    storage.removeItem(storageKeyFor(photographerId));
  } catch {
    // ignore
  }
}

/** Compose a stable lane key from school + student. */
export function laneKeyFor(schoolId: string, studentId: string): string {
  return `${schoolId}:${studentId}`;
}

/**
 * Add or replace a lane.  We dedupe by laneKey so re-validating an
 * already-added gallery just refreshes the lane's pin/email/labels
 * without duplicating it.
 */
export function upsertLane(cart: CombineCart, lane: CombineLane): CombineCart {
  const next = cart.lanes.filter((l) => l.laneKey !== lane.laneKey);
  next.push(lane);
  return { ...cart, lanes: next };
}

/** True when the cart contains items from more than one student/school. */
export function isMultiLane(cart: CombineCart): boolean {
  if (cart.items.length === 0) return false;
  const keys = new Set(cart.items.map((i) => i.laneKey));
  return keys.size > 1;
}

/** True when the cart has at least one persisted item OR a saved lane. */
export function hasCombineActivity(cart: CombineCart): boolean {
  return cart.items.length > 0 || cart.lanes.length > 0;
}

/**
 * Group items by lane for the combined-checkout payload + UI rendering.
 * Returns lanes in the order they appear in cart.lanes (stable for tests
 * + receipt order).
 */
export function groupCartByLane(cart: CombineCart): Array<{
  lane: CombineLane;
  items: PersistedCartItem[];
}> {
  return cart.lanes
    .map((lane) => ({
      lane,
      items: cart.items.filter((it) => it.laneKey === lane.laneKey),
    }))
    .filter((g) => g.items.length > 0);
}

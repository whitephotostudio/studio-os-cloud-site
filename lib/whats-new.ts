// "What's New" blue-dot registry + helpers.
//
// When you ship a new feature, add an entry here.  Drop a <WhatsNewDot
// featureId="..."/> next to it in the UI.  Every photographer sees the
// dot the first time they look at it; clicking ANYWHERE on the wrapping
// element marks it seen and the dot disappears for that user forever.
//
// Storage: photographers.seen_features (jsonb array of strings).  The
// blue dot decisions are made on the client by intersecting this array
// with the registry below.
//
// To add a new feature dot:
//   1. Add an entry to FEATURES with a unique stable id.
//   2. Wrap the surface (button / link / card header) with <WhatsNewDot featureId="...">
//   3. Done. No migration, no separate flag.
//
// To deprecate an old feature dot:
//   - Just delete the entry from FEATURES. Already-seen rows in the DB
//     are harmless garbage and will be ignored on render.

export type WhatsNewFeature = {
  /** Stable id stored in photographers.seen_features. Never rename. */
  id: string;
  /** Short human-readable label — used in the optional "what's new" panel. */
  title: string;
  /** ISO date the feature shipped (used for sort order in a future inbox view). */
  shippedAt: string;
};

export const WHATS_NEW_FEATURES: WhatsNewFeature[] = [
  {
    id: "agreement-gate-v1",
    title: "New: Studio OS Cloud agreement",
    shippedAt: "2026-04-24",
  },
  {
    id: "combine-orders-commerce-settings-v1",
    title: "New: combine orders + shipping settings",
    shippedAt: "2026-04-24",
  },
  {
    id: "combine-orders-school-archive-date-v1",
    title: "New: per-school archive date for past-year urgency",
    shippedAt: "2026-04-24",
  },
  {
    id: "pin-recovery-admin-v1",
    title: "New: parents can recover lost PINs themselves",
    shippedAt: "2026-04-24",
  },
  {
    id: "agreement-audit-admin-v1",
    title: "New: agreement acceptance audit log",
    shippedAt: "2026-04-24",
  },
];

/** Lookup helper. */
export function getFeature(id: string): WhatsNewFeature | undefined {
  return WHATS_NEW_FEATURES.find((f) => f.id === id);
}

/** Sort by ship date desc — used by future "what's new" inbox / notification badge counts. */
export function sortedFeatures(): WhatsNewFeature[] {
  return [...WHATS_NEW_FEATURES].sort((a, b) =>
    b.shippedAt.localeCompare(a.shippedAt),
  );
}

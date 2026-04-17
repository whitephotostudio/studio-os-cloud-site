// Studio Assistant — shared types (Phase 1: UI + mock parsing only).
//
// The allowlisted intents below are the ONLY intents this first version of
// the assistant understands.  We intentionally keep this closed so nothing
// downstream can execute arbitrary actions.  Phase 2 will add server-side
// safe execution + action logging; those helpers can reuse these types
// without breaking the UI.

export type StudioAssistantIntent =
  | "create_school"
  | "update_school_dates"
  | "assign_package_profile"
  | "release_school_gallery"
  | "toggle_school_access"
  | "find_school"
  | "find_student"
  | "list_new_orders"
  // Phase 5 — read-only business insights and operational summaries.
  | "summarize_attention_items"
  | "summarize_pending_digital_orders"
  | "summarize_sales_by_school"
  | "summarize_package_performance"
  | "review_release_warnings"
  | "review_expiring_galleries"
  | "review_unreleased_with_preregistrations"
  | "summarize_order_backlog"
  | "summarize_today"
  | "summarize_week"
  // Phase 6 — read-only gallery + sales optimization.  All suggestions are
  // signals-based (favorites, orders, students.photo_url coverage) — no
  // computer vision, no fake ML claims.
  | "review_gallery_coverage"
  | "highlight_popular_media"
  | "suggest_upsell_sizes"
  | "suggest_gallery_cover";

export type ParsedAssistantCommand = {
  /** Original text as submitted by the user (typed or transcribed). */
  originalText: string;
  /** Resolved intent, or null if we couldn't confidently classify. */
  intent: StudioAssistantIntent | null;
  /** 0..1 score from the parser; higher = stronger signal. */
  confidence: number;
  /** Write-style actions should force a visible confirmation step. */
  requiresConfirmation: boolean;
  /** Short, human-readable summary of the planned action. */
  summary: string;
  /** Extracted structured parameters (school name, date, etc.). */
  params: Record<string, unknown>;
  /** Any soft errors / warnings to show in the panel. */
  errors?: string[];
};

/**
 * Intents that mutate studio data.  Used by the panel to decide whether
 * confirmation is required.  Read-only intents can preview results safely.
 */
export const WRITE_INTENTS: ReadonlySet<StudioAssistantIntent> = new Set([
  "create_school",
  "update_school_dates",
  "assign_package_profile",
  "release_school_gallery",
  "toggle_school_access",
]);

export function isWriteIntent(
  intent: StudioAssistantIntent | null,
): boolean {
  if (!intent) return false;
  return WRITE_INTENTS.has(intent);
}

/** Pretty label for an intent, used in the panel header. */
export function intentLabel(intent: StudioAssistantIntent | null): string {
  switch (intent) {
    case "create_school":
      return "Create school";
    case "update_school_dates":
      return "Update school dates";
    case "assign_package_profile":
      return "Assign package profile";
    case "release_school_gallery":
      return "Release school gallery";
    case "toggle_school_access":
      return "Toggle school access";
    case "find_school":
      return "Find school";
    case "find_student":
      return "Find student";
    case "list_new_orders":
      return "List new orders";
    case "summarize_attention_items":
      return "What needs attention";
    case "summarize_pending_digital_orders":
      return "Pending digital orders";
    case "summarize_sales_by_school":
      return "Sales by school";
    case "summarize_package_performance":
      return "Package performance";
    case "review_release_warnings":
      return "Release readiness";
    case "review_expiring_galleries":
      return "Expiring galleries";
    case "review_unreleased_with_preregistrations":
      return "Unreleased with preregistrations";
    case "summarize_order_backlog":
      return "Order backlog";
    case "summarize_today":
      return "Today's summary";
    case "summarize_week":
      return "This week's summary";
    case "review_gallery_coverage":
      return "Gallery photo coverage";
    case "highlight_popular_media":
      return "Most-favorited images";
    case "suggest_upsell_sizes":
      return "Top-selling print sizes";
    case "suggest_gallery_cover":
      return "Cover photo suggestions";
    default:
      return "Unrecognized command";
  }
}

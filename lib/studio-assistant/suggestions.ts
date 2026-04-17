// Studio Assistant — next-step suggestions (Phase 3).
//
// After an action completes we surface 1–2 short, relevant next steps.
// Suggestions are plain data: {label, href?, command?} so the panel can
// render either a link (navigates) or a prompt (pre-fills the command bar).

import { StudioAssistantIntent } from "./types";

export type AssistantSuggestion = {
  label: string;
  /** Navigate to this URL if clicked. */
  href?: string;
  /** Or pre-fill the command bar with this text. */
  command?: string;
};

type RawResult = Record<string, unknown> | null | undefined;

function schoolFromResult(data: RawResult): {
  id?: string;
  name?: string;
} | null {
  if (!data) return null;
  const s = (data.school ?? data.source_school) as
    | Record<string, unknown>
    | undefined;
  if (!s) return null;
  const id = typeof s.id === "string" ? s.id : undefined;
  const name = typeof s.school_name === "string" ? s.school_name : undefined;
  if (!id && !name) return null;
  return { id, name };
}

export function suggestionsForIntent(
  intent: StudioAssistantIntent | null,
  result: RawResult,
): AssistantSuggestion[] {
  if (!intent) return [];
  const school = schoolFromResult(result);

  switch (intent) {
    case "create_school":
      return [
        school?.id
          ? { label: "Open school", href: `/dashboard/projects/schools/${school.id}` }
          : { label: "Open schools", href: "/dashboard/schools" },
        school?.name
          ? {
              label: "Assign a package",
              command: `Copy pricing from (source school) to ${school.name}`,
            }
          : { label: "Assign a package", command: "Copy pricing from … to …" },
      ];

    case "update_school_dates":
      return [
        school?.id
          ? { label: "Open school", href: `/dashboard/projects/schools/${school.id}` }
          : { label: "Open schools", href: "/dashboard/schools" },
        school?.name
          ? { label: "Release gallery", command: `Release ${school.name} gallery tomorrow` }
          : { label: "Release gallery", command: "Release … gallery tomorrow" },
      ];

    case "assign_package_profile":
      return [
        school?.id
          ? { label: "Open school", href: `/dashboard/projects/schools/${school.id}` }
          : { label: "Open schools", href: "/dashboard/schools" },
        { label: "Review packages", href: "/dashboard/packages" },
      ];

    case "release_school_gallery":
      return [
        school?.id
          ? { label: "Open school", href: `/dashboard/projects/schools/${school.id}` }
          : { label: "Open schools", href: "/dashboard/schools" },
        { label: "View new orders", command: "Show today's new orders" },
      ];

    case "toggle_school_access":
      return [
        school?.id
          ? { label: "Open school", href: `/dashboard/projects/schools/${school.id}` }
          : { label: "Open schools", href: "/dashboard/schools" },
      ];

    case "find_school":
      return [
        school?.id
          ? { label: "Open school", href: `/dashboard/projects/schools/${school.id}` }
          : { label: "Open schools", href: "/dashboard/schools" },
        school?.name
          ? { label: "Release gallery", command: `Release ${school.name} gallery tomorrow` }
          : { label: "Release a gallery", command: "Release … gallery tomorrow" },
      ];

    case "find_student":
      return [{ label: "Open schools", href: "/dashboard/schools" }];

    case "list_new_orders":
      return [
        { label: "Open orders", href: "/dashboard/orders" },
        { label: "Fulfil digital files", href: "/dashboard/orders" },
      ];

    // ── Phase 5 follow-ups ──────────────────────────────────────────────
    case "summarize_attention_items":
      return [
        { label: "Release review", command: "Which schools are not ready for release?" },
        { label: "Pending digital orders", command: "Which digital orders are still pending?" },
        { label: "Expiring galleries", command: "Which galleries expire this week?" },
      ];
    case "summarize_pending_digital_orders":
      return [
        { label: "Open orders", href: "/dashboard/orders" },
        { label: "Order backlog", command: "Show order backlog" },
      ];
    case "summarize_order_backlog":
      return [
        { label: "Open orders", href: "/dashboard/orders" },
        { label: "Pending digital", command: "Which digital orders are still pending?" },
      ];
    case "summarize_sales_by_school":
      return [
        { label: "Open schools", href: "/dashboard/schools" },
        { label: "Package performance", command: "Which package profiles perform best this month?" },
      ];
    case "summarize_package_performance":
      return [
        { label: "Review packages", href: "/dashboard/packages" },
        { label: "Sales by school", command: "Show sales by school this month" },
      ];
    case "review_release_warnings":
      return [
        { label: "Open schools", href: "/dashboard/schools" },
        { label: "Unreleased w/ interest", command: "Show unreleased schools with parent interest" },
      ];
    case "review_expiring_galleries":
      return [{ label: "Open schools", href: "/dashboard/schools" }];
    case "review_unreleased_with_preregistrations":
      return [
        { label: "Open schools", href: "/dashboard/schools" },
        { label: "Release readiness", command: "Which schools are not ready for release?" },
      ];
    case "summarize_today":
      return [
        { label: "Needs attention", command: "What needs my attention?" },
        { label: "Open orders", href: "/dashboard/orders" },
      ];
    case "summarize_week":
      return [
        { label: "Needs attention", command: "What needs my attention?" },
        { label: "Digital pending", command: "Which digital orders are still pending?" },
      ];

    // ── Phase 6 gallery optimization follow-ups ────────────────────────
    case "review_gallery_coverage":
      return [
        school?.id
          ? { label: "Open school", href: `/dashboard/projects/schools/${school.id}` }
          : { label: "Open schools", href: "/dashboard/schools" },
        school?.name
          ? { label: "Cover suggestions", command: `Suggest a cover photo for ${school.name}` }
          : { label: "Cover suggestions", command: "Suggest a cover photo for …" },
      ];
    case "highlight_popular_media":
      return [
        school?.id
          ? { label: "Open school", href: `/dashboard/projects/schools/${school.id}` }
          : { label: "Open schools", href: "/dashboard/schools" },
        school?.name
          ? { label: "Cover suggestions", command: `Suggest a cover photo for ${school.name}` }
          : { label: "Cover suggestions", command: "Suggest a cover photo for …" },
      ];
    case "suggest_upsell_sizes":
      return [
        school?.id
          ? { label: "Open school", href: `/dashboard/projects/schools/${school.id}` }
          : { label: "Open schools", href: "/dashboard/schools" },
        { label: "Review packages", href: "/dashboard/packages" },
      ];
    case "suggest_gallery_cover":
      return [
        school?.id
          ? { label: "Open school", href: `/dashboard/projects/schools/${school.id}` }
          : { label: "Open schools", href: "/dashboard/schools" },
        school?.name
          ? { label: "Popular images", command: `Show the most popular images at ${school.name}` }
          : { label: "Popular images", command: "Show the most popular images at …" },
      ];

    default:
      return [];
  }
}

/** Short, confident phrase to speak after a successful action. */
export function shortSpokenAck(
  intent: StudioAssistantIntent | null,
  message: string,
): string {
  if (!intent) return "Done.";
  switch (intent) {
    case "create_school":
      return "School created.";
    case "update_school_dates":
      return "Dates updated.";
    case "assign_package_profile":
      return "Pricing copied.";
    case "release_school_gallery":
      return "Gallery released.";
    case "toggle_school_access":
      return "Access updated.";
    case "find_school":
    case "find_student":
    case "list_new_orders":
    case "summarize_attention_items":
    case "summarize_pending_digital_orders":
    case "summarize_sales_by_school":
    case "summarize_package_performance":
    case "review_release_warnings":
    case "review_expiring_galleries":
    case "review_unreleased_with_preregistrations":
    case "summarize_order_backlog":
    case "summarize_today":
    case "summarize_week":
    case "review_gallery_coverage":
    case "highlight_popular_media":
    case "suggest_upsell_sizes":
    case "suggest_gallery_cover":
      return message; // server messages already carry concise counts
    default:
      return "Done.";
  }
}

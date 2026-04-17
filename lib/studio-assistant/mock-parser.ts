// Studio Assistant — deterministic mock parser (Phase 1).
//
// This parser is intentionally small and local.  No network calls, no LLM.
// It converts a few well-known command shapes into typed
// `ParsedAssistantCommand` values so the UI can preview what would happen.
//
// Phase 2 will swap this for a real intent classifier / LLM layer, but the
// return type will stay the same so the panel keeps working.

import {
  ParsedAssistantCommand,
  StudioAssistantIntent,
  intentLabel,
  isWriteIntent,
} from "./types";

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Extract a school name from a noun phrase. Very forgiving. */
function extractSchoolName(text: string): string | null {
  // "for Maple Creek on May 10" → "Maple Creek"
  const forMatch = text.match(
    /\bfor\s+([A-Z][\w.'&-]*(?:\s+[A-Z][\w.'&-]*){0,4})(?=\s+(?:on|at|to|from|starting|gallery|tomorrow|today|next|this|with|$))/,
  );
  if (forMatch?.[1]) return clean(forMatch[1]);

  // "school named Maple Creek"
  const namedMatch = text.match(/\bnamed\s+([A-Z][\w.'&-]*(?:\s+[A-Z][\w.'&-]*){0,4})/);
  if (namedMatch?.[1]) return clean(namedMatch[1]);

  // "Maple Creek school"
  const trailingMatch = text.match(
    /\b([A-Z][\w.'&-]*(?:\s+[A-Z][\w.'&-]*){0,3})\s+(?:school|elementary|academy|high|middle)\b/,
  );
  if (trailingMatch?.[1]) return clean(trailingMatch[1]);

  // "release St. Mary gallery" → "St. Mary"
  const galleryMatch = text.match(
    /\brelease\s+([A-Z][\w.'&-]*(?:\s+[A-Z][\w.'&-]*){0,4})\s+gallery\b/i,
  );
  if (galleryMatch?.[1]) return clean(galleryMatch[1]);

  return null;
}

/** Extract a "from X to Y" source/destination pair of school names. */
function extractSchoolPair(text: string): {
  source: string | null;
  destination: string | null;
} {
  const pair = text.match(
    /\bfrom\s+([A-Z][\w.'&-]*(?:\s+[A-Z][\w.'&-]*){0,4})\s+to\s+([A-Z][\w.'&-]*(?:\s+[A-Z][\w.'&-]*){0,4})/,
  );
  if (pair) {
    return { source: clean(pair[1]), destination: clean(pair[2]) };
  }
  return { source: null, destination: null };
}

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function extractDate(text: string, now: Date = new Date()): string | null {
  const lower = text.toLowerCase();

  if (/\btoday\b/.test(lower)) {
    return toIsoDate(now);
  }
  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return toIsoDate(d);
  }
  if (/\byesterday\b/.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return toIsoDate(d);
  }

  // "May 10", "May 10 2026", "May 10th"
  const monthDay = lower.match(
    /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/,
  );
  if (monthDay) {
    const month = MONTHS[monthDay[1]];
    const day = Number.parseInt(monthDay[2] ?? "", 10);
    const year = monthDay[3]
      ? Number.parseInt(monthDay[3], 10)
      : inferYear(now, month, day);
    if (Number.isFinite(day) && day > 0 && day <= 31) {
      const d = new Date(year, month, day);
      if (!Number.isNaN(d.getTime())) return toIsoDate(d);
    }
  }

  // ISO-ish "2026-05-10"
  const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  return null;
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** If the user said "May 10" without a year, pick the next upcoming one. */
function inferYear(now: Date, month: number, day: number): number {
  const y = now.getFullYear();
  const candidate = new Date(y, month, day);
  if (candidate.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    return y + 1;
  }
  return y;
}

/** Extract anything that looks like a person's name after "find student". */
function extractStudentName(text: string): string | null {
  const m = text.match(
    /\bstudent(?:\s+named)?\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+){0,3})/,
  );
  return m ? clean(m[1]) : null;
}

/** Extract a package profile name like `"package Classic"`. */
function extractPackageName(text: string): string | null {
  const m = text.match(
    /\b(?:package|pricing|profile)\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+){0,3})/,
  );
  return m ? clean(m[1]) : null;
}

/* -------------------------------------------------------------------------- */
/*  Intent matchers                                                           */
/* -------------------------------------------------------------------------- */

type MatcherResult =
  | {
      intent: StudioAssistantIntent;
      confidence: number;
      params: Record<string, unknown>;
      errors?: string[];
    }
  | null;

function matchCreateSchool(text: string): MatcherResult {
  if (!/\bcreate\b.*\bschool\b/i.test(text) && !/\bnew\s+school\b/i.test(text)) {
    return null;
  }
  const school = extractSchoolName(text);
  const date = extractDate(text);
  const errors: string[] = [];
  if (!school) errors.push("Missing school name.");
  return {
    intent: "create_school",
    confidence: school && date ? 0.92 : school ? 0.78 : 0.55,
    params: {
      school_name: school,
      event_date: date,
    },
    errors: errors.length ? errors : undefined,
  };
}

function matchUpdateSchoolDates(text: string): MatcherResult {
  const looksLikeUpdate =
    /\b(move|reschedule|change|update|shift)\b.*\b(date|day|photos?|shoot)\b/i.test(
      text,
    ) || /\breschedule\b.*\bto\b/i.test(text);
  if (!looksLikeUpdate) return null;

  const school = extractSchoolName(text);
  const date = extractDate(text);
  const errors: string[] = [];
  if (!school) errors.push("Missing school name.");
  if (!date) errors.push("Missing new date.");

  return {
    intent: "update_school_dates",
    confidence: school && date ? 0.88 : 0.6,
    params: { school_name: school, new_date: date },
    errors: errors.length ? errors : undefined,
  };
}

function matchAssignPackageProfile(text: string): MatcherResult {
  const looksLikeAssign =
    /\b(copy|assign|apply|use)\b.*\b(pricing|package|profile)\b/i.test(text);
  if (!looksLikeAssign) return null;

  const { source, destination } = extractSchoolPair(text);
  const pkg = extractPackageName(text);
  const errors: string[] = [];
  if (!source && !pkg) errors.push("Missing source package or school.");
  if (!destination) errors.push("Missing destination school.");

  return {
    intent: "assign_package_profile",
    confidence: (source || pkg) && destination ? 0.85 : 0.55,
    params: {
      source_school: source,
      destination_school: destination,
      package_name: pkg,
    },
    errors: errors.length ? errors : undefined,
  };
}

function matchReleaseSchoolGallery(text: string): MatcherResult {
  if (!/\brelease\b.*\bgallery\b/i.test(text)) return null;
  const school = extractSchoolName(text);
  const date = extractDate(text);
  const errors: string[] = [];
  if (!school) errors.push("Missing school name.");
  return {
    intent: "release_school_gallery",
    confidence: school ? 0.9 : 0.55,
    params: {
      school_name: school,
      release_on: date, // optional — schedule or immediate
    },
    errors: errors.length ? errors : undefined,
  };
}

function matchToggleSchoolAccess(text: string): MatcherResult {
  if (!/\b(lock|unlock|enable|disable|close|reopen)\b.*\b(access|gallery|school)\b/i.test(text)) {
    return null;
  }
  const enabled = /\b(unlock|enable|reopen|open)\b/i.test(text);
  const school = extractSchoolName(text);
  const errors: string[] = [];
  if (!school) errors.push("Missing school name.");
  return {
    intent: "toggle_school_access",
    confidence: school ? 0.82 : 0.5,
    params: {
      school_name: school,
      access_enabled: enabled,
    },
    errors: errors.length ? errors : undefined,
  };
}

function matchFindSchool(text: string): MatcherResult {
  if (!/\b(find|show|look\s*up|search|open)\b.*\bschool\b/i.test(text)) {
    return null;
  }
  const school = extractSchoolName(text);
  return {
    intent: "find_school",
    confidence: school ? 0.86 : 0.5,
    params: { query: school },
    errors: school ? undefined : ["Missing school name."],
  };
}

function matchFindStudent(text: string): MatcherResult {
  if (!/\b(find|show|look\s*up|search)\b.*\bstudent\b/i.test(text)) {
    return null;
  }
  const name = extractStudentName(text);
  return {
    intent: "find_student",
    confidence: name ? 0.88 : 0.5,
    params: { query: name },
    errors: name ? undefined : ["Missing student name."],
  };
}

function matchListNewOrders(text: string): MatcherResult {
  if (
    !/\b(show|list|today'?s?|latest|new|recent)\b.*\borders?\b/i.test(text) &&
    !/\bnew\s+orders?\b/i.test(text)
  ) {
    return null;
  }
  const date = extractDate(text) ?? toIsoDate(new Date());
  return {
    intent: "list_new_orders",
    confidence: 0.84,
    params: { since: date },
  };
}

/* -------------------------------------------------------------------------- */
/*  Phase 5 — read-only insight matchers                                      */
/* -------------------------------------------------------------------------- */

function matchAttention(text: string): MatcherResult {
  if (
    /\b(needs?|need)\s+(my\s+)?attention\b/i.test(text) ||
    /\bwhat\s+(should|do)\s+i\s+(follow\s+up|review|focus)\b/i.test(text) ||
    /\bwhat(?:'s|\s+is)\s+urgent\b/i.test(text)
  ) {
    return { intent: "summarize_attention_items", confidence: 0.9, params: {} };
  }
  return null;
}

function matchPendingDigitalOrders(text: string): MatcherResult {
  if (
    /\b(pending|unfulfill(?:ed)?|unsent|not\s+sent|outstanding)\b.*\b(digital|download)s?\b/i.test(
      text,
    ) ||
    /\bdigital\s+(orders?|downloads?)\b.*\b(pending|still)\b/i.test(text) ||
    /\bdigital\s+pending\b/i.test(text)
  ) {
    return {
      intent: "summarize_pending_digital_orders",
      confidence: 0.9,
      params: {},
    };
  }
  return null;
}

function matchSalesBySchool(text: string): MatcherResult {
  if (
    /\b(top|best)\s+schools?\b.*\b(orders?|sales|revenue)\b/i.test(text) ||
    /\b(sales|orders?|revenue)\s+by\s+school\b/i.test(text) ||
    /\bwhich\s+schools?\b.*\bmost\s+(orders?|sales|revenue)\b/i.test(text)
  ) {
    return { intent: "summarize_sales_by_school", confidence: 0.9, params: {} };
  }
  return null;
}

function matchPackagePerformance(text: string): MatcherResult {
  if (
    /\b(top|best|popular)\s+(package|profile|pricing)\b/i.test(text) ||
    /\b(package|profile)\s+(performance|usage|sales)\b/i.test(text) ||
    /\bwhich\s+package(?:s)?\b.*\b(selling|performing|best)\b/i.test(text)
  ) {
    return {
      intent: "summarize_package_performance",
      confidence: 0.9,
      params: {},
    };
  }
  return null;
}

function matchReleaseWarnings(text: string): MatcherResult {
  if (
    /\b(not\s+ready|release\s+(warnings?|readiness))\b/i.test(text) ||
    /\bwhich\s+schools?\b.*\b(not\s+ready|missing)\b/i.test(text) ||
    /\bschools?\b.*\b(missing)\s+(due\s+date|package|package\s+profile)\b/i.test(text)
  ) {
    return { intent: "review_release_warnings", confidence: 0.88, params: {} };
  }
  return null;
}

function matchExpiringGalleries(text: string): MatcherResult {
  if (
    /\b(expir\w+)\b.*\b(gall(?:ery|eries))\b/i.test(text) ||
    /\bgall(?:ery|eries)\b.*\b(expir\w+|near(?:ing)?\s+end|soon)\b/i.test(text)
  ) {
    return { intent: "review_expiring_galleries", confidence: 0.9, params: {} };
  }
  return null;
}

function matchUnreleasedWithPreregs(text: string): MatcherResult {
  if (
    /\b(unreleased|not\s+released)\b.*\b(pre[-\s]?register|pre[-\s]?release|interest)\b/i.test(
      text,
    ) ||
    /\b(pre[-\s]?registration|parent\s+interest)\b.*\b(unreleased|not\s+released|waiting)\b/i.test(
      text,
    )
  ) {
    return {
      intent: "review_unreleased_with_preregistrations",
      confidence: 0.88,
      params: {},
    };
  }
  return null;
}

function matchOrderBacklog(text: string): MatcherResult {
  if (
    /\b(order\s+backlog|backlog)\b/i.test(text) ||
    /\b(unreviewed|unseen)\s+orders?\b/i.test(text) ||
    /\border\s+follow[-\s]?up\b/i.test(text)
  ) {
    return { intent: "summarize_order_backlog", confidence: 0.88, params: {} };
  }
  return null;
}

function matchSummarizeToday(text: string): MatcherResult {
  if (
    /\btoday(?:'s)?\s+summary\b/i.test(text) ||
    /\bwhat(?:'s|\s+is)\s+happening\s+today\b/i.test(text) ||
    /\bhow\s+is\s+today\b/i.test(text) ||
    /\bdaily\s+summary\b/i.test(text)
  ) {
    return { intent: "summarize_today", confidence: 0.9, params: {} };
  }
  return null;
}

function matchSummarizeWeek(text: string): MatcherResult {
  if (
    /\bthis\s+week(?:'s)?\s+summary\b/i.test(text) ||
    /\bweekly\s+summary\b/i.test(text) ||
    /\bwhat(?:'s|\s+is)\s+happening\s+this\s+week\b/i.test(text)
  ) {
    return { intent: "summarize_week", confidence: 0.9, params: {} };
  }
  return null;
}

/* ------- Phase 6 — gallery / sales optimization matchers ------------------ */

function matchGalleryCoverage(text: string): MatcherResult {
  const looksLike =
    /\b(gallery|photo)\s+coverage\b/i.test(text) ||
    /\bmissing\s+(photos?|rosters?)\b/i.test(text) ||
    /\bhow\s+many\s+students?\b.*\b(photo|missing)\b/i.test(text);
  if (!looksLike) return null;
  const school = extractSchoolName(text);
  return {
    intent: "review_gallery_coverage",
    confidence: school ? 0.88 : 0.68,
    params: { school_name: school },
    errors: school ? undefined : ["Tell me which school to check."],
  };
}

function matchPopularMedia(text: string): MatcherResult {
  const looksLike =
    /\b(most[\s-]*favorited|most\s+(liked|loved)|popular\s+(images?|photos?|media))\b/i.test(text) ||
    /\bhighlight\s+(best|top|popular)\s+(images?|photos?)\b/i.test(text) ||
    /\bmost[\s-]*ordered\s+(photos?|images?|students?)\b/i.test(text);
  if (!looksLike) return null;
  const school = extractSchoolName(text);
  return {
    intent: "highlight_popular_media",
    confidence: school ? 0.86 : 0.72,
    params: { school_name: school },
  };
}

function matchUpsellSizes(text: string): MatcherResult {
  const looksLike =
    /\b(upsell|best[\s-]*selling|top[\s-]*selling)\s+(sizes?|prints?|items?)\b/i.test(text) ||
    /\bwhat\s+(size|sizes?)\s+sell(s|ing)?\s+best\b/i.test(text) ||
    /\b(popular|top)\s+(print|package)\s+(sizes?|items?|options?)\b/i.test(text);
  if (!looksLike) return null;
  const school = extractSchoolName(text);
  return {
    intent: "suggest_upsell_sizes",
    confidence: school ? 0.86 : 0.72,
    params: { school_name: school },
  };
}

function matchCoverSuggestions(text: string): MatcherResult {
  const looksLike =
    /\b(suggest|pick|choose|recommend)\s+(a\s+)?(cover|cover\s+photo|hero)\b/i.test(text) ||
    /\b(cover\s+photo|gallery\s+cover)\s+(suggestions?|candidates?|ideas?)\b/i.test(text) ||
    /\bbest\s+cover\s+for\b/i.test(text);
  if (!looksLike) return null;
  const school = extractSchoolName(text);
  return {
    intent: "suggest_gallery_cover",
    confidence: school ? 0.88 : 0.72,
    params: { school_name: school },
  };
}

/** Order matters — write-like intents are checked before find-like ones.
 *  Phase 5 insight intents are checked LAST so we don't shadow the existing
 *  find/list/update matchers. */
const MATCHERS: Array<(text: string) => MatcherResult> = [
  matchCreateSchool,
  matchUpdateSchoolDates,
  matchAssignPackageProfile,
  matchReleaseSchoolGallery,
  matchToggleSchoolAccess,
  matchFindStudent,
  matchFindSchool,
  matchListNewOrders,
  // Phase 5 read-only summaries
  matchAttention,
  matchPendingDigitalOrders,
  matchSalesBySchool,
  matchPackagePerformance,
  matchReleaseWarnings,
  matchExpiringGalleries,
  matchUnreleasedWithPreregs,
  matchOrderBacklog,
  matchSummarizeToday,
  matchSummarizeWeek,
  // Phase 6 gallery/sales optimization
  matchGalleryCoverage,
  matchPopularMedia,
  matchUpsellSizes,
  matchCoverSuggestions,
];

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

export function parseAssistantCommand(
  input: string,
): ParsedAssistantCommand {
  const originalText = clean(input);
  if (!originalText) {
    return {
      originalText,
      intent: null,
      confidence: 0,
      requiresConfirmation: false,
      summary: "Type a command to get started.",
      params: {},
    };
  }

  for (const matcher of MATCHERS) {
    const result = matcher(originalText);
    if (result) {
      const summary = buildSummary(result.intent, result.params);
      return {
        originalText,
        intent: result.intent,
        confidence: result.confidence,
        requiresConfirmation: isWriteIntent(result.intent),
        summary,
        params: result.params,
        errors: result.errors,
      };
    }
  }

  return {
    originalText,
    intent: null,
    confidence: 0.15,
    requiresConfirmation: false,
    summary: "Studio Assistant couldn't match this to a supported action yet.",
    params: {},
    errors: [
      "Try: " +
        "“Create a school for Maple Creek on May 10”, " +
        "“Release St. Mary gallery tomorrow”, or " +
        "“Show today's new orders”.",
    ],
  };
}

function buildSummary(
  intent: StudioAssistantIntent,
  params: Record<string, unknown>,
): string {
  const p = params as Record<string, string | null>;
  switch (intent) {
    case "create_school": {
      const school = p.school_name ?? "(unspecified school)";
      const when = p.event_date ?? "an unspecified date";
      return `Create school “${school}” for ${when}.`;
    }
    case "update_school_dates": {
      const school = p.school_name ?? "(unspecified school)";
      const when = p.new_date ?? "a new date";
      return `Move “${school}” photo date to ${when}.`;
    }
    case "assign_package_profile": {
      const src = p.source_school ?? p.package_name ?? "(source)";
      const dest = p.destination_school ?? "(destination)";
      return `Copy pricing from “${src}” to “${dest}”.`;
    }
    case "release_school_gallery": {
      const school = p.school_name ?? "(unspecified school)";
      const when = p.release_on ?? "now";
      return `Release “${school}” gallery on ${when}.`;
    }
    case "toggle_school_access": {
      const school = p.school_name ?? "(unspecified school)";
      const state = (params.access_enabled as boolean) ? "unlock" : "lock";
      return `${state === "unlock" ? "Unlock" : "Lock"} access for “${school}”.`;
    }
    case "find_school":
      return `Find school matching “${p.query ?? ""}”.`;
    case "find_student":
      return `Find student matching “${p.query ?? ""}”.`;
    case "list_new_orders":
      return `List orders received since ${p.since ?? "today"}.`;
    case "summarize_attention_items":
      return "Show schools and orders that need attention right now.";
    case "summarize_pending_digital_orders":
      return "Summarize digital orders still awaiting fulfillment.";
    case "summarize_sales_by_school":
      return "Group order volume by school this month.";
    case "summarize_package_performance":
      return "Show which package profiles drive the most orders.";
    case "review_release_warnings":
      return "List schools that aren't ready to release.";
    case "review_expiring_galleries":
      return "List galleries expiring soon.";
    case "review_unreleased_with_preregistrations":
      return "List unreleased schools that already have preregistered parents.";
    case "summarize_order_backlog":
      return "Summarize pending and new orders by school.";
    case "summarize_today":
      return "Summarize today's orders, reviews, and expirations.";
    case "summarize_week":
      return "Summarize this week's orders, reviews, and expirations.";
    case "review_gallery_coverage":
      return `Review photo coverage${p.school_name ? ` for “${p.school_name}”` : ""}.`;
    case "highlight_popular_media":
      return `Highlight the most popular images${p.school_name ? ` at “${p.school_name}”` : ""}.`;
    case "suggest_upsell_sizes":
      return `Show top-selling print sizes${p.school_name ? ` at “${p.school_name}”` : " across schools"}.`;
    case "suggest_gallery_cover":
      return `Suggest gallery cover candidates${p.school_name ? ` for “${p.school_name}”` : ""}.`;
    default:
      return intentLabel(intent);
  }
}

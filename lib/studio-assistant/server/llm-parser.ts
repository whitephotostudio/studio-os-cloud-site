// Studio Assistant — LLM-backed parser (Phase 3) with deterministic fallback.
//
// The LLM is consulted first when `OPENAI_API_KEY` is set and `OPENAI_MODEL`
// optionally names a chat-capable model (defaults to gpt-4o-mini). Results
// are strictly validated against the allowlisted intent schema before we
// hand them to the executor — so LLM hallucinations cannot introduce new
// actions.
//
// If:
//   - no API key is configured
//   - the network call fails
//   - the LLM output is malformed or unsupported
//   - the LLM's own confidence is low
// …we fall back to the deterministic parser from Phase 1.

import {
  ParsedAssistantCommand,
  StudioAssistantIntent,
  intentLabel,
  isWriteIntent,
} from "@/lib/studio-assistant/types";
import { parseAssistantCommand } from "@/lib/studio-assistant/mock-parser";

const SUPPORTED_INTENTS: ReadonlySet<StudioAssistantIntent> = new Set([
  "create_school",
  "update_school_dates",
  "assign_package_profile",
  "release_school_gallery",
  "toggle_school_access",
  "find_school",
  "find_student",
  "list_new_orders",
  // Phase 5 read-only insights
  "summarize_attention_items",
  "summarize_pending_digital_orders",
  "summarize_sales_by_school",
  "summarize_package_performance",
  "review_release_warnings",
  "review_expiring_galleries",
  "review_unreleased_with_preregistrations",
  "summarize_order_backlog",
  "summarize_today",
  "summarize_week",
  // Phase 6
  "review_gallery_coverage",
  "highlight_popular_media",
  "suggest_upsell_sizes",
  "suggest_gallery_cover",
]);

const CONFIDENCE_FLOOR = 0.55; // below this we fall back / ask for clarification

const SYSTEM_PROMPT = `You are Studio Assistant, an intent classifier for Studio OS Cloud.
You convert a photographer's natural-language command into STRUCTURED JSON.
You NEVER invent actions — if the user's command does not match one of the
allowed intents, return intent=null.

Allowed intents:
- create_school: params { school_name: string, event_date?: YYYY-MM-DD }
- update_school_dates: params { school_name: string, new_date: YYYY-MM-DD }
- assign_package_profile: params { source_school: string, destination_school: string }
- release_school_gallery: params { school_name: string, release_on?: YYYY-MM-DD }
- toggle_school_access: params { school_name: string, access_enabled: boolean }
- find_school: params { query: string }
- find_student: params { query: string }
- list_new_orders: params { since?: YYYY-MM-DD }
- summarize_attention_items: params {}
- summarize_pending_digital_orders: params {}
- summarize_sales_by_school: params { since?: YYYY-MM-DD }
- summarize_package_performance: params { since?: YYYY-MM-DD }
- review_release_warnings: params {}
- review_expiring_galleries: params { within_days?: number }
- review_unreleased_with_preregistrations: params {}
- summarize_order_backlog: params {}
- summarize_today: params {}
- summarize_week: params {}
- review_gallery_coverage: params { school_name?: string }
- highlight_popular_media: params { school_name?: string }
- suggest_upsell_sizes: params { school_name?: string }
- suggest_gallery_cover: params { school_name?: string }

Reply with JSON ONLY. Schema:
{
  "intent": string | null,
  "confidence": number between 0 and 1,
  "params": object,
  "summary": string,
  "errors": string[] (optional)
}

Summary should be 1 short sentence. Be conservative with confidence — prefer
0.6 if you are guessing, 0.9 if the command is explicit.`;

type LlmRawResponse = {
  intent?: unknown;
  confidence?: unknown;
  params?: unknown;
  summary?: unknown;
  errors?: unknown;
};

export type ParseOptions = {
  /** Optional hints from session memory (e.g. last-referenced school). */
  contextHints?: {
    lastSchoolName?: string | null;
  };
  /** Override the confidence floor from callers/tests. */
  confidenceFloor?: number;
};

/**
 * Public entrypoint. Always returns a `ParsedAssistantCommand` — even if the
 * LLM isn't configured or fails.
 */
export async function parseWithLlmOrFallback(
  input: string,
  options: ParseOptions = {},
): Promise<ParsedAssistantCommand> {
  const floor = options.confidenceFloor ?? CONFIDENCE_FLOOR;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return applyContextHints(parseAssistantCommand(input), options);
  }

  try {
    const llm = await callOpenAi(apiKey, input, options.contextHints ?? null);
    if (llm) {
      const normalized = normalizeLlmResponse(input, llm);
      if (normalized && normalized.confidence >= floor) {
        return applyContextHints(normalized, options);
      }
    }
  } catch (err) {
    console.error("[studio-assistant] LLM parse failed:", err);
  }

  // Graceful fallback — deterministic parser never throws.
  return applyContextHints(parseAssistantCommand(input), options);
}

/* -------------------------------------------------------------------------- */
/*  OpenAI call                                                               */
/* -------------------------------------------------------------------------- */

async function callOpenAi(
  apiKey: string,
  userInput: string,
  contextHints: NonNullable<ParseOptions["contextHints"]> | null,
): Promise<LlmRawResponse | null> {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const baseUrl =
    process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

  const contextLine = contextHints?.lastSchoolName
    ? `Context: the user was last discussing the school "${contextHints.lastSchoolName}". If the command is a follow-up that omits the school, prefer this one.`
    : "";

  const body = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...(contextLine ? [{ role: "system", content: contextLine }] : []),
      { role: "user", content: userInput },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 400,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error("[studio-assistant] LLM HTTP", res.status);
      return null;
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    if (!content) return null;
    return JSON.parse(content) as LlmRawResponse;
  } finally {
    clearTimeout(timeout);
  }
}

/* -------------------------------------------------------------------------- */
/*  Validation                                                                */
/* -------------------------------------------------------------------------- */

function normalizeLlmResponse(
  originalText: string,
  raw: LlmRawResponse,
): ParsedAssistantCommand | null {
  const intentStr = typeof raw.intent === "string" ? raw.intent : null;
  const intent: StudioAssistantIntent | null =
    intentStr && SUPPORTED_INTENTS.has(intentStr as StudioAssistantIntent)
      ? (intentStr as StudioAssistantIntent)
      : null;

  const confidence =
    typeof raw.confidence === "number" && raw.confidence >= 0 && raw.confidence <= 1
      ? raw.confidence
      : 0.6;

  const paramsObj =
    raw.params && typeof raw.params === "object" && !Array.isArray(raw.params)
      ? (raw.params as Record<string, unknown>)
      : {};

  // Strip anything not in the allowlisted schema for this intent.
  const params = intent ? scrubParams(intent, paramsObj) : {};

  const summary =
    (typeof raw.summary === "string" && raw.summary.trim()) ||
    (intent
      ? `${intentLabel(intent)} for ${String(params.school_name ?? params.query ?? "…")}`
      : "Studio Assistant couldn't match this command.");

  const errors = Array.isArray(raw.errors)
    ? raw.errors.filter((e): e is string => typeof e === "string" && e.length > 0)
    : [];

  return {
    originalText: originalText.trim(),
    intent,
    confidence,
    requiresConfirmation: isWriteIntent(intent),
    summary,
    params,
    errors: errors.length ? errors : undefined,
  };
}

function scrubParams(
  intent: StudioAssistantIntent,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const allow = ALLOWED_PARAMS[intent];
  const out: Record<string, unknown> = {};
  for (const key of allow) {
    if (raw[key] === undefined || raw[key] === null || raw[key] === "") continue;
    out[key] = coerceParam(key, raw[key]);
  }
  return out;
}

const ALLOWED_PARAMS: Record<StudioAssistantIntent, string[]> = {
  create_school: ["school_name", "event_date"],
  update_school_dates: ["school_name", "new_date"],
  assign_package_profile: ["source_school", "destination_school"],
  release_school_gallery: ["school_name", "release_on"],
  toggle_school_access: ["school_name", "access_enabled"],
  find_school: ["query"],
  find_student: ["query"],
  list_new_orders: ["since"],
  // Phase 5 — insights are mostly parameterless; a couple accept a date window.
  summarize_attention_items: [],
  summarize_pending_digital_orders: [],
  summarize_sales_by_school: ["since"],
  summarize_package_performance: ["since"],
  review_release_warnings: [],
  review_expiring_galleries: ["within_days"],
  review_unreleased_with_preregistrations: [],
  summarize_order_backlog: [],
  summarize_today: [],
  summarize_week: [],
  review_gallery_coverage: ["school_name"],
  highlight_popular_media: ["school_name"],
  suggest_upsell_sizes: ["school_name"],
  suggest_gallery_cover: ["school_name"],
};

function coerceParam(key: string, value: unknown): unknown {
  if (key === "access_enabled") return Boolean(value);
  if (key === "event_date" || key === "new_date" || key === "release_on" || key === "since") {
    if (typeof value !== "string") return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }
  if (key === "within_days") {
    const n = typeof value === "number" ? value : Number.parseInt(String(value), 10);
    return Number.isFinite(n) && n > 0 ? Math.min(90, Math.max(1, Math.round(n))) : null;
  }
  if (typeof value === "string") return value.trim();
  return value;
}

/* -------------------------------------------------------------------------- */
/*  Context hints                                                             */
/* -------------------------------------------------------------------------- */

function applyContextHints(
  parsed: ParsedAssistantCommand,
  options: ParseOptions,
): ParsedAssistantCommand {
  const last = options.contextHints?.lastSchoolName;
  if (!last) return parsed;
  if (!parsed.intent) return parsed;

  const params = { ...parsed.params };
  const needsSchool =
    parsed.intent === "update_school_dates" ||
    parsed.intent === "release_school_gallery" ||
    parsed.intent === "toggle_school_access";

  if (needsSchool && !params.school_name) {
    params.school_name = last;
    return {
      ...parsed,
      params,
      summary: parsed.summary.replace(/\(unspecified school\)/g, `“${last}”`),
    };
  }
  return parsed;
}

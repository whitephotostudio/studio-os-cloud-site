// Studio Assistant — plan builder (Phase 4).
//
// Converts a user command into an AssistantExecutionPlan.  Strategy:
//   1. First try the deterministic template library.  Templates are the
//      safest path — they use only allowlisted intents and fixed shapes.
//   2. If no template matches, try the LLM to decompose the command into
//      ordered steps.  Every step is validated against the allowlist.
//   3. If the LLM is unavailable or produces nothing safe, fall back to a
//      single-step plan derived from the Phase 3 single-intent parser.

import {
  AssistantExecutionPlan,
  AssistantPlannedStep,
} from "@/lib/studio-assistant/plan-types";
import {
  StudioAssistantIntent,
  isWriteIntent,
} from "@/lib/studio-assistant/types";
import { matchWorkflowTemplate } from "@/lib/studio-assistant/templates";
import { parseAssistantCommand } from "@/lib/studio-assistant/mock-parser";
import { parseWithLlmOrFallback } from "./llm-parser";

const SUPPORTED_INTENTS: ReadonlySet<StudioAssistantIntent> = new Set([
  "create_school",
  "update_school_dates",
  "assign_package_profile",
  "release_school_gallery",
  "toggle_school_access",
  "find_school",
  "find_student",
  "list_new_orders",
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
  "review_gallery_coverage",
  "highlight_popular_media",
  "suggest_upsell_sizes",
  "suggest_gallery_cover",
]);

const PLAN_SYSTEM_PROMPT = `You are Studio Assistant. Break a photographer's command
into an ORDERED list of small steps drawn from an allowlist of intents.
Return JSON: { "steps": [{ "intent": string, "summary": string, "params": object }], "summary": string, "confidence": number }.

Allowed intents:
- create_school { school_name, event_date? (YYYY-MM-DD) }
- update_school_dates { school_name, new_date (YYYY-MM-DD) }
- assign_package_profile { source_school, destination_school }
- release_school_gallery { school_name, release_on? (YYYY-MM-DD) }
- toggle_school_access { school_name, access_enabled: boolean }
- find_school { query }
- find_student { query }
- list_new_orders { since? (YYYY-MM-DD) }

Rules:
- Do not invent new intents. If the command cannot be safely decomposed, return steps=[].
- Keep to at most 5 steps.
- Each summary must be one short sentence.
- Confidence: 0 if unsure, 1 if explicit.
- Reply with JSON ONLY.`;

type LlmPlanShape = {
  steps?: Array<{
    intent?: unknown;
    summary?: unknown;
    params?: unknown;
  }>;
  summary?: unknown;
  confidence?: unknown;
};

/* -------------------------------------------------------------------------- */
/*  Public entry                                                              */
/* -------------------------------------------------------------------------- */

export type BuildPlanOptions = {
  contextHints?: { lastSchoolName?: string | null };
};

export async function buildAssistantPlan(
  command: string,
  options: BuildPlanOptions = {},
): Promise<AssistantExecutionPlan> {
  const originalPrompt = command.trim();

  // 1. Try deterministic templates first.
  const templateSteps = matchWorkflowTemplate(originalPrompt);
  if (templateSteps && templateSteps.length) {
    return buildPlanFromSteps(
      originalPrompt,
      templateSteps,
      "Template match: deterministic multi-step plan.",
      0.95,
    );
  }

  // 2. Try the LLM.
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      const llmSteps = await callPlanLlm(apiKey, originalPrompt);
      if (llmSteps && llmSteps.length) {
        return buildPlanFromSteps(
          originalPrompt,
          llmSteps,
          "Plan drafted from LLM decomposition.",
          typeof llmSteps[0] !== "undefined" ? 0.8 : 0.6,
        );
      }
    }
  } catch (err) {
    console.error("[studio-assistant] plan-builder LLM failed:", err);
  }

  // 3. Fallback: single-intent plan via the Phase 3 parser.
  const single = await parseWithLlmOrFallback(originalPrompt, {
    contextHints: options.contextHints,
  });
  if (single.intent) {
    const step: AssistantPlannedStep = {
      stepId: "single",
      intent: single.intent,
      summary: single.summary,
      params: single.params,
      requiresConfirmation: isWriteIntent(single.intent),
      status: "pending",
    };
    return buildPlanFromSteps(
      originalPrompt,
      [step],
      single.summary,
      single.confidence,
      single.errors,
    );
  }

  // 4. Nothing matched.
  const fallback = parseAssistantCommand(originalPrompt);
  return {
    originalPrompt,
    steps: [],
    summary:
      fallback.summary ??
      "Studio Assistant couldn't decompose this command into supported steps.",
    confidence: 0.1,
    requiresConfirmation: false,
    errors: fallback.errors ?? ["No supported intent detected."],
  };
}

function buildPlanFromSteps(
  originalPrompt: string,
  steps: AssistantPlannedStep[],
  summary: string,
  confidence: number,
  errors?: string[],
): AssistantExecutionPlan {
  return {
    originalPrompt,
    steps: steps.map((s, i) => ({
      ...s,
      stepId: s.stepId || `step-${i + 1}`,
      status: "pending",
    })),
    summary,
    confidence,
    requiresConfirmation: steps.some((s) => s.requiresConfirmation),
    errors,
  };
}

/* -------------------------------------------------------------------------- */
/*  LLM                                                                        */
/* -------------------------------------------------------------------------- */

async function callPlanLlm(
  apiKey: string,
  command: string,
): Promise<AssistantPlannedStep[] | null> {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: PLAN_SYSTEM_PROMPT },
          { role: "user", content: command },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 800,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    if (!content) return null;
    const raw = JSON.parse(content) as LlmPlanShape;
    return validatePlanSteps(raw);
  } finally {
    clearTimeout(timeout);
  }
}

function validatePlanSteps(raw: LlmPlanShape): AssistantPlannedStep[] | null {
  if (!raw || !Array.isArray(raw.steps)) return null;
  const out: AssistantPlannedStep[] = [];
  for (let i = 0; i < raw.steps.length && i < 5; i += 1) {
    const s = raw.steps[i];
    const intentStr = typeof s.intent === "string" ? s.intent : null;
    if (!intentStr) continue;
    if (!SUPPORTED_INTENTS.has(intentStr as StudioAssistantIntent)) continue;
    const intent = intentStr as StudioAssistantIntent;
    const summary =
      typeof s.summary === "string" && s.summary.trim()
        ? s.summary.trim()
        : `Step ${i + 1}: ${intent}`;
    const paramsRaw =
      s.params && typeof s.params === "object" && !Array.isArray(s.params)
        ? (s.params as Record<string, unknown>)
        : {};
    out.push({
      stepId: `llm-${i + 1}`,
      intent,
      summary,
      params: paramsRaw,
      requiresConfirmation: isWriteIntent(intent),
      status: "pending",
    });
  }
  return out.length ? out : null;
}

// Studio Assistant — workflow templates (Phase 4).
//
// A template maps a human phrase ("set up a new school for Maple Creek on
// May 10") to a predefined multi-step plan.  Templates are deterministic
// and do not need the LLM — they're the safest path for common workflows.

import { StudioAssistantIntent, isWriteIntent } from "./types";
import { AssistantPlannedStep } from "./plan-types";

function makeStep(
  stepId: string,
  intent: StudioAssistantIntent,
  params: Record<string, unknown>,
  summary: string,
): AssistantPlannedStep {
  return {
    stepId,
    intent,
    params,
    summary,
    requiresConfirmation: isWriteIntent(intent),
    status: "pending",
  };
}

export type WorkflowTemplate = {
  id: string;
  label: string;
  description: string;
  /**
   * Returns a list of step blueprints, or null if this template does not
   * match the command.  Templates are intentionally forgiving — callers
   * pick the first match.
   */
  match: (command: string) => AssistantPlannedStep[] | null;
};

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Extract a capitalized school name sequence — same shape used by the
 * deterministic single-step parser, duplicated here so templates don't
 * import the larger parser file.
 */
function extractSchoolName(text: string): string | null {
  const forMatch = text.match(
    /\bfor\s+([A-Z][\w.'&-]*(?:\s+[A-Z][\w.'&-]*){0,4})/,
  );
  if (forMatch?.[1]) return clean(forMatch[1]);
  const trailingMatch = text.match(
    /\b([A-Z][\w.'&-]*(?:\s+[A-Z][\w.'&-]*){0,3})\s+(?:school|elementary|academy|high|middle)\b/,
  );
  if (trailingMatch?.[1]) return clean(trailingMatch[1]);
  return null;
}

function extractIsoDate(text: string, now: Date = new Date()): string | null {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const months: Record<string, number> = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
    aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9,
    nov: 10, november: 10, dec: 11, december: 11,
  };
  const m = text.toLowerCase().match(
    /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/,
  );
  if (m) {
    const month = months[m[1]];
    const day = Number.parseInt(m[2] ?? "", 10);
    const year = m[3] ? Number.parseInt(m[3], 10) : now.getFullYear();
    if (Number.isFinite(day) && day > 0 && day <= 31) {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${year}-${pad(month + 1)}-${pad(day)}`;
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Template library                                                          */
/* -------------------------------------------------------------------------- */

const TEMPLATES: WorkflowTemplate[] = [
  {
    id: "setup_new_school",
    label: "Set up a new school",
    description:
      "Create the school, (optionally) copy pricing from a source school, and keep it in pre-release until you explicitly release it.",
    match: (command) => {
      const looksLikeSetup =
        /\b(set up|setup|create|new)\b.*\bschool\b/i.test(command) &&
        /\b(assign|apply|copy|pricing|package|pre[-\s]?release)\b/i.test(command);
      if (!looksLikeSetup) return null;
      const schoolName = extractSchoolName(command);
      if (!schoolName) return null;
      const date = extractIsoDate(command);
      const sourceMatch = command.match(
        /\bfrom\s+([A-Z][\w.'&-]*(?:\s+[A-Z][\w.'&-]*){0,4})/,
      );
      const steps: AssistantPlannedStep[] = [
        makeStep(
          "create",
          "create_school",
          { school_name: schoolName, ...(date ? { event_date: date } : {}) },
          `Create school “${schoolName}”${date ? ` for ${date}` : ""}.`,
        ),
      ];
      if (sourceMatch?.[1]) {
        steps.push(
          makeStep(
            "assign",
            "assign_package_profile",
            {
              source_school: clean(sourceMatch[1]),
              destination_school: schoolName,
            },
            `Copy pricing from “${clean(sourceMatch[1])}” to “${schoolName}”.`,
          ),
        );
      }
      return steps;
    },
  },
  {
    id: "release_and_review",
    label: "Release gallery and review orders",
    description: "Release the named school gallery, then show today's orders.",
    match: (command) => {
      const looksLike =
        /\brelease\b.*\bgallery\b/i.test(command) &&
        /\b(orders?|order review)\b/i.test(command);
      if (!looksLike) return null;
      const schoolName = extractSchoolName(command);
      if (!schoolName) return null;
      return [
        makeStep(
          "release",
          "release_school_gallery",
          { school_name: schoolName },
          `Release “${schoolName}” gallery.`,
        ),
        makeStep(
          "list-orders",
          "list_new_orders",
          { since: new Date().toISOString().slice(0, 10) },
          "Show today's new orders.",
        ),
      ];
    },
  },
];

export function matchWorkflowTemplate(
  command: string,
): AssistantPlannedStep[] | null {
  for (const template of TEMPLATES) {
    const steps = template.match(command);
    if (steps && steps.length) return steps;
  }
  return null;
}

export function listWorkflowTemplates() {
  return TEMPLATES.map((t) => ({
    id: t.id,
    label: t.label,
    description: t.description,
  }));
}

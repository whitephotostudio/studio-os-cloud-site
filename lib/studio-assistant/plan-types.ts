// Studio Assistant — multi-step plan shapes (Phase 4).
//
// A "plan" is a small, fully-specified list of single-intent actions that
// will be executed in order.  Plans are ALWAYS composed of the same
// allowlisted intents Phase 2 already supports — never something new.

import { StudioAssistantIntent } from "./types";

export type PlannedStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type AssistantPlannedStep = {
  stepId: string;
  intent: StudioAssistantIntent;
  summary: string;
  params: Record<string, unknown>;
  requiresConfirmation: boolean;
  status?: PlannedStepStatus;
  /** Filled by the executor once the step completes. */
  result?: {
    ok: boolean;
    message: string;
    data?: Record<string, unknown>;
  };
};

export type AssistantExecutionPlan = {
  originalPrompt: string;
  steps: AssistantPlannedStep[];
  summary: string;
  confidence: number;
  /** The plan as a whole requires confirmation if any step does. */
  requiresConfirmation: boolean;
  /** Soft errors / gaps discovered while building the plan. */
  errors?: string[];
};

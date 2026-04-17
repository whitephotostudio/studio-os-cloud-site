// POST /api/studio-assistant/plan/run
//
// Executes an already-previewed AssistantExecutionPlan step-by-step.
// Server behaviour:
//   1. Authenticate the user and resolve photographer_id.
//   2. Re-validate every step against the allowlisted intents (the client's
//      plan is never trusted — we rebuild it and cross-check).
//   3. Require `confirmed === true` from the client for the entire plan
//      AND refuse any step that requires per-step confirmation unless the
//      plan was explicitly confirmed.
//   4. Execute steps in order.  If a step fails, stop safely and return
//      {ok:false, stoppedAt, steps} with honest partial completion.
//   5. Log every executed step (and the rejection / failure) in
//      ai_action_logs.

import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { executeAssistantAction } from "@/lib/studio-assistant/server/executor";
import { buildAssistantPlan } from "@/lib/studio-assistant/server/plan-builder";
import {
  AssistantExecutionPlan,
  AssistantPlannedStep,
  PlannedStepStatus,
} from "@/lib/studio-assistant/plan-types";
import {
  StudioAssistantIntent,
  isWriteIntent,
} from "@/lib/studio-assistant/types";

export const dynamic = "force-dynamic";

type RunPlanBody = {
  command?: string;
  /** The plan the UI has shown to the user.  Cross-checked on the server. */
  plan?: AssistantExecutionPlan;
  confirmed?: boolean;
  contextHints?: { lastSchoolName?: string | null };
};

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

async function logStep(params: {
  service: ReturnType<typeof createDashboardServiceClient>;
  photographerId: string;
  userId: string;
  commandText: string;
  step: AssistantPlannedStep;
  durationMs: number;
  status: "succeeded" | "rejected" | "failed";
}) {
  try {
    await params.service.from("ai_action_logs").insert({
      photographer_id: params.photographerId,
      user_id: params.userId,
      intent: params.step.intent,
      status: params.status,
      command_text: `${params.commandText} :: step ${params.step.stepId}`,
      params: params.step.params,
      confidence: null,
      requires_confirmation: params.step.requiresConfirmation,
      confirmed: true,
      result:
        params.step.result && params.step.result.ok
          ? params.step.result.data ?? {}
          : null,
      error_message:
        params.step.result && !params.step.result.ok
          ? params.step.result.message
          : null,
      duration_ms: params.durationMs,
    });
  } catch (err) {
    console.error("[studio-assistant] plan step log failed:", err);
  }
}

export async function POST(request: NextRequest) {
  let body: RunPlanBody = {};
  try {
    body = (await request.json()) as RunPlanBody;
  } catch {
    return NextResponse.json(
      { ok: false, message: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const command = typeof body.command === "string" ? body.command.trim() : "";
  if (!command) {
    return NextResponse.json(
      { ok: false, message: "Missing command text." },
      { status: 400 },
    );
  }
  if (!body.confirmed) {
    return NextResponse.json(
      { ok: false, message: "Plan must be confirmed before running." },
      { status: 422 },
    );
  }

  const { user } = await resolveDashboardAuth(request);
  if (!user) {
    return NextResponse.json(
      { ok: false, message: "Please sign in again." },
      { status: 401 },
    );
  }

  const service = createDashboardServiceClient();

  const { data: photographerRow, error: photographerError } = await service
    .from("photographers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (photographerError) {
    return NextResponse.json(
      {
        ok: false,
        message: photographerError.message || "Photographer lookup failed.",
      },
      { status: 500 },
    );
  }
  const photographerId = (photographerRow?.id as string | undefined) ?? null;
  if (!photographerId) {
    return NextResponse.json(
      { ok: false, message: "Photographer profile not found." },
      { status: 404 },
    );
  }

  // Always rebuild the plan server-side — client plans are advisory only.
  const serverPlan = await buildAssistantPlan(command, {
    contextHints: body.contextHints ?? undefined,
  });

  if (!serverPlan.steps.length) {
    return NextResponse.json(
      {
        ok: false,
        message:
          serverPlan.errors?.[0] ??
          "No supported steps detected in this command.",
        plan: serverPlan,
      },
      { status: 422 },
    );
  }

  // Cross-check the client plan (if sent) against the server plan.  If the
  // intents or ordering differ, refuse — the user's preview would no longer
  // match what the server would execute.
  if (body.plan && Array.isArray(body.plan.steps)) {
    const clientIntents = body.plan.steps.map((s) => s.intent).join(">");
    const serverIntents = serverPlan.steps.map((s) => s.intent).join(">");
    if (clientIntents && clientIntents !== serverIntents) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Plan changed since preview. Please review and try again.",
          plan: serverPlan,
          reason: "mismatch",
        },
        { status: 409 },
      );
    }
  }

  // Execute steps in order.  Each write step also requires the plan-level
  // confirmation flag (checked above).  We capture per-step results.
  const executed: AssistantPlannedStep[] = [];
  let stoppedAt: number | null = null;

  for (let i = 0; i < serverPlan.steps.length; i += 1) {
    const step = {
      ...serverPlan.steps[i],
      status: "running" as PlannedStepStatus,
    };

    // Belt-and-suspenders: reject any step whose intent slipped through.
    if (!SUPPORTED_INTENTS.has(step.intent)) {
      step.status = "skipped";
      step.result = { ok: false, message: "Unsupported intent." };
      executed.push(step);
      stoppedAt = i;
      await logStep({
        service,
        photographerId,
        userId: user.id,
        commandText: command,
        step,
        durationMs: 0,
        status: "rejected",
      });
      break;
    }

    const stepStart = Date.now();
    const result = await executeAssistantAction(
      {
        service,
        photographerId,
        userId: user.id,
      },
      {
        intent: step.intent,
        params: step.params,
        // A write step in a plan only runs if the plan itself was
        // confirmed.  We already checked body.confirmed above.
        confirmed: isWriteIntent(step.intent) ? true : false,
      },
    );
    const stepDuration = Date.now() - stepStart;

    if (result.ok) {
      step.status = "completed";
      step.result = {
        ok: true,
        message: result.message,
        data: result.data,
      };
      executed.push(step);
      await logStep({
        service,
        photographerId,
        userId: user.id,
        commandText: command,
        step,
        durationMs: stepDuration,
        status: "succeeded",
      });
    } else {
      step.status = "failed";
      step.result = { ok: false, message: result.message };
      executed.push(step);
      await logStep({
        service,
        photographerId,
        userId: user.id,
        commandText: command,
        step,
        durationMs: stepDuration,
        status: "failed",
      });
      stoppedAt = i;
      break;
    }
  }

  const remaining = serverPlan.steps.slice(executed.length).map(
    (s): AssistantPlannedStep => ({ ...s, status: "skipped" }),
  );
  const finalSteps = [...executed, ...remaining];
  const allOk = stoppedAt === null;

  return NextResponse.json({
    ok: allOk,
    message: allOk
      ? "All plan steps completed."
      : `Stopped at step ${(stoppedAt ?? 0) + 1} of ${serverPlan.steps.length}.`,
    stoppedAt,
    plan: {
      ...serverPlan,
      steps: finalSteps,
    },
  });
}

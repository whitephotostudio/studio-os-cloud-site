// POST /api/studio-assistant/run
//
// Secure entry point for Phase 2 Studio Assistant execution.
// Pipeline:
//   1. Resolve authenticated user (bearer or cookie).
//   2. Look up the photographer_id scoped to that user.
//   3. Re-parse the raw command server-side (we never trust the client
//      intent/params blindly).
//   4. If the client-supplied intent differs from the server parse, reject
//      (prevents a tampered client from executing a different action than
//      what the user saw in the panel).
//   5. Enforce confirmation for write intents.
//   6. Dispatch to the executor.
//   7. Log the attempt in ai_action_logs regardless of outcome.
//   8. Return a safe result envelope.

import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { parseAssistantCommand } from "@/lib/studio-assistant/mock-parser";
import { parseWithLlmOrFallback } from "@/lib/studio-assistant/server/llm-parser";
import {
  StudioAssistantIntent,
  isWriteIntent,
} from "@/lib/studio-assistant/types";
import { executeAssistantAction } from "@/lib/studio-assistant/server/executor";

export const dynamic = "force-dynamic";

type RunRequestBody = {
  command?: string;
  /** Client-side parse, used for cross-checking with the server parse. */
  intent?: string | null;
  params?: Record<string, unknown> | null;
  confirmed?: boolean;
  contextHints?: {
    lastSchoolName?: string | null;
  };
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

function isSupportedIntent(
  value: unknown,
): value is StudioAssistantIntent {
  return typeof value === "string" && SUPPORTED_INTENTS.has(value as StudioAssistantIntent);
}

function safeJson(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

type LogResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; message: string };

async function writeLog(params: {
  service: ReturnType<typeof createDashboardServiceClient>;
  photographerId: string | null;
  userId: string;
  commandText: string;
  intent: string | null;
  confidence: number | null;
  requiresConfirmation: boolean;
  confirmed: boolean;
  params: Record<string, unknown>;
  result: LogResult | null;
  durationMs: number;
  status: "succeeded" | "rejected" | "failed";
}) {
  try {
    await params.service.from("ai_action_logs").insert({
      photographer_id: params.photographerId,
      user_id: params.userId,
      intent: params.intent ?? "unknown",
      status: params.status,
      command_text: params.commandText,
      params: params.params,
      confidence: params.confidence,
      requires_confirmation: params.requiresConfirmation,
      confirmed: params.confirmed,
      result:
        params.result && params.result.ok ? params.result.data : null,
      error_message:
        params.result && !params.result.ok ? params.result.message : null,
      duration_ms: params.durationMs,
    });
  } catch (err) {
    // Logging is best-effort — do NOT fail the user-facing request because
    // of a log insert failure.  We still surface it in the server console.
    console.error("[studio-assistant] ai_action_logs insert failed:", err);
  }
}

export async function POST(request: NextRequest) {
  const start = Date.now();

  let body: RunRequestBody = {};
  try {
    body = (await request.json()) as RunRequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, message: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const commandText = typeof body.command === "string" ? body.command.trim() : "";
  const confirmed = body.confirmed === true;
  const clientIntent = body.intent ?? null;
  const clientParams = safeJson(body.params ?? {});

  if (!commandText) {
    return NextResponse.json(
      { ok: false, message: "Missing command text." },
      { status: 400 },
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
      { ok: false, message: photographerError.message || "Photographer lookup failed." },
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

  // Re-parse the command server-side.  The client parse is only used as a
  // cross-check; the server parse is the source of truth for execution.
  // Phase 3: prefer the LLM parser (with deterministic fallback).  If the
  // LLM is unreachable or returns garbage, we already fall back inside
  // parseWithLlmOrFallback, but we also belt-and-suspender here.
  let parsed = await parseWithLlmOrFallback(commandText, {
    contextHints: body.contextHints
      ? { lastSchoolName: body.contextHints.lastSchoolName ?? null }
      : undefined,
  });
  if (!parsed) parsed = parseAssistantCommand(commandText);
  const serverIntent = parsed.intent;

  const requiresConfirmation = isWriteIntent(serverIntent);

  // Helper so every early return still writes an audit log.
  async function reject(
    status: 400 | 401 | 403 | 404 | 409 | 422,
    message: string,
    reason: "unsupported" | "mismatch" | "validation" | "not_confirmed",
  ) {
    await writeLog({
      service,
      photographerId,
      userId: user!.id,
      commandText,
      intent: serverIntent ?? (clientIntent ?? null),
      confidence: parsed.confidence,
      requiresConfirmation,
      confirmed,
      params: parsed.params,
      result: { ok: false, message },
      durationMs: Date.now() - start,
      status: "rejected",
    });
    return NextResponse.json(
      { ok: false, message, reason, parsed },
      { status },
    );
  }

  if (!serverIntent || !isSupportedIntent(serverIntent)) {
    return reject(
      422,
      "Studio Assistant couldn't match this to a supported action.",
      "unsupported",
    );
  }

  // Defence-in-depth: if the client claims a different intent than the
  // server parse, refuse.  The user would have seen the server intent in
  // the panel preview, so anything else is suspect.
  if (clientIntent && clientIntent !== serverIntent) {
    return reject(
      409,
      "Command interpretation changed since preview. Please review and try again.",
      "mismatch",
    );
  }

  if (requiresConfirmation && !confirmed) {
    return reject(
      422,
      "Write actions require on-screen confirmation before running.",
      "not_confirmed",
    );
  }

  // Merge params — prefer server-parsed values (the source of truth), but
  // allow the client to pass through params the parser doesn't extract yet.
  const mergedParams: Record<string, unknown> = {
    ...clientParams,
    ...parsed.params,
  };

  const result = await executeAssistantAction(
    {
      service,
      photographerId,
      userId: user.id,
    },
    {
      intent: serverIntent,
      params: mergedParams,
      confirmed,
    },
  );

  await writeLog({
    service,
    photographerId,
    userId: user.id,
    commandText,
    intent: serverIntent,
    confidence: parsed.confidence,
    requiresConfirmation,
    confirmed,
    params: mergedParams,
    result,
    durationMs: Date.now() - start,
    status: result.ok ? "succeeded" : "failed",
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: result.message,
        intent: serverIntent,
        parsed,
      },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    intent: serverIntent,
    message: result.message,
    data: result.data,
    parsed,
  });
}

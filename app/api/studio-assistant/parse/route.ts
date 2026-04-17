// POST /api/studio-assistant/parse
//
// Returns a parsed preview of a command WITHOUT executing anything.
// The UI hits this first so the panel can show an intent + confidence +
// extracted params before the user decides to Run.
//
// This route never touches studio data.  It only:
//   1. authenticates the user
//   2. runs the LLM parser (falling back to deterministic parsing)
//   3. returns the shape the UI already understands.

import { NextRequest, NextResponse } from "next/server";
import { resolveDashboardAuth } from "@/lib/dashboard-auth";
import { parseAssistantCommand } from "@/lib/studio-assistant/mock-parser";
import { parseWithLlmOrFallback } from "@/lib/studio-assistant/server/llm-parser";

export const dynamic = "force-dynamic";

type ParseBody = {
  command?: string;
  contextHints?: {
    lastSchoolName?: string | null;
  };
};

export async function POST(request: NextRequest) {
  let body: ParseBody = {};
  try {
    body = (await request.json()) as ParseBody;
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

  // Auth — we don't talk to Supabase here, but we still require the user to
  // be signed in so unauthenticated traffic can't burn LLM credits.
  const { user } = await resolveDashboardAuth(request);
  if (!user) {
    return NextResponse.json(
      { ok: false, message: "Please sign in again." },
      { status: 401 },
    );
  }

  // Primary: LLM with deterministic fallback baked in.
  const parsed = await parseWithLlmOrFallback(command, {
    contextHints: body.contextHints
      ? {
          lastSchoolName: body.contextHints.lastSchoolName ?? null,
        }
      : undefined,
  });

  // Last-ditch safety net — if something weird happened and the parser
  // returned a totally empty result, hand back a deterministic parse so the
  // UI never sees a null response.
  if (!parsed) {
    return NextResponse.json({ ok: true, parsed: parseAssistantCommand(command) });
  }

  return NextResponse.json({ ok: true, parsed });
}

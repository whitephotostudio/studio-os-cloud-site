// POST /api/studio-assistant/plan
// Returns a preview-only AssistantExecutionPlan for a command.  No writes.

import { NextRequest, NextResponse } from "next/server";
import { resolveDashboardAuth } from "@/lib/dashboard-auth";
import { buildAssistantPlan } from "@/lib/studio-assistant/server/plan-builder";

export const dynamic = "force-dynamic";

type PlanBody = {
  command?: string;
  contextHints?: {
    lastSchoolName?: string | null;
  };
};

export async function POST(request: NextRequest) {
  let body: PlanBody = {};
  try {
    body = (await request.json()) as PlanBody;
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

  const { user } = await resolveDashboardAuth(request);
  if (!user) {
    return NextResponse.json(
      { ok: false, message: "Please sign in again." },
      { status: 401 },
    );
  }

  const plan = await buildAssistantPlan(command, {
    contextHints: body.contextHints
      ? { lastSchoolName: body.contextHints.lastSchoolName ?? null }
      : undefined,
  });

  return NextResponse.json({ ok: true, plan });
}

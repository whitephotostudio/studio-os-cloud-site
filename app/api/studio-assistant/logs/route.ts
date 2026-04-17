// GET /api/studio-assistant/logs
//
// Returns the most recent ai_action_logs rows for the signed-in photographer
// so the debug page can tail what the assistant has been doing.  Read-only,
// scoped by photographer_id on the server — the RLS policy on the table
// already allows clients to read their own rows, but we use the service
// client here for consistency with the rest of the dashboard API surface.

import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(request: NextRequest) {
  const { user } = await resolveDashboardAuth(request);
  if (!user) {
    return NextResponse.json(
      { ok: false, message: "Please sign in again." },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(MAX_LIMIT, limitRaw))
    : DEFAULT_LIMIT;

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
    return NextResponse.json({ ok: true, rows: [] });
  }

  const { data, error } = await service
    .from("ai_action_logs")
    .select(
      "id,intent,status,command_text,params,confidence,requires_confirmation,confirmed,result,error_message,duration_ms,created_at",
    )
    .eq("photographer_id", photographerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    // If the migration hasn't been applied the table won't exist — respond
    // with a clear message instead of a 500 so the debug page can explain
    // what to do.
    return NextResponse.json(
      {
        ok: false,
        message:
          error.message ||
          "ai_action_logs query failed. Is the Phase 2 migration applied?",
        hint: "Run `supabase db push` or apply supabase/migrations/20260417120000_create_ai_action_logs.sql in the Supabase SQL editor.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, rows: data ?? [] });
}

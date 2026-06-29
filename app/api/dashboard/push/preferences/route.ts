import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

// Read / update the photographer's push-notification preferences.
// Currently a single flag: order_push_show_details — when false (default) the
// new-order banner is a generic "New order received."; when true it includes
// the client name + amount.

async function resolvePhotographer(request: NextRequest) {
  const auth = await resolveDashboardAuth(request);
  if (!auth.user) return { error: "Unauthorized" as const, status: 401 };
  const service = createDashboardServiceClient();
  const { data: photographer } = await service
    .from("photographers")
    .select("id, order_push_show_details")
    .eq("user_id", auth.user.id)
    .maybeSingle<{ id: string; order_push_show_details: boolean | null }>();
  if (!photographer?.id) {
    return { error: "Photographer profile not found." as const, status: 403 };
  }
  return { service, photographer };
}

export async function GET(request: NextRequest) {
  const ctx = await resolvePhotographer(request);
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }
  return NextResponse.json({
    showDetails: Boolean(ctx.photographer.order_push_show_details),
  });
}

export async function POST(request: NextRequest) {
  const ctx = await resolvePhotographer(request);
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  let body: { showDetails?: unknown };
  try {
    body = (await request.json()) as { showDetails?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const showDetails = body.showDetails === true;

  const { error } = await ctx.service
    .from("photographers")
    .update({ order_push_show_details: showDetails })
    .eq("id", ctx.photographer.id);
  if (error) {
    console.error("[push/preferences] update failed", error);
    return NextResponse.json(
      { error: "Could not save preference." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, showDetails });
}

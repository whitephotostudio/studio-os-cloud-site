import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

async function context(request: NextRequest) {
  const auth = await resolveDashboardAuth(request);
  if (!auth.user) return { response: NextResponse.json({ error: "Sign in to change backdrop settings." }, { status: 401 }) };
  if (!auth.mfaSatisfied) return { response: NextResponse.json({ error: "Complete two-step verification before changing backdrop settings." }, { status: 403 }) };
  const service = createDashboardServiceClient();
  const { data: photographer, error } = await service.from("photographers")
    .select("id,online_backdrops_enabled").eq("user_id", auth.user.id)
    .maybeSingle<{ id: string; online_backdrops_enabled: boolean }>();
  if (error) throw error;
  if (!photographer?.id) return { response: NextResponse.json({ error: "Photographer profile not found." }, { status: 403 }) };
  return { service, photographer, userId: auth.user.id };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await context(request);
    if (ctx.response) return ctx.response;
    return NextResponse.json({ onlineBackdropsEnabled: ctx.photographer.online_backdrops_enabled });
  } catch (error) {
    console.error("[backdrop-settings:get]", error);
    return NextResponse.json({ error: "Could not load online backdrop settings. Please try again." }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await context(request);
    if (ctx.response) return ctx.response;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      typeof body.onlineBackdropsEnabled !== "boolean" ||
      ("expectedOnlineBackdropsEnabled" in body && typeof body.expectedOnlineBackdropsEnabled !== "boolean") ||
      Object.keys(body).some(key => !["onlineBackdropsEnabled", "expectedOnlineBackdropsEnabled"].includes(key))) {
      return NextResponse.json({ error: "Choose On or Off for online background changes." }, { status: 400 });
    }
    let update = ctx.service.from("photographers")
      .update({ online_backdrops_enabled: body.onlineBackdropsEnabled })
      .eq("id", ctx.photographer.id).eq("user_id", ctx.userId);
    if (typeof body.expectedOnlineBackdropsEnabled === "boolean") {
      update = update.eq("online_backdrops_enabled", body.expectedOnlineBackdropsEnabled);
    }
    const { data, error } = await update.select("online_backdrops_enabled").maybeSingle<{ online_backdrops_enabled: boolean }>();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "This setting changed in another tab. Reload before saving again." }, { status: 409 });
    return NextResponse.json({ ok: true, onlineBackdropsEnabled: data.online_backdrops_enabled });
  } catch (error) {
    console.error("[backdrop-settings:patch]", error);
    return NextResponse.json({ error: "Could not save online backdrop settings. Please try again." }, { status: 503 });
  }
}

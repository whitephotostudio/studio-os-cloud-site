import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/lib/api-validation";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";
import { normalizeProofWatermarkOpacity } from "@/lib/proof-watermark";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  opacity: z.number().finite().nullable(),
  enabled: z.boolean(),
  logoUrl: z.string().trim().max(8192),
}).strict();

async function ownerContext(request: NextRequest) {
  const auth = await resolveDashboardAuth(request);
  if (!auth.user) return { response: NextResponse.json({ ok: false, message: "Sign in to edit your watermark." }, { status: 401 }) };
  if (auth.mfaSatisfied === false) return { response: NextResponse.json({ ok: false, message: "Complete two-factor verification before editing your watermark." }, { status: 403 }) };
  const service = createDashboardServiceClient();
  const { data: photographer, error } = await service.from("photographers")
    .select("id,watermark_opacity,watermark_enabled,watermark_logo_url").eq("user_id", auth.user.id).maybeSingle();
  if (error) throw error;
  if (!photographer) return { response: NextResponse.json({ ok: false, message: "Photographer profile not found." }, { status: 403 }) };
  return { service, photographer, userId: auth.user.id };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await ownerContext(request);
    if ("response" in ctx) return ctx.response;
    return NextResponse.json({ ok: true, opacity: normalizeProofWatermarkOpacity(ctx.photographer.watermark_opacity) }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({ ok: false, message: "Could not load watermark settings." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await ownerContext(request);
    if ("response" in ctx) return ctx.response;
    const parsed = await parseJson(request, BodySchema);
    if (!parsed.ok) return parsed.response;
    const opacity = normalizeProofWatermarkOpacity(parsed.data.opacity);
    const { data, error } = await ctx.service.from("photographers").update({
      watermark_opacity: opacity, watermark_enabled: parsed.data.enabled, watermark_logo_url: parsed.data.logoUrl,
    }).eq("id", ctx.photographer.id).eq("user_id", ctx.userId).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ ok: false, message: "Photographer access changed. Sign in again." }, { status: 403 });
    return NextResponse.json({ ok: true, opacity }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({ ok: false, message: "Could not save watermark settings. Please retry." }, { status: 503 });
  }
}

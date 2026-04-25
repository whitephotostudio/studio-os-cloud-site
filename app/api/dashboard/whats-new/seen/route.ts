// POST /api/dashboard/whats-new/seen
// GET  /api/dashboard/whats-new/seen
//
// Tracks which "what's new" feature dots a photographer has dismissed.
// Append-only.  Never reveals raw photographer data.
//
// GET  → { ok, seen: string[] }
// POST → { featureId } → { ok }   (idempotent — repeat calls are no-op)

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";

export const dynamic = "force-dynamic";

const PostBodySchema = z.object({
  featureId: z.string().trim().min(1).max(120),
});

async function loadPhotographer(request: NextRequest) {
  const { user } = await resolveDashboardAuth(request);
  if (!user?.id) return null;
  const service = createDashboardServiceClient();
  const { data } = await service
    .from("photographers")
    .select("id, seen_features")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data?.id) return null;
  return {
    service,
    photographerId: data.id as string,
    seen: Array.isArray(data.seen_features)
      ? (data.seen_features as string[])
      : [],
  };
}

export async function GET(request: NextRequest) {
  const ctx = await loadPhotographer(request);
  if (!ctx) {
    return NextResponse.json(
      { ok: false, message: "Sign in as a photographer.", seen: [] },
      { status: 401 },
    );
  }
  return NextResponse.json({ ok: true, seen: ctx.seen });
}

export async function POST(request: NextRequest) {
  const ctx = await loadPhotographer(request);
  if (!ctx) {
    return NextResponse.json(
      { ok: false, message: "Sign in as a photographer." },
      { status: 401 },
    );
  }

  const parsed = await parseJson(request, PostBodySchema);
  if (!parsed.ok) return parsed.response;
  const { featureId } = parsed.data;

  // Idempotent: if already seen, skip the write.
  if (ctx.seen.includes(featureId)) {
    return NextResponse.json({ ok: true, alreadySeen: true });
  }

  const nextSeen = [...ctx.seen, featureId];
  const { error } = await ctx.service
    .from("photographers")
    .update({ seen_features: nextSeen })
    .eq("id", ctx.photographerId);
  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

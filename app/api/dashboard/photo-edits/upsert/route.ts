// 2026-04-27 — Upsert one photo's Develop edits to the cloud mirror.
//
// Body shape:
//   { canonical_path: string, adjustments_json: object, hash: string }
//
// Response:
//   { ok: true, updated_at: string }
//
// Called by Flutter's PhotoEditsCloudService whenever a sidecar
// JSON is saved (debounced ~2s on the client side).  Source of
// truth stays local — this is best-effort.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

import { guardAgreement } from "@/lib/require-agreement";

export const runtime = "nodejs";

const Body = z.object({
  canonical_path: z.string().min(1).max(1024),
  adjustments_json: z.record(z.string(), z.any()),
  hash: z.string().min(8).max(128),
});

export async function POST(req: NextRequest) {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !anonKey || !serviceKey) {
    return NextResponse.json(
      { ok: false, error: "Server misconfigured" },
      { status: 500 },
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return NextResponse.json(
      { ok: false, error: "Missing Authorization" },
      { status: 401 },
    );
  }
  const token = auth.slice(7).trim();

  // Resolve user via the user-token client.
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } =
    await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return NextResponse.json(
      { ok: false, error: "Invalid token" },
      { status: 401 },
    );
  }

  // Resolve photographer_id.
  const service = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
  const { data: pgRow } = await service
    .from("photographers")
    .select("id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  const photographerId = pgRow?.id as string | undefined;
  if (!photographerId) {
    return NextResponse.json(
      { ok: false, error: "No photographer profile" },
      { status: 403 },
    );
  }

  // Agreement gate.
  const guard = await guardAgreement({
    service,
    userId: userData.user.id,
  });
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  // Validate body.
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "Bad request" },
      { status: 400 },
    );
  }

  const { canonical_path, adjustments_json, hash } = body;

  const { data, error } = await service
    .from("photo_edits")
    .upsert(
      {
        photographer_id: photographerId,
        canonical_path,
        adjustments_json,
        hash,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "photographer_id,canonical_path" },
    )
    .select("updated_at")
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    updated_at: data?.updated_at,
  });
}

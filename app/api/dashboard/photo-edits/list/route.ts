// 2026-04-27 — List photo edits for the signed-in photographer.
//
// Query params:
//   ?since=ISO8601   — only return edits modified after this timestamp
//   ?paths=a,b,c     — only return edits for these canonical paths
//                      (URL-encoded comma-separated; max 500)
//
// Response:
//   { ok: true, edits: [{ canonical_path, adjustments_json, hash,
//                          updated_at }, ...] }
//
// Called by Flutter's Cloud-pull (Import Hub) to hydrate sidecar
// JSONs after photos land on a fresh Mac.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { guardAgreement } from "@/lib/require-agreement";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
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

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) {
    return NextResponse.json(
      { ok: false, error: "Invalid token" },
      { status: 401 },
    );
  }

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

  const guard = await guardAgreement({
    service,
    userId: userData.user.id,
  });
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  const since = req.nextUrl.searchParams.get("since");
  const pathsParam = req.nextUrl.searchParams.get("paths");
  let query = service
    .from("photo_edits")
    .select("canonical_path, adjustments_json, hash, updated_at")
    .eq("photographer_id", photographerId)
    .order("updated_at", { ascending: false })
    .limit(5000);
  if (since) query = query.gt("updated_at", since);
  if (pathsParam) {
    const paths = pathsParam
      .split(",")
      .map((p) => decodeURIComponent(p.trim()))
      .filter((p) => p.length > 0)
      .slice(0, 500);
    if (paths.length > 0) query = query.in("canonical_path", paths);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    edits: data ?? [],
  });
}

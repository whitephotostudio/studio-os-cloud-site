import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { guardAgreement } from "@/lib/require-agreement";
import { r2DeleteWithVariants } from "@/lib/r2";

export const dynamic = "force-dynamic";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

type SchoolRow = { id: string; local_school_id: string | null };

// Capture delete (mobile Picture Day panel).
//
// Deletes a single photo (and its thumbnail/preview variants) from R2. Scoped
// so a photographer can only delete a key inside one of their own schools'
// storage prefixes — never another tenant's folder.
export async function POST(request: NextRequest) {
  const auth = await resolveDashboardAuth(request);
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createDashboardServiceClient();

  const guard = await guardAgreement({ service, userId: auth.user.id });
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });

  const { data: photographer } = await service
    .from("photographers")
    .select("id")
    .eq("user_id", auth.user.id)
    .maybeSingle<{ id: string }>();
  if (!photographer?.id) {
    return NextResponse.json(
      { error: "Photographer profile not found." },
      { status: 403 },
    );
  }

  let body: { schoolId?: string; key?: string };
  try {
    body = (await request.json()) as { schoolId?: string; key?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const schoolId = clean(body.schoolId);
  const key = clean(body.key);
  if (!schoolId || !key) {
    return NextResponse.json(
      { error: "schoolId and key are required." },
      { status: 400 },
    );
  }

  // Defensive: reject traversal / absolute paths / full URLs — must be a plain
  // storage key.
  if (key.includes("..") || key.startsWith("/") || key.includes("://")) {
    return NextResponse.json({ error: "Invalid key." }, { status: 400 });
  }

  const { data: school } = await service
    .from("schools")
    .select("id, local_school_id")
    .eq("id", schoolId)
    .eq("photographer_id", photographer.id)
    .maybeSingle<SchoolRow>();
  if (!school?.id) {
    return NextResponse.json(
      { error: "School not found for this account." },
      { status: 404 },
    );
  }

  // The key must live under this school's storage prefix.
  const schoolBaseId = clean(school.local_school_id) || school.id;
  if (!key.startsWith(`${schoolBaseId}/`)) {
    return NextResponse.json(
      { error: "That photo is not in this school." },
      { status: 403 },
    );
  }

  try {
    await r2DeleteWithVariants([key]);
  } catch (error) {
    console.error("[capture/delete] r2 delete failed", error);
    return NextResponse.json(
      { error: "Delete failed. Please try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, key });
}

// POST /api/dashboard/agreement/accept
//
// Records a photographer's acceptance of the current Studio OS Cloud
// legal agreement. Called by the AgreementGate modal when the user
// checks the box and clicks "Agree".
//
// We capture best-effort ip_address + user_agent from request headers
// for the audit trail — not for any live enforcement logic.

import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import {
  CURRENT_AGREEMENT_VERSION,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@/lib/agreement";

function readClientIp(request: NextRequest): string | null {
  // Vercel / most edge hosts populate x-forwarded-for with a comma-
  // separated list; the first entry is the originating client.
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return null;
}

export async function POST(request: NextRequest) {
  const { user } = await resolveDashboardAuth(request);
  if (!user?.id) {
    return NextResponse.json(
      { error: "Not signed in." },
      { status: 401 },
    );
  }

  const service = createDashboardServiceClient();

  // Resolve the photographer row so we can store photographer_id alongside
  // user_id. If this user has no photographer row yet we still record the
  // acceptance against user_id alone — but the FK to photographers is
  // NOT NULL, so we must refuse in that case. In practice every signed-in
  // dashboard user has a photographer row; if they don't, something is
  // wrong with the signup flow and blocking them is the right move.
  const { data: photog, error: photogErr } = await service
    .from("photographers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (photogErr || !photog?.id) {
    return NextResponse.json(
      {
        error:
          "Your photographer account isn't fully set up. Please contact support.",
        code: "no_photographer",
      },
      { status: 409 },
    );
  }

  const ipAddress = readClientIp(request);
  const userAgent = request.headers.get("user-agent");

  const { error: insertErr } = await service
    .from("photographer_agreements")
    .insert({
      photographer_id: photog.id,
      user_id: user.id,
      agreement_version: CURRENT_AGREEMENT_VERSION,
      terms_version: CURRENT_TERMS_VERSION,
      privacy_version: CURRENT_PRIVACY_VERSION,
      ip_address: ipAddress,
      user_agent: userAgent,
    });

  if (insertErr) {
    return NextResponse.json(
      { error: insertErr.message || "Could not record acceptance." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { ok: true, agreementVersion: CURRENT_AGREEMENT_VERSION },
    { status: 200 },
  );
}

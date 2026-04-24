// Admin-only endpoint: inspect agreement acceptance history + who has
// NOT accepted the current version.  Used by /dashboard/admin/agreements.

import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { CURRENT_AGREEMENT_VERSION } from "@/lib/agreement";

type AcceptanceRow = {
  id: string;
  photographer_id: string;
  user_id: string;
  agreement_version: string;
  terms_version: string;
  privacy_version: string;
  accepted_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
};

type PhotographerRow = {
  id: string;
  business_name: string | null;
  billing_email: string | null;
  studio_email: string | null;
  created_at: string | null;
};

export async function GET(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const service = createDashboardServiceClient();

    // Admin gate — only platform admins can see the acceptance table.
    const { data: me } = await service
      .from("photographers")
      .select("is_platform_admin")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!me?.is_platform_admin) {
      return NextResponse.json(
        { ok: false, message: "Only platform admins can view this page." },
        { status: 403 },
      );
    }

    // 200 most-recent acceptances (any version) — audit log view.
    const { data: history, error: historyErr } = await service
      .from("photographer_agreements")
      .select(
        "id, photographer_id, user_id, agreement_version, terms_version, privacy_version, accepted_at, ip_address, user_agent",
      )
      .order("accepted_at", { ascending: false })
      .limit(200);
    if (historyErr) throw historyErr;

    // Every photographer — used to compute "who hasn't accepted current version".
    const { data: photographers, error: photoErr } = await service
      .from("photographers")
      .select("id, business_name, billing_email, studio_email, created_at")
      .order("created_at", { ascending: false });
    if (photoErr) throw photoErr;

    // Photographers who HAVE accepted the current version.
    const { data: currentAcceptances, error: acceptErr } = await service
      .from("photographer_agreements")
      .select("photographer_id")
      .eq("agreement_version", CURRENT_AGREEMENT_VERSION);
    if (acceptErr) throw acceptErr;

    const acceptedSet = new Set(
      (currentAcceptances ?? []).map((r) => r.photographer_id as string),
    );

    const outstanding = (photographers ?? [])
      .filter((p) => !acceptedSet.has(p.id as string))
      .map((p) => p as PhotographerRow);

    return NextResponse.json({
      ok: true,
      agreementVersion: CURRENT_AGREEMENT_VERSION,
      totalPhotographers: (photographers ?? []).length,
      totalAccepted: acceptedSet.size,
      outstanding,
      history: (history ?? []) as AcceptanceRow[],
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not load agreement audit.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}

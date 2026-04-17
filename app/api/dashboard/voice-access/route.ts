// GET /api/dashboard/voice-access
//
// Returns whether the signed-in photographer is allowed to use the
// premium ElevenLabs voice. Used by the Studio Assistant settings panel
// so we can hide the premium-voice controls entirely from photographers
// the admin hasn't enabled. Always returns 200 so the panel can render
// unconditionally — non-admins simply see {enabled: false}.

import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { getOrCreatePhotographerByUser } from "@/lib/payments";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json({
        ok: true,
        enabled: false,
        isAdmin: false,
      });
    }

    const service = createDashboardServiceClient();
    const photographer = await getOrCreatePhotographerByUser(service, user);

    const { data: row } = await service
      .from("photographers")
      .select("voice_premium_enabled,voice_monthly_char_limit,is_platform_admin")
      .eq("id", photographer.id)
      .maybeSingle();

    const isAdmin = Boolean(row?.is_platform_admin);
    const enabled =
      isAdmin ||
      (Boolean(row?.voice_premium_enabled) &&
        Number(row?.voice_monthly_char_limit ?? 0) > 0);

    return NextResponse.json({
      ok: true,
      enabled,
      isAdmin,
    });
  } catch {
    return NextResponse.json({
      ok: true,
      enabled: false,
      isAdmin: false,
    });
  }
}

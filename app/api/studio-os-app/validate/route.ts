import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { validatePhotographyKey } from "@/lib/studio-os-app";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type ValidateBody = {
  keyCode?: string | null;
  deviceId?: string | null;
  platform?: string | null;
  appVersion?: string | null;
};

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const rl = await rateLimit(ip, { namespace: "key-validate", limit: 20, windowSeconds: 60 });
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, message: "Too many validation attempts. Please wait." },
        { status: 429 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as ValidateBody;
    const service = createDashboardServiceClient();
    const result = await validatePhotographyKey(service, {
      keyCode: body.keyCode ?? "",
      deviceId: body.deviceId ?? "",
      platform: body.platform ?? null,
      appVersion: body.appVersion ?? null,
    });

    return NextResponse.json({
      ok: true,
      keyId: result.key.id,
      keyCode: result.key.key_code,
      planCode: result.entitlement.planCode,
      releaseState: result.entitlement.releaseState,
      version: result.release.version,
      message: "Photography Key validated successfully.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to validate this Photography Key.",
      },
      { status: 400 },
    );
  }
}

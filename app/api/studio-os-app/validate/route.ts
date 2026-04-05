import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { validatePhotographyKey } from "@/lib/studio-os-app";

export const dynamic = "force-dynamic";

type ValidateBody = {
  keyCode?: string | null;
  deviceId?: string | null;
  platform?: string | null;
  appVersion?: string | null;
};

export async function POST(request: NextRequest) {
  try {
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

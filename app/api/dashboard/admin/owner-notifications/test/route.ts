import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import {
  notifyOwnerSafely,
  ownerNotificationsConfigured,
  ownerUrl,
} from "@/lib/owner-notifications";
import { getOrCreatePhotographerByUser } from "@/lib/payments";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { user } = await resolveDashboardAuth(request);
  if (!user) {
    return NextResponse.json(
      { ok: false, message: "Please sign in again." },
      { status: 401 },
    );
  }

  const service = createDashboardServiceClient();
  const photographer = await getOrCreatePhotographerByUser(service, user);
  if (!photographer.is_platform_admin) {
    return NextResponse.json(
      { ok: false, message: "Only platform admins can send owner notification tests." },
      { status: 403 },
    );
  }

  if (!ownerNotificationsConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Owner notifications are not configured. Set PUSHOVER_APP_TOKEN and PUSHOVER_USER_KEY.",
      },
      { status: 400 },
    );
  }

  const result = await notifyOwnerSafely({
    title: "Studio OS test notification",
    message: `Owner notifications are connected.\nSent at: ${new Date().toLocaleString("en-CA", { timeZone: "America/Toronto" })}`,
    url: ownerUrl("/dashboard/admin/users"),
    urlTitle: "Open admin users",
    priority: 0,
  });

  if (!result.sent) {
    return NextResponse.json(
      {
        ok: false,
        message: result.message || "Could not send the Pushover test notification.",
        result,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    result,
  });
}

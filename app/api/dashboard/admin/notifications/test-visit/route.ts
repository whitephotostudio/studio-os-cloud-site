import { NextRequest, NextResponse } from "next/server";
import {
  getOwnerNotificationSettings,
  recordOwnerActivity,
} from "@/lib/admin-notification-center";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
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
      { ok: false, message: "Only platform admins can test owner notifications." },
      { status: 403 },
    );
  }

  const settings = await getOwnerNotificationSettings();
  if (!settings.activityTrackingEnabled) {
    return NextResponse.json(
      {
        ok: false,
        message: "Activity report is off. Turn it on before testing site visit alerts.",
      },
      { status: 400 },
    );
  }

  if (!settings.alertOnEverySiteVisit && !settings.alertOnHighIntentVisit) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Site visit alerts are off. Turn on High-intent website visit or Every public site visit first.",
      },
      { status: 400 },
    );
  }

  const result = await recordOwnerActivity(
    {
      type: "page_view",
      path: "/pricing",
      referrer: "admin-test",
      anonymousId: `admin-test-${crypto.randomUUID()}`,
    },
    request,
  );

  if (!result.recorded) {
    return NextResponse.json(
      { ok: false, message: "The test visit was not recorded." },
      { status: 400 },
    );
  }

  if (!result.notification.attempted) {
    return NextResponse.json(
      {
        ok: false,
        message: result.notification.message,
        result: result.notification,
      },
      { status: 400 },
    );
  }

  if (!result.notification.sent) {
    return NextResponse.json(
      {
        ok: false,
        message: result.notification.message,
        result: result.notification,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    message: "Test site visit alert sent.",
    activity: result.activity,
    result: result.notification,
  });
}

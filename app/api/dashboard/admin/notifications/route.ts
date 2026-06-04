import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getOwnerNotificationDiagnostics,
  getOwnerActivityReport,
  getOwnerNotificationSettings,
  saveOwnerNotificationSettings,
} from "@/lib/admin-notification-center";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { getOrCreatePhotographerByUser } from "@/lib/payments";

export const dynamic = "force-dynamic";

const settingsSchema = z.object({
  activityTrackingEnabled: z.boolean().optional(),
  alertOnNewRegistration: z.boolean().optional(),
  alertOnNewSubscription: z.boolean().optional(),
  alertOnPaymentFailed: z.boolean().optional(),
  alertOnSubscriptionCanceled: z.boolean().optional(),
  alertOnHighIntentVisit: z.boolean().optional(),
  alertOnEverySiteVisit: z.boolean().optional(),
  alertOnMarketingClick: z.boolean().optional(),
  visitAlertCooldownMinutes: z.coerce.number().int().min(1).max(1440).optional(),
});

async function requirePlatformAdmin(request: NextRequest) {
  const { user } = await resolveDashboardAuth(request);
  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      ),
    };
  }

  const service = createDashboardServiceClient();
  const photographer = await getOrCreatePhotographerByUser(service, user);
  if (!photographer.is_platform_admin) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, message: "Only platform admins can manage notifications." },
        { status: 403 },
      ),
    };
  }

  return { ok: true as const };
}

export async function GET(request: NextRequest) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  const [settings, report, diagnostics] = await Promise.all([
    getOwnerNotificationSettings(),
    getOwnerActivityReport(150),
    getOwnerNotificationDiagnostics(),
  ]);

  return NextResponse.json({
    ok: true,
    settings,
    report,
    diagnostics,
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  const payload = await request.json().catch(() => ({}));
  const parsed = settingsSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: "Invalid notification settings." },
      { status: 400 },
    );
  }

  const settings = await saveOwnerNotificationSettings(parsed.data);
  const [report, diagnostics] = await Promise.all([
    getOwnerActivityReport(150),
    getOwnerNotificationDiagnostics(),
  ]);
  return NextResponse.json({
    ok: true,
    settings,
    report,
    diagnostics,
  });
}

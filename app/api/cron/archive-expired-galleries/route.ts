import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";

export const dynamic = "force-dynamic";

type ExpiringProjectRow = {
  id: string;
  workflow_type: string | null;
  status: string | null;
  portal_status: string | null;
  expiration_date: string | null;
  gallery_settings: unknown;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function isAuthorized(request: NextRequest) {
  const expected = clean(process.env.CRON_SECRET);
  // Fail closed: if CRON_SECRET is unset (e.g. mis-deploy, env rotation gap),
  // refuse the request instead of allowing every caller.
  if (!expected) {
    console.error("[cron] CRON_SECRET is not configured; rejecting request.");
    return false;
  }
  const header = clean(request.headers.get("authorization"));
  return header === `Bearer ${expected}`;
}

function isInactive(value: string | null | undefined) {
  return clean(value).toLowerCase() === "inactive";
}

function isEventProject(value: string | null | undefined) {
  return clean(value).toLowerCase() === "event";
}

function isExpired(value: string | null | undefined) {
  const dateValue = clean(value);
  if (!dateValue) return false;
  return new Date(dateValue) < new Date();
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, message: "Unauthorized." }, { status: 401 });
    }

    const service = createDashboardServiceClient();
    const { data, error } = await service
      .from("projects")
      .select("id,workflow_type,status,portal_status,expiration_date,gallery_settings")
      .not("expiration_date", "is", null)
      .order("expiration_date", { ascending: true })
      .limit(500);

    if (error) throw error;

    const rows = (data ?? []) as ExpiringProjectRow[];
    const candidates = rows.filter((row) => {
      if (!isEventProject(row.workflow_type)) return false;
      if (!isExpired(row.expiration_date)) return false;
      if (isInactive(row.status) || isInactive(row.portal_status)) return false;
      const settings = normalizeEventGallerySettings(row.gallery_settings);
      return settings.extras.autoArchiveAfterExpiration;
    });

    if (!candidates.length) {
      return NextResponse.json({
        ok: true,
        checked: rows.length,
        archived: 0,
        skipped: rows.length,
        failed: 0,
      });
    }

    let archived = 0;
    let failed = 0;

    for (const project of candidates) {
      const { error: updateError } = await service
        .from("projects")
        .update({
          status: "inactive",
          portal_status: "inactive",
          updated_at: new Date().toISOString(),
        })
        .eq("id", project.id);

      if (updateError) {
        failed += 1;
        continue;
      }

      archived += 1;
    }

    return NextResponse.json({
      ok: true,
      checked: rows.length,
      archived,
      skipped: rows.length - candidates.length,
      failed,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Failed to archive expired galleries.",
      },
      { status: 500 },
    );
  }
}

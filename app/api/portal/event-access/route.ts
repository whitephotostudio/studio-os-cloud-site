import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

type EventProjectRow = {
  id: string;
  status: string | null;
  workflow_type: string | null;
  portal_status: string | null;
  email_required: boolean | null;
  access_mode: string | null;
  access_pin: string | null;
};

type EventCollectionAccessRow = {
  id: string;
  slug: string | null;
  access_mode: string | null;
  access_pin: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function normalizedAccessMode(value: string | null | undefined) {
  const raw = clean(value).toLowerCase();
  if (!raw) return "public";
  if (raw === "pin" || raw === "protected" || raw === "private") return "pin";
  if (raw === "inherit" || raw === "inherit_project" || raw === "project") return "inherit_project";
  return raw;
}

function isInactive(value: string | null | undefined) {
  return clean(value).toLowerCase() === "inactive";
}

function isEventProject(row: EventProjectRow) {
  return clean(row.workflow_type).toLowerCase() === "event";
}

function matchesProjectPin(row: Pick<EventProjectRow, "access_mode" | "access_pin">, pin: string) {
  return normalizedAccessMode(row.access_mode) === "pin" && clean(row.access_pin) === pin;
}

function matchesCollectionPin(row: EventCollectionAccessRow, pin: string) {
  return clean(row.slug) === pin || (normalizedAccessMode(row.access_mode) === "pin" && clean(row.access_pin) === pin);
}

function isMissingVisitorsTable(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "42P01"
  );
}

export async function POST(request: NextRequest) {
  try {
    const { eventId, email, pin } = (await request.json()) as {
      eventId?: string;
      email?: string;
      pin?: string;
    };

    const selectedEventId = clean(eventId);
    const normalizedEmail = clean(email).toLowerCase();
    const pinValue = clean(pin);

    if (!selectedEventId) {
      return NextResponse.json({ ok: false, message: "Please choose your event." }, { status: 400 });
    }
    if (!normalizedEmail) {
      return NextResponse.json(
        { ok: false, message: "Please enter the email the photographer sent the invite to." },
        { status: 400 },
      );
    }
    const service = createDashboardServiceClient();
    const { data: eventRow, error: eventError } = await service
      .from("projects")
      .select("id,status,workflow_type,portal_status,email_required,access_mode,access_pin")
      .eq("id", selectedEventId)
      .maybeSingle();

    if (eventError) throw eventError;
    if (!eventRow || !isEventProject(eventRow as EventProjectRow) || isInactive((eventRow as EventProjectRow).status)) {
      return NextResponse.json({ ok: false, message: "Please choose your event." }, { status: 404 });
    }

    const selectedEvent = eventRow as EventProjectRow;
    const portalStatus = clean(selectedEvent.portal_status).toLowerCase();

    if (portalStatus === "pre_release") {
      // Capture email for pre-release list — non-fatal, ignore duplicates
      try { await service.from("portal_email_captures").insert({ email: normalizedEmail, project_id: selectedEventId, source: "pre_release" }); } catch { /* non-fatal */ }

      return NextResponse.json({
        ok: true,
        step: "event_prerelease",
        projectId: selectedEventId,
        email: normalizedEmail,
      });
    }

    if (!pinValue) {
      return NextResponse.json({ ok: false, message: "Please enter your event access PIN." }, { status: 400 });
    }

    const { data: whitelistRows, error: whitelistError } = await service
      .from("pre_release_emails")
      .select("id")
      .eq("project_id", selectedEventId)
      .eq("email", normalizedEmail)
      .limit(1);

    if (whitelistError) throw whitelistError;

    const emailRequired = selectedEvent.email_required !== false;
    if (emailRequired && (whitelistRows?.length ?? 0) === 0) {
      const { data: anyWhitelist, error: anyWhitelistError } = await service
        .from("pre_release_emails")
        .select("id")
        .eq("project_id", selectedEventId)
        .limit(1);

      if (anyWhitelistError) throw anyWhitelistError;

      if ((anyWhitelist?.length ?? 0) > 0) {
        return NextResponse.json(
          { ok: false, message: "That email is not approved for this event gallery." },
          { status: 403 },
        );
      }
    }

    const [matchingSubjectResult, collectionAccessResult] = await Promise.all([
      service
        .from("subjects")
        .select("id")
        .eq("project_id", selectedEventId)
        .eq("external_ref", pinValue)
        .limit(1)
        .maybeSingle(),
      service
        .from("collections")
        .select("id,slug,access_mode,access_pin")
        .eq("project_id", selectedEventId),
    ]);

    if (matchingSubjectResult.error) throw matchingSubjectResult.error;
    if (collectionAccessResult.error) throw collectionAccessResult.error;

    const matchingCollection = ((collectionAccessResult.data ?? []) as EventCollectionAccessRow[]).find((row) =>
      matchesCollectionPin(row, pinValue),
    );
    const projectPinMatch = matchesProjectPin(selectedEvent, pinValue);

    if (!projectPinMatch && !matchingSubjectResult.data && !matchingCollection) {
      return NextResponse.json(
        { ok: false, message: "No event gallery was found for that email and PIN." },
        { status: 404 },
      );
    }

    const { error: visitorError } = await service
      .from("event_gallery_visitors")
      .upsert(
        {
          project_id: selectedEventId,
          viewer_email: normalizedEmail,
          last_opened_at: new Date().toISOString(),
        },
        {
          onConflict: "project_id,viewer_email",
        },
      );

    if (visitorError && !isMissingVisitorsTable(visitorError)) {
      throw visitorError;
    }

    // Capture email for marketing — non-fatal, ignore duplicates
    try { await service.from("portal_email_captures").insert({ email: normalizedEmail, project_id: selectedEventId, source: "event_login" }); } catch { /* non-fatal */ }

    return NextResponse.json({
      ok: true,
      projectId: selectedEventId,
      email: normalizedEmail,
      pin: pinValue,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to check event access.",
      },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

type EventProjectRow = {
  id: string;
  status: string | null;
  workflow_type: string | null;
  email_required: boolean | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function isInactive(value: string | null | undefined) {
  return clean(value).toLowerCase() === "inactive";
}

function isEventProject(row: EventProjectRow) {
  return clean(row.workflow_type).toLowerCase() === "event";
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
    if (!pinValue) {
      return NextResponse.json({ ok: false, message: "Please enter your event access PIN." }, { status: 400 });
    }

    const service = createDashboardServiceClient();
    const { data: eventRow, error: eventError } = await service
      .from("projects")
      .select("id,status,workflow_type,email_required")
      .eq("id", selectedEventId)
      .maybeSingle();

    if (eventError) throw eventError;
    if (!eventRow || !isEventProject(eventRow as EventProjectRow) || isInactive((eventRow as EventProjectRow).status)) {
      return NextResponse.json({ ok: false, message: "Please choose your event." }, { status: 404 });
    }

    const selectedEvent = eventRow as EventProjectRow;

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

    const [matchingSubjectResult, matchingCollectionResult] = await Promise.all([
      service
        .from("subjects")
        .select("id")
        .eq("project_id", selectedEventId)
        .eq("external_ref", pinValue)
        .limit(1)
        .maybeSingle(),
      service
        .from("collections")
        .select("id")
        .eq("project_id", selectedEventId)
        .eq("slug", pinValue)
        .limit(1)
        .maybeSingle(),
    ]);

    if (matchingSubjectResult.error) throw matchingSubjectResult.error;
    if (matchingCollectionResult.error) throw matchingCollectionResult.error;

    if (!matchingSubjectResult.data && !matchingCollectionResult.data) {
      return NextResponse.json(
        { ok: false, message: "No event gallery was found for that email and PIN." },
        { status: 404 },
      );
    }

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

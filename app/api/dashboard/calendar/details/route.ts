import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UpdateCalendarDetailsSchema = z.object({
  kind: z.enum(["event", "school"]),
  id: z.string().min(1).max(128),
  startTime: z.string().max(64).nullable().optional(),
  endTime: z.string().max(64).nullable().optional(),
  time: z.string().max(64).nullable().optional(),
  date: z.string().max(64).nullable().optional(),
  location: z.string().max(500).nullable().optional(),
  address: z.string().max(1000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const parsed = await parseJson(request, UpdateCalendarDetailsSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const service = createDashboardServiceClient();
    const { data: photographerRow, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (photographerError) throw photographerError;
    if (!photographerRow?.id) {
      return NextResponse.json(
        { ok: false, message: "Photographer profile not found." },
        { status: 404 },
      );
    }

    const table = body.kind === "event" ? "projects" : "schools";
    const { data: row, error: fetchError } = await service
      .from(table)
      .select("id,gallery_settings")
      .eq("id", body.id)
      .eq("photographer_id", photographerRow.id)
      .maybeSingle<{ id: string; gallery_settings: unknown }>();

    if (fetchError) throw fetchError;
    if (!row?.id) {
      return NextResponse.json(
        { ok: false, message: body.kind === "event" ? "Event not found." : "School not found." },
        { status: 404 },
      );
    }

    const nextSettings = normalizeEventGallerySettings(row.gallery_settings);
    const startTime = clean(body.startTime ?? body.time);
    nextSettings.schedule = {
      startTime,
      endTime: clean(body.endTime),
      time: startTime,
      location: clean(body.location),
      address: clean(body.address),
      notes: clean(body.notes),
    };

    const nextDate = body.date === undefined ? undefined : clean(body.date).slice(0, 10) || null;
    const updatePayload: Record<string, unknown> = { gallery_settings: nextSettings };
    if (nextDate !== undefined) {
      if (body.kind === "event") {
        updatePayload.event_date = nextDate;
        updatePayload.shoot_date = nextDate;
      } else {
        updatePayload.shoot_date = nextDate;
      }
    }

    const { error: updateError } = await service
      .from(table)
      .update(updatePayload)
      .eq("id", body.id)
      .eq("photographer_id", photographerRow.id);

    if (updateError) throw updateError;

    return NextResponse.json({
      ok: true,
      details: nextSettings.schedule,
    });
  } catch (error) {
    console.error("[dashboard:calendar:details:PATCH]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to save calendar details." },
      { status: 500 },
    );
  }
}

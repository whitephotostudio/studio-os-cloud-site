import { NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";

// ✅ PERF: Allow Vercel's Edge CDN to cache this response for 2 minutes and
// serve stale data for up to 10 minutes while revalidating in the background.
// The school/event list changes infrequently; staleness is acceptable.
// Remove "force-dynamic" so Next.js doesn't opt the route out of caching.

type SchoolRow = {
  id: string;
  school_name: string;
  status: string | null;
  expiration_date: string | null;
  email_required: boolean | null;
};

type EventProjectRow = {
  id: string;
  title: string | null;
  client_name: string | null;
  workflow_type: string | null;
  status: string | null;
  portal_status: string | null;
  event_date: string | null;
  email_required: boolean | null;
};

type StudentSchoolRow = {
  school_id: string | null;
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

function projectLabel(project: EventProjectRow) {
  return clean(project.title) || clean(project.client_name) || "Untitled Event";
}

export async function GET() {
  try {
    const service = createDashboardServiceClient();
    const [schoolsResult, studentsResult, eventsResult] = await Promise.all([
      service
        .from("schools")
        .select("id,school_name,status,expiration_date,email_required")
        .order("school_name"),
      service.from("students").select("school_id"),
      service
        .from("projects")
        .select("id,title,client_name,workflow_type,status,portal_status,event_date,email_required")
        .eq("workflow_type", "event")
        .order("event_date", { ascending: false }),
    ]);

    if (schoolsResult.error) throw schoolsResult.error;
    if (studentsResult.error) throw studentsResult.error;
    if (eventsResult.error) throw eventsResult.error;

    const schoolIdsWithStudents = new Set(
      ((studentsResult.data ?? []) as StudentSchoolRow[])
        .map((row) => row.school_id)
        .filter((value): value is string => !!value),
    );

    const uniqueSchools = new Map<string, SchoolRow>();
    for (const row of (schoolsResult.data ?? []) as SchoolRow[]) {
      const trimmedName = clean(row.school_name);
      const key = trimmedName.toLowerCase();
      if (!trimmedName) continue;
      if (!schoolIdsWithStudents.has(row.id)) continue;
      if (isInactive(row.status)) continue;
      if (!uniqueSchools.has(key)) {
        uniqueSchools.set(key, { ...row, school_name: trimmedName });
      }
    }

    const filteredEvents = ((eventsResult.data ?? []) as EventProjectRow[])
      .filter((row) => isEventProject(row) && !isInactive(row.status))
      .sort((a, b) => {
        const aDate = a.event_date ? new Date(a.event_date).getTime() : 0;
        const bDate = b.event_date ? new Date(b.event_date).getTime() : 0;
        if (aDate !== bDate) return bDate - aDate;
        return projectLabel(a).localeCompare(projectLabel(b));
      });

    return NextResponse.json(
      {
        ok: true,
        schools: Array.from(uniqueSchools.values()),
        eventProjects: filteredEvents,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to load portal choices.",
      },
      { status: 500 },
    );
  }
}

// app/parents/page.tsx
//
// ✅ PERF: Server Component — fetches schools & events at request time on the
// server. The school dropdown is in the HTML before the browser executes any
// JavaScript. Parents see the form instantly with no loading spinner.
//
// The interactive form logic lives in LoginForm.tsx (Client Component).

import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import LoginForm from "./LoginForm";

export const revalidate = 60; // ISR: revalidate school/event list every 60 s

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

type StudentSchoolRow = { school_id: string | null };

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function isInactive(value: string | null | undefined) {
  return clean(value).toLowerCase() === "inactive";
}

function projectLabel(project: EventProjectRow) {
  return clean(project.title) || clean(project.client_name) || "Untitled Event";
}

async function getPortalChoices(prefilledProjectId?: string): Promise<{
  schools: SchoolRow[];
  eventProjects: EventProjectRow[];
}> {
  try {
    const service = createDashboardServiceClient();

    // If a project ID is provided, scope events to that photographer only
    let photographerIdFilter: string | null = null;
    if (prefilledProjectId) {
      const { data: proj } = await service
        .from("projects")
        .select("photographer_id")
        .eq("id", prefilledProjectId)
        .maybeSingle();
      photographerIdFilter = (proj as { photographer_id?: string } | null)?.photographer_id ?? null;
    }

    let eventsQuery = service
      .from("projects")
      .select("id,title,client_name,workflow_type,status,portal_status,event_date,email_required")
      .eq("workflow_type", "event")
      .order("event_date", { ascending: false });

    if (photographerIdFilter) {
      eventsQuery = eventsQuery.eq("photographer_id", photographerIdFilter);
    }

    const [schoolsResult, studentsResult, eventsResult] = await Promise.all([
      service
        .from("schools")
        .select("id,school_name,status,expiration_date,email_required")
        .order("school_name"),
      // ✅ PERF: Only fetch school_id column (minimal payload)
      service.from("students").select("school_id").not("school_id", "is", null),
      eventsQuery,
    ]);

    if (schoolsResult.error) throw schoolsResult.error;
    if (studentsResult.error) throw studentsResult.error;
    if (eventsResult.error) throw eventsResult.error;

    const schoolIdsWithStudents = new Set(
      ((studentsResult.data ?? []) as StudentSchoolRow[])
        .map((row) => row.school_id)
        .filter((v): v is string => !!v),
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
      .filter((row) => clean(row.workflow_type).toLowerCase() === "event" && !isInactive(row.status))
      .sort((a, b) => {
        const aDate = a.event_date ? new Date(a.event_date).getTime() : 0;
        const bDate = b.event_date ? new Date(b.event_date).getTime() : 0;
        if (aDate !== bDate) return bDate - aDate;
        return projectLabel(a).localeCompare(projectLabel(b));
      });

    return {
      schools: Array.from(uniqueSchools.values()),
      eventProjects: filteredEvents,
    };
  } catch (err) {
    console.error("[parents/page] getPortalChoices error:", err);
    return { schools: [], eventProjects: [] };
  }
}

export default async function ClientPortalPage({
  searchParams,
}: {
  searchParams?: Promise<{
    mode?: string;
    project?: string;
    email?: string;
  }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const { schools, eventProjects } = await getPortalChoices(clean(resolvedSearchParams.project) || undefined);

  return (
    <LoginForm
      initialSchools={schools}
      initialEventProjects={eventProjects}
      prefilledMode={resolvedSearchParams.mode === "event" ? "event" : undefined}
      prefilledEventId={clean(resolvedSearchParams.project)}
      prefilledEventEmail={clean(resolvedSearchParams.email)}
    />
  );
}

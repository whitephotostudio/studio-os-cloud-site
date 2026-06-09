import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeScheduleDate,
  type ScheduleItem,
} from "@/lib/schedule-calendar";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";

type ProjectScheduleRow = {
  id: string;
  title: string | null;
  client_name: string | null;
  event_date: string | null;
  shoot_date: string | null;
  portal_status: string | null;
  status: string | null;
  gallery_slug: string | null;
  gallery_settings: unknown;
  created_at: string | null;
  linked_local_school_id?: string | null;
  linked_school_id?: string | null;
};

type SchoolScheduleRow = {
  id: string;
  school_name: string | null;
  local_school_id: string | null;
  shoot_date: string | null;
  status: string | null;
  gallery_slug: string | null;
  gallery_settings: unknown;
  created_at: string | null;
};

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export async function listScheduleItems(
  service: SupabaseClient,
  photographerId: string,
): Promise<ScheduleItem[]> {
  const [projectsResult, schoolsResult] = await Promise.all([
    service
      .from("projects")
      .select(
        "id,title,client_name,event_date,shoot_date,portal_status,status,gallery_slug,gallery_settings,created_at,linked_local_school_id,linked_school_id",
      )
      .eq("photographer_id", photographerId)
      .eq("workflow_type", "event"),
    service
      .from("schools")
      .select("id,school_name,local_school_id,shoot_date,status,gallery_slug,gallery_settings,created_at")
      .eq("photographer_id", photographerId),
  ]);

  if (projectsResult.error) throw projectsResult.error;
  if (schoolsResult.error) throw schoolsResult.error;

  const items: ScheduleItem[] = [];

  const projectRows = (projectsResult.data ?? []) as ProjectScheduleRow[];
  const eventLocalSchoolIds = new Set(
    projectRows.map((p) => clean(p.linked_local_school_id)).filter(Boolean),
  );
  const eventLinkedSchoolIds = new Set(
    projectRows.map((p) => clean(p.linked_school_id)).filter(Boolean),
  );

  for (const project of projectRows) {
    const date = normalizeScheduleDate(project.event_date || project.shoot_date);
    if (!date) continue;
    const title = clean(project.title) || clean(project.client_name) || "Untitled event";
    const schedule = normalizeEventGallerySettings(project.gallery_settings).schedule;
    items.push({
      id: project.id,
      kind: "event",
      title,
      date,
      startTime: clean(schedule.startTime || schedule.time) || null,
      endTime: clean(schedule.endTime) || null,
      time: clean(schedule.time) || null,
      location: clean(schedule.location) || null,
      address: clean(schedule.address) || null,
      notes: clean(schedule.notes) || null,
      clientName: clean(project.client_name) || null,
      status: clean(project.portal_status || project.status) || null,
      href: `/dashboard/projects/${project.id}`,
      gallerySlug: clean(project.gallery_slug) || null,
      createdAt: project.created_at,
    });
  }

  for (const school of (schoolsResult.data ?? []) as SchoolScheduleRow[]) {
    const localId = clean(school.local_school_id);
    if (localId && eventLocalSchoolIds.has(localId)) continue;
    if (eventLinkedSchoolIds.has(clean(school.id))) continue;

    const date = normalizeScheduleDate(school.shoot_date);
    if (!date) continue;
    const schedule = normalizeEventGallerySettings(school.gallery_settings).schedule;
    items.push({
      id: school.id,
      kind: "school",
      title: clean(school.school_name) || "Untitled school",
      date,
      startTime: clean(schedule.startTime || schedule.time) || null,
      endTime: clean(schedule.endTime) || null,
      time: clean(schedule.time) || null,
      location: clean(schedule.location) || null,
      address: clean(schedule.address) || null,
      notes: clean(schedule.notes) || null,
      clientName: null,
      status: clean(school.status) || null,
      href: `/dashboard/projects/schools/${school.id}`,
      gallerySlug: clean(school.gallery_slug) || null,
      createdAt: school.created_at,
    });
  }

  return items.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.title.localeCompare(b.title);
  });
}

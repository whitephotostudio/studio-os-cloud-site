import type { SupabaseClient } from "@supabase/supabase-js";

const PROJECT_PAGE_SIZE = 500;
const COLLECTION_PAGE_SIZE = 500;
const PROJECT_ID_BATCH_SIZE = 100;

export type DesktopEventProjectRow = {
  id: string;
  gallery_settings?: unknown;
  portal_status?: string | null;
  gallery_slug?: string | null;
  [key: string]: unknown;
};

export type DesktopEventCollectionRow = {
  id: string;
  project_id: string;
  sort_order?: number | null;
  [key: string]: unknown;
};

/** Read every owned event project and its active collections for desktop restore. */
export async function loadDesktopEventProjects(input: {
  service: SupabaseClient;
  photographerId: string;
}) {
  const projects: DesktopEventProjectRow[] = [];
  for (let offset = 0; ; offset += PROJECT_PAGE_SIZE) {
    const { data, error } = await input.service
      .from("projects")
      .select(
        "id,title,client_name,gallery_settings,shoot_date,event_date,order_due_date,expiration_date,portal_status,pre_release,gallery_slug,cover_photo_url,access_mode,access_pin,access_updated_at,access_updated_source,linked_local_school_id,updated_at",
      )
      .eq("photographer_id", input.photographerId)
      .eq("workflow_type", "event")
      .or("status.is.null,status.neq.deleted")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + PROJECT_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as DesktopEventProjectRow[];
    projects.push(...page);
    if (page.length < PROJECT_PAGE_SIZE) break;
  }

  const collectionsByProject = new Map<string, Omit<DesktopEventCollectionRow, "project_id">[]>();
  for (let batchOffset = 0; batchOffset < projects.length; batchOffset += PROJECT_ID_BATCH_SIZE) {
    const projectIds = projects
      .slice(batchOffset, batchOffset + PROJECT_ID_BATCH_SIZE)
      .map((project) => project.id);
    for (let rowOffset = 0; ; rowOffset += COLLECTION_PAGE_SIZE) {
      const { data, error } = await input.service
        .from("collections")
        .select(
          "id,project_id,title,slug,local_id,cover_photo_url,access_mode,access_pin,access_updated_at,access_updated_source,sort_order",
        )
        .in("project_id", projectIds)
        .is("deleted_at", null)
        .order("project_id", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true })
        .range(rowOffset, rowOffset + COLLECTION_PAGE_SIZE - 1);
      if (error) throw error;
      const page = (data ?? []) as DesktopEventCollectionRow[];
      for (const { project_id: projectId, ...collection } of page) {
        const rows = collectionsByProject.get(projectId) ?? [];
        rows.push(collection);
        collectionsByProject.set(projectId, rows);
      }
      if (page.length < COLLECTION_PAGE_SIZE) break;
    }
  }

  return projects.map((project) => ({
    project,
    collections: collectionsByProject.get(project.id) ?? [],
  }));
}

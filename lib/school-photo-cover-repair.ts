import type { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { schoolPhotoReferenceMatchesFamily } from "@/lib/school-photo-deletions";
import {
  projectMediaReferenceMatchesSchoolPhotoFamily,
  projectPhotoCollectionId,
} from "@/lib/school-project-photo-mapping";
import { selectResolvedOwnedProjectSchool } from "@/lib/school-project-photo-mapping-core";

export type SchoolPhotoCoverRepairSchool = {
  id: string;
  local_school_id: string | null;
  photographer_id: string | null;
  cover_photo_url: string | null;
};

type CoverRow = {
  id: string;
  cover_photo_url: string | null;
};

type ProjectCoverRow = CoverRow & {
  workflow_type?: string | null;
  linked_school_id?: string | null;
  linked_local_school_id?: string | null;
};

type CollectionCoverRow = CoverRow & {
  project_id: string;
  title: string | null;
};

type MediaCoverRow = {
  id: string;
  project_id: string;
  collection_id: string | null;
  storage_path: string | null;
  preview_url: string | null;
  thumbnail_url: string | null;
  is_cover: boolean | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

async function loadSchoolProjectCovers(
  service: ReturnType<typeof createDashboardServiceClient>,
  school: SchoolPhotoCoverRepairSchool,
) {
  const photographerId = clean(school.photographer_id);
  if (!photographerId) return [];

  const rows: ProjectCoverRow[] = [];
  const bySchool = await service
    .from("projects")
    .select("id,cover_photo_url,workflow_type,linked_school_id,linked_local_school_id")
    .eq("workflow_type", "school")
    .eq("photographer_id", photographerId)
    .eq("linked_school_id", school.id);
  if (bySchool.error) throw bySchool.error;
  rows.push(...((bySchool.data ?? []) as ProjectCoverRow[]));

  if (clean(school.local_school_id)) {
    const byLocalSchool = await service
      .from("projects")
      .select("id,cover_photo_url,workflow_type,linked_school_id,linked_local_school_id")
      .eq("workflow_type", "school")
      .eq("photographer_id", photographerId)
      .eq("linked_local_school_id", clean(school.local_school_id));
    if (byLocalSchool.error) throw byLocalSchool.error;
    rows.push(...((byLocalSchool.data ?? []) as ProjectCoverRow[]));
  }

  return Array.from(new Map(rows.map((row) => [row.id, row])).values()).filter(
    (project) =>
      selectResolvedOwnedProjectSchool(project, [school], photographerId)?.id ===
      school.id,
  );
}

/**
 * Replace every active gallery cover that points at a removed school-photo
 * family. Media objects remain available for paid-order recovery; only their
 * explicit cover flag is cleared.
 */
export async function repairSchoolPhotoCoverReferences(params: {
  service: ReturnType<typeof createDashboardServiceClient>;
  school: SchoolPhotoCoverRepairSchool;
  removedFamilies: ReadonlySet<string>;
  fallbackKey: string | null;
}) {
  const repaired: Array<{ type: string; id: string }> = [];
  const nextCover = params.fallbackKey;

  if (
    schoolPhotoReferenceMatchesFamily(
      params.school.cover_photo_url,
      params.removedFamilies,
    )
  ) {
    const { error } = await params.service
      .from("schools")
      .update({ cover_photo_url: nextCover })
      .eq("id", params.school.id)
      .eq("photographer_id", params.school.photographer_id);
    if (error) throw error;
    repaired.push({ type: "school", id: params.school.id });
  }

  const projects = await loadSchoolProjectCovers(params.service, params.school);
  const projectIds = projects.map((project) => project.id);
  if (!projectIds.length) return repaired;

  const { data: collections, error: collectionError } = await params.service
    .from("collections")
    .select("id,project_id,title,cover_photo_url")
    .in("project_id", projectIds);
  if (collectionError) throw collectionError;

  const collectionRows = (collections ?? []) as CollectionCoverRow[];
  const collectionById = new Map(
    collectionRows.map((collection) => [collection.id, collection]),
  );

  for (const project of projects) {
    const collectionId = projectPhotoCollectionId(
      project.cover_photo_url,
      project.id,
    );
    const collection = collectionById.get(collectionId);
    if (
      !projectMediaReferenceMatchesSchoolPhotoFamily({
        reference: project.cover_photo_url,
        families: params.removedFamilies,
        projectId: project.id,
        collectionId,
        collectionTitle:
          collection?.project_id === project.id ? collection.title : null,
      })
    ) {
      continue;
    }
    const { error } = await params.service
      .from("projects")
      .update({ cover_photo_url: nextCover })
      .eq("id", project.id)
      .eq("photographer_id", params.school.photographer_id);
    if (error) throw error;
    repaired.push({ type: "project", id: project.id });
  }

  for (const collection of collectionRows) {
    if (
      !projectMediaReferenceMatchesSchoolPhotoFamily({
        reference: collection.cover_photo_url,
        families: params.removedFamilies,
        projectId: collection.project_id,
        collectionId: collection.id,
        collectionTitle: collection.title,
      })
    ) {
      continue;
    }
    const { error } = await params.service
      .from("collections")
      .update({ cover_photo_url: nextCover })
      .eq("id", collection.id)
      .in("project_id", projectIds);
    if (error) throw error;
    repaired.push({ type: "collection", id: collection.id });
  }

  const { data: mediaRows, error: mediaError } = await params.service
    .from("media")
    .select("id,project_id,collection_id,storage_path,preview_url,thumbnail_url,is_cover")
    .in("project_id", projectIds)
    .eq("is_cover", true);
  if (mediaError) throw mediaError;

  for (const media of (mediaRows ?? []) as MediaCoverRow[]) {
    const collectionId = clean(media.collection_id);
    const collection = collectionById.get(collectionId);
    const matchesRemovedFamily = [
      media.storage_path,
      media.preview_url,
      media.thumbnail_url,
    ].some((reference) =>
      projectMediaReferenceMatchesSchoolPhotoFamily({
        reference,
        families: params.removedFamilies,
        projectId: media.project_id,
        collectionId,
        collectionTitle:
          collection?.project_id === media.project_id ? collection.title : null,
      }),
    );
    if (!matchesRemovedFamily) {
      continue;
    }
    const { error } = await params.service
      .from("media")
      .update({ is_cover: false })
      .eq("id", media.id)
      .in("project_id", projectIds);
    if (error) throw error;
    repaired.push({ type: "media_cover", id: media.id });
  }

  return repaired;
}
